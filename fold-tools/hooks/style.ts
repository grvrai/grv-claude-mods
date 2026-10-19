// Claude Code's own theme colors, so cards follow the person's theme (its pastel palette by default).
export const C = {
  accent: 'claude',
  success: 'success',
  error: 'error',
  warning: 'warning',
  muted: 'inactive',
  dim: 'subtle',
  frame: 'promptBorder',
  bash: 'bashBorder',
  info: 'suggestion',
}

export const G = { success: '✔', error: '✘', pending: '⏳', aborted: '⏹', bullet: '•', branch: '├─', last: '└─' }

export type Status = { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }
export type Tone = 'pending' | 'success' | 'error'

export const toneOf = (s: Status): Tone => (s.isRunning ? 'pending' : s.isErrored || s.isInterrupted ? 'error' : 'success')

export const FRAME: Record<Tone, string> = { pending: C.accent, success: C.frame, error: C.error }

// A finished call shows its tool's own icon, as oh-my-pi does; the rest show their state.
export const iconOf = (s: Status, icon: { glyph: string; color: string }) =>
  s.isRunning
    ? { glyph: G.pending, color: C.muted }
    : s.isInterrupted
      ? { glyph: G.aborted, color: C.error }
      : s.isErrored
        ? { glyph: G.error, color: C.error }
        : icon
