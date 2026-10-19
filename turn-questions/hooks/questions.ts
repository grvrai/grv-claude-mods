import type { BuiltinToolResults } from 'claude-code'

import type { Asked } from '../types'

type Answered = BuiltinToolResults['AskUserQuestion']

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const clip = (text: string, room: number) => (text.length <= room ? text : `${text.slice(0, room - 1)}…`)

// Sentences ending in "?" outside code fences; a "?" inside a URL is not an ending.
export const questionsIn = (text: string) => {
  const found = text
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .flatMap(line => {
      const clean = line
        .replace(/^\s*(?:[-*+>]|\d+[.)]|#+)\s*/, '')
        .replace(/\*\*|__/g, '')
        .trim()
      return clean.match(/[^\s.!?][^.!?]*\?+(?=["')\]]*(?:\s|$))/g) ?? []
    })
    .map(q => q.trim())
    .filter(q => q.length >= 8)
  return [...new Set(found)]
}

export const isAnswered = (v: unknown): v is Answered => {
  const o = v as Partial<Answered> | null
  return !!o && typeof o === 'object' && Array.isArray(o.questions) && !!o.answers && typeof o.answers === 'object'
}

// Answers are keyed by question text; a multi-select answer arrives comma-joined.
export const pairsOf = (out: Answered): Asked[] => {
  const answers = out.answers as Record<string, string | undefined>
  const notes = (out.annotations ?? {}) as Record<string, { notes?: string } | undefined>
  return out.questions.map(q => ({
    question: q.question,
    header: q.header,
    answer: answers[q.question],
    note: notes[q.question]?.notes,
    source: 'ask',
  }))
}
