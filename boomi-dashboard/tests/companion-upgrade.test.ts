import { expect, test } from 'claude-code/testing'
import { MANIFEST_MAX_CHARS, asCompanionSeen, companionCheckText, companionUpdates, manifestUrl, manifestVersion, pluginId, repoUrl, withinManifestLimit } from '../hooks/companion-upgrade'

const SHA = 'c7240f64daee879ab93a6f989d9ab4d367b87d40'

test('the plugin manifest is read from the repository\'s default branch', () => {
  expect(manifestUrl('https://github.com/OfficialBoomi/bc-integration.git')).toBe('https://raw.githubusercontent.com/OfficialBoomi/bc-integration/HEAD/.claude-plugin/plugin.json')
  expect(manifestUrl('https://github.com/OfficialBoomi/bc-datahub')).toBe('https://raw.githubusercontent.com/OfficialBoomi/bc-datahub/HEAD/.claude-plugin/plugin.json')
  expect(manifestUrl('https://example.com/x.git')).toBeUndefined()
  expect(manifestUrl('--upload-pack=touch /tmp/x')).toBeUndefined()
})

test('the version is read from the manifest, and a missing or odd one is no version', () => {
  expect(manifestVersion('{"name":"bc-integration","version":"1.0.103"}')).toBe('1.0.103')
  expect(manifestVersion('{"name":"bc-integration"}')).toBeUndefined()
  expect(manifestVersion('{"version":"../../x"}')).toBeUndefined()
  expect(manifestVersion('not json')).toBeUndefined()
  expect(manifestVersion(undefined)).toBeUndefined()
})

test('a plugin is published from the repository its marketplace entry names', () => {
  const catalog = JSON.stringify({
    plugins: [
      { name: 'bc-integration', source: { source: 'url', url: 'https://github.com/OfficialBoomi/bc-integration.git' } },
      { name: 'bc-datahub', source: { source: 'github', repo: 'OfficialBoomi/bc-datahub' } },
    ],
  })
  expect(repoUrl(catalog, 'bc-integration')).toBe('https://github.com/OfficialBoomi/bc-integration.git')
  expect(repoUrl(catalog, 'bc-datahub')).toBe('https://github.com/OfficialBoomi/bc-datahub.git')
  expect(repoUrl(catalog, 'bc-bdi')).toBeUndefined()
  expect(repoUrl(undefined, 'bc-integration')).toBeUndefined()
  // Only https GitHub URLs: a dash-led or file: value, or another host, is never handed to git.
  const hostile = (url: string) => JSON.stringify({ plugins: [{ name: 'bc-bdi', source: { source: 'url', url } }] })
  expect(repoUrl(hostile('--upload-pack=touch /tmp/x'), 'bc-bdi')).toBeUndefined()
  expect(repoUrl(hostile('file:///etc'), 'bc-bdi')).toBeUndefined()
  expect(repoUrl(hostile('ext::sh -c evil'), 'bc-bdi')).toBeUndefined()
  expect(repoUrl(hostile('https://example.com/x.git'), 'bc-bdi')).toBeUndefined()
  expect(repoUrl(hostile('https://github.com/OfficialBoomi/bc-bdi.git'), 'bc-bdi')).toBe('https://github.com/OfficialBoomi/bc-bdi.git')
  expect(repoUrl('not json', 'bc-integration')).toBeUndefined()
})

test('only an installed plugin with a newer tag is an update; one with no version or no answer is left alone', () => {
  const plugins = [
    { name: 'bc-integration', version: '1.0.103' },
    { name: 'bc-marketplace', version: '0.2.11' },
    { name: 'bc-datahub' },
    { name: 'bc-bdi', version: '0.1.0' },
  ]
  const latest = { 'bc-integration': '1.0.104', 'bc-marketplace': '0.2.11', 'bc-datahub': '0.3.0', 'bc-bdi': undefined }
  expect(companionUpdates(plugins, latest)).toEqual([{ name: 'bc-integration', installed: '1.0.103', latest: '1.0.104' }])
})

test('the check says what is newer, what could not be read, or that all are current', () => {
  expect(companionCheckText([{ name: 'bc-integration', installed: '1.0.103', latest: '1.0.104' }], [], ['bc-marketplace'])).toBe(
    'bc-integration 1.0.103 → 1.0.104: a newer version is on its repository',
  )
  expect(companionCheckText([], [], ['bc-integration', 'bc-marketplace'])).toBe('✓ Companion plugins are up to date: bc-integration, bc-marketplace.')
  expect(companionCheckText([], ['bc-bdi'], [])).toBe("✗ Couldn't read the version of bc-bdi (offline, or not in the marketplace's catalog).")
  expect(companionCheckText([], [], [])).toBe('No Boomi Companion plugins are on in this session.')
})

test('the plugin id is the name at the Companion marketplace', () => {
  expect(pluginId('bc-integration')).toBe('bc-integration@boomi-companion')
})

test('the seen versions read back only the entries that have both fields', () => {
  expect(asCompanionSeen({ 'bc-integration': { latest: '1.0.104', announced: '1.0.104' }, junk: { latest: 1 }, other: 'x' })).toEqual({
    'bc-integration': { latest: '1.0.104', announced: '1.0.104' },
  })
  expect(asCompanionSeen(undefined)).toEqual({})
})

test('a manifest over the size cap is not read, and one at the cap is', () => {
  expect(withinManifestLimit('{"version":"1.0.0"}')).toBe(true)
  expect(withinManifestLimit('x'.repeat(MANIFEST_MAX_CHARS))).toBe(true)
  expect(withinManifestLimit('x'.repeat(MANIFEST_MAX_CHARS + 1))).toBe(false)
})
