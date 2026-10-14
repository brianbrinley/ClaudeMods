import { expect, test } from 'claude-code/testing'
import type { Activity, Dashboard } from '../types'
import { boomiLink, hasEarlierSteps, packageOf, reportHtml, scoped, sessionSummaries } from '../hooks/report-html'
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
    ['earlier', 1, 0, 1, undefined, undefined],
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
    sessions: sessionSummaries(all.activity, 'cccccccc-3333', 0.75),
  }, NOW, 24 * HOUR)
  expect(page).toContain('<title>Companion Sessions Report</title>')
  expect(page).toContain('All sessions in oracle · 4 sessions')
  expect(page).toContain('<h2>Sessions <span class="count">4</span></h2>')
  expect(page).toContain('<code>cccccccc-3333</code> <span class="tag tag-1">this session</span>')
  expect(page).toContain('Earlier (before steps named their session)')
  expect(page).toContain('at least $0.30')
  // The account, escaped, and no credentials.
  expect(page).toContain('<dt>Account</dt><dd>Boomi_Me &lt;b&gt;</dd>')
  expect(page).toContain('<dt>Account ID</dt><dd><code>boomi_me-D1R00U</code></dd>')
  // Boomi's view of a component: type, folder, version, who changed it, its current name, a link.
  expect(page).toContain('<div class="sub">In Boomi now: Broken Oracle (demo)</div>')
  expect(page).toContain('<td>process</td><td>Magic8Ball-RandomOracle</td>')
  expect(page).toContain('href="https://platform.boomi.com/AtomSphere.html#build;accountId=boomi_me-D1R00U;components=cfdbd5f3-3802-4629-8abb-9bb27ab3c5e1"')
  expect(page).toContain('2026-10-13 17:15<div class="sub">me@example.com</div>')
  // Deployments and tests, with the IDs to find them by.
  expect(page).toContain('<h2>Deployments and tests <span class="count">2</span></h2>')
  expect(page).toContain('<span class="muted">package</span> <code>9ed168df-6b76-4c26-8c06-6900e25f04df</code>')
  expect(page).toContain('<span class="muted">execution</span> <code>execution-6fe84020-2026.10.13</code>')
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
