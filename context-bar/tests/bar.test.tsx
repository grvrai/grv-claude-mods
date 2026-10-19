import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { C, formatTokens, levelColor, limitRuns, modelName, partsOf } from '../hooks/gauge'

const INPUT = {
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  effort: { level: 'xhigh' },
  context_window: { context_window_size: 1_000_000, used_percentage: 38, total_input_tokens: 380_000 },
  rate_limits: { five_hour: { used_percentage: 55 }, seven_day: { used_percentage: 20 } },
}

const textOf = (runs: { text: string }[]) => runs.map(r => r.text).join('')

test('the bar splits into model and effort, a gauge sized by the fill, and the window and rate limits', () => {
  const parts = partsOf(INPUT)
  expect(textOf(parts.head)).toBe('⬢ Opus 5.5 · ◕ xhigh › ◫ ')
  expect(parts.gauge).toEqual({ used: 38, color: C.purple, label: { text: ' 38% ', color: C.purple } })
  expect(textOf(parts.tail)).toBe(' 1M ─ › 5h 55% · 7d 20%')
})

test('fast mode, a missing window and a missing effort read sensibly', () => {
  const parts = partsOf({ model: { id: 'claude-haiku-5-5' }, fast_mode: true })
  expect(textOf(parts.head)).toBe('⬢ Haiku 5.5 ⚡ › ◫ ')
  expect(parts.gauge).toBeUndefined()
  expect(partsOf({ ...INPUT, context_window: { context_window_size: 200_000, used_percentage: 0.2 } }).gauge?.used).toBe(1)
})

test('gauge, levels, limits and names follow oh-my-pi', () => {
  expect(levelColor(10, 200_000)).toBe(C.used)
  expect(levelColor(55, 200_000)).toBe(C.warning)
  expect(levelColor(16, 1_000_000)).toBe(C.warning)
  expect(levelColor(75, 200_000)).toBe(C.purple)
  expect(levelColor(91, 200_000)).toBe(C.error)
  expect(limitRuns([{ kind: 'five_hour', percentUsed: 92 }])).toEqual([{ text: '5h 92%', color: C.error }])
  expect(formatTokens(1_000_000)).toBe('1M')
  expect(formatTokens(200_000)).toBe('200k')
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
})

const HINT = { component: 'PromptHint', viewport: { columns: 120, rows: 40 }, props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as const

const stubs = (on: On) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 570_000, window: 1_000_000, percent: 57 }, rateLimits: [{ kind: 'five_hour', percentUsed: 40 }] },
  }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}</Text>
  })
}

test('under the prompt: the bar between its buttons, the engine hint beneath', async ($, on) => {
  stubs(on)
  // The test engine holds no conversation to compact, so the attempt surfaces as the mod's toast.
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...HINT })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const bar = texts.join('')
  expect(bar).toContain('⬢ Opus 5.5 · ◕ xhigh › ◫ ━')
  expect(bar).toContain(' 57% ─')
  expect(bar).toContain('› 5h 40%')
  expect(bar.indexOf('⟦☰⟧')).toBeLessThan(bar.indexOf('⬢'))
  expect(bar.indexOf('⟦◨⟧')).toBeLessThan(bar.indexOf('⟦⊟⟧'))
  for (const [key, text] of [['agents', '⟦☰⟧'], ['sidebar', '⟦◨⟧'], ['compact', '⟦⊟⟧']]) expect((await ui.find({ key }))?.text).toBe(text)
  expect(bar.indexOf('? for shortcuts')).toBeGreaterThan(bar.indexOf('5h 40%'))
  await ui.press({ key: 'compact' })
  expect(toasts.some(t => t.startsWith('Compact did not run'))).toBe(true)
  await ui.unmount()
})

test('the compact button rests while a turn runs', async ($, on) => {
  stubs(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const ui = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...HINT, props: { ...HINT.props, isWorking: true } })
  await ui.press({ key: 'compact' })
  expect(toasts).toHaveLength(0)
  await ui.unmount()
})

test('the agents button runs /background, which shows the agents list; the sidebar button runs /sidebar', async ($, on) => {
  stubs(on)
  const clock = mock.clock(on)
  const ran: string[] = []
  on('command.run', ($, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  const ui = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...HINT })
  await ui.press({ key: 'agents' })
  await ui.press({ key: 'sidebar' })
  await clock.advance(1)
  await clock.settle()
  expect(ran).toEqual(['background', 'sidebar'])
  await ui.unmount()
})
