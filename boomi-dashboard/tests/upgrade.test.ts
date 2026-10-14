import { expect, test } from 'claude-code/testing'
import { asUpdateSeen, changelogBetween, checkText, compareVersions, isCheckDue, mask, parseUpgrade, pendingUpdate, planText, updateNotice } from '../hooks/upgrade'

const CHECK = [
  'ROOT: /home/me/ClaudeMods',
  'MOD: boomi-dashboard',
  'ORIGIN: https://github.com/brianbrinley/ClaudeMods.git',
  'BRANCH: main',
  'HEAD: aaaa',
  'DETACHED: no',
  'TARGET: bbbb',
  'INSTALLED: 0.21.0',
  'LATEST: 0.23.0',
  'BEHIND: 2',
  'AHEAD: 0',
  'DIRTY: 0',
  'MODS: boomi-dashboard boomi-runtime',
  'COMMIT: 1a2b3c4 boomi-dashboard 0.23.0: upgrade command',
  'COMMIT: 5d6e7f8 boomi-dashboard 0.22.0: report html',
  'FILE: M\tboomi-dashboard/hooks/register.tsx',
  'FILE: A\tboomi-dashboard/scripts/upgrade.sh',
  'CHANGELOG: # Changelog',
  'CHANGELOG: ',
  'CHANGELOG: ## 0.23.0',
  'CHANGELOG: ',
  'CHANGELOG: - /bc-dashboard upgrade',
  'CHANGELOG: ## 0.22.0',
  'CHANGELOG: - report html',
  'CHANGELOG: ## 0.21.0',
  'CHANGELOG: - connectors',
].join('\n')

test('compareVersions orders versions by number, not by text', () => {
  expect(compareVersions('0.21.0', '0.3.0')).toBe(1)
  expect(compareVersions('0.21.0', '0.21.0')).toBe(0)
  expect(compareVersions('0.9.9', '0.10.0')).toBe(-1)
  expect(compareVersions('1.0', '1.0.0')).toBe(0)
  expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1)
})

test("parseUpgrade reads the script's report", () => {
  const r = parseUpgrade(CHECK)
  expect(r).toMatchObject({ installed: '0.21.0', latest: '0.23.0', behind: 2, ahead: 0, dirty: 0, target: 'bbbb', isDetached: false })
  expect(r.mods).toEqual(['boomi-dashboard', 'boomi-runtime'])
  expect(r.commits).toEqual(['1a2b3c4 boomi-dashboard 0.23.0: upgrade command', '5d6e7f8 boomi-dashboard 0.22.0: report html'])
  expect(r.files).toEqual(['M\tboomi-dashboard/hooks/register.tsx', 'A\tboomi-dashboard/scripts/upgrade.sh'])
  expect(parseUpgrade('ERROR: no origin\n').error).toBe('no origin')
})

test('changelogBetween keeps the entries after the installed version, up to the latest', () => {
  const r = parseUpgrade(CHECK)
  expect(changelogBetween(r.changelog, '0.21.0', '0.23.0')).toEqual(['## 0.23.0', '- /bc-dashboard upgrade', '## 0.22.0', '- report html'])
  expect(changelogBetween(r.changelog, '0.23.0', '0.23.0')).toEqual([])
})

test('mask hides tokens, keys and auth headers', () => {
  expect(mask('glc_abcDEF123 sk-ant-xyz eyJhbGciOi.payload.sig')).toBe('glc_**** sk-**** eyJ****')
  expect(mask('Authorization: Bearer abc.def-123 and Basic dXNlcjpwYXNz')).toBe('Authorization: Bearer **** and Basic ****')
  expect(mask('nothing secret here')).toBe('nothing secret here')
})

test('checkText shows the delta, the commits, the files and the changelog, and says when up to date', () => {
  const text = checkText(parseUpgrade(CHECK))
  expect(text).toContain('boomi-dashboard 0.21.0 → 0.23.0: 2 commits behind origin/main')
  expect(text).toContain('Mods it would update (same checkout): boomi-dashboard, boomi-runtime')
  expect(text).toContain('  1a2b3c4 boomi-dashboard 0.23.0: upgrade command')
  expect(text).toContain('Changed files (2):')
  expect(text).toContain('- /bc-dashboard upgrade')
  const current = checkText(parseUpgrade(CHECK.replace('LATEST: 0.23.0', 'LATEST: 0.21.0').replace('BEHIND: 2', 'BEHIND: 0')))
  expect(current).toBe('✓ boomi-dashboard 0.21.0 is up to date with origin/main.')
})

test('planText warns before asking when the checkout would refuse', () => {
  expect(planText(parseUpgrade(CHECK.replace('DIRTY: 0', 'DIRTY: 3')))).toContain('✗ The checkout has uncommitted changes')
  expect(planText(parseUpgrade(CHECK.replace('AHEAD: 0', 'AHEAD: 1')))).toContain('✗ The checkout has commits that are not on origin/main')
  expect(planText(parseUpgrade(CHECK))).toBeUndefined()
})

test('isCheckDue waits the interval between checks, and never checks when off', () => {
  const day = 24 * 3_600_000
  expect(isCheckDue(undefined, 1_000, 24)).toBe(true)
  expect(isCheckDue(0, day - 1, 24)).toBe(false)
  expect(isCheckDue(0, day, 24)).toBe(true)
  expect(isCheckDue(0, day * 9, 0)).toBe(false)
})

test('updateNotice toasts each newer version once, keeps it for the footer, and forgets it once installed', () => {
  const first = updateNotice(undefined, '0.24.0', '0.25.0')
  expect(first).toEqual({ isToasting: true, seen: { latest: '0.25.0', announced: '0.25.0' } })
  // The next day's check finds the same version: no second toast, still kept.
  const again = updateNotice(first.seen, '0.24.0', '0.25.0')
  expect(again).toEqual({ isToasting: false, seen: { latest: '0.25.0', announced: '0.25.0' } })
  // A newer one is news again.
  expect(updateNotice(again.seen, '0.24.0', '0.26.0').isToasting).toBe(true)
  // Up to date: nothing to say or keep.
  expect(updateNotice(again.seen, '0.25.0', '0.25.0')).toEqual({ isToasting: false })

  expect(pendingUpdate(again.seen, '0.24.0')).toBe('0.25.0')
  expect(pendingUpdate(again.seen, '0.25.0')).toBeUndefined()
  expect(pendingUpdate(undefined, '0.24.0')).toBeUndefined()
  expect(asUpdateSeen({ latest: '0.25.0', announced: '0.25.0' })).toEqual({ latest: '0.25.0', announced: '0.25.0' })
  expect(asUpdateSeen(null)).toBeUndefined()
  expect(asUpdateSeen({ latest: 1 })).toBeUndefined()
})
