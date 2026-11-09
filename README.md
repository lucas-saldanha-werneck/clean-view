# quiet-tools

A Claude Code mod with one switch: while it is on, the tool rows in the transcript (`Bash(...)`,
`Read 3 files`, `Update(...)`, their results and the "ctrl+b to run in background" pill) are hidden,
so you read only what you asked and what Claude answered. While it is off, nothing changes.

Works alone or inside side-stack: on its own it is a command and a status line; when the
[side-stack](https://github.com/lucas-saldanha-werneck/side-stack) mod runs, the switch is also a
one-row section of that shared pane.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install quiet-tools@lucas-plugins
```

If you have not added the `lucas-plugins` marketplace yet, add it first with
`/plugin marketplace add lucas-saldanha-werneck/claude-plugins`. You can also install from this repo
alone:

```
/plugin marketplace add lucas-saldanha-werneck/quiet-tools
/plugin install quiet-tools@quiet-tools
```

From a shell, the same commands work with `claude plugin` in place of `/plugin`. `/plugin` does not
run in the desktop app: install from a terminal with the user scope, and the mod also loads in the
desktop app's local Code sessions.

## Use

- `/quiet on` hides the tool rows, `/quiet off` shows them, `/quiet` alone flips the switch.
- While it is on, a status line under the prompt says `Tool rows hidden · /quiet off shows them`, so
  you do not forget. Each flip also shows a short toast.
- Your choice is saved and comes back in the next session and after a restart.
- It starts off, until you turn it on (see `start_on` below to change that).

What stays visible while it is on:

- **Failed tool calls.** A call that ended in an error, with its error, still shows, so you see when
  something went wrong (`show_errors`, on by default). A call you stopped with Esc is hidden like
  the rest.
- **The full transcript.** ctrl+o (and `--verbose`) still shows every row: the mod hides only the
  compact view.
- Everything else: your prompts, Claude's answers, questions, permission prompts.

## Works alone or inside side-stack

Claude Code shows separate panes as tabs, one at a time. The side-stack mod opens one shared pane so
several mods can draw in it one under the other.

- side-stack not running: quiet-tools opens no pane. You use `/quiet` and see the status line.
- side-stack running: the side-stack pane also gets one row, `Quiet tools [● Quiet tools: ON]`
  (or `○ Quiet tools: OFF`); pressing the button flips the switch. The other mods' sections stay
  beneath or above it. The order follows the order Claude Code loads the plugins in, which a mod
  cannot choose.

quiet-tools counts side-stack as running only when side-stack's `present` flag is true and its
`/stack` command is listed, so a leftover flag from a removed side-stack does not count. It checks
at session start (and again a second later), at every `/quiet` or button press, and each time the
pane is drawn. While it draws its row there it sets its own flag `{ plugin: 'quiet-tools', key:
'stacked' }` to true (false otherwise), which side-stack reads to hide its install hint.

## Terminal and desktop app

quiet-tools works the same in both: the tests draw every row it hides, the side-stack row and its
button on the `terminal` and `desktop` surfaces, and run `/quiet` and the status line in a session on
each. What differs:

- **The "ctrl+b to run in background" pill** exists in the terminal only, so blanking it applies
  there. The desktop app has no such pill; nothing replaces it and nothing is needed.
- **The button** is `[ ● Quiet tools: ON ]` in the terminal and a native button in the desktop app.
- **Showing every row again:** the terminal's ctrl+o transcript (and `--verbose`) tells the mod to
  show every row in full. Where a surface does not say whether a row is expanded, the row stays
  hidden while the switch is on, so in the desktop app use `/quiet off` to see the tool rows.
- **The status line and the toast** are the engine's own calls, not drawn by the mod. The API docs
  do not mark them terminal-only; how the desktop app shows them was not checked by hand.

## Settings

The first session creates `~/.config/quiet-tools/config.json` (or
`$XDG_CONFIG_HOME/quiet-tools/config.json`) with every key set to `null`, which means the default.
Plugin updates never rewrite that file.

| Key | Default | What it does |
| --- | --- | --- |
| `start_on` | off | `true`: tool rows start hidden until you first use `/quiet` or the button; after that your last choice is kept. `false`: they start shown. `null`: use the option in `/config`. Read at session start. |
| `show_errors` | on | `true`: while hidden, a failed tool call still shows, with its error. `false`: failed calls are hidden too. `null`: use the option in `/config`. |

Both are also in `/config` ("Start with tool rows hidden", "Keep failed tool rows visible"). A
`true` or `false` in the file wins over them.

## Uninstall

```
/plugin uninstall quiet-tools@lucas-plugins
```

## Limits and what was not tested

- Built and tested on Claude Code 2.1.319. It needs a version with mods (hooks modules).
- The tests draw the rows and the side-stack section on the `terminal` and `desktop` surfaces, with
  and without a stand-in for side-stack. Nobody has tried it by hand in the desktop app or on mobile
  yet.
- Headless runs (`claude -p`) draw no rows, so the switch has nothing to hide there.
- Tests: `claude plugin validate .` and `claude plugin test .` (CI runs both on Linux, macOS and
  Windows).

## Credits

The idea comes from the "Plain Answers" mod (Plain-English Claude Code) in the AI LABS video
[Claude Mods Are Insane... You Need To Try These Right Now](https://www.youtube.com/watch?v=ERNqRK6sMJY&t=701)
(11:41, 9 Oct 2026). Lucas Saldanha Werneck built his own version for himself (Clean View) and uses it
every day; this repo is its tool-row hiding part, cleaned up to stand alone. This code was written
separately with Claude Code.

## License

MIT. See `LICENSE`.

Built with Claude Code
