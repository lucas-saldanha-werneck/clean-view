# Changelog

Versions are the `version` in `.claude-plugin/plugin.json`. Newest first.

## 0.4.0 (2026-11-18)

- The Stack row is a heading with the switch at its end: `Clean View ──── [● On]` (was `[ ● Clean View: ON ]`).
- The side-stack guest protocol now comes from `hooks/stack-guest.tsx`, a byte-identical copy of side-stack's (CI checks it).
- Rendering split by surface: one look for the terminal, one for the apps (desktop, mobile, VS Code). Both draw the same tree for now.

## 0.3.10 (2026-11-18)

- Draw in the side-stack pane again on Claude Code 2.1.327 and later, which hears only a plugin's own drawings unless the hook names `plugin: '*'`. Older builds keep working (the hook is registered both ways and the section is drawn once).

## 0.3.9 (2026-11-13)

- README: add an Examples section.

## 0.3.8 (2026-11-12)

- Decide hook refusals from the hooks' answers, create config.json exclusively.

## 0.3.7 (2026-11-12)

- Say 'hook error after X ran' for PostToolUse, accept UNC homes, pin CI.

## 0.3.6 (2026-11-11)

- Show a hook's refusal as one line while rows are hidden.

## 0.3.5 (2026-11-11)

- Point to the catalog repo's new name, `lucas-tools`.

## 0.3.4 (2026-11-11)

- Drop the pinned status line (Claude Code showed it with a warning sign); the toast at each flip stays.

## 0.3.3 (2026-11-11)

- Catalog renamed to `lucas-tools`.

## 0.3.2 (2026-11-09)

- One-line description, catalog install steps, README headings.

## 0.3.1 (2026-11-09)

- Real /clear: keep the switch on.

## 0.3.0 (2026-11-09)

- Rename quiet-tools to clean-view; side-stack protocol v4 section key and slot.

## 0.2.2 (2026-11-09)

- Survive a real /clear (side-stack = /stack listed; resync on a new session id).

## 0.2.1 (2026-11-09)

- Every render path tested on terminal and desktop; README says what differs.

## 0.2.0 (2026-11-09)

- Side-stack protocol v2 (host = flag and /stack listed, own stacked flag).

## 0.1.0 (2026-11-09)

- A switch that hides tool rows, works alone or inside side-stack.

