// Boomi Companion's plugins: whether a newer version is on its repository, and
// what `/bc-dashboard upgrade companion` says before it asks. The check reads
// the repository's plugin.json on its default branch (one HTTPS read); the install is Claude
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

/** The raw URL of a GitHub repository's plugin manifest on its default branch: what claude plugin update installs. */
export const manifestUrl = (repo: string): string | undefined => {
  const m = repo.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(\.git)?$/)
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/HEAD/.claude-plugin/plugin.json` : undefined
}

/** A plugin.json is a few kilobytes; a body over this many bytes is not read. */
export const MANIFEST_MAX_BYTES = 64 * 1024

/** UTF-8 bytes in a text, counted without TextEncoder, which the engine may not have. */
export const utf8Length = (text: string): number => {
  let n = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
  }
  return n
}

/** Whether a body of this many bytes is small enough to read. */
export const withinManifestLimit = (bytes: number): boolean => bytes <= MANIFEST_MAX_BYTES

/** The version in a plugin manifest's text, or undefined when there isn't a plausible one. */
export const manifestVersion = (text: string | undefined): string | undefined => {
  const version = asObject(parse(text))?.version
  return typeof version === 'string' && /^\d[\w.-]*$/.test(version) ? version : undefined
}

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
