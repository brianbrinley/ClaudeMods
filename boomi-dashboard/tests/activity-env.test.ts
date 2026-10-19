import { expect, test } from 'claude-code/testing'

import { activityLogSetting, turnOffActivityLog, turnOnActivityLog, ACTIVITY_LOG_LINE } from '../hooks/activity-env'

const KEY = 'BOOMI_COMPANION_LOG_ACTIVITY'

test('the setting is absent, on or off as the file says', () => {
  expect(activityLogSetting('')).toBe('absent')
  expect(activityLogSetting('A=1\nB=2\n')).toBe('absent')
  expect(activityLogSetting(`${KEY}=1\n`)).toBe('on')
  expect(activityLogSetting(`export ${KEY}="1"\n`)).toBe('on')
  expect(activityLogSetting(`${KEY}=1\r\n`)).toBe('on')
  // Companion keeps the log only for exactly 1.
  expect(activityLogSetting(`${KEY}=true\n`)).toBe('off')
  expect(activityLogSetting(`${KEY}=0\n`)).toBe('off')
  expect(activityLogSetting(`# ${KEY}=1\n`)).toBe('absent')
})

test('turning it on appends one line and leaves every other byte alone', () => {
  const before = 'A=1\n# a comment\nB="two words"\n'
  expect(turnOnActivityLog(before)).toBe(`${before}${ACTIVITY_LOG_LINE}\n`)
})

test('turning it on adds the missing newline, and starts an empty file', () => {
  expect(turnOnActivityLog('A=1')).toBe(`A=1\n${ACTIVITY_LOG_LINE}\n`)
  expect(turnOnActivityLog('')).toBe(`${ACTIVITY_LOG_LINE}\n`)
})

test("turning it on keeps a file's CRLF line endings", () => {
  expect(turnOnActivityLog('A=1\r\nB=2\r\n')).toBe(`A=1\r\nB=2\r\n${ACTIVITY_LOG_LINE}\r\n`)
})

test('turning it on does nothing when it is already on', () => {
  expect(turnOnActivityLog(`A=1\n${KEY}=1\n`)).toBeUndefined()
})

test('turning it on flips an explicit off in place, once', () => {
  expect(turnOnActivityLog(`A=1\n${KEY}=0\nB=2\n`)).toBe(`A=1\n${ACTIVITY_LOG_LINE}\nB=2\n`)
})

test('turning it off removes only that line', () => {
  expect(turnOffActivityLog(`A=1\n${KEY}=1\nB=2\n`)).toBe('A=1\nB=2\n')
  expect(turnOffActivityLog(`A=1\r\n${KEY}=1\r\n`)).toBe('A=1\r\n')
  expect(turnOffActivityLog(`${KEY}=1`)).toBe('')
})

test('turning it off does nothing when the line is absent, and spares a comment', () => {
  expect(turnOffActivityLog('A=1\n')).toBeUndefined()
  expect(turnOffActivityLog(`# ${KEY}=1\nA=1\n`)).toBeUndefined()
})

test('turning it on then off gives back the original file', () => {
  const before = 'A=1\n# keep me\nB=2\n'
  const on = turnOnActivityLog(before)
  expect(on).toBeDefined()
  expect(turnOffActivityLog(on as string)).toBe(before)
})
