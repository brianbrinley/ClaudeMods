// Which of Boomi Companion's plugins are on in this session, so the pane shows
// only the sections that apply and the new-session tips mention what's there.
// Read from `claude plugin list --json`, which settles scopes, disabled plugins
// and synced plugins the way Claude Code does; when the CLI can't be reached,
// from Claude Code's own files under ~/.claude/plugins. Plain functions:
// nothing here touches the engine.

import type { CompanionPlugin, Product } from '../types'

/** Boomi Companion's plugins, in the order the dashboard names them, with what each is to a person. */
export const COMPANION_PLUGINS: readonly { name: string; label: string; product?: Product }[] = [
  { name: 'bc-integration', label: 'Integration' },
  { name: 'bc-marketplace', label: 'Marketplace', product: 'marketplace' },
  { name: 'bc-datahub', label: 'Data Hub', product: 'datahub' },
  { name: 'bc-bdi', label: 'BDI', product: 'bdi' },
  { name: 'bc-agentstudio', label: 'Agentstudio', product: 'agentstudio' },
  { name: 'bc-connectordev', label: 'Connectors', product: 'connectordev' },
]

const isCompanion = (name: string) => COMPANION_PLUGINS.some(p => p.name === name)

/** A plugin's name from Claude Code's `<name>@<marketplace>` key. */
const nameOf = (id: string) => id.split('@')[0] ?? id

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Companion's plugins in the dashboard's order, each once, keeping the first version seen. */
const ordered = (found: readonly CompanionPlugin[]): CompanionPlugin[] =>
  COMPANION_PLUGINS.flatMap(({ name }) => {
    const all = found.filter(p => p.name === name)
    if (all.length === 0) return []
    const version = all.find(p => p.version)?.version
    return [version ? { name, version } : { name }]
  })

const versionOf = (value: unknown) => (typeof value === 'string' && value && value !== 'unknown' ? value : undefined)

/**
 * The Companion plugins `claude plugin list --json` says are on for the folder
 * it ran in: enabled, and not a synced copy a local install shadows. Undefined
 * when the output isn't the CLI's list.
 */
export const pluginsFromList = (stdout: string): CompanionPlugin[] | undefined => {
  const list = parse(stdout)
  if (!Array.isArray(list)) return undefined
  const found = list.flatMap(item => {
    const entry = asObject(item)
    if (!entry || typeof entry.id !== 'string' || entry.enabled !== true) return []
    const isShadowed = Array.isArray(entry.noteDetails) && entry.noteDetails.some(n => asObject(n)?.type === 'synced-plugin-shadowed')
    const name = nameOf(entry.id)
    if (isShadowed || !isCompanion(name)) return []
    const version = versionOf(entry.version)
    return [version ? { name, version } : { name }]
  })
  return ordered(found)
}

/** Whether `cwd` is `root` or inside it. */
const isWithin = (cwd: string, root: string) => cwd === root || cwd.startsWith(root.endsWith('/') ? root : `${root}/`)

/**
 * The same from Claude Code's own files, when its CLI can't be run:
 * `installed_plugins.json` (version 2: `plugins` keyed `<name>@<marketplace>`,
 * each a list of installs with `scope`, `version` and, for a project or local
 * install, `projectPath`), the `enabledPlugins` of the settings files that
 * apply, most specific first, and the plugin.json of each plugin synced from
 * claude.ai. An install counts for user scope, or when the session is in its
 * project; a setting of false turns it off.
 */
export const pluginsFromFiles = (
  installed: string | undefined,
  settings: readonly (string | undefined)[],
  synced: readonly string[],
  cwd: string,
): CompanionPlugin[] => {
  const switches = settings.map(text => asObject(asObject(parse(text ?? ''))?.enabledPlugins) ?? {})
  const isOff = (id: string) => switches.find(s => typeof s[id] === 'boolean')?.[id] === false
  const plugins = asObject(asObject(parse(installed ?? ''))?.plugins) ?? {}
  const local = Object.entries(plugins).flatMap(([id, installs]) => {
    const name = nameOf(id)
    if (!isCompanion(name) || !Array.isArray(installs) || isOff(id)) return []
    return installs.flatMap(install => {
      const at = asObject(install)
      if (!at) return []
      const applies = at.scope === 'user' || (typeof at.projectPath === 'string' && isWithin(cwd, at.projectPath))
      if (!applies) return []
      const version = versionOf(at.version)
      return [version ? { name, version } : { name }]
    })
  })
  const fromClaudeAi = synced.flatMap(text => {
    const manifest = asObject(parse(text))
    const name = typeof manifest?.name === 'string' ? manifest.name : ''
    if (!isCompanion(name) || local.some(p => p.name === name)) return []
    const version = versionOf(manifest?.version)
    return [version ? { name, version } : { name }]
  })
  return ordered([...local, ...fromClaudeAi])
}

/** Whether a Companion plugin is on; with the list unknown, every one counts. */
export const isInstalled = (plugins: readonly CompanionPlugin[] | null | undefined, name: string): boolean =>
  !plugins || plugins.some(p => p.name === name)

/** Whether components (bc-integration's, or a Marketplace recipe's) can show up in this session. */
export const hasComponents = (plugins: readonly CompanionPlugin[] | null | undefined): boolean =>
  isInstalled(plugins, 'bc-integration') || isInstalled(plugins, 'bc-marketplace')

/** The tip naming what's installed: "Companion here: Integration 1.0.83 · Data Hub 0.2.12". */
export const installedTip = (plugins: readonly CompanionPlugin[]): string | undefined => {
  if (plugins.length === 0) return undefined
  const named = plugins.map(p => {
    const label = COMPANION_PLUGINS.find(c => c.name === p.name)?.label ?? p.name
    return p.version ? `${label} ${p.version}` : label
  })
  return `Companion here: ${named.join(' · ')}`
}
