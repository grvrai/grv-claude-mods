import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'session',
  props: {
    title: 'Session',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const textOf = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

test('edits, writes and reads fill the FILES section', async ($, on) => {
  on('tool.call', { tool: 'Edit' }, () => ({
    result: { filePath: '/repo/app/views.py', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-a', '+b', '+c'] }] },
  }))
  on('tool.call', { tool: 'Write' }, () => ({ result: { type: 'create', filePath: '/repo/app/new.py', structuredPatch: [] } }))
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: '/repo/a.py', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }))
  await $.tool.call({ tool: 'Edit', file_path: '/repo/app/views.py', old_string: 'a', new_string: 'b\nc' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/app/new.py', content: 'x\ny' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.py' })
  const ui = await $.ui.mount({ plugin: 'session-sidebar', surface: 'terminal', ...PANE })
  const text = await textOf(ui)
  expect(text).toContain('2 changed')
  expect(text).toContain('1 read')
  expect(text).toContain('views.py')
  expect(text).toContain('+2')
  expect(text).toContain('-1')
  expect(text).toContain('new.py')
  expect(text).toContain('A ')
  await ui.unmount()
})

test('TaskCreate and TaskUpdate drive the TODOS section', async ($, on) => {
  on('tool.call', { tool: 'TaskCreate' }, ($, e) => ({ result: { task: { id: '1', subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, ($, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  await $.tool.call({ tool: 'TaskCreate', subject: 'Build fold-tools', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  const ui = await $.ui.mount({ plugin: 'session-sidebar', surface: 'terminal', ...PANE })
  const text = await textOf(ui)
  expect(text).toContain('1/1')
  expect(text).toContain('Build fold-tools')
  expect(text).toContain('✔')
  await ui.unmount()
})

test('subagents are listed and a click puts one in view', async ($, on) => {
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
  const ui = await $.ui.mount({ plugin: 'session-sidebar', surface: 'terminal', ...PANE })
  const text = await textOf(ui)
  expect(text).toContain('1 running')
  expect(text).toContain('Explore')
  await ui.press({ key: 'agent-a1' })
  expect(viewed).toEqual([{ agentId: 'a1' }])
  await ui.unmount()
})

test('the sidebar opens only once there is something to show', async ($, on) => {
  const opened: string[] = []
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: { filePath: '/repo/a.py', structuredPatch: [] } }))
  const band = await $.ui.mount({
    plugin: 'session-sidebar',
    surface: 'terminal',
    component: 'AbovePrompt',
    viewport: { columns: 170, rows: 50, isFullscreen: true },
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(opened).toEqual([])
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.py', old_string: 'a', new_string: 'b' })
  expect(opened).toEqual(['session'])
  await band.unmount()
  const ui = await $.ui.mount({ plugin: 'session-sidebar', surface: 'terminal', ...PANE })
  const text = await textOf(ui)
  expect(text).toContain('FILES')
  expect(text).not.toContain('TODOS')
  expect(text).not.toContain('SUBAGENTS')
  await ui.unmount()
})
