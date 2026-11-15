// Boomi Companion's plugins: whether a newer version is on its repository, and
// what `/bc-dashboard upgrade companion` says before it asks. The check reads
// the repository's tags (git ls-remote, never a clone); the install is Claude
// Code's own `claude plugin update`, run only after a yes. Plain functions:
// nothing here touches the engine.

import { compareVersions, type UpdateSeen } from './upgrade'

/** The marketplace the Companion plugins come from, as Claude Code names it. */
export const COMPANION_MARKETPLACE = 'boomi-companion'

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const parse = (text: string | undefined): unknown => {
  try {
    return JSON.parse(text ?? '')
  } catch {
    return undefined
  }
}

/** The versions among `git ls-remote --tags --refs` lines (`<sha>\trefs/tags/<version>`). */
export const tagVersions = (output: string): string[] =>
  output.split('\n').flatMap(line => {
    const tag = line.match(/refs\/tags\/v?(\d[\w.-]*)\s*$/)
    return tag ? [tag[1]!] : []
  })

/** The newest version among the tags, or undefined when there are none. */
export const latestTag = (versions: readonly string[]): string | undefined =>
  versions.reduce<string | undefined>((best, v) => (best === undefined || compareVersions(v, best) > 0 ? v : best), undefined)

/** A GitHub repository over https, as the catalog may name it: owner/name, with or without .git. Anything else (a leading dash, file:, ssh:, another host) is refused. */
const GITHUB_HTTPS = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/

/** The GitHub repository a Companion plugin is published from, from the marketplace's catalog (marketplace.json). Only https GitHub URLs count: the catalog is read from disk and never trusted with another scheme or host. */
export const repoUrl = (catalog: string | undefined, name: string): string | undefined => {
  const plugins = asObject(parse(catalog))?.plugins
  if (!Array.isArray(plugins)) return undefined
  for (const item of plugins) {
    const entry = asObject(item)
    const source = asObject(entry?.source)
    if (entry?.name !== name || !source) continue
    const url = typeof source.url === 'string' ? source.url : typeof source.repo === 'string' ? `https://github.com/${source.repo}.git` : undefined
    return url && GITHUB_HTTPS.test(url) ? url : undefined
  }
  return undefined
}

/** The newest seen version per plugin, as the store keeps it. */
export type CompanionSeen = Record<string, UpdateSeen>

export const asCompanionSeen = (value: unknown): CompanionSeen => {
  const out: CompanionSeen = {}
  for (const [name, seen] of Object.entries(asObject(value) ?? {})) {
    const s = asObject(seen)
    if (typeof s?.latest === 'string' && typeof s?.announced === 'string') out[name] = { latest: s.latest, announced: s.announced }
  }
  return out
}

/** One installed plugin with a newer version on its repository. */
export type CompanionUpdate = { name: string; installed: string; latest: string }

/** Which installed plugins have a newer version than the one installed. Plugins with no version or no answer are left out. */
export const companionUpdates = (plugins: readonly { name: string; version?: string }[], latest: Readonly<Record<string, string | undefined>>): CompanionUpdate[] =>
  plugins.flatMap(p => {
    const newest = latest[p.name]
    return p.version && newest && compareVersions(newest, p.version) > 0 ? [{ name: p.name, installed: p.version, latest: newest }] : []
  })

/** The plugin's id as `claude plugin` takes it: `<name>@boomi-companion`. */
export const pluginId = (name: string) => `${name}@${COMPANION_MARKETPLACE}`

/** The check in words: what's newer, which plugins couldn't be reached, or that all are current. */
export const companionCheckText = (updates: readonly CompanionUpdate[], unreachable: readonly string[], checked: readonly string[]): string => {
  const lines: string[] = []
  for (const u of updates) lines.push(`${u.name} ${u.installed} → ${u.latest}: a newer version is on its repository`)
  if (updates.length === 0 && checked.length > 0) lines.push(`✓ Companion plugins are up to date: ${checked.join(', ')}.`)
  if (unreachable.length > 0) lines.push(`✗ Couldn't read the version of ${unreachable.join(', ')} (offline, or not in the marketplace's catalog).`)
  return lines.join('\n') || 'No Boomi Companion plugins are on in this session.'
}
