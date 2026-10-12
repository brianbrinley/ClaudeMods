import { expect, test } from 'claude-code/testing'

import {
  attention,
  compareWatched,
  componentOf,
  componentPath,
  components,
  describe,
  FLAMINGO_IDLE,
  FLAMINGO_WALK,
  flamingo,
  flamingoView,
  mirror,
  pace,
  cachedTokens,
  formatTokens,
  newTokens,
  totalTokens,
  friendlyType,
  meter,
  modelMix,
  modelSplits,
  tokenSplit,
  modelName,
  pixelCells,
  newFailures,
  readOutput,
  recentRuns,
  scriptRuns,
  sparkline,
  spendOf,
  spends,
  stages,
  statusLine,
  summary,
} from '../hooks/activity'
import type { Activity, Dashboard } from '../types'

const ID = '1a2b3c4d-1111-2222-3333-444455556666'
const HOUR = 3_600_000
const NOW = Date.parse('2026-10-12T12:00:00Z')

const dashboard = (activity: Activity[] = [], extra: Partial<Dashboard> = {}): Dashboard => ({
  activity,
  platform: { phase: 'off', message: 'Off: no Boomi credentials.', runs: [] },
  watched: [],
  ...extra,
})

let nextId = 0
const act = (kind: Activity['kind'], outcome: Activity['outcome'], subject: string, at: number, more: Partial<Activity> = {}): Activity => ({
  id: ++nextId,
  kind,
  outcome,
  subject,
  detail: outcome,
  startedAt: at,
  endedAt: at,
  ...more,
})

const FILE = 'active-development/processes/Orders.xml'

test('scriptRuns finds the Companion scripts a command runs and what they name', () => {
  expect(
    scriptRuns(
      `cd work && bash scripts/boomi-component-push.sh ${FILE} --branch dev && bash scripts/boomi-deploy.sh ${FILE} --deployment-notes "first cut"`,
    ),
  ).toEqual([
    { kind: 'push', file: `work/${FILE}` },
    { kind: 'deploy', file: `work/${FILE}` },
  ])
  expect(scriptRuns(`bash scripts/boomi-test-execute.sh --process-id ${ID} --test-data in.json`)).toEqual([{ kind: 'test', processId: ID }])
  expect(scriptRuns('bash scripts/boomi-undeploy.sh dep-123')).toEqual([{ kind: 'undeploy', deploymentId: 'dep-123' }])
  expect(scriptRuns(`bash scripts/boomi-component-pull.sh --component-id ${ID}`)).toEqual([{ kind: 'pull', componentId: ID }])
})

test("scriptRuns notes Companion's other scripts, and finds scripts inside bash -c", () => {
  expect(scriptRuns('bash scripts/boomi-component-search.sh --name Orders')).toEqual([{ kind: 'other', script: 'component-search' }])
  expect(scriptRuns(`bash -c 'cd x && bash scripts/boomi-deploy.sh ${FILE}'`)).toEqual([{ kind: 'deploy', file: `x/${FILE}` }])
})

test('scriptRuns leaves out help, connection tests, the shared library and other commands', () => {
  expect(scriptRuns('bash scripts/boomi-component-push.sh --test-connection')).toEqual([])
  expect(scriptRuns('bash scripts/boomi-deploy.sh --list-environments')).toEqual([])
  expect(scriptRuns('source scripts/boomi-common.sh')).toEqual([])
  expect(scriptRuns('git status')).toEqual([])
})

test('componentPath names a component file the same way from a script and from an edit', () => {
  expect(componentPath(`/Users/me/work/${FILE}`)).toBe(FILE)
  expect(componentPath(FILE)).toBe(FILE)
  expect(componentPath('/Users/me/work/active-development/inventories/search.xml')).toBeUndefined()
  expect(componentPath('/Users/me/work/notes.md')).toBeUndefined()
  expect(componentPath('/w/src/components/a.xml', 'src/components')).toBeUndefined()
  expect(componentPath('/w/components/a.xml', 'components')).toBe('components/a.xml')
})

test('readOutput reads a push with its new version, a create with its ID, an unchanged push', () => {
  expect(readOutput('push', "SUCCESS: Pushed component 'Orders Sync' — now version 7", false)).toMatchObject({
    outcome: 'ok',
    name: 'Orders Sync',
    version: '7',
  })
  expect(readOutput('create', `SUCCESS: Component 'Orders API' created with ID: ${ID}`, false)).toMatchObject({
    outcome: 'ok',
    componentId: ID,
  })
  expect(readOutput('push', "Component 'Orders' matches the last push — nothing sent to the platform.", false).outcome).toBe('ok')
})

test('readOutput reads errors, and scripts that only read succeed without a SUCCESS line', () => {
  expect(readOutput('deploy', 'ERROR: Deployment failed (HTTP 400): bad package', true)).toMatchObject({
    outcome: 'failed',
    detail: 'ERROR: Deployment failed (HTTP 400): bad package',
  })
  expect(readOutput('push', 'something went wrong', true).outcome).toBe('failed')
  expect(readOutput('other', 'Found 3 components', false).outcome).toBe('ok')
  expect(readOutput('other', 'ERROR: HTTP 401', true).outcome).toBe('failed')
})

test("readOutput reads a test's execution status, and an ERROR status fails it", () => {
  expect(readOutput('test', 'Execution completed: status=COMPLETE, executionId=execution-abc-123', false)).toMatchObject({
    outcome: 'ok',
    executionStatus: 'COMPLETE',
    executionId: 'execution-abc-123',
  })
  expect(readOutput('test', 'Execution completed: status=ERROR, executionId=execution-abc-124', false).outcome).toBe('failed')
})

test("a component's stages read as its journey: edited, saved, deployed, tested", () => {
  const [row] = components([
    act('edit', 'ok', 'Orders Sync', NOW - 50, { file: FILE, type: 'process' }),
    act('push', 'ok', 'Orders Sync', NOW - 40, { file: FILE, version: '4' }),
    act('deploy', 'ok', 'Orders Sync', NOW - 30, { file: FILE, componentId: ID }),
    act('test', 'failed', 'Orders Sync', NOW - 20, { componentId: ID, executionStatus: 'ERROR' }),
  ])
  expect(row!.name).toBe('Orders Sync')
  expect(stages(row!).map(s => s.text)).toEqual(['saved v4', 'deployed', 'test ERROR'])
})

test('an edit after the last save, and a save after the last deploy, say so', () => {
  const [row] = components([
    act('push', 'ok', 'Orders Sync', NOW - 50, { file: FILE, version: '4' }),
    act('deploy', 'ok', 'Orders Sync', NOW - 40, { file: FILE }),
    act('push', 'ok', 'Orders Sync', NOW - 30, { file: FILE, version: '5' }),
    act('edit', 'ok', 'Orders Sync', NOW - 20, { file: FILE }),
  ])
  expect(stages(row!).map(s => s.text)).toEqual(['edited since last save', 'saved v5', 'redeploy needed'])
  const [fresh] = components([act('edit', 'ok', 'New Map', NOW, { file: 'active-development/maps/New.xml' })])
  expect(stages(fresh!).map(s => s.text)).toEqual(['edited, not in Boomi yet'])
})

test('needs attention lists current failures with a next step, and a later fix clears them', () => {
  const failing = dashboard([act('test', 'failed', 'Orders Sync', NOW, { componentId: ID, executionStatus: 'ERROR', executionId: 'execution-0490202b-2e2f' })])
  const [item] = attention(failing, NOW, 24 * HOUR)
  expect(item!.title).toBe('Test of Orders Sync ended ERROR')
  expect(item!.hint).toContain('execution log (0490202b…)')

  const fixed = dashboard([...failing.activity, act('test', 'ok', 'Orders Sync', NOW + 1, { componentId: ID, executionStatus: 'COMPLETE' })])
  expect(attention(fixed, NOW, 24 * HOUR)).toEqual([])
})

test("old runs in the environment don't need attention", () => {
  const runs = [
    { executionId: 'e1', processName: 'JMX Capability Scan', status: 'ERROR', at: '2026-09-07T09:45:11Z' },
    { executionId: 'e2', processName: 'Orders Sync', status: 'ERROR', at: '2026-10-12T10:00:00Z' },
  ]
  const state = dashboard([], { platform: { phase: 'ok', message: '', runs } })
  expect(recentRuns(runs, NOW, 24 * HOUR).map(r => r.executionId)).toEqual(['e2'])
  expect(attention(state, NOW, 24 * HOUR).map(a => a.title)).toEqual(['Orders Sync ended ERROR in the environment'])
})

test('the status line leads with the latest step, then what needs attention, then the cost', () => {
  const state = dashboard([
    act('test', 'failed', 'Orders Sync', NOW - 10, { componentId: ID, executionStatus: 'ERROR' }),
    act('push', 'ok', 'Weather API', NOW, { file: 'active-development/c/W.xml', version: '2' }),
  ])
  expect(statusLine(state, NOW, 24 * HOUR, { usd: 1.837, tokens: 1_240_000 })).toBe(
    '✓ Saved Weather API to Boomi (v2) · ✗ 1 needs attention · 1.24M tokens · $1.84 this session',
  )
  expect(statusLine(dashboard(), NOW, 24 * HOUR)).toBe('waiting for Companion')
})

test('describe words each step for a person, not a script', () => {
  expect(describe(act('other', 'ok', 'Companion', NOW, { script: 'component-search' }))).toBe('Searched components')
  expect(describe(act('deploy', 'failed', 'Orders Sync', NOW))).toBe('Deploy of Orders Sync failed')
  expect(describe(act('push', 'blocked', 'Orders Sync', NOW))).toBe('Blocked: push of Orders Sync')
  expect(describe(act('push', 'running', 'Orders Sync', NOW))).toBe('Saving Orders Sync…')
})

test('the summary has each section, in plain words', () => {
  const text = summary(dashboard([act('edit', 'ok', 'New Map', NOW - 120_000, { file: 'active-development/maps/New.xml', type: 'transform.map' })]), { usd: 0.5, contextPercent: 41.6 }, NOW, 24 * HOUR)
  expect(text).toContain('✓ Nothing needs attention.')
  expect(text).toContain('New Map (map): ◐ edited, not in Boomi yet')
  expect(text).toContain('Edited New Map, 2m ago')
  expect(text).toContain('Process runs in Boomi, last 24h')
  expect(text).toContain('Session: $0.50 so far · context 42% full')
})

test('a watched component changed by someone else is flagged, a change of our own is not', () => {
  const before = { componentId: ID, name: 'Orders Sync', version: '3' }
  const theirs = compareWatched(before, { version: '4', modifiedBy: 'pat@example.com' }, 'me@example.com')
  expect(theirs.isNewChange).toBe(true)
  expect(theirs.next.changedBy).toBe('pat@example.com')
  expect(compareWatched(before, { version: '4', modifiedBy: 'ME@example.com' }, 'me@example.com').isNewChange).toBe(false)
  expect(compareWatched({ componentId: ID }, { version: '3' }, 'me@example.com').isNewChange).toBe(false)
})

test('newFailures returns only failed runs not seen before', () => {
  const old = [{ executionId: 'e1', processName: 'A', status: 'ERROR', at: 't1' }]
  const fresh = [
    { executionId: 'e2', processName: 'B', status: 'ERROR', at: 't2' },
    { executionId: 'e3', processName: 'C', status: 'COMPLETE', at: 't3' },
    ...old,
  ]
  expect(newFailures(old, fresh).map(run => run.executionId)).toEqual(['e2'])
})

test('componentOf reads the root element; friendlyType names types in plain words', () => {
  const xml = `<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="${ID}" name="Orders Sync" type="process"><bns:object><x componentId="other"/></bns:object></bns:Component>`
  expect(componentOf(xml)).toEqual({ componentId: ID, name: 'Orders Sync', type: 'process' })
  expect(componentOf('<bns:Component componentId="" name="New">').componentId).toBeUndefined()
  expect(friendlyType('connector-settings')).toBe('connection')
  expect(friendlyType('profile.json')).toBe('JSON profile')
})

test('formatTokens reads at a glance', () => {
  expect([950, 4_210, 312_400, 1_240_000].map(formatTokens)).toEqual(['950', '4.2k', '312k', '1.24M'])
})

test("each step's spend is the difference from the step before; a component's is its steps summed", () => {
  const list = [
    act('edit', 'ok', 'Orders Sync', NOW - 30, { file: FILE, tokensAt: 10_000, usdAt: 0.1 }),
    act('push', 'ok', 'Orders Sync', NOW - 20, { file: FILE, tokensAt: 25_000, usdAt: 0.3 }),
    act('other', 'ok', 'Companion', NOW - 10, { script: 'component-search', tokensAt: 26_000, usdAt: 0.31 }),
  ]
  const all = spends(list)
  expect(all.get(list[0]!.id)).toEqual({ tokens: 10_000, usd: 0.1 })
  expect(all.get(list[1]!.id)?.tokens).toBe(15_000)
  expect(Math.round((all.get(list[1]!.id)?.usd ?? 0) * 100)).toBe(20)
  const [row] = components(list)
  expect(spendOf(row!.ids, all).tokens).toBe(25_000)
})

test('sparkline and meter draw at a glance', () => {
  expect(sparkline([1, 4, 8])).toBe('▂▅█')
  expect(sparkline([0, 0])).toBe('')
  expect(meter(31, 10)).toBe('▰▰▰▱▱▱▱▱▱▱')
})

test('modelName reads model ids in words, and modelMix lists each model biggest first', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-5-5-20260901')).toBe('Haiku 5.5')
  expect(modelName('claude-sonnet-5')).toBe('Sonnet 5')
  expect(modelName('some-gateway-model')).toBe('some-gateway-model')
  const mix = modelMix({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 2, models: { 'claude-haiku-5-5': 26_000, 'claude-opus-5-5': 312_000 } })
  expect(mix).toBe('Opus 5.5 312k · Haiku 5.5 26k')
})

test('the 8-bit flamingo stands on one leg when idle and walks through its frames', () => {
  expect(flamingo(false, 3)).toBe(FLAMINGO_IDLE)
  expect(flamingo(true, 0)).toBe(FLAMINGO_WALK[0])
  expect(flamingo(true, 5)).toBe(FLAMINGO_WALK[1])
  for (const f of [FLAMINGO_IDLE, ...FLAMINGO_WALK]) {
    expect(f.length).toBe(16)
    expect(f.every(row => row.length === 12)).toBe(true)
  }
})

test('pixelCells packs two pixel rows into each cell with half blocks', () => {
  const colors = { P: '#C2185B', L: '#F7A8C4' }
  expect(pixelCells(['P.P.', 'PL..'], colors)).toEqual([
    [{ char: '█', color: '#C2185B', bg: undefined }, { char: '▄', color: '#F7A8C4' }, { char: '▀', color: '#C2185B' }, { char: ' ' }],
  ])
  expect(pixelCells(['PL', 'LP'], colors)[0]![0]).toEqual({ char: '▀', color: '#C2185B', bg: '#F7A8C4' })
  expect(pixelCells(FLAMINGO_IDLE, { P: 'p', L: 'l', K: 'k' }).length).toBe(8)
})

test("a script that's only read or searched isn't a run", () => {
  expect(scriptRuns('cat scripts/boomi-deploy.sh')).toEqual([])
  expect(scriptRuns('grep -n SUCCESS scripts/boomi-deploy.sh | head')).toEqual([])
  expect(scriptRuns('sed -n 1,40p skills/boomi-integration/scripts/boomi-deploy.sh')).toEqual([])
  expect(scriptRuns(`BOOMI_X=1 timeout 60 bash -x scripts/boomi-deploy.sh ${FILE}`)).toEqual([{ kind: 'deploy', file: FILE }])
  expect(scriptRuns(`./scripts/boomi-deploy.sh ${FILE}; echo done`)).toEqual([{ kind: 'deploy', file: FILE }])
})

test('a file named after a cd is read from that folder', () => {
  const [run] = scriptRuns('cd active-development && bash ../scripts/boomi-deploy.sh processes/Listener.xml')
  expect(run!.file).toBe('active-development/processes/Listener.xml')
  expect(componentPath(run!.file!)).toBe('active-development/processes/Listener.xml')
  expect(scriptRuns('cd /w/active-development/processes && bash /w/scripts/boomi-deploy.sh ./Listener.xml')[0]!.file).toBe(
    '/w/active-development/processes/Listener.xml',
  )
})

test("a script's SUCCESS line passes it even when the command's exit code is an error", () => {
  const output = "SUCCESS: Deployed 'WX Listener' (package: p1)\nbash: tpyo: command not found"
  expect(readOutput('deploy', output, true)).toMatchObject({ outcome: 'ok', name: 'WX Listener' })
  expect(readOutput('deploy', 'bash: tpyo: command not found', true).outcome).toBe('failed')
  expect(readOutput('deploy', 'Deploying...', false)).toMatchObject({ outcome: 'ok', detail: 'finished' })
})

test('one component named two ways is one row, and its failure needs attention once', () => {
  const list = [
    act('create', 'ok', 'WX Listener', NOW - 30, { file: 'active-development/processes/Listener.xml', componentId: ID }),
    act('deploy', 'failed', 'Listener.xml', NOW - 20, { file: 'x/processes/Listener.xml', componentId: ID }),
    act('deploy', 'failed', 'WX Listener', NOW - 10, { componentId: ID, detail: 'ERROR: x' }),
  ]
  const rows = components(list)
  expect(rows.length).toBe(1)
  expect(rows[0]!.name).toBe('WX Listener')
  expect(attention(dashboard(list), NOW, 24 * HOUR).length).toBe(1)
})

test("a step that names no component stays out of the components list", () => {
  expect(components([act('deploy', 'ok', 'a component', NOW)])).toEqual([])
})

test('the flamingo paces across its strip and turns at each end', () => {
  expect([0, 1, 5, 6, 7, 11, 12].map(f => pace(f, 6))).toEqual([
    { offset: 0, facing: 'right' },
    { offset: 1, facing: 'right' },
    { offset: 5, facing: 'right' },
    { offset: 6, facing: 'left' },
    { offset: 5, facing: 'left' },
    { offset: 1, facing: 'left' },
    { offset: 0, facing: 'right' },
  ])
})

test('facing left, the flamingo is drawn mirrored', () => {
  expect(mirror(['P..L'])).toEqual(['L..P'])
  const right = flamingoView(true, 1)
  const left = flamingoView(true, 7)
  expect(right.facing).toBe('right')
  expect(left.facing).toBe('left')
  expect(left.pixels).toEqual(mirror(flamingo(true, 7)))
  expect(right.pixels).toEqual([...flamingo(true, 1)])
})

test('new tokens leave out cache reads, which are counted apart', () => {
  const l = { input: 1_000, output: 2_000, cacheRead: 300_000, cacheWrite: 5_000, calls: 3 }
  expect(newTokens(l)).toBe(8_000)
  expect(cachedTokens(l)).toBe(300_000)
  expect(totalTokens(l)).toBe(308_000)
})

test('the token split names each kind, and each model gets its own line when there are several', () => {
  const opus = { input: 18_000, output: 44_000, cacheRead: 3_300_000, cacheWrite: 350_000 }
  expect(tokenSplit(opus)).toBe('412k new (18k in · 44k out · 350k cache writes) · 3.30M cache reads')
  const ledger = { ...opus, calls: 60, byModel: { 'claude-opus-5-5': opus } }
  expect(modelSplits(ledger)).toEqual([])
  const haiku = { input: 2_000, output: 1_000, cacheRead: 40_000, cacheWrite: 9_000 }
  expect(modelSplits({ ...ledger, byModel: { 'claude-haiku-5-5': haiku, 'claude-opus-5-5': opus } })).toEqual([
    'Opus 5.5: 412k new (18k in · 44k out · 350k cache writes) · 3.30M cache reads',
    'Haiku 5.5: 12k new (2.0k in · 1.0k out · 9.0k cache writes) · 40k cache reads',
  ])
})
