import { expect, test } from 'claude-code/testing'

import { C, formatTokens, gaugeOf, levelColor, modelName } from '../hooks/gauge'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('the band draws model, effort and the gauge after the rest of the band', async ($, on) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 380_000, window: 1_000_000, percent: 38 }, rateLimits: [] } }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>questions</Text>
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...BAND })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const bar = texts.find(t => t.startsWith('⬢')) ?? ''
  expect(bar).toContain('⬢ Opus 5.5 · ◕ xhigh › ◫ ')
  expect(bar).toContain(' 38% ')
  expect(bar).toContain(' 1M ─')
  expect(bar.length).toBe(80)
  expect(texts.indexOf('questions')).toBeLessThan(texts.indexOf(bar))
  await ui.unmount()
})

test('a context measurement moves the gauge', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.session.measure({ context: { tokens: 920_000, window: 1_000_000, percent: 92 }, rateLimits: [], changed: ['context'] })
  const ui = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...BAND })
  const pct = (await ui.findAll({ type: 'Text' })).find(t => t.text === ' 92% ')
  expect(pct?.props.color).toBe(C.error)
  await ui.unmount()
})

test('gauge, levels and names follow oh-my-pi', () => {
  expect(levelColor(10, 200_000)).toBe(C.used)
  expect(levelColor(55, 200_000)).toBe(C.warning)
  expect(levelColor(16, 1_000_000)).toBe(C.warning)
  expect(levelColor(75, 200_000)).toBe(C.purple)
  expect(levelColor(91, 200_000)).toBe(C.error)
  expect(formatTokens(1_000_000)).toBe('1M')
  expect(formatTokens(200_000)).toBe('200k')
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
  expect(modelName('Opus 5.5')).toBe('Opus 5.5')
  const runs = gaugeOf(40, { window: 200_000, percent: 25 })
  expect(runs.map(r => r.text).join('').length).toBe(40)
  expect(runs[0]).toEqual({ text: '━'.repeat(8), color: C.used })
  expect(runs[1]?.text).toBe(' 25% ')
  const fresh = gaugeOf(20, { window: 200_000 })
  expect(fresh.map(r => r.text).join('')).toBe(`━${'─'.repeat(12)} 200k ─`)
})
