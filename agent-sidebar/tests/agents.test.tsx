import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { age, groupOf } from '../hooks/style'

const NOW = 1_800_000_000_000
const FLEET = [
  { id: 'a1', kind: 'background', name: 'Django rebuild', state: 'working', status: 'busy', cwd: '/home/me/work/app/.claude/worktrees/rebuild', startedAt: NOW - 9 * 60_000, sessionId: 's-a1' },
  { id: 'a2', kind: 'background', name: 'whatsapp template', state: 'blocked', cwd: '/home/me/work/app', startedAt: NOW - 2 * 86_400_000, sessionId: 's-a2' },
  { id: 'a3', kind: 'background', name: 'shared-db review', state: 'done', status: 'idle', cwd: '/home/me/work/app', startedAt: NOW - 4 * 3_600_000, sessionId: 's-a3' },
  { id: 'me', kind: 'background', name: 'this one', state: 'working', cwd: '/home/me/work/app', startedAt: NOW - 60_000, sessionId: 's-me' },
  { id: 'i1', kind: 'interactive', status: 'idle', cwd: '/home/me', startedAt: NOW, sessionId: 's-i1' },
  ...Array.from({ length: 6 }, (_, n) => ({ id: `d${n}`, kind: 'background', name: `old job ${n}`, state: 'done', cwd: '/home/me/work/app', startedAt: NOW - (5 + n) * 3_600_000, sessionId: `s-d${n}` })),
  { kind: 'background', name: 'no short id', state: 'working', cwd: '/home/me/work/app', startedAt: NOW - 30_000, sessionId: 'abcdef12-3456' },
]

const PANE = {
  component: 'Pane',
  requestId: 'agents',
  props: { title: 'Agents', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const textOf = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

const stubs = (on: On, ran: (readonly string[])[], commands: string[]) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's-me' }))
  on('session.cwd', () => ({ value: '/home/me/work/app' }))
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [{ id: 'agents', title: 'Agents', isShown: true, isFocused: false, isPlaced: true }] }))
  on('process.run', ($, e) => {
    ran.push(e.argv)
    return { value: { exitCode: 0, stdout: JSON.stringify(FLEET), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.run', ($, e) => {
    commands.push(e.command)
    return { text: '' }
  })
}

test('background agents fill cards by state; the interactive session is left out', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const ran: (readonly string[])[] = []
  stubs(on, ran, [])
  await $.session.start({ cwd: '/home/me/work/app', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(ran[0]).toEqual(['claude', 'agents', '--json'])
  const ui = await $.ui.mount({ plugin: 'agent-sidebar', surface: 'terminal', ...PANE })
  const text = await textOf(ui)
  expect(text).toContain('WORKING')
  expect(text).toContain('NEEDS INPUT')
  expect(text).toContain('DONE')
  expect(text).toContain('Django rebuild')
  expect(text).toContain('worktrees/rebuild')
  expect(text).not.toContain('~/work/app\n')
  expect(text).toContain('9m')
  expect(text).toContain('2d')
  expect(text).toContain('here')
  expect(text).not.toContain('i1')
  expect(text.indexOf('WORKING')).toBeLessThan(text.indexOf('NEEDS INPUT'))
  expect(text.indexOf('NEEDS INPUT')).toBeLessThan(text.indexOf('DONE'))
  expect(text).toContain('DONE · 7')
  expect(text).toContain('… 2 more')
  expect(text).not.toContain('old job 5')
  expect(await ui.find({ key: 'agent-abcdef12' })).toBeDefined()
  await ui.unmount()
})

test('a click on an agent, or on the agent view button, opens the agent view', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const commands: string[] = []
  stubs(on, [], commands)
  await $.session.start({ cwd: '/home/me/work/app', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'agent-sidebar', surface: 'terminal', ...PANE })
  await ui.press({ key: 'agent-a2' })
  await ui.press({ key: 'agent-view' })
  await clock.advance(1)
  await clock.settle()
  expect(commands.filter(c => c === 'background')).toHaveLength(2)
  await ui.unmount()
})

test('states and ages read like the agent view', () => {
  expect(groupOf('working')).toBe('working')
  expect(groupOf('blocked')).toBe('blocked')
  expect(groupOf('something-new')).toBe('idle')
  expect(age(42_000)).toBe('42s')
  expect(age(5 * 3_600_000)).toBe('5h')
  expect(age(3 * 86_400_000)).toBe('3d')
})
