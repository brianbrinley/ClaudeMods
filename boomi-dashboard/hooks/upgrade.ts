// /bc-dashboard upgrade: reading scripts/upgrade.sh's report and putting it in
// words. The script does the git work and the safety checks; these are plain
// functions, so the tests call them directly.

/** Hides anything shaped like a credential: Grafana and API keys, JWTs, auth headers. */
export const mask = (text: string): string =>
  text
    .replace(/(glc_|sk-)[A-Za-z0-9_-]+/g, '$1****')
    .replace(/eyJ[A-Za-z0-9._-]+/g, 'eyJ****')
    .replace(/(Bearer|Basic) [A-Za-z0-9+/=._~-]+/g, '$1 ****')

/**
 * Compares two versions by their numbers: 1 when a is newer, -1 when older, 0
 * when the same. Missing parts count as 0, and a pre-release (1.0.0-beta)
 * comes before its release.
 */
export const compareVersions = (a: string, b: string): number => {
  const split = (v: string) => {
    const [core = '', pre] = v.trim().replace(/^v/, '').split('-', 2)
    return { parts: core.split('.').map(n => Number.parseInt(n, 10) || 0), pre }
  }
  const x = split(a)
  const y = split(b)
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  if (x.pre === y.pre) return 0
  if (x.pre === undefined) return 1
  if (y.pre === undefined) return -1
  return x.pre > y.pre ? 1 : -1
}

/** What the script reported. */
export type UpgradeReport = {
  error?: string
  root?: string
  mod?: string
  origin?: string
  branch: string
  head?: string
  isDetached: boolean
  target?: string
  installed?: string
  latest?: string
  behind: number
  ahead: number
  dirty: number
  mods: string[]
  commits: string[]
  files: string[]
  changelog: string[]
  testsFailed?: string
  installedNow?: string
  previous?: string
  isUpToDate: boolean
  rolledBack?: string
  /** The script's plain lines (test output, notes), after its KEY lines. */
  lines: string[]
}

/** Reads the script's `KEY: value` lines; anything else is kept as plain lines. */
export const parseUpgrade = (output: string): UpgradeReport => {
  const r: UpgradeReport = { branch: 'main', isDetached: false, behind: 0, ahead: 0, dirty: 0, mods: [], commits: [], files: [], changelog: [], isUpToDate: false, lines: [] }
  for (const raw of mask(output).split('\n')) {
    const m = raw.match(/^([A-Z][A-Z-]*): ?(.*)$/)
    const value = m?.[2] ?? ''
    switch (m?.[1]) {
      case 'ERROR': r.error = value; break
      case 'ROOT': r.root = value; break
      case 'MOD': r.mod = value; break
      case 'ORIGIN': r.origin = value; break
      case 'BRANCH': r.branch = value; break
      case 'HEAD': r.head = value; break
      case 'DETACHED': r.isDetached = value === 'yes'; break
      case 'TARGET': r.target = value; break
      case 'INSTALLED': r.installed = value; break
      case 'LATEST': r.latest = value; break
      case 'BEHIND': r.behind = Number(value) || 0; break
      case 'AHEAD': r.ahead = Number(value) || 0; break
      case 'DIRTY': r.dirty = Number(value) || 0; break
      case 'MODS': r.mods = value.split(/\s+/).filter(Boolean); break
      case 'COMMIT': r.commits.push(value); break
      case 'FILE': r.files.push(value); break
      case 'CHANGELOG': r.changelog.push(value); break
      case 'TESTS-FAILED': r.testsFailed = value; break
      case 'INSTALLED-NOW': r.installedNow = value; break
      case 'PREVIOUS': r.previous = value; break
      case 'UP-TO-DATE': r.isUpToDate = true; break
      case 'ROLLED-BACK': r.rolledBack = value; break
      case 'ALREADY': r.rolledBack = value; break
      case 'PASSED': case 'FETCH': break
      default: if (raw.trim()) r.lines.push(raw)
    }
  }
  return r
}

/**
 * A changelog's entries for the versions after `from`, up to and including
 * `to`: each `## <version>` heading and the lines under it, blank lines dropped.
 */
export const changelogBetween = (lines: readonly string[], from: string, to: string): string[] => {
  const out: string[] = []
  let keep = false
  for (const line of lines) {
    const heading = line.match(/^##\s+v?(\d[\w.-]*)/)
    if (heading) keep = compareVersions(heading[1]!, from) > 0 && compareVersions(heading[1]!, to) <= 0
    else if (/^#\s/.test(line)) keep = false
    if (keep && line.trim()) out.push(line)
  }
  return out
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The check in words: the version delta, commits, changed files and changelog; or that it's up to date. */
export const checkText = (r: UpgradeReport): string => {
  if (r.error) return `✗ ${r.error}`
  const name = r.mod && r.mod !== '.' ? r.mod.split('/').pop() : 'boomi-dashboard'
  if (r.behind === 0) return `✓ ${name} ${r.installed ?? ''} is up to date with origin/${r.branch}.`.replace('  ', ' ')
  const lines = [`${name} ${r.installed} → ${r.latest}: ${plural(r.behind, 'commit')} behind origin/${r.branch}`]
  if (r.origin) lines.push(`From ${r.origin}, checkout ${r.root}`)
  if (r.isDetached) lines.push(`(Rolled back to ${r.installed}: an upgrade returns to ${r.branch}.)`)
  lines.push(`Mods it would update (same checkout): ${r.mods.join(', ')}`)
  lines.push('', 'Commits:', ...r.commits.map(c => `  ${c}`))
  const shown = r.files.slice(0, 25)
  lines.push('', `Changed files (${r.files.length}):`, ...shown.map(f => `  ${f.replace('\t', ' ')}`))
  if (r.files.length > shown.length) lines.push(`  …and ${r.files.length - shown.length} more`)
  const notes = r.installed && r.latest ? changelogBetween(r.changelog, r.installed, r.latest) : []
  if (notes.length > 0) lines.push('', 'Changelog:', ...notes)
  return lines.join('\n')
}

/** What would stop the install, said before asking: uncommitted changes, local commits. Undefined when nothing does. */
export const planText = (r: UpgradeReport): string | undefined => {
  const stops: string[] = []
  if (r.dirty > 0) stops.push(`✗ The checkout has uncommitted changes (${plural(r.dirty, 'file')}). Commit or put them aside yourself, then run /bc-dashboard upgrade again.`)
  if (r.ahead > 0) stops.push(`✗ The checkout has commits that are not on origin/${r.branch} (${r.ahead}). Push or move them yourself, then run /bc-dashboard upgrade again.`)
  return stops.length > 0 ? `${stops.join('\n')}\nNothing was changed.` : undefined
}

/** Whether the once-a-day check is due: `hours` since the last one, never when 0. */
export const isCheckDue = (last: number | undefined, now: number, hours: number): boolean =>
  hours > 0 && (last === undefined || now - last >= hours * 3_600_000)

/** The newest version a check found, and the newest one already toasted. */
export type UpdateSeen = { latest: string; announced: string }

/**
 * What a check that found `latest` means: toast only a version newer than any
 * already toasted, and keep it for the pane's quiet reminder. Nothing kept when
 * the installed version is current.
 */
export const updateNotice = (seen: UpdateSeen | undefined, installed: string, latest: string): { isToasting: boolean; seen?: UpdateSeen } => {
  if (compareVersions(latest, installed) <= 0) return { isToasting: false }
  const isToasting = !seen || compareVersions(latest, seen.announced) > 0
  return { isToasting, seen: { latest, announced: isToasting || !seen ? latest : seen.announced } }
}

/** The newer version the pane mentions, until the installed one catches up. */
export const pendingUpdate = (seen: UpdateSeen | undefined, installed: string | undefined): string | undefined =>
  seen && installed && compareVersions(seen.latest, installed) > 0 ? seen.latest : undefined

/** Reads what the store kept, ignoring anything that isn't an UpdateSeen. */
export const asUpdateSeen = (value: unknown): UpdateSeen | undefined => {
  const v = value as Partial<UpdateSeen> | undefined
  return v && typeof v.latest === 'string' && typeof v.announced === 'string' ? { latest: v.latest, announced: v.announced } : undefined
}

/** What to do for the new version to load: the mod runs from the checkout Claude Code read at start. */
export const RESTART = 'Restart Claude Code (exit, then start it again) for the new version to load: the running session keeps the code it started with. The dashboard can’t reload itself safely.'
