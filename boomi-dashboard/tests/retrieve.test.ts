import { expect, test } from 'claude-code/testing'
import { CONTEXT_CHARS, EMPTY_INDEX, SECTION_CHARS, docName, excerpt, fingerprint, indexFile, isCurrent, keywords, relevantPlaces, relevantSections } from '../hooks/retrieve'
import type { DocIndex, Section } from '../hooks/retrieve'

const ERRORS = '# Errors\n\n## Debugging a failed deploy\n\nRead the execution log first.\n\nA deploy error names the environment extension that is missing.\n\n## Quarantine\n\nData Hub quarantine holds records that failed matching.\n'

test('an excerpt keeps the paragraphs that match the prompt, in order, with … where some were left out', () => {
  const text = ['alpha filler '.repeat(20), 'the environment extension is missing', 'beta filler '.repeat(20), 'a deploy needs an environment', 'gamma filler '.repeat(20)].join('\n\n')
  const cut = excerpt(text, keywords('deploy environment'), 120)
  expect(cut).toContain('the environment extension is missing')
  expect(cut).toContain('a deploy needs an environment')
  expect(cut).not.toContain('alpha filler')
  expect(cut).toContain('…')
  expect(cut.indexOf('extension is missing')).toBeLessThan(cut.indexOf('needs an environment'))
  expect(excerpt('short', ['x'], 100)).toBe('short')
  expect(excerpt('x'.repeat(500), [], 100).length).toBeLessThanOrEqual(105)
})

test('sections are read within a budget: six at most, each cut, all together under the total', () => {
  const big = (n: number): Section => ({ source: `guides/doc${n}.md`, heading: 'Deploy to an environment', text: `deploy environment ${'padding words here. '.repeat(400)}` })
  const picked = relevantSections(Array.from({ length: 12 }, (_, i) => big(i)), 'deploy to an environment')
  expect(picked.length).toBeLessThanOrEqual(6)
  expect(picked.length).toBeGreaterThan(1)
  for (const s of picked) expect(s.text.length).toBeLessThanOrEqual(SECTION_CHARS)
  expect(picked.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(CONTEXT_CHARS)
})

test('a doc whose file name matches the prompt counts for it', () => {
  const sections: Section[] = [
    { source: 'guides/process_testing_guide.md', heading: 'Steps', text: 'Run it with sample documents.' },
    { source: 'guides/other.md', heading: 'Steps', text: 'Run it with sample documents.' },
  ]
  expect(relevantSections(sections, 'testing the process').map(s => s.source)).toEqual(['guides/process_testing_guide.md'])
})

test('a fingerprint tells a changed doc from an unchanged one', () => {
  expect(fingerprint('abc')).toBe(fingerprint('abc'))
  expect(fingerprint('abc')).not.toBe(fingerprint('abd'))
  expect(fingerprint('abc')).toMatch(/^[0-9a-f]{8}$/)
})

test('an index entry holds headings and key words, never the text, and is reused while the doc is unchanged', () => {
  const first = indexFile('bc-integration', 'skills/x/references/guides/boomi_error_reference.md', ERRORS)
  expect(first.sections.map(s => s.heading)).toContain('Debugging a failed deploy')
  expect(first.sections.find(s => s.heading === 'Debugging a failed deploy')?.words).toContain('deploy')
  expect(JSON.stringify(first)).not.toContain('Read the execution log first')
  expect(indexFile('bc-integration', first.file, ERRORS, first)).toBe(first)
  const changed = indexFile('bc-integration', first.file, `${ERRORS}\n## New\n\nSomething new.\n`, first)
  expect(changed).not.toBe(first)
  expect(changed.sections.map(s => s.heading)).toContain('New')
})

test('the index is current only for the plugin versions and folders it was built for', () => {
  const installed = { 'bc-integration': { version: '1.0.83', dir: '/p/bc-integration/1.0.83/' } }
  const index: DocIndex = { built: 1, plugins: installed, files: {} }
  expect(isCurrent(index, installed)).toBe(true)
  expect(isCurrent(index, { 'bc-integration': { version: '1.0.84', dir: '/p/bc-integration/1.0.84/' } })).toBe(false)
  expect(isCurrent(index, { ...installed, 'bc-marketplace': { version: '0.2.9', dir: '/p/m/' } })).toBe(false)
  expect(isCurrent(EMPTY_INDEX, {})).toBe(true)
})

test('places to read are found by heading, file name and key words, best first', () => {
  const file = indexFile('bc-integration', 'skills/x/references/guides/boomi_error_reference.md', ERRORS)
  const other = indexFile('bc-integration', 'skills/x/references/steps/map_step.md', '# Map\n\n## Functions\n\nA map converts fields between profiles.\n')
  const index: DocIndex = { built: 1, plugins: {}, files: { a: file, b: other } }
  const places = relevantPlaces(index, 'why did my deploy fail with an error')
  expect(places[0]?.heading).toBe('Debugging a failed deploy')
  expect(docName(places[0]!.file)).toBe('bc-integration/guides/boomi_error_reference.md')
  expect(relevantPlaces(index, 'weather')).toEqual([])
})
