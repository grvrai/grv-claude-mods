import { atom, memberOf, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import { cardOf, diffRows, groupSummary } from './cards'
import type { Body, Card, DiffRow } from './cards'
import { C, CLOCK, FRAME, G, iconOf, SPINNER, toneOf } from './style'
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
const INTENT_LINE = /^\s*»\s+(.+?)\s*$/
// One blank row above each card, as the engine gives the tool rows it draws itself.
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

type Els = Pick<ElementTable, 'Box' | 'Text' | 'Code' | 'Button'>
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

const animate = async ($: EngineInterface) => {
  const isLive = active > 0 || (await read($, queued)).length > 0
  if (isLive && !ticker) ticker = $.clock.every(FRAME_MS, () => void update($, tick, n => n + 1))
  if (!isLive && ticker) {
    ticker.cancel()
    ticker = undefined
  }
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

// oh-my-pi's header: `icon Title: target ⟦+N/-M⟧  meta · meta`; icon and title toggle the card.
const headerOf = (els: Els, id: string, card: Card, s: Status, fold: Fold, frame = 0) => {
  const { Box, Button, Text } = els
  const icon = s.isRunning ? { glyph: SPINNER[frame % SPINNER.length] ?? G.pending, color: C.accent } : iconOf(s, card.icon)
  const badge = card.badge && (card.badge.add || card.badge.del) ? card.badge : undefined
  const meta = [...card.meta, ...(s.isInterrupted ? ['interrupted'] : [])]
  return [
    fixed(
      els,
      <Button key={`fold-${id}`} plain onPress={fold.toggle}>
        <Text color={icon.color}>{icon.glyph} </Text>
        <Text bold color={C.accent}>
          {card.title}
        </Text>
        <Text color={C.dim}>{card.target ? ': ' : ''}</Text>
      </Button>,
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

// One card: a single header line, folded; unfolded, its body on a rail beneath.
const rowOf = async ($: EngineInterface, els: Els, id: string, card: Card, s: Status, hasEngineBody: boolean) => {
  const { Box } = els
  const fold = await foldOf($, { requestId: id })
  const head = headerOf(els, id, card, s, fold, await spinOf($, s.isRunning))
  const canOpen = !s.isRunning && (card.body !== undefined || hasEngineBody)
  const shown = canOpen && fold.isOpen && card.body ? shownOf(els, card.body, fold) : undefined
  return (
    <Box flexDirection="column">
      <Box height={1}>{head}</Box>
      {shown && railOf(els, id, toneOf(s), shown.sections, footerOf(shown, fold))}
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
      <Box height={1}>
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

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const lines = e.props.text.split('\n')
    const intents = e.props.isSummary ? [] : lines.flatMap(line => INTENT_LINE.exec(line)?.[1] ?? [])
    if (!intents.length) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const rest = lines.filter(line => !INTENT_LINE.test(line)).join('\n').trim()
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
    if (!rest) return heads
    const engine = await next({ ...e, props: { ...e.props, text: rest } })
    return (
      <Box flexDirection="column">
        {engine}
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

  // The person's own prompts as one unframed line, as the tool calls are: a blue prompt icon, the text, its submission status.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin.kind !== 'composer') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const isQueued = (await read($, queued)).some(q => q.text === e.props.text)
    const frame = isQueued ? await read($, tick) : 0
    return (
      <Box>
        <Box flexShrink={0}>
          <Text bold color={C.user}>
            ❯{' '}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text>{e.props.text}</Text>
        </Box>
        <Box flexShrink={0}>
          <Text color={isQueued ? C.warning : C.success}>  {isQueued ? CLOCK[frame % CLOCK.length] : '✓'}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { tool, input, output } = e.props
    if (SKIP.has(tool)) return next(e)
    const els = $.ui.resolve(e)
    const { Box } = els
    const card = cardOf(tool, input, output, cwd, home)
    return <Box marginTop={GAP}>{await rowOf($, els, e.requestId, card, e.props, !OWN.has(tool))}</Box>
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (SKIP.has(e.props.tool)) return next(e)
    const { Box } = $.ui.resolve(e)
    if (OWN.has(e.props.tool) || !(await foldOf($, e)).isOpen) return <Box />
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
      return <Box marginTop={GAP}>{await rowOf($, els, only.tool_use_id ?? e.requestId, card, only, false)}</Box>
    }
    const fold = await foldOf($, e, true)
    const status = {
      isRunning: calls.some(c => c.isRunning),
      isErrored: calls.some(c => c.isErrored),
      isInterrupted: calls.some(c => c.isInterrupted),
    }
    const frame = await spinOf($, status.isRunning)
    const icon = status.isRunning ? { glyph: SPINNER[frame % SPINNER.length] ?? G.pending, color: C.accent } : iconOf(status, { glyph: G.bullet, color: C.success })
    const branches = fold.isOpen
      ? await Promise.all(
          calls.map((c, n) =>
            branchOf($, els, c.tool_use_id ?? `${e.requestId}-${n}`, cardOf(c.tool, c.input, c.output, cwd, home), c, `${n === calls.length - 1 ? G.last : G.branch} `),
          ),
        )
      : []
    return (
      <Box flexDirection="column" marginTop={GAP}>
        <Box height={1}>
          <Button key="fold-group" plain onPress={fold.toggle}>
            <Text color={icon.color}>{icon.glyph} </Text>
            <Text bold color={C.accent}>
              {groupSummary(calls)}
            </Text>
          </Button>
        </Box>
        <Box flexDirection="column" paddingLeft={2}>
          {branches}
        </Box>
      </Box>
    )
  })
}
