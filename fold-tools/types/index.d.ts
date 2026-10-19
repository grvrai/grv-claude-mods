// A row's fold, stamped with the /fold generation it was made under; `isFull` lifts the preview cap.
export type Fold = { gen: number; isOpen: boolean; isFull?: boolean }
// A prompt typed while a turn ran, waiting for Claude to pick it up.
export type Queued = { text: string; turnId: string }

declare module 'claude-code' {
  interface PluginState {
    'fold-tools': { mode: Fold; rows: StateFamily<Fold>; queued: Queued[]; tick: number; stamps: StateFamily<number>; history: number }
  }
}
