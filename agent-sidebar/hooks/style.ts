// oh-my-pi's dark palette, as the other mods use it.
export const C = {
  accent: '#febc38',
  success: '#89d281',
  warning: '#e4c00f',
  muted: '#777d88',
  dim: '#5f6673',
}

export const SPINNER = '⠴⠦⠖⠲'

type Group = { label: string; glyph: string; color: string }

// The agent view's states, in the order its sections run; any state it adds lands in `idle`.
export const GROUPS = {
  working: { label: 'WORKING', glyph: '⠴', color: C.accent },
  blocked: { label: 'NEEDS INPUT', glyph: '◐', color: C.warning },
  idle: { label: 'IDLE', glyph: '○', color: C.muted },
  done: { label: 'DONE', glyph: '✔', color: C.success },
} satisfies Record<string, Group>

export type GroupKey = keyof typeof GROUPS

export const groupOf = (state: string): GroupKey => (state in GROUPS ? (state as GroupKey) : 'idle')

export const clip = (text: string, room: number, keepEnd = false) =>
  room < 2 || text.length <= room ? text : keepEnd ? `…${text.slice(text.length - room + 1)}` : `${text.slice(0, room - 1)}…`

export const age = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`
}

export const homePath = (path: string, home: string) => (home && path.startsWith(home) ? `~${path.slice(home.length)}` : path)
