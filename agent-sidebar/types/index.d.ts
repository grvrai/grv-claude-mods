// One background session as `claude agents --json` lists it; `isHere` marks this session.
export type Fleet = { id: string; name: string; state: string; cwd: string; startedAt: number; isHere: boolean }

declare module 'claude-code' {
  interface PluginState {
    'agent-sidebar': { agents: Fleet[]; polledAt: number }
  }
}
