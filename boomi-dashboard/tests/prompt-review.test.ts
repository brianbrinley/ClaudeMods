import { expect, test } from 'claude-code/testing'
import { LESSONS, lessonText, recentTotals, reviewText, tallyWeek, weekOf } from '../hooks/prompt-check'
import type { PromptWeeks } from '../types'

const DAY = 86_400_000
const WED = Date.UTC(2026, 10, 18)

test('a week is named by its Monday, whatever day in it the time is', () => {
  const monday = weekOf(Date.UTC(2026, 10, 16))
  expect(weekOf(WED)).toBe(monday)
  expect(new Date(`${monday}T00:00:00Z`).getUTCDay()).toBe(1)
  expect(weekOf(Date.UTC(2026, 10, 22))).toBe(monday)
  expect(weekOf(Date.UTC(2026, 10, 23))).not.toBe(monday)
})

test('a checked prompt adds to this week: tips shown, tips fixed, upgrades used; only category counts are kept', () => {
  let weeks: PromptWeeks = {}
  weeks = tallyWeek(weeks, WED, { shown: ['environment', 'subject'], followed: [], used: [] })
  weeks = tallyWeek(weeks, WED, { shown: ['environment'], followed: ['subject'], used: ['environment'] })
  const week = weeks[weekOf(WED)]!
  expect(week.environment).toEqual({ seen: 2, followed: 0, used: 1 })
  expect(week.subject).toEqual({ seen: 1, followed: 1, used: 0 })
  expect(Object.keys(week).every(k => k in LESSONS)).toBe(true)
})

test('only the last eight weeks are kept', () => {
  let weeks: PromptWeeks = {}
  for (let i = 0; i < 10; i++) weeks = tallyWeek(weeks, WED + i * 7 * DAY, { shown: ['test'], followed: [], used: [] })
  expect(Object.keys(weeks)).toHaveLength(8)
  expect(Object.keys(weeks)).toContain(weekOf(WED + 9 * 7 * DAY))
  expect(Object.keys(weeks)).not.toContain(weekOf(WED))
})

test('the review counts the last four weeks only, most seen first', () => {
  let weeks: PromptWeeks = {}
  weeks = tallyWeek(weeks, WED - 6 * 7 * DAY, { shown: ['build'], followed: [], used: [] })
  for (let i = 0; i < 3; i++) weeks = tallyWeek(weeks, WED, { shown: ['environment'], followed: [], used: [] })
  weeks = tallyWeek(weeks, WED, { shown: ['subject'], followed: [], used: [] })
  const totals = recentTotals(weeks, WED)
  expect(totals.map(t => t.code)).toEqual(['environment', 'subject'])
  expect(totals[0]!.seen).toBe(3)
})

test('the review is two plain sentences, then the guidance date; deep adds each category with its numbers', () => {
  const weeks = tallyWeek({}, WED, { shown: ['environment', 'subject'], followed: ['subject'], used: ['environment'] })
  const short = reviewText(weeks, WED, '2026-11-16')
  expect(short).toContain('The most common gap: no environment named, then no component named.')
  expect(short).toContain('Only 2 tips counted so far, too few for a percentage.')
  expect(short).toContain("Anthropic's guidance was last read on 2026-11-16.")
  expect(short).not.toContain('By category')
  let many: PromptWeeks = {}
  for (let i = 0; i < 5; i++) many = tallyWeek(many, WED, { shown: ['environment'], followed: [], used: i === 0 ? ['environment'] : [] })
  const deep = reviewText(many, WED, null, true)
  expect(deep).toContain('By category:')
  expect(deep).toContain('[environment]: shown 5, no longer flagged in your next Boomi prompt 0%, upgrade used 20%')
  expect(deep).toContain("Anthropic's guidance hasn't been read yet")
})

test('a rate never passes 100%, even when a tip was fixed in a window it was not shown in', () => {
  let weeks: PromptWeeks = {}
  for (let i = 0; i < 5; i++) weeks = tallyWeek(weeks, WED, { shown: ['test'], followed: [], used: ['test'] })
  weeks = tallyWeek(weeks, WED, { shown: [], followed: ['test', 'test', 'test'], used: [] })
  const percents = [...reviewText(weeks, WED, null).matchAll(/(\d+)%/g)].map(m => Number(m[1]))
  expect(percents.length).toBeGreaterThan(0)
  expect(percents.every(n => n <= 100)).toBe(true)
})

test('with nothing counted, the review says so', () => {
  expect(reviewText({}, WED, 'not yet')).toBe('No Boomi prompt tips in the last four weeks, so there is nothing to review yet.')
})

test('every category has a lesson, and a lesson says what to do and how to say whether it helped', () => {
  for (const code of Object.keys(LESSONS) as (keyof typeof LESSONS)[]) {
    const text = lessonText(code, 'Anthropic docs')
    expect(text).toContain('Before:')
    expect(text).toContain('After:')
    expect(text).toContain(`/bc-dashboard prompt lesson good ${code}`)
    expect(text).toContain('Reference: Anthropic docs.')
  }
  expect(Object.keys(LESSONS)).toHaveLength(10)
})
