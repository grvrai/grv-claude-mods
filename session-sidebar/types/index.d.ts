export type Sub = {
  id: string
  parentId?: string
  type: string
  description: string
  status: 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
  start: number
  end?: number
  seconds: number
}
export type Todo = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed' }
export type Touched = { path: string; kind: 'A' | 'M'; add: number; del: number }

declare module 'claude-code' {
  interface PluginState {
    'session-sidebar': { subagents: Sub[]; todos: Todo[]; files: Touched[]; reads: string[] }
  }
}
