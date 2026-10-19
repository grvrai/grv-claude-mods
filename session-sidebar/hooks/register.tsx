import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, ElementTable, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Sub, Todo, Touched } from '../types'
import { C, clip, DONE, duration, MARKS, relPath, SPINNER, statsOf, statText } from './style'

const POLL_MS = 2000
// A card is at most this wide, and shows at most this many rows before `… N more`.
const CARD_WIDTH = 40
const MAX_ROWS = 6
const STATUS_ORDER = { in_progress: 0, pending: 1, completed: 2 }

const subagents = atom({ plugin: 'session-sidebar', key: 'subagents' } as const, [])
const todos = atom({ plugin: 'session-sidebar', key: 'todos' } as const, [])
const files = atom({ plugin: 'session-sidebar', key: 'files' } as const, [])
const reads = atom({ plugin: 'session-sidebar', key: 'reads' } as const, [])
const isHidden = atom({ plugin: 'session-sidebar', key: 'isHidden' } as const, false)

type Els = Pick<ElementTable, 'Box' | 'Text' | 'Button'>
type Part = { text: string; color?: string }
type Section = { label: string; parts: Part[]; rows: RenderChildren[] }

const RULE = '─'.repeat(200)

// Pieces of one frame row: fixed glyphs keep their width, the rule fills what is left.
const fixed = ({ Box }: Els, node: RenderChildren) => <Box flexShrink={0}>{node}</Box>

const ruleOf = (els: Els, left: string, section: Section | undefined, right: string) => {
  const { Box, Text } = els
  return (
    <Box height={1}>
      {fixed(els, <Text color={C.dim}>{left}</Text>)}
      {section &&
        fixed(
          els,
          <Text>
            <Text bold color={C.muted}>
              {section.label}
            </Text>
            {section.parts.map(p => (
              <Text color={p.color ?? C.dim}> · {p.text}</Text>
            ))}
            <Text> </Text>
          </Text>,
        )}
      <Box flexGrow={1} width={0} height={1} overflow="hidden">
        <Text color={C.dim}>{RULE}</Text>
      </Box>
      {fixed(els, <Text color={C.dim}>{right}</Text>)}
    </Box>
  )
}

// A section's own card: its label set into the top rule, its rows between rails.
const cardOf = (els: Els, section: Section) => {
  const { Box, Text } = els
  const rail = Array.from({ length: section.rows.length }, () => '│').join('\n')
  return (
    <Box flexDirection="column">
      {ruleOf(els, '╭─ ', section, '╮')}
      <Box>
        {fixed(els, <Text color={C.dim}>{rail}</Text>)}
        <Box flexDirection="column" flexGrow={1} width={0} paddingX={1} overflow="hidden">
          {section.rows}
        </Box>
        {fixed(els, <Text color={C.dim}>{rail}</Text>)}
      </Box>
      {ruleOf(els, '╰', undefined, '╯')}
    </Box>
  )
}

const subagentsOf = (els: Els, $: EngineInterface, list: Sub[], viewing: string | undefined, width: number): Section => {
  const { Box, Button, Text } = els
  const running = list.filter(s => !DONE.has(s.status)).length
  const rows = list.map(s => {
    const mark = MARKS[s.status]
    // The spinner steps once per poll, so a running subagent reads as alive without extra redraws.
    const glyph = s.status === 'running' ? (SPINNER[Math.floor(s.seconds / 2) % SPINNER.length] ?? mark.glyph) : mark.glyph
    const isViewed = s.id === viewing
    const time = isViewed ? 'viewing' : duration(s.seconds)
    const indent = s.parentId ? '  ' : ''
    const room = width - indent.length - s.type.length - time.length - 4
    return (
      <Box height={1} justifyContent="space-between">
        <Button key={`agent-${s.id}`} plain onPress={() => $.ui.view({ agentId: s.id })}>
          <Text color={mark.color}>
            {indent}
            {glyph}{' '}
          </Text>
          <Text bold color={isViewed ? C.accent : undefined}>
            {s.type}
          </Text>
          <Text color={C.muted}> {clip(s.description, room)}</Text>
        </Button>
        {fixed(els, <Text color={isViewed ? C.accent : C.dim}>{time}</Text>)}
      </Box>
    )
  })
  return {
    label: 'SUBAGENTS',
    parts: [
      ...(running ? [{ text: `${running} running`, color: C.accent }] : []),
      ...(list.length - running ? [{ text: `${list.length - running} done` }] : []),
    ],
    rows: [
      ...(viewing
        ? [
            <Button key="main" plain onPress={() => $.ui.view({})}>
              <Text color={C.accent}>← back to main</Text>
            </Button>,
          ]
        : []),
      ...rows,
    ],
  }
}

const todosOf = ({ Text }: Els, list: Todo[]): Section => ({
  label: 'TODOS',
  parts: [{ text: `${list.filter(t => t.status === 'completed').length}/${list.length}` }],
  // Unfinished first, so the row cap hides finished ones.
  rows: [...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]).map(t => {
    const mark = MARKS[t.status]
    return (
      <Text wrap="truncate-end">
        <Text color={mark.color}>{mark.glyph} </Text>
        <Text bold={t.status === 'in_progress'} color={t.status === 'completed' ? C.dim : undefined}>
          {t.subject}
        </Text>
      </Text>
    )
  }),
})

const filesOf = (els: Els, $: EngineInterface, list: Touched[], readCount: number, cwd: string, width: number): Section => {
  const { Box, Button, Text } = els
  return {
    label: 'FILES',
    parts: [{ text: `${list.length} changed` }, ...(readCount ? [{ text: `${readCount} read` }] : [])],
    rows: list.map(f => {
      const stats = statText(f.add, f.del)
      const path = relPath(f.path, cwd)
      return (
        <Box height={1} justifyContent="space-between">
          <Button
            key={`file-${f.path}`}
            plain
            onPress={async press => {
              const { isCopied } = await $.ui.copy({ text: path, surface: press.surface })
              if (isCopied) $.ui.toast(`Copied ${path}`)
            }}
          >
            <Text color={f.kind === 'A' ? C.success : C.accent}>{f.kind} </Text>
            <Text>{clip(path, width - stats.length - 3, true)}</Text>
          </Button>
          {fixed(
            els,
            <Text>
              {f.add > 0 && <Text color={C.success}>+{f.add}</Text>}
              {f.add > 0 && f.del > 0 && ' '}
              {f.del > 0 && <Text color={C.error}>-{f.del}</Text>}
            </Text>,
          )}
        </Box>
      )
    }),
  }
}

let cwd = ''
let isSeeded = false
// Subagents leave the engine's list a while after they end; the sidebar keeps their last word.
const refresh = async ($: EngineInterface) => {
  const [now, list, old] = await Promise.all([$.clock.now(), $.agent.list(), read($, subagents)])
  const byId = new Map(old.map(s => [s.id, s]))
  for (const a of list.filter(a => !a.teammateId && a.type !== 'teammate')) {
    const prev = byId.get(a.id)
    const start = prev?.start ?? now
    const end = prev?.end ?? (DONE.has(a.status) ? now : undefined)
    byId.set(a.id, {
      id: a.id,
      parentId: a.parentId,
      type: a.type,
      description: a.description,
      status: a.status,
      start,
      end,
      seconds: Math.round(((end ?? now) - start) / 1000),
    })
  }
  const next = [...byId.values()].slice(-20)
  if (JSON.stringify(next) === JSON.stringify(old)) return
  await update($, subagents, () => next)
}

// Tasks made before this mod loaded are only known to the TaskList tool.
const seed = async ($: EngineInterface) => {
  if (isSeeded) return
  isSeeded = true
  const ran = await $.tool.call({ tool: 'TaskList' }).catch(() => undefined)
  const tasks = ran && 'result' in ran ? (ran.result as BuiltinToolResults['TaskList'] | undefined)?.tasks : undefined
  if (tasks?.length && !(await read($, todos)).length) {
    await update($, todos, () => tasks.map(t => ({ id: t.id, subject: t.subject, status: t.status })))
  }
}

const touch = async ($: EngineInterface, path: string, kind: Touched['kind'], add: number, del: number) => {
  await update($, files, list => {
    const old = list.find(f => f.path === path)
    const merged = old ? { ...old, add: old.add + add, del: old.del + del } : { path, kind, add, del }
    return [merged, ...list.filter(f => f.path !== path)].slice(0, 200)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = await $.session.cwd()
    await $.command.register({ name: 'sidebar', description: 'Show or hide the session cards above the prompt' })
    $.clock.every(POLL_MS, () => void refresh($))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await seed($)
    return next(e)
  })

  on('command.run', { command: 'sidebar' }, async $ => {
    const hidden = await update($, isHidden, was => !was)
    return { text: `Session cards ${hidden ? 'hidden' : 'shown'}.` }
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if ('result' in ran && !ran.isError) {
      await update($, todos, () => e.todos.map(t => ({ id: t.content, subject: t.content, status: t.status })))
    }
    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const task = 'result' in ran && !ran.isError ? ran.result?.task : undefined
    if (task) {
      await update($, todos, list => [
        ...list.filter(t => t.id !== task.id),
        { id: task.id, subject: task.subject, status: 'pending' as const },
      ])
    }
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (!('result' in ran) || ran.isError || !ran.result?.success) return ran
    const { taskId, subject, status } = e
    const kept = status === 'deleted' ? undefined : status
    await update($, todos, list =>
      status === 'deleted'
        ? list.filter(t => t.id !== taskId)
        : list.map(t => (t.id === taskId ? { ...t, subject: subject ?? t.subject, status: kept ?? t.status } : t)),
    )
    return ran
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if ('result' in ran && !ran.isError && ran.result) {
      const { add, del } = statsOf(ran.result.structuredPatch)
      await touch($, ran.result.filePath, 'M', add, del)
    }
    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if ('result' in ran && !ran.isError && ran.result) {
      const isNew = ran.result.type === 'create'
      const { add, del } = isNew ? { add: e.content.replace(/\s+$/, '').split('\n').length, del: 0 } : statsOf(ran.result.structuredPatch)
      await touch($, ran.result.filePath, isNew ? 'A' : 'M', add, del)
    }
    return ran
  })

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    if ('result' in ran && !ran.isError) await touch($, e.notebook_path, 'M', 0, 0)
    return ran
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const ran = await next(e)
    if ('result' in ran && !ran.isError) {
      await update($, reads, list => (list.includes(e.file_path) ? list : [...list, e.file_path].slice(-500)))
    }
    return ran
  })

  // Cards side by side above the prompt, right-aligned, one for each section that has something.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey || (await read($, isHidden))) return rest
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const [subs, list, touched, seen] = await Promise.all([read($, subagents), read($, todos), read($, files), read($, reads)])
    const viewing = e.props.view.agentId
    const count = (subs.length || viewing ? 1 : 0) + (list.length ? 1 : 0) + (touched.length ? 1 : 0)
    if (!count) return rest
    const width = Math.min(CARD_WIDTH, Math.floor((e.props.bodyColumns - (count - 1)) / count))
    // A card's rails and padding take four of its columns.
    const inner = width - 4
    const sections = [
      ...(subs.length || viewing ? [subagentsOf(els, $, subs, viewing, inner)] : []),
      ...(list.length ? [todosOf(els, list)] : []),
      ...(touched.length ? [filesOf(els, $, touched, seen.length, cwd, inner)] : []),
    ].map(section => {
      const extra = section.rows.length - MAX_ROWS
      return extra > 0 ? { ...section, rows: [...section.rows.slice(0, MAX_ROWS - 1), <Text color={C.dim}>… {extra + 1} more</Text>] } : section
    })
    return (
      <Box flexDirection="column">
        <Box justifyContent="flex-end" gap={1}>
          {sections.map(section => (
            <Box width={width} flexShrink={0}>
              {cardOf(els, section)}
            </Box>
          ))}
        </Box>
        {rest}
      </Box>
    )
  })
}
