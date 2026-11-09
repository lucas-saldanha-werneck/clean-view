import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { CONFIG_EXAMPLE } from './config-example'

// quiet-tools: a switch that hides the tool rows of the transcript (ToolUse,
// ToolResult, ToolGroup) and blanks the "ctrl+b to run in background" pill
// (ToolProgress) while it is on. While it is off every hook passes the row on
// untouched.

export const STACK_PANE = 'side-stack'
export const STORE_KEY = 'enabled'
export const LABEL_ON = '● Quiet tools: ON'
export const LABEL_OFF = '○ Quiet tools: OFF'
export const STATUS_ON = 'Tool rows hidden · /quiet off shows them'

const enabledAtom = atom({ plugin: 'quiet-tools', key: 'enabled' } as const, false)
// Written by the side-stack host only; this mod reads it.
const hostAtom = atom({ plugin: 'side-stack', key: 'present' } as const, false)

// Module variables start over on a hot reload; the switch itself lives in
// $.state (survives a reload) and $.store (survives a restart).
let optionStartOn = false
let optionShowErrors = true
let fileStartOn: boolean | null = null
let fileShowErrors: boolean | null = null

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

/** $XDG_CONFIG_HOME/quiet-tools/config.json, else ~/.config/quiet-tools/config.json. */
async function settingsFile($: EngineInterface): Promise<string | undefined> {
  const xdg = await $.env.get('XDG_CONFIG_HOME')
  const h = await home($)
  const base = xdg !== undefined && isAbsolute(xdg) ? xdg : h !== undefined ? `${h}/.config` : undefined
  const file = base === undefined ? undefined : `${base}/quiet-tools/config.json`
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
    return (await read($, enabledAtom)) === true
  } catch {
    return false
  }
}

async function isStacked($: EngineInterface): Promise<boolean> {
  try {
    return (await read($, hostAtom)) === true
  } catch {
    return false
  }
}

function showStatus($: EngineInterface, value: boolean): void {
  try {
    $.ui.status(value ? STATUS_ON : undefined)
  } catch {
    // No surface to pin it on.
  }
}

async function setEnabled($: EngineInterface, value: boolean): Promise<void> {
  await update($, enabledAtom, () => value)
  try {
    await $.store.set(STORE_KEY, value)
  } catch {
    // The choice still holds for this session.
  }
  showStatus($, value)
  try {
    $.ui.toast(value ? 'Quiet tools on: tool rows are hidden.' : 'Quiet tools off: tool rows show again.')
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
async function restore($: EngineInterface): Promise<void> {
  let saved: unknown
  try {
    saved = await $.store.get(STORE_KEY)
  } catch {
    saved = undefined
  }
  const value = typeof saved === 'boolean' ? saved : startOn()
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

// ---- Hooks ---------------------------------------------------------------

export const register: Register = (on, options) => {
  optionStartOn = options?.start_on === true
  optionShowErrors = options?.show_errors !== false

  on('session.start', async ($, e, next) => {
    await seedSettings($)
    await loadSettings($)
    await restore($)
    await $.command.register({
      name: 'quiet',
      description: 'Hide or show the tool rows (no argument flips it)',
      argumentHint: 'on|off',
    })
    return next(e)
  })

  on('command.run', { command: 'quiet' }, async ($, e) => {
    await loadSettings($)
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') return { text: 'Use /quiet on, /quiet off, or /quiet alone to flip it.' }
    let value: boolean
    if (arg === '') value = await flip($)
    else {
      value = arg === 'on'
      await setEnabled($, value)
    }
    return { text: value ? 'Quiet tools is on: tool rows are hidden.' : 'Quiet tools is off: tool rows show.' }
  })

  // Hide the tool rows.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await isEnabled($)) || keepsShowing(e.props)) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await isEnabled($)) || keepsShowing(e.props)) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
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
      if (!(await isStacked($))) return below
      const { Box, Text, Button } = $.ui.resolve(e)
      const enabled = await isEnabled($)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text bold>Quiet tools </Text>
            <Button key="quiet-tools-toggle" label={enabled ? LABEL_ON : LABEL_OFF} onPress={() => flip($)} />
          </Box>
          {below}
        </Box>
      )
    } catch {
      // A broken section must never hide the others.
      return below
    }
  })
}
