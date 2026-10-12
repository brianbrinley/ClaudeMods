import type { CommandRunInput, On, RenderElement, RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const cockpit = (args = '') => ({ command: 'cockpit', args }) as CommandRunInput

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

/** The surface, files, clock and session cost beneath the plugin; records the toasts. */
const world = (on: On, files: Record<string, string> = {}) => {
  const toasts: string[] = []
  const local = (path: string) => Object.keys(files).find(f => path === f || path.endsWith(`/${f}`)) ?? path
  on('fs.exists', async (_$, e) => ({ value: local(e.path) in files }))
  on('fs.read', async (_$, e) => {
    const text = files[local(e.path)]
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('ui.status', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: false as const, reason: 'no pane in tests' } }))
  on('session.cwd', async () => ({ value: '/work' }))
  mock.clock(on, { now: NOW })
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
const modelCall = async ($: Engine, on: On, tokens: number) => {
  on('turn.step', async function* () {
    return {
      turnId: 't1',
      index: 0,
      answer: '',
      toolUses: [],
      stopReason: 'tool_use',
      usage: { model: 'claude', input_tokens: tokens / 4, output_tokens: tokens / 4, cache_read_input_tokens: tokens / 2, cache_creation_input_tokens: 0 },
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

  const status = await $.command.run(cockpit())
  expect(status.text).toContain('Orders Sync (process): ✓ saved v4')
  expect(status.text).toContain('Saved Orders Sync to Boomi (v4), just now')
  expect(status.text).toContain('Session: $1.25 so far')
})

test('the running token count adds up every model call, and each step shows what it took', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
  await modelCall($, on, 8_000)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
  const status = await $.command.run(cockpit())
  expect(status.text).toContain('Saved Orders Sync to Boomi (v4), just now  [8.0k tokens · $1.25]')
  expect(status.text).toContain('Orders Sync (process): ✓ saved v4  [8.0k tokens · $1.25]')
  expect(status.text).toContain('Session: 8.0k tokens · $1.25 so far')
})

test('Claude editing a component XML shows it as edited, not in Boomi yet', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  writer(on)
  await $.tool.call({ tool: 'Write', file_path: `/work/${FILE}`, content: ORDERS })
  await $.tool.call({ tool: 'Write', file_path: `/work/${FILE}`, content: ORDERS })
  const status = await $.command.run(cockpit())
  expect(status.text).toContain('Orders Sync (process): ◐ edited, not in Boomi yet')
  // Two writes to one file are one step.
  expect((status.text ?? '').match(/Edited Orders Sync/g)?.length).toBe(1)
})

test('a failed test needs attention, with what to do, and is toasted', async ($, on) => {
  const toasts = world(on, { [FILE]: ORDERS })
  shell(on, 'Execution completed: status=ERROR, executionId=execution-0490202b-2e2f')
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
  const status = await $.command.run(cockpit())
  expect(status.text).toContain('Needs attention (1):')
  expect(status.text).toContain('✗ Test of')
  expect(status.text).toContain('Ask Claude to read the execution log (0490202b…)')
  expect(toasts.some(t => t.includes('ended ERROR'))).toBe(true)
})

test('a deploy that exits with an error needs attention with its error line', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  shell(on, 'ERROR: Deployment failed (HTTP 400): no package', true)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-deploy.sh ${FILE}` })
  const status = await $.command.run(cockpit())
  expect(status.text).toContain('Deploy of Orders Sync failed')
  expect(status.text).toContain('ERROR: Deployment failed (HTTP 400): no package')
})

test('commands that are not Companion scripts are left alone', async ($, on) => {
  world(on)
  const ran = shell(on, 'clean')
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(ran).toEqual(['git status'])
  const status = await $.command.run(cockpit())
  expect(status.text).toContain('Components this session: none yet')
})

test('without credentials the live environment is off and says why', async ($, on) => {
  world(on)
  mock.env(on, {})
  const status = await $.command.run(cockpit('poll'))
  expect(status.text).toContain('Off: no Boomi credentials')
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

  const watched = await $.command.run(cockpit(`watch ${FILE}`))
  expect(watched.text).toContain('Watching ✓ Orders Sync v3')
  expect(urls.every(url => url.includes('/ComponentMetadata/query'))).toBe(true)

  version = '4'
  modifiedBy = 'pat@example.com'
  const status = await $.command.run(cockpit('poll'))
  expect(status.text).toContain('Orders Sync was changed by pat@example.com')
  expect(status.text).toContain('Pull it before you push')
  expect(status.text).not.toContain('secret-token-value')
  expect(toasts.some(t => t.includes('changed by pat@example.com'))).toBe(true)

  await $.command.run(cockpit('seen'))
  const after = await $.command.run(cockpit())
  expect(after.text).toContain('✓ Nothing needs attention.')
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

  const first = await $.command.run(cockpit('poll'))
  expect(first.text).toContain('✓ Nothing needs attention.')
  expect(first.text).toContain('✓ Orders Sync completed, 2h ago')
  expect(first.text).not.toContain('JMX')

  runs = [{ executionId: 'e2', processName: 'Orders Sync', status: 'ERROR', executionTime: '2026-10-12T11:55:00Z' }, ...runs]
  const status = await $.command.run(cockpit('poll'))
  expect(status.text).toContain('Orders Sync ended ERROR in the environment')
  expect(toasts.some(t => t.includes('Orders Sync failed'))).toBe(true)
})

/** A drawn tree's root props. */
const propsOf = (tree: RenderElement) => ((tree as { props?: Record<string, unknown> }).props ?? {})

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, columns: 100 } as unknown as RenderPropsOf['AbovePrompt']
const PANE = { component: 'Pane', requestId: 'boomi-cockpit', props: {} as RenderPropsOf['Pane'] } as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`on ${surface}, the banner waits for activity, then shows the latest step and what needs attention`, async ($, on) => {
    world(on, { [FILE]: ORDERS })
    // The engine's own band beneath: nothing to show.
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Box } = $.ui.resolve(e)
      return h(Box, {}) as RenderElement
    })
    shell(on, 'Execution completed: status=ERROR, executionId=execution-9')
    const quiet = await $.ui.mount({ plugin: 'boomi-cockpit', surface, component: 'AbovePrompt', props: BAND })
    expect(await quiet.find({ text: /Boomi/ })).toBeUndefined()

    await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
    const band = await $.ui.mount({ plugin: 'boomi-cockpit', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ text: /ended ERROR/ })).toBeDefined()
    expect(await band.find({ text: /1 needs attention/ })).toBeDefined()
    await band.press({ key: 'hide' })
    expect(await band.find({ text: /Boomi/ })).toBeUndefined()
  })

  test(`on ${surface}, the pane draws in Valence Day with its title band, gauges and spend`, async ($, on) => {
    world(on, { [FILE]: ORDERS })
    shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
    await modelCall($, on, 12_000)
    await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
    const pane = await $.ui.mount({ plugin: 'boomi-cockpit', surface, ...PANE })
    expect(propsOf(await pane.drawn())).toMatchObject({ backgroundColor: '#FBF6EE' })
    const title = await pane.find({ type: 'Text', text: '◆ B O O M I   C O C K P I T ◆' })
    expect(title?.props).toMatchObject({ color: '#FBF6EE', backgroundColor: '#C2185B', bold: true })
    const names = await pane.findAll({ type: 'Text', text: 'Orders Sync' })
    expect(names.some(n => n.props.color === '#0B0B0B' && n.props.backgroundColor === '#FBF6EE')).toBe(true)
    expect(await pane.find({ text: 'TOKENS' })).toBeDefined()
    expect(await pane.find({ text: '12k' })).toBeDefined()
    expect(await pane.find({ text: '$1.25' })).toBeDefined()
    expect(await pane.find({ text: /▰▱+ 12%/ })).toBeDefined()
    expect(await pane.find({ text: /saved v4/ })).toBeDefined()
    expect(await pane.find({ text: /12k tokens · \$1\.25/ })).toBeDefined()
    expect(await pane.find({ text: 'NEEDS ATTENTION' })).toBeDefined()
  })

  test(`on ${surface}, the pane shows when Claude is in flight`, async ($, on) => {
    world(on)
    on('turn.start', async (_$, e) => ({ turnId: e.turnId }) as never)
    await $.turn.start({ text: 'build it', turnId: 't1' } as never)
    const pane = await $.ui.mount({ plugin: 'boomi-cockpit', surface, ...PANE })
    expect(await pane.find({ text: '● IN FLIGHT' })).toBeDefined()
  })

  test(`on ${surface}, the pane can follow the terminal's theme instead`, { options: { paneTheme: 'terminal' } }, async ($, on) => {
    world(on)
    const pane = await $.ui.mount({ plugin: 'boomi-cockpit', surface, ...PANE })
    expect(propsOf(await pane.drawn()).backgroundColor).toBeUndefined()
    const title = await pane.find({ type: 'Text', text: '◆ B O O M I   C O C K P I T ◆' })
    expect(title?.props.color).toBe('claude')
    expect(await pane.find({ text: '◇ STANDING BY' })).toBeDefined()
  })
}
