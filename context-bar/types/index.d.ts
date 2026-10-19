// The live context window: its size, and its fill once a response reported one.
export type Usage = { tokens?: number; window: number; percent?: number }

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { usage: Usage | null; model: string; effort: string }
  }
}
