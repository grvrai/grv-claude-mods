import type { PromptComposeInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { cardOf, diffRows, groupSummary } from '../hooks/cards'

const PATCH = [{ oldStart: 3, oldLines: 2, newStart: 3, newLines: 3, lines: [' keep', '-old value', '+new value', '+more'] }]
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } } as const
const STATUS = { isRunning: false, isErrored: false, isInterrupted: false }
const VIEW = { columns: 100, rows: 40 }
const SEQ = Array.from({ length: 30 }, (_, n) => `line ${n + 1}`).join('\n')

const toolUse = (id: string, tool: string, input: unknown, output: unknown) =>
  ({
    component: 'ToolUse',
    requestId: id,
    viewport: VIEW,
    props: { tool_use_id: id, tool, input, output, ...STATUS },
  }) as const

const bash = (id: string) => toolUse(id, 'Bash', { command: 'seq 30', description: 'Count to thirty' }, { stdout: SEQ, stderr: '', interrupted: false })

const read = (id: string, path: string) => ({
  tool_use_id: id,
  tool: 'Read',
  input: { file_path: path },
  output: { type: 'text', file: { filePath: path, content: 'x', numLines: 1, startLine: 1, totalLines: 1 } },
  ...STATUS,
})

const group = (calls: ReturnType<typeof read>[]) =>
  ({ component: 'ToolGroup', requestId: 'g1', viewport: VIEW, props: { calls, isActive: false, isExpanded: false } }) as const

const textOf = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

test('a folded edit is its title line alone and unfolds into a diff on a rail', async $ => {
  const ui = await $.ui.mount({
    plugin: 'fold-tools',
    surface: 'terminal',
    ...toolUse('t1', 'Edit', { file_path: '/repo/app/views.py', old_string: 'old value', new_string: 'new value\nmore' }, {
      filePath: '/repo/app/views.py',
      structuredPatch: PATCH,
    }),
  })
  let text = await textOf(ui)
  expect((await ui.find({ key: 'fold-t1' }))?.text).toBe('✎ Edit: ')
  expect(text).toContain('/repo/app/views.py')
  expect(text).toContain('+2')
  expect(text).not.toContain('│')
  await ui.press({ key: 'fold-t1' })
  text = await textOf(ui)
  expect(text).toContain('└ ')
  expect(text).toContain('-  4│old value')
  expect(text).toContain('+   │new value')
  expect((await ui.find({ key: 'more-t1' }))?.text).toContain('⟦collapse⟧')
  await ui.press({ key: 'more-t1' })
  expect(await textOf(ui)).not.toContain('│')
  await ui.unmount()
})

test('a bash card unfolds to its tail, then ⟦show all⟧, then ⟦collapse⟧ back to its title', async $ => {
  const ui = await $.ui.mount({ plugin: 'fold-tools', surface: 'terminal', ...bash('t2') })
  expect((await ui.find({ key: 'fold-t2' }))?.text).toBe('❯ Bash: ')
  expect(await textOf(ui)).not.toContain('line 30')
  await ui.press({ key: 'fold-t2' })
  let text = await textOf(ui)
  expect(text).toContain('$ ')
  expect(text).toContain('Output')
  expect(text).toContain('line 21')
  expect(text).not.toContain('line 20\n')
  expect((await ui.find({ key: 'more-t2' }))?.text).toBe('… 20 more earlier lines ⟦show all⟧')
  await ui.press({ key: 'more-t2' })
  expect(await textOf(ui)).toContain('line 1\n')
  expect((await ui.find({ key: 'more-t2' }))?.text).toContain('⟦collapse⟧')
  await ui.press({ key: 'more-t2' })
  expect(await textOf(ui)).not.toContain('line 30')
  await ui.unmount()
})

test('/fold open unfolds every card and /fold close folds them again', async $ => {
  const ui = await $.ui.mount({ plugin: 'fold-tools', surface: 'terminal', ...bash('t3') })
  await $.command.run({ command: 'fold', args: 'open', ...RUN })
  await ui.redraw()
  expect(await textOf(ui)).toContain('line 21')
  await $.command.run({ command: 'fold', args: 'close', ...RUN })
  await ui.redraw()
  expect(await textOf(ui)).not.toContain('line 21')
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

test('a group of several calls shows its branches until clicked', async $ => {
  const ui = await $.ui.mount({ plugin: 'fold-tools', surface: 'terminal', ...group([read('r1', '/a.py'), read('r2', '/b.py')]) })
  expect((await ui.find({ key: 'fold-group' }))?.text).toBe('• Read 2 files')
  let text = await textOf(ui)
  expect(text).toContain('├─ ')
  expect(text).toContain('/a.py')
  expect(text).toContain('└─ ')
  await ui.press({ key: 'fold-group' })
  text = await textOf(ui)
  expect(text).not.toContain('/a.py')
  await ui.unmount()
})

test('a group of one call draws that call as its own card', async $ => {
  const ui = await $.ui.mount({ plugin: 'fold-tools', surface: 'terminal', ...group([read('r3', '/c.py')]) })
  expect(await ui.find({ key: 'fold-group' })).toBeUndefined()
  expect((await ui.find({ key: 'fold-r3' }))?.text).toBe('● Read: ')
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
  const input = { model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], traits: [], outputStyle: null }
  const { sections } = await $.prompt.compose(input as unknown as PromptComposeInput)
  expect(sections.map(s => s.id)).toEqual(['base', 'fold-tools:intent'])
  expect(sections[1]?.text).toContain('present-participle intent')
})

test('cards and diff rows summarise each tool', () => {
  const ok = cardOf('Bash', { command: 'ls -la\necho', description: 'List files' }, { stdout: 'a\nb\nc', stderr: '', interrupted: false }, '/repo')
  expect(ok.target).toBe('List files')
  expect(ok.meta).toEqual(['3 lines'])
  const failed = cardOf('Bash', { command: 'false' }, 'Exit code 1', '/repo')
  expect(failed.body).toMatchObject({ kind: 'shell', command: 'false', output: ['Exit code 1'], isError: true })
  const file = cardOf('Read', { file_path: '/repo/a.py' }, { type: 'text', file: { filePath: '/repo/a.py', content: 'x\n', numLines: 10, startLine: 5, totalLines: 90 } }, '/repo')
  expect(file.target).toBe('a.py:5-14')
  expect(cardOf('Read', { file_path: '/home/me/x.md' }, {}, '/repo', '/home/me').target).toBe('~/x.md')
  expect(cardOf('Grep', { pattern: 'a', path: '/repo' }, {}, '/repo').target).toBe('a')
  const grep = cardOf('Grep', { pattern: 'alpha' }, { mode: 'content', numLines: 3, numFiles: 2, content: 'a\nb\nc' }, '/repo')
  expect(grep.meta).toEqual(['3 matches', '2 files'])
  const rows = diffRows(PATCH)
  expect(rows.map(r => `${r.kind}${r.num}`)).toEqual(['ctx3', 'del4', 'add4', 'add5'])
  const pair = diffRows([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-const a = 1', '+const a = 2'] }])
  expect(pair[0]?.mark).toEqual([10, 11])
  expect(groupSummary([{ tool: 'Read' }, { tool: 'Read' }, { tool: 'Grep' }])).toBe('Read 2 files · searched 1 pattern')
})

test('cards and intents keep one blank row above them; messages keep the engine spacing', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  const plain = await $.ui.mount({ plugin: 'fold-tools', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Done.', isFirstOfReply: true } })
  expect(await plain.drawn()).toMatchObject({ type: 'Text' })
  await plain.unmount()
  const intent = await $.ui.mount({ plugin: 'fold-tools', surface: 'terminal', component: 'AssistantMessage', props: { text: '» Reading notes', isFirstOfReply: false } })
  expect(await intent.drawn()).toMatchObject({ type: 'Box', props: { marginTop: 1 } })
  await intent.unmount()
  const card = await $.ui.mount({ plugin: 'fold-tools', surface: 'terminal', ...bash('t9') })
  expect(await card.drawn()).toMatchObject({ type: 'Box', props: { marginTop: 1 } })
  await card.unmount()
})

test('a folded card is one line; unfolded output hangs on a rail; prompts get a frame of their own', async $ => {
  const ui = await $.ui.mount({ plugin: 'fold-tools', surface: 'terminal', ...bash('t10') })
  let text = await textOf(ui)
  expect(text).not.toContain('╭')
  expect(await ui.find({ key: 'more-t10' })).toBeUndefined()
  await ui.press({ key: 'fold-t10' })
  text = await textOf(ui)
  expect(text).toContain('line 30')
  expect(text).toContain('│')
  await ui.unmount()
  const grep = await $.ui.mount({
    plugin: 'fold-tools',
    surface: 'terminal',
    ...toolUse('t11', 'Grep', { pattern: 'alpha' }, { mode: 'content', numLines: 2, numFiles: 1, content: 'a.md:1:alpha\na.md:2:alpha' }),
  })
  await grep.press({ key: 'fold-t11' })
  text = await textOf(grep)
  expect(text).toContain('│')
  expect(text).toContain('├─ ')
  expect(text).toContain('└─ ')
  await grep.unmount()
  const prompt = await $.ui.mount({ plugin: 'fold-tools', surface: 'terminal', component: 'UserMessage', props: { text: 'hello', origin: { kind: 'composer' }, isExpanded: false } })
  expect(await prompt.drawn()).toMatchObject({ type: 'Box', props: { borderStyle: 'round' } })
  await prompt.unmount()
})

test('a prompt typed over a running turn reads queued, then sent once a later turn picks it up', async ($, on) => {
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  const prompt = { component: 'UserMessage', props: { text: 'and then say done', origin: { kind: 'composer' }, isExpanded: false } } as const
  await $.prompt.submit({ text: 'and then say done', turnId: 't1', wait: false, origin: { kind: 'composer' } })
  let ui = await $.ui.mount({ plugin: 'fold-tools', surface: 'terminal', ...prompt })
  let text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(text).toContain('❯')
  expect(text).toMatch(/[◴◷◶◵]/)
  await ui.unmount()
  await $.turn.start({ text: 'and then say done', turnId: 't2' })
  ui = await $.ui.mount({ plugin: 'fold-tools', surface: 'terminal', ...prompt })
  text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(text).toContain('✓')
  expect(text).not.toMatch(/[◴◷◶◵]/)
  await ui.unmount()
})

test('a running card spins while the call is in flight', async ($, on) => {
  const clock = mock.clock(on)
  // The call stays in flight until the test lets it finish.
  let finish = () => {}
  const held = new Promise<void>(resolve => {
    finish = resolve
  })
  on('tool.call', { tool: 'Bash' }, async () => {
    await held
    return { result: { stdout: 'hi', stderr: '', interrupted: false } }
  })
  const running = { ...bash('t12'), props: { ...bash('t12').props, isRunning: true, output: undefined } }
  const call = $.tool.call({ tool: 'Bash', command: 'sleep 1', description: 'Wait' })
  const ui = await $.ui.mount({ plugin: 'fold-tools', surface: 'terminal', ...running })
  const glyph = async () => (await ui.find({ key: 'fold-t12' }))?.text.charAt(0)
  const first = await glyph()
  expect('⣾⣽⣻⢿⡿⣟⣯⣷').toContain(first ?? '?')
  await clock.advance(240)
  await clock.settle()
  await ui.redraw()
  expect(await glyph()).not.toBe(first)
  finish()
  await call
  await ui.unmount()
})
