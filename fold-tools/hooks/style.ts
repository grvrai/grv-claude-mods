// oh-my-pi's dark palette (tui/src/theme/dark.json).
export const C = {
  accent: '#febc38',
  success: '#89d281',
  error: '#fc3a4b',
  warning: '#e4c00f',
  muted: '#777d88',
  dim: '#5f6673',
  user: '#178fb9',
}

export const G = { success: '✔', error: '✘', pending: '⏳', aborted: '⏹', bullet: '•', branch: '├─', last: '└─' }

export type Status = { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }
export type Tone = 'pending' | 'success' | 'error'

export const toneOf = (s: Status): Tone => (s.isRunning ? 'pending' : s.isErrored || s.isInterrupted ? 'error' : 'success')

export const FRAME: Record<Tone, string> = { pending: C.accent, success: C.dim, error: C.error }

// A finished call shows its tool's own icon, as oh-my-pi does; the rest show their state.
export const iconOf = (s: Status, icon: { glyph: string; color: string }) =>
  s.isRunning
    ? { glyph: G.pending, color: C.muted }
    : s.isInterrupted
      ? { glyph: G.aborted, color: C.error }
      : s.isErrored
        ? { glyph: G.error, color: C.error }
        : icon
