import { expect, test } from 'claude-code/testing'
import { loginNudge } from '../hooks/companion-user'

test('a Companion login that is your own login is flagged as yours', () => {
  expect(loginNudge('brian.brinley@boomi.com', 'Brian.Brinley@boomi.com')).toBe('your-login')
  expect(loginNudge('brian.brinley@boomi.com', '')).toBe('personal-looking')
})

test('a login that reads as a person is flagged, and a dedicated one is not', () => {
  expect(loginNudge('jane.doe@example.com', '')).toBe('personal-looking')
  expect(loginNudge('companion.ai@boomi.com', '')).toBeUndefined()
  expect(loginNudge('svc-integration@boomi.com', '')).toBeUndefined()
  expect(loginNudge('ai-companion-42@boomi.com', '')).toBeUndefined()
  expect(loginNudge('bcai@boomi.com', '')).toBeUndefined()
})

test('nothing to say when there is no username', () => {
  expect(loginNudge('', '')).toBeUndefined()
  expect(loginNudge('   ', 'brian@boomi.com')).toBeUndefined()
})
