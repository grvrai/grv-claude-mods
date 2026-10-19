# grv-claude-mods

Five small mods that make Claude Code's terminal easier to read, in the look and dark palette of [oh-my-pi](https://github.com/can1357/oh-my-pi).

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
❯ fix the login test                                 2:40 AM ✓ ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
» Reading the test file
● Read: tests/login.test.ts  48 lines
» Fixing the assertion
✎ Edit: tests/login.test.ts ⟦+1/-1⟧
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
⏺ Fixed: the test expected the old redirect path.      2:41 AM ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

  ⟦☰⟧ ⬢ Opus 5.5 · ◕ xhigh › ◫ ━━━━━ 57% 570k ────── 1M ─ › 5h 40% · 7d 12% ⟦◨⟧ ⟦⊟⟧
```

## The mods

| Mod | What you get |
| --- | --- |
| **fold-tools** | Every tool call is one tidy line; click it, or the `▸` its icon turns into when you point at it, to see the output or diff. Claude writes a short `» intent` above its calls. Your messages and Claude's are framed and timestamped, and your prompt shows `◴` while queued, `✓` once sent. |
| **turn-questions** | Every question Claude asked in a turn, collected in one framed list above the prompt, so none get lost. |
| **session-sidebar** | A sidebar with subagents, todos and changed files. It appears only when there is something to show; `/sidebar` toggles it. |
| **agent-sidebar** | An `Agents` tab beside the sidebar listing every background agent on your machine, grouped like Claude Code's agent view (working, needs input, done), with age and folder. Click one to open the agent view; `/fleet` toggles it. |
| **context-bar** | A bar under the prompt: model, effort, a context gauge with percent and tokens, rate limits, plus buttons for the agents list `⟦☰⟧`, the sidebar `⟦◨⟧` and compact `⟦⊟⟧`. |

Handy: `/fold open` / `/fold close` unfolds or folds every tool call at once.

## Install

Copy this prompt and paste it into Claude Code:

```text
Install the Claude Code mods from https://github.com/grvrai/grv-claude-mods for me:

1. Add the marketplace: claude plugin marketplace add grvrai/grv-claude-mods
2. Install all five mods (user scope):
   claude plugin install fold-tools@grv-claude-mods
   claude plugin install turn-questions@grv-claude-mods
   claude plugin install session-sidebar@grv-claude-mods
   claude plugin install agent-sidebar@grv-claude-mods
   claude plugin install context-bar@grv-claude-mods
3. Clicking cards needs the fullscreen terminal UI. Check ~/.claude/settings.json for "tui": "fullscreen" and, if it is missing, ask me before adding it.
4. context-bar shows context and rate limits under the prompt. If I already have a "statusLine" in my settings, ask me whether to keep it.
5. If the repo cannot be read (it is private), tell me to get access and run `gh auth login`, then `gh auth setup-git`.
6. When done, tell me to run /reload-plugins in any open session.
```

Or by hand, in a shell:

```sh
claude plugin marketplace add grvrai/grv-claude-mods
for m in fold-tools turn-questions session-sidebar agent-sidebar context-bar; do claude plugin install $m@grv-claude-mods; done
```

Then run `/reload-plugins` in any open session (new sessions pick the mods up by themselves).

## Update

```sh
claude plugin marketplace update grv-claude-mods
for m in fold-tools turn-questions session-sidebar agent-sidebar context-bar; do claude plugin update $m@grv-claude-mods; done
```

Then `/reload-plugins` again.

## Good to know

- Needs a recent Claude Code (built against 2.1.303). The mod API is early access, so a Claude Code update can change things.
- Colors are tuned for dark terminal themes.
- The repo is private: installing needs read access on GitHub and a git credential on the machine.

## Develop

```sh
claude plugin validate ./fold-tools   # check a mod
claude plugin test ./fold-tools       # run its tests
claude --plugin-dir ./fold-tools      # try it live without installing
```
