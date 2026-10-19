import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Usage } from '../types'
import { C, effortLabel, gaugeOf, ICON, modelName } from './gauge'

// Below this many columns for the rule, the band shows the figures without it.
const MIN_GAUGE = 12
const SEP = ' › '
// Commands after which the model or effort may have changed.
const RETUNE = new Set(['model', 'effort', 'fast', 'config'])

const usage = atom({ plugin: 'context-bar', key: 'usage' } as const, null)
const model = atom({ plugin: 'context-bar', key: 'model' } as const, '')
const effort = atom({ plugin: 'context-bar', key: 'effort' } as const, '')

// Each writes only on a change, so the band redraws only when a figure moves.
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

// The figures a fresh session or a /model or /effort change starts from; a model request corrects effort later.
const retune = async ($: EngineInterface) => {
  const [id, settings] = await Promise.all([$.session.model(), $.settings.read()])
  await setModel($, modelName(id))
  if (typeof settings.effortLevel === 'string') await setEffort($, settings.effortLevel)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await retune($)
    await fill($, (await $.session.usage()).context)
    return started
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) await fill($, e.context)
    return next(e)
  })

  // The main loop's requests carry the model and effort actually sent.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      await setModel($, modelName(e.model))
      if (e.effort !== undefined) await setEffort($, String(e.effort))
    }
    return yield* next(e)
  })

  on('command.run', async ($, e, next) => {
    const ran = await next(e)
    if (RETUNE.has(e.command)) await retune($)
    return ran
  })

  // oh-my-pi's composer border: model and effort, then the rule itself as the context gauge.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey) return rest
    const [fillNow, name, level] = await Promise.all([read($, usage), read($, model), read($, effort)])
    const { Box, Text } = $.ui.resolve(e)
    const head = `${ICON.model} ${name || 'model'}${level ? ` · ${effortLabel(level)}` : ''}`
    const lead = `${head}${SEP}${ICON.context} `
    const room = e.props.bodyColumns - lead.length
    const gauge = fillNow && room >= MIN_GAUGE ? gaugeOf(room, fillNow) : []
    const figures = fillNow && !gauge.length ? `${fillNow.percent === undefined ? '?' : `${fillNow.percent.toFixed(1)}%`}/${fillNow.window}` : ''
    return (
      <Box flexDirection="column">
        {rest}
        <Box height={1} overflow="hidden">
          <Text wrap="truncate-end">
            <Text color={C.model}>{head}</Text>
            <Text color={C.sep}>{SEP}</Text>
            <Text color={C.context}>{ICON.context} </Text>
            {gauge.map(r => (
              <Text color={r.color}>{r.text}</Text>
            ))}
            {figures && <Text color={C.context}>{figures}</Text>}
          </Text>
        </Box>
      </Box>
    )
  })
}
