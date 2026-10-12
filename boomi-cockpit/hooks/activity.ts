// Reads Boomi Companion's script runs from Claude's shell commands and their
// output, and turns the session's activity into the cockpit's summary. Plain
// functions: nothing here touches the engine, so the tests call them directly.

import type { Activity, ActivityKind, Cockpit, Outcome, Run, Watched } from '../types'

const SCRIPTS: Record<string, ActivityKind> = {
  'boomi-component-create.sh': 'create',
  'boomi-component-push.sh': 'push',
  'boomi-deploy.sh': 'deploy',
  'boomi-undeploy.sh': 'undeploy',
  'boomi-test-execute.sh': 'test',
}

/** Splits a shell command into words and separators, honoring quotes. */
const words = (command: string): string[] => {
  const out: string[] = []
  let word = ''
  let quote = ''
  let started = false
  const flush = () => {
    if (started) out.push(word)
    word = ''
    started = false
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote) {
      if (ch === quote) quote = ''
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) word += command[++i]!
      else word += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (ch === '\\' && i + 1 < command.length) {
      word += command[++i]!
      started = true
    } else if (/\s/.test(ch)) {
      flush()
    } else if (';&|()'.includes(ch)) {
      flush()
      out.push(ch)
    } else {
      word += ch
      started = true
    }
  }
  flush()
  return out
}

const SEPARATOR = /^[;&|()]$/

/** Options whose next word is their value, not a file. */
const TAKES_VALUE = new Set(['--branch', '--deployment-notes', '--test-data', '--process-id', '--by-component'])

export type ScriptRun = {
  kind: ActivityKind
  file?: string
  processId?: string
  deploymentId?: string
}

/**
 * The Companion scripts a shell command runs that the cockpit reports on, with
 * what each names. `--help`, `--test-connection` and `--list-environments`
 * don't touch a component, so they're left out.
 */
export const scriptRuns = (command: string): ScriptRun[] => {
  const runs: ScriptRun[] = []
  const tokens = words(command)
  for (let i = 0; i < tokens.length; i++) {
    const kind = SCRIPTS[tokens[i]!.split('/').pop() ?? '']
    if (!kind) continue
    const args: string[] = []
    for (const arg of tokens.slice(i + 1)) {
      if (SEPARATOR.test(arg)) break
      args.push(arg)
    }
    if (args.some(arg => ['-h', '--help', '--test-connection', '--list-environments'].includes(arg))) continue
    const run: ScriptRun = { kind }
    for (let j = 0; j < args.length; j++) {
      const arg = args[j]!
      const value = args[j + 1]
      if (arg === '--process-id' && value) run.processId = value
      else if (arg === '--by-component' && value) run.file = value
      if (TAKES_VALUE.has(arg)) {
        j++
        continue
      }
      if (arg.startsWith('-')) continue
      if (arg.endsWith('.xml')) run.file = arg
      else if (kind === 'undeploy') run.deploymentId = arg
    }
    runs.push(run)
  }
  return runs
}

export type Reading = {
  outcome: Exclude<Outcome, 'running'>
  detail: string
  name?: string
  componentId?: string
  version?: string
  executionStatus?: string
  executionId?: string
}

const firstLine = (text: string, pattern: RegExp): string | undefined =>
  text.split(/\r?\n/).find(line => pattern.test(line))?.trim()

/** Execution statuses that mean the process didn't do its job. */
export const isFailedStatus = (status: string | undefined): boolean =>
  status !== undefined && /^(ERROR|ABORTED|DISCARDED)$/i.test(status)

export const isWarnStatus = (status: string | undefined): boolean =>
  status !== undefined && /^COMPLETE_WARN$/i.test(status)

const shorten = (text: string, max = 160): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/**
 * What a Companion script's output says happened. The scripts end with a
 * `SUCCESS:` or `ERROR:` line; a test also prints its execution's status.
 */
export const readOutput = (kind: ActivityKind, output: string, isError: boolean): Reading => {
  const success = firstLine(output, /^\s*SUCCESS:/)
  const error = firstLine(output, /^\s*ERROR:/)
  const already = kind === 'create' ? firstLine(output, /already exists with ID:/) : undefined
  const unchanged = kind === 'push' ? firstLine(output, /nothing sent to the platform/) : undefined
  const reading: Reading = {
    outcome: !isError && !error && (success || already || unchanged) ? 'ok' : 'failed',
    detail: shorten(error ?? success ?? already ?? unchanged ?? (isError ? 'failed' : 'finished')),
  }

  const name = output.match(/[Cc]omponent '([^']+)'|Deployed '([^']+)'/)
  if (name) reading.name = name[1] ?? name[2]
  const id = output.match(/(?:with ID|componentId):?\s*([0-9a-f]{8}-[0-9a-f-]{27,})/i)
  if (id) reading.componentId = id[1]
  const version = output.match(/now version (\d+)/)
  if (version) reading.version = version[1]

  if (kind === 'test') {
    const completed = output.match(/status=([A-Z_]+), executionId=(\S+)/)
    if (completed) {
      reading.executionStatus = completed[1]
      reading.executionId = completed[2]?.replace(/[,.]$/, '')
      // A waited-for test ends with its status, not a SUCCESS line.
      reading.outcome = isError || isFailedStatus(reading.executionStatus) ? 'failed' : 'ok'
      reading.detail = `status ${reading.executionStatus}`
    } else if (/Test submitted/.test(output) && reading.outcome === 'ok') {
      reading.detail = 'submitted, not waited for'
    }
  }
  return reading
}

// --- The summary -----------------------------------------------------------

export const STATUS = {
  healthy: { icon: '✓', color: '#0CA30C' },
  warning: { icon: '◐', color: '#FAB219' },
  serious: { icon: '⚠', color: '#EC835A' },
  critical: { icon: '✗', color: '#D03B3B' },
} as const

export type Level = keyof typeof STATUS

export const LEVEL_OF: Record<Outcome, Level> = {
  ok: 'healthy',
  running: 'warning',
  failed: 'critical',
  blocked: 'serious',
}

const RANK: Level[] = ['healthy', 'warning', 'serious', 'critical']
const worst = (levels: Level[]): Level =>
  levels.reduce<Level>((a, b) => (RANK.indexOf(b) > RANK.indexOf(a) ? b : a), 'healthy')

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const VERB: Record<ActivityKind, string> = {
  create: 'created',
  push: 'pushed',
  deploy: 'deployed',
  undeploy: 'undeployed',
  test: 'tested',
}

/** Each activity's level: a test that ran but warned is a warning, not a pass. */
export const levelOf = (activity: Activity): Level =>
  activity.outcome === 'ok' && isWarnStatus(activity.executionStatus) ? 'warning' : LEVEL_OF[activity.outcome]

/** The latest run of each subject and kind: a later fix supersedes a failure. */
export const latest = (activity: readonly Activity[]): Activity[] => {
  const seen = new Map<string, Activity>()
  for (const a of activity) seen.set(`${a.kind}:${a.file ?? a.subject}`, a)
  return [...seen.values()]
}

export type Tile = { label: string; level: Level; text: string }

/** The cockpit's four areas, each with its worst current state. */
export const tiles = (cockpit: Cockpit): Tile[] => {
  const current = latest(cockpit.activity)
  const area = (label: string, kinds: ActivityKind[], noun: string): Tile => {
    const runs = current.filter(a => kinds.includes(a.kind))
    if (runs.length === 0) return { label, level: 'healthy', text: 'none yet' }
    const failed = runs.filter(a => a.outcome === 'failed').length
    const blocked = runs.filter(a => a.outcome === 'blocked').length
    const running = runs.filter(a => a.outcome === 'running').length
    const warned = runs.filter(a => levelOf(a) === 'warning' && a.outcome === 'ok').length
    const ok = runs.length - failed - blocked - running - warned
    const parts = [
      failed && `${failed} failed`,
      blocked && `${blocked} blocked`,
      running && `${running} running`,
      warned && `${warned} warned`,
      ok && `${ok} ok`,
    ].filter(Boolean)
    return { label, level: worst(runs.map(levelOf)), text: `${plural(runs.length, noun)}: ${parts.join(', ')}` }
  }
  const platform = cockpit.platform
  const errors = platform.runs.filter(run => isFailedStatus(run.status)).length
  const changed = cockpit.watched.filter(w => w.changedBy).length
  const platformTile: Tile =
    platform.phase === 'off'
      ? { label: 'Platform', level: 'healthy', text: platform.message }
      : platform.phase === 'error'
        ? { label: 'Platform', level: 'serious', text: platform.message }
        : {
            label: 'Platform',
            level: errors ? 'critical' : changed ? 'warning' : 'healthy',
            text: [
              `${plural(platform.runs.length, 'recent run')}, ${plural(errors, 'error')}`,
              cockpit.watched.length > 0 && `${changed} of ${cockpit.watched.length} watched changed`,
            ]
              .filter(Boolean)
              .join(' · '),
          }
  return [
    area('Builds', ['create', 'push'], 'component'),
    area('Tests', ['test'], 'process'),
    area('Deploys', ['deploy', 'undeploy'], 'deployment'),
    platformTile,
  ]
}

export const formatCost = (usd: number | undefined): string | undefined =>
  usd === undefined ? undefined : `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(0)}`

/** The status line: an icon and a label per area that has something, then the cost. */
export const statusLine = (cockpit: Cockpit, usd?: number): string => {
  const current = latest(cockpit.activity)
  const count = (kinds: ActivityKind[], outcome: Outcome) =>
    current.filter(a => kinds.includes(a.kind) && a.outcome === outcome).length
  const parts: string[] = []
  const built = count(['create', 'push'], 'ok')
  const buildFails = count(['create', 'push'], 'failed') + count(['create', 'push', 'deploy'], 'blocked')
  if (built) parts.push(`✓ ${built} built`)
  if (buildFails) parts.push(`✗ ${buildFails} build failed`)
  const testsFailed = count(['test'], 'failed')
  const testsPassed = count(['test'], 'ok')
  if (testsFailed) parts.push(`✗ ${testsFailed} test${testsFailed === 1 ? '' : 's'} failed`)
  else if (testsPassed) parts.push(`✓ ${testsPassed} test${testsPassed === 1 ? '' : 's'} passed`)
  const deployFails = count(['deploy', 'undeploy'], 'failed')
  const deployed = count(['deploy'], 'ok')
  if (deployFails) parts.push(`✗ ${deployFails} deploy failed`)
  else if (deployed) parts.push(`✓ ${deployed} deployed`)
  const running = current.filter(a => a.outcome === 'running').length
  if (running) parts.push(`◐ ${running} running`)
  const errors = cockpit.platform.runs.filter(run => isFailedStatus(run.status)).length
  if (errors) parts.push(`⚠ ${plural(errors, 'platform error')}`)
  const changed = cockpit.watched.filter(w => w.changedBy).length
  if (changed) parts.push(`◐ ${changed} watched changed`)
  if (parts.length === 0) parts.push('no Companion activity yet')
  const cost = formatCost(usd)
  if (cost) parts.push(cost)
  return `Cockpit ${parts.join(' · ')}`
}

const time = (ms: number): string => new Date(ms).toISOString().slice(11, 19)

const activityLine = (a: Activity): string => {
  const level = STATUS[levelOf(a)]
  const what = a.outcome === 'blocked' ? 'blocked' : a.outcome === 'running' ? 'running' : VERB[a.kind]
  const version = a.version ? ` v${a.version}` : ''
  return `${level.icon} ${time(a.startedAt)} ${a.kind.padEnd(8)} ${a.subject}${version}: ${what === VERB[a.kind] ? a.detail : `${what}, ${a.detail}`}`
}

export type Usage = { usd?: number; contextPercent?: number }

/** The whole cockpit as text: what /cockpit and Claude's summary tool show. */
export const summary = (cockpit: Cockpit, usage: Usage, recent = 10): string => {
  const lines = [statusLine(cockpit, usage.usd), '']
  for (const tile of tiles(cockpit)) {
    lines.push(`${STATUS[tile.level].icon} ${tile.label.padEnd(9)} ${tile.text}`)
  }
  const cost = formatCost(usage.usd)
  const context = usage.contextPercent === undefined ? undefined : `context ${Math.round(usage.contextPercent)}% full`
  if (cost || context) lines.push(`  Session   ${[cost && `${cost} so far`, context].filter(Boolean).join(' · ')}`)

  if (cockpit.activity.length > 0) {
    lines.push('', 'Recent Companion activity:')
    for (const a of cockpit.activity.slice(-recent).reverse()) lines.push(`  ${activityLine(a)}`)
  }
  if (cockpit.platform.runs.length > 0) {
    lines.push('', `Recent runs in environment ${cockpit.platform.environmentId ?? ''}:`.replace(' :', ':'))
    for (const run of cockpit.platform.runs) lines.push(`  ${runLine(run)}`)
  }
  if (cockpit.watched.length > 0) {
    lines.push('', 'Watched components:')
    for (const w of cockpit.watched) lines.push(`  ${watchedLine(w)}`)
  }
  return lines.join('\n')
}

export const runLevel = (run: Run): Level =>
  isFailedStatus(run.status) ? 'critical' : isWarnStatus(run.status) ? 'warning' : /COMPLETE/i.test(run.status) ? 'healthy' : 'warning'

export const runLine = (run: Run): string =>
  `${STATUS[runLevel(run)].icon} ${run.status} ${run.processName} (${run.at}, ${run.executionId})`

export const watchedLevel = (w: Watched): Level => (w.error ? 'serious' : w.changedBy ? 'warning' : 'healthy')

export const watchedLine = (w: Watched): string => {
  const icon = STATUS[watchedLevel(w)].icon
  const name = w.name ?? w.componentId
  if (w.error) return `${icon} ${name}: ${w.error}`
  const version = w.version ? ` v${w.version}` : ''
  const by = w.modifiedBy ? ` by ${w.modifiedBy}` : ''
  const when = w.modifiedDate ? ` on ${w.modifiedDate}` : ''
  return `${icon} ${name}${version}${w.changedBy ? `, changed${by}${when}` : `, unchanged since watched (last edit${by}${when})`}`
}

/**
 * The watched component as the platform now has it, compared with what the
 * cockpit last saw. `changedBy` is set when the version moved and someone other
 * than `me` (Companion's API user) made the change.
 */
export const compareWatched = (
  before: Watched,
  now: { name?: string; version?: string; modifiedBy?: string; modifiedDate?: string },
  me: string | undefined,
): { next: Watched; isNewChange: boolean } => {
  const moved = before.version !== undefined && now.version !== undefined && now.version !== before.version
  const byOther = moved && (!me || !now.modifiedBy || now.modifiedBy.toLowerCase() !== me.toLowerCase())
  const next: Watched = {
    componentId: before.componentId,
    name: now.name ?? before.name,
    version: now.version ?? before.version,
    modifiedBy: now.modifiedBy ?? before.modifiedBy,
    modifiedDate: now.modifiedDate ?? before.modifiedDate,
    changedBy: byOther ? (now.modifiedBy ?? 'someone') : before.changedBy,
  }
  return { next, isNewChange: byOther }
}

/** The runs in `fresh` that failed and aren't in `known`: what deserves a toast. */
export const newFailures = (known: readonly Run[], fresh: readonly Run[]): Run[] => {
  const ids = new Set(known.map(run => run.executionId))
  return fresh.filter(run => !ids.has(run.executionId) && isFailedStatus(run.status))
}

/** The ID and name on a component XML's root element. */
export const componentOf = (xml: string): { componentId?: string; name?: string } => {
  const root = xml.match(/<(?:[A-Za-z]+:)?Component\b[^>]*>/)?.[0] ?? ''
  const attr = (name: string) => root.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || undefined
  return { componentId: attr('componentId'), name: attr('name') }
}
