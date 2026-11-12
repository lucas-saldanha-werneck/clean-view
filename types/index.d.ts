// No top-level export: this file stays a global declaration so the
// `declare module` block merges into the API types.
declare module 'claude-code' {
  interface PluginState {
    // Whether tool rows are hidden now. Kept in $.store too, so it survives a restart.
    // stacked: true while this mod draws its row into the side-stack pane (side-stack reads it).
    // hookFailures: the calls a hook refused (ran false) or blocked after they ran (ran true), by
    // tool_use_id, from the hooks' own answers; the reason is a short name for the hook.
    'clean-view': {
      enabled: boolean
      stacked: boolean
      loadedFor: string
      hookFailures: Record<string, { ran: boolean; reason: string }>
    }
    // The side-stack host's own flag. clean-view does not read it (it is session state, gone
    // after a /clear); it is declared for the tests' stand-in host, which sets it.
    'side-stack': { present: boolean }
  }
}
