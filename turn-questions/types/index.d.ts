// One question of a turn: from an AskUserQuestion call (with its answer) or from Claude's reply.
export type Asked = { question: string; header?: string; answer?: string; note?: string; source: 'ask' | 'reply' }

declare module 'claude-code' {
  interface PluginState {
    'turn-questions': { asked: Asked[]; isHidden: boolean }
  }
}
