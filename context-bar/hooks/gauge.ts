// The live context window: its size, and its fill once a response reported one.
export type Usage = { tokens?: number; window: number; percent?: number }

// The figures the bar reads, in the shape Claude Code's status line JSON uses.
export type StatusInput = {
  model?: { id?: string; display_name?: string }
  effort?: { level?: string }
  fast_mode?: boolean
  context_window?: { context_window_size?: number; used_percentage?: number; total_input_tokens?: number }
  rate_limits?: Record<string, { used_percentage?: number } | undefined>
}

// Claude Code's own theme colors (its pastel palette by default); oh-my-pi's unicode symbols (theme/symbols.ts).
export const C = {
  model: 'claude',
  context: 'permission',
  used: 'suggestion',
  warning: 'warning',
  purple: 'autoAccept',
  error: 'error',
  dim: 'subtle',
  sep: 'inactive',
}
export const ICON = { model: '⬢', context: '◫', fast: '⚡' }
// Claude Code sets the status line two columns in and cuts it a few columns short of the edge.
const STATUS_INDENT = 2
const STATUS_MARGIN = 4
const MIN_GAUGE = 12
const SEP = ' › '

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

const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }

// The rate-limit windows as `5h 40%`, colored as they fill.
export const limitRuns = (limits: ReadonlyArray<{ kind: string; percentUsed: number }>): Run[] =>
  limits
    .filter(l => LIMIT_NAMES[l.kind])
    .map(l => ({
      text: `${LIMIT_NAMES[l.kind]} ${Math.round(l.percentUsed)}%`,
      color: l.percentUsed >= 90 ? C.error : l.percentUsed >= 70 ? C.purple : l.percentUsed >= 50 ? C.warning : C.context,
    }))

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

// oh-my-pi's bar: model and effort, the context gauge filling the row, the rate-limit windows.
export const barOf = (input: StatusInput, columns: number): Run[] => {
  const name = input.model?.display_name || modelName(input.model?.id ?? '') || 'model'
  const level = input.effort?.level ?? ''
  const head: Run[] = [
    { text: `${ICON.model} ${name}${input.fast_mode ? ` ${ICON.fast}` : ''}${level ? ` · ${effortLabel(level)}` : ''}`, color: C.model },
    { text: SEP, color: C.sep },
    { text: `${ICON.context} `, color: C.context },
  ]
  const windows = Object.entries(input.rate_limits ?? {}).flatMap(([kind, w]) =>
    w?.used_percentage === undefined ? [] : [{ kind, percentUsed: w.used_percentage }],
  )
  const tail = limitRuns(windows).flatMap((r, n): Run[] => [{ text: n ? ' · ' : SEP, color: C.sep }, r])
  const width = (runs: Run[]) => runs.reduce((n, r) => n + r.text.length, 0)
  const room = columns - STATUS_INDENT - STATUS_MARGIN - width(head) - width(tail)
  const ctx = input.context_window
  if (!ctx?.context_window_size) return [...head, ...tail]
  const usage = { window: ctx.context_window_size, percent: ctx.used_percentage, tokens: ctx.total_input_tokens }
  const gauge: Run[] =
    room >= MIN_GAUGE
      ? gaugeOf(room, usage)
      : [{ text: `${usage.percent === undefined ? '?' : `${usage.percent.toFixed(1)}%`}/${formatTokens(usage.window)}`, color: levelColor(usage.percent ?? 0, usage.window) }]
  return [...head, ...gauge, ...tail]
}
