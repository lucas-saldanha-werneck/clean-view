import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CONFIG_EXAMPLE } from '../hooks/config-example'
import { LABEL_OFF, LABEL_ON, SECTION_KEY, fillSlot } from '../hooks/register'

// On Windows the engine resolves a drive-less absolute path onto the current
// drive with backslashes (D:\home\u\...). Compare paths in POSIX form.
const posix = (p: string): string => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
const CONFIG = '/home/u/.config/clean-view/config.json'
const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

type World = {
  writes: { path: string; text: string }[]
  store: Record<string, unknown>
  statuses: (string | undefined)[]
  toasts: string[]
  clock: ReturnType<typeof mock.clock>
  /** What $.session.id() answers; a /clear changes it. */
  sessionId: string
  /** Each $.process.run the plugin made. */
  runs: { argv: readonly string[]; stdin?: string }[]
}

type Setup = {
  /** Files by POSIX path. A path not listed does not exist. */
  files?: Record<string, string>
  /** What $.store holds at the start. */
  store?: Record<string, unknown>
  /** The surface the session starts on. */
  surface?: Surface
  /** side-stack (beneath) leaves an empty slot for this section between two others, as with `/stack order`. */
  slot?: boolean
  /** Environment variables in place of HOME=/home/u. */
  env?: Record<string, string>
  /** fs.exists says these files are missing although they are there: another session made them just after the check. */
  appearAfterCheck?: string[]
  /** $.process.run rejects (the command cannot start). */
  noProcess?: boolean
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
    // present is session state: a /clear starts a new session id without session.start,
    // and the flag reads false there. Modelled by dropping it when the session ends.
    on('session.end', async ($, e, next) => {
      await $.state.set({ plugin: 'side-stack', key: 'present' }, false)
      return next(e)
    })
  },
}

/** A host whose present flag is gone (as after a /clear) but whose /stack command is listed. */
const CMD_ONLY_HOST: Plugin = {
  name: 'side-stack',
  register: on => {
    on('session.start', async ($, e, next) => {
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
const OWNERS: Record<string, string> = { stack: 'side-stack', quiet: 'clean-view' }

/** Another plugin reading clean-view' stacked flag, as side-stack does (the test's own $ has no state noun). */
const READER: Plugin = {
  name: 'idea-shelf',
  register: on => {
    on('session.start', async ($, e, next) => {
      await $.command.register({ name: 'qtstacked', description: 'test: read clean-view.stacked' })
      return next(e)
    })
    on('command.run', { command: 'qtstacked' }, async $ => {
      const { value } = await $.state.get({ plugin: 'clean-view', key: 'stacked' })
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
  const world: World = { writes: [], store: { ...(setup.store ?? {}) }, statuses: [], toasts: [], clock: mock.clock(on, { now: 1_000_000 }), sessionId: 's1', runs: [] }
  mock.env(on, setup.env ?? { HOME: '/home/u' })
  on('fs.exists', async (_$, e) => {
    const path = posix((e as { path: string }).path)
    return { value: path in files && !(setup.appearAfterCheck ?? []).includes(path) } as never
  })
  // `sh -c 'mkdir -p ... && set -C && cat > "$1"' sh FILE DIR`: noclobber creates FILE only when it is not there.
  on('process.run', async (_$, e) => {
    const r = e as { argv: readonly string[]; init?: { stdin?: string } }
    world.runs.push({ argv: r.argv, stdin: r.init?.stdin })
    if (setup.noProcess === true) throw new Error('spawn sh ENOENT')
    const isNoclobber = r.argv[0] === 'sh' && r.argv[1] === '-c' && /set -C/.test(r.argv[2] ?? '')
    const path = posix(r.argv[4] ?? '')
    if (!isNoclobber || path === '') return { value: { exitCode: 127, stdout: '', stderr: 'unexpected command' } } as never
    if (path in files) return { value: { exitCode: 1, stdout: '', stderr: 'cannot overwrite existing file' } } as never
    files[path] = r.init?.stdin ?? ''
    world.writes.push({ path, text: files[path]! })
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
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
  on('session.id', async () => ({ value: world.sessionId }) as never)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
  on('prompt.submit', (_$, e) => e as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const commands: { name: string; description: string }[] = []
  on('command.register', (_$, e) => {
    commands.push({ name: e.name, description: e.description })
    return { value: { command: e.name } }
  })
  on('command.list', async () => ({
    value: commands.map(c => ({ ...c, source: 'plugin', plugin: `${OWNERS[c.name] ?? 'unknown'}@lucas-tools` })),
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
    const { Box, Text } = $.ui.resolve(e)
    if (setup.slot === true) {
      return (
        <Box flexDirection="column">
          <Box key="side-stack:plan-checklist"><Text>FIRST-SECTION</Text></Box>
          <Box key="side-stack:slot:clean-view" />
          <Box key="side-stack:idea-shelf"><Text>LAST-SECTION</Text></Box>
        </Box>
      )
    }
    return <Text>HOST-AND-OTHERS</Text>
  })
  await $.session.start({ cwd: '/work', surface: setup.surface ?? 'terminal', isInteractive: true })
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
async function draw($: Engine, row: Row, surface: Surface = 'terminal'): Promise<string> {
  const requestId = String((row.props as { tool_use_id?: string }).tool_use_id ?? 'g1')
  const ui = await $.ui.mount({ plugin: 'clean-view', surface, requestId, ...row } as never)
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()
  return texts.join('\n')
}

async function paneTexts($: Engine, surface: Surface = 'terminal'): Promise<string[]> {
  const ui = await $.ui.mount({
    plugin: 'clean-view',
    surface,
    component: 'Pane',
    requestId: 'side-stack',
    props: { title: 'Stack', isFocused: false, bodyColumns: 44, placement: 'dock' } as never,
  })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()
  return texts
}

for (const surface of SURFACES) {
  describe(`hiding (${surface})`, () => {
    test('on: ToolUse, ToolResult and ToolGroup are hidden, the pill is blank', async ($, on) => {
      await boot($, on, { surface })
      await quiet($, 'on')
      expect(await draw($, toolUse(), surface)).not.toContain('ROW')
      expect(await draw($, toolResult(), surface)).not.toContain('RESULT')
      expect(await draw($, toolGroup(), surface)).not.toContain('GROUP')
      // The engine raises ToolProgress on the terminal only (the desktop has no ctrl+b pill);
      // the kit mounts it on any surface, so on desktop this checks the hook alone.
      expect(await draw($, progress(), surface)).toBe('PILL[]')
    })

    test('off (the default): every row passes through untouched', async ($, on) => {
      await boot($, on, { surface })
      expect(await draw($, toolUse(), surface)).toBe('ROW Bash')
      expect(await draw($, toolResult(), surface)).toBe('RESULT Bash')
      expect(await draw($, toolGroup(), surface)).toBe('GROUP 2')
      expect(await draw($, progress(), surface)).toBe('PILL[(ctrl+b to run in background)]')
    })

    test('on: the ctrl+o transcript (isExpanded) still shows every row', async ($, on) => {
      await boot($, on, { surface })
      await quiet($, 'on')
      expect(await draw($, toolUse({ isExpanded: true }), surface)).toBe('ROW Bash')
      expect(await draw($, toolResult({ isExpanded: true }), surface)).toBe('RESULT Bash')
      expect(await draw($, toolGroup(undefined, { isExpanded: true }), surface)).toBe('GROUP 2')
    })
  })

  describe(`show_errors (${surface})`, () => {
    test('on by default: a failed call and its error stay visible', async ($, on) => {
      await boot($, on, { surface })
      await quiet($, 'on')
      expect(await draw($, toolUse({ isErrored: true }), surface)).toBe('ROW Bash')
      expect(await draw($, toolResult({ isErrored: true }), surface)).toBe('RESULT Bash')
      expect(await draw($, toolGroup([call(), call({ tool_use_id: 'r2', isErrored: true })]), surface)).toBe('GROUP 2')
      // Esc is not an error worth showing.
      expect(await draw($, toolUse({ isErrored: true, isInterrupted: true }), surface)).not.toContain('ROW')
    })

    test('false in the config file: failed calls are hidden too', async ($, on) => {
      await boot($, on, { surface, files: { [CONFIG]: JSON.stringify({ show_errors: false }) } })
      await quiet($, 'on')
      expect(await draw($, toolUse({ isErrored: true }), surface)).not.toContain('ROW')
      expect(await draw($, toolResult({ isErrored: true }), surface)).not.toContain('RESULT')
      expect(await draw($, toolGroup([call({ isErrored: true })]), surface)).not.toContain('GROUP')
    })

    test('a hook refusal shows as one line, its long error is hidden; ctrl+o shows it all', async ($, on) => {
      const gate = 'PreToolUse:Edit hook error: [Fact-Forcing Gate]\n\nBefore editing /x/lib.py, present these facts:\n\n1. List ALL files...\n\nPresent the facts, then retry the same operation.'
      const op = 'Error: PreToolUse:Bash hook error: [command hook 9]: Claude-1Password guard: blocked. printing the whole environment leaks secrets.'
      // The settings hooks beneath: they refuse these calls (what a session folds an exit code 2 into).
      const refused: Record<string, string> = { tu1: '[Fact-Forcing Gate]\n\nBefore editing...', tu2: op, r2: '[Fact-Forcing Gate]' }
      on('classic.PreToolUse', (_$, e) => (e.tool_use_id in refused ? { deny: refused[e.tool_use_id]! } : {}))
      await boot($, on, { surface })
      await $.tool.call({ tool: 'Edit', tool_use_id: 'tu1', file_path: '/x/lib.py', old_string: 'a', new_string: 'b' } as never)
      await $.tool.call({ tool: 'Bash', tool_use_id: 'tu2', command: 'env' } as never)
      await $.tool.call({ tool: 'Grep', tool_use_id: 'r2', pattern: 'x' } as never)
      await quiet($, 'on')
      expect(await draw($, toolUse({ tool: 'Edit', isErrored: true, output: gate }), surface))
        .toBe('⚠ Edit blocked by hook: Fact-Forcing Gate')
      expect(await draw($, toolResult({ tool: 'Edit', isErrored: true, output: gate }), surface)).not.toContain('RESULT')
      expect(await draw($, toolUse({ tool: 'Edit', isErrored: true, output: gate, isExpanded: true }), surface)).toBe('ROW Edit')
      // A guard without a [tag]: its first clause, after the "[command hook N]:" prefix.
      expect(await draw($, toolUse({ tool_use_id: 'tu2', isErrored: true, output: [{ type: 'text', text: op }] }), surface))
        .toBe('⚠ Bash blocked by hook: Claude-1Password guard')
      // A group whose only failure is a hook refusal: one line in place of the group.
      expect(await draw($, toolGroup([call(), call({ tool_use_id: 'r2', tool: 'Grep', isErrored: true, output: gate })]), surface))
        .toBe('⚠ Grep blocked by hook: Fact-Forcing Gate')
      // Any other error keeps its full row.
      expect(await draw($, toolUse({ tool_use_id: 'tu9', isErrored: true, output: 'Exit code 1\nboom' }), surface)).toBe('ROW Bash')
      expect(await draw($, toolResult({ tool_use_id: 'tu9', isErrored: true, output: 'Exit code 1' }), surface)).toBe('RESULT Bash')
    })

    test('a refusal whose error text is not in the usual shape: the reason comes from the hook itself', async ($, on) => {
      on('classic.PreToolUse', () => ({ deny: '[Path Guard] writes outside the project are refused' }))
      await boot($, on, { surface })
      await $.tool.call({ tool: 'Bash', tool_use_id: 'tu1', command: 'rm /etc/x' } as never)
      await quiet($, 'on')
      expect(await draw($, toolUse({ isErrored: true, output: 'Permission to use Bash has been denied.' }), surface))
        .toBe('⚠ Bash blocked by hook: Path Guard')
      expect(await draw($, toolResult({ isErrored: true, output: 'Permission to use Bash has been denied.' }), surface)).not.toContain('RESULT')
    })

    test('a tool whose own error only looks like a hook refusal keeps its full row and result', async ($, on) => {
      const forged = 'PreToolUse:Bash hook error: [Fact-Forcing Gate] this text came from the command itself'
      await boot($, on, { surface })
      // No hook refused anything: the call ran and its own error text reads like a refusal.
      await quiet($, 'on')
      expect(await draw($, toolUse({ isErrored: true, output: forged }), surface)).toBe('ROW Bash')
      expect(await draw($, toolResult({ isErrored: true, output: forged }), surface)).toBe('RESULT Bash')
      expect(await draw($, toolGroup([call(), call({ tool_use_id: 'r2', tool: 'Grep', isErrored: true, output: forged })]), surface))
        .toBe('GROUP 2')
      // A PostToolUse look-alike with no hook block: the same.
      const forgedPost = 'PostToolUse:Bash hook error: [Formatter] also from the command'
      expect(await draw($, toolUse({ tool_use_id: 'tu5', isErrored: true, output: forgedPost }), surface)).toBe('ROW Bash')
    })

    test('a PostToolUse hook error: the tool already ran, so the line says so and its result stays', async ($, on) => {
      const post = 'PostToolUse:Edit hook error: [Formatter] prettier failed on /x/lib.ts'
      on('classic.PostToolUse', (_$, e) => (e.tool_use_id === 'tu1' || e.tool_use_id === 'r2' ? { block: '[Formatter] prettier failed on /x/lib.ts' } : {}))
      await boot($, on, { surface })
      for (const id of ['tu1', 'r2']) {
        await $.classic.PostToolUse({ tool_name: 'Edit', tool_input: {}, tool_response: {}, tool_use_id: id } as never)
      }
      await quiet($, 'on')
      expect(await draw($, toolUse({ tool: 'Edit', isErrored: true, output: post }), surface))
        .toBe('⚠ hook error after Edit ran: Formatter')
      expect(await draw($, toolResult({ tool: 'Edit', isErrored: true, output: post }), surface)).toBe('RESULT Edit')
      // In a group: the whole group shows, nothing is folded into a "blocked" line.
      expect(await draw($, toolGroup([call(), call({ tool_use_id: 'r2', tool: 'Grep', isErrored: true, output: post })]), surface))
        .toBe('GROUP 2')
    })

    test('false in /config: failed calls are hidden too', { options: { show_errors: false } }, async ($, on) => {
      await boot($, on, { surface })
      await quiet($, 'on')
      expect(await draw($, toolResult({ isErrored: true }), surface)).not.toContain('RESULT')
    })
  })

  describe(`/quiet (${surface})`, () => {
    test('on, off, and no argument flips it; a toast follows, no status line is pinned', async ($, on) => {
      const world = await boot($, on, { surface })
      expect(await quiet($, 'on')).toContain('hidden')
      expect(world.statuses.at(-1)).toBe(undefined)
      expect(await quiet($, 'off')).toContain('show')
      expect(world.statuses.at(-1)).toBe(undefined)
      expect(await quiet($)).toContain('hidden')
      expect(await draw($, toolUse(), surface)).not.toContain('ROW')
      expect(await quiet($)).toContain('show')
      expect(await draw($, toolUse(), surface)).toBe('ROW Bash')
      expect(world.toasts.length).toBe(4)
      expect(await quiet($, 'maybe')).toContain('/quiet on')
    })

    test('the choice is saved in $.store (read back at the next session start)', async ($, on) => {
      const world = await boot($, on, { surface })
      await quiet($, 'on')
      expect(world.store.enabled).toBe(true)
      await quiet($, 'off')
      expect(world.store.enabled).toBe(false)
    })

    test('a saved "on" starts hidden in a new session, even with start_on off', async ($, on) => {
      const world = await boot($, on, { surface, store: { enabled: true } })
      expect(await draw($, toolUse(), surface)).not.toContain('ROW')
      expect(world.statuses.at(-1)).toBe(undefined)
    })

    test('a saved "off" wins over start_on', { options: { start_on: true } }, async ($, on) => {
      await boot($, on, { surface, store: { enabled: false } })
      expect(await draw($, toolUse(), surface)).toBe('ROW Bash')
    })

    test('with nothing saved, start_on in the config file starts hidden', async ($, on) => {
      await boot($, on, { surface, files: { [CONFIG]: JSON.stringify({ start_on: true }) } })
      expect(await draw($, toolUse(), surface)).not.toContain('ROW')
    })

    test('with nothing saved, start_on in /config starts hidden', { options: { start_on: true } }, async ($, on) => {
      await boot($, on, { surface })
      expect(await draw($, toolUse(), surface)).not.toContain('ROW')
    })
  })

  describe(`side-stack (${surface})`, () => {
    test('alone: no section in the side-stack pane, no pane of its own', async ($, on) => {
      await boot($, on, { surface })
      const texts = await paneTexts($, surface)
      expect(texts).toEqual(['HOST-AND-OTHERS'])
    })

    test('with the host: a "Clean View" row with the switch, above the other sections', { plugins: [HOST] }, async ($, on) => {
      await boot($, on, { surface })
      const texts = await paneTexts($, surface)
      expect(texts[0]).toBe('Clean View ')
      expect(texts.some(one => one.includes('HOST-AND-OTHERS'))).toBe(true)
      expect(texts.findIndex(one => one.includes('HOST-AND-OTHERS')) > 0).toBe(true)
      const ui = await $.ui.mount({
        plugin: 'clean-view',
        surface,
        component: 'Pane',
        requestId: 'side-stack',
        props: { title: 'Stack', isFocused: false, bodyColumns: 44, placement: 'dock' } as never,
      })
      expect(JSON.stringify(await ui.find({ key: 'clean-view-toggle' } as never))).toContain(LABEL_OFF)
      await ui.press({ key: 'clean-view-toggle' } as never)
      expect(JSON.stringify(await ui.find({ key: 'clean-view-toggle' } as never))).toContain(LABEL_ON)
      await ui.unmount()
      expect(await draw($, toolUse(), surface)).not.toContain('ROW')
    })

    test('a stale host flag with no /stack command listed: alone mode, no section, stacked false', { plugins: [STALE_HOST, READER] }, async ($, on) => {
      const world = await boot($, on, { surface })
      await world.clock.advance(1200)
      expect(await paneTexts($, surface)).toEqual(['HOST-AND-OTHERS'])
      await quiet($, 'on')
      expect(await stackedFlag($)).toBe(false)
      expect(await draw($, toolUse(), surface)).not.toContain('ROW')
    })

    test('alone: the stacked flag stays false', { plugins: [READER] }, async ($, on) => {
      const world = await boot($, on, { surface })
      await world.clock.advance(1200)
      expect(await stackedFlag($)).toBe(false)
    })

    test('with the host: the stacked flag turns true after the start checks and on a toggle', { plugins: [HOST, READER] }, async ($, on) => {
      const world = await boot($, on, { surface })
      await world.clock.advance(1200)
      expect(await stackedFlag($)).toBe(true)
      await quiet($, 'on')
      expect(await stackedFlag($)).toBe(true)
    })

    test('a real /clear (session.end clear, new id, no session.start): the row is back in the stack and rows stay hidden', { plugins: [HOST, READER] }, async ($, on) => {
      const world = await boot($, on, { surface })
      await world.clock.advance(1200)
      await quiet($, 'on')
      expect((await paneTexts($, surface))[0]).toBe('Clean View ')
      await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
      world.sessionId = 's2'
      const pinned = world.statuses.length
      await $.prompt.submit({ text: 'hello' } as never)
      await $.turn.start({ text: 'hello', turnId: 't2' })
      const texts = await paneTexts($, surface)
      expect(texts[0]).toBe('Clean View ')
      expect(texts.some(one => one.includes('HOST-AND-OTHERS'))).toBe(true)
      expect(await stackedFlag($)).toBe(true)
      expect(await draw($, toolUse(), surface)).not.toContain('ROW')
      expect(world.statuses.length > pinned).toBe(true)
      expect(world.statuses.at(-1)).toBe(undefined)
    })

    test('after a /clear the switch is reloaded from $.store (another session turned it off)', { plugins: [HOST, READER] }, async ($, on) => {
      const world = await boot($, on, { surface })
      await quiet($, 'on')
      await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
      world.sessionId = 's2'
      world.store.enabled = false
      await $.turn.start({ text: 'hello', turnId: 't2' })
      expect(await draw($, toolUse(), surface)).toBe('ROW Bash')
      expect(world.statuses.at(-1)).toBe(undefined)
    })

    test('a draw right after a /clear, before any prompt, resyncs just after the draw', { plugins: [HOST, READER] }, async ($, on) => {
      const world = await boot($, on, { surface })
      await world.clock.advance(1200)
      await quiet($, 'on')
      await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
      world.sessionId = 's2'
      world.store.enabled = false
      await draw($, toolUse(), surface)
      await world.clock.advance(1)
      expect(await draw($, toolUse(), surface)).toBe('ROW Bash')
    })

    test('the /stack command alone (no present flag) counts as side-stack running', { plugins: [CMD_ONLY_HOST, READER] }, async ($, on) => {
      const world = await boot($, on, { surface })
      await world.clock.advance(1200)
      expect((await paneTexts($, surface))[0]).toBe('Clean View ')
      expect(await stackedFlag($)).toBe(true)
    })

    test('side-stack left a slot for this section (an order was set): the section fills it, in place', { plugins: [HOST, READER] }, async ($, on) => {
      await boot($, on, { surface, slot: true })
      const texts = await paneTexts($, surface)
      const first = texts.indexOf('FIRST-SECTION')
      const mine = texts.indexOf('Clean View ')
      const last = texts.indexOf('LAST-SECTION')
      expect(first).toBe(0)
      expect(mine > first).toBe(true)
      expect(last > mine).toBe(true)
      const ui = await $.ui.mount({
        plugin: 'clean-view',
        surface,
        component: 'Pane',
        requestId: 'side-stack',
        props: { title: 'Stack', isFocused: false, bodyColumns: 44, placement: 'dock' } as never,
      })
      expect(await ui.find({ key: SECTION_KEY } as never)).toBeDefined()
      expect(await ui.find({ key: 'side-stack:slot:clean-view' } as never)).toBeUndefined()
      await ui.press({ key: 'clean-view-toggle' } as never)
      expect(JSON.stringify(await ui.find({ key: 'clean-view-toggle' } as never))).toContain(LABEL_ON)
      await ui.unmount()
    })

    test('no slot from side-stack: the section, keyed side-stack:clean-view, goes on top as before', { plugins: [HOST, READER] }, async ($, on) => {
      await boot($, on, { surface })
      const texts = await paneTexts($, surface)
      expect(texts[0]).toBe('Clean View ')
      expect(texts.indexOf('HOST-AND-OTHERS') > 0).toBe(true)
      const ui = await $.ui.mount({
        plugin: 'clean-view',
        surface,
        component: 'Pane',
        requestId: 'side-stack',
        props: { title: 'Stack', isFocused: false, bodyColumns: 44, placement: 'dock' } as never,
      })
      expect(await ui.find({ key: SECTION_KEY } as never)).toBeDefined()
      await ui.unmount()
    })
  })
}

describe('config file', () => {
  test('the first session writes it with null keys', async ($, on) => {
    const world = await boot($, on)
    expect(world.writes).toEqual([{ path: CONFIG, text: CONFIG_EXAMPLE }])
    const parsed = JSON.parse(CONFIG_EXAMPLE)
    expect(parsed.start_on).toBe(null)
    expect(parsed.show_errors).toBe(null)
  })

  test('a Windows home on a network share (UNC path, no HOME) still gets its file', async ($, on) => {
    const world = await boot($, on, { env: { USERPROFILE: '\\\\srv\\share\\u' } })
    expect(world.writes.length).toBe(1)
    expect(world.writes[0]!.path.endsWith('srv/share/u/.config/clean-view/config.json')).toBe(true)
  })

  test('a file that is there is never rewritten', async ($, on) => {
    const world = await boot($, on, { files: { [CONFIG]: '{ "start_on": true }' } })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect(world.writes).toEqual([])
  })

  test('POSIX: the file is created only if missing at the moment of writing (sh noclobber, no shell string)', async ($, on) => {
    const world = await boot($, on)
    expect(world.runs.length).toBe(1)
    const [cmd, flag, script, , file, dir] = world.runs[0]!.argv
    expect([cmd, flag]).toEqual(['sh', '-c'])
    expect(script).toContain('set -C')
    expect(posix(file!)).toBe(CONFIG)
    expect(posix(dir!)).toBe('/home/u/.config/clean-view')
    expect(world.runs[0]!.stdin).toBe(CONFIG_EXAMPLE)
  })

  test('a file another session makes between the check and the write is kept as it is', async ($, on) => {
    const mine = '{ "start_on": true }'
    const world = await boot($, on, { files: { [CONFIG]: mine }, appearAfterCheck: [CONFIG] })
    expect(world.writes).toEqual([])
    // The other session's start_on true held (a starter file would say null): /quiet flips it off.
    await quiet($)
    expect(await draw($, toolUse())).toContain('ROW')
  })

  test('no sh to run (the command cannot start): falls back to writing the starter file', async ($, on) => {
    const world = await boot($, on, { noProcess: true })
    expect(world.writes).toEqual([{ path: CONFIG, text: CONFIG_EXAMPLE }])
  })

  test('Windows: no sh noclobber there, the file is written after the check (documented)', async ($, on) => {
    const world = await boot($, on, { env: { USERPROFILE: 'C:\\Users\\u', OS: 'Windows_NT' } })
    expect(world.runs).toEqual([])
    expect(world.writes.length).toBe(1)
    expect(world.writes[0]!.path.endsWith('Users/u/.config/clean-view/config.json')).toBe(true)
  })
})

describe('fillSlot', () => {
  test('replaces the slot deep in a tree and leaves everything else as it was', () => {
    const slot = { type: 'Box', props: { key: 'side-stack:slot:clean-view' }, children: [] }
    const other = { type: 'Box', props: { key: 'side-stack:idea-shelf' }, children: ['x'] }
    const tree = { type: 'Box', props: {}, children: [other, { type: 'Box', props: {}, children: [slot] }] }
    const filled = fillSlot(tree, 'SECTION') as { children: unknown[] }
    expect(filled.children[0]).toBe(other)
    expect((filled.children[1] as { children: unknown[] }).children[0]).toBe('SECTION')
    expect(tree.children[1]).toEqual({ type: 'Box', props: {}, children: [slot] })
    expect(fillSlot(other, 'SECTION')).toBe(undefined)
    expect(fillSlot(null, 'SECTION')).toBe(undefined)
    expect(fillSlot(slot, 'SECTION')).toBe('SECTION')
  })
})

// The race seen on 2.1.319: after a real /clear, events can reach the mod under
// the NEW session id BEFORE session state is emptied. A resync in that window
// must not count once the state empties: tool rows stay hidden, and the next
// event loads the switch again.
for (const surface of SURFACES) {
  test(`a resync made before the state empties at a /clear does not leave the switch off (${surface})`, async ($, on) => {
    let state: Record<string, { value: unknown; version: number }> = {}
    on('state.get', async (_$, e) => {
      const a = e as { plugin: string; key: string }
      return { value: state[`${a.plugin}.${a.key}`] ?? { value: undefined, version: 0 } } as never
    })
    on('state.set', async (_$, e) => {
      const a = e as { plugin: string; key: string; value: unknown }
      const version = (state[`${a.plugin}.${a.key}`]?.version ?? 0) + 1
      state[`${a.plugin}.${a.key}`] = { value: a.value, version }
      return { value: { isSet: true, version } } as never
    })
    const world = await boot($, on, { surface })
    await quiet($, 'on')
    expect(await draw($, toolUse(), surface)).not.toContain('ROW')
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
    world.sessionId = 's2'
    await $.prompt.submit({ text: 'hello' } as never) // under the new id, state not emptied yet
    state = {} // now the engine empties session state
    expect(await draw($, toolUse(), surface)).not.toContain('ROW')
    await $.turn.start({ text: 'hello', turnId: 't2' })
    expect(state['clean-view.enabled']?.value).toBe(true)
    expect(await draw($, toolUse(), surface)).not.toContain('ROW')
    expect(world.statuses.at(-1)).toBe(undefined)
  })
}
