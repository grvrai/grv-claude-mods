import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Fleet } from '../types'
import { age, C, clip, GROUPS, groupOf, homePath, SPINNER } from './style'
import type { GroupKey } from './style'

const PANE = 'agents'
// Polled often while the tab is open, rarely while it is not (only to know when to open it).
const POLL_MS = 5000
const IDLE_POLL_MS = 30000
// As thin as the session sidebar; a width the person drags the dock to wins.
const COLUMNS = 34
// Finished agents pile up; the newest few stay, the rest are counted.
const DONE_SHOWN = 5
const RULE = '─'.repeat(200)

const agents = atom({ plugin: 'agent-sidebar', key: 'agents' } as const, [])
const polledAt = atom({ plugin: 'agent-sidebar', key: 'polledAt' } as const, 0)

type Els = Pick<ElementTable, 'Box' | 'Text' | 'Button'>
type Section = { key: GroupKey; count: number; rows: RenderChildren[] }
type Raw = { id: string; name?: string; kind?: string; state?: string; status?: string; cwd?: string; startedAt?: number; sessionId?: string }

let sessionId = ''
let cwd = ''
let home = ''
let lastPoll = 0
// Where the terminal docks panes; the tab never opens as a takeover.
let isFullscreen = false
// The tab opens by itself once per session; closing it by hand keeps it shut until /fleet.
let hasOpened = false
let isDismissed = false

const fixed = ({ Box }: Els, node: RenderChildren) => <Box flexShrink={0}>{node}</Box>

const ruleOf = (els: Els, left: string, section: Section | undefined, right: string) => {
  const { Box, Text } = els
  const group = section && GROUPS[section.key]
  return (
    <Box height={1}>
      {fixed(els, <Text color={C.dim}>{left}</Text>)}
      {group &&
        fixed(
          els,
          <Text>
            <Text bold color={C.muted}>
              {group.label}
            </Text>
            <Text color={C.dim}> · {section.count} </Text>
          </Text>,
        )}
      <Box flexGrow={1} width={0} height={1} overflow="hidden">
        <Text color={C.dim}>{RULE}</Text>
      </Box>
      {fixed(els, <Text color={C.dim}>{right}</Text>)}
    </Box>
  )
}

// A state's own card, as the session sidebar draws its sections: the label in the top rule, its agents between rails.
const cardOf = (els: Els, section: Section, height: number) => {
  const { Box, Text } = els
  const rail = Array.from({ length: height }, () => '│').join('\n')
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

// Mods cannot attach the terminal to another session, so a click opens the agent view, where Enter does.
const openAgentView = ($: EngineInterface) => {
  $.clock.after(0, () => {
    void $.command.run({ command: 'background' }).catch((err: Error) => $.ui.toast(`Could not open the agent view: ${err.message}`))
  })
}

const listAgents = async ($: EngineInterface) => {
  const run = (bin: string) => $.process.run([bin, 'agents', '--json'], { timeoutMs: 10000 })
  const ran = await run('claude').catch(() => run(`${home}/.local/bin/claude`)).catch(() => undefined)
  if (!ran || ran.exitCode !== 0) return undefined
  try {
    return JSON.parse(ran.stdout) as Raw[]
  } catch {
    return undefined
  }
}

const syncPane = async ($: EngineInterface, list: Fleet[]) => {
  if (!isFullscreen || hasOpened || isDismissed || !list.some(a => !a.isHere)) return
  hasOpened = true
  await $.ui.open({ id: PANE, title: 'Agents', columns: COLUMNS })
}

const refresh = async ($: EngineInterface) => {
  const [now, panes] = await Promise.all([$.clock.now(), $.ui.panes()])
  if (!panes.some(p => p.id === PANE) && now - lastPoll < IDLE_POLL_MS) return
  lastPoll = now
  const raw = await listAgents($)
  if (!raw) return
  const list = raw
    .filter(a => a.kind === 'background' && (a.id || a.sessionId))
    .map(a => ({
      id: a.id || (a.sessionId ?? '').slice(0, 8),
      name: a.name || a.id,
      state: a.state ?? a.status ?? 'idle',
      cwd: a.cwd ?? '',
      startedAt: a.startedAt ?? now,
      isHere: a.sessionId === sessionId,
    }))
    .sort((a, b) => b.startedAt - a.startedAt)
  if (JSON.stringify(list) !== JSON.stringify(await read($, agents))) await update($, agents, () => list)
  await update($, polledAt, () => now)
  await syncPane($, list)
}

const rowOf = (els: Els, $: EngineInterface, a: Fleet, frame: number, now: number, width: number) => {
  const { Box, Button, Text } = els
  const group = GROUPS[groupOf(a.state)]
  const glyph = groupOf(a.state) === 'working' ? (SPINNER[frame % SPINNER.length] ?? group.glyph) : group.glyph
  const when = a.isHere ? 'here' : age(now - a.startedAt)
  const where = a.cwd && a.cwd !== cwd ? homePath(a.cwd, home) : ''
  return (
    <Box flexDirection="column">
      <Box height={1} justifyContent="space-between">
        <Button key={`agent-${a.id}`} plain onPress={() => openAgentView($)}>
          <Text color={group.color}>{glyph} </Text>
          <Text bold={a.isHere} color={a.isHere ? C.accent : undefined}>
            {clip(a.name, width - when.length - 3)}
          </Text>
        </Button>
        {fixed(els, <Text color={a.isHere ? C.accent : C.dim}>{when}</Text>)}
      </Box>
      {where && <Text color={C.dim}>  {clip(where, width - 2, true)}</Text>}
    </Box>
  )
}

export const register: Register = on => {
  let isSynced = false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    ;[sessionId, cwd, home] = await Promise.all([$.session.id(), $.session.cwd(), $.env.get('HOME').then(h => h ?? '')])
    await $.command.register({ name: 'fleet', description: 'Show or hide the Agents tab of background agents' })
    $.clock.every(POLL_MS, () => void refresh($))
    void refresh($)
    return started
  })

  on('command.run', { command: 'fleet' }, async $ => {
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    isDismissed = isOpen
    if (isOpen) await $.ui.close({ id: PANE })
    else {
      await $.ui.open({ id: PANE, title: 'Agents', columns: COLUMNS })
      lastPoll = 0
      void refresh($)
    }
    return { text: `Agents tab ${isOpen ? 'hidden' : 'shown'}.` }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') isDismissed = true
    return next(e)
  })

  // The band is drawn early and says whether the terminal docks panes.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    isFullscreen = e.viewport?.isFullscreen === true
    if (isFullscreen && !isSynced) {
      isSynced = true
      void read($, agents).then(list => syncPane($, list))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const [list, at] = await Promise.all([read($, agents), read($, polledAt)])
    // The card's rails and padding take four columns of the pane.
    const width = e.props.bodyColumns - 4
    const frame = Math.floor(at / POLL_MS)
    const sections = (Object.keys(GROUPS) as GroupKey[]).flatMap(key => {
      const all = list.filter(a => groupOf(a.state) === key)
      if (!all.length) return []
      const members = key === 'done' ? all.slice(0, DONE_SHOWN) : all
      const more = all.length - members.length
      const rows = [
        ...members.map(a => rowOf(els, $, a, frame, at, width)),
        ...(more ? [<Text color={C.dim}>… {more} more</Text>] : []),
      ]
      const height = members.reduce((n, a) => n + (a.cwd && a.cwd !== cwd ? 2 : 1), more ? 1 : 0)
      return [{ section: { key, count: all.length, rows }, height }]
    })
    return (
      <Box flexDirection="column" gap={1}>
        <Button key="agent-view" plain onPress={() => openAgentView($)}>
          <Text color={C.dim}>⟦</Text>
          <Text color={C.accent}>☰ agent view</Text>
          <Text color={C.dim}>⟧</Text>
        </Button>
        {sections.length ? (
          sections.map(({ section, height }) => cardOf(els, section, height))
        ) : (
          <Text color={C.dim} italic>
            No background agents running.
          </Text>
        )}
      </Box>
    )
  })
}
