// No top-level export: this file stays a global declaration so the
// `declare module` block merges into the API types.
declare module 'claude-code' {
  interface PluginState {
    // Whether tool rows are hidden now. Kept in $.store too, so it survives a restart.
    'quiet-tools': { enabled: boolean }
    // Read only: the side-stack host sets this to true when it runs.
    'side-stack': { present: boolean }
  }
}
