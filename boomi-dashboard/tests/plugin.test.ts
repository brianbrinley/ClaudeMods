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
type WorldOptions = {
  isPlaced?: boolean
  sessionId?: string
  remote?: string | null
  /** The seat's usage limits, read each time the session's usage is. */
  limits?: () => { kind: string; percentUsed: number; resetsAt?: string }[]
}

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
    value: { startedAt: 0, context: { window: 200_000, percent: 12 }, rateLimits: options.limits?.() ?? [], cost: { usd: 1.25 } },
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

  test(`on ${surface}, the flamingo stands in its water, and now and then changes its pose`, async ($, on) => {
    world(on)
    mock.store(on)
    on('session.start', async (_$, e) => ({ cwd: e.cwd }))
    on('command.register', async () => ({ value: undefined }) as never)
    on('tool.register', async () => ({ value: undefined }) as never)
    // The session starts on the mocked clock, so its scene timer does too.
    await $.session.start({ cwd: '/work', surface, isInteractive: true })
    const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface, ...PANE })
    const bird = async () => JSON.stringify((await pane.findAll({ text: /^[ ▀▄█]+$/ })).map(f => f.text))
    const standing = await bird()
    expect(standing).toContain('▀')
    // It stands in seafoam water, Valence Day's.
    const water = await pane.findAll({ type: 'Text', text: /^[▀▄]$/ })
    expect(water.some(w => w.props.color === '#9FDED6')).toBe(true)
    // Within half a minute it does something: a glance back, a blink.
    const seen = new Set([standing])
    for (let i = 0; i < 60; i++) {
      await clock.advance(500)
      seen.add(await bird())
    }
    expect(seen.size).toBeGreaterThan(1)
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
    expect(await pane.find({ text: /session 3adaec6a-0227-5e7b-a04b-eeeba5da8710/ })).toBeDefined()
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

test("after a restart, this folder's steps from the last 24h come back; older ones are kept and shown when asked", async ($, on) => {
  world(on, { [FILE]: ORDERS })
  shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
  const store: Record<string, unknown> = {
    'activity:/work': {
      savedAt: NOW - 3_600_000,
      activity: [
        { id: 1, kind: 'deploy', outcome: 'ok', subject: LISTENER, detail: 'deployed', startedAt: NOW - 3_600_000, endedAt: NOW - 3_600_000, componentId: LISTENER_ID },
        { id: 2, kind: 'push', outcome: 'ok', subject: 'Old', detail: 'x', startedAt: NOW - 3 * 86_400_000, endedAt: NOW - 3 * 86_400_000, file: 'active-development/x/Old.xml' },
        { id: 3, kind: 'test', outcome: 'failed', subject: 'Old', detail: 'ERROR', startedAt: NOW - 3 * 86_400_000, endedAt: NOW - 3 * 86_400_000, file: 'active-development/x/Old.xml', executionStatus: 'ERROR' },
      ],
    },
  }
  await startSession($, on, store)
  const status = await $.command.run(dashboard('text'))
  expect(status.text).toContain(`${LISTENER}: ✓ deployed`)
  expect(status.text).not.toContain('Old')
  expect(status.text).toContain('1 step from earlier sessions in this folder, last 24h')
  expect(status.text).toContain('2 older steps: /bc-dashboard earlier shows them')

  // A new step doesn't drop the older ones from what the folder keeps, or reuse their IDs.
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
  await clock.advance(1)
  const kept = (store['activity:/work'] as { activity: { id: number; subject: string }[] }).activity
  expect(kept.map(a => a.subject)).toEqual(['Old', 'Old', LISTENER, 'Orders Sync'])
  expect(new Set(kept.map(a => a.id)).size).toBe(4)

  // In the pane: Show 2 earlier, and then they're there, their failure as history.
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect((await pane.find({ type: 'Button', key: 'earlier' }))?.props.label).toBe('Show 2 earlier')
  await pane.press({ key: 'earlier' })
  const after = await $.command.run(dashboard('text'))
  expect(after.text).toContain('Old (process): ✓ saved')
  expect(after.text).toContain('3 steps from earlier sessions in this folder)')
  expect(after.text).toContain('✓ Nothing needs attention.')
  expect((await $.command.run(dashboard('earlier'))).text).toContain('No older steps')
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

// --- Reopening a past session ---

/** Two past sessions, the second in a folder whose name needs quoting. */
const TWO_SCANNED = JSON.stringify({
  version: 1,
  scanned: 2,
  sessions: [
    { id: 'aaaaaaaa-1111', project: '/Users/me/orders', startedAt: '2026-10-11T09:00:00Z', costUsd: 3.5, commands: [`bash scripts/boomi-component-push.sh ${FILE}`] },
    { id: 'bbbbbbbb-2222', project: "/Users/me/pat's sync", startedAt: '2026-10-10T09:00:00Z', costUsd: 1.25, commands: [`bash scripts/boomi-deploy.sh ${FILE}`] },
  ],
})

/** The scan answers with `scanned`; the clipboard takes copies when `isCopying`, and records them. */
const pastWorld = (on: On, scanned: string, isCopying = true, sessionId?: string) => {
  world(on, {}, { sessionId })
  mock.store(on)
  on('process.run', async () => ({ value: { exitCode: 0, stdout: scanned, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const copies: string[] = []
  on('ui.copy', async (_$, e) => {
    copies.push(e.text)
    return { value: isCopying ? { isCopied: true as const } : { isCopied: false as const, reason: 'no-clipboard' as const } }
  })
  return copies
}

test('Copy on a past session puts the command that reopens it on the clipboard', async ($, on) => {
  const copies = pastWorld(on, TWO_SCANNED)
  await $.command.run(dashboard('history'))
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  await pane.press({ key: 'history-copy-1' })
  expect(copies).toEqual(["cd '/Users/me/pat'\\''s sync' && claude --resume bbbbbbbb-2222"])
  expect(await pane.find({ text: /Copied\. Paste it into a new terminal/ })).toBeDefined()
})

test('where the clipboard can\'t take it, Copy shows the command to type instead', async ($, on) => {
  pastWorld(on, SCANNED, false)
  await $.command.run(dashboard('history'))
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  await pane.press({ key: 'history-copy-0' })
  expect(await pane.find({ text: /Run this in a new terminal: cd \/Users\/me\/orders && claude --resume aaaaaaaa-1111/ })).toBeDefined()
})

test('the current session has no Copy: it is already open', async ($, on) => {
  pastWorld(on, SCANNED, true, 'aaaaaaaa-1111')
  await $.command.run(dashboard('history'))
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ type: 'Button', key: 'history-copy-0' })).toBeUndefined()
})

test('/bc-dashboard resume copies the one past session there is, scanning first', async ($, on) => {
  const copies = pastWorld(on, SCANNED)
  const answer = await $.command.run(dashboard('resume'))
  expect(answer.text).toBe('Copied. Paste it into a new terminal to reopen that session:\n  cd /Users/me/orders && claude --resume aaaaaaaa-1111')
  expect(copies).toHaveLength(1)
})

test('/bc-dashboard resume asks which of several, or takes a number', async ($, on) => {
  const copies = pastWorld(on, TWO_SCANNED)
  const asked: string[][] = []
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const q = e.questions[0]!
    asked.push(q.options.map(o => o.label))
    return { result: { questions: [q], answers: { [q.question]: q.options[1]!.label } } as never }
  })
  const answer = await $.command.run(dashboard('resume'))
  expect(asked[0]).toHaveLength(2)
  expect(asked[0]![0]).toMatch(/^1\. Oct 11/)
  expect(answer.text).toContain('claude --resume bbbbbbbb-2222')
  await $.command.run(dashboard('resume 1'))
  expect(copies.at(-1)).toBe('cd /Users/me/orders && claude --resume aaaaaaaa-1111')
  expect((await $.command.run(dashboard('resume 9'))).text).toContain("9 isn't one of these.")
})

test('/bc-dashboard resume with no earlier sessions says so', async ($, on) => {
  pastWorld(on, JSON.stringify({ version: 1, scanned: 0, sessions: [] }))
  expect((await $.command.run(dashboard('resume'))).text).toBe('No earlier Companion sessions on this machine from the last 90 days to reopen.')
})

// --- Companion's other plugins ---

/** The shell beneath the plugins: each command's output and whether it exited with an error, as the plugins' scripts print them. */
const productShell = (on: On, outputs: Record<string, { out: string; isError?: boolean }>) => {
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    const found = outputs[String(e.command)] ?? { out: '' }
    return found.isError
      ? { isError: true as const, result: found.out, text: found.out }
      : { result: { stdout: found.out, stderr: '', interrupted: false } }
  })
}

const DH = '/Users/me/.claude/plugins/cache/boomi-companion/bc-datahub/0.2.12/skills/boomi-datahub/scripts'
const UNIVERSE = '7c1e9a40-2b3d-4f5e-8a9b-0c1d2e3f4a5b'

test("other Companion plugins' steps show in the feed in their own words; read-only ones don't", async ($, on) => {
  world(on)
  const deploy = `bash ${DH}/datahub-deployment.sh deploy ${UNIVERSE} repo-1 --version 3`
  const list = `bash ${DH}/datahub-model.sh list --status all`
  const run = 'bash scripts/bdi-flow.sh run 65f0c2a1b3d4e5f6a7b8c9d0'
  const install = `BOOMI_COMMON_SH=/x/boomi-common.sh bash scripts/boomi-marketplace-install.sh --bundle-id abc123 --folder-id 42`
  productShell(on, {
    [deploy]: { out: '{"id":"dep-1","status":"PENDING"}' },
    [list]: { out: '[]' },
    [run]: { out: '{"run_id":"r-1"}' },
    [install]: { out: "SUCCESS: Installed 'Salesforce to NetSuite Orders'" },
  })
  for (const command of [list, deploy, run, install]) await $.tool.call({ tool: 'Bash', command })
  const text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('◐ Data Hub: universe 7c1e9a40… deploying')
  expect(text).toContain('◐ BDI: flow 65f0c2a1… run started')
  expect(text).toContain('✓ Marketplace: installed recipe Salesforce to NetSuite Orders')
  expect(text).not.toContain('list')
  expect(text).toContain('✓ Nothing needs attention.')
  // The banner leads with the newest of them.
  const band = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ text: /Marketplace: installed recipe/ })).toBeDefined()
})

test("another plugin's failure needs attention with its error line, until the same action succeeds", async ($, on) => {
  const toasts = world(on)
  const deploy = `bash ${DH}/datahub-deployment.sh deploy ${UNIVERSE} repo-1 --version 3`
  let outcome = { out: 'ERROR: HTTP 400\n<error><message>Model version 3 is not published</message></error>', isError: true }
  on('tool.call', { tool: 'Bash' }, async () =>
    outcome.isError ? { isError: true as const, result: outcome.out, text: outcome.out } : { result: { stdout: outcome.out, stderr: '', interrupted: false } },
  )
  await $.tool.call({ tool: 'Bash', command: deploy })
  const failed = (await $.command.run(dashboard('text'))).text ?? ''
  expect(failed).toContain('Needs attention (1):')
  expect(failed).toContain("✗ Data Hub: couldn't deploy universe 7c1e9a40…")
  expect(failed).toContain('ERROR: HTTP 400')
  expect(toasts.some(t => t.includes("couldn't deploy universe"))).toBe(true)

  outcome = { out: '{"status":"SUCCESS"}', isError: false }
  await $.tool.call({ tool: 'Bash', command: deploy })
  const after = (await $.command.run(dashboard('text'))).text ?? ''
  expect(after).toContain('✓ Nothing needs attention.')
  expect(after).toContain('✓ Data Hub: deployed universe 7c1e9a40…')
})

test("a connector descriptor accepted with warnings is a warning to read, not a pass", async ($, on) => {
  world(on)
  const validate = 'bash scripts/connectordev-version.sh validate src/main/resources/connector-descriptor.xml'
  productShell(on, { [validate]: { out: '{"result":"WARNING"}\nWARNING: descriptor accepted with warnings — read the response above' } })
  await $.tool.call({ tool: 'Bash', command: validate })
  const text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('◐ Connectors: validated connector descriptor connector-descriptor.xml')
  expect(text).toContain('WARNING: descriptor accepted with warnings')
})

test('a session with more than one product splits its spend by product', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  const push = `bash scripts/boomi-component-push.sh ${FILE}`
  const run = 'bash scripts/bdi-flow.sh run flow-1'
  productShell(on, { [push]: { out: "SUCCESS: Pushed component 'Orders Sync' — now version 4" }, [run]: { out: '{}' } })
  await $.tool.call({ tool: 'Bash', command: push })
  await $.tool.call({ tool: 'Bash', command: run })
  const text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toMatch(/By product: Integration \$1\.25 · BDI /)
  const report = (await $.command.run(dashboard('report'))).text ?? ''
  expect(report).toContain("## Companion's other plugins")
  expect(report).toContain('- ✓ BDI: ran flow flow-1')
})

// --- Usage limits and a personal Companion budget ---

/** The weekly window, three days into a week that resets in four. */
const WEEK_RESET = new Date(NOW + 4 * 86_400_000).toISOString()

test('the seat\'s usage limits show in the pane, the banner and the text, and warn once at 80%', async ($, on) => {
  let weekly = 42
  const toasts = world(on, { [FILE]: ORDERS }, {
    limits: () => [
      { kind: 'five_hour', percentUsed: 12, resetsAt: new Date(NOW + 2 * 3_600_000).toISOString() },
      { kind: 'seven_day', percentUsed: weekly, resetsAt: WEEK_RESET },
    ],
  })
  shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
  await startSession($, on)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
  const text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('Usage limits: ✓ weekly 42%, resets in 4d 0h, on pace for 98% by reset · ✓ 5-hour 12%, resets in 2h 0m')
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: 'LIMITS' })).toBeDefined()
  expect(await pane.find({ text: /▰+▱+ 42%/ })).toBeDefined()
  const band = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ text: /week 42% · 5h 12%/ })).toBeDefined()

  weekly = 84
  await clock.advance(5_000)
  await clock.advance(5_000)
  expect(toasts).toEqual(['◐ 84% of your weekly Claude limit used, resets in 3d 23h'])
  expect((await $.command.run(dashboard('text'))).text).toContain('◐ weekly 84%')
})

test("off a subscription there are no limits to show", async ($, on) => {
  world(on)
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: 'LIMITS' })).toBeUndefined()
  expect((await $.command.run(dashboard('text'))).text).not.toContain('Usage limits')
})

test("Companion's share of the limit counts how far Companion sessions move it, per day", { options: { companionShare: 30, companionSharePeriod: 'day' } }, async ($, on) => {
  let weekly = 40
  const store: Record<string, unknown> = {}
  world(on, { [FILE]: ORDERS }, { limits: () => [{ kind: 'seven_day', percentUsed: weekly, resetsAt: WEEK_RESET }] })
  shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
  await startSession($, on, store)
  // Before any Companion work, the limit's moves aren't Companion's.
  weekly = 41
  await clock.advance(5_000)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
  await clock.advance(5_000)
  weekly = 43.1
  await clock.advance(5_000)
  const text = (await $.command.run(dashboard('text'))).text ?? ''
  // 30% of the weekly limit a week is 4.3% a day; 2.1% of it is 49%.
  expect(text).toContain('Companion today: 2.1% of your weekly limit, 49% of its 4.3% (30% share per week, a seventh a day)')
  expect(store.shareDays).toEqual({ '2026-10-12': 2.1 })
})

test("a monthly Companion amount adds this month's earlier sessions to this one", { options: { companionMonthlyUsd: 10 } }, async ($, on) => {
  world(on)
  mock.store(on)
  on('process.run', async () => ({ value: { exitCode: 0, stdout: SCANNED, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.command.run(dashboard('history'))
  // $3.50 earlier this month, $1.25 so far in this session.
  expect((await $.command.run(dashboard('text'))).text).toContain('✓ Companion this month: $4.75 of $10')
})

test("a Marketplace recipe's components join the session's components, and a pull names them", async ($, on) => {
  world(on, { 'active-development/processes/Order Sync.xml': `<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="783e3c22-aaaa-bbbb-cccc-000000000001" name="Order Sync" type="process"></bns:Component>` })
  const install = 'BOOMI_COMMON_SH=/x/boomi-common.sh bash scripts/boomi-marketplace-install.sh --bundle-id b-1 --folder-id 42'
  const pull = 'bash scripts/boomi-component-pull.sh --component-id 783e3c22-aaaa-bbbb-cccc-000000000001'
  productShell(on, {
    [install]: {
      out: [
        'Installing marketplace recipe...',
        '  Bundle ID: b-1',
        "SUCCESS: Installed 'Salesforce to NetSuite Orders'",
        '',
        'Copied component IDs:',
        '  783e3c22-aaaa-bbbb-cccc-000000000001 (v1)',
        '  783e3c22-aaaa-bbbb-cccc-000000000002 (v3)',
      ].join('\n'),
    },
    [pull]: { out: 'SUCCESS: Component saved to active-development/processes/Order Sync.xml' },
  })
  await $.tool.call({ tool: 'Bash', command: install })
  const text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('✓ Marketplace: installed recipe Salesforce to NetSuite Orders')
  expect(text).toContain('783e3c22-aaaa-bbbb-cccc-000000000002: ✓ from recipe Salesforce to NetSuite Orders (v3)')
  // The install is one step in the feed, not one per component.
  expect(text.match(/installed from recipe/g)).toBeNull()

  await $.tool.call({ tool: 'Bash', command: pull })
  const after = (await $.command.run(dashboard('text'))).text ?? ''
  expect(after).toContain('Order Sync (process): ✓ from recipe Salesforce to NetSuite Orders  ✓ pulled from Boomi')
})

test("a BDI run started shows how it ended once Claude checks its status: a failure needs attention with BDI's reason", async ($, on) => {
  const toasts = world(on)
  const run = 'bash scripts/bdi-flow.sh run orders-flow'
  const check = 'bash scripts/bdi-flow.sh status orders-flow r-77'
  let status = { run_id: 'r-77', status: 'running' } as Record<string, string>
  on('tool.call', { tool: 'Bash' }, async (_$, e) => ({
    result: { stdout: String(e.command) === run ? '{"run_id":"r-77","river_id":"orders-flow"}' : JSON.stringify(status), stderr: '', interrupted: false },
  }))
  await $.tool.call({ tool: 'Bash', command: run })
  expect((await $.command.run(dashboard('text'))).text).toContain('◐ BDI: flow orders-flow run started')

  await $.tool.call({ tool: 'Bash', command: check })
  expect((await $.command.run(dashboard('text'))).text).toContain('✓ Nothing needs attention.')

  status = { run_id: 'r-77', status: 'failed', error_description: 'Target table orders_stg does not exist' }
  await $.tool.call({ tool: 'Bash', command: check })
  const failed = (await $.command.run(dashboard('text'))).text ?? ''
  expect(failed).toContain('Needs attention (1):')
  expect(failed).toContain('✗ BDI: flow orders-flow run failed')
  expect(failed).toContain('ERROR: Target table orders_stg does not exist (run r-77)')
  expect(toasts.some(t => t.includes('run failed'))).toBe(true)

  // The same run, checked again after a rerun succeeds: the failure clears.
  status = { run_id: 'r-77', status: 'succeeded' }
  await $.tool.call({ tool: 'Bash', command: check })
  expect((await $.command.run(dashboard('text'))).text).toContain('✓ Nothing needs attention.')
})

test('a BDI run cancelled reads as cancelled, not failed', async ($, on) => {
  world(on)
  const outputs: Record<string, string> = {
    'bash scripts/bdi-flow.sh run f-1': '{"run_id":"r-1"}',
    'bash scripts/bdi-flow.sh status f-1 r-1': '{"run_id":"r-1","status":"failed","error_description":"Run canceled"}',
    'bash scripts/bdi-flow.sh run f-2': '{"run_id":"r-2"}',
    'bash scripts/bdi-flow.sh status f-2 r-2': '{"run_id":"r-2","status":"succeeded"}',
  }
  on('tool.call', { tool: 'Bash' }, async (_$, e) => ({ result: { stdout: outputs[String(e.command)] ?? '', stderr: '', interrupted: false } }))
  for (const command of Object.keys(outputs)) await $.tool.call({ tool: 'Bash', command })
  const text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('✓ BDI: flow f-1 run cancelled')
  expect(text).toContain('✓ BDI: flow f-2 ran and succeeded')
  expect(text).toContain('✓ Nothing needs attention.')
})

test('every budget the person set shows in a BUDGET gauge, the fullest first', { options: { budgetUsd: 5, companionMonthlyUsd: 2 } }, async ($, on) => {
  world(on)
  mock.store(on)
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: 'BUDGET' })).toBeDefined()
  // $1.25 of a $2 month is 63%; $1.25 of a $5 session is 25%.
  expect(await pane.find({ text: /▰+▱+ 63%/ })).toBeDefined()
  expect(await pane.find({ text: '✓ month: $1.25 of $2.00' })).toBeDefined()
  expect(await pane.find({ text: '✓ session: $1.25 of $5.00' })).toBeDefined()
})

test('without a budget set, there is no BUDGET gauge', async ($, on) => {
  world(on)
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: 'BUDGET' })).toBeUndefined()
})

test('/bc-dashboard size asks for a pane size, keeps it, and goes back to the default', async ($, on) => {
  world(on, {}, { isPlaced: true })
  const store: Record<string, unknown> = {}
  await startSession($, on, store)
  const answer = await $.command.run(dashboard('size 30 90'))
  expect(answer.text).toContain('asks for 30 rows and 90 columns')
  expect(opens.at(-1)).toMatchObject({ rows: 30, columns: 90 })
  expect(store.paneSize).toEqual({ rows: 30, columns: 90 })
  await $.command.run(dashboard())
  expect(opens.at(-1)).toMatchObject({ rows: 30, columns: 90 })
  expect((await $.command.run(dashboard('size 3'))).text).toContain('Usage: /bc-dashboard size')
  expect((await $.command.run(dashboard('size'))).text).toContain('back to its usual size')
  await $.command.run(dashboard())
  expect(opens.at(-1)?.rows).toBeUndefined()
})

const COSTLY_SCANNED = JSON.stringify({
  version: 1,
  scanned: 2,
  sessions: [
    { id: 'cheap-1', project: '/work', startedAt: '2026-10-11T09:00:00Z', costUsd: 0.5, commands: [`bash scripts/boomi-component-push.sh ${FILE}`], prompts: 4, models: { 'claude-sonnet-5-5': { input: 1000, output: 1000 } } },
    {
      id: 'costly-2',
      project: '/work',
      startedAt: '2026-10-10T09:00:00Z',
      costUsd: 20.1,
      commands: Array(5).fill(`bash scripts/boomi-test-execute.sh --process-id ${ID}`),
      prompts: 30,
      peakContext: 150_000,
      models: { 'claude-opus-5-5': { input: 10_000, output: 90_000, cacheRead: 2_000_000, cacheWrite: 50_000 } },
      file: '/home/me/.claude/projects/-work/costly-2.jsonl',
    },
  ],
})

test('Review on a past session shows what drove its cost, and Ask Claude to review drafts the request', async ($, on) => {
  world(on)
  mock.store(on)
  on('process.run', async () => ({ value: { exitCode: 0, stdout: COSTLY_SCANNED, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const fills: string[] = []
  on('prompt.read', async () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', async (_$, e) => {
    fills.push(String(e.text))
    return { isFilled: true }
  })
  await $.command.run(dashboard('history'))
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect((await pane.find({ type: 'Button', key: 'history-review-1' }))?.props.label).toBe('Review')
  await pane.press({ key: 'history-review-1' })
  expect(await pane.find({ text: /Opus 5\.5 did 100% of the work/ })).toBeDefined()
  expect(await pane.find({ text: /was tested 5 times/ })).toBeDefined()
  expect(await pane.find({ text: /reached 150k tokens of context/ })).toBeDefined()
  await pane.press({ key: 'history-ask-1' })
  expect(fills.at(-1)).toContain('Review my earlier Claude Code session costly-2')
  expect(fills.at(-1)).toContain('/home/me/.claude/projects/-work/costly-2.jsonl')
  // Close folds it again.
  await pane.press({ key: 'history-review-1' })
  expect(await pane.find({ text: /did 100% of the work/ })).toBeUndefined()
})

test('/bc-dashboard review takes a number, or asks which of the costliest recent sessions', async ($, on) => {
  world(on)
  mock.store(on)
  on('process.run', async () => ({ value: { exitCode: 0, stdout: COSTLY_SCANNED, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const asked: string[][] = []
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const q = e.questions[0]!
    asked.push(q.options.map(o => o.label))
    return { result: { questions: [q], answers: { [q.question]: q.options[0]!.label } } as never }
  })
  const one = (await $.command.run(dashboard('review 1'))).text ?? ''
  expect(one).toContain('✓ Nothing stands out')
  const picked = (await $.command.run(dashboard('review'))).text ?? ''
  // The costliest first.
  expect(asked[0]![0]).toMatch(/^2\. .*\$20/)
  expect(picked).toContain('$20 · 30 prompts')
  expect(picked).toContain('Switch with /model')
  expect((await $.command.run(dashboard('review 9'))).text).toContain("9 isn't one of these.")
})

test('a Data Hub deploy shows how it went once its status is known, and a failure needs attention', async ($, on) => {
  world(on)
  const deploy = `bash scripts/datahub-deployment.sh deploy ${UNIVERSE} repo-1 --version 3`
  const check = `bash scripts/datahub-deployment.sh status ${UNIVERSE} dep-9`
  let status = 'IN_PROGRESS'
  on('tool.call', { tool: 'Bash' }, async (_$, e) => ({
    result: {
      stdout: String(e.command) === deploy ? `<mdm:UniverseDeployment xmlns:mdm="http://mdm.api.platform.boomi.com/"><mdm:id>dep-9</mdm:id><mdm:universeId>${UNIVERSE}</mdm:universeId><mdm:status>PENDING</mdm:status></mdm:UniverseDeployment>` : JSON.stringify({ id: 'dep-9', status }),
      stderr: '',
      interrupted: false,
    },
  }))
  await $.tool.call({ tool: 'Bash', command: deploy })
  expect((await $.command.run(dashboard('text'))).text).toContain('◐ Data Hub: universe 7c1e9a40… deploying')
  await $.tool.call({ tool: 'Bash', command: check })
  expect((await $.command.run(dashboard('text'))).text).toContain('✓ Nothing needs attention.')
  status = 'FAILED'
  await $.tool.call({ tool: 'Bash', command: check })
  const failed = (await $.command.run(dashboard('text'))).text ?? ''
  expect(failed).toContain('✗ Data Hub: deploy of universe 7c1e9a40… failed')
  expect(failed).toContain('ERROR: the deployment ended FAILED (deployment dep-9)')
  status = 'SUCCESS'
  await $.tool.call({ tool: 'Bash', command: check })
  const done = (await $.command.run(dashboard('text'))).text ?? ''
  expect(done).toContain('✓ Data Hub: deployed universe 7c1e9a40…')
  expect(done).toContain('✓ Nothing needs attention.')
})

const quarantineXml = (entries: [string, string, string][]) =>
  `<QuarantineQueryResponse resultCount="${entries.length}">${entries
    .map(([id, cause, reason]) => `<QuarantineEntry sourceId="SF" sourceEntityId="${id}"><cause>${cause}</cause><reason>${reason}</reason></QuarantineEntry>`)
    .join('')}</QuarantineQueryResponse>`

test('Data Hub quarantine Claude looks at is kept per universe: records in it need attention, and an empty list clears it', async ($, on) => {
  const toasts = world(on, { 'filter.xml': '<QuarantineQueryRequest/>' })
  const query = `bash scripts/datahub-quarantine.sh query --universe ${UNIVERSE}`
  let answer = quarantineXml([
    ['P1', 'PARSE_FAILURE', "Unknown element 'uniqueId'"],
    ['P2', 'PARSE_FAILURE', 'Missing field group wrapper'],
    ['P3', 'REQUIRED_FIELD', 'name is required'],
  ])
  on('tool.call', { tool: 'Bash' }, async (_$, e) => ({ result: { stdout: String(e.command).includes('filter.xml') ? quarantineXml([]) : answer, stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', command: query })
  const text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('◐ 3 records in Data Hub quarantine, universe 7c1e9a40…')
  expect(text).toContain("2 PARSE_FAILURE, 1 REQUIRED_FIELD. First: Unknown element 'uniqueId'")
  expect(text).toContain('Data Hub quarantine:\n  ◐ Universe 7c1e9a40…: 3 in quarantine (2 PARSE_FAILURE, 1 REQUIRED_FIELD), checked just now')
  expect(toasts.some(t => t.includes('3 records in quarantine'))).toBe(true)
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: 'DATA HUB' })).toBeDefined()

  // A filtered query is only part of it: it doesn't change the count.
  await $.tool.call({ tool: 'Bash', command: `${query} filter.xml` })
  expect((await $.command.run(dashboard('text'))).text).toContain('3 records in Data Hub quarantine')

  // Closed: out of Needs attention until there are more.
  await $.command.run(dashboard('close 1'))
  expect((await $.command.run(dashboard('text'))).text).toContain('✓ Nothing needs attention.')

  answer = quarantineXml([])
  await $.tool.call({ tool: 'Bash', command: query })
  const cleared = (await $.command.run(dashboard('text'))).text ?? ''
  expect(cleared).toContain('✓ Universe 7c1e9a40…: nothing in quarantine')
  expect(cleared).toContain('✓ Nothing needs attention.')
})

test('an Agentstudio agent shows its stages, and its test conversations with how they ended', async ($, on) => {
  world(on)
  const AGENT = '5d1c2b3a-aaaa-4bbb-8ccc-0123456789ab'
  const AS = 'bash scripts'
  const create = `${AS}/agentstudio-agent.sh create --body active-development/feedback/agent.json`
  const update = `${AS}/agentstudio-agent.sh update ${AGENT} --body active-development/feedback/agent.json`
  const pack = `${AS}/agentstudio-deployment.sh package-create ${AGENT}`
  const deploy = `${AS}/agentstudio-deployment.sh deploy ${AGENT} --package pkg-1`
  const talk = `${AS}/agentstudio-session.sh invoke --deployment dep-7 --message "Where is order 42?"`
  const more = `${AS}/agentstudio-session.sh continue --deployment dep-7 --session 01KSFE6WT8G0SHSTCRWAC28WN8 --message "And 43?"`
  const replies: Record<string, { out: string; isError?: boolean }> = {
    [create]: { out: JSON.stringify({ id: AGENT, name: 'Support Triage', agent_status: 'DRAFT' }) },
    [update]: { out: JSON.stringify({ id: AGENT, name: 'Support Triage', agent_status: 'DRAFT' }) },
    [pack]: { out: JSON.stringify({ id: 'pkg-1', agent_id: AGENT, version: 1 }) },
    [deploy]: { out: JSON.stringify({ id: 'dep-7', package_id: 'pkg-1', status: 'ACTIVE' }) },
    // A conversational agent streams its reply; its answer may say anything.
    [talk]: { out: `event: message\ndata: {"session_id":"01KSFE6WT8G0SHSTCRWAC28WN8","content":"Component 'Orders' says ERROR: none"}\n\n` },
    [more]: { out: 'ERROR: HTTP 504\n{"detail":"timeout"}', isError: true },
  }
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    const found = replies[String(e.command)] ?? { out: '' }
    return found.isError ? { isError: true as const, result: found.out, text: found.out } : { result: { stdout: found.out, stderr: '', interrupted: false } }
  })

  await $.tool.call({ tool: 'Bash', command: create })
  let text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('✓ Agentstudio: created agent Support Triage')
  expect(text).toContain('Agentstudio agents:\n  Support Triage: ✓ created')

  await $.tool.call({ tool: 'Bash', command: pack })
  await $.tool.call({ tool: 'Bash', command: deploy })
  text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('✓ Agentstudio: packaged agent Support Triage')
  expect(text).toContain('✓ Agentstudio: deployed agent Support Triage')
  expect(text).toContain('Support Triage: ✓ created  ✓ packaged v1  ✓ deployed')

  await $.tool.call({ tool: 'Bash', command: talk })
  text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('✓ Agentstudio: started a test conversation with Support Triage')
  expect(text).toContain('✓ 1 test conversation, 1 turn, all answered')
  expect(text).toContain('✓ Nothing needs attention.')

  await $.tool.call({ tool: 'Bash', command: more })
  text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('✗ Agentstudio: a test conversation with Support Triage failed')
  expect(text).toContain('✗ 1 test conversation, 2 turns; the last failed')
  expect(text).toContain('ERROR: HTTP 504')

  // An edit after packaging isn't live until a new package is deployed.
  await clock.advance(60_000)
  await $.tool.call({ tool: 'Bash', command: update })
  text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('Support Triage: ✓ updated  ✓ packaged v1  ✓ deployed  ◐ changed since packaged  ✗ 1 test conversation, 2 turns; the last failed')
  expect((await $.command.run(dashboard('report'))).text).toContain('## Agentstudio agents (1)')
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ type: 'Text', text: 'AGENTSTUDIO AGENTS' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Support Triage' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: ' changed since packaged   ' })).toBeDefined()
})

test('an Agentstudio response that says success: false fails its step, and package-create --deploy counts as deployed', async ($, on) => {
  world(on)
  const pack = 'bash scripts/agentstudio-deployment.sh package-create agent-1 --deploy'
  let out = JSON.stringify({ success: false, error: '1 tool(s) remain inactive.' })
  on('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: out, stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', command: pack })
  let text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain("✗ Agentstudio: couldn't package agent agent-1")
  expect(text).toContain('ERROR: 1 tool(s) remain inactive.')
  expect(text).toContain('agent-1: ✗ packaging failed')
  out = JSON.stringify({ package_id: 'pkg-2', version: 2, deployment_id: 'dep-2' })
  await $.tool.call({ tool: 'Bash', command: pack })
  text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('agent-1: ✓ packaged v2  ✓ deployed')
})

test('a custom connector shows its release: lint, validate, upload and the version made active', async ($, on) => {
  world(on)
  const GROUP = 'acme-AB12CD-orders'
  const lint = 'bash scripts/connectordev-descriptor-lint.sh orders-connector/src/main/resources/connector-descriptor.xml'
  const validate = 'bash scripts/connectordev-version.sh validate /tmp/car/META-INF/connector-descriptor.xml'
  const upload = `bash scripts/connectordev-version.sh upload orders-connector/build/connector/orders-connector-car.zip --group ${GROUP} --changelog "First cut"`
  const set = `bash scripts/connectordev-version-change.sh set ${GROUP}-dev 2 --notes "First cut"`
  let lintOut = { out: "Schema: genericconnectordesc.xsd from connector-sdk-model 2.25.0\norders-connector/src/main/resources/connector-descriptor.xml:12: element field: Schemas validity error : Element 'field': This element is not expected.\norders-connector/src/main/resources/connector-descriptor.xml fails to validate", isError: true }
  productShell(on, {
    get [lint]() {
      return lintOut
    },
    [validate]: { out: '{"success":true}' },
    [upload]: { out: `{"groupType":"${GROUP}","versionId":2,"changeLog":"First cut"}` },
    [set]: { out: '{"classificationType":"acme-AB12CD-orders-dev","versionId":2}' },
  })

  await $.tool.call({ tool: 'Bash', command: lint })
  let text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain("ERROR: orders-connector/src/main/resources/connector-descriptor.xml:12: element field: Schemas validity error")
  expect(text).toContain('Custom connectors:\n  orders-connector: ✗ lint failed')

  lintOut = { out: 'Schema: genericconnectordesc.xsd from connector-sdk-model 2.25.0\norders-connector/src/main/resources/connector-descriptor.xml validates', isError: false }
  await $.tool.call({ tool: 'Bash', command: lint })
  await $.tool.call({ tool: 'Bash', command: validate })
  await $.tool.call({ tool: 'Bash', command: upload })
  text = (await $.command.run(dashboard('text'))).text ?? ''
  // The built descriptor, unpacked to a temporary folder, joins the same connector.
  expect(text).toContain('orders-connector: ✓ descriptor linted  ✓ validated  ✓ uploaded v2  ◐ v2 not active yet')
  expect(text).toContain('✓ Nothing needs attention.')

  await $.tool.call({ tool: 'Bash', command: set })
  text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('orders-connector: ✓ descriptor linted  ✓ validated  ✓ uploaded v2  ✓ v2 active on dev')
  expect((await $.command.run(dashboard('report'))).text).toContain(`| orders-connector (${GROUP}) |`)
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ type: 'Text', text: 'CUSTOM CONNECTORS' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: ' v2 active on dev   ' })).toBeDefined()
})

test("a PUBLIC connector's version change waits for approval, and a rejected descriptor needs attention", async ($, on) => {
  world(on)
  const set = 'bash scripts/connectordev-version-change.sh set acme-orders-prod 3'
  const validate = 'bash scripts/connectordev-version.sh validate build/connector-descriptor.xml'
  productShell(on, {
    [set]: { out: '{"classificationType":"acme-orders-prod","versionId":3,"status":"PENDING_APPROVAL"}' },
    [validate]: { out: '{"errors":["bad field"]}\nERROR: descriptor rejected — read the messages in the response above', isError: true },
  })
  await $.tool.call({ tool: 'Bash', command: set })
  await $.tool.call({ tool: 'Bash', command: validate })
  const text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('acme-orders: ◐ v3 awaiting approval on prod')
  expect(text).toContain('Connector project: ✗ descriptor rejected')
  expect(text).toContain('ERROR: descriptor rejected')
})

// --- /bc-dashboard upgrade ---------------------------------------------------------

const UPGRADE_CHECK = [
  'ROOT: /home/me/ClaudeMods',
  'MOD: boomi-dashboard',
  'ORIGIN: https://github.com/brianbrinley/ClaudeMods.git',
  'BRANCH: main',
  'HEAD: aaaa',
  'DETACHED: no',
  'TARGET: bbbb',
  'INSTALLED: 0.21.0',
  'LATEST: 0.23.0',
  'BEHIND: 2',
  'AHEAD: 0',
  'DIRTY: 0',
  'MODS: boomi-dashboard',
  'COMMIT: 1a2b3c4 boomi-dashboard 0.23.0: upgrade command',
  'COMMIT: 5d6e7f8 boomi-dashboard 0.22.0: report html',
  'FILE: M\tboomi-dashboard/hooks/register.tsx',
  'CHANGELOG: ## 0.23.0',
  'CHANGELOG: - /bc-dashboard upgrade',
].join('\n')

/** Stands in for scripts/upgrade.sh: each subcommand's output, and the calls made. */
const upgradeShell = (on: On, outputs: Partial<Record<'check' | 'install' | 'rollback', string>>) => {
  const calls: string[][] = []
  on('process.run', async (_$, e) => {
    // Only the upgrade script: the plugin list read at the start isn't it.
    if (!String(e.argv[1] ?? '').endsWith('/scripts/upgrade.sh')) return { deny: 'not the upgrade script' }
    calls.push([...e.argv])
    const sub = e.argv[2] as 'check' | 'install' | 'rollback'
    const out = outputs[sub] ?? ''
    return { value: { exitCode: /^ERROR:/m.test(out) ? 1 : 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return calls
}

/** Lets a session start in a test: the engine's own start and registrations. */
const startable = (on: On) => {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: undefined }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
}

const answerUpgrade = (on: On, label: string) => {
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const q = e.questions[0]!
    asked.push(q.question)
    return { result: { questions: [q], answers: { [q.question]: label } } as never }
  })
  return asked
}

test('/bc-dashboard upgrade --check shows the delta and changelog, and installs nothing', async ($, on) => {
  world(on)
  mock.store(on)
  const calls = upgradeShell(on, { check: UPGRADE_CHECK })
  const text = (await $.command.run(dashboard('upgrade --check'))).text ?? ''
  expect(text).toContain('boomi-dashboard 0.21.0 → 0.23.0: 2 commits behind origin/main')
  expect(text).toContain('- /bc-dashboard upgrade')
  expect(calls.map(c => c[2])).toEqual(['check'])
  expect(calls[0]![1]).toMatch(/scripts\/upgrade\.sh$/)
})

test('/bc-dashboard upgrade asks, then installs the checked commit and says to restart', async ($, on) => {
  world(on)
  mock.store(on)
  const asked = answerUpgrade(on, 'Install')
  const calls = upgradeShell(on, { check: UPGRADE_CHECK, install: 'PASSED: boomi-dashboard (validate)\nPASSED: boomi-dashboard (test)\nINSTALLED-NOW: 0.23.0\nPREVIOUS: 0.21.0 aaaa' })
  const text = (await $.command.run(dashboard('upgrade'))).text ?? ''
  expect(asked[0]).toContain('Install 0.23.0 over 0.21.0? 2 commits, 1 files')
  expect(calls.map(c => c.slice(2))).toEqual([['check', expect.any(String) as never], ['install', expect.any(String) as never, 'bbbb']])
  expect(text).toContain('✓ Installed 0.23.0 (was 0.21.0)')
  expect(text).toContain('/bc-dashboard upgrade --rollback goes back to 0.21.0')
  expect(text).toContain('Restart Claude Code')
})

test('/bc-dashboard upgrade installs nothing when the answer is Cancel; --yes skips only the question', async ($, on) => {
  world(on)
  mock.store(on)
  const asked = answerUpgrade(on, 'Cancel')
  const calls = upgradeShell(on, { check: UPGRADE_CHECK, install: 'INSTALLED-NOW: 0.23.0' })
  expect((await $.command.run(dashboard('upgrade'))).text).toContain('Not installed.')
  expect(calls.map(c => c[2])).toEqual(['check'])
  await $.command.run(dashboard('upgrade --yes'))
  expect(asked).toHaveLength(1)
  expect(calls.map(c => c[2])).toEqual(['check', 'check', 'install'])
})

test('/bc-dashboard upgrade stops before asking when the checkout has changes, and says when up to date', async ($, on) => {
  world(on)
  mock.store(on)
  const asked = answerUpgrade(on, 'Install')
  let check = UPGRADE_CHECK.replace('DIRTY: 0', 'DIRTY: 2')
  on('process.run', async () => ({ value: { exitCode: 0, stdout: check, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const text = (await $.command.run(dashboard('upgrade --yes'))).text ?? ''
  expect(text).toContain('✗ The checkout has uncommitted changes (2 files)')
  expect(text).toContain('Nothing was changed.')
  expect(asked).toHaveLength(0)
  check = UPGRADE_CHECK.replace('LATEST: 0.23.0', 'LATEST: 0.21.0').replace('BEHIND: 2', 'BEHIND: 0')
  expect((await $.command.run(dashboard('upgrade'))).text).toBe('✓ boomi-dashboard 0.21.0 is up to date with origin/main.')
})

test("/bc-dashboard upgrade keeps the current version when the new code's tests fail, and masks what it prints", async ($, on) => {
  world(on)
  mock.store(on)
  upgradeShell(on, {
    check: UPGRADE_CHECK,
    install: "TESTS-FAILED: boomi-dashboard (test)\n(fail) posts with Bearer abc.def-123\nERROR: the new version's test failed for boomi-dashboard, so it wasn't installed. You're still on 0.21.0.",
  })
  const text = (await $.command.run(dashboard('upgrade --yes'))).text ?? ''
  expect(text).toContain("✗ The new version's boomi-dashboard (test) failed, so it wasn't installed. You're still on 0.21.0.")
  expect(text).toContain('Bearer ****')
  expect(text).not.toContain('abc.def-123')
})

test('/bc-dashboard upgrade --rollback returns to the recorded version, or says none is recorded', async ($, on) => {
  world(on)
  mock.store(on)
  let out = 'INSTALLED-NOW: 0.21.0\nROLLED-BACK: 0.21.0 at aaaa; main still holds the newer version, and /bc-dashboard upgrade returns to it'
  on('process.run', async () => ({ value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const text = (await $.command.run(dashboard('upgrade --rollback'))).text ?? ''
  expect(text).toContain('✓ Rolled back to 0.21.0')
  expect(text).toContain('Restart Claude Code')
  out = 'ERROR: No previous version recorded: rollback works after an upgrade made with /bc-dashboard upgrade.'
  expect((await $.command.run(dashboard('upgrade --rollback'))).text).toContain('✗ No previous version recorded')
  expect((await $.command.run(dashboard('upgrade --force'))).text).toContain('Unknown option --force')
})

test('at session start, a newer version is announced at most once a day, never installed, and nothing is said offline', async ($, on) => {
  const toasts = world(on)
  mock.store(on)
  startable(on)
  const calls = upgradeShell(on, { check: UPGRADE_CHECK })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(20_000)
  expect(calls.map(c => c[2])).toEqual(['check'])
  expect(toasts).toContain('bc-dashboard 0.23.0 is available (you have 0.21.0): run /bc-dashboard upgrade')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(20_000)
  expect(calls.map(c => c[2])).toEqual(['check'])
})

test('the update check says nothing offline, and tries again next session', async ($, on) => {
  const toasts = world(on)
  mock.store(on)
  startable(on)
  const calls = upgradeShell(on, { check: "ERROR: couldn't fetch from origin (offline, or no access); nothing changed" })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(20_000)
  expect(calls.map(c => c[2])).toEqual(['check'])
  expect(toasts.filter(t => /available|fetch/.test(t))).toHaveLength(0)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(20_000)
  expect(calls.map(c => c[2])).toEqual(['check', 'check'])
})

test('the update check is off when updateCheck is off', { options: { updateCheck: false } }, async ($, on) => {
  const toasts = world(on)
  mock.store(on)
  startable(on)
  const calls = upgradeShell(on, { check: "ERROR: couldn't fetch from origin (offline, or no access); nothing changed" })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(20_000)
  expect(calls).toHaveLength(0)
  expect(toasts.filter(t => /available/.test(t))).toHaveLength(0)
})

test('/bc-dashboard report html writes the session as one web page, escaped and masked', async ($, on) => {
  world(on, { [FILE]: ORDERS, '.claude-plugin/plugin.json': '{ "name": "boomi-dashboard", "version": "9.9.9" }' })
  mock.store(on)
  const push = `bash scripts/boomi-component-push.sh ${FILE}`
  const run = 'bash scripts/bdi-flow.sh run flow-1'
  productShell(on, {
    [push]: { out: "SUCCESS: Pushed component 'Orders Sync' — now version 4" },
    [run]: { out: 'ERROR: HTTP 401 <script>alert(1)</script> Authorization: Bearer abc.def-123', isError: true },
  })
  const written: { path: string; text: string }[] = []
  on('fs.write', async (_$, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  await $.tool.call({ tool: 'Bash', command: push })
  await $.tool.call({ tool: 'Bash', command: run })
  const said = (await $.command.run(dashboard('report html'))).text ?? ''
  expect(said).toContain('Saved the report as a web page: /work/boomi-session-report-')
  expect(written).toHaveLength(1)
  expect(written[0]!.path).toMatch(/^\/work\/boomi-session-report-\d{12}\.html$/)
  const page = written[0]!.text
  expect(page.startsWith('<!doctype html>')).toBe(true)
  expect(page).toContain('<title>Companion Session Report</title>')
  expect(page).toContain('content="boomi-dashboard 9.9.9"')
  // Each status has its icon and its label, never color alone.
  expect(page).toContain('<span class="badge badge-healthy"><span class="icon" aria-hidden="true">✓</span><span class="sr">Healthy: </span>saved v4</span>')
  expect(page).toContain('<span class="sr">Failed: </span>BDI: couldn&#39;t run flow flow-1')
  expect(page).toContain('<h3>Outcomes by product</h3>')
  expect(page).toContain('data-pick="product:BDI"')
  expect(page).toContain('<h3>Component pipeline</h3>')
  expect(page).toContain('<th scope="row">Orders Sync</th>')
  expect(page).toContain('data-filter="product:BDI"')
  expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(page).not.toContain('<script>alert(1)')
  expect(page).toContain('Bearer ****')
  expect(page).not.toContain('abc.def-123')
  // Exosphere's tokens, light and dark, and its fonts.
  expect(page).toContain('--exo-color-background-brand:#072b55')
  expect(page).toContain('.ex-theme-dark{--exo-color-page:#1a1a1a')
  expect(page).toContain('family=Poppins')
})

/** `claude plugin list --json` beneath the plugin, answering with these plugins on. */
const pluginList = (on: On, plugins: { id: string; version: string; enabled: boolean }[]) => {
  const asked: string[][] = []
  on('process.run', async (_$, e) => {
    asked.push([...e.argv])
    const stdout = e.argv.join(' ') === 'claude plugin list --json' ? JSON.stringify(plugins.map(p => ({ ...p, scope: 'user', installPath: '/x' }))) : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return asked
}

test('with only Data Hub installed, the pane shows its section and not the Integration components; the tips say so', async ($, on) => {
  world(on, { 'active-development': '' })
  const asked = pluginList(on, [
    { id: 'bc-datahub@boomi-companion', version: '0.2.12', enabled: true },
    { id: 'bc-bdi@boomi-companion', version: '0.2.5', enabled: false },
  ])
  await startSession($, on)
  const before = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  // Until the list is read, nothing is hidden.
  expect(await before.find({ text: /COMPONENTS THIS SESSION/ })).toBeDefined()
  await before.unmount()

  await clock.advance(1_000)
  expect(asked).toContainEqual(['claude', 'plugin', 'list', '--json'])
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /COMPONENTS THIS SESSION/ })).toBeUndefined()
  expect(await pane.find({ text: /^DATA HUB/ })).toBeDefined()
  expect(await pane.find({ text: /Quarantined entities show up here/ })).toBeDefined()
  expect(await pane.find({ text: /AGENTSTUDIO AGENTS/ })).toBeUndefined()

  const band = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ text: 'Companion here: Data Hub 0.2.12' })).toBeDefined()
})

test("when Claude Code's plugin list can't be read, every section shows as before", async ($, on) => {
  world(on, { 'active-development': '' })
  mock.env(on, { HOME: '/home/me' })
  on('process.run', async () => ({ deny: 'claude: command not found' }))
  await startSession($, on)
  await clock.advance(1_000)
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /COMPONENTS THIS SESSION/ })).toBeDefined()
  const band = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ text: /Companion here/ })).toBeUndefined()
})

test('a new version is toasted once, then the pane mentions it quietly until a newer one comes', async ($, on) => {
  const toasts = world(on, { '.claude-plugin/plugin.json': '{ "name": "boomi-dashboard", "version": "0.21.0" }' })
  const store: Record<string, unknown> = {}
  on('store.get', async (_$, e) => ({ value: store[e.key] }))
  on('store.set', async (_$, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  startable(on)
  let check = UPGRADE_CHECK
  let checks = 0
  on('process.run', async (_$, e) => {
    if (!String(e.argv[1] ?? '').endsWith('/scripts/upgrade.sh')) return { deny: 'not the upgrade script' }
    checks++
    return { value: { exitCode: 0, stdout: check, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const announced = () => toasts.filter(t => /is available/.test(t))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(20_000)
  expect(announced()).toEqual(['bc-dashboard 0.23.0 is available (you have 0.21.0): run /bc-dashboard upgrade'])
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: '↑ bc-dashboard 0.23.0 is available: /bc-dashboard upgrade' })).toBeDefined()
  await pane.unmount()

  // A day later (the last check moved back a day), the same version: checked again, not toasted again, still in the footer.
  store.upgradeCheckedAt = NOW - 25 * 3_600_000
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const footer = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await footer.find({ text: /0\.23\.0 is available/ })).toBeDefined()
  await footer.unmount()
  await clock.advance(20_000)
  expect(checks).toBe(2)
  expect(announced()).toHaveLength(1)

  // Another day, a newer release: that one is news.
  check = UPGRADE_CHECK.replace('LATEST: 0.23.0', 'LATEST: 0.24.0')
  store.upgradeCheckedAt = NOW - 25 * 3_600_000
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(20_000)
  expect(announced()).toHaveLength(2)
  expect(announced()[1]).toContain('0.24.0 is available')
})

test('/bc-dashboard report html asks which steps to cover, adds Boomi\'s view of the account and components, and opens the page', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  mock.env(on, CREDENTIALS)
  const asked: Question[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const q = e.questions[0] as unknown as Question
    asked.push(q)
    return { result: { questions: [q], answers: { [q.question]: 'All sessions in this folder' } } as never }
  })
  const urls: string[] = []
  on('http.fetch', async (_$, e) => {
    urls.push(e.url)
    const text = e.url.includes('/Account/')
      ? '{"@type":"Account","accountId":"acct-1","name":"Acme Integration"}'
      : JSON.stringify({ result: [{ componentId: ID, name: 'Orders Sync', version: 4, type: 'process', folderName: 'Orders', modifiedBy: 'pat@example.com', modifiedDate: '2026-10-12T11:00:00Z' }] })
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  const opened: string[][] = []
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'bash' && e.argv[3] === 'open-report') opened.push([...e.argv.slice(4)])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const written: { path: string; text: string }[] = []
  on('fs.write', async (_$, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  // An earlier session's push, kept by the dashboard, and one of this session's.
  const earlier = { id: 1, kind: 'push', outcome: 'ok', subject: 'Orders Sync', detail: "SUCCESS: Pushed component 'Orders Sync' — now version 3", startedAt: NOW - 3 * 3_600_000, file: FILE, componentId: ID, version: '3', session: 'earlier-session-id', usdAt: 0.5 }
  shell(on, "SUCCESS: Deployed 'Orders Sync' (package: pkg-42)")
  await startSession($, on, { 'activity:/work': { savedAt: NOW - 3 * 3_600_000, activity: [earlier] } })
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-deploy.sh ${FILE}` })

  const said = (await $.command.run(dashboard('report html'))).text ?? ''
  expect(asked[0]?.question).toBe('Which steps should the report cover?')
  expect(asked[0]?.options.map(o => o.label)).toEqual(['This session', 'All sessions in this folder'])
  expect(said).toContain('Saved the report as a web page: /work/boomi-sessions-report-')
  expect(said).toContain('Opened it in your browser.')
  expect(opened).toEqual([[written[0]!.path]])
  const page = written[0]!.text
  expect(page).toContain('<title>Companion Sessions Report</title>')
  expect(page).toContain('<code>earlier-session-id</code>')
  expect(page).toContain('<dt>Account</dt><dd>Acme Integration</dd>')
  expect(page).toContain('<td>process</td><td>Orders</td>')
  expect(page).toContain('<span class="muted">package</span> <code>pkg-42</code>')
  // Only IDs and names reach the page, never the credentials.
  for (const secret of Object.values(CREDENTIALS).filter(v => !v.startsWith('https') && v !== 'acct-1')) expect(page).not.toContain(secret)
  expect(urls.some(u => u.endsWith('/acct-1/ComponentMetadata/query'))).toBe(true)

  // Named on the command line, there's no question; --no-open leaves the browser alone.
  const again = (await $.command.run(dashboard('report html session --no-open'))).text ?? ''
  expect(asked).toHaveLength(1)
  expect(opened).toHaveLength(1)
  expect(again).toContain('/work/boomi-session-report-')
  expect(written[1]!.text).not.toContain('earlier-session-id')
})
