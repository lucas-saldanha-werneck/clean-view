import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CONFIG_EXAMPLE } from '../hooks/config-example'
import { LABEL_OFF, LABEL_ON, STATUS_ON } from '../hooks/register'

// On Windows the engine resolves a drive-less absolute path onto the current
// drive with backslashes (D:\home\u\...). Compare paths in POSIX form.
const posix = (p: string): string => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
const CONFIG = '/home/u/.config/quiet-tools/config.json'
const SURFACES = ['terminal', 'desktop'] as const

type World = {
  writes: { path: string; text: string }[]
  store: Record<string, unknown>
  statuses: (string | undefined)[]
  toasts: string[]
  clock: ReturnType<typeof mock.clock>
}

type Setup = {
  /** Files by POSIX path. A path not listed does not exist. */
  files?: Record<string, string>
  /** What $.store holds at the start. */
  store?: Record<string, unknown>
}

// A stand-in for the side-stack host. The kit loads an inline plugin from its
// source alone, so it is spelled out with no outside variables.
const HOST: Plugin = {
  name: 'side-stack',
  register: on => {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'side-stack', key: 'present' }, true)
      await $.command.register({ name: 'stack', description: 'Open the Stack side pane' })
      return next(e)
    })
  },
}

/** A stale host: its present flag says true, but its /stack command is not listed (removed, or a leftover). */
const STALE_HOST: Plugin = {
  name: 'side-stack',
  register: on => {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'side-stack', key: 'present' }, true)
      return next(e)
    })
  },
}

// The engine knows which plugin registered a command; the event does not say,
// so this stand-in names the owner from the command's name, as a marketplace
// install shows it (name@marketplace).
const OWNERS: Record<string, string> = { stack: 'side-stack', quiet: 'quiet-tools' }

/** Another plugin reading quiet-tools' stacked flag, as side-stack does (the test's own $ has no state noun). */
const READER: Plugin = {
  name: 'idea-shelf',
  register: on => {
    on('session.start', async ($, e, next) => {
      await $.command.register({ name: 'qtstacked', description: 'test: read quiet-tools.stacked' })
      return next(e)
    })
    on('command.run', { command: 'qtstacked' }, async $ => {
      const { value } = await $.state.get({ plugin: 'quiet-tools', key: 'stacked' })
      return { text: 'stacked=' + String(value ?? false) }
    })
  },
}

async function stackedFlag($: Engine): Promise<boolean> {
  const ran = JSON.stringify(await $.command.run({ command: 'qtstacked', args: '' } as never))
  return ran.includes('stacked=true')
}

/** The world beneath the plugin: files, store, status line, toasts, and the engine's own rows. */
async function boot($: Engine, on: On, setup: Setup = {}): Promise<World> {
  const files = { ...(setup.files ?? {}) }
  const world: World = { writes: [], store: { ...(setup.store ?? {}) }, statuses: [], toasts: [], clock: mock.clock(on, { now: 1_000_000 }) }
  mock.env(on, { HOME: '/home/u' })
  on('fs.exists', async (_$, e) => ({ value: posix((e as { path: string }).path) in files }) as never)
  on('fs.read', async (_$, e) => {
    const path = posix((e as { path: string }).path)
    if (!(path in files)) throw new Error(`ENOENT: ${path}`)
    return { value: files[path] } as never
  })
  on('fs.write', async (_$, e) => {
    const w = e as { path: string; text: string }
    world.writes.push({ path: posix(w.path), text: w.text })
    files[posix(w.path)] = w.text
    return { value: undefined } as never
  })
  on('store.get', async (_$, e) => ({ value: world.store[(e as { key: string }).key] }) as never)
  on('store.set', async (_$, e) => {
    const s = e as { key: string; value: unknown }
    world.store[s.key] = s.value
    return { value: undefined } as never
  })
  on('ui.status', async (_$, e) => {
    world.statuses.push((e as { text?: string }).text)
    return { value: undefined } as never
  })
  on('ui.toast', async (_$, e) => {
    world.toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const commands: { name: string; description: string }[] = []
  on('command.register', (_$, e) => {
    commands.push({ name: e.name, description: e.description })
    return { value: { command: e.name } }
  })
  on('command.list', async () => ({
    value: commands.map(c => ({ ...c, source: 'plugin', plugin: `${OWNERS[c.name] ?? 'unknown'}@lucas-plugins` })),
  }) as never)
  // What the engine draws for each row, beneath the plugin.
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>ROW {e.props.tool}</Text>
  })
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>RESULT {e.props.tool}</Text>
  })
  on('ui.render', { component: 'ToolGroup' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>GROUP {e.props.calls.length}</Text>
  })
  on('ui.render', { component: 'ToolProgress' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>PILL[{e.props.hint}]</Text>
  })
  on('ui.render', { component: 'Pane', requestId: 'side-stack' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>HOST-AND-OTHERS</Text>
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  return world
}

async function quiet($: Engine, args = ''): Promise<string> {
  return JSON.stringify(await $.command.run({ command: 'quiet', args } as never))
}

type Row =
  | { component: 'ToolUse'; props: Record<string, unknown> }
  | { component: 'ToolResult'; props: Record<string, unknown> }
  | { component: 'ToolGroup'; props: Record<string, unknown> }
  | { component: 'ToolProgress'; props: Record<string, unknown> }

const toolUse = (extra: Record<string, unknown> = {}): Row => ({
  component: 'ToolUse',
  props: { tool_use_id: 'tu1', tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false, output: { stdout: '' }, ...extra },
})
const toolResult = (extra: Record<string, unknown> = {}): Row => ({
  component: 'ToolResult',
  props: { tool_use_id: 'tu1', tool: 'Bash', output: { stdout: '' }, isErrored: false, ...extra },
})
const call = (extra: Record<string, unknown> = {}) => ({ tool_use_id: 'r1', tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false, ...extra })
const toolGroup = (calls = [call(), call({ tool_use_id: 'r2' })], extra: Record<string, unknown> = {}): Row => ({
  component: 'ToolGroup',
  props: { calls, isActive: false, isExpanded: false, ...extra },
})
const progress = (): Row => ({
  component: 'ToolProgress',
  props: { tool_use_id: 'tu1', kind: 'background_hint', hint: '(ctrl+b to run in background)' },
})

/** The texts a row draws through the plugin, on one surface. */
async function draw($: Engine, row: Row, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string> {
  const requestId = String((row.props as { tool_use_id?: string }).tool_use_id ?? 'g1')
  const ui = await $.ui.mount({ plugin: 'quiet-tools', surface, requestId, ...row } as never)
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()
  return texts.join('\n')
}

async function paneTexts($: Engine, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string[]> {
  const ui = await $.ui.mount({
    plugin: 'quiet-tools',
    surface,
    component: 'Pane',
    requestId: 'side-stack',
    props: { title: 'Stack', isFocused: false, bodyColumns: 44, placement: 'dock' } as never,
  })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()
  return texts
}

describe('hiding', () => {
  test('on: ToolUse, ToolResult and ToolGroup are hidden, the pill is blank', async ($, on) => {
    await boot($, on)
    await quiet($, 'on')
    for (const surface of SURFACES) {
      expect(await draw($, toolUse(), surface)).not.toContain('ROW')
      expect(await draw($, toolResult(), surface)).not.toContain('RESULT')
      expect(await draw($, toolGroup(), surface)).not.toContain('GROUP')
    }
    expect(await draw($, progress())).toBe('PILL[]')
  })

  test('off (the default): every row passes through untouched', async ($, on) => {
    await boot($, on)
    for (const surface of SURFACES) {
      expect(await draw($, toolUse(), surface)).toBe('ROW Bash')
      expect(await draw($, toolResult(), surface)).toBe('RESULT Bash')
      expect(await draw($, toolGroup(), surface)).toBe('GROUP 2')
    }
    expect(await draw($, progress())).toBe('PILL[(ctrl+b to run in background)]')
  })

  test('on: the ctrl+o transcript (isExpanded) still shows every row', async ($, on) => {
    await boot($, on)
    await quiet($, 'on')
    expect(await draw($, toolUse({ isExpanded: true }))).toBe('ROW Bash')
    expect(await draw($, toolResult({ isExpanded: true }))).toBe('RESULT Bash')
    expect(await draw($, toolGroup(undefined, { isExpanded: true }))).toBe('GROUP 2')
  })
})

describe('show_errors', () => {
  test('on by default: a failed call and its error stay visible', async ($, on) => {
    await boot($, on)
    await quiet($, 'on')
    expect(await draw($, toolUse({ isErrored: true }))).toBe('ROW Bash')
    expect(await draw($, toolResult({ isErrored: true }))).toBe('RESULT Bash')
    expect(await draw($, toolGroup([call(), call({ tool_use_id: 'r2', isErrored: true })]))).toBe('GROUP 2')
    // Esc is not an error worth showing.
    expect(await draw($, toolUse({ isErrored: true, isInterrupted: true }))).not.toContain('ROW')
  })

  test('false in the config file: failed calls are hidden too', async ($, on) => {
    await boot($, on, { files: { [CONFIG]: JSON.stringify({ show_errors: false }) } })
    await quiet($, 'on')
    expect(await draw($, toolUse({ isErrored: true }))).not.toContain('ROW')
    expect(await draw($, toolResult({ isErrored: true }))).not.toContain('RESULT')
    expect(await draw($, toolGroup([call({ isErrored: true })]))).not.toContain('GROUP')
  })

  test('false in /config: failed calls are hidden too', { options: { show_errors: false } }, async ($, on) => {
    await boot($, on)
    await quiet($, 'on')
    expect(await draw($, toolResult({ isErrored: true }))).not.toContain('RESULT')
  })
})

describe('/quiet', () => {
  test('on, off, and no argument flips it; status line and toast follow', async ($, on) => {
    const world = await boot($, on)
    expect(await quiet($, 'on')).toContain('hidden')
    expect(world.statuses.at(-1)).toBe(STATUS_ON)
    expect(await quiet($, 'off')).toContain('show')
    expect(world.statuses.at(-1)).toBe(undefined)
    expect(await quiet($)).toContain('hidden')
    expect(await draw($, toolUse())).not.toContain('ROW')
    expect(await quiet($)).toContain('show')
    expect(await draw($, toolUse())).toBe('ROW Bash')
    expect(world.toasts.length).toBe(4)
    expect(await quiet($, 'maybe')).toContain('/quiet on')
  })

  test('the choice is saved in $.store (read back at the next session start)', async ($, on) => {
    const world = await boot($, on)
    await quiet($, 'on')
    expect(world.store.enabled).toBe(true)
    await quiet($, 'off')
    expect(world.store.enabled).toBe(false)
  })

  test('a saved "on" starts hidden in a new session, even with start_on off', async ($, on) => {
    const world = await boot($, on, { store: { enabled: true } })
    expect(await draw($, toolUse())).not.toContain('ROW')
    expect(world.statuses.at(-1)).toBe(STATUS_ON)
  })

  test('a saved "off" wins over start_on', { options: { start_on: true } }, async ($, on) => {
    await boot($, on, { store: { enabled: false } })
    expect(await draw($, toolUse())).toBe('ROW Bash')
  })

  test('with nothing saved, start_on in the config file starts hidden', async ($, on) => {
    await boot($, on, { files: { [CONFIG]: JSON.stringify({ start_on: true }) } })
    expect(await draw($, toolUse())).not.toContain('ROW')
  })

  test('with nothing saved, start_on in /config starts hidden', { options: { start_on: true } }, async ($, on) => {
    await boot($, on)
    expect(await draw($, toolUse())).not.toContain('ROW')
  })
})

describe('config file', () => {
  test('the first session writes it with null keys', async ($, on) => {
    const world = await boot($, on)
    expect(world.writes).toEqual([{ path: CONFIG, text: CONFIG_EXAMPLE }])
    const parsed = JSON.parse(CONFIG_EXAMPLE)
    expect(parsed.start_on).toBe(null)
    expect(parsed.show_errors).toBe(null)
  })

  test('a file that is there is never rewritten', async ($, on) => {
    const world = await boot($, on, { files: { [CONFIG]: '{ "start_on": true }' } })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect(world.writes).toEqual([])
  })
})

describe('side-stack', () => {
  test('alone: no section in the side-stack pane, no pane of its own', async ($, on) => {
    await boot($, on)
    const texts = await paneTexts($)
    expect(texts).toEqual(['HOST-AND-OTHERS'])
  })

  test('with the host: a "Quiet tools" row with the switch, above the other sections', { plugins: [HOST] }, async ($, on) => {
    await boot($, on)
    for (const surface of SURFACES) {
      const texts = await paneTexts($, surface)
      expect(texts[0]).toBe('Quiet tools ')
      expect(texts.some(one => one.includes('HOST-AND-OTHERS'))).toBe(true)
      expect(texts.findIndex(one => one.includes('HOST-AND-OTHERS')) > 0).toBe(true)
    }
    const ui = await $.ui.mount({
      plugin: 'quiet-tools',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'side-stack',
      props: { title: 'Stack', isFocused: false, bodyColumns: 44, placement: 'dock' } as never,
    })
    expect(JSON.stringify(await ui.find({ key: 'quiet-tools-toggle' } as never))).toContain(LABEL_OFF)
    await ui.press({ key: 'quiet-tools-toggle' } as never)
    expect(JSON.stringify(await ui.find({ key: 'quiet-tools-toggle' } as never))).toContain(LABEL_ON)
    await ui.unmount()
    expect(await draw($, toolUse())).not.toContain('ROW')
  })

  test('a stale host flag with no /stack command listed: alone mode, no section, stacked false', { plugins: [STALE_HOST, READER] }, async ($, on) => {
    const world = await boot($, on)
    await world.clock.advance(1200)
    expect(await paneTexts($)).toEqual(['HOST-AND-OTHERS'])
    await quiet($, 'on')
    expect(await stackedFlag($)).toBe(false)
    expect(await draw($, toolUse())).not.toContain('ROW')
  })

  test('alone: the stacked flag stays false', { plugins: [READER] }, async ($, on) => {
    const world = await boot($, on)
    await world.clock.advance(1200)
    expect(await stackedFlag($)).toBe(false)
  })

  test('with the host: the stacked flag turns true after the start checks and on a toggle', { plugins: [HOST, READER] }, async ($, on) => {
    const world = await boot($, on)
    await world.clock.advance(1200)
    expect(await stackedFlag($)).toBe(true)
    await quiet($, 'on')
    expect(await stackedFlag($)).toBe(true)
  })
})
