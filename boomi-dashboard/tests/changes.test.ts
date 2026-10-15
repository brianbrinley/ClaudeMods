import { expect, test } from 'claude-code/testing'
import type { Activity, Dashboard } from '../types'
import { changeLines, changeTable, isPlatformChange, overridesFor, resultOf } from '../hooks/changes'
import { reportHtml } from '../hooks/report-html'
import { report } from '../hooks/activity'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const MIN = 60_000

const step = (id: number, over: Partial<Activity>): Activity => ({ id, kind: 'push', outcome: 'ok', subject: 'X', detail: '', startedAt: NOW + id * MIN, session: 's-1', ...over })

const SPENT = "Companion's monthly amount ($17.00 of $10.00, 170%)"

// A session that edits and saves, deploys past a spent budget once, has a deploy refused, then allows the rest of the session.
const ACTIVITY: Activity[] = [
  step(1, { kind: 'edit', subject: 'Orders Sync', file: 'active-development/process/Orders Sync.xml' }),
  step(2, { kind: 'push', subject: 'Orders Sync', componentId: 'c-1', version: '4', detail: 'SUCCESS: Pushed' }),
  step(3, { kind: 'other', subject: 'Budget override', detail: `allowed once: deploy (Orders Sync), with ${SPENT} spent`, isBudgetOverride: true }),
  step(4, { kind: 'deploy', subject: 'Orders Sync', componentId: 'c-1', detail: "SUCCESS: Deployed 'Orders Sync' (package: p-9)" }),
  step(5, { kind: 'deploy', subject: 'Orders Sync', componentId: 'c-1', outcome: 'blocked', isBudgetBlocked: true, detail: `blocked by budget: ${SPENT}` }),
  step(6, { kind: 'other', subject: 'Budget override', detail: `allowed for the rest of the session, starting with: run a test execution, with ${SPENT} spent`, isBudgetOverride: true }),
  step(7, { kind: 'test', subject: 'Orders Sync', componentId: 'c-1', outcome: 'failed', executionStatus: 'ERROR', executionId: 'execution-1e5c' }),
  step(8, { kind: 'other', product: 'datahub', script: 'datahub-model', verb: 'pull', subject: 'Customer' }),
  step(9, { kind: 'other', product: 'bdi', script: 'bdi-flow', verb: 'cancel', subject: 'Orders ELT', ref: 'f-1' }),
  step(10, { kind: 'other', script: 'env-check', subject: 'Checked the environment' }),
  step(11, { kind: 'other', script: 'folder-create', subject: 'Created a folder' }),
]

test('platform changes: saves, deploys, tests, blocked tries and other plugins’ remote steps; never edits, pulls, checks or overrides', () => {
  expect(ACTIVITY.filter(isPlatformChange).map(a => a.id)).toEqual([2, 4, 5, 7, 9, 11])
  expect(isPlatformChange(step(12, { kind: 'push', recipe: 'Sample recipe' }))).toBe(false)
  expect(isPlatformChange(step(13, { kind: 'other', product: 'connectordev', script: 'connectordev-version', verb: 'validate' }))).toBe(false)
  expect(isPlatformChange(step(14, { kind: 'other', product: 'connectordev', script: 'connectordev-version', verb: 'upload' }))).toBe(true)
})

test('an override allowed once covers the next change that ran; one for the session covers every later one; a refused change takes none', () => {
  const by = overridesFor(ACTIVITY)
  expect(by.get(2)).toBeUndefined()
  expect(by.get(4)).toBe(`allowed once, with ${SPENT} spent`)
  expect(by.get(5)).toBeUndefined()
  expect(by.get(7)).toBe(`allowed for the session, with ${SPENT} spent`)
  expect(by.get(9)).toBe(`allowed for the session, with ${SPENT} spent`)
  // Another session's override doesn't carry over.
  expect(overridesFor([ACTIVITY[2]!, step(20, { kind: 'deploy', session: 's-2' })]).get(20)).toBeUndefined()
})

test('each result in words, a refused one saying it never ran', () => {
  expect(ACTIVITY.filter(isPlatformChange).map(resultOf)).toEqual(['done', 'done', 'blocked by budget, not run', 'error', 'done', 'done'])
  expect(resultOf(step(30, { kind: 'test', executionStatus: 'COMPLETE' }))).toBe('passed')
})

test('the change table for a spreadsheet: oldest first, with each change’s ID, reference and override', () => {
  const table = changeTable([...ACTIVITY].reverse())
  expect(table.header).toEqual(['When (UTC)', 'Product', 'Change', 'Component ID', 'Result', 'Reference', 'Budget override'])
  expect(table.rows.map(r => r[0])).toEqual(['2026-10-14 12:02', '2026-10-14 12:04', '2026-10-14 12:05', '2026-10-14 12:07', '2026-10-14 12:09', '2026-10-14 12:11'])
  expect(table.rows[0]!.slice(3, 6)).toEqual(['c-1', 'done', 'version 4'])
  expect(table.rows[1]!.slice(4)).toEqual(['done', 'package p-9', `allowed once, with ${SPENT} spent`])
  expect(table.rows[3]![5]).toBe('execution execution-1e5c')
  expect(table.rows[4]![1]).toBe('BDI')
})

test('the Markdown section is a table with each result’s icon and label, and is left out when nothing changed', () => {
  const lines = changeLines(ACTIVITY)
  expect(lines[0]).toBe('## Platform changes')
  expect(lines).toContain('| When (UTC) | Change | Result | Reference | Budget override |')
  expect(lines.some(l => l.includes('| ✓ done | package p-9 | allowed once, with'))).toBe(true)
  expect(lines.some(l => l.includes('| ⚠ blocked by budget, not run |'))).toBe(true)
  expect(lines.some(l => l.includes('| ✗ error | execution execution-1e5c |'))).toBe(true)
  expect(changeLines([ACTIVITY[0]!])).toEqual([])
})

test('the HTML report lists the changes with status labels, and copies or saves them like the components', () => {
  const dashboard: Dashboard = { activity: ACTIVITY, platform: { phase: 'off', message: '', runs: [] }, watched: [], earlier: [] }
  const page = reportHtml(dashboard, { session: 's-1', sessionId: 's-1', date: '2026-10-14', usage: { startedAt: NOW, usd: 1, tokens: 100 }, scope: 'session' }, NOW + 20 * MIN, 24 * 3_600_000)
  expect(page).toContain('<section id="changes"><h2>Platform changes <span class="count">6</span>')
  expect(page).toContain('<a href="#changes">Changes</a>')
  expect(page).toContain('<span class="sr">Blocked: </span>blocked by budget, not run')
  expect(page).toContain(`allowed once, with ${SPENT.replace(/'/g, '&#39;')} spent`)
  expect(page).toContain('data-source="change-export"')
  expect(page).toContain('<script type="application/json" id="change-export">')
  expect(page).toContain('boomi-changes-2026-10-14.csv')
  expect(page).toContain('data-source="component-export"')
})

test('the Markdown report places Platform changes after the budget overrides', () => {
  const dashboard: Dashboard = { activity: ACTIVITY, platform: { phase: 'off', message: '', runs: [] }, watched: [], earlier: [] }
  const text = report(dashboard, { session: 's-1', date: '2026-10-14', usage: { startedAt: NOW, usd: 1, tokens: 100 }, changes: changeLines(ACTIVITY) }, NOW + 20 * MIN, 24 * 3_600_000)
  expect(text.indexOf('## Budget overrides')).toBeGreaterThan(-1)
  expect(text.indexOf('## Platform changes')).toBeGreaterThan(text.indexOf('## Budget overrides'))
  expect(text.indexOf('## Spend')).toBeGreaterThan(text.indexOf('## Platform changes'))
})
