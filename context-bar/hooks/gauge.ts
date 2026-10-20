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

// The grv theme, the same in every mod: oh-my-pi's dark palette, one meaning per color.
export const C = {
  accent: '#febc38', // Claude acting: tool names, intents, spinners, controls
  blue: '#61afef', // you: prompts, questions, the context gauge
  gold: '#d7af5f', // your shell: Bash calls
  success: '#89d281', // done
  warning: '#e4c00f', // waiting: queued, needs input, a filling context
  purple: '#b281d6', // a nearly full context
  error: '#e06c75', // errors, a full context
  pink: '#d787af', // the model
  soft: '#aab1bb', // tool-call text, a step under the replies' white
  muted: '#777d88', // secondary text
  dim: '#5f6673', // frames, rails, meta
}
export const ICON = { model: '⬢', context: '◫', fast: '⚡' }
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
      color: l.percentUsed >= 90 ? C.error : l.percentUsed >= 70 ? C.purple : l.percentUsed >= 50 ? C.warning : C.blue,
    }))

export const levelColor = (percent: number, window: number) =>
  LEVELS.find(([pct, tokens]) => percent > 0 && percent >= Math.min(pct, window > 0 ? (tokens / window) * 100 : pct))?.[2] ?? C.blue

export const formatTokens = (n: number) =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)

export const modelName = (id: string) => {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(id)
  const family = m?.[1] ?? ''
  const name = m ? `${family.charAt(0).toUpperCase()}${family.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : id.replace(/^claude[- ]/i, '')
  return /\[1m\]/i.test(id) ? `${name} 1M` : name
}

export const effortLabel = (effort: string) => EFFORT[effort] ?? (effort ? `◉ ${effort}` : '')

export type Parts = { head: Run[]; gauge?: { used: number; color: string; label: Run[] }; tail: Run[] }

// The bar's pieces: fixed runs either side of the gauge, and the share (1–99) the gauge's lit run takes of the room between.
export const partsOf = (input: StatusInput): Parts => {
  const name = input.model?.display_name || modelName(input.model?.id ?? '') || 'model'
  const level = input.effort?.level ?? ''
  const head: Run[] = [
    { text: `${ICON.model} ${name}${input.fast_mode ? ` ${ICON.fast}` : ''}${level ? ` · ${effortLabel(level)}` : ''}`, color: C.pink },
    { text: SEP, color: C.muted },
    { text: `${ICON.context} `, color: C.blue },
  ]
  const windows = Object.entries(input.rate_limits ?? {}).flatMap(([kind, w]) =>
    w?.used_percentage === undefined ? [] : [{ kind, percentUsed: w.used_percentage }],
  )
  const limits = limitRuns(windows).flatMap((r, n): Run[] => [{ text: n ? ' · ' : SEP, color: C.muted }, r])
  const window = input.context_window?.context_window_size
  if (!window) return { head, tail: limits }
  const pct = input.context_window?.used_percentage
  const color = levelColor(pct ?? 0, window)
  // The percent, then the tokens it stands for: the count reported, else worked out from the percent.
  const tokens = input.context_window?.total_input_tokens ?? (pct === undefined ? undefined : (pct / 100) * window)
  const label: Run[] =
    pct === undefined
      ? []
      : [
          { text: ` ${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`, color: pct > 100 ? C.error : color },
          { text: ` ${formatTokens(Math.round(tokens ?? 0))} `, color: C.blue },
        ]
  return {
    head,
    gauge: { used: Math.min(99, Math.max(1, Math.round(pct ?? 0))), color, label },
    tail: [{ text: ` ${formatTokens(window)} `, color: C.blue }, { text: '─', color: C.dim }, ...limits],
  }
}
