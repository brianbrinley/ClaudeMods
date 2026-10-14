import { expect, test } from 'claude-code/testing'
import { hasComponents, installedTip, isInstalled, pluginsFromFiles, pluginsFromList } from '../hooks/plugins'
import { TIPS, tipsFor, welcomeLine } from '../hooks/activity'

// What `claude plugin list --json` printed (Claude Code 2.1.296) in a folder
// outside bc-agentstudio's project, with bc-bdi disabled, bc-integration
// installed from the boomi-companion marketplace and also synced from claude.ai.
const LISTED = JSON.stringify([
  {
    id: 'bc-agentstudio@boomi-companion',
    version: '0.1.42',
    scope: 'project',
    enabled: false,
    installPath: '/root/.claude/plugins/cache/boomi-companion/bc-agentstudio/0.1.42',
    projectPath: '/tmp',
    projectEnabled: false,
  },
  { id: 'bc-bdi@boomi-companion', version: '0.2.5', scope: 'user', enabled: false, installPath: '/root/.claude/plugins/cache/boomi-companion/bc-bdi/0.2.5', projectEnabled: false },
  { id: 'bc-datahub@boomi-companion', version: '0.2.12', scope: 'user', enabled: true, installPath: '/root/.claude/plugins/cache/boomi-companion/bc-datahub/0.2.12', projectEnabled: false },
  { id: 'bc-integration@boomi-companion', version: '1.0.83', scope: 'user', enabled: true, installPath: '/root/.claude/plugins/cache/boomi-companion/bc-integration/1.0.83', projectEnabled: true },
  { id: 'boomi-runtime@inline', version: '0.3.0', scope: 'session', enabled: true, installPath: '/home/user/ClaudeMods/boomi-runtime', hasUserConfig: true },
  {
    id: 'bc-integration@synced',
    version: 'unknown',
    scope: 'synced',
    enabled: true,
    installPath: '',
    notes: ['"bc-integration@synced" from claude.ai not loaded — "bc-integration@boomi-companion" on this machine has the same name and takes precedence'],
    noteDetails: [{ type: 'synced-plugin-shadowed', related: 'bc-integration@boomi-companion' }],
  },
])

test("Claude Code's plugin list: only enabled Companion plugins, each once, in the dashboard's order", () => {
  expect(pluginsFromList(LISTED)).toEqual([
    { name: 'bc-integration', version: '1.0.83' },
    { name: 'bc-datahub', version: '0.2.12' },
  ])
})

test('a synced plugin on its own counts, with its version', () => {
  const synced = [{ id: 'bc-integration@synced', version: '1.0.64', scope: 'synced', enabled: true, installPath: '/root/.claude/plugins/synced/x/y' }]
  expect(pluginsFromList(JSON.stringify(synced))).toEqual([{ name: 'bc-integration', version: '1.0.64' }])
})

test("output that isn't the list is unknown, not empty", () => {
  expect(pluginsFromList('')).toBeUndefined()
  expect(pluginsFromList('error: unknown command')).toBeUndefined()
  expect(pluginsFromList('{"plugins":{}}')).toBeUndefined()
  expect(pluginsFromList('[]')).toEqual([])
})

// installed_plugins.json as Claude Code 2.1.296 wrote it.
const INSTALLED = JSON.stringify({
  version: 2,
  plugins: {
    'bc-integration@boomi-companion': [{ scope: 'user', installPath: '/root/.claude/plugins/cache/boomi-companion/bc-integration/1.0.83', version: '1.0.83' }],
    'bc-bdi@boomi-companion': [{ scope: 'user', installPath: '/root/.claude/plugins/cache/boomi-companion/bc-bdi/0.2.5', version: '0.2.5' }],
    'bc-agentstudio@boomi-companion': [{ scope: 'project', installPath: '/x', version: '0.1.42', projectPath: '/work' }],
    'bc-connectordev@boomi-companion': [{ scope: 'project', installPath: '/x', version: '0.0.50', projectPath: '/elsewhere' }],
  },
})

test("Claude Code's files, when its CLI can't run: user installs, this project's, less what settings turn off, plus synced", () => {
  const user = JSON.stringify({ enabledPlugins: { 'bc-integration@boomi-companion': true, 'bc-bdi@boomi-companion': false } })
  const synced = [JSON.stringify({ name: 'bc-marketplace', version: '0.2.10' }), JSON.stringify({ name: 'bc-integration', version: '1.0.64' })]
  expect(pluginsFromFiles(INSTALLED, [undefined, undefined, user], synced, '/work/project')).toEqual([
    { name: 'bc-integration', version: '1.0.83' },
    { name: 'bc-marketplace', version: '0.2.10' },
    { name: 'bc-agentstudio', version: '0.1.42' },
  ])
  // A project's own setting wins over the user's.
  const local = JSON.stringify({ enabledPlugins: { 'bc-bdi@boomi-companion': true } })
  expect(pluginsFromFiles(INSTALLED, [local, undefined, user], [], '/elsewhere').map(p => p.name)).toEqual(['bc-integration', 'bc-bdi', 'bc-connectordev'])
  expect(pluginsFromFiles('not json', [], [], '/work')).toEqual([])
})

test('which sections apply: unknown shows everything; known shows what is installed', () => {
  expect(isInstalled(null, 'bc-datahub')).toBe(true)
  expect(hasComponents(null)).toBe(true)
  expect(isInstalled([{ name: 'bc-integration' }], 'bc-datahub')).toBe(false)
  expect(hasComponents([{ name: 'bc-datahub' }])).toBe(false)
  expect(hasComponents([{ name: 'bc-marketplace' }])).toBe(true)
})

test("the tips name what's installed and leave out tips for plugins that aren't", () => {
  expect(installedTip([])).toBeUndefined()
  expect(installedTip([{ name: 'bc-integration', version: '1.0.83' }, { name: 'bc-datahub' }])).toBe('Companion here: Integration 1.0.83 · Data Hub')

  expect(tipsFor(null)).toEqual(TIPS)
  const datahub = tipsFor([{ name: 'bc-datahub', version: '0.2.12' }])
  expect(datahub[0]).toBe('Companion here: Data Hub 0.2.12')
  expect(datahub.some(t => t.includes('Data Hub section'))).toBe(true)
  expect(datahub.some(t => t.includes('Why?') || t.includes('Run again') || t.includes('Agentstudio'))).toBe(false)
  const integration = tipsFor([{ name: 'bc-integration' }])
  expect(integration.some(t => t.includes('Why?'))).toBe(true)
  expect(integration.some(t => t.includes('Data Hub'))).toBe(false)
  for (const tip of datahub.slice(1)) expect(tip.startsWith('Tip: ')).toBe(true)

  expect(welcomeLine(0, undefined, 0, datahub).text).toBe('Companion here: Data Hub 0.2.12')
})
