// The starter settings file. On the first session with no settings file,
// clean-view writes this text to ~/.config/clean-view/config.json (or
// $XDG_CONFIG_HOME/clean-view/config.json). Every key is null, which means
// "use the default", so the file changes nothing until you edit it. A file that
// is already there is never rewritten.
export const CONFIG_EXAMPLE = `{
  "_doc": {
    "about": "Your clean-view settings. Plugin updates never touch this file. null means the default. Keys that start with _ are ignored.",
    "start_on": "true: tool rows start hidden until you first use /quiet or the switch; after that your last choice is kept. false: they start shown. null (default): use the start_on option in /config, which is off unless you turn it on. Read at session start.",
    "show_errors": "true: while tool rows are hidden, a tool call that failed still shows, with its error. false: failed calls are hidden too. null (default): use the show_errors option in /config, which is on."
  },
  "start_on": null,
  "show_errors": null
}
`
