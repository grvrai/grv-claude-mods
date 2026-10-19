import { atom, memberOf, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderChildren } from 'claude-code'

import { cardOf, clip, diffRows, groupSummary } from './cards'
import type { Body, Card, DiffRow } from './cards'
import { C, FRAME, G, iconOf, toneOf } from './style'
import type { Status, Tone } from './style'

// Left to the engine (turn-questions draws AskUserQuestion; Agent rows stream progress).
const SKIP = new Set(['AskUserQuestion', 'Agent', 'Task'])
// Tools whose card draws its own body, so the engine's result block is hidden.
const OWN = new Set(['Edit', 'Write', 'Read', 'Bash', 'Grep', 'Glob', 'WebFetch'])
const PREVIEW = 12
const DIFF_PREVIEW = 40
const SHELL_TAIL = 10
const FULL = 400
const INTENT_LINE = /^\s*»\s+(.+?)\s*$/
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

type Els = Pick<ElementTable, 'Box' | 'Text' | 'Code' | 'Button'>
type Fold = Awaited<ReturnType<typeof foldOf>>

let cwd = ''

// A row follows the last /fold until it is clicked under that same /fold.
const foldOf = async ($: EngineInterface, e: { requestId: string }) => {
  const row = memberOf(rows, e)
  const [m, own] = await Promise.all([read($, mode), read($, row)])
  const isMine = own.gen === m.gen
  const write = async (change: (isOpen: boolean, isFull: boolean) => { isOpen: boolean; isFull: boolean }) => {
    const now = await read($, mode)
    await update($, row, r => ({ gen: now.gen, ...change(r.gen === now.gen ? r.isOpen : now.isOpen, !!r.isFull) }))
  }
  return {
    isOpen: isMine ? own.isOpen : m.isOpen,
    isFull: !!own.isFull,
    toggle: () => write((isOpen, isFull) => ({ isOpen: !isOpen, isFull })),
    toggleFull: () => write((isOpen, isFull) => ({ isOpen, isFull: !isFull })),
  }
}

const headerOf = ({ Text }: Els, card: Card, s: Status, columns: number, lead: string) => {
  const icon = iconOf(s, card.icon)
  const badge = card.badge && (card.badge.add || card.badge.del) ? card.badge : undefined
  const meta = [...card.meta, ...(s.isInterrupted ? ['interrupted'] : [])]
  const metaText = meta.length ? `  ${meta.join(' · ')}` : ''
  const badgeText = badge ? ` ⟦+${badge.add}/-${badge.del}⟧` : ''
  const room = columns - lead.length - card.title.length - badgeText.length - metaText.length - 6
  return [
    ...(lead ? [<Text color={C.dim}>{lead}</Text>] : []),
    <Text color={icon.color}>{icon.glyph} </Text>,
    <Text color={C.accent}>{card.title}</Text>,
    ...(card.target ? [<Text color={C.dim}>: </Text>, <Text>{clip(card.target, Math.max(12, room), card.isPath)}</Text>] : []),
    ...(badge
      ? [
          <Text color={C.dim}> ⟦</Text>,
          <Text color={C.success}>+{badge.add}</Text>,
          <Text color={C.dim}>/</Text>,
          <Text color={C.error}>-{badge.del}</Text>,
          <Text color={C.dim}>⟧</Text>,
        ]
      : []),
    ...(metaText ? [<Text color={C.dim}>{metaText}</Text>] : []),
  ]
}

const moreOf = ({ Button, Text }: Els, hidden: number, total: number, cap: number, unit: string, fold: Fold, lead = '') =>
  total > cap && (
    <Button key="all" plain onPress={fold.toggleFull}>
      <Text color={C.dim}>
        {lead}
        {hidden > 0 ? `… ${hidden} more ${unit} ` : ''}
      </Text>
      <Text color={C.muted}>⟦{fold.isFull ? 'show less' : 'show all'}⟧</Text>
    </Button>
  )

const SIGN = { add: '+', del: '-', ctx: ' ', gap: ' ' }
const TINT = { add: C.success, del: C.error, ctx: C.muted, gap: C.dim }

// oh-my-pi's diff: marker and number gutter, whole-line color, the changed words inverted, indent as dim dots.
const diffOf = ({ Text }: Els, list: DiffRow[]) => {
  const width = Math.max(3, String(Math.max(0, ...list.map(r => r.num))).length)
  return list.map((r, i) => {
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
}

const frameOf = ({ Box }: Els, tone: Tone, children: RenderChildren[]) => (
  <Box flexDirection="column" borderStyle="round" borderColor={FRAME[tone].border} backgroundColor={FRAME[tone].bg} paddingX={1} marginLeft={2}>
    {children}
  </Box>
)

const bodyOf = (els: Els, body: Body, tone: Tone, fold: Fold, columns: number) => {
  const { Box, Text, Code } = els
  const cap = (preview: number) => (fold.isFull ? FULL : preview)
  switch (body.kind) {
    case 'diff': {
      const list = diffRows(body.hunks)
      const shown = list.slice(0, cap(DIFF_PREVIEW))
      return frameOf(els, tone, [...diffOf(els, shown), moreOf(els, list.length - shown.length, list.length, DIFF_PREVIEW, 'lines', fold)])
    }
    case 'code': {
      const all = body.source.split('\n')
      const shown = all.slice(0, cap(PREVIEW))
      return frameOf(els, tone, [
        <Code source={shown.join('\n')} path={body.path} startLine={body.startLine} wrap="truncate-end" />,
        moreOf(els, all.length - shown.length, all.length, PREVIEW, 'lines', fold),
      ])
    }
    case 'shell': {
      const shown = body.output.slice(-cap(SHELL_TAIL))
      const earlier = body.output.length - shown.length
      return frameOf(els, tone, [
        <Box>
          <Text color={C.dim}>$ </Text>
          <Code source={body.command} language="bash" wrap="truncate-end" />
        </Box>,
        <Text color={C.dim}>─ Output {'─'.repeat(Math.max(0, columns - 18))}</Text>,
        moreOf(els, earlier, body.output.length, SHELL_TAIL, 'earlier lines', fold),
        ...(shown.length
          ? shown.map(line => (
              <Text color={C.muted} wrap="truncate-end">
                {line}
              </Text>
            ))
          : [
              <Text color={C.dim} italic>
                no output
              </Text>,
            ]),
      ])
    }
    case 'tree': {
      const shown = body.items.slice(0, cap(PREVIEW))
      const hidden = body.items.length - shown.length
      const more = moreOf(els, hidden, body.items.length, PREVIEW, 'more', fold, `${G.last} `)
      return (
        <Box flexDirection="column" marginLeft={2}>
          {shown.map((item, n) => (
            <Text wrap="truncate-end">
              <Text color={C.dim}>{n === shown.length - 1 && !more ? G.last : G.branch} </Text>
              <Text color={C.muted}>{item}</Text>
            </Text>
          ))}
          {more}
        </Box>
      )
    }
    case 'text': {
      const shown = body.lines.slice(0, cap(PREVIEW))
      return frameOf(els, body.isError ? 'error' : tone, [
        ...shown.map(line => (
          <Text color={body.isError ? C.error : C.muted} wrap="truncate-end">
            {line}
          </Text>
        )),
        moreOf(els, body.lines.length - shown.length, body.lines.length, PREVIEW, 'lines', fold),
      ])
    }
  }
}

// One card: a header that stays put when toggled, and the body it unfolds beneath.
const rowOf = async ($: EngineInterface, els: Els, id: string, card: Card, s: Status, columns: number, lead: string, hasEngineBody: boolean) => {
  const { Box, Button, Text } = els
  const fold = await foldOf($, { requestId: id })
  const canOpen = !s.isRunning && (card.body !== undefined || hasEngineBody)
  return (
    <Box flexDirection="column">
      <Box key={`row-${id}`}>
        <Button key={`fold-${id}`} plain onPress={fold.toggle}>
          {headerOf(els, card, s, columns, lead)}
        </Button>
        {canOpen && (
          <Box display="none" hover={{ display: 'flex' }}>
            <Text color={C.dim}>  ⟦{fold.isOpen ? 'collapse' : 'expand'}⟧</Text>
          </Box>
        )}
      </Box>
      {canOpen && fold.isOpen && card.body && bodyOf(els, card.body, toneOf(s), fold, columns)}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = await $.session.cwd()
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
    if (e.props.isSummary) return next(e)
    const lines = e.props.text.split('\n')
    const intents = lines.flatMap(line => INTENT_LINE.exec(line)?.[1] ?? [])
    if (!intents.length) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const rest = lines.filter(line => !INTENT_LINE.test(line)).join('\n').trim()
    const heads = intents.map(text => (
      <Text>
        <Text color={C.accent}>» </Text>
        <Text bold>{text}</Text>
      </Text>
    ))
    if (!rest) return <Box flexDirection="column">{heads}</Box>
    const engine = await next({ ...e, props: { ...e.props, text: rest } })
    return (
      <Box flexDirection="column">
        {engine}
        {heads}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { tool, input, output } = e.props
    if (SKIP.has(tool)) return next(e)
    const els = $.ui.resolve(e)
    const card = cardOf(tool, input, output, cwd)
    return rowOf($, els, e.requestId, card, e.props, e.viewport?.columns ?? 100, '', !OWN.has(tool))
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
    const columns = e.viewport?.columns ?? 100
    const fold = await foldOf($, e)
    const icon = iconOf(
      {
        isRunning: calls.some(c => c.isRunning),
        isErrored: calls.some(c => c.isErrored),
        isInterrupted: calls.some(c => c.isInterrupted),
      },
      { glyph: G.bullet, color: C.success },
    )
    const head = (
      <Box key="row-group">
        <Button key="fold-group" plain onPress={fold.toggle}>
          <Text color={icon.color}>{icon.glyph} </Text>
          <Text>{groupSummary(calls)}</Text>
        </Button>
        <Box display="none" hover={{ display: 'flex' }}>
          <Text color={C.dim}>  ⟦{fold.isOpen ? 'collapse' : 'expand'}⟧</Text>
        </Box>
      </Box>
    )
    if (!fold.isOpen) return head
    const branches = await Promise.all(
      calls.map((c, n) =>
        rowOf(
          $,
          els,
          c.tool_use_id ?? `${e.requestId}-${n}`,
          cardOf(c.tool, c.input, c.output, cwd),
          c,
          columns - 2,
          `${n === calls.length - 1 ? G.last : G.branch} `,
          false,
        ),
      ),
    )
    return (
      <Box flexDirection="column">
        {head}
        <Box flexDirection="column" paddingLeft={2}>
          {branches}
        </Box>
      </Box>
    )
  })
}
