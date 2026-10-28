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

test('a Companion login that is the Claude account email is flagged, whatever the case', () => {
  expect(loginNudge('brian.brinley@boomi.com', '', 'Brian.Brinley@Boomi.com')).toBe('same-as-claude-account')
  expect(loginNudge('companion.ai@boomi.com', '', 'companion.ai@boomi.com')).toBe('same-as-claude-account')
})

test('the Claude account match is not flagged for a different login, or with no Claude email', () => {
  expect(loginNudge('companion.ai@boomi.com', '', 'brian.brinley@boomi.com')).toBeUndefined()
  expect(loginNudge('brian.brinley@boomi.com', '', '')).toBe('personal-looking')
  expect(loginNudge('brian.brinley@boomi.com', 'brian.brinley@boomi.com', '')).toBe('your-login')
})

test('nothing to say when there is no username', () => {
  expect(loginNudge('', '')).toBeUndefined()
  expect(loginNudge('   ', 'brian@boomi.com')).toBeUndefined()
})
