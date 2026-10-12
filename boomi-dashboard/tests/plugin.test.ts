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
  expect(status.text).toContain('Ask Claude to read the execution log (0490202b…)')
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

test('without credentials the live environment is off and says why', async ($, on) => {
  world(on)
  mock.env(on, {})
  const status = await $.command.run(dashboard('poll'))
  expect(status.text).toContain('Not connected')
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

test('after a deploy, the dashboard checks Boomi again within seconds', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  mock.env(on, { ...CREDENTIALS, BOOMI_ENVIRONMENT_ID: 'env-1' })
  shell(on, "SUCCESS: Deployed 'Orders Sync' (package: p1)")
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: undefined }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  mock.store(on)
  const urls: string[] = []
  on('http.fetch', async (_$, e) => {
    urls.push(e.url)
    const result = e.url.endsWith('EnvironmentAtomAttachment/query') ? [{ atomId: 'atom-1' }] : []
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ result }) } }
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(3_000)
  const before = urls.length
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-deploy.sh ${FILE}` })
  await clock.advance(5_000)
  expect(urls.length).toBeGreaterThan(before)
})

test("the environment's new failures are toasted, and old ones don't count", async ($, on) => {
  const toasts = world(on)
  mock.env(on, { ...CREDENTIALS, BOOMI_ENVIRONMENT_ID: 'env-1' })
  let runs = [
    { executionId: 'e0', processName: 'JMX Capability Scan', status: 'ERROR', executionTime: '2026-09-07T09:45:11Z' },
    { executionId: 'e1', processName: 'Orders Sync', status: 'COMPLETE', executionTime: '2026-10-12T10:00:00Z' },
  ]
  on('http.fetch', async (_$, e) => {
    const result = e.url.endsWith('EnvironmentAtomAttachment/query') ? [{ atomId: 'atom-1' }] : runs
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ result }) } }
  })

  const first = await $.command.run(dashboard('poll'))
  expect(first.text).toContain('✓ Nothing needs attention.')
  expect(first.text).toContain('✓ Orders Sync completed, 2h ago')
  expect(first.text).not.toContain('JMX')

  runs = [{ executionId: 'e2', processName: 'Orders Sync', status: 'ERROR', executionTime: '2026-10-12T11:55:00Z' }, ...runs]
  const status = await $.command.run(dashboard('poll'))
  expect(status.text).toContain('Orders Sync ended ERROR in the environment')
  expect(toasts.some(t => t.includes('Orders Sync failed'))).toBe(true)
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

  test(`on ${surface}, Process runs in Boomi folds to one line and stays folded for the session`, async ($, on) => {
    world(on)
    mock.env(on, { ...CREDENTIALS, BOOMI_ENVIRONMENT_ID: 'env-test' })
    on('http.fetch', async (_$, e) => {
      const result = e.url.endsWith('EnvironmentAtomAttachment/query') ? [{ atomId: 'atom-1' }] : RUNS
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ result }) } }
    })
    await $.command.run(dashboard('poll'))
    const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface, ...PANE })
    expect(await pane.find({ text: /listener|Listener/ })).toBeDefined()
    expect((await pane.find({ type: 'Button', key: 'runs-toggle' }))?.props.label).toBe('Hide')
    await pane.press({ key: 'runs-toggle' })
    expect(await pane.find({ text: '5 in 24h, 1 failed' })).toBeDefined()
    // Folded: the run lines are gone, the one-line summary stands in for them.
    expect(await pane.find({ text: /completed, / })).toBeUndefined()
    await pane.unmount()
    const again = await $.ui.mount({ plugin: 'boomi-dashboard', surface, ...PANE })
    expect(await again.find({ text: '5 in 24h, 1 failed' })).toBeDefined()
    // Needs attention stays: folding the list never hides a failure.
    expect(await again.find({ text: /ended ERROR/ })).toBeDefined()
    await again.press({ key: 'runs-toggle' })
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
}


// --- The live OrderValidator session: rows, runs and attention ---

const SKILL = '/Users/me/.claude/plugins/cache/boomi-companion/bc-integration/1.0.76/skills/boomi-integration'
const LISTENER = 'OrderValidator - Listener Validate Order'
const LISTENER_ID = '33333333-1111-1111-1111-111111111111'
const LISTENER_XML = `<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="${LISTENER_ID}" name="${LISTENER}" type="process"></bns:Component>`
const LISTENER_FILE = 'active-development/processes/Listener.xml'
const RUNS = [
  ...['a', 'b', 'c', 'd'].map(x => ({ executionId: `execution-${x}`, processName: LISTENER, processId: LISTENER_ID, status: 'COMPLETE', executionTime: '2026-10-12T11:00:00Z', executionType: 'exec_listener' })),
  { executionId: 'execution-81f61084-fd93-4565-9bda-9bf0d4b4f102', processName: LISTENER, processId: LISTENER_ID, status: 'ERROR', executionTime: '2026-10-12T11:05:00Z', executionType: 'exec_listener' },
]

/** The shell beneath the plugins, answering each command with its own output. */
const scriptedShell = (on: On, outputs: Record<string, string>) => {
  on('tool.call', { tool: 'Bash' }, async (_$, e) => ({ result: { stdout: outputs[String(e.command)] ?? '', stderr: '', interrupted: false } }))
}

test('a build in a loop and on several lines shows every component, and a failed listener run names its component', async ($, on) => {
  world(on, { [LISTENER_FILE]: LISTENER_XML })
  mock.store(on)
  mock.env(on, { ...CREDENTIALS, BOOMI_ENVIRONMENT_ID: 'env-test' })
  on('http.fetch', async (_$, e) => {
    const result = e.url.endsWith('EnvironmentAtomAttachment/query') ? [{ atomId: 'atom-1' }] : RUNS
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ result }) } }
  })
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
  const status = await $.command.run(dashboard('poll'))
  expect(status.text).toContain('OrderValidator - Order Request Profile: ✓ created in Boomi')
  expect(status.text).toContain('OrderValidator - Order Response Profile: ✓ created in Boomi')
  expect(status.text).toContain(`${LISTENER} (process): ✓ created in Boomi  ✓ deployed  ✗ 1 of 5 listener runs failed`)
  expect(status.text).toContain(`✗ Listener run of ${LISTENER} ended ERROR`)
  expect(status.text).toContain('Execution 81f61084…, a component from this session')

  const seen = await $.command.run(dashboard('seen'))
  expect(seen.text).toContain('1 failed run')
  const after = await $.command.run(dashboard('text'))
  expect(after.text).toContain('✓ Nothing needs attention.')
  expect(after.text).toContain(`✗ ${LISTENER} failed`)
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
