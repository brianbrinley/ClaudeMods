import { expect, test } from 'claude-code/testing'
import type { Activity, Dashboard } from '../types'
import { assignSessions, boomiLink, componentTable, hasEarlierSteps, packageOf, reportHtml, scoped, sessionLabel, sessionSummaries, sessionsCost, notDone, notSet, sessionLedger, stepsToMatch, transcriptsFolder, unavailable, workSentence } from '../hooks/report-html'
import { repaired, withoutEchoes } from '../hooks/activity'
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
  expect(page).toContain('<nav aria-label="Sections"><a href="#timeline">Sessions</a><a href="#attention">Attention</a><a href="#components">Components</a><a href="#charts">Charts</a><a href="#steps">Steps</a></nav>')
  expect(page).not.toContain('class="tile')
  // The navy band holds the title, the summary and the budget; the sessions follow on the page, first.
  expect(page.indexOf('<section id="timeline" class="first">')).toBeGreaterThan(page.indexOf('<main>'))
  // A chart per session: its cost (paler where counted only up to its last step), and how its steps went; a click opens its steps.
  expect(page).toContain('<h3>Cost by session</h3>')
  expect(page).toContain('a paler bar is counted only up to its last Companion step')
  expect(page).toContain('class="cat-1 at-least"')
  expect(page).toContain('<h3>Outcomes by session</h3>')
  expect(page).toContain('<a class="session-pick" href="#s-cccccccc-3333">')
  expect(page).not.toContain('eyebrow')
  // The timeline is the session index: no Sessions table, each session's band with its cost and, with a budget, how it stood.
  expect(page).not.toContain('<h2>Sessions')
  expect(page).toContain('<a class="ledger-link" href="#s-cccccccc-3333" title="cccccccc-3333">')
  expect(page).toContain('<span class="l-id">Earlier 1</span>')
  expect(page).toContain('at least $0.30<br><span class="l-budget"><span class="status status-critical">')
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
  // Without a scan: a new session wherever the cost goes down, or after two quiet hours.
  expect([...assignSessions(steps, 'now-id').values()]).toEqual(['earlier-1', 'earlier-1', 'earlier-2', 'earlier-2', 'earlier-3'])
  // With one: the transcript whose time covers a step in this folder claims it, with its exact cost.
  const past = [
    { id: 'tx-1', project: '/work/oracle', startedAt: new Date(NOW - 31 * HOUR).toISOString(), endedAt: new Date(NOW - 28 * HOUR).toISOString(), costUsd: 1.9, tokens: 0, cached: 0, models: [], runs: {}, components: [] },
    { id: 'tx-elsewhere', project: '/work/other', startedAt: new Date(NOW - 21 * HOUR).toISOString(), endedAt: new Date(NOW - 18 * HOUR).toISOString(), costUsd: 9, tokens: 0, cached: 0, models: [], runs: {}, components: [] },
  ]
  const ids = assignSessions(steps, 'now-id', past, '/work/oracle')
  expect([...ids.values()]).toEqual(['tx-1', 'tx-1', 'earlier-1', 'earlier-1', 'earlier-2'])
  const sessions = sessionSummaries(steps, 'now-id', 0.4, past, '/work/oracle')
  expect(sessions.map(s => [s.id, s.usd, s.usdIs])).toEqual([['earlier-2', 0.3, 'atLeast'], ['earlier-1', 0.2, 'atLeast'], ['tx-1', 1.9, 'exact']])
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

test('the session ledger: a row each, oldest first, saying when it ran, what it did in words, how its steps went and what it cost', () => {
  const steps = [
    step(1, { kind: 'create', subject: 'A', startedAt: NOW - 30 * HOUR, session: 'one' }),
    step(2, { kind: 'test', outcome: 'failed', subject: 'A', executionId: 'e', detail: 'status ERROR', startedAt: NOW - 30 * HOUR + 600_000, session: 'one' }),
    step(4, { kind: 'other', script: 'env-check', subject: 'the Boomi connection', startedAt: NOW - 30 * HOUR + 700_000, session: 'one' }),
    step(5, { kind: 'other', script: 'env-check', outcome: 'blocked', subject: 'the Boomi connection', startedAt: NOW - 30 * HOUR + 800_000, session: 'one' }),
    step(3, { kind: 'push', subject: 'B', version: '2', startedAt: NOW - HOUR, session: 'two' }),
  ]
  const ledger = sessionLedger(steps, a => a.session!, id => `Session ${id}`, new Map([['one', '$1.00']]))
  // Oldest first; each row links to its session's steps and shows its full ID on hover.
  expect(ledger.indexOf('Session one')).toBeLessThan(ledger.indexOf('Session two'))
  expect(ledger).toContain('<a class="ledger-link" href="#s-one" title="one">')
  // When it ran, and how long after the session before.
  expect(ledger).toContain('<strong>Mon, Oct 12</strong><span>18:54–19:07 UTC · 13m</span><span class="l-id">Session one</span>')
  expect(ledger).toContain('<span class="l-id">Session two · 28h 46m later</span>')
  // What it did, in words: each thing and what happened to it, a script that was stopped, and the housekeeping.
  expect(workSentence(steps.slice(0, 4))).toBe('<strong>A</strong>: created, tested (1 failed) · env-check blocked · and 1 housekeeping step')
  expect(workSentence([steps[2]!])).toBe('1 housekeeping step')
  // How its steps went, each count with its icon, and its cost; a cost not recorded says so.
  expect(ledger).toMatch(/<span class="status status-healthy"><svg[^]*?Healthy: <\/span>2<\/span>/)
  expect(ledger).toContain('<span class="sr">Failed: </span>1</span>')
  expect(ledger).toContain('<span class="l-cost">$1.00</span>')
  expect(ledger).toContain('<span class="l-cost"><span class="na" title="Claude Code&#39;s transcript for this session doesn&#39;t record a cost.">')
  expect(sessionLedger([], a => a.session!, id => id, new Map())).toBe('')
})

test("a session's budget: a meter and a warning in the summary near it, and how to set one when there's none", () => {
  const view = scoped(DASHBOARD, 'session')
  const base = { session: 'cccccccc-3333', sessionId: 'cccccccc-3333', date: '2026-10-14', scope: 'session' as const }
  const none = reportHtml(view, { ...base, usage: { usd: 0.4 }, budgets: [] }, NOW, 24 * HOUR)
  expect(none).toContain('No budget set</span> <span class="na-how">Run <code>/bc-dashboard config budget</code> to set one')
  expect(none).not.toContain('class="meter')
  const unmeasured = reportHtml(view, { ...base, usage: { usd: 0.4 }, budgets: [{ label: 'share', level: 'healthy', percent: 0, detail: 'this login reports no weekly limit', isUnmeasured: true }] }, NOW, 24 * HOUR)
  expect(unmeasured).toContain('<li class="meter meter-none"><div class="meter-head"><span>Companion&#39;s share (limit)</span><span class="na">not measured</span></div><div class="sub">this login reports no weekly limit')
  expect(unmeasured).not.toContain('meter meter-healthy')
  const near = reportHtml(view, { ...base, usage: { usd: 0.9, budgetUsd: 1 }, budgets: [{ label: 'session', level: 'warning', percent: 90, detail: '$0.90 of $1.00' }], sessionBudgetUsd: 1 }, NOW, 24 * HOUR)
  expect(near).toContain('<li class="meter meter-warning"><div class="meter-head"><span>Session</span><span class="status status-warning">')
  expect(near).toContain('<span style="width:90.0%"></span>')
  expect(near).toContain('It has cost <strong>$0.90</strong> so far <span class="status status-warning">')
  expect(near).toContain('90% of the $1.00 budget</span>')
  // The timeline's band says it too, with its icon.
  expect(near).toContain('$0.90<br><span class="l-budget"><span class="status status-warning">')
})

test('steps recorded by older versions read properly: a placeholder takes its component name, a test that took another line says it had none', () => {
  const fixed = repaired([
    step(1, { kind: 'create', subject: 'Oracle', componentId: 'c-1', startedAt: NOW }),
    step(2, { kind: 'test', subject: 'a component', componentId: 'c-1', executionStatus: 'COMPLETE', detail: 'status COMPLETE', startedAt: NOW }),
    step(3, { kind: 'test', outcome: 'ok', subject: 'Oracle', detail: "SUCCESS: Component 'Oracle' created with ID: c-1", startedAt: NOW }),
    step(4, { kind: 'test', subject: 'a component', detail: 'status COMPLETE', executionStatus: 'COMPLETE', startedAt: NOW }),
  ])
  expect(fixed.map(a => a.subject)).toEqual(['Oracle', 'Oracle', 'Oracle', 'a component'])
  expect(fixed[2]!.detail).toBe('no result of its own (it ran in a command with other scripts)')
})

test("what's missing says so, and why: not done, not available, or not set up", () => {
  expect(notDone('Not deployed in these sessions')).toBe('<span class="nd" title="Not deployed in these sessions">—<span class="sr"> Not deployed in these sessions</span></span>')
  expect(unavailable('name not available', "It wasn't <named>")).toContain('title="It wasn&#39;t &lt;named&gt;"><svg class="i"')
  expect(unavailable('name not available', 'why')).toContain('name not available<span class="sr">: why</span>')
  expect(notSet('No budget set', 'Set <code>budgetUsd</code>')).toContain('<span class="na-how">Set <code>budgetUsd</code></span>')

  const page = reportHtml(scoped({ ...DASHBOARD, activity: [
    step(1, { kind: 'deploy', subject: 'Orders', componentId: 'c-9', detail: 'SUCCESS: Deployed', startedAt: NOW - HOUR, session: 'cccccccc-3333' }),
    step(2, { kind: 'test', subject: 'a component', detail: 'status COMPLETE', executionStatus: 'COMPLETE', startedAt: NOW - HOUR, session: 'cccccccc-3333' }),
  ] }, 'session'), { session: 'cccccccc-3333', sessionId: 'cccccccc-3333', date: '2026-10-14', usage: USAGE, scope: 'session', boomi: { accountId: 'acct-1', components: {} } }, NOW, 24 * HOUR)
  // A component Boomi doesn't know, a deploy whose package wasn't named, stages that didn't happen.
  expect(page).toContain('not found in Boomi')
  expect(page).toContain('package ID not available')
  expect(page).toContain('title="Not saved in these sessions"')
  expect(page).toContain('title="Not tested in these sessions"')
  expect(page).toContain('type not available')
  // A step Companion didn't name; the account's name that couldn't be read; no environment set.
  expect(page).toContain('Test of a component passed</span> <span class="na"')
  expect(page).toContain('Boomi account</span> <span class="na" title="Boomi didn&#39;t return the account&#39;s name')
  expect(page).toContain('no environment')
  // With no credentials at all, the account line says how to set it up.
  const bare = reportHtml(scoped(DASHBOARD, 'session'), { session: 'c', sessionId: 'c', date: '2026-10-14', usage: USAGE, scope: 'session', boomi: { components: {}, note: "Boomi's own details aren't included: an API credential is missing" } }, NOW, 24 * HOUR)
  expect(bare).toContain('Not set up</span> <span class="na-how">Add the Platform API credentials')
})

test('a step that named a component but not its ID takes the one ID that name has', () => {
  const fixed = repaired([
    step(1, { kind: 'create', subject: 'Oracle', componentId: 'c-1' }),
    step(2, { kind: 'deploy', subject: 'Oracle' }),
    step(3, { kind: 'deploy', subject: 'Twin', componentId: 't-1' }),
    step(4, { kind: 'deploy', subject: 'Twin', componentId: 't-2' }),
    step(5, { kind: 'deploy', subject: 'Twin' }),
  ])
  expect(fixed[1]!.componentId).toBe('c-1')
  // Two components share the name: no guessing.
  expect(fixed[4]!.componentId).toBeUndefined()
})

test('the report in Exosphere by default, or in Valence (expressive): its fonts, its Day and Night tokens, status colors fixed', () => {
  const facts = { session: 'c', sessionId: 'c', date: '2026-10-14', usage: USAGE, scope: 'session' as const }
  const plain = reportHtml(scoped(DASHBOARD, 'session'), facts, NOW, 24 * HOUR)
  expect(plain).toContain('<html lang="en">')
  expect(plain).toContain('family=Poppins')
  expect(plain).not.toContain('data-style')
  const deco = reportHtml(scoped(DASHBOARD, 'session'), { ...facts, style: 'expressive' }, NOW, 24 * HOUR)
  expect(deco).toContain('<html lang="en" data-style="expressive">')
  expect(deco).toContain('family=Poiret+One&family=Josefin+Sans')
  expect(deco).not.toContain('family=Poppins')
  // Sand and Midnight Navy, from brand/tokens.json; Valence's fixed status colors.
  expect(deco).toContain('--exo-color-page:#FBF6EE')
  expect(deco).toContain('--exo-color-page:#161A2E')
  expect(deco).toContain('--exo-color-background-success-strong:#0CA30C')
  expect(deco).toContain('--exo-color-background-danger-strong:#D03B3B')
  expect(deco).toContain('.opening h1{font:400 clamp(2rem,4.4vw,3.25rem)/1.1 "Poiret One"')
})

test('the report prints: light whatever the screen shows, every session unfolded, a header and page numbers, no controls', () => {
  const facts = { session: 'c', sessionId: 'c', date: '2026-10-14', usage: USAGE, scope: 'all' as const, folder: 'oracle' }
  const page = reportHtml(scoped(DASHBOARD, 'all'), facts, NOW, 24 * HOUR)
  expect(page).toContain('<button type="button" class="print" data-print')
  const print = page.slice(page.indexOf('@media print{\n'))
  // The light theme's tokens, made to win over a dark choice.
  expect(print).toContain('--exo-color-font:#1f1f1f !important')
  expect(print).toContain('details.step-group::details-content{content-visibility:visible;display:block}')
  expect(print).toContain(".masthead nav,.theme,.print,.controls,details.data,.copy-hint,.screen-only,.export{display:none !important}")
  expect(print).toContain('a[href^="http"]::after{content:attr(href)')
  expect(page).toContain('@top-left{content:"oracle · Companion sessions · 2026-10-14"')
  expect(page).toContain('@bottom-right{content:"Page " counter(page) " of " counter(pages)')
  // The unfolding for browsers without ::details-content, folded back after.
  expect(page).toContain("window.addEventListener('beforeprint'")
  // Valence prints in its Day theme.
  const deco = reportHtml(scoped(DASHBOARD, 'all'), { ...facts, style: 'expressive' }, NOW, 24 * HOUR)
  expect(deco).toContain('--exo-color-page:#FBF6EE !important')
})

test("every component as a table to take elsewhere: IDs, Boomi's version and folder, the last deploy and test, cost, and its page", () => {
  const table = componentTable(scoped(DASHBOARD, 'all').activity, BOOMI)
  expect(table.header).toEqual(['Component', 'Type', 'Folder', 'Component ID', 'Version', 'Deploy', 'Deployed (UTC)', 'Package ID', 'Test', 'Tested (UTC)', 'Execution ID', 'Cost (USD)', 'Boomi link'])
  const oracle = table.rows.find(r => r[3] === 'cfdbd5f3-3802-4629-8abb-9bb27ab3c5e1')!
  expect(oracle[2]).toBe('Magic8Ball-RandomOracle')
  expect(oracle[4]).toBe('2')
  expect(oracle[12]).toBe(boomiLink('boomi_me-D1R00U', 'cfdbd5f3-3802-4629-8abb-9bb27ab3c5e1'))
  for (const row of table.rows) expect(row).toHaveLength(table.header.length)
  // The report carries it, ready for its Copy and Save buttons.
  const page = reportHtml(scoped(DASHBOARD, 'all'), { session: 'c', sessionId: 'c', date: '2026-10-14', usage: USAGE, scope: 'all', boomi: BOOMI }, NOW, 24 * HOUR)
  expect(page).toContain('<button type="button" data-export="tsv"')
  expect(page).toContain('<button type="button" data-export="download">Save as CSV</button>')
  const json = page.match(/<script type="application\/json" id="component-export">([^<]*)<\/script>/)![1]!
  const data = JSON.parse(json) as { tsv: string; csv: string; file: string; rows: number }
  expect(data.file).toBe('boomi-components-2026-10-14.csv')
  expect(data.rows).toBe(table.rows.length)
  expect(data.tsv.split('\n')[0]).toBe(table.header.join('\t'))
  // A name with a closing script tag can't end the data early.
  const tricky = reportHtml({ ...DASHBOARD, activity: [step(1, { kind: 'create', subject: '</script><b>x', componentId: 'c-9' })] }, { session: 'c', sessionId: 'c', date: '2026-10-14', usage: USAGE }, NOW, 24 * HOUR)
  expect(JSON.parse(tricky.match(/id="component-export">([^<]*)<\/script>/)![1]!).tsv).toContain('</script><b>x')
})

test('budget overrides the person granted are listed for the audit trail, and steps refused by the budget say so', () => {
  const page = reportHtml(scoped({ ...DASHBOARD, activity: [
    step(1, { kind: 'deploy', subject: 'Orders', outcome: 'blocked', detail: 'blocked by budget: the session budget ($5.20 of $5.00, 104%)', isBudgetBlocked: true }),
    step(2, { kind: 'other', subject: 'Budget override', outcome: 'ok', detail: 'allowed once: deploy (Orders.xml), with the session budget ($5.20 of $5.00, 104%) spent', isBudgetOverride: true }),
  ] }, 'session'), { session: 'c', sessionId: 'c', date: '2026-10-14', usage: USAGE, scope: 'session' }, NOW, 24 * HOUR)
  expect(page).toContain('<a href="#overrides">Overrides</a>')
  expect(page).toContain('<h2>Budget overrides <span class="count">1</span>')
  expect(page).toContain('allowed once: deploy (Orders.xml), with the session budget ($5.20 of $5.00, 104%) spent</li>')
  expect(page).toContain('Blocked by budget: deploy of Orders')
  // An override isn't housekeeping: it shows in the session's sentence.
  expect(workSentence([step(2, { kind: 'other', subject: 'Budget override', outcome: 'ok', detail: 'x', isBudgetOverride: true })])).toBe('<strong>Budget</strong>: override allowed')
})

test('one quiet theme button: a moon to go dark, a sun to come back, labelled for a screen reader', () => {
  const page = reportHtml(scoped(DASHBOARD, 'session'), { session: 'c', sessionId: 'c', date: '2026-10-14', usage: USAGE, scope: 'session' }, NOW, 24 * HOUR)
  expect(page).toContain('<button type="button" class="theme-toggle" data-theme-toggle aria-label="Switch to the dark theme" title="Dark theme"><svg class="moon"')
  expect(page).toContain('<svg class="sun"')
  expect(page).not.toContain('data-theme-pick')
  expect(page).toContain('.ex-theme-dark .theme-toggle .sun{display:block}')
})
