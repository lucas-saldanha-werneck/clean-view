# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Open the repository's
[Security tab](https://github.com/lucas-saldanha-werneck/clean-view/security) and choose
"Report a vulnerability" (GitHub private vulnerability reporting).

## Supported versions

Only the latest release is supported. Fixes land there.

## What this plugin accesses

- It runs inside Claude Code's mod host and changes only how tool rows are drawn in the transcript; nothing Claude does is changed or blocked.
- Files: it reads and creates `~/.config/clean-view/config.json`; the on/off choice is kept in the mod's own plugin store.
- Processes: one short `sh -c` call to create the config file without overwriting an existing one.
- Network: the plugin's own code makes no network requests, and it does not read transcripts or secrets.

