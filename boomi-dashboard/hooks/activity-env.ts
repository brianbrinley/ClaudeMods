// Turning Companion's activity log on or off in its .env: one line, touched
// and nothing else. These are plain functions on the file's text, so the
// caller reads and writes the file and nothing here can show or keep another
// line of it.

import { parseEnv } from './platform'

const KEY = 'BOOMI_COMPANION_LOG_ACTIVITY'

export const ACTIVITY_LOG_LINE = `${KEY}=1`

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/

/** A file's lines, each with its own line ending kept. */
const linesOf = (text: string): string[] => text.split(/(?<=\n)/).filter(line => line !== '')

const eolOf = (line: string): string => (line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : '')

const setsKey = (line: string): boolean => !/^\s*#/.test(line) && LINE.exec(line)?.[1] === KEY

/**
 * Whether the .env turns the log on, sets it to something that leaves it off, or
 * says nothing. Companion's scripts keep the log only for exactly `1`
 * (`boomi-common.sh`'s `log_activity`), so `true` is off.
 */
export const activityLogSetting = (text: string): 'on' | 'off' | 'absent' => {
  const value = parseEnv(text)[KEY]
  if (value === undefined) return 'absent'
  return value === '1' ? 'on' : 'off'
}

/**
 * The file's text with the log on, or `undefined` when it already is. Absent, the
 * line is appended (the file's line ending, and a newline added if the last line
 * lacked one); set to something else, that line is changed in place.
 */
export const turnOnActivityLog = (text: string): string | undefined => {
  const setting = activityLogSetting(text)
  if (setting === 'on') return undefined
  const lines = linesOf(text)
  if (setting === 'absent') {
    const eol = lines.some(line => line.endsWith('\r\n')) ? '\r\n' : '\n'
    const last = lines[lines.length - 1]
    const closed = last === undefined || eolOf(last) !== ''
    return `${text}${closed ? '' : eol}${ACTIVITY_LOG_LINE}${eol}`
  }
  let isChanged = false
  return lines
    .flatMap(line => {
      if (!setsKey(line)) return [line]
      if (isChanged) return []
      isChanged = true
      return [`${ACTIVITY_LOG_LINE}${eolOf(line)}`]
    })
    .join('')
}

/** The file's text without the line that sets the log, or `undefined` when none does. */
export const turnOffActivityLog = (text: string): string | undefined => {
  const lines = linesOf(text)
  if (!lines.some(setsKey)) return undefined
  return lines.filter(line => !setsKey(line)).join('')
}
