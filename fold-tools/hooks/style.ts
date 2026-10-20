// The grv theme, the same in every mod: oh-my-pi's dark palette, one meaning per color.
export const C = {
  accent: '#febc38', // Claude acting: tool names, intents, spinners, controls
  blue: '#3aa6ff', // you and your shell: prompts, Bash, questions, the context gauge
  success: '#89d281', // done
  warning: '#e4c00f', // waiting: queued, needs input, a filling context
  purple: '#b281d6', // a nearly full context
  error: '#fc3a4b',
  pink: '#d787af', // the model
  muted: '#777d88', // secondary text
  dim: '#5f6673', // frames, rails, meta
}

// A 2x2 braille spinner, its gap going round clockwise, and a clock for a prompt waiting its turn.
export const SPINNER = '⠴⠦⠖⠲'
export const CLOCK = '◴◷◶◵'

export const G = { success: '✔', error: '✘', pending: '⏳', aborted: '⏹', bullet: '•', branch: '├─', last: '└─' }

// The terminal's own time format (`2:34 AM`), with the date once the day has passed.
export const timeOf = (ms: number, now: number) => {
  const at = new Date(ms)
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return at.toDateString() === new Date(now).toDateString() ? time : `${at.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

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
