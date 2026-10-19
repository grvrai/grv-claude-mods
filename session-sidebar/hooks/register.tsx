import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, ElementTable, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Sub, Todo, Touched } from '../types'
import { C, clip, DONE, duration, MARKS, relPath, SPINNER, statsOf, statText } from './style'

const PANE = 'session'
const POLL_MS = 2000
// Thin by default; a width the person drags the dock to wins.
const COLUMNS = 34

const subagents = atom({ plugin: 'session-sidebar', key: 'subagents' } as const, [])
const todos = atom({ plugin: 'session-sidebar', key: 'todos' } as const, [])
const files = atom({ plugin: 'session-sidebar', key: 'files' } as const, [])
const reads = atom({ plugin: 'session-sidebar', key: 'reads' } as const, [])

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
  rows: list.map(t => {
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
// Where the terminal docks panes; the sidebar never opens as a takeover.
let isFullscreen = false
// The person closed it (✕ or /sidebar): it stays shut until /sidebar opens it.
let isDismissed = false
// The person opened it with /sidebar: it stays even while empty.
let isPinned = false

// Shown only while it has something to show: subagents, todos or changed files.
const syncPane = async ($: EngineInterface) => {
  if (!isFullscreen || isDismissed || isPinned) return
  const [subs, list, touched, panes] = await Promise.all([read($, subagents), read($, todos), read($, files), $.ui.panes()])
  const hasContent = subs.length + list.length + touched.length > 0
  const isOpen = panes.some(p => p.id === PANE)
  if (hasContent && !isOpen) await $.ui.open({ id: PANE, title: 'Session', columns: COLUMNS })
  if (!hasContent && isOpen) await $.ui.close({ id: PANE })
}

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
  await syncPane($)
}

// Tasks made before this mod loaded are only known to the TaskList tool.
const seed = async ($: EngineInterface) => {
  if (isSeeded) return
  isSeeded = true
  const ran = await $.tool.call({ tool: 'TaskList' }).catch(() => undefined)
  const tasks = ran && 'result' in ran ? (ran.result as BuiltinToolResults['TaskList'] | undefined)?.tasks : undefined
  if (tasks?.length && !(await read($, todos)).length) {
    await update($, todos, () => tasks.map(t => ({ id: t.id, subject: t.subject, status: t.status })))
    await syncPane($)
  }
}

const touch = async ($: EngineInterface, path: string, kind: Touched['kind'], add: number, del: number) => {
  await update($, files, list => {
    const old = list.find(f => f.path === path)
    const merged = old ? { ...old, add: old.add + add, del: old.del + del } : { path, kind, add, del }
    return [merged, ...list.filter(f => f.path !== path)].slice(0, 200)
  })
  await syncPane($)
}

export const register: Register = on => {
  let isSynced = false

  on('session.start', async ($, e, next) => {
    cwd = await $.session.cwd()
    await $.command.register({ name: 'sidebar', description: 'Show or hide the session sidebar' })
    $.clock.every(POLL_MS, () => void refresh($))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await seed($)
    return next(e)
  })

  on('command.run', { command: 'sidebar' }, async $ => {
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    isPinned = !isOpen
    isDismissed = isOpen
    if (isOpen) await $.ui.close({ id: PANE })
    else await $.ui.open({ id: PANE, title: 'Session', columns: COLUMNS })
    return { text: `Sidebar ${isOpen ? 'hidden' : 'shown'}.` }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      isDismissed = true
      isPinned = false
    }
    return next(e)
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if ('result' in ran && !ran.isError) {
      await update($, todos, () => e.todos.map(t => ({ id: t.content, subject: t.content, status: t.status })))
      await syncPane($)
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
      await syncPane($)
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
    await syncPane($)
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

  // The band is drawn early and says whether the terminal docks panes.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    isFullscreen = e.viewport?.isFullscreen === true
    if (isFullscreen && !isSynced) {
      isSynced = true
      void syncPane($)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const [subs, list, touched, seen] = await Promise.all([read($, subagents), read($, todos), read($, files), read($, reads)])
    // The card's rails and padding take four columns of the pane.
    const width = e.props.bodyColumns - 4
    const viewing = e.props.view.agentId
    const sections = [
      ...(subs.length || viewing ? [subagentsOf(els, $, subs, viewing, width)] : []),
      ...(list.length ? [todosOf(els, list)] : []),
      ...(touched.length ? [filesOf(els, $, touched, seen.length, cwd, width)] : []),
    ]
    return sections.length ? (
      <Box flexDirection="column" gap={1}>
        {sections.map(section => cardOf(els, section))}
      </Box>
    ) : (
      <Box>
        <Text color={C.dim} italic>
          Subagents, todos and changed files show here.
        </Text>
      </Box>
    )
  })
}
