// Reads Boomi Companion's work from Claude's tool calls and their output, and
// turns it into the dashboard's views: each component's stage, what needs
// attention, the recent feed and the live environment. Plain functions:
// nothing here touches the engine, so the tests call them directly.

import type { Activity, ActivityKind, Dashboard, Ledger, Outcome, Run, Watched } from '../types'

const SCRIPTS: Record<string, ActivityKind> = {
  'boomi-component-create.sh': 'create',
  'boomi-component-push.sh': 'push',
  'boomi-component-pull.sh': 'pull',
  'boomi-deploy.sh': 'deploy',
  'boomi-undeploy.sh': 'undeploy',
  'boomi-test-execute.sh': 'test',
}

/** Companion's shared library, sourced by every script: never a run of its own. */
const NOT_A_RUN = new Set(['boomi-common.sh'])

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
const TAKES_VALUE = new Set([
  '--branch',
  '--deployment-notes',
  '--test-data',
  '--process-id',
  '--by-component',
  '--component-id',
  '--execution-id',
])

export type ScriptRun = {
  kind: ActivityKind
  file?: string
  processId?: string
  componentId?: string
  deploymentId?: string
  /** For `other`: the script's name without `boomi-` and `.sh`. */
  script?: string
}

const kindOf = (word: string): { kind: ActivityKind; script?: string } | undefined => {
  const name = word.split('/').pop() ?? ''
  if (NOT_A_RUN.has(name)) return undefined
  const kind = SCRIPTS[name]
  if (kind) return { kind }
  const other = name.match(/^boomi-([a-z0-9-]+)\.sh$/)
  return other ? { kind: 'other', script: other[1] } : undefined
}

/**
 * The Companion scripts a shell command runs, with what each names. Help and
 * connection checks touch nothing, so they're left out. A script inside a
 * quoted `bash -c '...'` is found too.
 */
export const scriptRuns = (command: string): ScriptRun[] => {
  const runs: ScriptRun[] = []
  const tokens = words(command)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (/\s/.test(token) && token.includes('boomi-')) {
      runs.push(...scriptRuns(token))
      continue
    }
    const found = kindOf(token)
    if (!found) continue
    const args: string[] = []
    for (const arg of tokens.slice(i + 1)) {
      if (SEPARATOR.test(arg)) break
      args.push(arg)
    }
    if (args.some(arg => ['-h', '--help', '--test-connection', '--list-environments'].includes(arg))) continue
    const run: ScriptRun = { kind: found.kind }
    if (found.script) run.script = found.script
    for (let j = 0; j < args.length; j++) {
      const arg = args[j]!
      const value = args[j + 1]
      if (arg === '--process-id' && value) run.processId = value
      else if (arg === '--component-id' && value) run.componentId = value
      else if (arg === '--by-component' && value) run.file = value
      if (TAKES_VALUE.has(arg)) {
        j++
        continue
      }
      if (arg.startsWith('-')) continue
      if (arg.endsWith('.xml')) run.file = arg
      else if (found.kind === 'undeploy') run.deploymentId = arg
    }
    runs.push(run)
  }
  return runs
}

/**
 * A component file's path from the components folder on, so a relative path
 * from a script and an absolute one from an edit name the same component.
 * Undefined for a file that isn't component XML under that folder.
 */
export const componentPath = (path: string, dir = 'active-development'): string | undefined => {
  if (!path.endsWith('.xml')) return undefined
  const folder = dir.replace(/^\.?\/+|\/+$/g, '')
  const parts = path.split('/')
  const at = parts.lastIndexOf(folder)
  if (at < 0) return undefined
  const rest = parts.slice(at + 1)
  if (rest.length === 0 || rest[0] === 'inventories') return undefined
  return [folder, ...rest].join('/')
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
 * What a Companion script's output says happened. Most scripts end with a
 * `SUCCESS:` or `ERROR:` line; a test prints its execution's status instead.
 */
export const readOutput = (kind: ActivityKind, output: string, isError: boolean): Reading => {
  const success = firstLine(output, /^\s*SUCCESS:/)
  const error = firstLine(output, /^\s*ERROR:/)
  const already = kind === 'create' ? firstLine(output, /already exists with ID:/) : undefined
  const unchanged = kind === 'push' ? firstLine(output, /nothing sent to the platform/) : undefined
  // Scripts that only read report no SUCCESS line: no error is success.
  const reads = kind === 'pull' || kind === 'other'
  const reading: Reading = {
    outcome: !isError && !error && (reads || success || already || unchanged) ? 'ok' : 'failed',
    detail: shorten(error ?? success ?? already ?? unchanged ?? (isError ? 'failed' : 'done')),
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

/** The ID, name and type on a component XML's root element. */
export const componentOf = (xml: string): { componentId?: string; name?: string; type?: string } => {
  const root = xml.match(/<(?:[A-Za-z]+:)?Component\b[^>]*>/)?.[0] ?? ''
  const attr = (name: string) => root.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || undefined
  return { componentId: attr('componentId'), name: attr('name'), type: attr('type') }
}

const TYPE_NAMES: Record<string, string> = {
  process: 'process',
  'connector-settings': 'connection',
  'connector-action': 'operation',
  'transform.map': 'map',
  'transform.function': 'map function',
  processproperty: 'process property',
  certificate: 'certificate',
  crossref: 'cross reference',
  'documentcache': 'document cache',
  webservice: 'API service',
  'webservice.external': 'API proxy',
  flowservice: 'flow service',
  script: 'script',
  'script.processing': 'script',
  'script.mapping': 'map script',
}

/** A component type in plain words: `connector-settings` is a connection. */
export const friendlyType = (type: string | undefined): string | undefined => {
  if (!type) return undefined
  if (TYPE_NAMES[type]) return TYPE_NAMES[type]
  if (type.startsWith('profile.')) return `${type.slice('profile.'.length).toUpperCase()} profile`
  return type
}

// --- Status --------------------------------------------------------------------

export const STATUS = {
  healthy: { icon: '✓', color: '#0CA30C' },
  warning: { icon: '◐', color: '#FAB219' },
  serious: { icon: '⚠', color: '#EC835A' },
  critical: { icon: '✗', color: '#D03B3B' },
} as const

export type Level = keyof typeof STATUS

const RANK: Level[] = ['healthy', 'warning', 'serious', 'critical']
export const worst = (levels: readonly Level[]): Level =>
  levels.reduce<Level>((a, b) => (RANK.indexOf(b) > RANK.indexOf(a) ? b : a), 'healthy')

const LEVEL_OF: Record<Outcome, Level> = { ok: 'healthy', running: 'warning', failed: 'critical', blocked: 'serious' }

export const levelOf = (a: Activity): Level =>
  a.outcome === 'ok' && isWarnStatus(a.executionStatus) ? 'warning' : LEVEL_OF[a.outcome]

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** How long ago, in words a person reads at a glance. */
export const ago = (then: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const SCRIPT_WORDS: Record<string, string> = {
  'component-search': 'Searched components',
  'component-diff': 'Compared a component',
  'execution-query': 'Read execution results',
  'env-check': 'Checked the Boomi connection',
  'folder-create': 'Created a folder',
  'folder-list': 'Listed folders',
  extensions: 'Read environment extensions',
  branch: 'Worked with branches',
  'version-history': 'Read version history',
  'shared-server-info': 'Read shared server info',
  'wss-test': 'Tested a web service listener',
}

/** One activity as a sentence: "Saved Orders Sync to Boomi (v4)". */
export const describe = (a: Activity): string => {
  if (a.outcome === 'running') {
    const doing: Record<ActivityKind, string> = {
      edit: 'Editing',
      create: 'Creating',
      push: 'Saving',
      pull: 'Pulling',
      deploy: 'Deploying',
      undeploy: 'Undeploying',
      test: 'Testing',
      other: 'Running',
    }
    return `${doing[a.kind]} ${a.kind === 'other' ? (SCRIPT_WORDS[a.script ?? ''] ?? a.script ?? 'a Companion script').toLowerCase() : a.subject}…`
  }
  if (a.outcome === 'blocked') return `Blocked: ${a.kind === 'other' ? a.script : `${a.kind} of ${a.subject}`}`
  if (a.outcome === 'failed') {
    const what: Record<ActivityKind, string> = {
      edit: 'Edit',
      create: 'Create',
      push: 'Save',
      pull: 'Pull',
      deploy: 'Deploy',
      undeploy: 'Undeploy',
      test: 'Test',
      other: SCRIPT_WORDS[a.script ?? ''] ?? `boomi-${a.script}`,
    }
    if (a.kind === 'test' && a.executionStatus) return `Test of ${a.subject} ended ${a.executionStatus}`
    return `${what[a.kind]}${a.kind === 'other' ? '' : ` of ${a.subject}`} failed`
  }
  const version = a.version ? ` (v${a.version})` : ''
  switch (a.kind) {
    case 'edit':
      return `Edited ${a.subject}`
    case 'create':
      return `Created ${a.subject} in Boomi`
    case 'push':
      return /nothing sent/.test(a.detail) ? `${a.subject} already up to date in Boomi` : `Saved ${a.subject} to Boomi${version}`
    case 'pull':
      return `Pulled ${a.subject} from Boomi`
    case 'deploy':
      return `Deployed ${a.subject}`
    case 'undeploy':
      return `Undeployed ${a.subject}`
    case 'test':
      return a.executionStatus ? `Test of ${a.subject} ${a.executionStatus === 'COMPLETE' ? 'passed' : `ended ${a.executionStatus}`}` : `Test of ${a.subject} ${a.detail}`
    case 'other':
      return SCRIPT_WORDS[a.script ?? ''] ?? `Ran boomi-${a.script}`
  }
}

// --- Components ------------------------------------------------------------------

/** One component this session, with the latest of each step it went through. */
export type ComponentRow = {
  key: string
  name: string
  type?: string
  componentId?: string
  edited?: Activity
  saved?: Activity
  deployed?: Activity
  tested?: Activity
  lastAt: number
  /** Every activity of this component, for its total spend. */
  ids: number[]
}

/** Each component Claude edited, saved, deployed or tested, most recent first. */
export const components = (activity: readonly Activity[]): ComponentRow[] => {
  const rows = new Map<string, ComponentRow>()
  const byId = new Map<string, ComponentRow>()
  for (const a of activity) {
    if (a.kind === 'other') continue
    const key = a.file ?? (a.componentId && byId.get(a.componentId)?.key) ?? a.componentId ?? a.subject
    const row: ComponentRow = rows.get(key) ?? { key, name: a.subject, lastAt: a.startedAt, ids: [] }
    row.ids.push(a.id)
    if (!/\.xml$/.test(a.subject) || row.name === key || /\.xml$/.test(row.name)) row.name = a.subject
    row.type = a.type ?? row.type
    row.componentId = a.componentId ?? row.componentId
    row.lastAt = Math.max(row.lastAt, a.endedAt ?? a.startedAt)
    if (a.kind === 'edit') row.edited = a
    else if (a.kind === 'create' || a.kind === 'push' || a.kind === 'pull') row.saved = a
    else if (a.kind === 'deploy' || a.kind === 'undeploy') row.deployed = a
    else if (a.kind === 'test') row.tested = a
    rows.set(key, row)
    if (row.componentId) byId.set(row.componentId, row)
  }
  return [...rows.values()].sort((a, b) => b.lastAt - a.lastAt)
}

export type Stage = { level: Level; text: string }

const when = (a: Activity) => a.endedAt ?? a.startedAt

/** A component's journey as short steps, each with an icon and a label. */
export const stages = (row: ComponentRow): Stage[] => {
  const out: Stage[] = []
  const { edited, saved, deployed, tested } = row
  const savedOk = saved && saved.outcome === 'ok' && saved.kind !== 'pull'

  if (edited && (!saved || when(edited) > when(saved))) {
    out.push({ level: 'warning', text: saved ? 'edited since last save' : 'edited, not in Boomi yet' })
  }
  if (saved) {
    if (saved.outcome === 'running') out.push({ level: 'warning', text: 'saving…' })
    else if (saved.outcome === 'blocked') out.push({ level: 'serious', text: 'save blocked' })
    else if (saved.outcome === 'failed') out.push({ level: 'critical', text: 'save failed' })
    else if (saved.kind === 'pull') out.push({ level: 'healthy', text: 'pulled from Boomi' })
    else out.push({ level: 'healthy', text: saved.version ? `saved v${saved.version}` : saved.kind === 'create' ? 'created in Boomi' : 'saved' })
  }
  if (deployed) {
    if (deployed.outcome === 'running') out.push({ level: 'warning', text: 'deploying…' })
    else if (deployed.outcome === 'blocked') out.push({ level: 'serious', text: 'deploy blocked' })
    else if (deployed.outcome === 'failed') out.push({ level: 'critical', text: `${deployed.kind} failed` })
    else if (deployed.kind === 'undeploy') out.push({ level: 'healthy', text: 'undeployed' })
    else if (savedOk && saved && when(saved) > when(deployed)) out.push({ level: 'warning', text: 'redeploy needed' })
    else out.push({ level: 'healthy', text: 'deployed' })
  }
  if (tested) {
    if (tested.outcome === 'running') out.push({ level: 'warning', text: 'testing…' })
    else if (tested.outcome === 'failed') out.push({ level: 'critical', text: `test ${tested.executionStatus ?? 'failed'}` })
    else if (tested.outcome === 'blocked') out.push({ level: 'serious', text: 'test blocked' })
    else out.push({ level: levelOf(tested), text: tested.executionStatus === 'COMPLETE' || !tested.executionStatus ? 'test passed' : `test ${tested.executionStatus}` })
  }
  return out
}

// --- What needs attention --------------------------------------------------------

export type Attention = { level: Level; title: string; hint: string; at: number }

/** Runs in the window, newest first: a run from last month isn't news. */
export const recentRuns = (runs: readonly Run[], now: number, windowMs: number): Run[] =>
  runs.filter(run => {
    const at = Date.parse(run.at)
    return Number.isNaN(at) || now - at <= windowMs
  })

/** What failed and is still failing, each with what to do about it. */
export const attention = (dashboard: Dashboard, now: number, windowMs: number): Attention[] => {
  const items: Attention[] = []
  for (const row of components(dashboard.activity)) {
    for (const a of [row.saved, row.deployed, row.tested]) {
      if (!a || (a.outcome !== 'failed' && a.outcome !== 'blocked')) continue
      const hint =
        a.outcome === 'blocked'
          ? a.detail
          : a.kind === 'test'
            ? `Ask Claude to read the execution log${a.executionId ? ` (${a.executionId.replace(/^execution-/, '').slice(0, 8)}…)` : ''} and fix the process.`
            : a.detail
      items.push({ level: levelOf(a), title: describe(a), hint, at: when(a) })
    }
  }
  for (const run of recentRuns(dashboard.platform.runs, now, windowMs)) {
    if (!isFailedStatus(run.status)) continue
    const at = Date.parse(run.at)
    items.push({
      level: 'critical',
      title: `${run.processName} ended ${run.status} in the environment`,
      hint: `Ask Claude to look at execution ${run.executionId.replace(/^execution-/, '').slice(0, 8)}…`,
      at: Number.isNaN(at) ? now : at,
    })
  }
  for (const w of dashboard.watched) {
    if (w.changedBy) {
      items.push({
        level: 'warning',
        title: `${w.name ?? w.componentId} was changed by ${w.changedBy}`,
        hint: 'Pull it before you push, or you overwrite their change. /bc-dashboard seen clears this.',
        at: w.modifiedDate ? Date.parse(w.modifiedDate) || now : now,
      })
    }
  }
  return items.sort((a, b) => b.at - a.at)
}

// --- Tokens and spend --------------------------------------------------------------

export const EMPTY_LEDGER: Ledger = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, models: {} }

/** A model id in words: claude-opus-5-5 is Opus 5.5; an id it can't read stays as it is. */
export const modelName = (id: string | undefined): string | undefined => {
  if (!id) return undefined
  const found = id.match(/claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/)
  if (!found) return id
  const [, family = '', major, minor] = found
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

/** Each model's tokens, biggest first, in words: Opus 5.5 312k · Haiku 5.5 26k. */
export const modelMix = (l: Ledger): string =>
  Object.entries(l.models ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([id, tokens]) => `${modelName(id)} ${formatTokens(tokens)}`)
    .join(' · ')

/** Every token the session's model calls used: input, output and the prompt cache's. */
export const totalTokens = (l: Ledger): number => l.input + l.output + l.cacheRead + l.cacheWrite

/** A token count at a glance: 950, 4.2k, 312k, 1.24M. */
export const formatTokens = (n: number): string => {
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export type Spend = { tokens?: number; usd?: number }

/**
 * What Claude spent getting to each step: the session's tokens and cost when
 * the step began, less those when the step before it began.
 */
export const spends = (activity: readonly Activity[]): Map<number, Spend> => {
  const out = new Map<number, Spend>()
  let tokens = 0
  let usd: number | undefined
  for (const a of activity) {
    const spend: Spend = {}
    if (a.tokensAt !== undefined) {
      spend.tokens = Math.max(0, a.tokensAt - tokens)
      tokens = a.tokensAt
    }
    if (a.usdAt !== undefined) {
      if (usd !== undefined) spend.usd = Math.max(0, a.usdAt - usd)
      else spend.usd = a.usdAt
      usd = a.usdAt
    }
    out.set(a.id, spend)
  }
  return out
}

/** A component's spend: every step it went through, summed. */
export const spendOf = (ids: readonly number[], all: Map<number, Spend>): Spend => {
  let tokens: number | undefined
  let usd: number | undefined
  for (const id of ids) {
    const s = all.get(id)
    if (s?.tokens !== undefined) tokens = (tokens ?? 0) + s.tokens
    if (s?.usd !== undefined) usd = (usd ?? 0) + s.usd
  }
  return { tokens, usd }
}

export const formatSpend = (s: Spend | undefined): string | undefined => {
  if (!s) return undefined
  const parts = [s.tokens ? `${formatTokens(s.tokens)} tokens` : undefined, s.usd ? formatCost(s.usd) : undefined]
  const text = parts.filter(Boolean).join(' · ')
  return text || undefined
}

const BARS = '▁▂▃▄▅▆▇█'

/** A sparkline of the values: one bar each, tallest for the biggest. */
export const sparkline = (values: readonly number[]): string => {
  const max = Math.max(...values, 0)
  if (max <= 0) return ''
  return values.map(v => BARS[Math.min(BARS.length - 1, Math.floor((v / max) * (BARS.length - 1) + 0.5))] ?? BARS[0]).join('')
}

/** A meter for a percentage: ▰▰▰▱▱▱▱▱▱▱. */
export const meter = (percent: number, width = 10): string => {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

// --- The summary lines ------------------------------------------------------------

export const formatCost = (usd: number | undefined): string | undefined =>
  usd === undefined ? undefined : `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(0)}`

/** The newest finished activity worth a headline: edits and reads don't make news. */
export const headline = (activity: readonly Activity[]): Activity | undefined =>
  [...activity].reverse().find(a => a.kind !== 'other' && a.kind !== 'edit') ?? activity[activity.length - 1]

/**
 * The status line: the latest thing Companion did, then what needs attention,
 * then the session's tokens and cost. The engine prefixes it with the mod's name.
 */
export const statusLine = (dashboard: Dashboard, now: number, windowMs: number, usage: Usage = {}): string => {
  const parts: string[] = []
  const latest = headline(dashboard.activity)
  if (latest) parts.push(`${STATUS[levelOf(latest)].icon} ${describe(latest)}`)
  const needs = attention(dashboard, now, windowMs)
  if (needs.length > 0) parts.push(`${STATUS[worst(needs.map(n => n.level))].icon} ${needs.length} need${needs.length === 1 ? 's' : ''} attention`)
  if (parts.length === 0) parts.push('waiting for Companion')
  const spent = [usage.tokens ? `${formatTokens(usage.tokens)} tokens` : undefined, formatCost(usage.usd)].filter(Boolean)
  if (spent.length > 0) parts.push(`${spent.join(' · ')} this session`)
  return parts.join(' · ')
}

export type Usage = {
  usd?: number
  contextPercent?: number
  tokens?: number
  startedAt?: number
  /** The model that answered the latest call, and each model's tokens in words. */
  model?: string
  models?: string
}

/** How long something has run: 45s, 12m, 1h 12m. */
export const duration = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return `${Math.max(0, Math.round(ms / 1000))}s`
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** The whole dashboard as text: what /bc-dashboard and Claude's summary tool show. */
export const summary = (dashboard: Dashboard, usage: Usage, now: number, windowMs: number): string => {
  const hours = Math.round(windowMs / 3_600_000)
  const lines: string[] = []
  const needs = attention(dashboard, now, windowMs)
  lines.push(needs.length > 0 ? `Needs attention (${needs.length}):` : '✓ Nothing needs attention.')
  for (const n of needs) lines.push(`  ${STATUS[n.level].icon} ${n.title}`, `      ${n.hint}`)

  const all = spends(dashboard.activity)
  const rows = components(dashboard.activity)
  lines.push('', rows.length > 0 ? 'Components this session:' : 'Components this session: none yet. They show up as Claude edits, saves, deploys and tests them.')
  for (const row of rows) {
    const type = friendlyType(row.type)
    const spent = formatSpend(spendOf(row.ids, all))
    lines.push(`  ${row.name}${type ? ` (${type})` : ''}: ${stages(row).map(s => `${STATUS[s.level].icon} ${s.text}`).join('  ')}${spent ? `  [${spent}]` : ''}`)
  }

  const feed = dashboard.activity.slice(-8).reverse()
  if (feed.length > 0) {
    lines.push('', 'Recently:')
    for (const a of feed) {
      const spent = formatSpend(all.get(a.id))
      lines.push(`  ${STATUS[levelOf(a)].icon} ${describe(a)}, ${ago(when(a), now)}${spent ? `  [${spent}]` : ''}`)
    }
  }

  lines.push('', `Live environment, last ${hours}h:`)
  if (dashboard.platform.phase !== 'ok') lines.push(`  ${dashboard.platform.message}`)
  else {
    const runs = recentRuns(dashboard.platform.runs, now, windowMs)
    if (runs.length === 0) lines.push('  No runs.')
    for (const run of runs) lines.push(`  ${runLine(run, now)}`)
  }
  if (dashboard.watched.length > 0) {
    lines.push('', 'Watched components:')
    for (const w of dashboard.watched) lines.push(`  ${watchedLine(w)}`)
  }

  const cost = formatCost(usage.usd)
  const tokens = usage.tokens ? `${formatTokens(usage.tokens)} tokens` : undefined
  const context = usage.contextPercent === undefined ? undefined : `context ${Math.round(usage.contextPercent)}% full`
  if (cost || tokens || context) lines.push('', `Session: ${[tokens, cost && `${cost} so far`, context].filter(Boolean).join(' · ')}`)
  if (usage.models) lines.push(`Models: ${usage.models}`)
  return lines.join('\n')
}

export const runLevel = (run: Run): Level =>
  isFailedStatus(run.status) ? 'critical' : isWarnStatus(run.status) ? 'warning' : /COMPLETE/i.test(run.status) ? 'healthy' : 'warning'

const RUN_WORDS: Record<string, string> = {
  COMPLETE: 'completed',
  COMPLETE_WARN: 'completed with warnings',
  ERROR: 'failed',
  ABORTED: 'aborted',
  DISCARDED: 'discarded',
  INPROCESS: 'running',
  STARTED: 'started',
}

export const runText = (run: Run, now: number): string => {
  const at = Date.parse(run.at)
  return `${run.processName} ${RUN_WORDS[run.status] ?? run.status.toLowerCase()}${Number.isNaN(at) ? '' : `, ${ago(at, now)}`}`
}

export const runLine = (run: Run, now: number): string => `${STATUS[runLevel(run)].icon} ${runText(run, now)}`

export const watchedLevel = (w: Watched): Level => (w.error ? 'serious' : w.changedBy ? 'warning' : 'healthy')

export const watchedText = (w: Watched): string => {
  const name = w.name ?? w.componentId
  if (w.error) return `${name}: ${w.error}`
  const version = w.version ? ` v${w.version}` : ''
  return w.changedBy ? `${name}${version}, changed by ${w.changedBy}` : `${name}${version}, no changes by others`
}

export const watchedLine = (w: Watched): string => `${STATUS[watchedLevel(w)].icon} ${watchedText(w)}`

/**
 * The watched component as the platform now has it, compared with what the
 * dashboard last saw. `changedBy` is set when the version moved and someone other
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

// --- The flamingo ---------------------------------------------------------------
// An 8-bit flamingo, 12 pixels wide and 16 tall. Each letter is a pixel:
// P is the flamingo's pink, L its pastel (wing and beak), K ink (eye and beak
// tip), and a dot is clear. Two pixel rows make one row of terminal cells.

const HEAD = [
  '....PPP.....',
  '...PPKPP....',
  '...PPPPLL...',
  '....PP.LK...',
  '....PP......',
  '.....PP.....',
  '......PP....',
  '.....PP.....',
]

const WING_DOWN = ['....PPPPPP..', '...PPLLLLPPP', '...PPPLLLPP.', '.....PPPP...']
const WING_UP = ['....PPLLLP..', '...PPLLLLPPP', '...PPPPPPPP.', '.....PPPP...']

const ONE_LEG = ['......PPP...', '......P.....', '......P.....', '.....PP.....']
const STRIDE = ['......P.....', '.....P.P....', '....P...P...', '...PP...PP..']
const STEP = ['......P.....', '......PP....', '.....P..P...', '....PP...PP.']

/** Standing on one leg while Claude is idle. */
export const FLAMINGO_IDLE: readonly string[] = [...HEAD, ...WING_DOWN, ...ONE_LEG]

/** Walking, wings flapping, while Claude works: one frame per tick. */
export const FLAMINGO_WALK: readonly (readonly string[])[] = [
  [...HEAD, ...WING_DOWN, ...STRIDE],
  [...HEAD, ...WING_UP, ...STEP],
  [...HEAD, ...WING_DOWN, ...STEP],
  [...HEAD, ...WING_UP, ...STRIDE],
]

/** The flamingo's pixels for a frame: walking while working, else standing. */
export const flamingo = (isWorking: boolean, frame: number): readonly string[] =>
  isWorking ? FLAMINGO_WALK[frame % FLAMINGO_WALK.length]! : FLAMINGO_IDLE

/** One terminal cell: a character, its color and its background, either absent for clear. */
export type Cell = { char: string; color?: string; bg?: string }

/**
 * Pixel rows as terminal cells, two pixel rows to a cell: ▀ in the top pixel's
 * color over the bottom pixel's, ▄ when only the bottom is set, a space when
 * neither is. `colors` maps each pixel letter to a color.
 */
export const pixelCells = (pixels: readonly string[], colors: Record<string, string>): Cell[][] => {
  const rows: Cell[][] = []
  for (let y = 0; y < pixels.length; y += 2) {
    const top = pixels[y] ?? ''
    const bottom = pixels[y + 1] ?? ''
    const row: Cell[] = []
    for (let x = 0; x < Math.max(top.length, bottom.length); x++) {
      const up = colors[top[x] ?? '.']
      const down = colors[bottom[x] ?? '.']
      if (up && down) row.push({ char: up === down ? '█' : '▀', color: up, bg: up === down ? undefined : down })
      else if (up) row.push({ char: '▀', color: up })
      else if (down) row.push({ char: '▄', color: down })
      else row.push({ char: ' ' })
    }
    rows.push(row)
  }
  return rows
}
