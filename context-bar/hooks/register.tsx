import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Usage } from '../types'
import { barOf, C } from './gauge'
import type { StatusInput } from './gauge'

const COMPACT = '⊟ compact'
const AGENTS = '← agents'
// Both buttons, their brackets and the spaces before them take this many columns at the bar's end.
const BUTTONS_WIDTH = COMPACT.length + AGENTS.length + 6
// Commands after which the model or effort may have changed.
const RETUNE = new Set(['model', 'effort', 'fast', 'config'])

const usage = atom({ plugin: 'context-bar', key: 'usage' } as const, null)
const model = atom({ plugin: 'context-bar', key: 'model' } as const, '')
const effort = atom({ plugin: 'context-bar', key: 'effort' } as const, '')
const limits = atom({ plugin: 'context-bar', key: 'limits' } as const, [])

// Each writes only on a change, so the bar redraws only when a figure moves.
const setModel = async ($: EngineInterface, name: string) => {
  if ((await read($, model)) !== name) await update($, model, () => name)
}

const setEffort = async ($: EngineInterface, level: string) => {
  if ((await read($, effort)) !== level) await update($, effort, () => level)
}

const fill = async ($: EngineInterface, context: Usage) => {
  const now = { tokens: context.tokens, window: context.window, percent: context.percent }
  if (JSON.stringify(await read($, usage)) !== JSON.stringify(now)) await update($, usage, () => now)
}

const setLimits = async ($: EngineInterface, windows: readonly SessionRateLimit[]) => {
  const now = windows.map(w => ({ kind: w.kind, percentUsed: w.percentUsed }))
  if (JSON.stringify(await read($, limits)) !== JSON.stringify(now)) await update($, limits, () => now)
}

// The figures a fresh session or a /model or /effort change starts from; a model request corrects effort later.
const retune = async ($: EngineInterface) => {
  const [id, settings] = await Promise.all([$.session.model(), $.settings.read()])
  await setModel($, id)
  if (typeof settings.effortLevel === 'string') await setEffort($, settings.effortLevel)
}

// /background sends the session on and shows the agents list, as ← does; a press may not wait on a command itself.
const toAgents = ($: EngineInterface) => {
  $.clock.after(0, () => {
    void $.command.run({ command: 'background' }).catch((err: Error) => $.ui.toast(`Could not open the agents list: ${err.message}`))
  })
}

const compact = async ($: EngineInterface) => {
  const { skip } = await $.session.compact({}).catch((err: Error) => ({ skip: err.message }))
  if (skip) $.ui.toast(`Compact did not run: ${skip}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await retune($)
    const now = await $.session.usage()
    await fill($, now.context)
    await setLimits($, now.rateLimits)
    return started
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) await fill($, e.context)
    if (e.changed.includes('rateLimits')) await setLimits($, e.rateLimits)
    return next(e)
  })

  // The main loop's requests carry the model and effort actually sent.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      await setModel($, e.model)
      if (e.effort !== undefined) await setEffort($, String(e.effort))
    }
    return yield* next(e)
  })

  on('command.run', async ($, e, next) => {
    const ran = await next(e)
    if (RETUNE.has(e.command)) await retune($)
    return ran
  })

  // Under the prompt, oh-my-pi's bar with agents and compact buttons at its end; the engine's hint stays beneath.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await next(e)
    const [fillNow, id, level, windows] = await Promise.all([read($, usage), read($, model), read($, effort), read($, limits)])
    const { Box, Button, Text } = $.ui.resolve(e)
    const input: StatusInput = {
      model: { id },
      effort: { level },
      context_window: fillNow ? { context_window_size: fillNow.window, used_percentage: fillNow.percent } : undefined,
      rate_limits: Object.fromEntries(windows.map(w => [w.kind, { used_percentage: w.percentUsed }])),
    }
    const runs = barOf(input, (e.viewport?.columns ?? 100) - BUTTONS_WIDTH)
    // Compaction cannot run during a turn, so the button rests dim until the turn ends.
    const isIdle = !e.props.isWorking
    return (
      <Box flexDirection="column">
        <Box height={1}>
          <Box flexShrink={1} height={1} overflow="hidden">
            <Text wrap="truncate-end">
              {runs.map(r => (
                <Text color={r.color}>{r.text}</Text>
              ))}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text> </Text>
            <Button key="agents" plain onPress={() => toAgents($)}>
              <Text color={C.dim}>⟦</Text>
              <Text color={C.context}>{AGENTS}</Text>
              <Text color={C.dim}>⟧</Text>
            </Button>
            <Text> </Text>
            <Button key="compact" plain dimColor={!isIdle} onPress={() => (isIdle ? compact($) : undefined)}>
              <Text color={C.dim}>⟦</Text>
              <Text color={isIdle ? C.context : C.dim}>{COMPACT}</Text>
              <Text color={C.dim}>⟧</Text>
            </Button>
          </Box>
        </Box>
        {hint}
      </Box>
    )
  })
}
