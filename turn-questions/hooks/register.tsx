import { atom, read, update } from 'claude-code'
import type { BuiltinToolInputs, ElementTable, Register } from 'claude-code'

import type { Asked } from '../types'
import { clip, isAnswered, pairsOf, plural, questionsIn } from './questions'
import { C } from './style'

type Question = BuiltinToolInputs['AskUserQuestion']['questions'][number]
type Els = Pick<ElementTable, 'Box' | 'Text'>

// The terminal counts a dialog tree's rows at 40 columns and allows 12.
const DIALOG_ROOM = 34

const asked = atom({ plugin: 'turn-questions', key: 'asked' } as const, [])
const isHidden = atom({ plugin: 'turn-questions', key: 'isHidden' } as const, false)

// oh-my-pi insets a card's title into its top rule.
const titleOf = ({ Box, Text }: Els, label: string, meta: string) => (
  <Box position="absolute" top={-1} left={1}>
    <Text bold color={C.accent}>
      {' '}
      {label}{' '}
    </Text>
    <Text color={C.dim}>· {meta} </Text>
  </Box>
)

const rowsOf = ({ Box, Text }: Els, list: Asked[]) =>
  list.map(q => (
    <Box flexDirection="column">
      <Text>
        <Text color={q.source === 'ask' ? C.accent : C.dim}>{q.source === 'ask' ? '?' : '○'} </Text>
        {q.header && <Text color={C.dim}>{q.header} · </Text>}
        {q.question}
      </Text>
      {q.source === 'ask' &&
        (q.answer ? (
          <Text>
            <Text color={C.dim}>  ↳ </Text>
            <Text color={C.success}>{q.answer}</Text>
          </Text>
        ) : (
          <Text color={C.warning}>  ⚠ Cancelled</Text>
        ))}
      {q.note && <Text color={C.muted}>  ✎ {q.note}</Text>}
    </Box>
  ))

export const register: Register = on => {
  let pending: Asked[] = []

  on('turn.start', ($, e, next) => {
    if (!e.agentId) pending = []
    return next(e)
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const ran = await next(e)
    if ('result' in ran && isAnswered(ran.result)) pending.push(...pairsOf(ran.result))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const list = [...pending, ...questionsIn(e.answer).map(question => ({ question, source: 'reply' as const }))]
      pending = []
      await update($, asked, () => list)
      await update($, isHidden, () => false)
    }
    return next(e)
  })

  // The questions still waiting on the person sit above the prompt until the next turn.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, asked)
    const { hasSurvey, isWorking, view } = e.props
    if (hasSurvey || isWorking || view.agentId || !list.length || (await read($, isHidden))) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Button } = els
    // Other mods' rows (the context bar) stay beneath the questions, nearest the prompt.
    const rest = await next(e)
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor={C.border} paddingX={1}>
          {titleOf(els, 'Questions', String(list.length))}
          <Box>
            <Box flexDirection="column" flexGrow={1}>
              {rowsOf(els, list)}
            </Box>
            <Button key="hide" plain dimColor label="✕" onPress={() => update($, isHidden, () => true)} />
          </Box>
        </Box>
        {rest}
      </Box>
    )
  })

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const questions = e.props.questions as Question[]
    if (questions.length < 2) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const engine = await next(e)
    const fit = (text: string) => (e.surface === 'terminal' ? clip(text, DIALOG_ROOM) : text)
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor={C.border} paddingX={1}>
          <Text>
            <Text bold color={C.accent}>
              Ask
            </Text>
            <Text color={C.dim}> · {plural(questions.length, 'question')}</Text>
          </Text>
          {questions.map((q, n) => (
            <Text>
              <Text color={C.dim}>○ {n + 1}. </Text>
              {fit(`${q.header} · ${q.question}`)}
            </Text>
          ))}
        </Box>
        {engine}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { tool, isRunning, isErrored, output } = e.props
    if (tool !== 'AskUserQuestion' || isRunning || isErrored || !isAnswered(output)) return next(e)
    const els = $.ui.resolve(e)
    const { Box } = els
    const pairs = pairsOf(output)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={C.borderMuted} paddingX={1}>
        {titleOf(els, '? Ask', plural(pairs.length, 'question'))}
        {rowsOf(els, pairs)}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { Box } = $.ui.resolve(e)
    return e.props.tool === 'AskUserQuestion' && !e.props.isErrored && isAnswered(e.props.output) ? <Box /> : next(e)
  })
}
