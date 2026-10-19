// The live context window: its size, and its fill once a response reported one.
export type Usage = { tokens?: number; window: number; percent?: number }
// A rate-limit window (`five_hour`, `seven_day`) and how much of it is used.
export type Limit = { kind: string; percentUsed: number }

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { usage: Usage | null; model: string; effort: string; limits: Limit[] }
  }
}
