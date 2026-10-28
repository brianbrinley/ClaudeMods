import { expect, test } from 'claude-code/testing'
import type { PastSession } from '../types'
import { BACK, GROUPS, fieldNamed, groupNamed, groupWithValue, listing, menuQuestion, parseValue, pastSpend, questionFor, roundUp, show, valueOf } from '../hooks/config'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const past = (costUsd: number, daysAgo: number): PastSession =>
  ({ id: `s${costUsd}`, startedAt: new Date(NOW - daysAgo * 86_400_000).toISOString(), costUsd, tokens: 0, cached: 0, models: [], runs: {}, components: [] }) as PastSession
const BUDGET = GROUPS[0]!
const field = (key: string) => fieldNamed(key)!
const ENV = ['', 'env'].join('.')

// plugin.json's userConfig fields, as of 0.47.0: a new one goes into a group too.
const MANIFEST_KEYS = ['activityLog', 'activityLogPrompt', 'bandAnimation', 'banner', 'budgetEnforce', 'budgetGrace', 'budgetUsd', 'companionMonthlyUsd', 'companionShare', 'companionSharePeriod', 'componentsDir', 'envCheck', 'envFile', 'handoffNudge', 'historyDays', 'logo', 'paneColumns', 'paneRows', 'paneTheme', 'pollSeconds', 'promptCheck', 'promptModel', 'promptRewrite', 'promptSkip', 'promptSuggested', 'promptView', 'recentHours', 'reportOpen', 'reportStyle', 'seatBudgetUsd', 'suggestions', 'toasts', 'updateCheck', 'updateCheckHours', 'usageBreakdown']

test('every userConfig field is in one group, and every group fits the menu', () => {
  const keys = GROUPS.flatMap(g => g.fields.map(f => f.key))
  expect([...keys].sort()).toEqual(MANIFEST_KEYS)
  expect(GROUPS.length).toBeLessThanOrEqual(3)
  for (const g of GROUPS) expect(g.header.length).toBeLessThanOrEqual(8)
})

test('values read as a person says them', () => {
  expect(show(field('budgetUsd'), 0)).toBe('off')
  expect(show(field('budgetUsd'), 5)).toBe('$5.00')
  expect(show(field('paneRows'), 0)).toBe('Claude Code decides')
  expect(show(field('pollSeconds'), 300)).toBe('5 minutes')
  expect(show(field('updateCheckHours'), 168)).toBe('1 week')
  expect(show(field('toasts'), false)).toBe('off')
  expect(roundUp(0.9)).toBe(1)
  expect(roundUp(0.87)).toBe(1)
  expect(roundUp(4.1)).toBe(4.5)
  expect(roundUp(41)).toBe(45)
})

test('what past sessions cost: the typical one, the costliest, the last 30 days', () => {
  const spend = pastSpend([past(0.45, 2), past(0.87, 3), past(0.3, 40), { ...past(0, 1), costUsd: undefined }], NOW)
  expect(spend).toEqual({ sessions: 3, typical: 0.45, most: 0.87, last30: 1.32 })
  expect(pastSpend([], NOW)).toEqual({ sessions: 0 })
})

test('the session budget question offers figures from real spend, and keeps the current value first', () => {
  const spend = pastSpend([past(0.45, 2), past(0.87, 3), past(0.3, 4)], NOW)
  const q = questionFor(field('budgetUsd'), 0, spend, { index: 1, of: 4, group: BUDGET })
  // The costliest session also rounds to $1.00, so a round figure fills in.
  expect(q.options).toEqual(['Keep off', '$1.00 (twice a typical session)', '$5.00', BACK])
  expect(q.question).toContain('cost $0.45 typically, $0.87 at most')
  expect(q.header).toBe('Budget 1/4')
  expect(q.answer('Keep off')).toEqual({ kind: 'keep' })
  expect(q.answer('$1.00 (twice a typical session)')).toEqual({ kind: 'set', value: 1 })
  expect(q.answer(BACK)).toEqual({ kind: 'back' })
  // Typed under Other.
  expect(q.answer('$2.50')).toEqual({ kind: 'set', value: 2.5 })
  expect(q.answer('lots')).toEqual({ kind: 'unreadable', text: 'lots' })
  // With one set, Off is one pick away; with no history, round figures.
  const set = questionFor(field('budgetUsd'), 5, { sessions: 0 }, { index: 1, of: 4, group: BUDGET })
  expect(set.options).toEqual(['Keep $5.00', '$10', 'Off', BACK])
  expect(set.answer('Off')).toEqual({ kind: 'set', value: 0 })
})

test('the monthly amount offers figures from the last 30 days', () => {
  const q = questionFor(field('companionMonthlyUsd'), 0, pastSpend([past(12, 2), past(20, 5)], NOW), { index: 2, of: 4, group: BUDGET })
  expect(q.options).toEqual(['Keep off', '$40 (a quarter above the last 30 days)', '$65 (twice the last 30 days)', BACK])
  expect(q.question).toContain('Companion cost $32 over the last 30 days.')
})

test('toggles, choices and paths', () => {
  const pane = groupNamed('pane')!
  expect(questionFor(field('toasts'), true, { sessions: 0 }, { index: 1, of: 7, group: pane }).options).toEqual(['Keep on', 'Turn off', BACK])
  const theme = questionFor(field('paneTheme'), 'whimsical-dark', { sessions: 0 }, { index: 1, of: 7, group: pane })
  expect(theme.options).toEqual(['Keep whimsical-dark', 'Auto', 'Exosphere-light', BACK])
  expect(theme.answer('Auto')).toEqual({ kind: 'set', value: 'auto' })
  expect(theme.answer('whimsical-light')).toEqual({ kind: 'set', value: 'whimsical-light' })
  const logo = questionFor(field('logo'), true, { sessions: 0 }, { index: 7, of: 7, group: pane })
  expect(logo.options).toEqual(['Keep on', 'Turn off', BACK])
  expect(logo.answer('Turn off')).toEqual({ kind: 'set', value: false })
  const animation = questionFor(field('bandAnimation'), true, { sessions: 0 }, { index: 7, of: 7, group: pane })
  expect(animation.question).toContain('A change takes effect in your next session.')
  const env = questionFor(field('envFile'), `config/${ENV}`, { sessions: 0 }, { index: 8, of: 9, group: groupNamed('data')! })
  expect(env.options).toEqual([`Keep config/${ENV}`, `Back to ${ENV}`, BACK])
  expect(env.answer(`other/${ENV}`)).toEqual({ kind: 'set', value: `other/${ENV}` })
})

test('typed values are read, or refused with the reason', () => {
  expect(parseValue(field('budgetUsd'), '$7.5')).toEqual({ value: 7.5 })
  expect(parseValue(field('budgetUsd'), 'off')).toEqual({ value: 0 })
  expect(parseValue(field('companionShare'), '30%')).toEqual({ value: 30 })
  expect(parseValue(field('companionShare'), '130')).toEqual({ error: 'Companion’s share of your usage limit goes up to 100' })
  expect(parseValue(field('recentHours'), '0')).toEqual({ error: "Window for earlier steps can't be 0" })
  expect(parseValue(field('paneRows'), '14.6 rows')).toEqual({ value: 15 })
  expect(parseValue(field('toasts'), 'no')).toEqual({ value: false })
  expect(parseValue(field('companionSharePeriod'), 'Month')).toEqual({ value: 'month' })
  expect(parseValue(field('companionSharePeriod'), 'year')).toEqual({ error: 'Period for the share takes day, week, month' })
  expect(parseValue(field('budgetUsd'), '-3')).toHaveProperty('error')
})

test('the menu and the listing', () => {
  const values = Object.fromEntries(GROUPS.flatMap(g => g.fields.map(f => [f.key, f.default])))
  expect(menuQuestion(values, 0)).toEqual({ question: 'Which dashboard settings do you want to go through? No budget is set.', options: ['Budget', 'Pane and banner', 'Data and reports', 'Done'] })
  expect(menuQuestion({ ...values, budgetUsd: 5 }, 2).question).toContain('Budgets now: session budget $5.00. 2 changes so far, saved when you pick Done.')
  const list = listing({ ...values, budgetUsd: 5 })
  expect(list).toContain('  budgetUsd             $5.00\n')
  expect(list).toContain('  toasts                on  (default)')
  expect(list).toContain('/bc-dashboard config budgetUsd 5')
  expect(valueOf(field('budgetUsd'), '3')).toBe(3)
  expect(valueOf(field('paneTheme'), 'neon')).toBe('auto')
  expect(valueOf(field('paneTheme'), 'exosphere-dark')).toBe('exosphere-dark')
  expect(valueOf(field('logo'), 'nope')).toBe(true)
  expect(fieldNamed('BUDGETUSD')?.key).toBe('budgetUsd')
  expect(groupNamed('data')?.name).toBe('Data and reports')
  expect(groupNamed('Done')).toBeUndefined()
})

test('a group named with a value saves nothing and says which setting the value fits', () => {
  const budget = groupNamed('budget')!
  expect(groupWithValue(budget, 'warn')).toBe(
    'Budget is a group of settings, so "warn" wasn\'t saved. Did you mean /bc-dashboard config budgetEnforce warn? Run /bc-dashboard config budget on its own to go through the group a question at a time.',
  )
  expect(groupWithValue(budget, 'lots')).toBe(
    'Budget is a group of settings, so "lots" wasn\'t saved. Run /bc-dashboard config budget on its own to go through the group a question at a time.',
  )
})
