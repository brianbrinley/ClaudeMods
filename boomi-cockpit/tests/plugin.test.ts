import type { CommandRunInput, On, RenderElement, RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const cockpit = (args = '') => ({ command: 'cockpit', args }) as CommandRunInput

const ID = '1a2b3c4d-1111-2222-3333-444455556666'
const ORDERS = `<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="${ID}" name="Orders Sync" type="process"></bns:Component>`
const FILE = 'active-development/processes/Orders.xml'

/** The surface, files and session cost beneath the plugin; records the toasts. */
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
  mock.clock(on, { now: 1_760_000_000_000 })
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

test('a Companion push shows up in the summary with its version, and the command still runs', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  const ran = shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
  const command = `bash scripts/boomi-component-push.sh ${FILE}`
  const answer = await $.tool.call({ tool: 'Bash', command })
  expect(answer.deny).toBeUndefined()
  expect(ran).toEqual([command])

  const status = await $.command.run(cockpit())
  expect(status.text).toContain('Cockpit ✓ 1 built · $1.25')
  expect(status.text).toContain('Orders Sync v4')
})

test('a failed test execution is reported and toasted', async ($, on) => {
  const toasts = world(on)
  shell(on, 'Execution completed: status=ERROR, executionId=execution-9')
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
  const status = await $.command.run(cockpit())
  expect(status.text).toContain('✗ 1 test failed')
  expect(status.text).toContain('✗ Tests')
  expect(toasts.some(t => t.includes('test failed'))).toBe(true)
})

test('a deploy that exits with an error is a failed deploy', async ($, on) => {
  world(on, { [FILE]: ORDERS })
  shell(on, 'ERROR: Deployment failed (HTTP 400): no package', true)
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-deploy.sh ${FILE}` })
  const status = await $.command.run(cockpit())
  expect(status.text).toContain('✗ 1 deploy failed')
  expect(status.text).toContain('ERROR: Deployment failed (HTTP 400): no package')
})

test('commands that are not Companion scripts are left alone', async ($, on) => {
  world(on)
  const ran = shell(on, 'clean')
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(ran).toEqual(['git status'])
  const status = await $.command.run(cockpit())
  expect(status.text).toContain('no Companion activity yet')
})

test('without credentials the platform is off and says why', async ($, on) => {
  world(on)
  mock.env(on, {})
  const status = await $.command.run(cockpit('poll'))
  expect(status.text).toContain('no Platform API credentials')
})

test('watching a component polls its version, and a change by someone else is flagged', async ($, on) => {
  const toasts = world(on, { [FILE]: ORDERS })
  mock.store(on)
  mock.env(on, {
    BOOMI_API_URL: 'https://api.boomi.com',
    BOOMI_USERNAME: 'me@example.com',
    BOOMI_API_TOKEN: 'secret-token-value',
    BOOMI_ACCOUNT_ID: 'acct-1',
  })
  let version = '3'
  let modifiedBy = 'me@example.com'
  const urls: string[] = []
  on('http.fetch', async (_$, e) => {
    urls.push(e.url)
    const body = { result: [{ name: 'Orders Sync', version, modifiedBy, modifiedDate: '2026-10-12T10:00:00Z' }] }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })

  const watched = await $.command.run(cockpit(`watch ${FILE}`))
  expect(watched.text).toContain('Watching')
  expect(watched.text).toContain('Orders Sync v3')
  expect(urls.every(url => url.includes('/ComponentMetadata/query'))).toBe(true)

  version = '4'
  modifiedBy = 'pat@example.com'
  const status = await $.command.run(cockpit('poll'))
  expect(status.text).toContain('changed by pat@example.com')
  expect(status.text).toContain('◐ 1 watched changed')
  expect(status.text).not.toContain('secret-token-value')
  expect(toasts.some(t => t.includes('changed by pat@example.com'))).toBe(true)

  await $.command.run(cockpit('seen'))
  const after = await $.command.run(cockpit())
  expect(after.text).not.toContain('watched changed')
})

test("the environment's new failed runs are toasted after the first poll", async ($, on) => {
  const toasts = world(on)
  mock.env(on, {
    BOOMI_API_URL: 'https://api.boomi.com',
    BOOMI_USERNAME: 'me@example.com',
    BOOMI_API_TOKEN: 'secret-token-value',
    BOOMI_ACCOUNT_ID: 'acct-1',
    BOOMI_ENVIRONMENT_ID: 'env-1',
  })
  let runs = [{ executionId: 'e1', processName: 'Orders Sync', status: 'COMPLETE', executionTime: '2026-10-12T10:00:00Z' }]
  on('http.fetch', async (_$, e) => {
    const result = e.url.endsWith('EnvironmentAtomAttachment/query') ? [{ atomId: 'atom-1' }] : runs
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ result }) } }
  })

  await $.command.run(cockpit('poll'))
  runs = [{ executionId: 'e2', processName: 'Orders Sync', status: 'ERROR', executionTime: '2026-10-12T10:05:00Z' }, ...runs]
  const status = await $.command.run(cockpit('poll'))
  expect(status.text).toContain('⚠ 1 platform error')
  expect(status.text).toContain('ERROR Orders Sync')
  expect(toasts.some(t => t.includes('Orders Sync error'))).toBe(true)
})

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, columns: 100 } as unknown as RenderPropsOf['AbovePrompt']

for (const surface of ['terminal', 'desktop'] as const) {
  test(`on ${surface}, the banner appears after Companion activity and Hide puts it away`, async ($, on) => {
    world(on, { [FILE]: ORDERS })
    // The engine's own band beneath: nothing to show.
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Box } = $.ui.resolve(e)
      return h(Box, {}) as RenderElement
    })
    shell(on, 'Execution completed: status=ERROR, executionId=execution-9')
    const quiet = await $.ui.mount({ plugin: 'boomi-cockpit', surface, component: 'AbovePrompt', props: BAND })
    expect(await quiet.find({ text: /Cockpit/ })).toBeUndefined()

    await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
    const band = await $.ui.mount({ plugin: 'boomi-cockpit', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ text: /Cockpit/ })).toBeDefined()
    expect(await band.find({ text: /✗/ })).toBeDefined()
    await band.press({ key: 'hide' })
    expect(await band.find({ text: /Cockpit/ })).toBeUndefined()
  })

  test(`on ${surface}, the pane lists the activity with icons and labels`, async ($, on) => {
    world(on, { [FILE]: ORDERS })
    shell(on, "SUCCESS: Pushed component 'Orders Sync' — now version 4")
    await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-component-push.sh ${FILE}` })
    const pane = await $.ui.mount({
      plugin: 'boomi-cockpit',
      surface,
      component: 'Pane',
      requestId: 'boomi-cockpit',
      props: {} as RenderPropsOf['Pane'],
    })
    expect(await pane.find({ text: /✓ Builds/ })).toBeDefined()
    expect(await pane.find({ text: /Orders Sync v4/ })).toBeDefined()
    expect(await pane.find({ text: /\$1\.25 so far/ })).toBeDefined()
  })
}
