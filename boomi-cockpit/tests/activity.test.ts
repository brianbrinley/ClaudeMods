import { expect, test } from 'claude-code/testing'

import {
  compareWatched,
  componentOf,
  newFailures,
  readOutput,
  scriptRuns,
  statusLine,
  summary,
  tiles,
} from '../hooks/activity'
import type { Activity, Cockpit } from '../types'

const ID = '1a2b3c4d-1111-2222-3333-444455556666'

const cockpit = (activity: Activity[] = [], extra: Partial<Cockpit> = {}): Cockpit => ({
  activity,
  platform: { phase: 'off', message: 'off: no credentials', runs: [] },
  watched: [],
  ...extra,
})

let nextId = 0
const act = (kind: Activity['kind'], outcome: Activity['outcome'], subject: string, more: Partial<Activity> = {}): Activity => ({
  id: ++nextId,
  kind,
  outcome,
  subject,
  detail: outcome,
  startedAt: 0,
  ...more,
})

test('scriptRuns finds the Companion scripts a command runs and what they name', () => {
  expect(
    scriptRuns(
      'cd work && bash scripts/boomi-component-push.sh active-development/processes/Orders.xml --branch dev && bash scripts/boomi-deploy.sh active-development/processes/Orders.xml --deployment-notes "first cut"',
    ),
  ).toEqual([
    { kind: 'push', file: 'active-development/processes/Orders.xml' },
    { kind: 'deploy', file: 'active-development/processes/Orders.xml' },
  ])
  expect(scriptRuns(`bash scripts/boomi-test-execute.sh --process-id ${ID} --test-data in.json`)).toEqual([
    { kind: 'test', processId: ID },
  ])
  expect(scriptRuns('bash scripts/boomi-undeploy.sh dep-123')).toEqual([{ kind: 'undeploy', deploymentId: 'dep-123' }])
  expect(scriptRuns('bash scripts/boomi-undeploy.sh --by-component a/b.xml')).toEqual([{ kind: 'undeploy', file: 'a/b.xml' }])
})

test('scriptRuns leaves out help, connection tests and other commands', () => {
  expect(scriptRuns('bash scripts/boomi-component-push.sh --test-connection')).toEqual([])
  expect(scriptRuns('bash scripts/boomi-deploy.sh --list-environments')).toEqual([])
  expect(scriptRuns('bash scripts/boomi-component-pull.sh --component-id x')).toEqual([])
  expect(scriptRuns('git status')).toEqual([])
})

test('readOutput reads a push with its new version', () => {
  const reading = readOutput(
    'push',
    "Pushing component 'Orders Sync' (x) to the account default branch\nSUCCESS: Pushed component 'Orders Sync' — now version 7",
    false,
  )
  expect(reading).toMatchObject({ outcome: 'ok', name: 'Orders Sync', version: '7' })
})

test('readOutput reads a create and its new ID', () => {
  const reading = readOutput('create', `SUCCESS: Component 'Orders API' created with ID: ${ID}`, false)
  expect(reading).toMatchObject({ outcome: 'ok', name: 'Orders API', componentId: ID })
})

test('readOutput counts an unchanged push as fine', () => {
  const reading = readOutput('push', "Component 'Orders' matches the last push to dev — nothing sent to the platform.", false)
  expect(reading.outcome).toBe('ok')
})

test('readOutput reads an error line and an exit code', () => {
  const failed = readOutput('deploy', 'ERROR: Deployment failed (HTTP 400): bad package', true)
  expect(failed).toMatchObject({ outcome: 'failed', detail: 'ERROR: Deployment failed (HTTP 400): bad package' })
  expect(readOutput('push', 'something went wrong', true).outcome).toBe('failed')
})

test("readOutput reads a test's execution status, and an ERROR status fails it", () => {
  const passed = readOutput('test', 'Execution completed: status=COMPLETE, executionId=execution-abc-123', false)
  expect(passed).toMatchObject({ outcome: 'ok', executionStatus: 'COMPLETE', executionId: 'execution-abc-123' })
  const failed = readOutput('test', 'Execution completed: status=ERROR, executionId=execution-abc-124', false)
  expect(failed).toMatchObject({ outcome: 'failed', executionStatus: 'ERROR', detail: 'status ERROR' })
})

test('a later success supersedes an earlier failure of the same component', () => {
  const state = cockpit([
    act('push', 'failed', 'Orders', { file: 'p/Orders.xml' }),
    act('push', 'ok', 'Orders', { file: 'p/Orders.xml' }),
  ])
  expect(statusLine(state)).toBe('Cockpit ✓ 1 built')
  expect(tiles(state)[0]).toMatchObject({ label: 'Builds', level: 'healthy' })
})

test('the status line puts failures first-class and adds the cost', () => {
  const state = cockpit([
    act('create', 'ok', 'A'),
    act('push', 'blocked', 'B'),
    act('test', 'failed', 'Orders Sync', { executionStatus: 'ERROR' }),
    act('deploy', 'ok', 'Orders Sync'),
  ])
  expect(statusLine(state, 1.837)).toBe('Cockpit ✓ 1 built · ✗ 1 build failed · ✗ 1 test failed · ✓ 1 deployed · $1.84')
  expect(statusLine(cockpit())).toBe('Cockpit no Companion activity yet')
})

test('the summary shows each area, the cost and the recent activity', () => {
  const text = summary(cockpit([act('deploy', 'failed', 'Orders Sync', { detail: 'ERROR: Deployment failed (HTTP 400)' })]), {
    usd: 0.5,
    contextPercent: 41.6,
  })
  expect(text).toContain('✗ Deploys')
  expect(text).toContain('$0.50 so far · context 42% full')
  expect(text).toContain('Orders Sync: ERROR: Deployment failed (HTTP 400)')
})

test('a watched component changed by someone else is flagged, a change of our own is not', () => {
  const before = { componentId: ID, name: 'Orders Sync', version: '3' }
  const theirs = compareWatched(before, { version: '4', modifiedBy: 'pat@example.com' }, 'me@example.com')
  expect(theirs.isNewChange).toBe(true)
  expect(theirs.next.changedBy).toBe('pat@example.com')
  const ours = compareWatched(before, { version: '4', modifiedBy: 'ME@example.com' }, 'me@example.com')
  expect(ours.isNewChange).toBe(false)
  const first = compareWatched({ componentId: ID }, { version: '3' }, 'me@example.com')
  expect(first.isNewChange).toBe(false)
  expect(first.next.version).toBe('3')
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

test('componentOf reads the root element, not nested references', () => {
  const xml = `<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="${ID}" name="Orders Sync" type="process"><bns:object><x componentId="other"/></bns:object></bns:Component>`
  expect(componentOf(xml)).toEqual({ componentId: ID, name: 'Orders Sync' })
  expect(componentOf('<bns:Component componentId="" name="New">').componentId).toBeUndefined()
})
