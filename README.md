# grv-claude-mods

Claude Code mods (function-hook plugins) that redraw the terminal UI in the style of [oh-my-pi](https://github.com/can1357/oh-my-pi).

Built against Claude Code 2.1.303. The mod API is early access and may change between releases.

## Mods

### fold-tools

Tool calls become one-line cards, folded by default:

```
» Reading model role settings
● Read: account/models.py  840 lines
✎ Edit: account/models.py ⟦+4/-1⟧
❯ Bash: docker compose ps  12 lines
• Read 3 files · searched 1 pattern
```

- Click a card to unfold it. Diffs use oh-my-pi's gutter (`-113│`), whole-line color and inverted changed words. Bash shows `$ command`, an `Output` rule and the last 10 lines. Grep and Glob hang their matches on `├─`/`└─` branches.
- Long bodies stop at a preview; `⟦show all⟧` lifts the cap.
- `/fold open` and `/fold close` open or close every card; `/fold` toggles.
- Adds one system-prompt section asking Claude to write `» <intent>` (a 2–6-word present-participle phrase) before each tool call. That line is drawn as the bold heading of the cards that follow.
- Left to Claude Code's own drawing: `AskUserQuestion` (see turn-questions) and `Agent` rows.

### turn-questions

- While a multi-question `AskUserQuestion` dialog is open, a frame above it lists every question at once.
- Once answered, the transcript row becomes a framed `? Ask` card with each answer on a `↳` line.
- When a turn ends, a band above the prompt collects every question of that turn: the answered dialog questions, plus the questions Claude wrote in its reply (`○`). It hides while Claude works, is replaced at the end of the next turn, and `✕` dismisses it.

### session-sidebar

A docked pane (`Session`) with three sections:

- **SUBAGENTS**: each subagent's type, task, status and run time. Click one to show its transcript; `← back to main` returns.
- **TODOS**: live from `TaskCreate`/`TaskUpdate`/`TodoWrite`, seeded from `TaskList` on the first turn.
- **FILES**: files edited (`M`) or created (`A`) with `+N -M` counts, plus how many files were read. Click a path to copy it.

It opens by itself only where the terminal docks panes (fullscreen, 110+ columns). `/sidebar` shows or hides it.

## Requirements

- Clicking cards and sidebar rows needs a terminal that reports the mouse, which is the fullscreen TUI (`"tui": "fullscreen"`).
- Colors are oh-my-pi's dark palette, tuned for dark terminal themes.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install fold-tools --marketplace grvrai/grv-claude-mods
/plugin install turn-questions --marketplace grvrai/grv-claude-mods
/plugin install session-sidebar --marketplace grvrai/grv-claude-mods
```

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
