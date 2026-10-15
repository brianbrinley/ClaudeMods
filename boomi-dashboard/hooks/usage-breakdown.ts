// What `claude -p "/usage" --output-format json` says about what used the
// person's limits: Claude Code's own estimate, from this machine's sessions.
// Its text is written for people, so it's read leniently, and a line that
// doesn't match is left out rather than guessed. Plain functions: the tests
// call them with real output.

/** One window of the breakdown: the last 24 hours or the last 7 days. */
export type UsageWindow = {
  /** Companion's share of the usage: the bc-* plugins' percentages added up. */
  companion?: number
  /** Each plugin's share, as listed (`Top plugins:`). */
  plugins: { name: string; percent: number }[]
  /** What drove the usage: `44% of your usage was at >150k context`. */
  habits: { percent: number; text: string }[]
  requests?: number
  sessions?: number
}

export type UsageBreakdown = {
  day?: UsageWindow
  week?: UsageWindow
  isSubscription: boolean
  /** The windows are there but nothing in them was understood: Claude Code probably reworded its output. */
  isUnreadable?: true
}

/** `name 20%, other 6%` as pairs; an item that isn't one is skipped. */
const percents = (list: string): { name: string; percent: number }[] =>
  list
    .split(/,\s*/)
    .map(item => item.trim().match(/^(.+?)\s+(\d+(?:\.\d+)?)%$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => ({ name: m[1]!.trim(), percent: Number(m[2]) }))

const windowOf = (block: string): UsageWindow => {
  const head = block.split('\n')[0] ?? ''
  const plugins = percents(block.match(/^\s*Top plugins:\s*(.+)$/m)?.[1] ?? '')
  const companion = plugins.filter(p => p.name.startsWith('bc-')).reduce((n, p) => n + p.percent, 0)
  const habits = [...block.matchAll(/^\s*(\d+(?:\.\d+)?)% of your usage (.+)$/gm)].map(m => ({ percent: Number(m[1]), text: m[2]!.trim() }))
  const requests = head.match(/(\d[\d,]*) requests?/)?.[1]
  const sessions = head.match(/(\d[\d,]*) sessions?/)?.[1]
  return {
    plugins,
    habits,
    ...(plugins.length > 0 ? { companion } : {}),
    ...(requests ? { requests: Number(requests.replace(/,/g, '')) } : {}),
    ...(sessions ? { sessions: Number(sessions.replace(/,/g, '')) } : {}),
  }
}

/**
 * The breakdown from the command's output: its JSON `result`, or the text
 * itself. Undefined when it has no window to read, such as off a
 * subscription, where /usage gives only the session's totals.
 */
export const parseUsage = (stdout: string): UsageBreakdown | undefined => {
  let text = stdout
  try {
    const json = JSON.parse(stdout) as { result?: unknown }
    if (typeof json.result === 'string') text = json.result
  } catch {}
  const blocks = text.split(/^(?=Last (?:24h|7d)\b)/m)
  const find = (label: string) => blocks.find(b => b.startsWith(`Last ${label}`))
  const day = find('24h')
  const week = find('7d')
  if (!day && !week) return undefined
  const dayOf = day ? windowOf(day) : undefined
  const weekOf = week ? windowOf(week) : undefined
  const isUnderstood = [dayOf, weekOf].some(w => w && (w.plugins.length > 0 || w.habits.length > 0 || w.requests !== undefined))
  return {
    isSubscription: /using your subscription/i.test(text),
    ...(dayOf ? { day: dayOf } : {}),
    ...(weekOf ? { week: weekOf } : {}),
    ...(isUnderstood ? {} : { isUnreadable: true as const }),
  }
}

/** The habit behind most of the week's usage (else the day's), in a line: "44% of your usage was at >150k context". */
export const topHabit = (b: UsageBreakdown | null | undefined): string | undefined => {
  const top = [...(b?.week?.habits ?? b?.day?.habits ?? [])].sort((x, y) => y.percent - x.percent)[0]
  return top ? `${top.percent}% of your usage ${top.text}` : undefined
}

/**
 * Companion's share in a line: "≥20% of your usage today · ≥18% this week". Undefined without either.
 * Claude Code lists only its top plugins, so a share is a lower bound.
 */
export const companionUseLine = (b: UsageBreakdown | null | undefined): string | undefined => {
  const parts = [
    b?.day?.companion !== undefined ? `≥${Math.round(b.day.companion)}% of your usage today` : '',
    b?.week?.companion !== undefined ? `≥${Math.round(b.week.companion)}% this week` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * The headless run that prints the breakdown. `--safe-mode` leaves out the
 * person's hooks, plugins and MCP servers (this one included), which a
 * `/usage` run doesn't need: the same text in about half the time, with no
 * SessionStart hook run every quarter of an hour. Without it, for a Claude
 * Code that doesn't know the flag.
 */
export const usageArgv = (isSafe: boolean): string[] => ['claude', '-p', '/usage', '--output-format', 'json', '--no-session-persistence', ...(isSafe ? ['--safe-mode'] : [])]

/** Whether a reading from `checkedAt` is still good at `now`: another session on this machine may have taken it. */
export const isFresh = (checkedAt: number | undefined, now: number, ms: number): boolean => checkedAt !== undefined && now >= checkedAt && now - checkedAt < ms
