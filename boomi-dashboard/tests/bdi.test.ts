import { expect, test } from 'claude-code/testing'
import { bdiDiagnosis, bdiFailedStep, bdiReasonOf } from '../hooks/products'

// bdi-flow.sh logs answers in CSV, header timestamp,level,msg, newest first (bc-bdi 0.2.5, troubleshooting.md).
const LOG = [
  'timestamp,level,msg',
  '2026-10-14T09:12:07,ERROR,"Run failed: relation ""orders_stg"" does not exist"',
  '2026-10-14T09:12:06,WARNING,Retrying the load once',
  '2026-10-14T09:12:05,ERROR,"Loading orders_stg, batch 1: table not found"',
  '2026-10-14T09:12:01,INFO,Extracted 1200 rows from orders',
].join('\n')

test("a failed run's ERROR lines, oldest first, led by BDI's reason and the step that failed", () => {
  const found = bdiDiagnosis(LOG, 'Target table orders_stg does not exist', 'Step "load_orders" failed: table not found')
  expect(found).toEqual({
    lines: [
      'Failure: Target table orders_stg does not exist',
      'Step "load_orders" failed: table not found',
      '09:12:05 ERROR Loading orders_stg, batch 1: table not found',
      '09:12:07 ERROR Run failed: relation "orders_stg" does not exist',
    ],
    errors: 2,
    warnings: 1,
  })
})

test('a log with no errors shows its last lines; an empty one says where to look', () => {
  const quiet = bdiDiagnosis(['timestamp,level,msg', '2026-10-14T09:00:02,INFO,Done', '2026-10-14T09:00:01,INFO,Started'].join('\n'))
  expect(quiet.lines).toEqual(['09:00:01 INFO Started', '09:00:02 INFO Done'])
  expect(bdiDiagnosis('timestamp,level,msg\n', 'Run exceeded 3600 seconds').lines).toEqual([
    'Failure: Run exceeded 3600 seconds',
    "The run's log is empty: BDI kept no lines for it. Open the run in the BDI console for more.",
  ])
  // A JSON error body in place of the CSV isn't a log.
  expect(bdiDiagnosis('{"detail":"not found"}').lines).toHaveLength(1)
})

test("a logic flow's first failed step, read leniently; none for other flows", () => {
  const steps = JSON.stringify({
    items: [
      { step_name: 'extract', status: 'succeeded' },
      { step_name: 'aggregate_by_region', status: 'failed', error_message: 'division by zero' },
      { step_name: 'publish', status: 'failed', error_message: 'skipped after failure' },
    ],
  })
  expect(bdiFailedStep(steps)).toBe('Step "aggregate_by_region" failed: division by zero')
  expect(bdiFailedStep('[{"name":"sql_1","status":"FAILED"}]')).toBe('Step "sql_1" failed')
  expect(bdiFailedStep(JSON.stringify({ items: [{ step_name: 'a', status: 'succeeded' }] }))).toBeUndefined()
  expect(bdiFailedStep('{"detail":"Only logic flows have steps"}')).toBeUndefined()
  expect(bdiFailedStep('not json')).toBeUndefined()
})

test("the reason a failed run's step kept", () => {
  expect(bdiReasonOf('ERROR: Target table orders_stg does not exist (run r-77)')).toBe('Target table orders_stg does not exist')
  expect(bdiReasonOf('ERROR: the run failed (run r-77)')).toBeUndefined()
  expect(bdiReasonOf('run r-77: failed')).toBeUndefined()
})
