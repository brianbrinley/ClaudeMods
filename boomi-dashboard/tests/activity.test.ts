import { expect, test } from 'claude-code/testing'

import {
  attention,
  closeItem,
  diagnose,
  fixPrompt,
  report,
  guardrails,
  guardrailText,
  pastSessions,
  historyTotals,
  historySummary,
  runWords,
  budgetOf,
  nextStep,
  closedCount,
  reopenAll,
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
  readResults,
  assignResults,
  githubUrl,
  parseResults,
  runsOf,
  runsSummary,
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
import type { ScannedSession } from '../hooks/activity'

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

/** The script runs in a command, without the folder each ran from (its own test checks that). */
const runsIn = (command: string) => scriptRuns(command).map(({ scriptsDir: _dir, args: _args, ...run }) => run)

test('scriptRuns finds the Companion scripts a command runs and what they name', () => {
  expect(
    runsIn(
      `cd work && bash scripts/boomi-component-push.sh ${FILE} --branch dev && bash scripts/boomi-deploy.sh ${FILE} --deployment-notes "first cut"`,
    ),
  ).toEqual([
    { kind: 'push', file: `work/${FILE}` },
    { kind: 'deploy', file: `work/${FILE}` },
  ])
  expect(runsIn(`bash scripts/boomi-test-execute.sh --process-id ${ID} --test-data in.json`)).toEqual([{ kind: 'test', processId: ID }])
  expect(runsIn('bash scripts/boomi-undeploy.sh dep-123')).toEqual([{ kind: 'undeploy', deploymentId: 'dep-123' }])
  expect(runsIn(`bash scripts/boomi-component-pull.sh --component-id ${ID}`)).toEqual([{ kind: 'pull', componentId: ID }])
})

test("scriptRuns notes Companion's other scripts, and finds scripts inside bash -c", () => {
  expect(runsIn('bash scripts/boomi-component-search.sh --name Orders')).toEqual([{ kind: 'other', script: 'component-search' }])
  expect(runsIn(`bash -c 'cd x && bash scripts/boomi-deploy.sh ${FILE}'`)).toEqual([{ kind: 'deploy', file: `x/${FILE}` }])
})

test('scriptRuns leaves out help, connection tests, the shared library and other commands', () => {
  expect(runsIn('bash scripts/boomi-component-push.sh --test-connection')).toEqual([])
  expect(runsIn('bash scripts/boomi-deploy.sh --list-environments')).toEqual([])
  expect(runsIn('source scripts/boomi-common.sh')).toEqual([])
  expect(runsIn('git status')).toEqual([])
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
  expect(item!.hint).toContain('Execution 0490202b…: press Why?')
  expect(item!.executionId).toBe('execution-0490202b-2e2f')

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
  // Resting on one leg: a single leg reaches the ground, the other is folded up.
  expect(FLAMINGO_IDLE[FLAMINGO_IDLE.length - 1]).toBe('.....PP.....')
  expect(FLAMINGO_IDLE[FLAMINGO_IDLE.length - 2]).toBe('......P.....')
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
  expect(runsIn('cat scripts/boomi-deploy.sh')).toEqual([])
  expect(runsIn('grep -n SUCCESS scripts/boomi-deploy.sh | head')).toEqual([])
  expect(runsIn('sed -n 1,40p skills/boomi-integration/scripts/boomi-deploy.sh')).toEqual([])
  expect(runsIn(`BOOMI_X=1 timeout 60 bash -x scripts/boomi-deploy.sh ${FILE}`)).toEqual([{ kind: 'deploy', file: FILE }])
  expect(runsIn(`./scripts/boomi-deploy.sh ${FILE}; echo done`)).toEqual([{ kind: 'deploy', file: FILE }])
})

test('a file named after a cd is read from that folder', () => {
  const [run] = runsIn('cd active-development && bash ../scripts/boomi-deploy.sh processes/Listener.xml')
  expect(run!.file).toBe('active-development/processes/Listener.xml')
  expect(componentPath(run!.file!)).toBe('active-development/processes/Listener.xml')
  expect(runsIn('cd /w/active-development/processes && bash /w/scripts/boomi-deploy.sh ./Listener.xml')[0]!.file).toBe(
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
  // It moves a column every second frame: frame 14 is step 7, on the way back.
  const right = flamingoView(true, 1)
  const left = flamingoView(true, 14)
  expect(right.facing).toBe('right')
  expect(left.facing).toBe('left')
  expect(left.pixels).toEqual(mirror(flamingo(true, 14)))
  expect(flamingoView(true, 2).offset).toBe(1)
  expect(flamingoView(true, 3).offset).toBe(1)
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

// --- Regression: a live OrderValidator build that left "Components this session" empty ---

const SKILL = '/Users/me/.claude/plugins/cache/boomi-companion/bc-integration/1.0.76/skills/boomi-integration'

test('a multi-line command runs each script, each with its own file', () => {
  const command = [
    `bash ${SKILL}/scripts/boomi-component-create.sh active-development/profiles/OrderRequest.xml`,
    `bash ${SKILL}/scripts/boomi-component-create.sh active-development/processes/Listener.xml`,
  ].join('\n')
  expect(runsIn(command)).toEqual([
    { kind: 'create', file: 'active-development/profiles/OrderRequest.xml' },
    { kind: 'create', file: 'active-development/processes/Listener.xml' },
  ])
})

test('a script run in a loop is a run', () => {
  const command = `for f in active-development/profiles/*.xml; do bash ${SKILL}/scripts/boomi-component-create.sh "$f"; done`
  expect(runsIn(command).map(run => run.kind)).toEqual(['create'])
  expect(runsIn(`if true; then bash ${SKILL}/scripts/boomi-deploy.sh ${FILE}; fi`)).toEqual([{ kind: 'deploy', file: FILE }])
})

test('each result in the output is read on its own, so a loop of creates is several components', () => {
  const output = [
    "Creating component 'OrderValidator - Order Request Profile' on the account default branch",
    `SUCCESS: Component 'OrderValidator - Order Request Profile' created with ID: 11111111-1111-1111-1111-111111111111`,
    "Creating component 'OrderValidator - Order Response Profile' on the account default branch",
    'ERROR: Create failed (HTTP 400): bad profile',
    "Creating component 'OrderValidator - Listener Validate Order' on the account default branch",
    `SUCCESS: Component 'OrderValidator - Listener Validate Order' created with ID: 33333333-1111-1111-1111-111111111111`,
  ].join('\n')
  expect(readResults('create', output, true).map(r => [r.name, r.outcome, r.componentId])).toEqual([
    ['OrderValidator - Order Request Profile', 'ok', '11111111-1111-1111-1111-111111111111'],
    ['OrderValidator - Order Response Profile', 'failed', undefined],
    ['OrderValidator - Listener Validate Order', 'ok', '33333333-1111-1111-1111-111111111111'],
  ])
})

test('a loop that ran one script six times is six steps; each run keeps its own result', () => {
  const results = parseResults(
    Array.from({ length: 3 }, (_, i) => `Creating component 'P${i}' on the account default branch\nSUCCESS: Component 'P${i}' created with ID: ${i}1111111-1111-1111-1111-111111111111`).join('\n'),
  )
  const { first, extras } = assignResults([{ id: 7, kind: 'create' }], results)
  expect(first.get(7)?.name).toBe('P0')
  expect(extras.get(7)?.map(r => r.name)).toEqual(['P1', 'P2'])
})

test('a push and a deploy in one command each take their own result, named from the lines before', () => {
  const output = [
    `Pushing component 'OrderValidator - Listener Validate Order' (${ID}) to the account default branch`,
    "SUCCESS: Pushed component 'OrderValidator - Listener Validate Order' — now version 3",
    `Packaging 'OrderValidator - Listener Validate Order' (${ID}) from the account default branch`,
    'ERROR: Deployment failed (HTTP 400): no runtime',
  ].join('\n')
  const { first } = assignResults([{ id: 1, kind: 'push' }, { id: 2, kind: 'deploy' }], parseResults(output))
  expect(first.get(1)).toMatchObject({ outcome: 'ok', version: '3', componentId: ID })
  expect(first.get(2)).toMatchObject({ outcome: 'failed', name: 'OrderValidator - Listener Validate Order', componentId: ID })
})

const LISTENER = 'OrderValidator - Listener Validate Order'
const listenerRuns = [
  ...['a', 'b', 'c', 'd'].map(x => ({ executionId: `execution-${x}`, processName: LISTENER, processId: ID, status: 'COMPLETE', at: '2026-10-12T11:00:00Z', executionType: 'exec_listener' })),
  { executionId: 'execution-81f61084-fd93-4565-9bda-9bf0d4b4f102', processName: LISTENER, processId: ID, status: 'ERROR', at: '2026-10-12T11:05:00Z', executionType: 'exec_listener' },
]

test("a component's runs in Boomi show on its row, matched by its ID", () => {
  const [row] = components([act('deploy', 'ok', LISTENER, NOW - 60_000, { componentId: ID, file: 'active-development/processes/Listener.xml' })])
  expect(runsOf(row!, listenerRuns).length).toBe(5)
  expect(stages(row!, listenerRuns).map(s => s.text)).toEqual(['deployed', '1 of 5 listener runs failed'])
  expect(runsOf({ name: 'Something else' }, listenerRuns)).toEqual([])
})

test('a failed run of a session component needs attention with that context, until marked seen', () => {
  const state = dashboard([act('deploy', 'ok', LISTENER, NOW - 60_000, { componentId: ID })], {
    platform: { phase: 'ok', message: '', runs: listenerRuns },
  })
  const [item] = attention(state, NOW, 24 * HOUR)
  expect(item!.title).toBe(`Listener run of ${LISTENER} ended ERROR`)
  expect(item!.hint).toContain('Execution 81f61084…, a component from this session')
  expect(item!.executionId).toBe('execution-81f61084-fd93-4565-9bda-9bf0d4b4f102')
  expect(attention({ ...state, seenRuns: ['execution-81f61084-fd93-4565-9bda-9bf0d4b4f102'] }, NOW, 24 * HOUR)).toEqual([])
})

test('a collapsed runs section reads as one line', () => {
  expect(runsSummary(listenerRuns, 24)).toEqual({ level: 'critical', text: '5 in 24h, 1 failed' })
  expect(runsSummary(listenerRuns.slice(0, 4), 24)).toEqual({ level: 'healthy', text: '4 in 24h, none failed' })
})

test("the footer's link is the origin's GitHub page, in any remote form, and nothing for other hosts", () => {
  expect(githubUrl('git@github.com:brianbrinley/ClaudeMods.git')).toBe('https://github.com/brianbrinley/ClaudeMods')
  expect(githubUrl('https://github.com/brianbrinley/ClaudeMods')).toBe('https://github.com/brianbrinley/ClaudeMods')
  expect(githubUrl('https://x-access-token:abc@github.com/o/r.git')).toBe('https://github.com/o/r')
  expect(githubUrl('ssh://git@github.com/o/r.git')).toBe('https://github.com/o/r')
  expect(githubUrl('https://gitlab.com/o/r.git')).toBeUndefined()
  expect(githubUrl(null)).toBeUndefined()
})

test("steps from an earlier session don't skew the first new step's spend", () => {
  const list = [
    act('push', 'ok', 'A', NOW - 50, { file: FILE, tokensAt: 400_000, isRestored: true }),
    act('push', 'ok', 'A', NOW - 10, { file: FILE, tokensAt: 5_000 }),
  ]
  expect(spends(list).get(list[1]!.id)?.tokens).toBe(5_000)
})

test('closing an item takes it out of Needs attention; a new failure of the same component comes back', () => {
  const failed = act('deploy', 'failed', 'Orders Sync', NOW - 30, { componentId: ID, detail: 'ERROR: no runtime' })
  let state = dashboard([failed])
  const [item] = attention(state, NOW, 24 * HOUR)
  expect(item!.key).toBe(`step:${failed.id}`)
  state = closeItem(state, item!.key)
  expect(attention(state, NOW, 24 * HOUR)).toEqual([])
  expect(closedCount(state, NOW, 24 * HOUR)).toBe(1)
  const again = { ...state, activity: [...state.activity, act('deploy', 'failed', 'Orders Sync', NOW, { componentId: ID, detail: 'ERROR: no runtime' })] }
  expect(attention(again, NOW, 24 * HOUR).length).toBe(1)
  expect(attention(reopenAll(state), NOW, 24 * HOUR).length).toBe(1)
})

test('closing a run marks it seen, and closing a watched change clears it', () => {
  const run = { executionId: 'execution-e9', processName: 'P', status: 'ERROR', at: '2026-10-12T11:00:00Z' }
  const state = dashboard([], {
    platform: { phase: 'ok', message: '', runs: [run] },
    watched: [{ componentId: ID, name: 'W', version: '4', changedBy: 'pat@example.com' }],
  })
  const keys = attention(state, NOW, 24 * HOUR).map(item => item.key).sort()
  expect(keys).toEqual(['run:execution-e9', `watch:${ID}`])
  const closed = keys.reduce(closeItem, state)
  expect(attention(closed, NOW, 24 * HOUR)).toEqual([])
  expect(closed.seenRuns).toEqual(['execution-e9'])
  expect(closed.watched[0]!.changedBy).toBeUndefined()
})

test("a script named by its path tells where Companion's scripts are", () => {
  expect(scriptRuns(`bash ${SKILL}/scripts/boomi-deploy.sh ${FILE}`)[0]!.scriptsDir).toBe(`${SKILL}/scripts`)
  expect(scriptRuns(`cd /w && bash scripts/boomi-deploy.sh ${FILE}`)[0]!.scriptsDir).toBe('/w/scripts')
  expect(scriptRuns(`boomi-deploy.sh ${FILE}`)[0]!.scriptsDir).toBeUndefined()
})

const LOG = [
  'Executing test for process 33333333 on atom a1',
  '2026-10-12T11:05:00Z\tINFO\tStart\tExecuting Process OrderValidator - Listener Validate Order',
  '2026-10-12T11:05:01Z\tWARNING\tMap\tNo data produced from map',
  '2026-10-12T11:05:01Z\tSEVERE\tParse Order\tUnexpected character (\'}\' (code 125)) at line 1, column 18',
  '2026-10-12T11:05:01Z\tSEVERE\tException\tOrder JSON is not valid',
].join('\n')

test('diagnose picks the SEVERE lines out of a process log, without their timestamps', () => {
  expect(diagnose(LOG)).toEqual({
    lines: ["SEVERE · Parse Order · Unexpected character ('}' (code 125)) at line 1, column 18", 'SEVERE · Exception · Order JSON is not valid'],
    severe: 2,
    warnings: 1,
  })
  expect(diagnose('a\nb\nc').lines).toEqual(['a', 'b', 'c'])
})

test('the fix request names the execution and quotes what the log said', () => {
  const text = fixPrompt('Listener run of X ended ERROR', 'execution-81f6', { lines: ['SEVERE\tParse Order\tbad'], severe: 1, warnings: 0 })
  expect(text).toContain('Listener run of X ended ERROR (execution execution-81f6). Its process log says:')
  expect(text).toContain('  SEVERE\tParse Order\tbad')
  expect(text).toContain('push, redeploy and test it again')
})

test('the session report has each section, and a pipe in a name keeps the table intact', () => {
  const state = dashboard([
    act('push', 'ok', 'A | B', NOW - 60_000, { file: FILE, version: '2' }),
    act('deploy', 'ok', 'A | B', NOW - 50_000, { file: FILE }),
    act('test', 'failed', 'A | B', NOW - 40_000, { file: FILE, executionStatus: 'ERROR', executionId: 'execution-1' }),
  ])
  const text = report(state, { session: '3adaec6a', date: '2026-10-12', repo: 'https://github.com/o/r', usage: { usd: 0.42, split: '12k new (…) · 80k cache reads', model: 'Opus 5.5', startedAt: NOW - 3_600_000 } }, NOW, 24 * HOUR)
  expect(text).toContain('# Boomi Companion session report')
  expect(text).toContain('Session 3adaec6a · 2026-10-12 · 1h 0m · Opus 5.5')
  expect(text).toContain('Repository: https://github.com/o/r')
  expect(text).toContain('| A \\| B |  | ✓ saved v2 · ✓ deployed · ✗ test ERROR |')
  expect(text).toContain('- ✗ Test of A | B ended ERROR (execution execution-1)')
  expect(text).toContain('## Needs attention')
  expect(text).toContain('- Cost: $0.42')
  expect(text).toContain('- Tokens: 12k new (…) · 80k cache reads')
})

test('a test keeps its arguments so it can be run again', () => {
  expect(scriptRuns(`bash scripts/boomi-test-execute.sh --process-id ${ID} --atom-id a1`)[0]!.args).toEqual(['--process-id', ID, '--atom-id', 'a1'])
  expect(scriptRuns(`bash scripts/boomi-component-push.sh ${FILE}`)[0]!.args).toBeUndefined()
})

test('the budget warns from 80% and says when it is spent, and stays quiet without one', () => {
  expect(budgetOf(1, 5)).toEqual({ level: 'healthy', percent: 20, text: '20% of the $5.00 budget' })
  expect(budgetOf(4.2, 5)?.level).toBe('warning')
  expect(budgetOf(5.5, 5)).toMatchObject({ level: 'critical', text: 'budget spent: $5.50 of the $5.00 budget' })
  expect(budgetOf(4, 0)).toBeUndefined()
  expect(budgetOf(undefined, 5)).toBeUndefined()
  expect(statusLine(dashboard(), NOW, 24 * HOUR, { usd: 4.2, budgetUsd: 5 })).toContain('◐ 84% of the $5.00 budget')
  expect(statusLine(dashboard(), NOW, 24 * HOUR, { usd: 1, budgetUsd: 5 })).not.toContain('budget')
})

test('the next step is to deploy what was saved, then to test what was deployed', () => {
  const saved = act('push', 'ok', 'Orders Sync', NOW - 60_000, { file: FILE, type: 'process' })
  expect(nextStep([saved])).toBe('Deploy Orders Sync and test it')
  const deployed = act('deploy', 'ok', 'Orders Sync', NOW - 50_000, { file: FILE, type: 'process' })
  expect(nextStep([saved, deployed])).toBe('Test Orders Sync')
  expect(nextStep([saved, deployed, act('test', 'ok', 'Orders Sync', NOW - 40_000, { file: FILE, type: 'process' })])).toBeUndefined()
  expect(nextStep([saved, deployed, act('test', 'failed', 'Orders Sync', NOW - 40_000, { file: FILE, type: 'process' })])).toBeUndefined()
  expect(nextStep([saved, act('deploy', 'running', 'Orders Sync', NOW - 50_000, { file: FILE, type: 'process' })])).toBeUndefined()
  expect(nextStep([act('push', 'ok', 'Order Profile', NOW, { file: 'active-development/profiles/P.xml', type: 'profile.json' })])).toBeUndefined()
  expect(nextStep([{ ...saved, isRestored: true }])).toBeUndefined()
})

const SCAN: { sessions: ScannedSession[] } = {
  sessions: [
    {
      id: 'aaaaaaaa-1111',
      project: '/Users/me/orders',
      startedAt: '2026-10-10T09:00:00Z',
      costUsd: 3.5,
      models: { 'claude-opus-5-5': { input: 100, output: 900, cacheRead: 50_000, cacheWrite: 1000 } },
      commands: [
        'bash scripts/boomi-component-push.sh active-development/processes/Orders.xml && bash scripts/boomi-deploy.sh active-development/processes/Orders.xml',
        `bash scripts/boomi-test-execute.sh --process-id ${ID}`,
        `bash scripts/boomi-test-execute.sh --process-id ${ID}`,
      ],
    },
    {
      id: 'bbbbbbbb-2222',
      project: '/Users/me/old',
      startedAt: '2026-09-01T09:00:00Z',
      costUsd: null,
      models: { 'claude-sonnet-5-5': { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 } },
      commands: ['bash scripts/boomi-component-create.sh active-development/profiles/P.xml'],
    },
    // Only looked at a script: not a Companion session.
    { id: 'cccccccc-3333', startedAt: '2026-10-11T09:00:00Z', costUsd: 9, models: {}, commands: ['cat scripts/boomi-deploy.sh', 'find / -name boomi-deploy.sh'] },
  ],
}

test('past sessions are the ones that ran a Companion script, with their work, components and cost', () => {
  const past = pastSessions(SCAN)
  expect(past.map(s => s.id)).toEqual(['aaaaaaaa-1111', 'bbbbbbbb-2222'])
  expect(past[0]).toMatchObject({ costUsd: 3.5, tokens: 2000, cached: 50_000, runs: { push: 1, deploy: 1, test: 2 }, components: ['Orders'] })
  expect(past[0]!.models).toEqual(['Opus 5.5'])
  expect(past[1]!.costUsd).toBeUndefined()
  expect(runWords(past[0]!.runs)).toBe('1 push · 1 deploy · 2 tests')
})

test('history adds up the week, the month and everything, and says what has no recorded cost', () => {
  const past = pastSessions(SCAN)
  expect(historyTotals(past, NOW, 7 * 86_400_000)).toEqual({ sessions: 1, usd: 3.5, unpriced: 0, tokens: 2000 })
  expect(historyTotals(past, NOW)).toMatchObject({ sessions: 2, usd: 3.5, unpriced: 1 })
  const text = historySummary(past, NOW, 90, 'aaaaaaaa-1111')
  expect(text).toContain('This week: 1 session · $3.50 · 2.0k tokens')
  expect(text).toContain('All 90 days: 2 sessions · $3.50 (+1 without a recorded cost)')
  expect(text).toContain('2026-10-10 (this session) · orders · $3.50 · 2.0k tokens · 1 push · 1 deploy · 2 tests · Orders')
  expect(text).toContain('2026-09-01 · old · 20 tokens, no recorded cost · 1 create · P')
  expect(historySummary([], NOW, 90)).toContain('No Boomi Companion sessions')
})

test("a failed test's execution is one item, not a second one for its run in Boomi, even once it's closed", () => {
  const tested = act('test', 'failed', 'Orders Sync', NOW - 30, { componentId: ID, executionStatus: 'ERROR', executionId: 'execution-77' })
  const runs = [{ executionId: 'execution-77', processName: 'Orders Sync', processId: ID, status: 'ERROR', at: '2026-10-12T11:59:00Z' }]
  const state = dashboard([tested], { platform: { phase: 'ok', message: '', runs } })
  expect(attention(state, NOW, 24 * HOUR).map(item => item.key)).toEqual([`step:${tested.id}`])
  expect(attention(closeItem(state, `step:${tested.id}`), NOW, 24 * HOUR)).toEqual([])
})

test('guardrails: what the standards and runtime mods say, each with an icon and a label', () => {
  expect(guardrails(undefined, undefined)).toEqual([])
  const blocked = { checks: 3, blocked: 1, last: { script: 'push', files: 1, errors: 2, warnings: 0, isBlocked: true, findings: ['Orders.xml: a password is typed into a password field', 'Orders.xml: x'] } }
  expect(guardrails(blocked, undefined)).toEqual([
    { level: 'serious', text: 'Standards blocked the last push: Orders.xml: a password is typed into a password field (+1 more)' },
  ])
  const passed = { checks: 4, blocked: 1, last: { script: 'deploy', files: 1, errors: 0, warnings: 0, isBlocked: false, findings: [] } }
  expect(guardrails(passed, undefined)[0]).toEqual({ level: 'healthy', text: 'Standards: the last deploy passed (4 checks, 1 blocked)' })
  expect(guardrails({ ...passed, last: { ...passed.last, warnings: 1, findings: ['A.xml: name'] } }, undefined)[0]!.level).toBe('warning')
  expect(guardrails({ ...passed, last: { ...passed.last, errors: 1, findings: ['A.xml: bad'] } }, undefined)[0]!.text).toContain('not enforced')
  expect(guardrails({ checks: 0, blocked: 0 }, undefined)[0]!.level).toBeUndefined()

  expect(guardrails(undefined, { phase: 'online', message: '', name: 'cc-1', smoke: { phase: 'passed', message: '' } })).toEqual([
    { level: 'healthy', text: 'Runtime cc-1 online, smoke test passed' },
  ])
  expect(guardrails(undefined, { phase: 'online', message: '', name: 'cc-1', smoke: { phase: 'failed', message: 'ERROR' } })[1]).toEqual({ level: 'critical', text: 'Smoke test failed: ERROR' })
  expect(guardrails(undefined, { phase: 'installing', message: 'Downloading', name: 'cc-1' })[0]).toEqual({ level: 'warning', text: 'Runtime cc-1 installing: Downloading' })
  expect(guardrails(undefined, { phase: 'error', message: 'did not come online' })[0]!.level).toBe('critical')
  expect(guardrails(undefined, { phase: 'idle', message: '' })[0]!.level).toBeUndefined()

  expect(guardrailText(guardrails(passed, { phase: 'idle', message: '' }))).toBe(
    'Guardrails:\n  ✓ Standards: the last deploy passed (4 checks, 1 blocked)\n  Runtime: none in this session. /boomi up starts one.',
  )
  expect(guardrailText([])).toBe('')
})

test("event-streams-setup.sh is Companion's too, though it isn't named boomi-*", () => {
  expect(scriptRuns('bash scripts/event-streams-setup.sh create-topic orders')).toMatchObject([{ kind: 'other', script: 'event-streams-setup' }])
})
