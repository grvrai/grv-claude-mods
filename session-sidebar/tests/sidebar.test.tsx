import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

const textOf = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

// The engine's own band draws nothing here, as at an idle prompt.
const emptyBand = (on: On) =>
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

test('edits, writes and reads fill a FILES card above the prompt', async ($, on) => {
  emptyBand(on)
  on('tool.call', { tool: 'Edit' }, () => ({
    result: { filePath: '/repo/app/views.py', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-a', '+b', '+c'] }] },
  }))
  on('tool.call', { tool: 'Write' }, () => ({ result: { type: 'create', filePath: '/repo/app/new.py', structuredPatch: [] } }))
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: '/repo/a.py', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }))
  await $.tool.call({ tool: 'Edit', file_path: '/repo/app/views.py', old_string: 'a', new_string: 'b\nc' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/app/new.py', content: 'x\ny' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.py' })
  const ui = await $.ui.mount({ plugin: 'session-sidebar', surface: 'terminal', ...BAND })
  const text = await textOf(ui)
  expect(text).toContain('FILES')
  expect(text).toContain('2 changed')
  expect(text).toContain('1 read')
  expect(text).toContain('views.py')
  expect(text).toContain('+2')
  expect(text).toContain('-1')
  expect(text).not.toContain('TODOS')
  expect(text).not.toContain('SUBAGENTS')
  await ui.unmount()
})

test('TaskCreate and TaskUpdate drive a TODOS card, unfinished first', async ($, on) => {
  emptyBand(on)
  let next = 0
  on('tool.call', { tool: 'TaskCreate' }, ($, e) => ({ result: { task: { id: String(++next), subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, ($, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  await $.tool.call({ tool: 'TaskCreate', subject: 'Build the bar', description: '' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Style the cards', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  const ui = await $.ui.mount({ plugin: 'session-sidebar', surface: 'terminal', ...BAND })
  const text = await textOf(ui)
  expect(text).toContain('1/2')
  expect(text.indexOf('Style the cards')).toBeLessThan(text.indexOf('Build the bar'))
  await ui.unmount()
})

test('subagents get a card, and a click puts one in view', async ($, on) => {
  emptyBand(on)
  const clock = mock.clock(on, { now: 1_000 })
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'audit models', type: 'Explore', status: 'running' as const }] }))
  const viewed: unknown[] = []
  on('ui.view', ($, e) => {
    viewed.push(e)
    return { value: {} }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(2_000)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'session-sidebar', surface: 'terminal', ...BAND })
  const text = await textOf(ui)
  expect(text).toContain('1 running')
  expect(text).toContain('Explore')
  await ui.press({ key: 'agent-a1' })
  expect(viewed).toEqual([{ agentId: 'a1' }])
  await ui.unmount()
})

test('nothing shows while empty, /sidebar hides the cards, long lists are capped', async ($, on) => {
  emptyBand(on)
  on('tool.call', { tool: 'Edit' }, ($, e) => ({ result: { filePath: e.file_path, structuredPatch: [] } }))
  const empty = await $.ui.mount({ plugin: 'session-sidebar', surface: 'terminal', ...BAND })
  expect(await empty.find({ type: 'Text' })).toBeUndefined()
  await empty.unmount()
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) await $.tool.call({ tool: 'Edit', file_path: `/repo/f${n}.py`, old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ plugin: 'session-sidebar', surface: 'terminal', ...BAND })
  expect(await textOf(ui)).toContain('… 3 more')
  await $.command.run({ command: 'sidebar', args: '', ...RUN })
  await ui.redraw()
  expect(await ui.find({ type: 'Text' })).toBeUndefined()
  await ui.unmount()
})
