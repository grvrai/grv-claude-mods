# grv-claude-mods

Claude Code mods (function-hook plugins) that redraw the terminal UI in the style and dark palette of [oh-my-pi](https://github.com/can1357/oh-my-pi).

Built against Claude Code 2.1.303. The mod API is early access and may change between releases.

## Mods

### fold-tools

Every tool call is one line, oh-my-pi style: its icon, name, target and counts. Folded (the default):

```
» Reading notes.md and app.py
• Read 2 files
  ├─ ● Read: notes.md  6 lines
  └─ ● Read: app.py  3 lines
» Counting to five
❯ Bash: Count to five  5 lines
✎ Edit: out.txt ⟦+1/-1⟧
```

Click a call's icon and name to unfold it; its output hangs beneath on a rail:

```
❯ Bash: Count to five  5 lines
  │ $ seq 1 5
  ├─ Output
  │ 1
  │ …
  └ ⟦collapse⟧
```

- An unfolded call shows up to 10 lines of shell output (its tail), 40 diff lines or 12 lines of code or text; `⟦show all⟧` lifts the cap and `⟦collapse⟧` folds it back. `/fold open|close` opens or closes every call.
- A running call's icon is oh-my-pi's braille spinner; the rail is dim when a call succeeded, amber while it runs and red when it failed. Tool names are oh-my-pi's amber.
- Diffs use oh-my-pi's gutter (`-113│`), whole-line color and inverted changed words. Grep and Glob hang matches on `├─`/`└─` branches; a group of several calls is a line with a branch per call, each unfolding under it.
- Your own prompts sit in a rounded blue frame with a `❯` icon and their submission status: an animated `◴◷◶◵` clock while the prompt is queued behind a running turn, then `✓` once the engine hands it to Claude (at its next request, mid-turn included). A prompt pushed in early with ctrl+x ctrl+s reads queued until that request.
- Adds one system-prompt section asking Claude to write `» <intent>` (a 2–6-word present-participle phrase) before each tool call; that line is drawn as a bold heading above the calls.
- Spacing: one blank row above every call, group and intent, as Claude Code spaces the rows it draws itself.
- Left to Claude Code's own drawing: `AskUserQuestion` (see turn-questions) and `Agent` rows.

### turn-questions

- While a multi-question `AskUserQuestion` dialog is open, a frame above it lists every question at once.
- Once answered, the transcript row becomes a framed `? Ask` card with each answer on a `↳` line.
- When a turn ends, a band above the prompt collects every question of that turn: the answered dialog questions, plus the questions Claude wrote in its reply (`○`). It hides while Claude works, is replaced at the end of the next turn, and `✕` dismisses it.

### session-sidebar

A docked sidebar (`Session`) on the right, with a rounded card for each of subagents, todos and changed files that has something to show.

```
╭─ TODOS · 1/2 ─────────────────╮
│ ○ Style the cards             │
│ ✔ Build the bar               │
╰───────────────────────────────╯

╭─ FILES · 1 changed ───────────╮
│ A out.txt                  +3 │
╰───────────────────────────────╯
```

- **SUBAGENTS**: each subagent's type, task, status and run time. Click one to show its transcript; `← back to main` returns.
- **TODOS**: live from `TaskCreate`/`TaskUpdate`/`TodoWrite`, seeded from `TaskList` on the first turn.
- **FILES**: files edited (`M`) or created (`A`) with `+N -M` counts, plus how many files were read. Click a path to copy it.

It opens by itself once a subagent, todo or changed file exists, closes when none is left, and only where the terminal docks panes (fullscreen, 110+ columns), asking for 34 columns. Closing it (`✕` or `/sidebar`) keeps it closed until `/sidebar` opens it again. The divider and the dock area are Claude Code's own; a dock width you have dragged is kept (`pluginPanes.dockColumns` in `~/.claude.json`) and wins over the request.

### context-bar

oh-my-pi's bar in the row under the prompt: the model and effort level, a rule that is the context gauge, the rate-limit windows, and two buttons.

```
❯ _
───────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle)
  ⟦☰⟧ ⬢ Opus 5.5 · ◕ xhigh › ◫ ━━━━━━━━━ 57% ────────── 1M ─ › 5h 40% · 7d 12% ⟦⊟⟧
```

- The lit share is the context used, its percent set right after it, the window size at the end. It turns yellow, purple and red at oh-my-pi's thresholds (50/70/90%, or 150k/270k/500k tokens, whichever comes first); the rate-limit windows color the same way.
- `⟦☰⟧` runs `/background`: the session keeps running and the terminal shows the agents list, as `←` at an empty prompt does.
- `⟦⊟⟧` compacts the conversation, as `/compact` does; it rests while Claude is working.
- Model and effort come from each model request; before the first, the model is the session's and effort is `effortLevel` from settings. `/model` and `/effort` refresh them.

## Requirements

- Clicking cards and sidebar rows needs a terminal that reports the mouse, which is the fullscreen TUI (`"tui": "fullscreen"`).
- Colors are oh-my-pi's dark palette (amber accent, cyan-blue gauge, blue frames), tuned for dark terminal themes.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install fold-tools --marketplace grvrai/grv-claude-mods
/plugin install turn-questions --marketplace grvrai/grv-claude-mods
/plugin install session-sidebar --marketplace grvrai/grv-claude-mods
/plugin install context-bar --marketplace grvrai/grv-claude-mods
```

After `claude plugin update`, run `/reload-plugins` in each open session to load the new versions; new sessions load them by themselves.

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install fold-tools --marketplace grvrai/grv-claude-mods
```

This repository is private. Installing it needs read access on GitHub and a git credential for github.com on that machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Develop

```
claude plugin validate ./fold-tools
claude plugin test ./fold-tools
claude --plugin-dir ./fold-tools
```
