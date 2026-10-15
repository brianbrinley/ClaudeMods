import { expect, test } from 'claude-code/testing'
import { dayKey, monthStartUtc, nextResetUtc, paceOf, recordDay } from '../hooks/spend-history'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-15T20:00:00Z')

test('the budget resets at 00:00 UTC on the 1st: Oct 31, 8:00 PM EDT, as Claude Code and Claude Desktop say', () => {
  expect(nextResetUtc(NOW)).toBe(1793491200 * 1000)
  expect(new Date(nextResetUtc(NOW)).toISOString()).toBe('2026-11-01T00:00:00.000Z')
  expect(monthStartUtc(NOW)).toBe(Date.parse('2026-10-01T00:00:00Z'))
  // The last hour of the month is still this month's; the next is the new one's.
  expect(nextResetUtc(Date.parse('2026-10-31T23:59:00Z'))).toBe(Date.parse('2026-11-01T00:00:00Z'))
  expect(nextResetUtc(Date.parse('2026-11-01T00:00:00Z'))).toBe(Date.parse('2026-12-01T00:00:00Z'))
  expect(nextResetUtc(Date.parse('2026-12-31T23:00:00Z'))).toBe(Date.parse('2027-01-01T00:00:00Z'))
})

test('today is what was spent since yesterday’s last figure; the average and the projection come from the month so far', () => {
  const days = { [dayKey(NOW - DAY)]: 350.5 }
  const pace = paceOf({ limitUsd: 1100, usedUsd: 380.96 }, days, NOW)
  expect(Math.round(pace.todayUsd! * 100) / 100).toBe(30.46)
  expect(Math.round(pace.dailyUsd! * 100) / 100).toBe(25.68)
  expect(Math.round(pace.projectedUsd! * 10) / 10).toBe(796.2)
  expect(pace.exhaustsAt).toBeUndefined()
  expect(pace.resetsAt).toBe(nextResetUtc(NOW))
})

test('a pace that would pass the limit says when it runs out, before the reset', () => {
  const pace = paceOf({ limitUsd: 1100, usedUsd: 900 }, {}, NOW)
  expect(pace.projectedUsd).toBeGreaterThan(1100)
  expect(pace.exhaustsAt).toBeGreaterThan(NOW)
  expect(pace.exhaustsAt).toBeLessThan(pace.resetsAt)
  // Already used up: no time left to project.
  expect(paceOf({ limitUsd: 1100, usedUsd: 1100 }, {}, NOW).exhaustsAt).toBeUndefined()
})

test('the first days of a month project nothing, and a reset between readings starts today from zero', () => {
  expect(paceOf({ limitUsd: 1100, usedUsd: 380.96 }, undefined, Date.parse('2026-10-02T12:00:00Z'))).toEqual({ resetsAt: nextResetUtc(NOW) })
  // Yesterday's figure was last month's, higher than today's: the budget reset in between.
  const first = Date.parse('2026-10-01T12:00:00Z')
  expect(paceOf({ limitUsd: 1100, usedUsd: 12 }, { [dayKey(first - DAY)]: 1000 }, first).todayUsd).toBe(12)
  // Nothing spent yet this month: no average, no projection.
  expect(paceOf({ limitUsd: 1100, usedUsd: 0 }, {}, NOW).projectedUsd).toBeUndefined()
})

test('each day keeps its last figure, and a month and a half of days are kept', () => {
  const full = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`2026-08-${String(i + 1).padStart(2, '0')}`, i]))
  const days = recordDay(full, NOW, 5)
  expect(Object.keys(days)).toHaveLength(45)
  expect(days[dayKey(NOW)]).toBe(5)
  expect(recordDay(days, NOW, 7)[dayKey(NOW)]).toBe(7)
  expect(recordDay(undefined, NOW, 3)).toEqual({ [dayKey(NOW)]: 3 })
})
