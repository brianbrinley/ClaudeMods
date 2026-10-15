// The monthly Claude budget over time: Claude Code reports only what's used
// now, so the dashboard keeps the last figure of each day and reads a pace
// from them. The budget resets at 00:00 UTC on the 1st (a Claude rate-limit
// event for this account said so: Oct 31, 8:00 PM EDT). Plain functions: the
// tests call them with dates.

const DAY = 86_400_000

/** The last figure read each day, in dollars, by local date (`2026-10-15`). */
export type SpendDays = Record<string, number>

/** Where the month's spend leads. */
export type SpendPace = {
  /** When the budget resets: 00:00 UTC on the 1st. */
  resetsAt: number
  /** What was spent today, when yesterday's figure or the month's start says what it began at. */
  todayUsd?: number
  /** The month's average per day so far. Needs a tenth of the month gone. */
  dailyUsd?: number
  /** Where that average leads by the reset. */
  projectedUsd?: number
  /** When the budget would be used up at that average, when it would be before the reset. */
  exhaustsAt?: number
}

export const monthStartUtc = (now: number): number => {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

export const nextResetUtc = (now: number): number => {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

/** A local date as `2026-10-15`: the person's day. */
export const dayKey = (at: number): string => {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The days with today's figure set, the oldest dropped past `keep`. */
export const recordDay = (days: SpendDays | undefined, now: number, usedUsd: number, keep = 45): SpendDays => {
  const all = { ...(days ?? {}), [dayKey(now)]: usedUsd }
  const keys = Object.keys(all).sort()
  for (const key of keys.slice(0, Math.max(0, keys.length - keep))) delete all[key]
  return all
}

/**
 * Today's spend, the month's daily average and where it leads. A figure from
 * before this month's start isn't a base for today, and the projection waits
 * for a tenth of the month so the first days don't project wildly.
 */
export const paceOf = (extra: { limitUsd: number; usedUsd: number }, days: SpendDays | undefined, now: number): SpendPace => {
  const start = monthStartUtc(now)
  const resetsAt = nextResetUtc(now)
  const elapsed = now - start
  const length = resetsAt - start
  const pace: SpendPace = { resetsAt }
  const today = dayKey(now)
  const first = dayKey(start)
  const previous = Object.keys(days ?? {})
    .filter(k => k < today && k >= first)
    .sort()
    .pop()
  const before = previous === undefined ? undefined : days![previous]
  if (before !== undefined && before <= extra.usedUsd) pace.todayUsd = extra.usedUsd - before
  // A figure above today's means the budget reset in between: all of today's is this month's.
  else if ((before !== undefined && before > extra.usedUsd) || (before === undefined && first === today)) pace.todayUsd = extra.usedUsd
  if (extra.usedUsd > 0 && elapsed >= length / 10) {
    pace.dailyUsd = (extra.usedUsd / elapsed) * DAY
    pace.projectedUsd = (extra.usedUsd / elapsed) * length
    if (pace.projectedUsd > extra.limitUsd && extra.usedUsd < extra.limitUsd) pace.exhaustsAt = now + ((extra.limitUsd - extra.usedUsd) / extra.usedUsd) * elapsed
  }
  return pace
}
