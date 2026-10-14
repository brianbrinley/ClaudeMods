import { expect, test } from 'claude-code/testing'
import type { Activity, Dashboard } from '../types'
import { assignSessions, boomiLink, hasEarlierSteps, packageOf, reportHtml, scoped, sessionLabel, sessionSummaries, sessionsCost, stepsToMatch, timeline, transcriptsFolder } from '../hooks/report-html'
import { withoutEchoes } from '../hooks/activity'
import { platformClient } from '../hooks/platform'

const NOW = Date.parse('2026-10-14T00:54:00Z')
const HOUR = 3_600_000

const step = (id: number, over: Partial<Activity>): Activity => ({ id, kind: 'push', outcome: 'ok', subject: 'X', detail: '', startedAt: NOW - HOUR, ...over })

// Two earlier sessions and this one, as a folder the dashboard kept looks.
const ACTIVITY: Activity[] = [
  step(1, { kind: 'create', subject: 'Random Oracle', componentId: '1479b327-86fb-442f-91ee-a6ac8e7f1db2', detail: "SUCCESS: Component 'Random Oracle' created with ID: 1479b327-86fb-442f-91ee-a6ac8e7f1db2", startedAt: NOW - 8 * HOUR, usdAt: 0.1, session: 'aaaaaaaa-1111', isRestored: true }),
  step(2, { kind: 'deploy', subject: 'Random Oracle', componentId: '1479b327-86fb-442f-91ee-a6ac8e7f1db2', detail: "SUCCESS: Deployed 'Random Oracle' (package: 9ed168df-6b76-4c26-8c06-6900e25f04df)", startedAt: NOW - 8 * HOUR + 60_000, usdAt: 0.3, session: 'aaaaaaaa-1111', isRestored: true }),
  step(3, { kind: 'test', outcome: 'failed', subject: 'Broken Oracle', componentId: 'cfdbd5f3-3802-4629-8abb-9bb27ab3c5e1', detail: 'status ERROR', executionStatus: 'ERROR', executionId: 'execution-6fe84020-2026.10.13', startedAt: NOW - 7 * HOUR, usdAt: 0.12, session: 'bbbbbbbb-2222', isRestored: true }),
  step(4, { kind: 'push', subject: 'Broken Oracle', componentId: 'cfdbd5f3-3802-4629-8abb-9bb27ab3c5e1', detail: "SUCCESS: Pushed component 'Broken Oracle' — now version 2", version: '2', startedAt: NOW - 10 * 60_000, usdAt: 0.02, session: 'cccccccc-3333' }),
]
const DASHBOARD: Dashboard = { activity: ACTIVITY, platform: { phase: 'off', message: '', runs: [] }, watched: [], earlier: [step(0, { kind: 'edit', subject: 'Old', file: 'active-development/process/Old.xml', startedAt: NOW - 50 * HOUR, isRestored: true, isEarlier: true })] }

test('a report covers this session, or every session this folder kept', () => {
  expect(hasEarlierSteps(DASHBOARD)).toBe(true)
  expect(hasEarlierSteps({ ...DASHBOARD, activity: [ACTIVITY[3]!], earlier: [] })).toBe(false)
  expect(scoped(DASHBOARD, 'session').activity.map(a => a.id)).toEqual([4])
  expect(scoped(DASHBOARD, 'all').activity.map(a => a.id)).toEqual([0, 1, 2, 3, 4])
})

test("each session's steps, failures, components and cost: this one's from usage, a scanned one's exact, else at least", () => {
  const all = scoped(DASHBOARD, 'all').activity
  const sessions = sessionSummaries(all, 'cccccccc-3333', 0.75, [{ id: 'bbbbbbbb-2222', costUsd: 0.4, tokens: 0, cached: 0, models: [], runs: {}, components: [], project: 'oracle' }])
  expect(sessions.map(s => [s.id, s.steps, s.failed, s.components, s.usd, s.usdIs])).toEqual([
    ['cccccccc-3333', 1, 0, 1, 0.75, 'exact'],
    ['bbbbbbbb-2222', 1, 1, 1, 0.4, 'exact'],
    ['aaaaaaaa-1111', 2, 0, 1, 0.3, 'atLeast'],
    ['earlier-1', 1, 0, 1, undefined, undefined],
  ])
  expect(sessions[0]!.isCurrent).toBe(true)
  expect(sessions[1]!.project).toBe('oracle')
})

test('a deploy names its package; a component links to its page in Boomi', () => {
  expect(packageOf("SUCCESS: Deployed 'Random Oracle' (package: 9ed168df-6b76-4c26-8c06-6900e25f04df)")).toBe('9ed168df-6b76-4c26-8c06-6900e25f04df')
  expect(packageOf('SUCCESS: Pushed')).toBeUndefined()
  expect(boomiLink('boomi_me-D1R00U', 'cfdbd5f3')).toBe('https://platform.boomi.com/AtomSphere.html#build;accountId=boomi_me-D1R00U;components=cfdbd5f3')
})

const USAGE = { startedAt: NOW - HOUR, usd: 0.75, tokens: 5000 }
const BOOMI = {
  accountId: 'boomi_me-D1R00U',
  accountName: 'Boomi_Me <b>',
  environmentId: 'env-1',
  apiHost: 'api.boomi.com',
  components: {
    'cfdbd5f3-3802-4629-8abb-9bb27ab3c5e1': { componentId: 'cfdbd5f3-3802-4629-8abb-9bb27ab3c5e1', name: 'Broken Oracle (demo)', version: '2', type: 'process', folderName: 'Magic8Ball-RandomOracle', modifiedBy: 'me@example.com', modifiedDate: '2026-10-13T17:15:55Z' },
  },
}

test("an all-sessions report: sessions, the Boomi account, each component's ID and Boomi's view, and every deploy's package and test's execution", () => {
  const all = scoped(DASHBOARD, 'all')
  const page = reportHtml(all, {
    session: 'cccccccc-3333',
    sessionId: 'cccccccc-3333',
    date: '2026-10-14',
    usage: USAGE,
    scope: 'all',
    folder: 'oracle',
    boomi: BOOMI,
    sessionBudgetUsd: 0.25,
    budgets: [{ label: 'month', level: 'warning', percent: 86, detail: '$43.10 of $50.00' }],
  }, NOW, 24 * HOUR)
  expect(page).toContain('<title>Companion Sessions Report</title>')
  // A title, then what happened in sentences: no tiles, no label above the heading.
  expect(page).toContain('<h1>Boomi_Me &lt;b&gt;</h1>')
  expect(page).toContain('4 sessions in <strong>oracle</strong> between Oct 11 and Oct 14 worked on <strong>3 components</strong> in 5 steps, 1 of which failed or was blocked.')
  expect(page).toContain('They cost <strong>at least $1.17</strong>, counting some sessions only up to their last Companion step, with 1 session not recorded.')
  expect(page).toContain('<span class="sr">Failed: </span>1 thing needs attention: Test of Broken Oracle ended ERROR</span>.')
  expect(page).toContain('<nav aria-label="Sections"><a href="#timeline">Sessions</a><a href="#attention">Attention</a><a href="#components">Components</a><a href="#steps">Steps</a></nav>')
  expect(page).not.toContain('class="tile')
  expect(page).not.toContain('eyebrow')
  // The timeline is the session index: no Sessions table, each session's band with its cost and, with a budget, how it stood.
  expect(page).not.toContain('<h2>Sessions')
  expect(page).toContain('<a class="tl-head" href="#s-cccccccc-3333" title="cccccccc-3333"><span class="tl-name">This session</span>')
  expect(page).toContain('<span class="tl-name">Earlier 1</span>')
  expect(page).toContain('at least $0.30 · <span class="status status-critical">')
  expect(page).toContain('“At least”: a session from before the dashboard recorded session IDs')
  // Budgets beside the summary: each one set as a meter, and how the sessions stood against the session budget.
  expect(page).toContain('<li class="meter meter-warning"><div class="meter-head"><span>Companion this month</span>')
  expect(page).toContain('2 sessions reached the <strong>$0.25</strong> session budget.')
  expect(page).toContain('2 of 3 sessions reached the $0.25 session budget')
  // The account, escaped, on one line, and no credentials.
  expect(page).toContain('<p class="account-line" id="account"><span class="label">Boomi account</span> <strong>Boomi_Me &lt;b&gt;</strong> · <code class="copy" data-copy="boomi_me-D1R00U" title="Copy">boomi_me-D1R00U</code>')
  // Components as swimlanes: Boomi's view, a link, and each stage in its column with the ID to find it by.
  expect(page).toContain('<h2>Components <span class="count">3</span> <span class="aside">2 saved · 1 deployed · 0 passing</span></h2>')
  expect(page).toContain('<div class="sub">process · Magic8Ball-RandomOracle</div><div class="sub">In Boomi now: Broken Oracle (demo)</div>')
  expect(page).toContain('href="https://platform.boomi.com/AtomSphere.html#build;accountId=boomi_me-D1R00U;components=cfdbd5f3-3802-4629-8abb-9bb27ab3c5e1"')
  expect(page).toContain('in Boomi v2 by me@example.com')
  expect(page).toContain('package <code class="copy" data-copy="9ed168df-6b76-4c26-8c06-6900e25f04df" title="Copy">')
  expect(page).toContain('<span class="sr">Failed: </span>test ERROR</span>')
  // Deploys and tests are a filter on the steps, and a failure says what went wrong without being opened.
  expect(page).not.toContain('Deployments and tests')
  expect(page).toContain('<button type="button" data-filter="kind:release" aria-pressed="false">Deploys &amp; tests</button>')
  expect(page).toContain('data-kind="release"')
  expect(page).toContain('<div class="why">status ERROR · execution <code class="copy" data-copy="execution-6fe84020-2026.10.13"')
  // One product: no product charts and no pipeline chart.
  expect(page).not.toContain('<h3>Outcomes by product</h3>')
  expect(page).not.toContain('Component pipeline')
  // One session's cost line doesn't span several.
  expect(page).not.toContain('<h3>Cost over the session</h3>')
})

test('a this-session report keeps its own steps and says where Boomi details are missing', () => {
  const page = reportHtml(scoped(DASHBOARD, 'session'), {
    session: 'cccccccc-3333',
    sessionId: 'cccccccc-3333',
    date: '2026-10-14',
    usage: USAGE,
    scope: 'session',
    boomi: { accountId: 'boomi_me-D1R00U', components: {}, note: "Boomi's current details for the components couldn't be read: HTTP 403" },
  }, NOW, 24 * HOUR)
  expect(page).toContain('<title>Companion Session Report</title>')
  expect(page).not.toContain('<h2>Sessions')
  expect(page).not.toContain('Random Oracle')
  expect(page).toContain('HTTP 403')
  expect(page).toContain('<dt>Version</dt><dd>v2</dd>')
  expect(page).toContain("<dt>Seen in</dt><dd>Claude's tool call</dd>")
})

// What Boomi's Platform API returned for these calls (October 14, 2026).
const METADATA = '{"@type":"QueryResult","result":[{"@type":"ComponentMetadata","componentId":"cfdbd5f3-3802-4629-8abb-9bb27ab3c5e1","version":2,"name":"Magic8Ball - Broken Oracle (dashboard issue demo)","type":"process","createdDate":"2026-10-13T17:12:55Z","createdBy":"me@example.com","modifiedDate":"2026-10-13T17:15:55Z","modifiedBy":"me@example.com","deleted":false,"currentVersion":true,"folderName":"Magic8Ball-RandomOracle","folderId":"Rjo4OTA0ODE3","branchName":"main","branchId":"Qjo3NTQ3NQ"}],"numberOfResults":1}'
const ACCOUNT = '{"@type":"Account","accountId":"boomi_me-D1R00U","name":"Boomi_Me","status":"active","dateCreated":"2022-04-21T22:31:01Z"}'

test("the Platform API client reads an account's name and its components' current details", async () => {
  const calls: { url: string; method?: string; body?: string }[] = []
  const client = platformClient(
    async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body as string | undefined })
      return { status: 200, ok: true, headers: {}, text: url.includes('/Account/') ? ACCOUNT : METADATA }
    },
    { apiUrl: 'https://api.boomi.com', username: 'u', apiToken: 't', accountId: 'boomi_me-D1R00U' },
  )
  expect(await client.accountName()).toBe('Boomi_Me')
  expect(calls[0]).toMatchObject({ url: 'https://api.boomi.com/api/rest/v1/boomi_me-D1R00U/Account/boomi_me-D1R00U', method: 'GET' })
  const found = await client.componentDetails(['cfdbd5f3-3802-4629-8abb-9bb27ab3c5e1', '1479b327-86fb-442f-91ee-a6ac8e7f1db2'])
  expect(found).toEqual([
    {
      componentId: 'cfdbd5f3-3802-4629-8abb-9bb27ab3c5e1',
      name: 'Magic8Ball - Broken Oracle (dashboard issue demo)',
      version: '2',
      type: 'process',
      folderName: 'Magic8Ball-RandomOracle',
      createdBy: 'me@example.com',
      createdDate: '2026-10-13T17:12:55Z',
      modifiedBy: 'me@example.com',
      modifiedDate: '2026-10-13T17:15:55Z',
      branchName: 'main',
    },
  ])
  const query = JSON.parse(calls[1]!.body!)
  expect(query.QueryFilter.expression.nestedExpression[0].operator).toBe('or')
  expect(await client.componentDetails([])).toEqual([])
})

test("steps from before sessions were named find theirs: a transcript's time in this folder, else a drop in the running cost", () => {
  const old = (id: number, at: number, usdAt?: number): Activity => step(id, { startedAt: at, isRestored: true, ...(usdAt === undefined ? {} : { usdAt }) })
  const steps = [old(1, NOW - 30 * HOUR, 0.1), old(2, NOW - 29 * HOUR, 0.5), old(3, NOW - 20 * HOUR, 0.05), old(4, NOW - 19 * HOUR, 0.2), old(5, NOW - 2 * HOUR, 0.3)]
  // Without a scan: a new session wherever the cost goes down.
  expect([...assignSessions(steps, 'now-id').values()]).toEqual(['earlier-1', 'earlier-1', 'earlier-2', 'earlier-2', 'earlier-2'])
  // With one: the transcript whose time covers a step in this folder claims it, with its exact cost.
  const past = [
    { id: 'tx-1', project: '/work/oracle', startedAt: new Date(NOW - 31 * HOUR).toISOString(), endedAt: new Date(NOW - 28 * HOUR).toISOString(), costUsd: 1.9, tokens: 0, cached: 0, models: [], runs: {}, components: [] },
    { id: 'tx-elsewhere', project: '/work/other', startedAt: new Date(NOW - 21 * HOUR).toISOString(), endedAt: new Date(NOW - 18 * HOUR).toISOString(), costUsd: 9, tokens: 0, cached: 0, models: [], runs: {}, components: [] },
  ]
  const ids = assignSessions(steps, 'now-id', past, '/work/oracle')
  expect([...ids.values()]).toEqual(['tx-1', 'tx-1', 'earlier-1', 'earlier-1', 'earlier-1'])
  const sessions = sessionSummaries(steps, 'now-id', 0.4, past, '/work/oracle')
  expect(sessions.map(s => [s.id, s.usd, s.usdIs])).toEqual([['earlier-1', 0.3, 'atLeast'], ['tx-1', 1.9, 'exact']])
  expect(sessionLabel('earlier-1')).toBe('Earlier session 1 (no ID recorded)')
})

test("the sessions' cost is what's known: never $0 for a cost that wasn't recorded", () => {
  expect(sessionsCost([])).toEqual({ isAtLeast: false, missing: 0 })
  const none = { id: 'earlier-1', isCurrent: false, firstAt: 0, lastAt: 0, steps: 71, failed: 7, components: 6 }
  expect(sessionsCost([none])).toEqual({ isAtLeast: false, missing: 1 })
  expect(sessionsCost([none, { ...none, id: 'x', usd: 0.5, usdIs: 'atLeast' }])).toEqual({ usd: 0.5, isAtLeast: true, missing: 1 })
})

test('a deploy, test or save recorded twice within minutes is one step, the one that says the most', () => {
  const twins: Activity[] = [
    step(1, { kind: 'deploy', subject: 'a component', detail: "SUCCESS: Deployed 'Oracle' (package: p-1)", startedAt: NOW }),
    step(2, { kind: 'deploy', subject: 'Oracle', file: 'active-development/process/Oracle.xml', detail: "SUCCESS: Deployed 'Oracle' (package: p-1)", startedAt: NOW + 1000 }),
    step(3, { kind: 'test', subject: 'a component', executionId: 'execution-1', detail: 'status COMPLETE', startedAt: NOW + 2000 }),
    step(4, { kind: 'test', subject: 'Oracle', executionId: 'execution-1', detail: 'status COMPLETE', startedAt: NOW + 2000 }),
    // The same package deployed again a day later is another step; so is a test with another execution.
    step(5, { kind: 'deploy', subject: 'Oracle', detail: "SUCCESS: Deployed 'Oracle' (package: p-1)", startedAt: NOW + 24 * HOUR }),
    step(6, { kind: 'test', subject: 'Oracle', executionId: 'execution-2', detail: 'status COMPLETE', startedAt: NOW + 2000 }),
  ]
  expect(withoutEchoes(twins).map(a => a.id)).toEqual([2, 4, 5, 6])
})

test("the steps still to match to a transcript: unnamed, brought back, and covered by no known session in this folder", () => {
  const unnamed = step(1, { startedAt: NOW - 3 * HOUR, isRestored: true })
  const named = step(2, { startedAt: NOW - 3 * HOUR, isRestored: true, session: 's-1' })
  const mine = step(3, { startedAt: NOW })
  expect(stepsToMatch([unnamed, named, mine], []).map(a => a.id)).toEqual([1])
  const covering = { id: 'tx', project: '/work', startedAt: new Date(NOW - 4 * HOUR).toISOString(), endedAt: new Date(NOW - 2 * HOUR).toISOString(), costUsd: 1, tokens: 0, cached: 0, models: [], runs: {}, components: [] }
  expect(stepsToMatch([unnamed], [covering], '/work')).toEqual([])
  expect(stepsToMatch([unnamed], [covering], '/elsewhere').map(a => a.id)).toEqual([1])
  expect(transcriptsFolder('/home/me/.claude', '/Users/me/boomi_brian-D1R00U')).toBe('/home/me/.claude/projects/-Users-me-boomi-brian-D1R00U')
})

test('the timeline: sessions oldest first on one strip, the idle time between them, each step a tick, and anything unhealthy marked with its icon', () => {
  const steps = [
    step(1, { kind: 'create', subject: 'A', startedAt: NOW - 30 * HOUR, session: 'one' }),
    step(2, { kind: 'test', outcome: 'failed', subject: 'A', executionId: 'e', detail: 'status ERROR', startedAt: NOW - 30 * HOUR + 600_000, session: 'one' }),
    step(3, { kind: 'push', subject: 'B', startedAt: NOW - HOUR, session: 'two' }),
  ]
  const strip = timeline(steps, a => a.session!, id => `Session ${id}`, new Map([['one', '$1.00']]))
  // Oldest first, with the gap between them in words.
  expect(strip.indexOf('Session one')).toBeLessThan(strip.indexOf('Session two'))
  expect(strip).toContain('<li class="tl-gap" aria-hidden="true"><span>28h 50m</span></li>')
  // Each band's heading goes to its session's steps; its foot says what it held.
  expect(strip).toContain('<a class="tl-head" href="#s-one" title="one">')
  expect(strip).toContain('<div class="tl-foot">2 steps · 1 not healthy · $1.00</div>')
  // Ticks are buttons a keyboard reaches, each naming and opening its step.
  expect(strip).toContain('data-step="2" aria-label="')
  // A failure is marked with its icon and named in its tooltip; a healthy tick carries no icon.
  expect(strip).toMatch(/<button type="button" class="tl-tick tick-critical" style="left:[\d.]+%" data-tip="[^"]*Failed: Test of A failed" data-step="2" aria-label="[^"]*"><svg class="i"/)
  expect(strip).toMatch(/<button type="button" class="tl-tick tick-healthy" style="left:[\d.]+%" data-tip="[^"]*" data-step="1" aria-label="[^"]*"><\/button>/)
  // Its data as a table too.
  expect(strip).toContain('<summary>Show the data</summary>')
  expect(timeline([], a => a.session!, id => id, new Map())).toBe('')
})

test("a session's budget: a meter and a warning in the summary near it, and how to set one when there's none", () => {
  const view = scoped(DASHBOARD, 'session')
  const base = { session: 'cccccccc-3333', sessionId: 'cccccccc-3333', date: '2026-10-14', scope: 'session' as const }
  const none = reportHtml(view, { ...base, usage: { usd: 0.4 }, budgets: [] }, NOW, 24 * HOUR)
  expect(none).toContain('No budget set. Set <code>budgetUsd</code> for each session')
  expect(none).not.toContain('class="meter')
  const near = reportHtml(view, { ...base, usage: { usd: 0.9, budgetUsd: 1 }, budgets: [{ label: 'session', level: 'warning', percent: 90, detail: '$0.90 of $1.00' }], sessionBudgetUsd: 1 }, NOW, 24 * HOUR)
  expect(near).toContain('<li class="meter meter-warning"><div class="meter-head"><span>Session</span><span class="status status-warning">')
  expect(near).toContain('<span style="width:90.0%"></span>')
  expect(near).toContain('It has cost <strong>$0.90</strong> so far <span class="status status-warning">')
  expect(near).toContain('90% of the $1.00 budget</span>')
  // The timeline's band says it too, with its icon.
  expect(near).toContain('$0.90 · <span class="status status-warning">')
})
