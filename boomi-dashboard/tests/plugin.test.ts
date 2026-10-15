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
  /** The session's ID, or a function for one that changes (a /clear). */
  sessionId?: string | (() => string)
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
  on('session.id', async () => ({ value: (typeof options.sessionId === 'function' ? options.sessionId() : options.sessionId) ?? '3adaec6a-0227-5e7b-a04b-eeeba5da8710' }))
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

test("a test whose process ID the shell filled in, and that the atom refused, is named after the process", async ($, on) => {
  world(on, { [FILE]: ORDERS })
  const refused = [`Executing test for process ${ID} on atom atom-1`, `ERROR: Execution failed (HTTP 400): <error><message>Process ${ID} cannot be executed on atom atom-1.</message></error>`].join('\n')
  on('tool.call', { tool: 'Bash' }, async (_$, e) =>
    /test-execute/.test(String(e.command)) ? { isError: true as const, result: refused, text: refused } : { result: { stdout: V1083.deploy, stderr: '', interrupted: false } },
  )
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-deploy.sh ${FILE}` })
  await $.tool.call({ tool: 'Bash', command: `PID=$(grep -o 'componentId="[^"]*' ${FILE} | cut -d'"' -f2) && bash scripts/boomi-test-execute.sh --process-id "$PID"` })
  const text = String((await $.command.run(dashboard('text'))).text)
  expect(text).toContain('Test of Orders Sync failed')
  expect(text).not.toContain('a component')
})

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
  // Past sessions start folded to their totals: unfold them.
  await pane.press({ key: 'history-toggle' })
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
  // Past sessions start folded to their totals: unfold them.
  await pane.press({ key: 'history-toggle' })
  await pane.press({ key: 'history-copy-1' })
  expect(copies).toEqual(["cd '/Users/me/pat'\\''s sync' && claude --resume bbbbbbbb-2222"])
  expect(await pane.find({ text: /Copied\. Paste it into a new terminal/ })).toBeDefined()
})

test('where the clipboard can\'t take it, Copy shows the command to type instead', async ($, on) => {
  pastWorld(on, SCANNED, false)
  await $.command.run(dashboard('history'))
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  // Past sessions start folded to their totals: unfold them.
  await pane.press({ key: 'history-toggle' })
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
  expect(failed).toContain('Target table orders_stg does not exist. Run r-77…: press Why? to read its log.')
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
  // Past sessions start folded to their totals: unfold them.
  await pane.press({ key: 'history-toggle' })
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
  expect(page).toContain('<td class="lane" data-sort="3"><span class="status status-healthy"><svg class="i" viewBox="0 0 16 16" aria-hidden="true" focusable="false">')
  expect(page).toContain('<span class="sr">Healthy: </span>saved v4</span>')
  expect(page).toContain('<span class="sr">Failed: </span>BDI: couldn&#39;t run flow flow-1')
  expect(page).toContain('<h3>Outcomes by product</h3>')
  expect(page).toContain('data-pick="product:BDI"')
  expect(page).not.toContain('Component pipeline')
  expect(page).toContain('<th scope="row" data-sort="Orders Sync">Orders Sync')
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
  expect(page).toContain('title="earlier-session-id"')
  expect(page).toContain('<span class="label">Boomi account</span> <strong>Acme Integration</strong>')
  expect(page).toContain('<div class="sub">process · Orders</div>')
  expect(page).toContain('package <code class="copy" data-copy="pkg-42" title="Copy">pkg-42</code>')
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

test("an all-sessions report reads only this folder's transcripts, only for steps no scan has matched, and only once", async ($, on) => {
  world(on, { [FILE]: ORDERS, '/home/me/.claude/projects/-work': '' })
  mock.env(on, { HOME: '/home/me' })
  on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'not expected' }))
  on('http.fetch', async () => ({ value: { status: 401, ok: false, headers: {}, text: '' } }))
  const scans: string[][] = []
  on('process.run', async (_$, e) => {
    if (e.argv.join(' ').includes('scan-sessions')) {
      scans.push([...e.argv.slice(e.argv.indexOf('--root'))])
      const session = { id: 'transcript-1', project: '/work', startedAt: new Date(NOW - 4 * 3_600_000).toISOString(), endedAt: new Date(NOW - 2 * 3_600_000).toISOString(), costUsd: 2.5, commands: [`bash scripts/boomi-component-push.sh ${FILE}`], models: {} }
      return { value: { exitCode: 0, stdout: JSON.stringify({ sessions: [session], scanned: 1 }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 3, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const written: string[] = []
  on('fs.write', async (_$, e) => {
    written.push(e.text)
    return { value: undefined }
  })
  // A push from before steps named their session, three hours ago.
  const old = { id: 1, kind: 'push', outcome: 'ok', subject: 'Orders Sync', detail: "SUCCESS: Pushed component 'Orders Sync' — now version 3", startedAt: NOW - 3 * 3_600_000, file: FILE, componentId: ID, usdAt: 0.4 }
  await startSession($, on, { 'activity:/work': { savedAt: NOW - 3 * 3_600_000, activity: [old] } })

  await $.command.run(dashboard('report html all --no-open'))
  // Only this folder's transcripts, from a day before the step on.
  expect(scans).toEqual([['--root', '/home/me/.claude/projects/-work', '--since', String(NOW - 3 * 3_600_000 - 86_400_000)]])
  expect(written[0]).toContain('data-copy="transcript-1"')
  expect(written[0]).toContain('$2.50')

  // The next report already knows that session: no scan.
  await $.command.run(dashboard('report html all --no-open'))
  expect(scans).toHaveLength(1)
  expect(written[1]).toContain('data-copy="transcript-1"')
})

// --- /bc-dashboard config ---------------------------------------------------------

/** The dashboard's /config rows, holding `values`; records each change the plugin makes, and answers the dialog in order. */
const configWorld = (on: On, values: Record<string, unknown>, answers: (string | undefined)[], locked: string[] = []) => {
  pastWorld(on, TWO_SCANNED)
  const sets: [string, unknown][] = []
  const asked: Question[] = []
  on('config.list', async () => ({
    value: Object.entries(values).map(([field, value]) => ({
      key: `boomi-dashboard.${field}`,
      label: field,
      kind: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'text',
      value,
      provider: { plugin: 'boomi-dashboard' },
      isLocked: locked.includes(field),
    })) as never,
  }))
  on('config.set', async (_$, e) => {
    sets.push([e.key, e.value])
    return { value: e.value }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const q = e.questions[0] as unknown as Question
    asked.push(q)
    const picked = answers.shift()
    return picked === undefined ? { deny: 'dismissed' } : { result: { questions: [q], answers: { [q.question]: picked } } as never }
  })
  return { sets, asked }
}

test('/bc-dashboard config walks the budget with figures from past sessions, and saves at Done', async ($, on) => {
  // Past sessions cost $3.50 and $1.25: twice the typical one is $2.50, the costliest $3.50.
  const { sets, asked } = configWorld(on, { budgetUsd: 0, companionMonthlyUsd: 0, companionShare: 0 }, [
    'Budget',
    '$2.50 (twice a typical session)',
    'Keep off',
    '30%',
    'Month',
    'Keep off',
    'Keep warn',
    'Done',
  ])
  const answer = await $.command.run(dashboard('config'))
  expect(asked.map(q => q.header)).toEqual(['Settings', 'Budget 1/7', 'Budget 2/7', 'Budget 3/7', 'Budget 4/7', 'Budget 5/7', 'Budget 6/7', 'Settings'])
  expect(asked[1]!.options.map(o => o.label)).toEqual(['Keep off', '$2.50 (twice a typical session)', '$3.50 (your costliest session)', 'Back to the menu'])
  expect(asked[1]!.question).toContain('cost $1.25 typically, $3.50 at most')
  expect(asked[7]!.question).toContain('3 changes so far, saved when you pick Done.')
  expect(sets).toEqual([
    ['boomi-dashboard.budgetUsd', 2.5],
    ['boomi-dashboard.companionShare', 30],
    ['boomi-dashboard.companionSharePeriod', 'month'],
  ])
  expect(answer.text).toBe(
    ['Saved to /config:', '  Session budget: off → $2.50', '  Companion’s share of your usage limit: off → 30%', '  Period for the share: week → month'].join('\n'),
  )
})

test('/bc-dashboard config skips the share period with no share, goes back to the menu, and asks again after a typo', async ($, on) => {
  const { sets, asked } = configWorld(on, { budgetUsd: 5, companionShare: 0 }, ['lots', '7', 'Back to the menu'])
  const answer = await $.command.run(dashboard('config budget'))
  expect(asked[0]!.options.map(o => o.label)).toEqual(['Keep $5.00', '$2.50 (twice a typical session)', 'Off', 'Back to the menu'])
  expect(asked[1]!.question).toMatch(/^"lots" didn't work: Session budget takes a number \(0 for off\)\. Session budget:/)
  expect(asked[2]!.header).toBe('Budget 2/7')
  expect(sets).toEqual([['boomi-dashboard.budgetUsd', 7]])
  expect(answer.text).toBe('Saved to /config:\n  Session budget: $5.00 → $7.00')
})

test('/bc-dashboard config sets one setting by name, and lists them where it cannot ask', async ($, on) => {
  const { sets } = configWorld(on, { budgetUsd: 0, toasts: true }, [], ['toasts'])
  expect((await $.command.run(dashboard('config budgetUsd $4'))).text).toBe('Session budget: off → $4.00')
  expect(sets).toEqual([['boomi-dashboard.budgetUsd', 4]])
  expect((await $.command.run(dashboard('config budgetUsd lots'))).text).toBe('Session budget takes a number (0 for off). Session budget stays off.')
  expect((await $.command.run(dashboard('config toasts off'))).text).toBe("Toasts is set by your organization's settings, so it can't be changed here.")
  expect((await $.command.run(dashboard('config pollSeconds'))).text).toContain('Checking watched components: 1 minute.')
  expect((await $.command.run(dashboard('config wibble'))).text).toMatch(/^No setting or group called wibble\./)
  // The dialog dismissed at once, as in a -p run: every setting, and how to change one.
  const listed = (await $.command.run(dashboard('config'))).text
  expect(listed).toContain('Budget:\n  budgetUsd             off  (default)')
  expect(listed).toContain('/bc-dashboard config <setting> <value>')
  expect(sets).toHaveLength(1)
})

test('/bc-dashboard config closed before Done with nothing picked changes nothing', async ($, on) => {
  const { sets } = configWorld(on, { toasts: true }, ['Pane and banner', 'Keep day', undefined])
  expect((await $.command.run(dashboard('config'))).text).toBe('Nothing changed.')
  expect(sets).toEqual([])
})

test('/bc-dashboard config keeps what was picked when the menu closes before Done, and the pane takes the colors', async ($, on) => {
  const { sets } = configWorld(on, { toasts: true }, ['Pane and banner', 'Night', undefined])
  const saved = await $.command.run(dashboard('config'))
  expect(sets).toEqual([['boomi-dashboard.paneTheme', 'night']])
  expect(saved.text).toBe('Saved to /config:\n  Pane colors: day → night\nThe menu closed before Done; what you picked before it closed is saved.')
  expect((await $.command.run(dashboard('theme'))).text).toContain('◆ night')
})

// --- The pane's theme and size live in /config ----------------------------------------

/** /config's writer: records what the plugin set, or refuses it all (as a locked or unwritable /config does). */
const configWriter = (on: On, isRefusing = false) => {
  const sets: [string, unknown][] = []
  on('config.set', async (_$, e) => {
    if (isRefusing) return { deny: 'locked' }
    sets.push([e.key, e.value])
    return { value: e.value }
  })
  return sets
}

/** The store in memory, deletes included. */
const memoryStore = (on: On, store: Record<string, unknown>) => {
  on('store.get', async (_$, e) => ({ value: store[e.key] }))
  on('store.set', async (_$, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', async (_$, e) => {
    delete store[e.key]
    return { value: undefined }
  })
}

test("the pane's theme buttons and /bc-dashboard theme save the theme in /config", async ($, on) => {
  world(on)
  const store: Record<string, unknown> = {}
  memoryStore(on, store)
  const sets = configWriter(on)
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  await pane.press({ key: 'theme-night' })
  expect(sets).toEqual([['boomi-dashboard.paneTheme', 'night']])
  expect(propsOf(await pane.drawn()).backgroundColor).toBe('#161A2E')
  expect((await pane.find({ type: 'Button', key: 'theme-night' }))?.props.label).toBe('◆ Night')
  expect(store.theme).toBeUndefined()
  await $.command.run(dashboard('theme day'))
  expect(sets.at(-1)).toEqual(['boomi-dashboard.paneTheme', 'day'])
  expect(propsOf(await pane.drawn()).backgroundColor).toBe('#FBF6EE')
})

test('where /config refuses the theme, the dashboard keeps it in its own store', async ($, on) => {
  world(on)
  const store: Record<string, unknown> = {}
  memoryStore(on, store)
  configWriter(on, true)
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  await pane.press({ key: 'theme-night' })
  expect(store.theme).toBe('night')
  expect(propsOf(await pane.drawn()).backgroundColor).toBe('#161A2E')
})

test('/bc-dashboard size saves the size in /config, and with no numbers sets it back', async ($, on) => {
  world(on, {}, { isPlaced: true })
  const store: Record<string, unknown> = {}
  memoryStore(on, store)
  const sets = configWriter(on)
  expect((await $.command.run(dashboard('size 30 90'))).text).toContain('asks for 30 rows and 90 columns')
  expect(sets).toEqual([['boomi-dashboard.paneRows', 30], ['boomi-dashboard.paneColumns', 90]])
  expect(store.paneSize).toBeUndefined()
  await $.command.run(dashboard())
  expect(opens.at(-1)).toMatchObject({ rows: 30, columns: 90 })
  await $.command.run(dashboard('size'))
  expect(sets.slice(-2)).toEqual([['boomi-dashboard.paneRows', 0], ['boomi-dashboard.paneColumns', 0]])
  await $.command.run(dashboard())
  expect(opens.at(-1)?.rows).toBeUndefined()
})

test('a theme and size an earlier version kept move to /config as the session starts', async ($, on) => {
  world(on, {}, { isPlaced: true })
  const store: Record<string, unknown> = { theme: 'night', paneSize: { rows: 24, columns: 0 } }
  memoryStore(on, store)
  const sets = configWriter(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: undefined }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(sets).toEqual([['boomi-dashboard.paneTheme', 'night'], ['boomi-dashboard.paneRows', 24], ['boomi-dashboard.paneColumns', 0]])
  expect(store.theme).toBeUndefined()
  expect(store.paneSize).toBeUndefined()
  expect((await $.command.run(dashboard('theme'))).text).toContain('◆ night')
  await $.command.run(dashboard())
  expect(opens.at(-1)).toMatchObject({ rows: 24 })
})

// --- Why? for a failed BDI run ----------------------------------------------------------

/** A BDI run Claude started that then failed; bc-bdi's own scripts answer the dashboard's reads, which are recorded. */
const failedBdiRun = async ($: Engine, on: On, scripts: Record<string, { stdout: string; exitCode?: number }>) => {
  world(on)
  mock.store(on)
  const run = 'bash scripts/bdi-flow.sh run orders-flow'
  const check = 'bash scripts/bdi-flow.sh status orders-flow r-77'
  on('tool.call', { tool: 'Bash' }, async (_$, e) => ({
    result: {
      stdout: String(e.command) === run ? '{"run_id":"r-77"}' : '{"run_id":"r-77","status":"failed","error_description":"Target table orders_stg does not exist"}',
      stderr: '',
      interrupted: false,
    },
  }))
  const ran: string[][] = []
  const BDI = '/root/.claude/plugins/cache/boomi-companion/bc-bdi/0.2.5/skills/boomi-bdi/scripts'
  on('process.run', async (_$, e) => {
    ran.push([...e.argv])
    const command = e.argv.join(' ')
    const answer = /ls -d/.test(command) ? { stdout: `${BDI}\n` } : (scripts[e.argv.slice(2).join(' ')] ?? { stdout: '', exitCode: 1 })
    return { value: { exitCode: answer.exitCode ?? 0, stdout: answer.stdout, stderr: answer.exitCode ? answer.stdout : '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.tool.call({ tool: 'Bash', command: run })
  await $.tool.call({ tool: 'Bash', command: check })
  return { ran, BDI }
}

const BDI_LOG = ['timestamp,level,msg', '2026-10-12T11:58:07,ERROR,"Loading orders_stg: relation ""orders_stg"" does not exist"', '2026-10-12T11:58:01,INFO,Extracted 1200 rows'].join('\n')

test("/bc-dashboard why reads a failed BDI run's log with bc-bdi's own script", async ($, on) => {
  const { ran, BDI } = await failedBdiRun($, on, {
    'logs orders-flow r-77': { stdout: BDI_LOG },
    'steps orders-flow r-77': { stdout: '{"detail":"Only logic flows have logic steps"}', exitCode: 1 },
  })
  const listed = (await $.command.run(dashboard('text'))).text ?? ''
  expect(listed).toContain('Target table orders_stg does not exist. Run r-77…: press Why? to read its log.')
  const why = (await $.command.run(dashboard('why'))).text
  expect(why).toBe(
    [
      'BDI: flow orders-flow run failed (BDI run r-77):',
      '  Failure: Target table orders_stg does not exist',
      '  11:58:07 ERROR Loading orders_stg: relation "orders_stg" does not exist',
    ].join('\n'),
  )
  // Read-only: the logs and the steps, nothing that changes the flow.
  expect(ran.filter(argv => argv[1]?.endsWith('bdi-flow.sh'))).toEqual([
    ['bash', `${BDI}/bdi-flow.sh`, 'logs', 'orders-flow', 'r-77'],
    ['bash', `${BDI}/bdi-flow.sh`, 'steps', 'orders-flow', 'r-77'],
  ])
})

test("the pane's Why? on a failed logic flow names the step that failed, and Ask Claude to fix drafts the request", async ($, on) => {
  let filled = ''
  on('prompt.fill', async (_$, e) => {
    filled = e.text
    return { isFilled: true }
  })
  await failedBdiRun($, on, {
    'logs orders-flow r-77': { stdout: BDI_LOG },
    'steps orders-flow r-77': { stdout: JSON.stringify({ items: [{ step_name: 'load_orders', status: 'failed', error_message: 'table not found' }] }) },
  })
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  await pane.press({ key: 'why-0' })
  expect(await pane.find({ text: /BDI says \(1 errors, 0 warnings in the log\):/ })).toBeDefined()
  expect(await pane.find({ text: /Step "load_orders" failed: table not found/ })).toBeDefined()
  await pane.press({ key: 'fix-0' })
  expect(filled).toContain('BDI: flow orders-flow run failed (flow orders-flow, run r-77). BDI says:')
  expect(filled).toContain("Don't change the flow until I approve it.")
})

test("Why? on a BDI run says plainly when bc-bdi's script can't read the log", async ($, on) => {
  await failedBdiRun($, on, { 'logs orders-flow r-77': { stdout: 'ERROR: BDI_API_KEY is not set', exitCode: 1 } })
  expect((await $.command.run(dashboard('why'))).text).toBe("Couldn't read the log of BDI run r-77: ERROR: BDI_API_KEY is not set")
})

test('/bc-dashboard components copies every component with its IDs, for a spreadsheet or as CSV, and can save a CSV', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  mock.store(on)
  shell(on, `SUCCESS: Pushed component 'Orders Sync' — now version 4`)
  const copies: string[] = []
  on('ui.copy', async (_$, e) => {
    copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  const written: Record<string, string> = {}
  on('fs.write', async (_$, e) => {
    written[e.path] = e.text
    return { value: undefined } as never
  })
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
  const tsv = (await $.command.run(dashboard('components'))).text ?? ''
  expect(tsv).toMatch(/^Copied 1 component for a spreadsheet: paste into the first cell\. Columns: Component, Type, Folder, Component ID,/)
  expect(tsv).toContain(`  Orders Sync  ${ID}`)
  expect(copies[0]!.split('\n')[1]!.split('\t').slice(0, 5)).toEqual(['Orders Sync', 'process', '', ID, '4'])
  const csv = (await $.command.run(dashboard('components csv save'))).text ?? ''
  expect(csv).toContain('Copied 1 component as CSV.')
  const path = Object.keys(written).find(p => p.endsWith('.csv'))!
  expect(csv).toContain(`Saved them as ${path}.`)
  expect(written[path]!.startsWith('﻿Component,Type,Folder,Component ID')).toBe(true)
  expect(copies[1]).toContain('\r\nOrders Sync,process,,')
})

// --- Budget enforcement -------------------------------------------------------------

/** A session whose $1.25 is past a $1 session budget; Bash records what really ran. */
const spentWorld = (on: On, answers: (string | undefined)[] = [], files: Record<string, string> = {}) => {
  const toasts = world(on, { [FILE]: ORDERS, ...files })
  mock.store(on)
  const ran: string[] = []
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    ran.push(String(e.command))
    return { result: { stdout: "SUCCESS: Deployed 'Orders Sync' (package: p-1)", stderr: '', interrupted: false } }
  })
  const asked: Question[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const q = e.questions[0] as unknown as Question
    asked.push(q)
    const picked = answers.shift()
    return picked === undefined ? { deny: 'dismissed' } : { result: { questions: [q], answers: { [q.question]: picked } } as never }
  })
  return { ran, asked, toasts }
}

const DEPLOY = `bash scripts/boomi-deploy.sh ${FILE}`
const API = 'https://api.boomi.com/api/rest/v1/acct-1'

test('warn, the default: a spent budget stops nothing', { options: { budgetUsd: 1 } }, async ($, on) => {
  const { ran, asked } = spentWorld(on)
  const done = await $.tool.call({ tool: 'Bash', command: DEPLOY })
  expect(done.deny).toBeUndefined()
  expect(ran).toEqual([DEPLOY])
  expect(asked).toEqual([])
  expect((await $.command.run(dashboard('text'))).text).toContain('Deployed Orders Sync')
})

test('block: a Companion change is refused with what is spent, recorded as blocked by budget; reads still run', { options: { budgetUsd: 1, budgetEnforce: 'block' } }, async ($, on) => {
  const { ran, asked, toasts } = spentWorld(on)
  const refused = await $.tool.call({ tool: 'Bash', command: DEPLOY })
  expect(refused.deny).toMatch(/^boomi-dashboard: refused: Boomi Companion's budget is spent: the session budget \(\$1\.25 of \$1\.00, 125%\)\./)
  expect(refused.deny).toContain('Do not work around this')
  expect(ran).toEqual([])
  expect(asked).toEqual([])
  const text = (await $.command.run(dashboard('text'))).text ?? ''
  expect(text).toContain('Blocked by budget: deploy of Orders Sync')
  expect(text).toContain('blocked by budget: the session budget ($1.25 of $1.00, 125%)')
  // The banner says changes are paused, and one toast said so as it started.
  const band = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ text: /⛔ budget reached, Companion changes paused/ })).toBeDefined()
  expect(toasts.filter(t => t.startsWith('⛔ Budget reached'))).toHaveLength(1)
  // Reads, and the Platform API's queries, run.
  for (const read of [`bash scripts/boomi-execution-query.sh --execution-id e-1 --logs`, `curl -s -X POST ${API}/ComponentMetadata/query -d @q.json`, 'ls active-development']) {
    expect((await $.tool.call({ tool: 'Bash', command: read })).deny).toBeUndefined()
  }
  expect(ran).toHaveLength(3)
  // A change straight to the Platform API is refused too.
  const direct = await $.tool.call({ tool: 'Bash', command: `curl -s -X POST ${API}/ExecutionRequest -d @run.json` })
  expect(direct.deny).toContain('Not run: POST /api/rest/v1/acct-1/ExecutionRequest.')
  expect(ran).toHaveLength(3)
})

test('block: a local script that wraps a Companion change is read and refused', { options: { budgetUsd: 1, budgetEnforce: 'block' } }, async ($, on) => {
  const { ran } = spentWorld(on, [], { 'run-all.sh': `#!/bin/bash\n${DEPLOY}\n` })
  const refused = await $.tool.call({ tool: 'Bash', command: 'bash run-all.sh' })
  expect(refused.deny).toContain(`Not run: deploy (${FILE}), inside run-all.sh.`)
  expect(ran).toEqual([])
})

test('the grace: a budget 25% over with a 30% grace stops nothing yet', { options: { budgetUsd: 1, budgetEnforce: 'block', budgetGrace: 30 } }, async ($, on) => {
  const { ran } = spentWorld(on)
  expect((await $.tool.call({ tool: 'Bash', command: DEPLOY })).deny).toBeUndefined()
  expect(ran).toEqual([DEPLOY])
  expect((await $.command.run(dashboard('text'))).text).toContain('Deployed Orders Sync')
})

test('confirm: asks before each change; allowing one runs it and keeps an override for the reports', { options: { budgetUsd: 1, budgetEnforce: 'confirm' } }, async ($, on) => {
  const { ran, asked } = spentWorld(on, ['Allow this one', 'Stop', undefined])
  expect((await $.tool.call({ tool: 'Bash', command: DEPLOY })).deny).toBeUndefined()
  expect(asked[0]!.question).toBe(`Boomi Companion's budget is spent: the session budget ($1.25 of $1.00, 125%). Claude wants to deploy (${FILE}). Let it?`)
  expect(asked[0]!.options.map(o => o.label)).toEqual(['Allow this one', 'Allow for the rest of this session', 'Raise the budget', 'Stop'])
  expect(ran).toEqual([DEPLOY])
  // Stop, and a dismissed question, refuse.
  expect((await $.tool.call({ tool: 'Bash', command: DEPLOY })).deny).toMatch(/^boomi-dashboard: the user chose to stop this:/)
  expect((await $.tool.call({ tool: 'Bash', command: DEPLOY })).deny).toMatch(/^boomi-dashboard: refused:/)
  expect(ran).toEqual([DEPLOY])
  // The override is in the Markdown report.
  const report = (await $.command.run(dashboard('report'))).text ?? ''
  expect(report).toContain('## Budget overrides')
  expect(report).toMatch(/UTC: allowed once: deploy \(active-development\/processes\/Orders\.xml\), with the session budget \(\$1\.25 of \$1\.00, 125%\) spent/)
})

test('confirm: allowing the rest of the session stops asking, and the banner no longer says paused', { options: { budgetUsd: 1, budgetEnforce: 'confirm' } }, async ($, on) => {
  const { ran, asked } = spentWorld(on, ['Allow for the rest of this session'])
  await $.tool.call({ tool: 'Bash', command: DEPLOY })
  await $.tool.call({ tool: 'Bash', command: DEPLOY })
  expect(asked).toHaveLength(1)
  expect(ran).toEqual([DEPLOY, DEPLOY])
  const band = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ text: /Companion changes paused/ })).toBeUndefined()
})

test("Claude hears of a spent budget with the person's prompt, once, and again when it changes", { options: { budgetUsd: 1, budgetEnforce: 'block' } }, async ($, on) => {
  world(on)
  mock.store(on)
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', async (_$, e) => {
    contexts.push(e.context)
    return { text: e.text }
  })
  await $.prompt.submit({ text: 'deploy it', wait: false, origin: { kind: 'composer' } } as never)
  await $.prompt.submit({ text: 'and test it', wait: false, origin: { kind: 'composer' } } as never)
  expect(contexts[0]?.join('\n')).toContain("boomi-dashboard: Boomi Companion's budget is spent (the session budget ($1.25 of $1.00, 125%)). Companion changes")
  expect(contexts[1] ?? []).toEqual([])
  expect((await $.command.run(dashboard('text'))).text).toBeDefined()
})

// --- Prompt tips ---

const PUSH = `bash scripts/boomi-component-push.sh ${FILE}`
const TEST_RUN = `bash scripts/boomi-test-execute.sh --process-id ${ID}`
const ENV_ID = '9f8e7d6c-1111-2222-3333-444455556666'
const VAGUE = 'deploy it and test it, still failing'

/**
 * A Companion folder where Claude saved Orders Sync and its test failed.
 * `answer` picks in the question dialog (undefined dismisses it); records the
 * questions, what went into the prompt box and what reached the model.
 */
const promptWorld = async (
  $: Engine,
  on: On,
  answer: (q: Question) => string | undefined = () => undefined,
  files: Record<string, string> = { 'active-development': '' },
  options: WorldOptions = {},
) => {
  const all: Record<string, string> = { [FILE]: ORDERS, '.env': `BOOMI_ENVIRONMENT_ID=${ENV_ID}\nBOOMI_API_TOKEN=secret-token-value\n`, ...files }
  world(on, all, options)
  // A folder's entries, from the files under it.
  on('fs.list', async (_$, e) => {
    const dir = String(e.path).replace(/^\/work\/?/, '').replace(/\/$/, '')
    const entries = new Map<string, 'file' | 'dir'>()
    for (const f of Object.keys(all)) {
      if (!f.startsWith(`${dir}/`)) continue
      const [head, ...rest] = f.slice(dir.length + 1).split('/')
      entries.set(head!, rest.length > 0 ? 'dir' : 'file')
    }
    return { value: [...entries].map(([name, kind]) => ({ name, kind })) } as never
  })
  scriptedShell(on, { [PUSH]: "SUCCESS: Pushed component 'Orders Sync' — now version 4", [TEST_RUN]: 'Execution completed: status=ERROR, executionId=execution-aaaa1111' })
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const q = e.questions[0] as unknown as Question
    asked.push(q.question)
    const picked = answer(q)
    return picked === undefined ? { deny: 'dismissed' } : { result: { questions: [q], answers: { [q.question]: picked } } as never }
  })
  const filled: string[] = []
  on('prompt.fill', async (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  // The panes the plugin opened and hasn't closed, as the engine lists them.
  const closed: string[] = []
  on('ui.panes', async () => ({
    value: [...new Set(opens.map(o => String(o.id)))].filter(id => !closed.includes(id)).map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: false })),
  }) as never)
  on('ui.close', async (_$, e) => {
    closed.push(String(e.id))
    return { value: undefined } as never
  })
  const store: Record<string, unknown> = {}
  await startSession($, on, store)
  await $.tool.call({ tool: 'Bash', command: PUSH })
  await $.tool.call({ tool: 'Bash', command: TEST_RUN })
  // The steps refresh the status line and save in the background: let them finish before the test does.
  await $.command.run(dashboard('text'))
  const typed = (text: string, extra: Record<string, unknown> = {}) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...extra } as never)
  return { asked, closed, filled, sent, store, typed }
}

test('suggest: a vague Boomi prompt goes through as typed, and /bc-dashboard prompt shows its tips and the upgrade', { options: { promptCheck: 'suggest' } }, async ($, on) => {
  const { asked, sent, typed } = await promptWorld($, on)
  await typed(VAGUE)
  expect(sent).toEqual([VAGUE])
  expect(asked).toEqual([])
  const text = (await $.command.run(dashboard('prompt'))).text ?? ''
  expect(text).toContain('Prompt tips (promptCheck: suggest)')
  expect(text).toContain('◐ "it": the process Orders Sync, the last one this session?')
  expect(text).toContain('◐ deploy: no environment named; the session points at 9f8e7d6c…')
  expect(text).toContain('◐ fix: no error given; the last failure was the test of Orders Sync (execution-aaaa1111)')
  expect(text).toContain(`By "it" I mean the process Orders Sync (${ID}). Deploy to environment ${ENV_ID}.`)
  expect(text).toContain('This session: 1 prompt checked · 1 with tips · 0 tips followed')
  expect(text).not.toContain('secret-token-value')
  // The next prompt says what was missing: those tips count as followed, and the report says so.
  await typed('Deploy Orders Sync to dev, then test it with tests/orders.json')
  expect((await $.command.run(dashboard('prompt'))).text).toContain('Your last Boomi prompt had nothing to add.')
  expect((await $.command.run(dashboard('report'))).text).toContain('## Prompt tips\n\n- 2 prompts checked · 1 with tips · 4 tips followed')
})

test('short replies, prompts typed mid-turn, other sessions’ messages and “>” go straight through', async ($, on) => {
  const { asked, sent, typed } = await promptWorld($, on)
  await typed('yes')
  await typed('deploy it', { turnId: 't1' })
  await typed('deploy it', { origin: { kind: 'peer' } })
  await typed('> deploy it')
  expect(sent).toEqual(['yes', 'deploy it', 'deploy it', 'deploy it'])
  expect(asked).toEqual([])
  expect((await $.command.run(dashboard('prompt'))).text).toContain('No Boomi prompt checked yet this session.')
})

test('outside a Companion folder, prompts are not checked', async ($, on) => {
  const { sent, typed } = await promptWorld($, on, () => undefined, {})
  await typed(VAGUE)
  await typed('> a quoted line')
  expect(sent).toEqual([VAGUE, '> a quoted line'])
  expect((await $.command.run(dashboard('prompt'))).text).toContain('No Boomi prompt checked yet')
})

test('a secret in a prompt asks even in suggest mode; no answer sends it masked', async ($, on) => {
  let pick: string | undefined = 'Send it with the secret masked'
  const { asked, sent, typed } = await promptWorld($, on, () => pick)
  await typed('connect Orders Sync with password=hunter22')
  expect(asked[0]).toBe("Your prompt has a password or token in it. Once it's sent, it stays in the transcript. Send it with the secret masked?")
  pick = undefined
  await typed('and the token: abcd1234efgh')
  pick = 'Send it as typed'
  await typed('use password=hunter22 after all')
  expect(sent).toEqual(['connect Orders Sync with password=****', 'and the token: ****', 'use password=hunter22 after all'])
})

test('a secret: Edit it first holds the prompt and puts it back in the prompt box', async ($, on) => {
  const { filled, sent, typed } = await promptWorld($, on, () => 'Edit it first')
  const result = await typed('connect with password=hunter22')
  expect(result).toEqual({ drop: 'Held by the dashboard: your prompt is back in the prompt box to edit.' })
  expect(filled).toEqual(['connect with password=hunter22'])
  expect(sent).toEqual([])
})

test('confirm: a flagged prompt asks first; Use the upgrade holds it and puts the upgrade in the prompt box', { options: { promptCheck: 'confirm' } }, async ($, on) => {
  const { asked, filled, sent, typed } = await promptWorld($, on, () => 'Use the upgrade')
  const result = await typed(VAGUE)
  expect(asked[0]).toContain('This prompt leaves out: "it": the process Orders Sync, the last one this session?; deploy: no environment named')
  expect(result).toEqual({ drop: 'Held by the dashboard: the upgraded prompt is in the prompt box. Fill in any [placeholder], then press Enter.' })
  expect(filled[0]).toContain('By "it" I mean the process Orders Sync')
  expect(sent).toEqual([])
  // A prompt that says it all asks nothing.
  await typed('Deploy Orders Sync to dev')
  expect(asked).toHaveLength(1)
  expect(sent).toEqual(['Deploy Orders Sync to dev'])
})

test('off: nothing is checked, asked or changed', { options: { promptCheck: 'off' } }, async ($, on) => {
  const { asked, sent, typed } = await promptWorld($, on, () => 'Send it with the secret masked')
  await typed(VAGUE)
  await typed('> password=hunter22')
  expect(sent).toEqual([VAGUE, '> password=hunter22'])
  expect(asked).toEqual([])
  expect((await $.command.run(dashboard('prompt'))).text).toContain('Prompts are not checked.')
})

test('/bc-dashboard prompt use fills the prompt box; prompt upgrade has the model rewrite the masked prompt', async ($, on) => {
  const asks: { model: string; prompt: string }[] = []
  let isAnswered = true
  const usage = (input: number, output: number) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  on('model.complete', async (_$, e) => {
    asks.push({ model: e.model, prompt: String(e.prompt) })
    return {
      value: isAnswered
        ? { isAnswered: true, text: 'Deploy Orders Sync to [environment], then test it with [test data].', usage: usage(100, 30) }
        : { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: usage(0, 0) },
    } as never
  })
  const { filled, typed } = await promptWorld($, on)
  expect((await $.command.run(dashboard('prompt use'))).text).toBe('No upgraded prompt yet: no Boomi prompt this session has had tips.')
  await typed(VAGUE)
  expect((await $.command.run(dashboard('prompt use'))).text).toBe('The upgraded prompt is in the prompt box: fill in any [placeholder], then press Enter.')
  expect(filled[0]).toContain('Deploy to environment')
  const rewritten = (await $.command.run(dashboard('prompt upgrade'))).text ?? ''
  expect(rewritten).toContain('Rewritten by haiku (130 tokens).')
  expect(filled[1]).toBe('Deploy Orders Sync to [environment], then test it with [test data].')
  expect(asks[0]!.model).toBe('haiku')
  expect(asks[0]!.prompt).toContain(`<prompt>\n${VAGUE}\n</prompt>`)
  expect(asks[0]!.prompt).not.toContain('secret-token-value')
  isAnswered = false
  expect((await $.command.run(dashboard('prompt upgrade'))).text).toBe("haiku couldn't rewrite it (api-error). Your prompt is safe, and the upgrade from the checks is still there: /bc-dashboard prompt use.")
})

// --- The Prompt tab ---

const PROMPT_TAB = { component: 'Pane', requestId: 'boomi-dashboard-prompt', props: {} as RenderPropsOf['Pane'] } as const
const tabOpens = () => opens.filter(o => o.id === 'boomi-dashboard-prompt').map(o => o.title)

test('auto: a prompt with tips opens the Prompt tab; it shows the tips, its buttons, and the prompt beside the upgrade', { options: { promptCheck: 'suggest' } }, async ($, on) => {
  const { closed, filled, typed } = await promptWorld($, on)
  await typed(VAGUE)
  expect(tabOpens()).toEqual(['Boomi Dashboard Prompt tips · 4'])
  const tab = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PROMPT_TAB })
  expect(await tab.find({ text: /BOOMI DASHBOARD PROMPT TIPS/ })).toBeDefined()
  expect(await tab.find({ text: /"it": the process Orders Sync, the last one this session\?/ })).toBeDefined()
  expect(await tab.find({ text: /YOUR PROMPT/ })).toBeDefined()
  expect(await tab.find({ text: /By "it" I mean the process Orders Sync/ })).toBeDefined()
  await tab.press({ key: 'prompt-use' })
  expect(filled[0]).toContain('By "it" I mean the process Orders Sync')
  expect(await tab.find({ text: /In the prompt box: fill in any \[placeholder\], then press Enter\./ })).toBeDefined()
  await tab.press({ key: 'prompt-dismiss' })
  // The dashboard pane made way for the tab, and is back once it's dismissed.
  expect(closed).toEqual(['boomi-dashboard', 'boomi-dashboard-prompt'])
  expect(opens[opens.length - 1]!.id).toBe('boomi-dashboard')
  await tab.unmount()
  // Wide, the two cards sit side by side; narrow, one above the other. Both draw.
  for (const columns of [40, 140]) {
    const sized = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PROMPT_TAB, viewport: { columns, rows: 40 } } as never)
    expect(await sized.find({ text: /UPGRADED/ })).toBeDefined()
    await sized.unmount()
  }
})

test('a prompt with nothing to add closes the Prompt tab', async ($, on) => {
  const { closed, typed } = await promptWorld($, on)
  await typed(VAGUE)
  await typed('Deploy Orders Sync to dev')
  expect(closed).toEqual(['boomi-dashboard', 'boomi-dashboard-prompt'])
})

test('manual: the Prompt tab opens only when asked, from /bc-dashboard prompt or the pane’s button', { options: { promptView: 'manual', promptCheck: 'suggest' } }, async ($, on) => {
  const { typed } = await promptWorld($, on)
  await typed(VAGUE)
  expect(tabOpens()).toEqual([])
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /4 prompt tips for your last prompt/ })).toBeDefined()
  await pane.press({ key: 'prompt-open' })
  expect(tabOpens()).toEqual(['Boomi Dashboard Prompt tips · 4'])
  expect((await $.command.run(dashboard('prompt'))).text).toContain('Prompt tips (promptCheck: suggest)')
  expect(tabOpens()).toEqual(['Boomi Dashboard Prompt tips · 4', 'Boomi Dashboard Prompt tips · 4'])
})

test('off: the Prompt tab never opens, and the pane offers none', { options: { promptView: 'off' } }, async ($, on) => {
  const { typed } = await promptWorld($, on)
  await typed(VAGUE)
  await $.command.run(dashboard('prompt'))
  expect(tabOpens()).toEqual([])
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /prompt tips for your last prompt/ })).toBeUndefined()
})

test('the Prompt tab’s Upgrade with a model rewrites the upgrade in place', async ($, on) => {
  on('model.complete', async () => ({
    value: { isAnswered: true, text: 'Deploy Orders Sync to [environment], then test it with [test data].', usage: { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  }) as never)
  const { typed } = await promptWorld($, on)
  await typed(VAGUE)
  const tab = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PROMPT_TAB })
  await tab.press({ key: 'prompt-rewrite' })
  expect(await tab.find({ text: /Rewritten by haiku \(130 tokens\)\./ })).toBeDefined()
  expect(await tab.find({ text: /UPGRADED BY HAIKU/ })).toBeDefined()
  expect(await tab.find({ text: /Deploy Orders Sync to \[environment\], then test it with \[test data\]\./ })).toBeDefined()
})

// --- After /clear ---

test('after /clear the dashboard sets the new session up again: it sees the folder anew, checks prompts, and keeps what was saved', async ($, on) => {
  let id = 'session-before-clear'
  const { sent, store, typed } = await promptWorld($, on, () => undefined, {}, { sessionId: () => id })
  const saved = () => ((Object.entries(store).find(([k]) => k.startsWith('activity:'))?.[1] ?? {}) as { activity?: unknown[] }).activity ?? []
  expect(saved()).toHaveLength(2)
  // The session started outside a Companion folder; its steps since make it one, which only a new setup looks at.
  await typed('deploy it')
  expect((await $.command.run(dashboard('prompt'))).text).toContain('No Boomi prompt checked yet')
  // /clear: the process goes on under a new ID, with no session.start. The dashboard sets the new session up.
  id = 'session-after-clear'
  await typed(VAGUE)
  expect(sent).toEqual(['deploy it', VAGUE])
  expect((await $.command.run(dashboard('prompt'))).text).toContain('"it": the process Orders Sync, the last one this session?')
  await $.tool.call({ tool: 'Bash', command: PUSH })
  await $.command.run(dashboard('text'))
  expect(saved().length).toBeGreaterThanOrEqual(3)
})

// --- Holding a prompt, the nudge, and regenerating ---

const BAND_TARGET = { component: 'AbovePrompt', props: BAND } as const

test('confirm: with the Prompt tab shown, a flagged prompt is held until it is sent from there', { options: { promptCheck: 'confirm' } }, async ($, on) => {
  const { asked, sent, typed } = await promptWorld($, on, () => undefined, { 'active-development': '' }, { isPlaced: true })
  const result = await typed(VAGUE)
  expect(result).toEqual({ drop: "Held by the Boomi Dashboard: Claude hasn't seen it yet. Send it, or the upgrade, from Boomi Dashboard Prompt tips." })
  expect(asked).toEqual([])
  expect(sent).toEqual([])
  const tab = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PROMPT_TAB })
  expect(await tab.find({ text: /⏸ Held: Claude hasn't seen this prompt yet/ })).toBeDefined()
  await tab.press({ key: 'prompt-send-upgrade' })
  expect(sent).toHaveLength(1)
  expect(sent[0]).toContain('By "it" I mean the process Orders Sync')
  // The upgrade it sent isn't checked again, and nothing is held any more.
  expect((await $.command.run(dashboard('prompt'))).text).toContain('Your last prompt: deploy it and test it, still failing')
})

test('confirm: a held prompt can go back to the prompt box, or be discarded; the banner can send it as typed', { options: { promptCheck: 'confirm' } }, async ($, on) => {
  const { filled, sent, typed } = await promptWorld($, on, () => undefined, { 'active-development': '' }, { isPlaced: true })
  await typed(VAGUE)
  const tab = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PROMPT_TAB })
  await tab.press({ key: 'prompt-edit' })
  expect(filled).toEqual([VAGUE])
  expect(await tab.find({ text: /Your prompt is back in the prompt box to edit\. Nothing was sent\./ })).toBeDefined()
  await typed('deploy it')
  await tab.press({ key: 'prompt-discard' })
  expect(sent).toEqual([])
  await tab.unmount()
  await typed(VAGUE)
  const band = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...BAND_TARGET })
  expect(await band.find({ text: /Boomi Dashboard suggests a clearer prompt/ })).toBeDefined()
  await band.press({ key: 'nudge-send-typed' })
  expect(sent).toEqual([VAGUE])
})

test('suggest: the banner nudges with the suggestion, Use it fills the prompt box, and ✕ puts the nudge away', { options: { promptCheck: 'suggest' } }, async ($, on) => {
  const { filled, typed } = await promptWorld($, on)
  await typed(VAGUE)
  const band = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...BAND_TARGET })
  expect(await band.find({ text: /Boomi Dashboard suggests a clearer prompt/ })).toBeDefined()
  await band.press({ key: 'nudge-use' })
  expect(filled[0]).toContain('By "it" I mean the process Orders Sync')
  expect(await band.find({ text: /suggests a clearer prompt/ })).toBeUndefined()
  await clock.advance(1_000)
  await typed('deploy it')
  expect(await band.find({ text: /suggests a clearer prompt/ })).toBeDefined()
  await band.press({ key: 'nudge-hide' })
  expect(await band.find({ text: /suggests a clearer prompt/ })).toBeUndefined()
})

test('the Prompt tab takes the dashboard pane’s place, and leaving it brings the dashboard back', { options: { promptCheck: 'suggest' } }, async ($, on) => {
  const { closed, typed } = await promptWorld($, on)
  await $.command.run(dashboard(''))
  await typed(VAGUE)
  expect(closed).toEqual(['boomi-dashboard'])
  expect(tabOpens()).toEqual(['Boomi Dashboard Prompt tips · 4'])
  const tab = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PROMPT_TAB })
  await tab.press({ key: 'prompt-back' })
  expect(closed).toEqual(['boomi-dashboard', 'boomi-dashboard-prompt'])
  expect(opens[opens.length - 1]!.id).toBe('boomi-dashboard')
})

test('Regenerate reads the folder’s components and the person’s note, and every try is kept', async ($, on) => {
  const asks: string[] = []
  on('model.complete', async (_$, e) => {
    asks.push(String(e.prompt))
    return { value: { isAnswered: true, text: `Try ${asks.length}: build the QTC process.`, usage: { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  const SF = '<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="c-1" name="Salesforce Connection" type="connector-settings" folderFullPath="QTC/Connections"></bns:Component>'
  const { typed } = await promptWorld($, on, () => undefined, { 'active-development': '', 'active-development/connections/Salesforce.xml': SF })
  await typed('lets make a shell integration for QTC from salesforce to netsuite. build generic connections')
  const tab = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PROMPT_TAB })
  await tab.press({ key: 'prompt-rewrite' })
  expect(asks[0]).toContain('- Salesforce Connection (connector-settings), in QTC/Connections')
  expect(await tab.find({ text: /reading 1 of this folder's components/ })).toBeDefined()
  await tab.input({ key: 'prompt-note', text: 'split it into steps' })
  expect(asks[1]).toContain("The person's note for this try:\nsplit it into steps")
  expect(asks[1]).toContain('The try before (write a different one):\nTry 1: build the QTC process.')
  expect(await tab.find({ text: /try 3 of 3/ })).toBeDefined()
  await tab.press({ key: 'prompt-try-back' })
  expect(await tab.find({ text: /try 2 of 3/ })).toBeDefined()
  expect(await tab.find({ text: /Try 1: build the QTC process\./ })).toBeDefined()
})

test('by default a flagged prompt is held: confirm is the default', async ($, on) => {
  const { sent, typed } = await promptWorld($, on, () => undefined, { 'active-development': '' }, { isPlaced: true })
  expect(await typed(VAGUE)).toEqual({ drop: "Held by the Boomi Dashboard: Claude hasn't seen it yet. Send it, or the upgrade, from Boomi Dashboard Prompt tips." })
  expect(sent).toEqual([])
  expect((await $.command.run(dashboard('prompt'))).text).toContain('Prompt tips (promptCheck: confirm)')
})

test('a long note is drawn once, in its field, and each try shows the note it followed', { options: { promptCheck: 'suggest' } }, async ($, on) => {
  on('model.complete', async () => ({
    value: { isAnswered: true, text: 'Build the Salesforce to NetSuite orders sync.', usage: { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  }) as never)
  const { typed } = await promptWorld($, on)
  await typed('build a process that syncs orders')
  const tab = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PROMPT_TAB })
  const note = 'lets use salesforce as the source and netsuite as the target, on a schedule every hour, with JSON'
  await tab.input({ key: 'prompt-note', text: note, kind: 'change' })
  // The field wraps the note itself: no second copy of it is drawn.
  expect(await tab.findAll({ text: new RegExp(note) })).toHaveLength(0)
  await tab.input({ key: 'prompt-note', text: note })
  expect(await tab.find({ text: new RegExp(`This try's note: ${note}`) })).toBeDefined()
})

test('a long upgrade is fitted to the pane: the buttons stay in view, Show all draws it whole, and the pane can jump to the buttons', { options: { promptCheck: 'suggest' } }, async ($, on) => {
  const long = Array.from({ length: 40 }, (_, i) => `Step ${i + 1}: do one more careful thing with the Orders Sync process and show me.`).join(' ')
  on('model.complete', async () => ({
    value: { isAnswered: true, text: long, usage: { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  }) as never)
  const { typed } = await promptWorld($, on)
  await typed('build a process that syncs orders')
  const sized = { ...PROMPT_TAB, props: { scroll: { offset: 0, bodyRows: 32 }, bodyColumns: 80 } as unknown as RenderPropsOf['Pane'] }
  const tab = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...sized })
  await tab.press({ key: 'prompt-rewrite' })
  expect(await tab.find({ text: /▼ \d+ more lines/ })).toBeDefined()
  expect(await tab.find({ text: /Step 40:/ })).toBeUndefined()
  expect(await tab.find({ text: /Use the upgrade/ })).toBeDefined()
  await tab.press({ key: 'prompt-expand' })
  expect(await tab.find({ text: /▼ \d+ more lines/ })).toBeUndefined()
  expect(await tab.find({ text: /Step 40:/ })).toBeDefined()
  expect(await tab.find({ text: /Shown in full: scroll with ↓ or the wheel/ })).toBeDefined()
  expect(await tab.press({ key: 'prompt-jump' })).toBeDefined()
  await tab.press({ key: 'prompt-collapse' })
  expect(await tab.find({ text: /▼ \d+ more lines/ })).toBeDefined()
})

// --- 0.46.0: folding past sessions, and the look-around nudge ---

test('Past Companion sessions start folded to their totals; Show and Hide toggle them, and the choice is kept', async ($, on) => {
  world(on)
  const store: Record<string, unknown> = {}
  const sessions = Array.from({ length: 3 }, (_, i) => ({
    id: `s${i}`,
    project: '/Users/me/ws',
    startedAt: `2026-10-1${i}T09:00:00Z`,
    costUsd: 1 + i,
    firstPrompt: `Request number ${i}`,
    models: {},
    commands: [`bash scripts/boomi-component-push.sh ${FILE}`],
  }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: JSON.stringify({ version: 1, scanned: 3, sessions }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await startSession($, on, store)
  await $.command.run(dashboard('history'))
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /3 sessions listed: Show lists them/ })).toBeDefined()
  expect(await pane.find({ text: /"Request number 0"/ })).toBeUndefined()
  expect((await pane.find({ type: 'Button', key: 'history-toggle' }))?.props.label).toBe('▸ Show')
  await pane.press({ key: 'history-toggle' })
  expect(await pane.find({ text: /"Request number 0"/ })).toBeDefined()
  expect((await pane.find({ type: 'Button', key: 'history-toggle' }))?.props.label).toBe('▾ Hide')
  expect(store.pastCollapsed).toBe(false)
  await pane.press({ key: 'history-toggle' })
  expect(await pane.find({ text: /"Request number 0"/ })).toBeUndefined()
  expect(store.pastCollapsed).toBe(true)
})

test('a look around the account gets a nudge, and confirm lets it through: reading changes nothing', async ($, on) => {
  const { sent, typed } = await promptWorld($, on, () => undefined, { 'active-development': '' }, { isPlaced: true })
  await typed('use boomi companion to check out my account.')
  expect(sent).toEqual(['use boomi companion to check out my account.'])
  const text = (await $.command.run(dashboard('prompt'))).text ?? ''
  expect(text).toContain("◐ look-around: say what you want to find out (deployed processes, failed runs, a folder's components, runtimes)")
  expect(text).toContain('- What to find out: [deployed processes and where')
})

// --- 0.47.0: Claude Code's usage breakdown ---

test('the pane reads Claude Code’s /usage breakdown after the start, with no session kept, and shows Companion’s share', async ($, on) => {
  world(on, { [FILE]: ORDERS, 'active-development': '' })
  const runs: string[][] = []
  const result = 'You are currently using your subscription\n\nLast 24h · 9 requests · 2 sessions\n  Top plugins: bc-integration 20%\n\nLast 7d · 90 requests · 8 sessions\n  Top plugins: bc-integration 18%'
  on('process.run', async (_$, e) => {
    runs.push([...e.argv])
    const isUsage = e.argv[1] === '-p' && e.argv[2] === '/usage'
    return { value: { exitCode: 0, stdout: isUsage ? JSON.stringify({ result }) : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await startSession($, on)
  await clock.advance(20_000)
  expect(runs).toContainEqual(['claude', '-p', '/usage', '--output-format', 'json', '--no-session-persistence', '--safe-mode'])
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /Companion: ≥20% of your usage today · ≥18% this week \(Claude Code's estimate, this machine\)/ })).toBeDefined()
})

test('the /usage run leaves out hooks and plugins, and falls back to the plain run on a Claude Code that refuses the flag', async ($, on) => {
  world(on, { [FILE]: ORDERS, 'active-development': '' })
  const runs: string[][] = []
  const result = 'You are currently using your subscription\n\nLast 24h · 9 requests · 2 sessions\n  Top plugins: bc-integration 20%'
  on('process.run', async (_$, e) => {
    runs.push([...e.argv])
    const isUsage = e.argv[2] === '/usage'
    const isRefused = e.argv.includes('--safe-mode')
    return { value: { exitCode: isUsage && isRefused ? 1 : 0, stdout: isUsage && !isRefused ? JSON.stringify({ result }) : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await startSession($, on)
  await clock.advance(20_000)
  const usageRuns = runs.filter(r => r[2] === '/usage')
  expect(usageRuns).toEqual([
    ['claude', '-p', '/usage', '--output-format', 'json', '--no-session-persistence', '--safe-mode'],
    ['claude', '-p', '/usage', '--output-format', 'json', '--no-session-persistence'],
  ])
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /Companion: ≥20% of your usage today/ })).toBeDefined()
})

test('a /usage reading another session took a few minutes ago is used, with no new run', async ($, on) => {
  world(on, { [FILE]: ORDERS, 'active-development': '' })
  const runs: string[][] = []
  on('process.run', async (_$, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const breakdown = { isSubscription: true, day: { companion: 33, plugins: [{ name: 'bc-integration', percent: 33 }], habits: [] } }
  await startSession($, on, { usageBreakdown: { breakdown, checkedAt: NOW + 20_000 - 5 * 60_000 } })
  await clock.advance(20_000)
  expect(runs.filter(r => r[2] === '/usage')).toEqual([])
  const pane = await $.ui.mount({ plugin: 'boomi-dashboard', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /Companion: ≥33% of your usage today/ })).toBeDefined()
})
