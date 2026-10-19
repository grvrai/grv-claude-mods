import { readFileSync } from 'node:fs'

import { barOf } from './hooks/gauge.ts'
import type { Run } from './hooks/gauge.ts'

// Claude Code's status line command: its JSON in on stdin, one truecolor line out.
const rgb = (hex: string) => (hex.match(/[0-9a-f]{2}/gi) ?? []).map(h => parseInt(h, 16)).join(';')
const paint = (r: Run) => `\x1b[38;2;${rgb(r.color)}m${r.text}`

const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
process.stdout.write(`${barOf(input, Number(process.env.COLUMNS) || 120).map(paint).join('')}\x1b[0m\n`)
