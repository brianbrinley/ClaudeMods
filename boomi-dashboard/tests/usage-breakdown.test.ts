import { expect, test } from 'claude-code/testing'
import { budgetLines } from '../hooks/activity'
import { companionUseLine, extraOf, parseUsage, topHabit, usageArgv } from '../hooks/usage-breakdown'

// The shape of `claude -p "/usage" --output-format json` on a subscription, as of Claude Code 2.1.300, with made-up figures.
const RESULT = [
  'You are currently using your subscription to power your Claude Code usage',
  '',
  "What's contributing to your limits usage?",
  'Approximate, based on local sessions on this machine — does not include other devices or claude.ai. Behaviors are independent characteristics, not a breakdown.',
  '',
  'Last 24h · 140 requests · 11 sessions',
  '  50% of your usage went to always-on context over 40k tokens',
  '  33% of your usage was at >150k context',
  '  Top skills: /docx 22%, /bc-integration:boomi-integration 20%, /superpowers:brainstorming 2%',
  '  Top plugins: bc-integration 20%, app-connections 6%, superpowers 2%',
  '',
  'Last 7d · 1,150 requests · 60 sessions',
  '  44% of your usage was at >150k context',
  '  10% of your usage came from subagent-heavy sessions',
  '  Top plugins: bc-integration 18%, bc-datahub 3%, app-connections 1%',
].join('\n')
const OUTPUT = JSON.stringify({ type: 'result', subtype: 'success', local_command: 'usage', total_cost_usd: 0, result: RESULT })

const SETTINGS = { budgetUsd: 0, companionShare: 0, companionSharePeriod: 'week' as const, companionMonthlyUsd: 0 }

test('the /usage breakdown: Companion’s share is the bc-* plugins added up, per window, with the habits that drove the usage', () => {
  const b = parseUsage(OUTPUT)!
  expect(b.isSubscription).toBe(true)
  expect(b.day).toEqual({
    companion: 20,
    plugins: [{ name: 'bc-integration', percent: 20 }, { name: 'app-connections', percent: 6 }, { name: 'superpowers', percent: 2 }],
    habits: [{ percent: 50, text: 'went to always-on context over 40k tokens' }, { percent: 33, text: 'was at >150k context' }],
    requests: 140,
    sessions: 11,
  })
  expect(b.week?.companion).toBe(21)
  expect(b.week?.requests).toBe(1150)
  expect(companionUseLine(b)).toBe('≥20% of your usage today · ≥21% this week')
  expect(topHabit(b)).toBe('44% of your usage was at >150k context')
  // The plain text reads the same as the JSON.
  expect(parseUsage(RESULT)?.week?.companion).toBe(21)
})

test('off a subscription, or with no plugin lines, there is nothing to show rather than a guess', () => {
  expect(parseUsage(JSON.stringify({ result: 'Total cost:            $0.0000\nUsage:                 0 input, 0 output' }))).toBeUndefined()
  expect(parseUsage('not json at all')).toBeUndefined()
  const noPlugins = parseUsage('Last 24h · 3 requests · 1 sessions\n  Top skills: /docx 100%')!
  expect(noPlugins.day?.companion).toBeUndefined()
  expect(companionUseLine(noPlugins)).toBeUndefined()
  expect(companionUseLine(null)).toBeUndefined()
})

test('your Claude budget: in dollars from a spend limit, said plainly when the login reports none; Companion’s share beside it', () => {
  const spend = budgetLines({ limits: [{ kind: 'spend_limit', percentUsed: 42 }] }, { ...SETTINGS, seatBudgetUsd: 200 })
  expect(spend).toEqual([{ label: 'Claude budget', level: 'healthy', percent: 42, detail: '$84 of $200' }])
  expect(budgetLines({ limits: [{ kind: 'spend_limit', percentUsed: 85 }] }, { ...SETTINGS, seatBudgetUsd: 200 })[0]!.level).toBe('warning')
  expect(budgetLines({}, { ...SETTINGS, seatBudgetUsd: 200 })).toEqual([
    { label: 'Claude budget', level: 'healthy', percent: 0, detail: "$200 set; this login doesn't report how much of it is used", isUnmeasured: true },
  ])
  expect(budgetLines({ companionUse: '20% of your usage today' }, SETTINGS)).toEqual([
    { label: 'Companion', level: 'healthy', percent: 0, detail: "20% of your usage today (Claude Code's estimate, this machine)", isUnmeasured: true },
  ])
  expect(budgetLines({}, SETTINGS)).toEqual([])
})

test('reworded output: windows with nothing understood say so, instead of showing nothing', () => {
  const reworded = JSON.stringify({ result: 'You are currently using your subscription\n\nLast 24h\n  most went to bc-integration (20 percent)\n\nLast 7d\n  mostly long contexts' })
  const b = parseUsage(reworded)!
  expect(b.isUnreadable).toBe(true)
  expect(companionUseLine(b)).toBeUndefined()
  expect(parseUsage(OUTPUT)!.isUnreadable).toBeUndefined()
  const lines = budgetLines({ isUsageUnreadable: true } as never, SETTINGS)
  expect(lines.some(l => /couldn't read Claude Code's \/usage/.test(l.detail))).toBe(true)
})

test('a share is a lower bound: Claude Code lists only its top plugins', () => {
  expect(companionUseLine(parseUsage(OUTPUT))).toContain('≥')
})

// The shape of `--output-format stream-json --verbose` for /usage, as of Claude Code 2.1.300: amounts in cents.
const REPORT = { session: { total_cost_usd: 0 }, rate_limits: { limits: [], extra_usage: { is_enabled: true, monthly_limit: 110000, used_credits: 38004, utilization: 34.54909090909091, currency: 'USD' } } }
const STREAM = [
  { type: 'system', subtype: 'init' },
  { type: 'assistant', usage_report: REPORT },
  { type: 'result', subtype: 'success', result: RESULT },
].map(l => JSON.stringify(l)).join('\n')

test('the monthly budget in dollars: extra_usage in cents, from the stream or alone, with the text read as before', () => {
  const b = parseUsage(STREAM)!
  expect(b.extra).toEqual({ limitUsd: 1100, usedUsd: 380.04, percent: 34.54909090909091 })
  expect(b.week?.companion).toBe(21)
  expect(usageArgv(true)).toContain('stream-json')
  expect(usageArgv(true)).toContain('--verbose')
  // The report alone is enough, where the text has no windows.
  expect(parseUsage(JSON.stringify({ type: 'assistant', usage_report: REPORT }))?.extra?.limitUsd).toBe(1100)
  // The single-result shape still reads.
  expect(parseUsage(OUTPUT)!.extra).toBeUndefined()
})

test('extra_usage that is off, not in dollars, without a limit or malformed is left out, never guessed', () => {
  const x = (o: Record<string, unknown>) => ({ rate_limits: { extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 100, currency: 'USD', ...o } } })
  expect(extraOf(x({}))).toEqual({ limitUsd: 50, usedUsd: 1, percent: 2 })
  expect(extraOf(x({ is_enabled: false }))).toBeUndefined()
  expect(extraOf(x({ currency: 'EUR' }))).toBeUndefined()
  expect(extraOf(x({ monthly_limit: 0 }))).toBeUndefined()
  expect(extraOf(x({ monthly_limit: 'lots' }))).toBeUndefined()
  expect(extraOf(x({ used_credits: -5 }))).toBeUndefined()
  expect(extraOf({})).toBeUndefined()
  expect(extraOf(undefined)).toBeUndefined()
})

test('BUDGET shows the monthly budget in dollars, measured, ahead of the seat setting, and a spent one counts', () => {
  const extra = { limitUsd: 1100, usedUsd: 380.04, percent: 34.5 }
  const lines = budgetLines({ extraUsage: extra } as never, { ...SETTINGS, seatBudgetUsd: 200 })
  expect(lines).toEqual([{ label: 'Claude budget', level: 'healthy', percent: 34.5, detail: '$380 of $1100 this month' }])
  const spent = budgetLines({ extraUsage: { limitUsd: 1100, usedUsd: 1100, percent: 100 } } as never, SETTINGS)
  expect(spent[0]).toMatchObject({ level: 'critical', percent: 100 })
  expect(budgetLines({ extraUsage: { limitUsd: 1100, usedUsd: 900, percent: 82 } } as never, SETTINGS)[0]!.level).toBe('warning')
})
