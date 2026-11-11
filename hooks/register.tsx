import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { CONFIG_EXAMPLE } from './config-example'

// clean-view: a switch that hides the tool rows of the transcript (ToolUse,
// ToolResult, ToolGroup) and blanks the "ctrl+b to run in background" pill
// (ToolProgress) while it is on. While it is off every hook passes the row on
// untouched.

export const STACK_PANE = 'side-stack'
// side-stack protocol v4: the section's key, and the key of the empty slot side-stack leaves
// for it when the person has set an order (`/stack order ...`).
export const SECTION_KEY = 'side-stack:clean-view'
export const SLOT_KEY = 'side-stack:slot:clean-view'
export const STORE_KEY = 'enabled'
export const LABEL_ON = '● Clean View: ON'
export const LABEL_OFF = '○ Clean View: OFF'

const enabledAtom = atom({ plugin: 'clean-view', key: 'enabled' } as const, false)
// Written by this mod: true while it draws its row into the side-stack pane.
// side-stack reads it to hide its install hint.
const stackedAtom = atom({ plugin: 'clean-view', key: 'stacked' } as const, false)
// The session id the switch was loaded under. Kept in state, not in the module:
// on a real /clear, events can reach the mod under the new id BEFORE the state is
// emptied (seen on 2.1.319), and a marker in the module would then say "loaded"
// for a state that is gone. In state it vanishes with the switch, so the next
// event loads again.
const loadedForAtom = atom({ plugin: 'clean-view', key: 'loadedFor' } as const, '')
// Plugin load order is unknown: look for the host soon after start, and once more a second later.
const HOST_CHECKS_MS = [100, 1100]

// Module variables start over on a hot reload; the switch itself lives in
// $.state (survives a reload) and $.store (survives a restart).
let optionStartOn = false
let optionShowErrors = true
let fileStartOn: boolean | null = null
let fileShowErrors: boolean | null = null
// The session watch: started once per process, it outlives a /clear.
let watching = false
const WATCH_MS = 1500

const startOn = (): boolean => fileStartOn ?? optionStartOn
const showErrors = (): boolean => fileShowErrors ?? optionShowErrors

// ---- Settings file -------------------------------------------------------

async function home($: EngineInterface): Promise<string | undefined> {
  // Windows does not set HOME unless a shell like Git Bash does; it sets USERPROFILE.
  let h = await $.env.get('HOME')
  if (h === undefined || h === '') h = await $.env.get('USERPROFILE')
  return h !== undefined && h !== '' ? h : undefined
}

// POSIX /x, Windows C:\x or C:/x. A relative path would land in the session's folder.
const isAbsolute = (p: string): boolean => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)

/** $XDG_CONFIG_HOME/clean-view/config.json, else ~/.config/clean-view/config.json. */
async function settingsFile($: EngineInterface): Promise<string | undefined> {
  const xdg = await $.env.get('XDG_CONFIG_HOME')
  const h = await home($)
  const base = xdg !== undefined && isAbsolute(xdg) ? xdg : h !== undefined ? `${h}/.config` : undefined
  const file = base === undefined ? undefined : `${base}/clean-view/config.json`
  return file !== undefined && isAbsolute(file) ? file : undefined
}

/** First run: writes the starter file with every key null. A file that is there is never rewritten. */
async function seedSettings($: EngineInterface): Promise<void> {
  try {
    const file = await settingsFile($)
    if (file === undefined || (await $.fs.exists(file))) return
    await $.fs.write(file, CONFIG_EXAMPLE)
  } catch {
    // Never get in the way of starting a session.
  }
}

/** Reads start_on and show_errors: true, false, or null for "use the option". */
async function loadSettings($: EngineInterface): Promise<void> {
  fileStartOn = null
  fileShowErrors = null
  try {
    const file = await settingsFile($)
    if (file === undefined) return
    const parsed: unknown = JSON.parse(await $.fs.read(file))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const { start_on, show_errors } = parsed as Record<string, unknown>
    if (typeof start_on === 'boolean') fileStartOn = start_on
    if (typeof show_errors === 'boolean') fileShowErrors = show_errors
  } catch {
    // Missing or broken file: the options.
  }
}

// ---- The switch ----------------------------------------------------------

async function isEnabled($: EngineInterface): Promise<boolean> {
  try {
    // Between a /clear and the resync the state is empty: draw from the saved
    // choice, so the rows and the switch do not flip to "off" in that window.
    if (await isNewSession($)) return await savedChoice($)
    return (await read($, enabledAtom)) === true
  } catch {
    return false
  }
}

/** The /stack command is listed and side-stack added it (plugin may carry @marketplace). */
async function hostCommandListed($: EngineInterface): Promise<boolean> {
  try {
    const commands = await $.command.list()
    return commands.some(c => c.name === 'stack' && c.plugin?.split('@')[0] === 'side-stack')
  } catch {
    return false
  }
}

/**
 * side-stack runs: its /stack command is listed. That alone: its `present` flag is session
 * state, gone after a /clear (new session id, no session.start), so it is not required.
 */
async function isStacked($: EngineInterface): Promise<boolean> {
  return hostCommandListed($)
}

// ---- A /clear: same process, new session id, no session.start -----------

async function currentSessionId($: EngineInterface): Promise<string | undefined> {
  try {
    return await $.session.id()
  } catch {
    return undefined
  }
}

async function loadedFor($: EngineInterface): Promise<string> {
  try {
    return await read($, loadedForAtom)
  } catch {
    return ''
  }
}

/** True when the session id differs from the one the switch was loaded under. */
async function isNewSession($: EngineInterface): Promise<boolean> {
  const id = await currentSessionId($)
  return id !== undefined && id !== (await loadedFor($))
}

/**
 * After a /clear (or a hot reload, which resets module variables): reload the switch from
 * $.store, re-check side-stack and re-publish the stacked flag.
 */
async function resyncIfNewSession($: EngineInterface): Promise<void> {
  const id = await currentSessionId($)
  if (id === undefined || id === (await loadedFor($))) return
  // The id is recorded only once the switch is back in state: a resync whose
  // writes were refused (say, from a timer that runs as part of a drawing) is
  // tried again on the next event or watch tick.
  await restore($)
  await update($, loadedForAtom, () => id)
  await syncStacked($)
}

/** From a render hook, which may not write state: resync just after the draw. */
async function scheduleResync($: EngineInterface): Promise<void> {
  if (await isNewSession($)) $.clock.after(0, () => void resyncIfNewSession($).catch(() => undefined))
}

/** Publishes the stacked flag from a live check. Never called while drawing (a render hook never writes). */
async function syncStacked($: EngineInterface): Promise<boolean> {
  const value = await isStacked($)
  try {
    if ((await read($, stackedAtom)) !== value) await update($, stackedAtom, () => value)
  } catch {
    // Not published; the next check tries again.
  }
  return value
}

/** No status line under the prompt: the toast at each flip is enough. Clears one an older version pinned. */
function showStatus($: EngineInterface, _value: boolean): void {
  try {
    $.ui.status(undefined)
  } catch {
    // No surface to pin it on.
  }
}

async function setEnabled($: EngineInterface, value: boolean): Promise<void> {
  await syncStacked($)
  await update($, enabledAtom, () => value)
  try {
    await $.store.set(STORE_KEY, value)
  } catch {
    // The choice still holds for this session.
  }
  showStatus($, value)
  try {
    $.ui.toast(value ? 'Clean View on: tool rows are hidden.' : 'Clean View off: tool rows show again.')
  } catch {
    // No surface to show it on.
  }
}

/** Flips the switch from what it is now, never from a value captured at draw time. */
async function flip($: EngineInterface): Promise<boolean> {
  const value = !(await isEnabled($))
  await setEnabled($, value)
  return value
}

/** The person's last choice (in $.store) wins; with none yet, start_on decides. */
/** The last choice from $.store, or the start_on setting when there is none. */
async function savedChoice($: EngineInterface): Promise<boolean> {
  let saved: unknown
  try {
    saved = await $.store.get(STORE_KEY)
  } catch {
    saved = undefined
  }
  return typeof saved === 'boolean' ? saved : startOn()
}

async function restore($: EngineInterface): Promise<void> {
  const value = await savedChoice($)
  await update($, enabledAtom, () => value)
  showStatus($, value)
}

/** Whether a row is still shown while the switch is on. */
function keepsShowing(props: { isExpanded?: boolean; isErrored?: boolean; isInterrupted?: boolean }): boolean {
  // The ctrl+o transcript and --verbose ask for every row in full.
  if (props.isExpanded === true) return true
  // Esc is the person's own doing, not an error worth showing.
  return showErrors() && props.isErrored === true && props.isInterrupted !== true
}

// ---- The side-stack slot (protocol v4) ------------------------------------

type El = { type?: unknown; props?: Record<string, unknown>; children?: unknown }

const isSlot = (node: unknown): boolean =>
  node !== null && typeof node === 'object' && (node as El).props?.key === SLOT_KEY

/**
 * Returns a copy of `tree` with side-stack's empty slot for this section replaced by
 * `section`, or undefined when the tree holds no such slot (then the section goes on top).
 */
export function fillSlot(tree: unknown, section: unknown): unknown {
  if (isSlot(tree)) return section
  const el = tree as El | null
  if (el === null || typeof el !== 'object' || !Array.isArray(el.children)) return undefined
  for (let i = 0; i < el.children.length; i++) {
    const child: unknown = el.children[i]
    const swapped = isSlot(child) ? section : fillSlot(child, section)
    if (swapped !== undefined) {
      const children = [...el.children]
      children[i] = swapped
      return { ...el, children }
    }
  }
  return undefined
}

// ---- Hooks ---------------------------------------------------------------

export const register: Register = (on, options) => {
  optionStartOn = options?.start_on === true
  optionShowErrors = options?.show_errors !== false

  on('session.start', async ($, e, next) => {
    await seedSettings($)
    await loadSettings($)
    await restore($)
    {
      const id = await currentSessionId($)
      if (id !== undefined) await update($, loadedForAtom, () => id)
    }
    if (!watching) {
      try {
        $.clock.every(WATCH_MS, () => {
          void resyncIfNewSession($).catch(() => undefined)
        })
        watching = true
      } catch {
        // The next prompt, turn or /quiet resyncs it.
      }
    }
    await $.command.register({
      name: 'quiet',
      description: 'Hide or show the tool rows (no argument flips it)',
      argumentHint: 'on|off',
    })
    for (const ms of HOST_CHECKS_MS) {
      $.clock.after(ms, () => {
        void syncStacked($).catch(() => undefined)
      })
    }
    return next(e)
  })

  // A /clear fires no session.start: catch the new session id on the next prompt or turn.
  on('prompt.submit', async ($, e, next) => {
    await resyncIfNewSession($)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('turn.start', async ($, e, next) => {
    await resyncIfNewSession($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'quiet' }, async ($, e) => {
    await resyncIfNewSession($)
    await loadSettings($)
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') return { text: 'Use /quiet on, /quiet off, or /quiet alone to flip it.' }
    let value: boolean
    if (arg === '') value = await flip($)
    else {
      value = arg === 'on'
      await setEnabled($, value)
    }
    return { text: value ? 'Clean View is on: tool rows are hidden.' : 'Clean View is off: tool rows show.' }
  })

  // Hide the tool rows.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    await scheduleResync($)
    if (!(await isEnabled($)) || keepsShowing(e.props)) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    await scheduleResync($)
    if (!(await isEnabled($)) || keepsShowing(e.props)) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    await scheduleResync($)
    if (!(await isEnabled($))) return next(e)
    const failed = e.props.calls.some(call => call.isErrored && !call.isInterrupted)
    if (keepsShowing({ isExpanded: e.props.isExpanded, isErrored: failed })) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })
  // The background pill under a running call: blank while its row is hidden.
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (!(await isEnabled($))) return next(e)
    return next({ ...e, props: { ...e.props, hint: '' } })
  })

  // With the side-stack host: a one-row section in its shared pane, then every other section beneath.
  on('ui.render', { component: 'Pane', requestId: STACK_PANE }, async ($, e, next) => {
    const below = await next(e)
    try {
      await scheduleResync($)
      const stacked = await isStacked($)
      // Drawing may not write state: the flag is put right just after, outside the draw.
      const published = await read($, stackedAtom)
      if (published !== stacked) $.clock.after(0, () => void syncStacked($).catch(() => undefined))
      if (!stacked) return below
      const { Box, Text, Button } = $.ui.resolve(e)
      const enabled = await isEnabled($)
      const section = (
        <Box key={SECTION_KEY} flexDirection="row">
          <Text bold>Clean View </Text>
          <Button key="clean-view-toggle" label={enabled ? LABEL_ON : LABEL_OFF} onPress={() => flip($)} />
        </Box>
      )
      // side-stack may have left a slot for this section in the order the person chose.
      const filled = fillSlot(below, section)
      if (filled !== undefined) return filled as typeof below
      return (
        <Box flexDirection="column">
          {section}
          {below}
        </Box>
      )
    } catch {
      // A broken section must never hide the others.
      return below
    }
  })
}
