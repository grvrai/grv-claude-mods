import { atom, memberOf, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import { cardOf, diffRows, groupSummary } from './cards'
import type { Body, Card, DiffRow } from './cards'
import { C, CLOCK, FRAME, G, iconOf, SPINNER, timeOf, toneOf } from './style'
import type { Status, Tone } from './style'

// Left to the engine (turn-questions draws AskUserQuestion; Agent rows stream progress).
const SKIP = new Set(['AskUserQuestion', 'Agent', 'Task'])
// Tools whose card draws its own body, so the engine's result block is hidden.
const OWN = new Set(['Edit', 'Write', 'Read', 'Bash', 'Grep', 'Glob', 'WebFetch'])
// Body rows an unfolded card shows, as oh-my-pi's expanded PREVIEW_LIMITS; ⟦show all⟧ lifts it to FULL.
const CAPS: Record<Body['kind'], number> = { diff: 40, code: 12, shell: 10, text: 12, tree: 24 }
const FULL = 400
// The spinner's frame length.
const FRAME_MS = 120
// How much of a transcript too big for one read the backfill takes from its end.
const TAIL_BYTES = 4_000_000
const INTENT_LINE = /^\s*»\s+(.+?)\s*$/
// One blank row above each intent heading and message; tool calls go without, so a run of them stays bunched.
const GAP = 1
const INTENT = {
  id: 'fold-tools:intent',
  scope: 'session',
  text: [
    'Before each tool call, or each batch of parallel tool calls, write one line by itself:',
    '`» ` then a capitalized 2–6-word present-participle intent, e.g. `» Reading model role settings`.',
    'Put nothing else on that line; the terminal draws it as the heading of the tool cards that follow.',
  ].join(' '),
} as const

const mode = atom({ plugin: 'fold-tools', key: 'mode' } as const, { gen: 0, isOpen: false })
const rows = atom({ plugin: 'fold-tools', key: 'rows' } as const, { gen: -1, isOpen: false })
const queued = atom({ plugin: 'fold-tools', key: 'queued' } as const, [])
const tick = atom({ plugin: 'fold-tools', key: 'tick' } as const, 0)
const stamps = atom({ plugin: 'fold-tools', key: 'stamps' } as const, 0)
const history = atom({ plugin: 'fold-tools', key: 'history' } as const, 0)

type Els = Pick<ElementTable, 'Box' | 'Text' | 'Code' | 'Button' | 'Markdown'>
type Fold = Awaited<ReturnType<typeof foldOf>>
type Row = { node: RenderChildren; height: number }
type Section = { rows: Row[] } | { divider: string }
type Shown = { sections: Section[]; hidden: number; total: number; unit: string }
type Control = { more: string; label: string; onPress: () => Promise<unknown> }
type Footer = Control | undefined

let cwd = ''
let home = ''
// Tool calls in flight; the ticker runs only while one is, or while a prompt waits.
let active = 0
let ticker: Timer | undefined
// Rows stored before this load, by uuid, at the times the transcript file keeps.
const past = new Map<string, number>()

const animate = async ($: EngineInterface) => {
  const isLive = active > 0 || (await read($, queued)).length > 0
  if (isLive && !ticker) ticker = $.clock.every(FRAME_MS, () => void update($, tick, n => n + 1))
  if (!isLive && ticker) {
    ticker.cancel()
    ticker = undefined
  }
}

// Reads the transcript file's row times into `past`, its tail when the file is too big for one read.
const backfill = async ($: EngineInterface) => {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${home}/.claude`
  const path = `${dir}/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${await $.session.id()}.jsonl`
  const text = await $.fs
    .read(path)
    .catch(async () => (await $.process.run(['tail', '-c', String(TAIL_BYTES), path])).stdout)
    .catch(() => '')
  for (const line of text.split('\n')) {
    if (!line.includes('"timestamp"')) continue
    try {
      const row = JSON.parse(line) as { type?: string; uuid?: string; timestamp?: string }
      if ((row.type === 'user' || row.type === 'assistant') && row.uuid && row.timestamp) past.set(row.uuid, Date.parse(row.timestamp))
    } catch {}
  }
  await update($, history, n => n + 1)
}

// When a message row was stored, stamped live or read back from the transcript; 0 until it is stored.
const stampOf = async ($: EngineInterface, e: { requestId: string }) => {
  const [own] = await Promise.all([read($, memberOf(stamps, e)), read($, history)])
  return own || past.get(e.requestId) || 0
}

// A heavy rule across the frame's width, between two corners.
const ruleOf = (els: Els, left: string, right: string, color: string) => {
  const { Box, Text } = els
  return (
    <Box height={1}>
      {fixed(els, <Text color={color}>{left}</Text>)}
      <Box flexGrow={1} width={0} height={1} overflow="hidden">
        <Text color={color}>{'━'.repeat(FULL)}</Text>
      </Box>
      {fixed(els, <Text color={color}>{right}</Text>)}
    </Box>
  )
}

// A message in a heavy frame drawn by hand, so its mark sits on the left rail at the first line; its time ends that line, then anything `aside`.
const messageOf = async ($: EngineInterface, els: Els, e: { requestId: string }, color: string, mark: { glyph: string; color?: string } | undefined, body: RenderChildren, aside?: RenderChildren) => {
  const { Box, Text } = els
  const stamp = await stampOf($, e)
  const time = stamp ? timeOf(stamp, await $.clock.now()) : ''
  // The rails stand outside the flow, stretched to the body's height and cut there; the mark keeps its row as the rail is cut.
  const rail = Array.from({ length: FULL }, () => '┃').join('\n')
  return (
    <Box flexDirection="column" marginTop={GAP}>
      {ruleOf(els, '┏', '┓', color)}
      <Box paddingLeft={2} paddingRight={2}>
        <Box position="absolute" top={0} bottom={0} left={0} width={1} flexDirection="column" overflow="hidden">
          {mark
            ? fixed(
                els,
                <Text bold color={mark.color}>
                  {mark.glyph}
                </Text>,
              )
            : undefined}
          <Text color={color}>{rail}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} width={0}>
          {body}
        </Box>
        <Box flexShrink={0}>
          {time && <Text color={C.dim}>  {time}</Text>}
          {aside}
        </Box>
        <Box position="absolute" top={0} bottom={0} right={0} width={1} overflow="hidden">
          <Text color={color}>{rail}</Text>
        </Box>
      </Box>
      {ruleOf(els, '┗', '┛', color)}
    </Box>
  )
}

// A row follows the last /fold (or `fallback`) until it is clicked under that same /fold.
const foldOf = async ($: EngineInterface, e: { requestId: string }, fallback?: boolean) => {
  const row = memberOf(rows, e)
  const [m, own] = await Promise.all([read($, mode), read($, row)])
  const write = async (change: (isOpen: boolean) => { isOpen: boolean; isFull: boolean }) => {
    const now = await read($, mode)
    await update($, row, r => ({ gen: now.gen, ...change(r.gen === now.gen ? r.isOpen : (fallback ?? now.isOpen)) }))
  }
  return {
    isOpen: own.gen === m.gen ? own.isOpen : (fallback ?? m.isOpen),
    isFull: !!own.isFull,
    toggle: () => write(isOpen => ({ isOpen: !isOpen, isFull: false })),
    showAll: () => write(() => ({ isOpen: true, isFull: true })),
  }
}

// Pieces of a one-row layout: fixed ones keep their width, the target truncates.
const fixed = ({ Box }: Els, node: RenderChildren) => <Box flexShrink={0}>{node}</Box>

// The fold control: the status icon at rest; while the pointer is on the row, a ▸/▾ laid over it, the one cell that presses.
const toggleOf = (els: Els, key: string, icon: { glyph: string; color: string }, isOpen: boolean, onPress: () => unknown) => {
  const { Box, Button, Text } = els
  const wide = (icon.glyph.codePointAt(0) ?? 0) >= 0x1f000
  return (
    <Box flexShrink={0}>
      <Text color={icon.color}>{icon.glyph} </Text>
      <Box position="absolute" top={0} left={0} display="none" hover={{ display: 'flex' }}>
        <Button key={key} plain onPress={onPress}>
          <Text color={C.accent}>{`${isOpen ? '▾' : '▸'}${wide ? ' ' : ''}`}</Text>
        </Button>
      </Box>
    </Box>
  )
}

// oh-my-pi's header: `icon Title: target ⟦+N/-M⟧  meta · meta`; the icon's cell toggles the card.
const headerOf = (els: Els, id: string, card: Card, s: Status, fold: Fold, frame = 0) => {
  const { Box, Text } = els
  const icon = s.isRunning ? { glyph: SPINNER[frame % SPINNER.length] ?? G.pending, color: card.tint } : iconOf(s, card.icon)
  const badge = card.badge && (card.badge.add || card.badge.del) ? card.badge : undefined
  const meta = [...card.meta, ...(s.isInterrupted ? ['interrupted'] : [])]
  return [
    toggleOf(els, `fold-${id}`, icon, fold.isOpen, fold.toggle),
    fixed(
      els,
      <Text>
        <Text bold color={card.tint}>
          {card.title}
        </Text>
        <Text color={C.dim}>{card.target ? ': ' : ''}</Text>
      </Text>,
    ),
    ...(card.target
      ? [
          <Box flexShrink={1} height={1} overflow="hidden">
            <Text wrap={card.isPath ? 'truncate-start' : 'truncate-end'}>{card.target}</Text>
          </Box>,
        ]
      : []),
    ...(badge || meta.length
      ? [
          fixed(
            els,
            <Text>
              {badge && <Text color={C.dim}> ⟦</Text>}
              {badge && badge.add > 0 && <Text color={C.success}>+{badge.add}</Text>}
              {badge && badge.add > 0 && badge.del > 0 && <Text color={C.dim}>/</Text>}
              {badge && badge.del > 0 && <Text color={C.error}>-{badge.del}</Text>}
              {badge && <Text color={C.dim}>⟧</Text>}
              {meta.length > 0 && <Text color={C.dim}>  {meta.join(' · ')}</Text>}
            </Text>,
          ),
        ]
      : []),
  ]
}

const SIGN = { add: '+', del: '-', ctx: ' ', gap: ' ' }
const TINT = { add: C.success, del: C.error, ctx: C.muted, gap: C.dim }

// oh-my-pi's diff: marker and number gutter, whole-line color, the changed words inverted, indent as dim dots.
const diffOf = ({ Text }: Els, list: DiffRow[], width: number) =>
  list.map((r, i) => {
    if (r.kind === 'gap') return <Text color={C.dim}>{' '.repeat(width + 1)}…</Text>
    const prev = list[i - 1]
    const num = prev && prev.kind !== 'gap' && prev.num === r.num ? '' : String(r.num)
    const [from, to] = r.mark ?? [r.text.length, r.text.length]
    const indent = r.text.slice(0, Math.min(from, r.text.length - r.text.trimStart().length))
    return (
      <Text wrap="truncate-end" color={TINT[r.kind]}>
        <Text color={C.dim}>
          {SIGN[r.kind]}
          {num.padStart(width)}│
        </Text>
        <Text color={C.dim}>{indent.replace(/ /g, '·').replace(/\t/g, ' → ')}</Text>
        {r.text.slice(indent.length, from)}
        {r.mark && <Text inverse>{r.text.slice(from, to)}</Text>}
        {r.mark && r.text.slice(to)}
      </Text>
    )
  })

const linesOf = ({ Text }: Els, lines: string[], color: string): Row[] =>
  lines.map(line => ({
    node: (
      <Text color={color} wrap="truncate-end">
        {line}
      </Text>
    ),
    height: 1,
  }))

// What a body shows at its fold, in rows one terminal row tall so the rails can match them.
const shownOf = (els: Els, body: Body, fold: Fold): Shown => {
  const { Box, Text, Code } = els
  const cap = fold.isFull ? FULL : CAPS[body.kind]
  switch (body.kind) {
    case 'diff': {
      const list = diffRows(body.hunks)
      const width = Math.max(3, String(Math.max(0, ...list.map(r => r.num))).length)
      const shown = list.slice(0, cap)
      const rows = diffOf(els, shown, width).map(node => ({ node, height: 1 }))
      return { sections: [{ rows }], hidden: list.length - shown.length, total: list.length, unit: 'lines' }
    }
    case 'code': {
      const all = body.source.split('\n')
      const shown = all.slice(0, cap)
      const node = <Code source={shown.join('\n')} path={body.path} startLine={body.startLine} wrap="truncate-end" />
      return { sections: [{ rows: [{ node, height: shown.length }] }], hidden: all.length - shown.length, total: all.length, unit: 'lines' }
    }
    case 'shell': {
      const command = body.command.split('\n').slice(0, 3)
      const shown = body.output.slice(-cap)
      const prompt = (
        <Box>
          {fixed(els, <Text color={C.dim}>$ </Text>)}
          <Code source={command.join('\n')} language="bash" wrap="truncate-end" />
        </Box>
      )
      return {
        sections: [
          { rows: [{ node: prompt, height: command.length }] },
          ...(shown.length ? [{ divider: 'Output' }, { rows: linesOf(els, shown, body.isError ? C.error : C.muted) }] : []),
        ],
        hidden: body.output.length - shown.length,
        total: body.output.length,
        unit: 'earlier lines',
      }
    }
    case 'text': {
      const shown = body.lines.slice(0, cap)
      const rows = linesOf(els, shown, body.isError ? C.error : C.muted)
      return { sections: [{ rows }], hidden: body.lines.length - shown.length, total: body.lines.length, unit: 'lines' }
    }
    case 'tree': {
      // Grep and Glob hang their matches on branches.
      const shown = body.items.slice(0, cap)
      const rows = shown.map((item, n) => ({
        node: (
          <Text wrap="truncate-end">
            <Text color={C.dim}>{n === shown.length - 1 ? G.last : G.branch} </Text>
            <Text color={C.muted}>{item}</Text>
          </Text>
        ),
        height: 1,
      }))
      return { sections: [{ rows }], hidden: body.items.length - shown.length, total: body.items.length, unit: 'more' }
    }
  }
}

// The control oh-my-pi puts at a body's end: what is cut and how to see it.
const footerOf = (shown: Shown, fold: Fold): Control =>
  shown.hidden > 0
    ? { more: `… ${shown.hidden} more ${shown.unit} `, label: 'show all', onPress: fold.showAll }
    : { more: '', label: 'collapse', onPress: fold.toggle }

// An unfolded body beneath its header: rows on a left rail in the card's state color, the footer control at its foot.
const railOf = (els: Els, id: string, tone: Tone, sections: Section[], footer: Footer) => {
  const { Box, Button, Text } = els
  const color = FRAME[tone]
  return (
    <Box flexDirection="column" marginLeft={2}>
      {sections.map(section => {
        if ('divider' in section) {
          return (
            <Text>
              <Text color={color}>├─ </Text>
              <Text color={C.muted}>{section.divider}</Text>
            </Text>
          )
        }
        const height = section.rows.reduce((n, r) => n + r.height, 0)
        return (
          <Box>
            {fixed(els, <Text color={color}>{Array.from({ length: height }, () => '│').join('\n')}</Text>)}
            <Box flexDirection="column" flexGrow={1} width={0} paddingLeft={1} overflow="hidden">
              {section.rows.map(r => r.node)}
            </Box>
          </Box>
        )
      })}
      {footer && (
        <Box height={1}>
          {fixed(els, <Text color={color}>└ </Text>)}
          <Button key={`more-${id}`} plain onPress={footer.onPress}>
            <Text color={C.dim}>{footer.more}</Text>
            <Text color={C.muted}>⟦{footer.label}⟧</Text>
          </Button>
        </Box>
      )}
    </Box>
  )
}

// Only a running card reads the tick, so a finished one never redraws for it.
const spinOf = async ($: EngineInterface, isRunning: boolean) => (isRunning ? read($, tick) : 0)

// One card: a single header line, folded; unfolded, its body on a rail beneath. A row the view expands (a click on it, ctrl+o) shows its whole body, the view's own fold in place of the card's.
const rowOf = async ($: EngineInterface, els: Els, id: string, card: Card, s: Status, hasEngineBody: boolean, isExpanded = false) => {
  const { Box } = els
  const own = await foldOf($, { requestId: id })
  const fold = isExpanded ? { ...own, isOpen: true, isFull: true } : own
  const head = headerOf(els, id, card, s, fold, await spinOf($, s.isRunning))
  const canOpen = !s.isRunning && (card.body !== undefined || hasEngineBody)
  const shown = canOpen && fold.isOpen && card.body ? shownOf(els, card.body, fold) : undefined
  return (
    <Box flexDirection="column">
      <Box key={`row-${id}`} height={1}>
        {head}
      </Box>
      {shown && railOf(els, id, toneOf(s), shown.sections, isExpanded ? undefined : footerOf(shown, fold))}
    </Box>
  )
}

// One call of a group: its branch line, and its body indented beneath once unfolded.
const branchOf = async ($: EngineInterface, els: Els, id: string, card: Card, s: Status, lead: string) => {
  const { Box, Text } = els
  const fold = await foldOf($, { requestId: id })
  const shown = !s.isRunning && fold.isOpen && card.body ? shownOf(els, card.body, fold) : undefined
  return (
    <Box flexDirection="column">
      <Box key={`row-${id}`} height={1}>
        {fixed(els, <Text color={C.dim}>{lead}</Text>)}
        {headerOf(els, id, card, s, fold, await spinOf($, s.isRunning))}
      </Box>
      {shown && <Box marginLeft={3}>{railOf(els, id, toneOf(s), shown.sections, footerOf(shown, fold))}</Box>}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = await $.session.cwd()
    home = (await $.env.get('HOME')) ?? ''
    await $.command.register({
      name: 'fold',
      description: 'Open or close every tool card',
      argumentHint: '[open|close]',
    })
    const started = await next(e)
    void backfill($)
    return started
  })

  // Stamps each prompt and reply row as it is stored, under the id its transcript row is drawn by.
  on('session.append', async ($, e, next) => {
    if (!e.agentId && (e.door === 'prompt' || e.door === 'response')) {
      const now = await $.clock.now()
      await update($, memberOf(stamps, { requestId: e.uuid }), () => now)
    }
    return next(e)
  })

  on('command.run', { command: 'fold' }, async ($, e) => {
    const arg = e.args.trim()
    const now = await update($, mode, m => ({
      gen: m.gen + 1,
      isOpen: arg === 'open' ? true : arg === 'close' ? false : !m.isOpen,
    }))
    return { text: `Tool cards ${now.isOpen ? 'open' : 'closed'}.` }
  })

  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections.filter(s => s.id !== INTENT.id), INTENT] }
  })

  // Claude's text, or the engine's summary of it, in a dim frame, the reply's bullet on its rail, drawn as a reply is (an engine node may not sit in a sized Box); » lines come out of it as the intent headings of the calls below.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const lines = e.props.text.split('\n')
    const intents = lines.flatMap(line => INTENT_LINE.exec(line)?.[1] ?? [])
    const els = $.ui.resolve(e)
    const { Box, Markdown, Text } = els
    const rest = lines.filter(line => !INTENT_LINE.test(line)).join('\n').trim()
    const mark = e.props.isFirstOfReply ? { glyph: '⏺' } : undefined
    const framed = rest ? await messageOf($, els, e, C.dim, mark, <Markdown text={rest} />) : undefined
    if (!intents.length) return framed ?? next(e)
    const heads = (
      <Box flexDirection="column" marginTop={GAP}>
        {intents.map(text => (
          <Text>
            <Text color={C.accent}>» </Text>
            <Text bold>{text}</Text>
          </Text>
        ))}
      </Box>
    )
    if (!framed) return heads
    return (
      <Box flexDirection="column">
        {framed}
        {heads}
      </Box>
    )
  })

  // A prompt typed over a running turn waits in the engine's queue until a later turn picks it up.
  on('prompt.submit', async ($, e, next) => {
    const sent = await next(e)
    if (e.turnId && !e.command && !e.isMeta && !('drop' in sent)) {
      const entry = { text: e.text, turnId: e.turnId }
      await update($, queued, list => [...list, entry].slice(-50))
      await animate($)
    }
    return sent
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId && (await read($, queued)).length) {
      await update($, queued, list => list.filter(q => q.turnId === e.turnId && q.text !== e.text))
      await animate($)
    }
    return next(e)
  })

  // The engine hands queued prompts to the model with its next request, mid-turn included.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && (await read($, queued)).length) {
      await update($, queued, () => [])
      await animate($)
    }
    return yield* next(e)
  })

  // Counts the calls in flight, so the ticker runs while any card is animating.
  on('tool.call', async ($, e, next) => {
    if (SKIP.has(e.tool)) return next(e)
    active += 1
    await animate($)
    try {
      return await next(e)
    } finally {
      active -= 1
      await animate($)
    }
  })

  // The person's own prompts in a blue frame, the prompt icon on its rail: the text, its time and submission status.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin.kind !== 'composer') return next(e)
    const els = $.ui.resolve(e)
    const { Text } = els
    const isQueued = (await read($, queued)).some(q => q.text === e.props.text)
    const frame = isQueued ? await read($, tick) : 0
    const status = <Text color={isQueued ? C.warning : C.success}>  {isQueued ? CLOCK[frame % CLOCK.length] : '✓'}</Text>
    return messageOf($, els, e, C.blue, { glyph: '❯', color: C.blue }, <Text>{e.props.text}</Text>, status)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { tool, input, output } = e.props
    if (SKIP.has(tool)) return next(e)
    const card = cardOf(tool, input, output, cwd, home)
    return rowOf($, $.ui.resolve(e), e.requestId, card, e.props, !OWN.has(tool), e.props.isExpanded)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (SKIP.has(e.props.tool)) return next(e)
    const { Box } = $.ui.resolve(e)
    if (OWN.has(e.props.tool) || !(e.props.isExpanded || (await foldOf($, e)).isOpen)) return <Box />
    const engine = await next(e)
    return <Box marginLeft={2}>{engine}</Box>
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const { calls } = e.props
    const only = calls.length === 1 ? calls[0] : undefined
    if (only) {
      const card = cardOf(only.tool, only.input, only.output, cwd, home)
      return rowOf($, els, only.tool_use_id ?? e.requestId, card, only, false)
    }
    const fold = await foldOf($, e, true)
    const status = {
      isRunning: calls.some(c => c.isRunning),
      isErrored: calls.some(c => c.isErrored),
      isInterrupted: calls.some(c => c.isInterrupted),
    }
    const frame = await spinOf($, status.isRunning)
    const cards = calls.map(c => cardOf(c.tool, c.input, c.output, cwd, home))
    // A group of one kind of call takes that kind's color, a shell run its blue.
    const tint = cards.every(c => c.tint === cards[0]?.tint) ? (cards[0]?.tint ?? C.accent) : C.accent
    const icon = status.isRunning ? { glyph: SPINNER[frame % SPINNER.length] ?? G.pending, color: tint } : iconOf(status, { glyph: G.bullet, color: C.success })
    const branches = fold.isOpen
      ? await Promise.all(
          calls.map((c, n) =>
            branchOf($, els, c.tool_use_id ?? `${e.requestId}-${n}`, cards[n] ?? cardOf(c.tool, c.input, c.output, cwd, home), c, `${n === calls.length - 1 ? G.last : G.branch} `),
          ),
        )
      : []
    return (
      <Box flexDirection="column">
        <Box key={`row-${e.requestId}`} height={1}>
          {toggleOf(els, 'fold-group', icon, fold.isOpen, fold.toggle)}
          <Text bold color={tint}>
            {groupSummary(calls)}
          </Text>
        </Box>
        <Box flexDirection="column" paddingLeft={2}>
          {branches}
        </Box>
      </Box>
    )
  })
}
