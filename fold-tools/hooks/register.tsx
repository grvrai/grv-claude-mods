import { atom, memberOf, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderChildren } from 'claude-code'

import { cardOf, diffRows, groupSummary } from './cards'
import type { Body, Card, DiffRow } from './cards'
import { C, FRAME, G, iconOf, toneOf } from './style'
import type { Status, Tone } from './style'

// Left to the engine (turn-questions draws AskUserQuestion; Agent rows stream progress).
const SKIP = new Set(['AskUserQuestion', 'Agent', 'Task'])
// Tools whose card draws its own body, so the engine's result block is hidden.
const OWN = new Set(['Edit', 'Write', 'Read', 'Bash', 'Grep', 'Glob', 'WebFetch'])
// Body rows an unfolded card shows, as oh-my-pi's expanded PREVIEW_LIMITS; ⟦show all⟧ lifts it to FULL.
const CAPS: Record<Body['kind'], number> = { diff: 40, code: 12, shell: 10, text: 12, tree: 24 }
const FULL = 400
const RULE = '─'.repeat(400)
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
type Row = { node: RenderChildren; height: number }
type Section = { rows: Row[] } | { divider: string }
type Shown = { sections: Section[]; hidden: number; total: number; unit: string }
type Footer = { more: string; label: string; onPress: () => Promise<unknown> } | undefined

let cwd = ''
let home = ''

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

// Pieces of a one-row layout: fixed ones keep their width, the target truncates, the rule fills what is left.
const fixed = ({ Box }: Els, node: RenderChildren) => <Box flexShrink={0}>{node}</Box>

const fillOf = ({ Box, Text }: Els, color: string) => (
  <Box flexGrow={1} width={0} height={1} overflow="hidden">
    <Text color={color}>{RULE}</Text>
  </Box>
)

// oh-my-pi's header: `icon Title: target ⟦+N/-M⟧  meta · meta`; icon and title toggle the card.
const headerOf = (els: Els, id: string, card: Card, s: Status, fold: Fold) => {
  const { Box, Button, Text } = els
  const icon = iconOf(s, card.icon)
  const badge = card.badge && (card.badge.add || card.badge.del) ? card.badge : undefined
  const meta = [...card.meta, ...(s.isInterrupted ? ['interrupted'] : [])]
  return [
    fixed(
      els,
      <Button key={`fold-${id}`} plain onPress={fold.toggle}>
        <Text color={icon.color}>{icon.glyph} </Text>
        <Text color={C.accent}>{card.title}</Text>
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
    case 'text':
    case 'tree': {
      const all = body.kind === 'text' ? body.lines : body.items
      const shown = all.slice(0, cap)
      const color = body.kind === 'text' && body.isError ? C.error : C.muted
      return { sections: [{ rows: linesOf(els, shown, color) }], hidden: all.length - shown.length, total: all.length, unit: 'lines' }
    }
  }
}

// The control oh-my-pi puts at a body's end: what is cut and how to see it.
const footerOf = (shown: Shown, fold: Fold): Footer =>
  shown.hidden > 0
    ? { more: `… ${shown.hidden} more ${shown.unit} `, label: 'show all', onPress: fold.showAll }
    : { more: '', label: 'collapse', onPress: fold.toggle }

// oh-my-pi's output block: the header set into the top rule, rails, labelled dividers, the footer in the bottom rule.
const frameOf = (els: Els, id: string, tone: Tone, head: RenderChildren[], shown: Shown, footer: Footer) => {
  const { Box, Button, Text } = els
  const { border, bg } = FRAME[tone]
  const edge = (text: string) => fixed(els, <Text color={border}>{text}</Text>)
  const rule = (left: RenderChildren[], right: string) => (
    <Box height={1}>
      {left}
      {fillOf(els, border)}
      {edge(right)}
    </Box>
  )
  return (
    <Box flexDirection="column" backgroundColor={bg}>
      {rule(head.length ? [edge('╭─── '), ...head, edge(' ')] : [edge('╭')], '╮')}
      {shown.sections.map(section => {
        if ('divider' in section) return rule([edge('├─── '), fixed(els, <Text color={C.muted}>{section.divider} </Text>)], '┤')
        const height = section.rows.reduce((n, r) => n + r.height, 0)
        const rail = Array.from({ length: height }, () => '│').join('\n')
        return (
          <Box>
            {edge(rail)}
            <Box flexDirection="column" flexGrow={1} width={0} paddingX={1} overflow="hidden">
              {section.rows.map(r => r.node)}
            </Box>
            {edge(rail)}
          </Box>
        )
      })}
      {rule(
        [
          edge('╰───'),
          ...(footer
            ? [
                fixed(
                  els,
                  <Button key={`more-${id}`} plain onPress={footer.onPress}>
                    <Text color={C.dim}> {footer.more}</Text>
                    <Text color={C.muted}>⟦{footer.label}⟧ </Text>
                  </Button>,
                ),
              ]
            : []),
        ],
        '╯',
      )}
    </Box>
  )
}

// Grep and Glob hang their matches on branches instead of a frame.
const branchesOf = (els: Els, id: string, shown: Shown, footer: Footer) => {
  const { Box, Button, Text } = els
  const list = shown.sections.flatMap(s => ('rows' in s ? s.rows : []))
  return (
    <Box flexDirection="column" marginLeft={2}>
      {list.map((r, n) => (
        <Box height={1}>
          {fixed(els, <Text color={C.dim}>{n === list.length - 1 && !footer ? G.last : G.branch} </Text>)}
          {r.node}
        </Box>
      ))}
      {footer && (
        <Button key={`more-${id}`} plain onPress={footer.onPress}>
          <Text color={C.dim}>
            {G.last} {footer.more}
          </Text>
          <Text color={C.muted}>⟦{footer.label}⟧</Text>
        </Button>
      )}
    </Box>
  )
}

// Framed even when folded, as oh-my-pi frames these blocks; Read frames once opened, Grep and Glob never.
const isFramed = (card: Card, s: Status, isOpen: boolean) => {
  const kind = card.body?.kind
  return isOpen && kind !== undefined && kind !== 'tree' && (kind === 'shell' || !s.isRunning)
}

// One card: its header stays on its row when toggled; the body unfolds beneath or inside its frame.
const rowOf = async ($: EngineInterface, els: Els, id: string, card: Card, s: Status, lead: string, hasEngineBody: boolean) => {
  const { Box, Text } = els
  const fold = await foldOf($, { requestId: id })
  const head = headerOf(els, id, card, s, fold)
  const tone = toneOf(s)
  if (!lead && card.body && isFramed(card, s, fold.isOpen)) {
    const shown = shownOf(els, card.body, fold)
    return frameOf(els, id, tone, head, shown, footerOf(shown, fold))
  }
  const canOpen = !s.isRunning && (card.body !== undefined || hasEngineBody)
  const body = canOpen && fold.isOpen ? card.body : undefined
  const shown = body && shownOf(els, body, fold)
  return (
    <Box flexDirection="column">
      <Box key={`row-${id}`} height={1}>
        {lead && fixed(els, <Text color={C.dim}>{lead}</Text>)}
        {head}
        {canOpen && (
          <Box flexShrink={0} display="none" hover={{ display: 'flex' }}>
            <Text color={C.dim}>  ⟦{fold.isOpen ? 'collapse' : 'expand'}⟧</Text>
          </Box>
        )}
      </Box>
      {body &&
        shown &&
        (body.kind === 'tree' ? (
          branchesOf(els, id, shown, footerOf(shown, fold))
        ) : (
          <Box marginLeft={lead ? 3 : 0}>{frameOf(els, id, tone, [], shown, footerOf(shown, fold))}</Box>
        ))}
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
    if (e.props.isSummary) return next(e)
    const lines = e.props.text.split('\n')
    const intents = lines.flatMap(line => INTENT_LINE.exec(line)?.[1] ?? [])
    if (!intents.length) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const rest = lines.filter(line => !INTENT_LINE.test(line)).join('\n').trim()
    const heads = intents.map(text => (
      <Box marginTop={1}>
        <Text>
          <Text color={C.accent}>» </Text>
          <Text bold>{text}</Text>
        </Text>
      </Box>
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
    return rowOf($, els, e.requestId, cardOf(tool, input, output, cwd, home), e.props, '', !OWN.has(tool))
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
    if (only) return rowOf($, els, only.tool_use_id ?? e.requestId, cardOf(only.tool, only.input, only.output, cwd, home), only, '', false)
    const fold = await foldOf($, e, true)
    const icon = iconOf(
      {
        isRunning: calls.some(c => c.isRunning),
        isErrored: calls.some(c => c.isErrored),
        isInterrupted: calls.some(c => c.isInterrupted),
      },
      { glyph: G.bullet, color: C.success },
    )
    const head = (
      <Box key="row-group" height={1}>
        <Button key="fold-group" plain onPress={fold.toggle}>
          <Text color={icon.color}>{icon.glyph} </Text>
          <Text>{groupSummary(calls)}</Text>
        </Button>
        <Box flexShrink={0} display="none" hover={{ display: 'flex' }}>
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
          cardOf(c.tool, c.input, c.output, cwd, home),
          c,
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
