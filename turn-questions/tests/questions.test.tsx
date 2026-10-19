import type { TurnCompleteInput } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { questionsIn } from '../hooks/questions'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 90, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const QUESTIONS = [
  { question: 'Which auth method?', header: 'Auth', multiSelect: false, options: [{ label: 'OAuth', description: '' }] },
  { question: 'Add tests?', header: 'Tests', multiSelect: false, options: [{ label: 'Yes', description: '' }] },
]

const endTurn = (answer: string) => ({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' }) as TurnCompleteInput

test('questions in a reply are found outside code and URLs', () => {
  const text = [
    'Done. Should I run the migration on prod?',
    '- **Keep the old endpoint?**',
    'See https://x.io/a?b=1 for details.',
    '```',
    'is_this_code = x?',
    '```',
    'Ok?',
  ].join('\n')
  expect(questionsIn(text)).toEqual(['Should I run the migration on prod?', 'Keep the old endpoint?'])
})

test('the band frames answered and open questions after the turn, and hides on ✕', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer, reason: 'answer' }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({
    result: { questions: QUESTIONS, answers: { 'Which auth method?': 'OAuth', 'Add tests?': 'Yes' } },
  }))
  await $.turn.start({ text: 'go', turnId: 't' })
  await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })
  await $.turn.complete(endTurn('All set. Want me to deploy it?'))
  const ui = await $.ui.mount({ plugin: 'turn-questions', surface: 'terminal', ...BAND })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(texts).toContain('Questions')
  expect(texts).toContain('↳')
  expect(texts).toContain('Which auth method?')
  expect(texts).toContain('Want me to deploy it?')
  await ui.press({ key: 'hide' })
  expect(await ui.find({ key: 'hide' })).toBeUndefined()
  await ui.unmount()
})
