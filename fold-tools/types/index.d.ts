// A row's fold, stamped with the /fold generation it was made under; `isFull` lifts the preview cap.
export type Fold = { gen: number; isOpen: boolean; isFull?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'fold-tools': { mode: Fold; rows: StateFamily<Fold> }
  }
}
