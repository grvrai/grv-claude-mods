import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { barOf, C, formatTokens, gaugeOf, levelColor, limitRuns, modelName } from '../hooks/gauge'

const INPUT = {
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  effort: { level: 'xhigh' },
  context_window: { context_window_size: 1_000_000, used_percentage: 38, total_input_tokens: 380_000 },
  rate_limits: { five_hour: { used_percentage: 55 }, seven_day: { used_percentage: 20 } },
}

const textOf = (runs: { text: string }[]) => runs.map(r => r.text).join('')

test('the status line fills the row: model, effort, gauge, rate limits', () => {
  const line = textOf(barOf(INPUT, 100))
  expect(line.startsWith('⬢ Opus 5.5 · ◕ xhigh › ◫ ━')).toBe(true)
  expect(line).toContain(' 38% ')
  expect(line).toContain(' 1M ─ › 5h 55% · 7d 20%')
  expect(line.length).toBe(100 - 2 - 4)
})

test('a narrow row drops the rule and keeps the figures', () => {
  const line = textOf(barOf(INPUT, 50))
  expect(line).toContain('◫ 38.0%/1M')
  expect(line).not.toContain('━')
})

test('fast mode, a missing window and a missing effort read sensibly', () => {
  const line = textOf(barOf({ model: { id: 'claude-haiku-5-5' }, fast_mode: true }, 80))
  expect(line).toBe('⬢ Haiku 5.5 ⚡ › ◫ ')
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
  const runs = gaugeOf(40, { window: 200_000, percent: 25 })
  expect(textOf(runs).length).toBe(40)
  expect(runs[0]).toEqual({ text: '━'.repeat(8), color: C.used })
  expect(runs[1]?.text).toBe(' 25% ')
  expect(textOf(gaugeOf(20, { window: 200_000 }))).toBe(`━${'─'.repeat(12)} 200k ─`)
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

test('under the prompt: the bar, a compact button at its end, the engine hint beneath', async ($, on) => {
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
  const bar = texts.find(t => t.startsWith('⬢')) ?? ''
  expect(bar).toContain('⬢ Opus 5.5 · ◕ xhigh › ◫ ━')
  expect(bar).toContain(' 57% ')
  expect(bar).toContain('› 5h 40%')
  expect((await ui.find({ key: 'compact' }))?.text).toBe('⟦⊟⟧')
  expect((await ui.find({ key: 'agents' }))?.text).toBe('⟦☰⟧')
  expect(texts.indexOf('? for shortcuts')).toBeGreaterThan(texts.indexOf(bar))
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

test('the agents button runs /background, which shows the agents list', async ($, on) => {
  stubs(on)
  const clock = mock.clock(on)
  const ran: string[] = []
  on('command.run', ($, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  const ui = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...HINT })
  await ui.press({ key: 'agents' })
  await clock.advance(1)
  await clock.settle()
  expect(ran).toContain('background')
  await ui.unmount()
})
