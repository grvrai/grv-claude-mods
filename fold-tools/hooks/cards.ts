import type { BuiltinToolResults } from 'claude-code'

import { C, G } from './style'

export type Hunk = BuiltinToolResults['Edit']['structuredPatch'][number]

export type Body =
  | { kind: 'diff'; hunks: Hunk[] }
  | { kind: 'code'; source: string; path: string; startLine: number }
  | { kind: 'shell'; command: string; output: string[]; isError?: boolean }
  | { kind: 'tree'; items: string[] }
  | { kind: 'text'; lines: string[]; isError?: boolean }

export type Card = {
  title: string
  // The tool's own color: its name always, its icon once the call succeeded.
  tint: string
  icon: { glyph: string; color: string }
  target: string
  isPath?: boolean
  badge?: { add: number; del: number }
  meta: string[]
  body?: Body
}

export type DiffRow = { kind: 'add' | 'del' | 'ctx' | 'gap'; num: number; text: string; mark?: [number, number] }

const VERBS: Record<string, [string, string]> = {
  Read: ['read', 'file'],
  Grep: ['searched', 'pattern'],
  Glob: ['listed', 'pattern'],
  Bash: ['ran', 'command'],
}
const ICONS: Record<string, { glyph: string; color: string }> = {
  Bash: { glyph: '❯', color: C.bash },
  Edit: { glyph: '✎', color: C.accent },
  Write: { glyph: '✎', color: C.accent },
  Read: { glyph: '●', color: C.info },
  Grep: { glyph: '🔍', color: C.info },
  Glob: { glyph: '🔍', color: C.info },
}
const DONE = { glyph: G.success, color: C.success }
const TINTS: Record<string, string> = { Bash: C.bash, Read: C.info, Grep: C.info, Glob: C.info }

const obj = (v: unknown) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' ? v : 0)

export const linesOf = (text: string) => (text.trim() ? text.replace(/\s+$/, '').split('\n') : [])

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : /(ch|sh|s|x)$/.test(word) ? 'es' : 's'}`

export const relPath = (path: string, cwd: string, home = '') =>
  cwd && path === cwd
    ? '.'
    : cwd && path.startsWith(`${cwd}/`)
      ? path.slice(cwd.length + 1)
      : home && path.startsWith(`${home}/`)
        ? `~${path.slice(home.length)}`
        : path

// Cuts to `room` columns, from the start for paths so the file name stays.
export const clip = (text: string, room: number, keepEnd = false) =>
  room < 2 || text.length <= room ? text : keepEnd ? `…${text.slice(text.length - room + 1)}` : `${text.slice(0, room - 1)}…`

const stats = (hunks: Hunk[]) => {
  const all = hunks.flatMap(h => h.lines)
  return { add: all.filter(l => l.startsWith('+')).length, del: all.filter(l => l.startsWith('-')).length }
}

const toolName = (tool: string) => (tool.startsWith('mcp__') ? tool.slice(5).split('__').join(' · ') : tool)

const firstText = (input: Record<string, unknown>) => str(Object.values(input).find(v => typeof v === 'string')).split('\n')[0] ?? ''

const shared = (a: string, b: string) => {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

// Marks the changed middle of a removed line that one added line replaces.
const markPairs = (rows: DiffRow[]) =>
  rows.map((row, i): DiffRow => {
    const isDel = row.kind === 'del' && rows[i + 1]?.kind === 'add' && rows[i - 1]?.kind !== 'del' && rows[i + 2]?.kind !== 'add'
    const isAdd = row.kind === 'add' && rows[i - 1]?.kind === 'del' && rows[i - 2]?.kind !== 'del' && rows[i + 1]?.kind !== 'add'
    const other = isDel ? rows[i + 1] : isAdd ? rows[i - 1] : undefined
    if (!other) return row
    const head = shared(row.text, other.text)
    const tail = Math.min(
      shared([...row.text].reverse().join(''), [...other.text].reverse().join('')),
      row.text.length - head,
      other.text.length - head,
    )
    const end = row.text.length - tail
    return head + tail > 0 && end > head ? { ...row, mark: [head, end] } : row
  })

export const diffRows = (hunks: Hunk[]): DiffRow[] => {
  const rows: DiffRow[] = []
  hunks.forEach((h, n) => {
    if (n) rows.push({ kind: 'gap', num: 0, text: '…' })
    let old = h.oldStart
    let cur = h.newStart
    for (const line of h.lines) {
      const text = line.slice(1)
      if (line.startsWith('-')) rows.push({ kind: 'del', num: old++, text })
      else if (line.startsWith('+')) rows.push({ kind: 'add', num: cur++, text })
      else if (!line.startsWith('\\')) {
        rows.push({ kind: 'ctx', num: cur++, text })
        old++
      }
    }
  })
  return markPairs(rows)
}

export const cardOf = (tool: string, input: unknown, output: unknown, cwd: string, home = ''): Card => {
  const i = obj(input)
  const o = obj(output)
  const rel = (p: unknown) => relPath(str(p), cwd, home)
  // A search scoped to the project root names no folder.
  const scope = rel(i.path) && rel(i.path) !== '.' ? ` in ${rel(i.path)}` : ''
  const hunks = (Array.isArray(o.structuredPatch) ? o.structuredPatch : []) as Hunk[]
  const icon = ICONS[tool] ?? DONE
  const tint = TINTS[tool] ?? C.accent
  const card = ((): Omit<Card, 'tint'> => {
    switch (tool) {
      case 'Edit':
        return {
          title: 'Edit',
          icon,
          target: rel(i.file_path),
          isPath: true,
          badge: stats(hunks),
          meta: i.replace_all ? ['all'] : [],
          body: hunks.length ? { kind: 'diff', hunks } : undefined,
        }
      case 'Write': {
        const isNew = o.type === 'create'
        const content = str(i.content)
        return {
          title: isNew ? 'Create' : 'Write',
          icon,
          target: rel(i.file_path),
          isPath: true,
          badge: isNew ? { add: linesOf(content).length, del: 0 } : stats(hunks),
          meta: [],
          body: isNew ? { kind: 'code', source: linesOf(content).join('\n'), path: str(i.file_path), startLine: 1 } : hunks.length ? { kind: 'diff', hunks } : undefined,
        }
      }
      case 'Read': {
        const f = obj(o.file)
        const isText = o.type === 'text'
        const from = num(f.startLine) || 1
        const shown = num(f.numLines)
        const total = num(f.totalLines)
        return {
          title: 'Read',
          icon,
          target: `${rel(i.file_path)}${isText && shown < total ? `:${from}-${from + shown - 1}` : ''}`,
          isPath: true,
          meta: isText ? [plural(total || shown, 'line')] : o.type ? [str(o.type)] : [],
          body: isText ? { kind: 'code', source: linesOf(str(f.content)).join('\n'), path: str(f.filePath), startLine: from } : undefined,
        }
      }
      case 'Bash': {
        const output = linesOf([str(o.stdout), str(o.stderr)].filter(Boolean).join('\n'))
        return {
          title: 'Bash',
          icon,
          target: str(i.description),
          meta: [
            ...(o.backgroundTaskId ? ['background'] : []),
            ...(o.interrupted ? ['interrupted'] : []),
            ...(output.length ? [plural(output.length, 'line')] : []),
          ],
          body: { kind: 'shell', command: str(i.command), output },
        }
      }
      case 'Grep': {
        const files = (Array.isArray(o.filenames) ? o.filenames : []) as string[]
        const content = linesOf(str(o.content))
        return {
          title: 'Grep',
          icon,
          target: `${str(i.pattern)}${scope}`,
          meta: [
            ...(o.mode === 'content' ? [plural(num(o.numLines), 'match')] : []),
            ...(num(o.numFiles) || files.length ? [plural(num(o.numFiles) || files.length, 'file')] : []),
          ],
          body: content.length ? { kind: 'tree', items: content } : files.length ? { kind: 'tree', items: files.map(rel) } : undefined,
        }
      }
      case 'Glob': {
        const files = (Array.isArray(o.filenames) ? o.filenames : []) as string[]
        return {
          title: 'Glob',
          icon,
          target: `${str(i.pattern)}${scope}`,
          meta: [plural(num(o.numFiles), 'file'), ...(o.truncated ? ['truncated'] : [])],
          body: files.length ? { kind: 'tree', items: files.map(rel) } : undefined,
        }
      }
      case 'WebFetch':
        return {
          title: 'Fetch',
          icon,
          target: str(i.url),
          meta: o.code ? [`${num(o.code)} ${str(o.codeText)}`] : [],
          body: o.result ? { kind: 'text', lines: linesOf(str(o.result)) } : undefined,
        }
      default:
        return { title: toolName(tool), icon, target: firstText(i), meta: [] }
    }
  })()
  // An errored call's output is the error text the model read; a shell keeps its `$ command` above it.
  if (typeof output !== 'string') return { ...card, tint }
  const lines = linesOf(output)
  return { ...card, tint, body: card.body?.kind === 'shell' ? { ...card.body, output: lines, isError: true } : { kind: 'text', lines, isError: true } }
}

export const groupSummary = (calls: ReadonlyArray<{ tool: string }>) => {
  const counts = new Map<string, number>()
  for (const c of calls) counts.set(c.tool, (counts.get(c.tool) ?? 0) + 1)
  const text = [...counts]
    .map(([tool, n]) => {
      const verb = VERBS[tool]
      return verb ? `${verb[0]} ${plural(n, verb[1])}` : `${toolName(tool)} ×${n}`
    })
    .join(' · ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}
