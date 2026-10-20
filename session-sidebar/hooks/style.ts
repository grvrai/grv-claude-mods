import type { AgentStatus } from 'claude-code'

type Mark = { glyph: string; color: string }

// The grv theme, the same in every mod: oh-my-pi's dark palette, one meaning per color.
export const C = {
  accent: '#febc38', // Claude acting: tool names, intents, spinners, controls
  blue: '#61afef', // you: prompts, questions, the context gauge
  gold: '#d7af5f', // your shell: Bash calls
  success: '#89d281', // done
  warning: '#e4c00f', // waiting: queued, needs input, a filling context
  purple: '#b281d6', // a nearly full context
  error: '#e06c75', // errors, a full context
  pink: '#d787af', // the model
  muted: '#777d88', // secondary text
  dim: '#5f6673', // frames, rails, meta
}

export const SPINNER = '⠴⠦⠖⠲'

export const MARKS: Record<AgentStatus | 'in_progress', Mark> = {
  pending: { glyph: '○', color: C.dim },
  running: { glyph: '⠴', color: C.accent },
  in_progress: { glyph: '●', color: C.accent },
  waiting: { glyph: '⏳', color: C.muted },
  idle: { glyph: '○', color: C.dim },
  completed: { glyph: '✔', color: C.success },
  failed: { glyph: '✘', color: C.error },
  killed: { glyph: '⏹', color: C.error },
}

export const DONE = new Set<AgentStatus>(['completed', 'failed', 'killed', 'idle'])

export const relPath = (path: string, cwd: string) => (cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path)

export const clip = (text: string, room: number, keepEnd = false) =>
  room < 2 || text.length <= room ? text : keepEnd ? `…${text.slice(text.length - room + 1)}` : `${text.slice(0, room - 1)}…`

export const duration = (seconds: number) =>
  seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`

export const statsOf = (hunks: ReadonlyArray<{ lines: string[] }>) => {
  const all = hunks.flatMap(h => h.lines)
  return { add: all.filter(l => l.startsWith('+')).length, del: all.filter(l => l.startsWith('-')).length }
}

export const statText = (add: number, del: number) => [add ? `+${add}` : '', del ? `-${del}` : ''].filter(Boolean).join(' ')
