# grv-claude-mods

Claude Code mods (function-hook plugins) that redraw the terminal UI in the style of [oh-my-pi](https://github.com/can1357/oh-my-pi).

Built against Claude Code 2.1.303. The mod API is early access and may change between releases.

## Mods

### fold-tools

Tool calls are drawn as oh-my-pi cards:

```
» Counting to thirty
╭─── ❯ Bash: Count to thirty  30 lines ─────────────────────╮
│ $ seq 1 30                                                 │
├─── Output ─────────────────────────────────────────────────┤
│ 28                                                         │
│ 29                                                         │
│ 30                                                         │
╰─── … 27 more earlier lines ⟦expand⟧ ───────────────────────╯
» Replacing line 3 in out.txt
╭─── ✎ Edit: out.txt ⟦+1/-1⟧ ────────────────────────────────╮
│    2│line 2                                                │
│ -  3│line 3                                                │
│ +   │line three                                            │
╰────────────────────────────────────────────────────────────╯
• Read 2 files
  ├─ ● Read: notes.md  6 lines
  └─ ● Read: app.py  3 lines
🔍 Grep: alpha  3 matches
  ├─ notes.md:3:alpha beta
  └─ app.py:2:    print("alpha")
```

- Bash, Edit, Create, Fetch and failed calls are framed, with the header set into the top rule and a folded preview (3 lines; 8 for diffs). The bottom rule's footer steps `⟦expand⟧` → `⟦show all⟧` → `⟦collapse⟧`; clicking a card's icon and title toggles it too.
- Diffs use oh-my-pi's gutter (`-113│`), whole-line color and inverted changed words. Read is one line and frames its code once opened. Grep and Glob hang matches on `├─`/`└─` branches; a group of several calls lists them as branches.
- Borders are dim when a call succeeded, amber while it runs and red when it failed, on oh-my-pi's tinted card backgrounds.
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

It opens by itself only where the terminal docks panes (fullscreen, 110+ columns), asking for 34 columns. `/sidebar` shows or hides it. A dock width you have dragged is kept by Claude Code (`pluginPanes.dockColumns` in `~/.claude.json`) and wins over that request.

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
