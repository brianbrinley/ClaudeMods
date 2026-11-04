import { expect, test } from 'claude-code/testing'
import { MAX_MENTIONS, MENTION_GAP_MS, contextNudge, contextOffer, isContextFull, isLargeRead, largeReadDeny, largeReadOffer, mayMention, mentioned, startOffer } from '../hooks/token-guard'

const ASK = { path: '/work/Orders.xml', size: 100 * 1024, limitKb: 40, hasRange: false, isRetry: false }

test('all of a large text file is refused, the first time only', () => {
  expect(isLargeRead(ASK)).toBe(true)
  expect(isLargeRead({ ...ASK, isRetry: true })).toBe(false)
})

test('a range, a small file, a limit of 0 and files read as pictures or pages are left alone', () => {
  expect(isLargeRead({ ...ASK, hasRange: true })).toBe(false)
  expect(isLargeRead({ ...ASK, size: 40 * 1024 })).toBe(false)
  expect(isLargeRead({ ...ASK, limitKb: 0 })).toBe(false)
  for (const path of ['/a/b.png', '/a/b.JPG', '/a/b.pdf', '/a/b.ipynb']) expect(isLargeRead({ ...ASK, path })).toBe(false)
})

test('the refusal says how to read less and that the same read goes through', () => {
  const text = largeReadDeny(ASK.path, ASK.size)
  expect(text).toContain('Orders.xml is 100 KB')
  expect(text).toContain('offset and limit')
  expect(text).toContain('same Read again')
})

test('one nudge each time the context crosses the threshold', () => {
  expect(contextNudge(49, 50, true)).toEqual({ isNudging: false, isArmed: true })
  expect(contextNudge(50, 50, true)).toEqual({ isNudging: true, isArmed: false })
  expect(contextNudge(60, 50, false)).toEqual({ isNudging: false, isArmed: false })
  expect(contextNudge(20, 50, false)).toEqual({ isNudging: false, isArmed: true })
})

test('no reading and a threshold of 0 never nudge', () => {
  expect(contextNudge(undefined, 50, true).isNudging).toBe(false)
  expect(contextNudge(90, 0, true).isNudging).toBe(false)
  expect(isContextFull(90, 0)).toBe(false)
  expect(isContextFull(undefined, 50)).toBe(false)
  expect(isContextFull(50, 50)).toBe(true)
})

test('each mention says how to turn it on and how to hide it', () => {
  expect(largeReadOffer('/work/Orders.xml', 80_000)).toBe('Claude read all of Orders.xml, about 20K tokens. /bc-dashboard config tokenGuard suggest can steer it to the part it needs. tokenGuard off hides these')
  expect(contextOffer(55.4)).toBe('Context 55% full. /bc-dashboard config tokenGuard suggest warns as it fills and offers /compact. tokenGuard off hides these')
  expect(startOffer()).toContain('tokenGuard off hides these')
})

test('a mention is due with room left and long enough since the last', () => {
  expect(mayMention({ count: 0 }, 0)).toBe(true)
  expect(mayMention({ count: 1, lastAt: 0 }, MENTION_GAP_MS - 1)).toBe(false)
  expect(mayMention({ count: 1, lastAt: 0 }, MENTION_GAP_MS)).toBe(true)
  expect(mayMention({ count: MAX_MENTIONS, lastAt: 0 }, MENTION_GAP_MS * 10)).toBe(false)
  expect(mentioned({ count: 1, lastAt: 0 }, 5)).toEqual({ count: 2, lastAt: 5 })
})
