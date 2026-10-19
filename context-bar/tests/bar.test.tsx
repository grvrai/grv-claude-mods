import { expect, test } from 'claude-code/testing'

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
