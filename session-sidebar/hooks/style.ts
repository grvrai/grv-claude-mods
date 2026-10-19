import type { AgentStatus } from 'claude-code'

type Mark = { glyph: string; color: string }

// oh-my-pi's dark palette and glyphs (tui/src/theme/dark.json, theme/symbols.ts).
export const C = {
  accent: '#febc38',
  success: '#89d281',
  error: '#fc3a4b',
  muted: '#777d88',
  dim: '#5f6673',
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
