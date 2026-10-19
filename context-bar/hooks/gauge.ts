import type { Usage } from '../types'

// oh-my-pi's dark theme (tui/src/theme/dark.json) and unicode symbols (theme/symbols.ts).
export const C = {
  model: '#d787af',
  context: '#8787af',
  used: '#0088fa',
  warning: '#e4c00f',
  purple: '#b281d6',
  error: '#fc3a4b',
  dim: '#5f6673',
  sep: '#808080',
}
export const ICON = { model: '⬢', context: '◫' }

const EFFORT: Record<string, string> = {
  minimal: '○ min',
  low: '◔ low',
  medium: '◑ med',
  high: '◒ high',
  xhigh: '◕ xhigh',
  max: '◉ max',
}

// oh-my-pi's context levels: a percent or a token count, whichever the fill reaches first.
const LEVELS: [number, number, string][] = [
  [90, 500_000, C.error],
  [70, 270_000, C.purple],
  [50, 150_000, C.warning],
]

export type Run = { text: string; color: string }

export const levelColor = (percent: number, window: number) =>
  LEVELS.find(([pct, tokens]) => percent > 0 && percent >= Math.min(pct, window > 0 ? (tokens / window) * 100 : pct))?.[2] ?? C.used

export const formatTokens = (n: number) =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)

export const modelName = (id: string) => {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(id)
  const family = m?.[1] ?? ''
  const name = m ? `${family.charAt(0).toUpperCase()}${family.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : id.replace(/^claude[- ]/i, '')
  return /\[1m\]/i.test(id) ? `${name} 1M` : name
}

export const effortLabel = (effort: string) => EFFORT[effort] ?? (effort ? `◉ ${effort}` : '')

// The rule as runs: the used share lit, its percent set right after it, the window at the end.
export const gaugeOf = (width: number, usage: Usage): Run[] => {
  const pct = usage.percent === undefined ? undefined : Math.max(0, usage.percent)
  const color = levelColor(pct ?? 0, usage.window)
  const windowLabel = ` ${formatTokens(usage.window)} `
  const pctLabel = pct === undefined ? '' : ` ${pct < 10 ? pct.toFixed(1) : Math.round(pct)}% `
  const scale = Math.max(1, width - windowLabel.length - 1)
  const used = Math.min(scale, Math.max(1, Math.round((Math.min(100, pct ?? 0) / 100) * scale)))
  const start = Math.max(0, Math.min(used, scale - pctLabel.length))
  const cells = (from: number, to: number): Run[] => {
    const lit = Math.max(from, Math.min(to, used))
    return [
      { text: '━'.repeat(lit - from), color },
      { text: '─'.repeat(to - lit), color: C.dim },
    ]
  }
  return [
    ...cells(0, start),
    { text: pctLabel, color: pct !== undefined && pct > 100 ? C.error : color },
    ...cells(Math.min(scale, start + pctLabel.length), scale),
    { text: windowLabel, color: C.context },
    { text: '─', color: C.dim },
  ].filter(r => r.text)
}
