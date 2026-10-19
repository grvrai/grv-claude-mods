import type { PromptComposeInput } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { cardOf, diffRows, groupSummary } from '../hooks/cards'

const PATCH = [{ oldStart: 3, oldLines: 2, newStart: 3, newLines: 3, lines: [' keep', '-old value', '+new value', '+more'] }]
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } } as const
const STATUS = { isRunning: false, isErrored: false, isInterrupted: false }
const VIEW = { columns: 100, rows: 40 }

const toolUse = (id: string, tool: string, input: unknown, output: unknown) =>
  ({
    component: 'ToolUse',
    requestId: id,
    viewport: VIEW,
    props: { tool_use_id: id, tool, input, output, ...STATUS },
  }) as const

const edit = (id: string) =>
  toolUse(id, 'Edit', { file_path: '/repo/app/views.py', old_string: 'old value', new_string: 'new value\nmore' }, {
    filePath: '/repo/app/views.py',
    structuredPatch: PATCH,
  })

const textOf = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

test('an edit card shows its badge and unfolds to an oh-my-pi diff on click', async $ => {
  const ui = await $.ui.mount({ plugin: 'fold-tools', surface: 'terminal', ...edit('t1') })
  const head = (await ui.find({ key: 'fold-t1' }))?.text ?? ''
  expect(head).toContain('✎ Edit: /repo/app/views.py')
  expect(head).toContain('⟦+2/-1⟧')
  expect(await textOf(ui)).not.toContain('│')
  await ui.press({ key: 'fold-t1' })
  const open = await textOf(ui)
  expect(open).toContain('-  4│old value')
  expect(open).toContain('+   │new value')
  expect(open).toContain('+  5│more')
  await ui.press({ key: 'fold-t1' })
  expect(await textOf(ui)).not.toContain('│')
  await ui.unmount()
})

test('/fold open unfolds every card and /fold close folds them again', async $ => {
  const ui = await $.ui.mount({ plugin: 'fold-tools', surface: 'terminal', ...edit('t2') })
  await $.command.run({ command: 'fold', args: 'open', ...RUN })
  await ui.redraw()
  expect(await textOf(ui)).toContain('│')
  await $.command.run({ command: 'fold', args: 'close', ...RUN })
  await ui.redraw()
  expect(await textOf(ui)).not.toContain('│')
  await ui.unmount()
})

test('bash shows the last 10 lines and ⟦show all⟧ lifts the cap', async $ => {
  const stdout = Array.from({ length: 30 }, (_, n) => `line ${n + 1}`).join('\n')
  const ui = await $.ui.mount({
    plugin: 'fold-tools',
    surface: 'terminal',
    ...toolUse('t3', 'Bash', { command: 'seq 30' }, { stdout, stderr: '', interrupted: false }),
  })
  expect((await ui.find({ key: 'fold-t3' }))?.text).toContain('❯ Bash: seq 30  30 lines')
  await ui.press({ key: 'fold-t3' })
  let text = await textOf(ui)
  expect(text).toContain('line 30')
  expect(text).not.toContain('line 20\n')
  expect(text).toContain('… 20 more earlier lines')
  await ui.press({ key: 'all' })
  text = await textOf(ui)
  expect(text).toContain('line 1\n')
  expect(text).toContain('⟦show less⟧')
  await ui.unmount()
})

test('an owned tool hides the engine result block', async $ => {
  const ui = await $.ui.mount({
    plugin: 'fold-tools',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 't4',
    props: { tool_use_id: 't4', tool: 'Bash', output: { stdout: 'hi', stderr: '', interrupted: false }, isErrored: false },
  })
  expect(await ui.find({ type: 'Text' })).toBeUndefined()
  await ui.unmount()
})

test('a group folds to one line and unfolds into branches', async $ => {
  const read = (id: string, path: string) => ({
    tool_use_id: id,
    tool: 'Read',
    input: { file_path: path },
    output: { type: 'text', file: { filePath: path, content: 'x', numLines: 1, startLine: 1, totalLines: 1 } },
    ...STATUS,
  })
  const ui = await $.ui.mount({
    plugin: 'fold-tools',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'g1',
    viewport: VIEW,
    props: { calls: [read('r1', '/a.py'), read('r2', '/b.py')], isActive: false, isExpanded: false },
  })
  expect((await ui.find({ key: 'fold-group' }))?.text).toBe('• Read 2 files')
  await ui.press({ key: 'fold-group' })
  expect((await ui.find({ key: 'fold-r1' }))?.text).toContain('├─ ● Read: /a.py')
  expect((await ui.find({ key: 'fold-r2' }))?.text).toContain('└─ ● Read: /b.py')
  await ui.unmount()
})

test('a » line is drawn as the intent heading and the rest is left to the engine', async ($, on) => {
  const seen: string[] = []
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    seen.push(e.props.text)
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'fold-tools',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'Found it.\n» Reading model role settings', isFirstOfReply: true },
  })
  expect(seen).toEqual(['Found it.'])
  const heads = await ui.findAll({ type: 'Text', text: 'Reading model role settings' })
  expect(heads.some(t => t.props.bold === true)).toBe(true)
  await ui.unmount()
})

test('the intent instruction is appended to the system prompt once', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'You are Claude.', scope: 'shared' as const }] }))
  const { sections } = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], traits: [], outputStyle: null } as unknown as PromptComposeInput)
  expect(sections.map(s => s.id)).toEqual(['base', 'fold-tools:intent'])
  expect(sections[1]?.text).toContain('present-participle intent')
})

test('cards and diff rows summarise each tool', () => {
  const bash = cardOf('Bash', { command: 'ls -la\necho' }, { stdout: 'a\nb\nc', stderr: '', interrupted: false }, '/repo')
  expect(bash.target).toBe('ls -la')
  expect(bash.meta).toEqual(['3 lines'])
  const read = cardOf('Read', { file_path: '/repo/a.py' }, { type: 'text', file: { filePath: '/repo/a.py', content: 'x', numLines: 10, startLine: 5, totalLines: 90 } }, '/repo')
  expect(read.target).toBe('a.py:5-14')
  const failed = cardOf('Bash', { command: 'false' }, 'Exit code 1', '/repo')
  expect(failed.body).toMatchObject({ kind: 'text', isError: true })
  const rows = diffRows(PATCH)
  expect(rows.map(r => `${r.kind}${r.num}`)).toEqual(['ctx3', 'del4', 'add4', 'add5'])
  expect(rows[1]?.mark).toBeUndefined()
  const pair = diffRows([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-const a = 1', '+const a = 2'] }])
  expect(pair[0]?.mark).toEqual([10, 11])
  expect(groupSummary([{ tool: 'Read' }, { tool: 'Read' }, { tool: 'Grep' }])).toBe('Read 2 files · searched 1 pattern')
})
