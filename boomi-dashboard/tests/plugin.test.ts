import type { CommandRunInput, On, RenderElement, RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

const dashboard = (args = '') => ({ command: 'bc-dashboard', args }) as CommandRunInput

const ID = '1a2b3c4d-1111-2222-3333-444455556666'
const ORDERS = `<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="${ID}" name="Orders Sync" type="process"></bns:Component>`
const FILE = 'active-development/processes/Orders.xml'
const NOW = Date.parse('2026-10-12T12:00:00Z')

const CREDENTIALS = {
  BOOMI_API_URL: 'https://api.boomi.com',
  BOOMI_USERNAME: 'me@example.com',
  BOOMI_API_TOKEN: 'secret-token-value',
  BOOMI_ACCOUNT_ID: 'acct-1',
}

/** The mocked clock of the test running now, set by world(). */
let clock: MockClock


/** The surface, files, clock and session cost beneath the plugin; records the toasts. */
/** What the surface does with a pane, and the session's id and origin remote. */
type WorldOptions = { isPlaced?: boolean; sessionId?: string; remote?: string | null }

/** The panes the plugin asked to open in the test running now. */
let opens: Record<string, unknown>[] = []

const world = (on: On, files: Record<string, string> = {}, options: WorldOptions = {}) => {
  const toasts: string[] = []
  opens = []
  const local = (path: string) => Object.keys(files).find(f => path === f || path.endsWith(`/${f}`)) ?? path
  on('fs.exists', async (_$, e) => ({ value: local(e.path) in files }))
  on('fs.read', async (_$, e) => {
    const text = files[local(e.path)]
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.stat', async (_$, e) => {
    const text = files[local(e.path)]
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: { kind: 'file' as const, size: text.length, mtimeMs: text.length, isLink: false } }
  })
  on('ui.status', async () => ({ value: undefined }))
  on('ui.open', async (_$, e) => {
    opens.push({ ...e })
    return { value: options.isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'no pane in tests' } }
  })
  on('session.cwd', async () => ({ value: '/work' }))
  on('session.id', async () => ({ value: options.sessionId ?? '3adaec6a-0227-5e7b-a04b-eeeba5da8710' }))
  on('session.repo', async () => ({
    value: options.remote === null ? null : { root: '/work', remote: options.remote ?? 'git@github.com:brianbrinley/ClaudeMods.git', internal: false, name: null },
  }))
  clock = mock.clock(on, { now: NOW })
  on('ui.toast', async (_$, e) => {
    toasts.push(String(e.text))
    return { value: undefined }
  })
  on('session.usage', async () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: 12 }, rateLimits: [], cost: { usd: 1.25 } },
  }))
  return toasts
}

/** The shell beneath the plugins, answering each command with the given output. */
const shell = (on: On, stdout: string, isError = false) => {
  const ran: string[] = []
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    ran.push(String(e.command))
    return isError
      ? { isError: true as const, result: stdout, text: stdout }
      : { result: { stdout, stderr: '', interrupted: false } }
  })
  return ran
}

/** The Write tool beneath the plugins: accepts every write. */
/** One model call of `tokens` tokens, as a turn step reports it; registers its answer beneath. */
const modelCall = async ($: Engine, on: On, tokens: number, model = 'claude') => {
  on('turn.step', async function* () {
    return {
      turnId: 't1',
      index: 0,
      answer: '',
      toolUses: [],
      stopReason: 'tool_use',
      usage: { model, input_tokens: tokens / 4, output_tokens: tokens / 4, cache_read_input_tokens: tokens / 2, cache_creation_input_tokens: 0 },
    } as never
  })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude', messageCount: 1 })
  for await (const _ of stream) void _
  return stream.result
}

const writer = (on: On) => {
  on('tool.call', { tool: 'Write' }, async () => ({ result: { type: 'create', filePath: FILE, content: '' } as never }))
}

test('a Companion push shows the component saved with its version, and the command still runs', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  const ran = shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
  const command = `bash scripts/boomi-component-push.sh ${FILE}`
  const answer = await $.tool.call({ tool: 'Bash', command })
  expect(answer.deny).toBeUndefined()
  expect(ran).toEqual([command])

  const status = await $.command.run(dashboard())
  expect(status.text).toContain('Orders Sync (process): ✓ saved v4')
  expect(status.text).toContain('Saved Orders Sync to Boomi (v4), just now')
  expect(status.text).toContain('Session: $1.25 so far')
})

test('the running token count adds up new tokens, keeps cache reads apart, and each step shows what it took', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
  await modelCall($, on, 8_000)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
  const status = await $.command.run(dashboard())
  // 8k tokens in all: 2k input, 2k output and 4k read from the cache.
  expect(status.text).toContain('Saved Orders Sync to Boomi (v4), just now  [4.0k tokens · $1.25]')
  expect(status.text).toContain('Orders Sync (process): ✓ saved v4  [4.0k tokens · $1.25]')
  expect(status.text).toContain('Session: $1.25 so far')
  expect(status.text).toContain('Tokens: 4.0k new (2.0k in · 2.0k out · 0 cache writes) · 4.0k cache reads')
})

test('Claude editing a component XML shows it as edited, not in Boomi yet', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  writer(on)
  await $.tool.call({ tool: 'Write', file_path: `/work/${FILE}`, content: ORDERS })
  await $.tool.call({ tool: 'Write', file_path: `/work/${FILE}`, content: ORDERS })
  const status = await $.command.run(dashboard())
  expect(status.text).toContain('Orders Sync (process): ◐ edited, not in Boomi yet')
  // Two writes to one file are one step.
  expect((status.text ?? '').match(/Edited Orders Sync/g)?.length).toBe(1)
})

test('a failed test needs attention, with what to do, and is toasted', async ($, on) => {
  const toasts = world(on, { [FILE]: ORDERS })
  shell(on, 'Execution completed: status=ERROR, executionId=execution-0490202b-2e2f')
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
  const status = await $.command.run(dashboard())
  expect(status.text).toContain('Needs attention (1):')
  expect(status.text).toContain('✗ Test of')
  expect(status.text).toContain('Execution 0490202b…: press Why? to read what failed.')
  expect(toasts.some(t => t.includes('ended ERROR'))).toBe(true)
})

test('a deploy that exits with an error needs attention with its error line', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  shell(on, 'ERROR: Deployment failed (HTTP 400): no package', true)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-deploy.sh ${FILE}` })
  const status = await $.command.run(dashboard())
  expect(status.text).toContain('Deploy of Orders Sync failed')
  expect(status.text).toContain('ERROR: Deployment failed (HTTP 400): no package')
})

test('commands that are not Companion scripts are left alone', async ($, on) => {
  world(on)
  const ran = shell(on, 'clean')
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(ran).toEqual(['git status'])
  const status = await $.command.run(dashboard())
  expect(status.text).toContain('Components this session: none yet')
})

test('without credentials, a watched component says why it is not checked', async ($, on) => {
  world(on)
  mock.store(on)
  mock.env(on, {})
  await $.command.run(dashboard(`watch ${ID}`))
  const status = await $.command.run(dashboard('poll'))
  expect(status.text).toContain('Watched components:')
  expect(status.text).toContain('Not connected')
})

test('with nothing watched, the dashboard makes no Platform API calls', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  mock.env(on, { ...CREDENTIALS, BOOMI_ENVIRONMENT_ID: 'env-1' })
  shell(on, "SUCCESS: Deployed 'Orders Sync' (package: p1)")
  const urls: string[] = []
  on('http.fetch', async (_$, e) => {
    urls.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: '{"result":[]}' } }
  })
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-deploy.sh ${FILE}` })
  const status = await $.command.run(dashboard('poll'))
  expect(urls).toEqual([])
  expect(status.text).not.toContain('Process runs')
})

test('watching a component polls its version, and a change by someone else needs attention', async ($, on) => {
  const toasts = world(on, { [FILE]: ORDERS })
  mock.store(on)
  mock.env(on, CREDENTIALS)
  let version = '3'
  let modifiedBy = 'me@example.com'
  const urls: string[] = []
  on('http.fetch', async (_$, e) => {
    urls.push(e.url)
    const body = { result: [{ name: 'Orders Sync', version, modifiedBy, modifiedDate: '2026-10-12T11:00:00Z' }] }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })

  const watched = await $.command.run(dashboard(`watch ${FILE}`))
  expect(watched.text).toContain('Watching ✓ Orders Sync v3')
  expect(urls.every(url => url.includes('/ComponentMetadata/query'))).toBe(true)

  version = '4'
  modifiedBy = 'pat@example.com'
  const status = await $.command.run(dashboard('poll'))
  expect(status.text).toContain('Orders Sync was changed by pat@example.com')
  expect(status.text).toContain('Pull it before you push')
  expect(status.text).not.toContain('secret-token-value')
  expect(toasts.some(t => t.includes('changed by pat@example.com'))).toBe(true)

  await $.command.run(dashboard('seen'))
  const after = await $.command.run(dashboard())
  expect(after.text).toContain('✓ Nothing needs attention.')
})

/** A drawn tree's root props. */
const propsOf = (tree: RenderElement) => ((tree as { props?: Record<string, unknown> }).props ?? {})

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, columns: 100 } as unknown as RenderPropsOf['AbovePrompt']
const PANE = { component: 'Pane', requestId: 'boomi-dashboard', props: {} as RenderPropsOf['Pane'] } as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`on ${surface}, the banner waits for activity, then shows the latest step and what needs attention`, async ($, on) => {
    world(on, { [FILE]: ORDERS })
    // The engine's own band beneath: nothing to show.
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Box } = $.ui.resolve(e)
      return h(Box, {}) as RenderElement
    })
    shell(on, 'Execution completed: status=ERROR, executionId=execution-9')
    const quiet = await $.ui.mount({ plugin: 'boomi-dashboard', surface, component: 'AbovePrompt', props: BAND })
    expect(await quiet.find({ text: /BC Dashboard/ })).toBeUndefined()

    await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
    const band = await $.ui.mount({ plugin: 'boomi-dashboard', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ text: '◆ BC Dashboard ' })).toBeDefined()
    expect(await band.find({ text: /ended ERROR/ })).toBeDefined()
    expect(await band.find({ text: /1 needs attention/ })).toBeDefined()
    await band.press({ key: 'hide' })
    expect(await band.find({ text: /BC Dashboard/ })).toBeUndefined()
  })

  test(`on ${surface}, the pane draws in Valence Day with its title band, gauges and spend`, async ($, on) => {
    world(on, { [FILE]: ORDERS })
    shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
    await modelCall($, on, 12_000)
    await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
    const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface, ...PANE })
    expect(propsOf(await pane.drawn())).toMatchObject({ backgroundColor: '#FBF6EE' })
    const title = await pane.find({ type: 'Text', text: '◆ BOOMI COMPANION DASHBOARD ◆' })
    expect(title?.props).toMatchObject({ color: '#FBF6EE', backgroundColor: '#C2185B', bold: true })
    const names = await pane.findAll({ type: 'Text', text: 'Orders Sync' })
    expect(names.some(n => n.props.color === '#0B0B0B' && n.props.backgroundColor === '#FBF6EE')).toBe(true)
    expect(await pane.find({ text: 'TOKENS' })).toBeDefined()
    expect(await pane.find({ text: '6.0k' })).toBeDefined()
    expect(await pane.find({ text: 'last step 6.0k' })).toBeDefined()
    expect(await pane.find({ text: '+6.0k cached' })).toBeDefined()
    expect(await pane.find({ text: '$1.25' })).toBeDefined()
    expect(await pane.find({ text: /▰▱+ 12%/ })).toBeDefined()
    expect(await pane.find({ text: /saved v4/ })).toBeDefined()
    expect(await pane.find({ text: /6\.0k tokens · \$1\.25/ })).toBeDefined()
    expect(await pane.find({ text: 'NEEDS ATTENTION' })).toBeDefined()
  })

  test(`on ${surface}, the pane shows when Claude is working`, async ($, on) => {
    world(on)
    on('turn.start', async (_$, e) => ({ turnId: e.turnId }) as never)
    await $.turn.start({ text: 'build it', turnId: 't1' } as never)
    const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface, ...PANE })
    expect(await pane.find({ text: '● WORKING' })).toBeDefined()
  })

  test(`on ${surface}, the pane can follow the terminal's theme instead`, { options: { paneTheme: 'terminal' } }, async ($, on) => {
    world(on)
    const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface, ...PANE })
    expect(propsOf(await pane.drawn()).backgroundColor).toBeUndefined()
    const title = await pane.find({ type: 'Text', text: '◆ BOOMI COMPANION DASHBOARD ◆' })
    expect(title?.props.color).toBe('claude')
    expect(await pane.find({ text: '◇ IDLE' })).toBeDefined()
  })

  test(`on ${surface}, the theme buttons switch the pane's colors and the choice is kept`, async ($, on) => {
    world(on)
    mock.store(on)
    const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface, ...PANE })
    expect(await pane.find({ type: 'Button', key: 'theme-day' })).toBeDefined()
    expect((await pane.find({ type: 'Button', key: 'theme-day' }))?.props.label).toBe('◆ Day')
    await pane.press({ key: 'theme-night' })
    expect(propsOf(await pane.drawn()).backgroundColor).toBe('#161A2E')
    expect((await pane.find({ type: 'Button', key: 'theme-night' }))?.props.label).toBe('◆ Night')
    const listed = await $.command.run(dashboard('theme'))
    expect(listed.text).toContain('◆ night')
    await $.command.run(dashboard('theme day'))
    expect(propsOf(await pane.drawn()).backgroundColor).toBe('#FBF6EE')
  })

  test(`on ${surface}, the flamingo walks while Claude works and stands while idle`, async ($, on) => {
    world(on)
    mock.store(on)
    on('turn.start', async (_$, e) => ({ turnId: e.turnId }) as never)
    on('turn.complete', async () => ({ text: '' }))
    on('session.start', async (_$, e) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }) as never)
    on('tool.register', async () => ({ value: undefined }) as never)
    // The session starts on the mocked clock, so its animation timer does too.
    await $.session.start({ cwd: '/work', surface, isInteractive: true })
    await $.turn.complete({ reason: 'answer', turnId: 't0', answer: '' } as never)
    const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface, ...PANE })
    const bird = async () => JSON.stringify((await pane.findAll({ text: /^[ ▀▄█]+$/ })).map(f => f.text))
    const standing = await bird()
    expect(standing).toContain('▀')
    await $.turn.start({ text: 'go', turnId: 't1' } as never)
    const walking = await bird()
    expect(walking).not.toBe(standing)
    await clock.advance(500)
    expect(await bird()).not.toBe(walking)
  })

  test(`on ${surface}, the pane names the model that answered`, async ($, on) => {
    world(on)
    await modelCall($, on, 8_000, 'claude-opus-5-5')
    const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface, ...PANE })
    expect(await pane.find({ text: /Opus 5\.5/ })).toBeDefined()
    expect(await pane.find({ text: /VALENCE/ })).toBeUndefined()
  })

  test(`on ${surface}, the footer names the session and links the repository's GitHub page`, async ($, on) => {
    world(on)
    const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface, ...PANE })
    expect(await pane.find({ text: /session 3adaec6a/ })).toBeDefined()
    const link = await pane.find({ type: 'Link' })
    expect(link?.props).toMatchObject({ href: 'https://github.com/brianbrinley/ClaudeMods', label: 'github.com/brianbrinley/ClaudeMods' })
  })

  test(`on ${surface}, a Needs attention item closes with its box and comes back with Reopen`, async ($, on) => {
    world(on, { [FILE]: ORDERS })
    mock.store(on)
    shell(on, 'ERROR: Deployment failed (HTTP 400): no package', true)
    await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-deploy.sh ${FILE}` })
    const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface, ...PANE })
    expect((await pane.find({ type: 'Button', key: 'close-0' }))?.props.label).toBe('☐')
    expect(await pane.find({ text: /Deploy of Orders Sync failed/ })).toBeDefined()
    await pane.press({ key: 'close-0' })
    expect(await pane.find({ text: /All clear/ })).toBeDefined()
    expect(await pane.find({ text: /☑ 1 closed/ })).toBeDefined()
    await pane.press({ key: 'reopen' })
    expect(await pane.find({ type: 'Button', key: 'close-0' })).toBeDefined()
    await pane.press({ key: 'close-0' })
  })

  test(`on ${surface}, Why? reads a failed test's log, and Ask Claude to fix drafts the request`, async ($, on) => {
    world(on, { [LISTENER_FILE]: LISTENER_XML })
    mock.store(on)
    mock.env(on, CREDENTIALS)
    const ran: string[][] = []
    on('process.run', async (_$, e) => {
      ran.push([...e.argv])
      if (e.argv[0] === 'bash' && e.argv[1] === '-c') return { value: { exitCode: 0, stdout: `${SKILL}/scripts\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      const log = `2026-10-12T11:05:01Z\tSEVERE\tParse Order\tBad JSON near secret-token-value`
      return { value: { exitCode: 0, stdout: log, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const fills: string[] = []
    on('prompt.read', async () => ({ value: { text: 'half typed', cursor: 10 } }))
    on('prompt.fill', async (_$, e) => {
      fills.push(`${e.mode}:${e.text}`)
      return { isFilled: true }
    })
    const command = `bash ${SKILL}/scripts/boomi-test-execute.sh --process-id ${LISTENER_ID}`
    scriptedShell(on, { [command]: 'Execution completed: status=ERROR, executionId=execution-81f61084-fd93-4565-9bda-9bf0d4b4f102' })
    await $.tool.call({ tool: 'Bash', command })
    const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface, ...PANE })
    expect((await pane.find({ type: 'Button', key: 'why-0' }))?.props.label).toBe('Why?')
    await pane.press({ key: 'why-0' })
    expect(ran.at(-1)).toEqual(['bash', `${SKILL}/scripts/boomi-execution-query.sh`, '--execution-id', 'execution-81f61084-fd93-4565-9bda-9bf0d4b4f102', '--logs'])
    expect(await pane.find({ text: /1 severe, 0 warnings/ })).toBeDefined()
    expect(await pane.find({ text: /Bad JSON near ‹redacted›/ })).toBeDefined()
    expect(await pane.find({ text: /secret-token-value/ })).toBeUndefined()
    await pane.press({ key: 'fix-0' })
    expect(fills.at(-1)).toContain('append:\n')
    expect(fills.at(-1)).toContain(`Test of ${LISTENER_ID} ended ERROR (execution execution-81f61084-fd93-4565-9bda-9bf0d4b4f102)`)
  })
}


// --- The live OrderValidator session: rows and attention ---

const SKILL = '/Users/me/.claude/plugins/cache/boomi-companion/bc-integration/1.0.76/skills/boomi-integration'
const LISTENER = 'OrderValidator - Listener Validate Order'
const LISTENER_ID = '33333333-1111-1111-1111-111111111111'
const LISTENER_XML = `<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="${LISTENER_ID}" name="${LISTENER}" type="process"></bns:Component>`
const LISTENER_FILE = 'active-development/processes/Listener.xml'

/** The shell beneath the plugins, answering each command with its own output. */
const scriptedShell = (on: On, outputs: Record<string, string>) => {
  on('tool.call', { tool: 'Bash' }, async (_$, e) => ({ result: { stdout: outputs[String(e.command)] ?? '', stderr: '', interrupted: false } }))
}

test('a build in a loop and on several lines shows every component', async ($, on) => {
  world(on, { [LISTENER_FILE]: LISTENER_XML })
  mock.store(on)
  const createLoop = `cd /work && for f in active-development/profiles/*.xml; do bash ${SKILL}/scripts/boomi-component-create.sh "$f"; done`
  const twoLines = [`bash ${SKILL}/scripts/boomi-component-create.sh ${LISTENER_FILE}`, `bash ${SKILL}/scripts/boomi-deploy.sh ${LISTENER_FILE}`].join('\n')
  scriptedShell(on, {
    [createLoop]: ['Request', 'Response'].map((n, i) => `Creating component 'OrderValidator - Order ${n} Profile' on the account default branch\nSUCCESS: Component 'OrderValidator - Order ${n} Profile' created with ID: ${i}2222222-1111-1111-1111-111111111111`).join('\n'),
    [twoLines]: [
      `Creating component '${LISTENER}' on the account default branch`,
      `SUCCESS: Component '${LISTENER}' created with ID: ${LISTENER_ID}`,
      `Packaging '${LISTENER}' (${LISTENER_ID}) from the account default branch`,
      `SUCCESS: Deployed '${LISTENER}' (package: p1)`,
    ].join('\n'),
  })
  await $.tool.call({ tool: 'Bash', command: createLoop })
  await $.tool.call({ tool: 'Bash', command: twoLines })
  const status = await $.command.run(dashboard('text'))
  expect(status.text).toContain('OrderValidator - Order Request Profile: ✓ created in Boomi')
  expect(status.text).toContain('OrderValidator - Order Response Profile: ✓ created in Boomi')
  expect(status.text).toContain(`${LISTENER} (process): ✓ created in Boomi  ✓ deployed`)
  expect(status.text).toContain('✓ Nothing needs attention.')
})

test("after a restart, this folder's steps from the last 24h come back", async ($, on) => {
  world(on)
  mock.store(on, {
    'activity:/work': {
      savedAt: NOW - 3_600_000,
      activity: [
        { id: 1, kind: 'deploy', outcome: 'ok', subject: LISTENER, detail: 'deployed', startedAt: NOW - 3_600_000, endedAt: NOW - 3_600_000, componentId: LISTENER_ID },
        { id: 2, kind: 'push', outcome: 'ok', subject: 'Old', detail: 'x', startedAt: NOW - 3 * 86_400_000, endedAt: NOW - 3 * 86_400_000, file: 'active-development/x/Old.xml' },
      ],
    },
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: undefined }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const status = await $.command.run(dashboard('text'))
  expect(status.text).toContain(`${LISTENER}: ✓ deployed`)
  expect(status.text).not.toContain('Old')
  expect(status.text).toContain('1 step from an earlier session in this folder, last 24h')
})

test('/bc-dashboard opens the pane with the keyboard and leaves the transcript a single line', async ($, on) => {
  world(on, {}, { isPlaced: true })
  const answer = await $.command.run(dashboard())
  expect(answer.text).toBe('Dashboard open. Esc closes it; /bc-dashboard text prints it here instead.')
  expect(opens.at(-1)).toMatchObject({ id: 'boomi-dashboard', focus: true, closeOnEscape: true })
})

test('where no pane can be shown, /bc-dashboard prints the dashboard instead', async ($, on) => {
  world(on, {}, { isPlaced: false })
  const answer = await $.command.run(dashboard())
  expect(answer.text).toContain('Components this session')
})

test('/bc-dashboard close takes an item by its number, and reopen brings it back', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  mock.store(on)
  shell(on, 'ERROR: Deployment failed (HTTP 400): no package', true)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-deploy.sh ${FILE}` })
  const listed = await $.command.run(dashboard('text'))
  expect(listed.text).toContain('1. ✗ Deploy of Orders Sync failed')
  expect((await $.command.run(dashboard('close 2'))).text).toContain('Usage: /bc-dashboard close <1-1 | all>')
  expect((await $.command.run(dashboard('close 1'))).text).toContain('Closed: Deploy of Orders Sync failed')
  const after = await $.command.run(dashboard('text'))
  expect(after.text).toContain('✓ Nothing needs attention.')
  expect(after.text).toContain('1 closed: /bc-dashboard reopen brings them back')
  await $.command.run(dashboard('reopen'))
  expect((await $.command.run(dashboard('text'))).text).toContain('Needs attention (1):')
})

test('/bc-dashboard why <n> reads the log in text, and says why when it can\'t', async ($, on) => {
  world(on, { [FILE]: ORDERS, 'scripts/boomi-execution-query.sh': '' })
  mock.store(on)
  shell(on, 'Execution completed: status=ERROR, executionId=execution-0490202b-2e2f')
  on('process.run', async (_$, e) =>
    e.argv[1] === '-c'
      ? { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : { value: { exitCode: 0, stdout: 'SEVERE\tx\ty', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } },
  )
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
  const why = await $.command.run(dashboard('why 1'))
  expect(why.text).toContain('(execution execution-0490202b-2e2f):')
  expect(why.text).toContain('SEVERE · x · y')
  expect((await $.command.run(dashboard('why 5'))).text).toContain("5 isn't one of these.")
})

test('/bc-dashboard report prints the session as Markdown, saves it, and Claude can ask for it', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  mock.store(on)
  shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
  const written: { path: string; text: string }[] = []
  on('fs.write', async (_$, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
  const text = await $.command.run(dashboard('report'))
  expect(text.text).toContain('# Boomi Companion session report')
  expect(text.text).toContain('| Orders Sync | process | ✓ saved v4 |')
  expect(text.text).toContain('Repository: https://github.com/brianbrinley/ClaudeMods')
  expect(written).toEqual([])
  const saved = await $.command.run(dashboard('report save'))
  expect(saved.text).toContain('Saved to /work/boomi-session-report-')
  expect(written[0]!.path).toMatch(/^\/work\/boomi-session-report-\d{12}\.md$/)
  expect(written[0]!.text).toContain('# Boomi Companion session report')
  const tool = await $.tool.call({ tool: 'mcp__boomi-dashboard__report' } as never)
  expect(JSON.stringify(tool)).toContain('Boomi Companion session report')
})

test('Run again repeats a failed test the way Claude ran it, and a pass clears it', async ($, on) => {
  world(on, { [FILE]: ORDERS, 'scripts/boomi-execution-query.sh': '' })
  mock.store(on)
  shell(on, 'Execution completed: status=ERROR, executionId=execution-0490202b-2e2f')
  const ran: string[][] = []
  on('process.run', async (_$, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: 'Execution completed: status=COMPLETE, executionId=execution-77aa', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect((await pane.find({ type: 'Button', key: 'rerun-0' }))?.props.label).toBe('Run again')
  const again = await $.command.run(dashboard('rerun 1'))
  expect(ran).toHaveLength(1)
  expect(ran[0]![1]).toMatch(/scripts\/boomi-test-execute\.sh$/)
  expect(ran[0]!.slice(2)).toEqual(['--process-id', ID])
  expect(again.text).toContain('✓')
  const text = await $.command.run(dashboard('text'))
  expect(text.text).toContain('✓ Nothing needs attention.')
  expect((await $.command.run(dashboard('rerun 1'))).text).toContain('Nothing to run again')
})

test('the spend budget shows in the summary and toasts once as it nears', { options: { budgetUsd: 1.5 } }, async ($, on) => {
  const toasts = world(on, { [FILE]: ORDERS })
  shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
  const text = await $.command.run(dashboard('text'))
  expect(text.text).toContain('Session: $1.25 so far · ◐ 83% of the $1.50 budget')
  expect(toasts.filter(t => t.includes('83% of the $1.50 budget'))).toHaveLength(1)
})

test('after Claude\'s turn, the prompt box suggests the step a process still needs, once', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
  const suggestions: string[] = []
  on('prompt.suggest', async (_$, e) => {
    suggestions.push(e.text)
    return { isShown: true }
  })
  on('turn.complete', async () => ({ text: '' }))
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
  await $.turn.complete({ reason: 'answer', turnId: 't1', answer: '' } as never)
  await $.command.run(dashboard('text'))
  await $.turn.complete({ reason: 'answer', turnId: 't2', answer: '' } as never)
  await $.command.run(dashboard('text'))
  expect(suggestions).toEqual(['Deploy Orders Sync and test it'])
})

test('no suggestion when turned off', { options: { suggestions: false } }, async ($, on) => {
  world(on, { [FILE]: ORDERS })
  shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
  const suggestions: string[] = []
  on('prompt.suggest', async (_$, e) => {
    suggestions.push(e.text)
    return { isShown: true }
  })
  on('turn.complete', async () => ({ text: '' }))
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
  await $.turn.complete({ reason: 'answer', turnId: 't1', answer: '' } as never)
  await $.command.run(dashboard('text'))
  expect(suggestions).toEqual([])
})

const SCANNED = JSON.stringify({
  version: 1,
  scanned: 4,
  sessions: [
    {
      id: 'aaaaaaaa-1111',
      project: '/Users/me/orders',
      startedAt: '2026-10-10T09:00:00Z',
      costUsd: 3.5,
      models: { 'claude-opus-5-5': { input: 100, output: 900, cacheRead: 50_000, cacheWrite: 1000 } },
      commands: [`bash scripts/boomi-component-push.sh ${FILE}`],
    },
  ],
})

test('/bc-dashboard history scans the transcripts with the bundled script, and the pane keeps the result', async ($, on) => {
  world(on)
  mock.store(on)
  const ran: string[][] = []
  on('process.run', async (_$, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: SCANNED, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect((await pane.find({ type: 'Button', key: 'history-scan' }))?.props.label).toBe('Scan')
  const text = await $.command.run(dashboard('history'))
  // Through bash first: on Windows, Git Bash is where Perl is.
  expect(ran).toHaveLength(1)
  expect(ran[0]!.slice(0, 4)).toEqual(['bash', '-c', 'exec perl "$@"', 'scan-sessions'])
  expect(ran[0]![4]).toMatch(/\/scripts\/scan-sessions\.pl$/)
  expect(ran[0]!.slice(5)).toEqual(['--since', String(NOW - 90 * 86_400_000)])
  expect(text.text).toContain('This week: 1 session · $3.50')
  expect(text.text).toContain('$3.50')
  expect(text.text).toContain('1 push · Orders · 2.0k tokens')
  expect(await pane.find({ text: /This week \$3\.50 · 1 session/ })).toBeDefined()
  expect((await pane.find({ type: 'Button', key: 'history-scan' }))?.props.label).toBe('Rescan')
  const tool = await $.tool.call({ tool: 'mcp__boomi-dashboard__history' } as never)
  expect(JSON.stringify(tool)).toContain('$3.50')
})

test('without bash, history runs Perl on its own; without Perl, it says what it needs and keeps the last scan', async ($, on) => {
  world(on)
  mock.store(on)
  let hasPerl = true
  const ran: string[] = []
  on('process.run', async (_$, e) => {
    ran.push(e.argv[0]!)
    if (e.argv[0] === 'bash') return { deny: 'spawn bash ENOENT' }
    if (!hasPerl) return { deny: 'spawn perl ENOENT' }
    return { value: { exitCode: 0, stdout: SCANNED, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  expect((await $.command.run(dashboard('history'))).text).toContain('$3.50')
  expect(ran).toEqual(['bash', 'perl'])
  hasPerl = false
  expect((await $.command.run(dashboard('history'))).text).toContain('History needs Perl')
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /History needs Perl/ })).toBeDefined()
  expect(await pane.find({ text: /This week \$3\.50/ })).toBeDefined()
})

test('bash without Perl (exit 127) falls through to Perl on its own', async ($, on) => {
  world(on)
  mock.store(on)
  on('process.run', async (_$, e) =>
    e.argv[0] === 'bash'
      ? { value: { exitCode: 127, stdout: '', stderr: 'bash: perl: command not found', isStdoutTruncated: false, isStderrTruncated: false } }
      : { value: { exitCode: 0, stdout: SCANNED, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } },
  )
  expect((await $.command.run(dashboard('history'))).text).toContain('$3.50')
})

test('a Perl without its JSON module (a minimal Ubuntu or WSL) says what to install', async ($, on) => {
  world(on)
  mock.store(on)
  const stderr = "Perl's JSON module is missing. On Debian or Ubuntu (WSL too): sudo apt install perl\n"
  on('process.run', async () => ({ value: { exitCode: 3, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } }))
  expect((await $.command.run(dashboard('history'))).text).toBe(
    "The transcript scan failed: Perl's JSON module is missing. On Debian or Ubuntu (WSL too): sudo apt install perl",
  )
})

test('the pane and the text show what the standards and runtime mods report, when they are loaded', async ($, on) => {
  world(on)
  on('state.get', { plugin: 'boomi-standards', key: 'activity' } as never, async () => ({
    value: { version: 2, value: { checks: 2, blocked: 1, last: { script: 'push', files: 1, errors: 1, warnings: 0, isBlocked: true, findings: ['Orders.xml: a password is typed into a password field'] } } },
  }) as never)
  on('state.get', { plugin: 'boomi-runtime', key: 'runtime' } as never, async () => ({
    value: { version: 5, value: { phase: 'online', message: 'Online', name: 'cc-20261012-abc', executions: [], log: [], smoke: { phase: 'passed', message: 'COMPLETE' } } },
  }) as never)
  const text = await $.command.run(dashboard('text'))
  expect(text.text).toContain('Guardrails:\n  ⚠ Standards blocked the last push: Orders.xml: a password is typed into a password field')
  expect(text.text).toContain('  ✓ Runtime cc-20261012-abc online, smoke test passed')
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /GUARDRAILS/ })).toBeDefined()
  expect(await pane.find({ text: /Runtime cc-20261012-abc online/ })).toBeDefined()
})

test('without the other mods, there is no Guardrails section', async ($, on) => {
  world(on)
  const text = await $.command.run(dashboard('text'))
  expect(text.text).not.toContain('Guardrails')
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /GUARDRAILS/ })).toBeUndefined()
})

// Companion v1.0.83's own output, line for line (OfficialBoomi/bc-integration
// scripts/boomi-deploy.sh and boomi-test-execute.sh).
const V1083 = {
  deploy: [
    `Packaging 'Orders Sync' (${ID}) from the account default branch`,
    'SUCCESS: Package 9f8e7d6c-0000-1111-2222-333344445555',
    "SUCCESS: Deployed 'Orders Sync' (package: 9f8e7d6c-0000-1111-2222-333344445555)",
  ].join('\n'),
  failedTest: [
    `Executing test for process ${ID} on atom atom-1`,
    'Execution started: requestId=executionrecord-abc',
    'SUCCESS: Test submitted (requestId: executionrecord-abc)',
    'Polling for results...',
    '  Execution in progress... (1/60)',
    'Execution completed: status=ERROR, executionId=execution-0490202b-2e2f',
  ].join('\n'),
  noWait: [`Executing test for process ${ID} on atom atom-1`, 'Execution started: requestId=executionrecord-def', 'SUCCESS: Test submitted (requestId: executionrecord-def)'].join('\n'),
  timedOut: [
    `Executing test for process ${ID} on atom atom-1`,
    'SUCCESS: Test submitted (requestId: executionrecord-ghi)',
    'Polling for results...',
    'ERROR: Polling timed out after 60 attempts',
  ].join('\n'),
}

test('Companion v1.0.83: a deploy is one step, though it prints SUCCESS for its package first', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  shell(on, V1083.deploy)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-deploy.sh ${FILE}` })
  const text = String((await $.command.run(dashboard('text'))).text)
  expect(text.match(/Deployed Orders Sync/g)).toHaveLength(1)
  expect(text).toContain('Orders Sync (process): ✓ deployed')
})

test('Companion v1.0.83: a failed test is one failed step of its component, and needs attention', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  shell(on, V1083.failedTest)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
  const text = String((await $.command.run(dashboard('text'))).text)
  expect(text).toContain('Needs attention (1)')
  expect(text).toContain('✗ test ERROR')
  expect(text).not.toContain('Test submitted')
  expect(text).not.toContain('a component')
})

test('Companion v1.0.83: a --no-wait test is submitted, not passed', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  shell(on, V1083.noWait)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID} --no-wait` })
  const text = String((await $.command.run(dashboard('text'))).text)
  expect(text).toContain('◐ test submitted, result not waited for')
  expect(text).toContain('◐ Test of')
  expect(text).not.toContain('test passed')
})

test('Companion v1.0.83: a test that times out while waited for fails', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  shell(on, V1083.timedOut)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
  const text = String((await $.command.run(dashboard('text'))).text)
  expect(text).toContain('Needs attention (1)')
  expect(text).toContain('ERROR: Polling timed out after 60 attempts')
})

test('the pane lists past sessions a page at a time: More adds a page, Fewer goes back', async ($, on) => {
  world(on)
  mock.store(on)
  const sessions = Array.from({ length: 12 }, (_, i) => ({
    id: `s${i}`,
    project: '/Users/me/ws',
    startedAt: `2026-10-${String(10 - Math.floor(i / 2)).padStart(2, '0')}T0${i % 10}:00:00Z`,
    costUsd: 1 + i / 10,
    firstPrompt: `Request number ${i}`,
    models: {},
    commands: [`bash scripts/boomi-component-push.sh ${FILE}`],
  }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: JSON.stringify({ version: 1, scanned: 12, sessions }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.command.run(dashboard('history'))
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /Showing 5 of 12/ })).toBeDefined()
  expect(await pane.find({ text: /"Request number 0"/ })).toBeDefined()
  expect(await pane.find({ text: /"Request number 7"/ })).toBeUndefined()
  // One folder for every session: it isn't repeated on each line.
  expect(await pane.find({ text: /· ws$/ })).toBeUndefined()
  await pane.press({ key: 'history-more' })
  expect(await pane.find({ text: /Showing 10 of 12/ })).toBeDefined()
  expect(await pane.find({ text: /"Request number 7"/ })).toBeDefined()
  await pane.press({ key: 'history-more' })
  expect(await pane.find({ text: /Showing 12 of 12/ })).toBeDefined()
  expect(await pane.find({ type: 'Button', key: 'history-more' })).toBeUndefined()
  await pane.press({ key: 'history-fewer' })
  expect(await pane.find({ text: /Showing 5 of 12/ })).toBeDefined()
})

test("Claude's latest steps page too: More shows older steps, Fewer goes back", async ($, on) => {
  world(on, { [FILE]: ORDERS })
  shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
  for (let i = 0; i < 14; i++) await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /Showing 6 of 14/ })).toBeDefined()
  await pane.press({ key: 'steps-more' })
  expect(await pane.find({ text: /Showing 14 of 14/ })).toBeDefined()
  expect(await pane.find({ type: 'Button', key: 'steps-more' })).toBeUndefined()
  await pane.press({ key: 'steps-fewer' })
  expect(await pane.find({ text: /Showing 6 of 14/ })).toBeDefined()
})

// --- A new session's banner, and Companion's activity log ---

/** Starts the session the way the engine does, with the store's values. */
const startSession = async ($: Engine, on: On, store: Record<string, unknown> = {}) => {
  // The store in memory, so a test can read what the plugin kept.
  on('store.get', async (_$, e) => ({ value: store[e.key] }))
  on('store.set', async (_$, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: undefined }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
}

const RECAP = { endedAt: NOW - 14 * 3_600_000, components: 4, saves: 6, deploys: 2, tests: 3, testsFailed: 1, open: 0, usd: 3.1 }

test('a new session in a Companion workspace: the banner recaps the last session, then turns through tips, until Companion does something', async ($, on) => {
  world(on, { [FILE]: ORDERS, 'active-development': '' })
  shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
  await startSession($, on, { 'activity:/work': { savedAt: RECAP.endedAt, activity: [], recap: RECAP } })

  const band = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ text: 'Last session 14h ago: 4 components · 6 saves · 2 deploys · 3 tests (1 failed) · nothing left to fix · $3.10' })).toBeDefined()
  expect(await band.find({ text: / │ \$1\.25 this session/ })).toBeDefined()
  // Not the step-by-step banner of a session at work.
  expect(await band.find({ text: /components? │/ })).toBeUndefined()

  await clock.advance(20_000)
  const next = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await next.find({ text: /^Tip: / })).toBeDefined()
  expect(await next.find({ text: /Last session/ })).toBeUndefined()

  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
  const working = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await working.find({ text: /Saved Orders Sync to Boomi \(v4\)/ })).toBeDefined()
  expect(await working.find({ text: /Tip: |Last session/ })).toBeUndefined()
})

test('outside a Companion workspace, a new session has no banner', async ($, on) => {
  world(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as RenderElement
  })
  await startSession($, on)
  const band = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ text: /BC Dashboard/ })).toBeUndefined()
})

test('a session that worked with Companion leaves its recap for the next one', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  shell(on, 'Execution completed: status=ERROR, executionId=execution-9')
  const store: Record<string, unknown> = {}
  await startSession($, on, store)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
  await clock.advance(1)
  const saved = store['activity:/work'] as { recap?: Record<string, unknown> }
  expect(saved.recap).toMatchObject({ components: 1, tests: 1, testsFailed: 1, open: 1, usd: 1.25 })
})

/** A line of Companion's activity log, as its log_activity writes it (v1.0.83). */
const logLine = (at: string, operation: string, result: string, http: number | null, details: Record<string, unknown>) =>
  JSON.stringify({
    timestamp: at,
    skill_name: 'boomi-integration',
    skill_version: '1.0.83',
    workspace: 'work',
    operation,
    script: `boomi-${operation}`,
    user: 'me',
    boomi_user: 'me@example.com',
    account_id: 'acct-1',
    environment_id: 'env-1',
    result,
    http_code: http,
    details,
  })

const LOG = '.activity-log/activity.jsonl'

test("Companion's activity log adds the script runs Claude's tool calls didn't show, once each", async ($, on) => {
  const files: Record<string, string> = {
    [FILE]: ORDERS,
    [LOG]: [
      logLine('2026-10-12T11:50:00Z', 'component-search', 'success', 200, { query: 'Orders' }),
      logLine('2026-10-12T11:51:00Z', 'component-push', 'success', 200, { component_name: 'Orders Sync', component_id: ID, file_path: FILE, branch: 'account-default', version: '5' }),
      logLine('2026-10-12T11:55:00Z', 'test-execute', 'success', 200, { process_id: ID, atom_id: 'atom-1', request_id: 'r1', execution_id: 'execution-77', status: 'ERROR', waited: true }),
    ].join('\n'),
  }
  const toasts = world(on, files)
  await startSession($, on)
  const status = await $.command.run(dashboard('text'))
  expect(status.text).toContain("✓ Saved Orders Sync to Boomi (v5), 9m ago (from Companion's log)")
  expect(status.text).toContain('Needs attention (1):')
  expect(status.text).toContain('Execution 77…: press Why? to read what failed.')
  // A search isn't a step of a component.
  expect(status.text).not.toContain('Searched')
  expect(toasts.some(t => t.includes('ended ERROR'))).toBe(true)

  // Read again: nothing new, nothing twice.
  files[LOG] += `\n${logLine('2026-10-12T11:59:00Z', 'deploy', 'fail', 400, { component_name: 'Orders Sync', component_id: ID, environment_id: 'env-1', error: 'Process is not deployable' })}`
  await clock.advance(10_000)
  const after = await $.command.run(dashboard('text'))
  expect(after.text?.match(/Saved Orders Sync to Boomi \(v5\)/g)?.length).toBe(1)
  expect(after.text).toContain('ERROR: deploy failed (HTTP 400): Process is not deployable')
  expect(after.text).toContain('Needs attention (2):')
})

test("a script Claude ran is one step, though Companion's log records it too", async ($, on) => {
  const files: Record<string, string> = { [FILE]: ORDERS, [LOG]: '' }
  world(on, files)
  shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
  await startSession($, on)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
  files[LOG] = logLine('2026-10-12T12:00:00Z', 'component-push', 'success', 200, { component_name: 'Orders Sync', component_id: ID, file_path: FILE, version: '4' })
  await clock.advance(10_000)
  const status = await $.command.run(dashboard('text'))
  expect(status.text?.match(/Saved Orders Sync to Boomi \(v4\)/g)?.length).toBe(1)
  expect(status.text).not.toContain("Companion's log")
})

test("with activityLog off, Companion's log isn't read", { options: { activityLog: false } }, async ($, on) => {
  world(on, { [LOG]: logLine('2026-10-12T11:51:00Z', 'component-push', 'success', 200, { component_name: 'Orders Sync', component_id: ID, version: '5' }) })
  await startSession($, on)
  const status = await $.command.run(dashboard('text'))
  expect(status.text).not.toContain('Orders Sync')
})

// --- /bc-dashboard why and rerun without a number ---

const OTHER_ID = '2b3c4d5e-1111-2222-3333-444455556666'

type Question = { question: string; header: string; options: { label: string }[] }

/** Two failed tests Claude ran; `answer` picks in the question dialog, or dismisses it with undefined. */
const twoFailedTests = async ($: Engine, on: On, answer: (q: Question) => string | undefined) => {
  world(on, { [FILE]: ORDERS, 'scripts/boomi-execution-query.sh': '' })
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const q = e.questions[0] as unknown as Question
    const picked = answer(q)
    return picked === undefined ? { deny: 'dismissed' } : { result: { questions: [q], answers: { [q.question]: picked } } as never }
  })
  mock.store(on)
  scriptedShell(on, {
    [`bash scripts/boomi-test-execute.sh --process-id ${ID}`]: 'Execution completed: status=ERROR, executionId=execution-aaaa1111',
    [`bash scripts/boomi-test-execute.sh --process-id ${OTHER_ID}`]: 'Execution completed: status=ERROR, executionId=execution-bbbb2222',
  })
  const ran: string[][] = []
  on('process.run', async (_$, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: e.argv[1] === '-c' ? '' : 'SEVERE\tMap\tbad field', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
  await clock.advance(60_000)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${OTHER_ID}` })
  return ran
}

test('/bc-dashboard why with nothing failed says there is nothing to look into', async ($, on) => {
  world(on)
  const asked: unknown[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    asked.push(e)
    return { deny: 'not expected' }
  })
  const why = await $.command.run(dashboard('why'))
  expect(why.text).toBe('Nothing to look into: no failed test or run under Needs attention has a log to read.')
  const rerun = await $.command.run(dashboard('rerun'))
  expect(rerun.text).toBe('Nothing to run again: no failed test Claude ran is under Needs attention.')
  expect(asked).toEqual([])
})

test('/bc-dashboard why with one failure reads it without asking', async ($, on) => {
  world(on, { [FILE]: ORDERS, 'scripts/boomi-execution-query.sh': '' })
  mock.store(on)
  shell(on, 'Execution completed: status=ERROR, executionId=execution-0490202b-2e2f')
  on('process.run', async (_$, e) => ({
    value: { exitCode: 0, stdout: e.argv[1] === '-c' ? '' : 'SEVERE\tx\ty', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
  const why = await $.command.run(dashboard('why'))
  expect(why.text).toContain('(execution execution-0490202b-2e2f):')
})

test('/bc-dashboard why with several failures asks which, newest first, and reads the one picked', async ($, on) => {
  const asked: Question[] = []
  const ran = await twoFailedTests($, on, q => {
    asked.push(q)
    return q.options[1]!.label
  })
  const why = await $.command.run(dashboard('why'))
  expect(asked[0]?.question).toBe('Which failure should the dashboard read the log of?')
  expect(asked[0]?.header).toBe('Why?')
  expect(asked[0]?.options.map(o => o.label)).toEqual([`1. Test of ${OTHER_ID.slice(0, 8)}`, `2. Test of ${ID.slice(0, 8)}`].map(start => expect.stringContaining(start) as never))
  expect(ran.at(-1)).toContain('execution-aaaa1111')
  expect(why.text).toContain('(execution execution-aaaa1111):')
})

test('/bc-dashboard why lists the failures to pick from when the question is dismissed, and takes a number', async ($, on) => {
  await twoFailedTests($, on, () => undefined)
  const why = await $.command.run(dashboard('why'))
  expect(why.text).toContain('Which failure should the dashboard read the log of?')
  expect(why.text).toContain(`  1. ✗ Test of ${OTHER_ID}`)
  expect(why.text).toContain(`  2. ✗ Test of ${ID}`)
  expect(why.text).toContain('Run /bc-dashboard why <number> with one of them.')
  expect((await $.command.run(dashboard('why 2'))).text).toContain('(execution execution-aaaa1111):')
  expect((await $.command.run(dashboard('why 7'))).text).toContain("7 isn't one of these.")
})
