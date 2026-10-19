import type { Register } from 'claude-code'

const COMMAND = 'node ~/.claude/plugins/marketplaces/grv-claude-mods/context-bar/statusline.ts'

// The bar is drawn as Claude Code's status line, right under the prompt; this says how once it is not set up.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const line = (await $.settings.read()).statusLine as { command?: unknown } | undefined
    if (typeof line?.command !== 'string' || !line.command.includes('context-bar/statusline')) {
      $.ui.toast(`context-bar: set "statusLine": { "type": "command", "command": "${COMMAND}" } in ~/.claude/settings.json`)
    }
    return started
  })
}
