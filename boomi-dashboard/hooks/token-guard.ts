// The token guard: a nudge when the context fills, and a first refusal of a
// whole-file read of a large file. Plain functions: nothing here touches the
// engine.

/** offer does nothing but mention the guard now and then; suggest is the guard; off stays silent. */
export type TokenGuard = 'off' | 'offer' | 'suggest'

/** What the Read tool draws or pages rather than reading as text: a size says nothing about their tokens. */
const NOT_TEXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|heic|svg|pdf|ipynb)$/i

const fileName = (path: string) => path.split('/').pop() || path

export type ReadAsked = { path: string; size: number; limitKb: number; hasRange: boolean; isRetry: boolean }

/** Whether this read is the kind to refuse: all of a large text file, not yet asked for twice. */
export const isLargeRead = ({ path, size, limitKb, hasRange, isRetry }: ReadAsked): boolean =>
  limitKb > 0 && !hasRange && !isRetry && size > limitKb * 1024 && !NOT_TEXT.test(path)

/** What Claude hears, with the way through: the same read again goes ahead. */
export const largeReadDeny = (path: string, size: number): string =>
  `${fileName(path)} is ${Math.round(size / 1024)} KB, about ${Math.round(size / 4000)}K tokens if read whole. ` +
  'Search it with Grep, or read the part you need with offset and limit. ' +
  'If you do need all of it, make the same Read again and it will go through.'

/** What the person sees when a read is refused. */
export const largeReadToast = (path: string, size: number): string =>
  `◐ Asked Claude to read part of ${fileName(path)} (${Math.round(size / 1024)} KB), not all of it`

export const isContextFull = (percent: number | undefined, threshold: number): boolean =>
  threshold > 0 && percent !== undefined && percent >= threshold

/**
 * Whether to nudge after this turn, and whether a later turn may. One nudge
 * each time the context crosses the threshold: it comes back only after the
 * context has dropped below it, as a compaction or a /clear does.
 */
export const contextNudge = (percent: number | undefined, threshold: number, isArmed: boolean): { isNudging: boolean; isArmed: boolean } => {
  if (percent === undefined || threshold <= 0) return { isNudging: false, isArmed }
  if (percent < threshold) return { isNudging: false, isArmed: true }
  return { isNudging: isArmed, isArmed: false }
}

export const COMPACT_SUGGESTION = '/compact keep the current goal and the remaining steps'

export const contextToast = (percent: number): string =>
  `◐ Context ${Math.round(percent)}% full: /compact keeps what matters, /clear starts a new task clean`

/** The line under the pane's CONTEXT gauge once the context is past the threshold. */
export const CONTEXT_HINT = '/compact or /clear soon'

const TURN_ON = '/bc-dashboard config tokenGuard suggest'
const HIDE = 'tokenGuard off hides these'

/** The mentions a session may make, its first as it starts, and the least time between them. */
export const MAX_MENTIONS = 3
export const MENTION_GAP_MS = 30 * 60_000

export type Mentions = { count: number; lastAt?: number }

/** Whether another mention is due: under the session's limit, and long enough since the last. */
export const mayMention = (said: Mentions, now: number): boolean =>
  said.count < MAX_MENTIONS && (said.lastAt === undefined || now - said.lastAt >= MENTION_GAP_MS)

export const mentioned = (said: Mentions, now: number): Mentions => ({ count: said.count + 1, lastAt: now })

/** The mention as a session starts. */
export const startOffer = (): string =>
  `Optional: ${TURN_ON} warns as the context fills and steers Claude away from large whole-file reads. ${HIDE}`

/** The mention when Claude has just read all of a large file. */
export const largeReadOffer = (path: string, size: number): string =>
  `Claude read all of ${fileName(path)}, about ${Math.round(size / 4000)}K tokens. ${TURN_ON} can steer it to the part it needs. ${HIDE}`

/** The mention when the context has filled. */
export const contextOffer = (percent: number): string =>
  `Context ${Math.round(percent)}% full. ${TURN_ON} warns as it fills and offers /compact. ${HIDE}`
