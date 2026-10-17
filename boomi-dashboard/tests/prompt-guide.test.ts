import { expect, test } from 'claude-code/testing'
import { GUIDE, GUIDE_STAMP, REFRESH_SYSTEM, driftNote, guideFor, guideLine, guideStatus, guideText, refreshRequest, refreshText } from '../hooks/prompt-guide'

test('the integration plugin’s lines always apply; another plugin’s only when it is on', () => {
  const extra = [...GUIDE, { plugin: 'bc-datahub', task: 'a Data Hub model', ask: 'which universe' }]
  expect(guideFor([], extra).map(e => e.plugin)).not.toContain('bc-datahub')
  expect(guideFor(['bc-datahub'], extra).map(e => e.task)).toContain('a Data Hub model')
  expect(guideFor(['bc-datahub'], extra).filter(e => e.plugin === 'bc-integration')).toHaveLength(GUIDE.length)
  expect(guideLine(GUIDE[1]!)).toBe('a deploy: the environment, and whether to test after')
})

test('every plugin that has lines is stamped with the version they were written for', () => {
  for (const e of GUIDE) expect(GUIDE_STAMP[e.plugin], e.plugin).toMatch(/^\d+\.\d+\.\d+/)
})

test('a guide is current, drifted, unwritten or unknown against the installed version', () => {
  const stamp = { 'bc-integration': '1.0.83', 'bc-marketplace': '0.2.9' }
  const status = guideStatus(
    [{ name: 'bc-integration', version: '1.0.90' }, { name: 'bc-marketplace', version: '0.2.9' }, { name: 'bc-datahub', version: '0.2.12' }, { name: 'bc-bdi' }],
    stamp,
  )
  expect(status.map(s => `${s.plugin}:${s.state}`)).toEqual(['bc-integration:drifted', 'bc-marketplace:current', 'bc-datahub:unwritten', 'bc-bdi:unwritten'])
  expect(guideStatus([{ name: 'bc-integration' }], stamp)[0]?.state).toBe('unknown')
  expect(driftNote(status)).toBe("The dashboard's guide was written for bc-integration 1.0.83 (now 1.0.90). Check what changed: /bc-dashboard prompt guide")
  expect(driftNote(guideStatus([{ name: 'bc-integration', version: '1.0.83' }], stamp))).toBeUndefined()
})

test('the guide report shows only the changelog lines after the version it was written for', () => {
  const status = guideStatus([{ name: 'bc-integration', version: '1.0.90' }], { 'bc-integration': '1.0.83' })
  const text = guideText(status, { 'bc-integration': ['# Changelog', '', '## 1.0.90', '', '- Deploys need a package description.', '', '## 1.0.83', '', '- Older note.'] })
  expect(text).toContain('◐ bc-integration: written for 1.0.83, installed 1.0.90: Companion has moved on')
  expect(text).toContain('- Deploys need a package description.')
  expect(text).not.toContain('Older note')
  expect(text).toContain('/bc-dashboard prompt guide refresh has a model draft the edits for bc-integration')
  expect(guideText(guideStatus([{ name: 'bc-integration', version: '1.0.83' }], { 'bc-integration': '1.0.83' }))).toContain('Nothing to refresh.')
  expect(guideText([])).toContain('nothing to compare')
})

test('a refresh asks for edits grounded in the notes, and prints a draft that changes nothing', () => {
  expect(REFRESH_SYSTEM).toContain('Never write a question from general knowledge of Boomi')
  expect(REFRESH_SYSTEM).toContain('Nothing to change.')
  const request = refreshRequest('bc-integration', '1.0.83', '1.0.90', GUIDE, ['- Deploys need a package description.'])
  expect(request).toContain('written for version 1.0.83; installed is 1.0.90')
  expect(request).toContain('- a deploy: the environment, and whether to test after')
  expect(request).toContain('Changelog entries since then:\n- Deploys need a package description.')
  const fresh = refreshRequest('bc-datahub', undefined, '0.2.12', [], ['- Added quarantine'], ['Quarantine'])
  expect(fresh).toContain('- none')
  expect(fresh).toContain("The plugin's changelog:")
  expect(fresh).toContain('- Quarantine')
  const draft = refreshText('bc-integration', '1.0.90', 'CHANGE | a deploy | the environment | the note', 'haiku')
  expect(draft).toContain('by haiku')
  expect(draft).toContain("set GUIDE_STAMP['bc-integration'] to '1.0.90'")
  expect(draft).toContain('Nothing was changed.')
})
