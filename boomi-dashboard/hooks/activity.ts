// Reads Boomi Companion's work from Claude's tool calls and their output, and
// turns it into the dashboard's views: each component's stage, what needs
// attention, the recent feed and the live environment. Plain functions:
// nothing here touches the engine, so the tests call them directly.

import type { Activity, ActivityKind, Dashboard, Ledger, Outcome, PastSession, Run, RuntimeSeen, SessionRecap, StandardsSeen, TokenSplit, Watched } from '../types'

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
    } else if (ch === '\n' || ch === '\r') {
      // A new line starts a new command, as a semicolon does.
      flush()
      out.push(';')
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
  /** The folder the script ran from, when the command names it: where Companion's scripts are. */
  scriptsDir?: string
  /** A test's arguments, so it can be run again. */
  args?: string[]
}

const kindOf = (word: string): { kind: ActivityKind; script?: string } | undefined => {
  const name = word.split('/').pop() ?? ''
  if (NOT_A_RUN.has(name)) return undefined
  const kind = SCRIPTS[name]
  if (kind) return { kind }
  // event-streams-setup.sh is Companion's too, though not named boomi-*.
  if (name === 'event-streams-setup.sh') return { kind: 'other', script: 'event-streams-setup' }
  const other = name.match(/^boomi-([a-z0-9-]+)\.sh$/)
  return other ? { kind: 'other', script: other[1] } : undefined
}

/** Words that run the command after them: `bash x.sh`, `env A=1 x.sh`, `timeout 60 x.sh`. */
const RUNNERS = new Set(['bash', 'sh', 'zsh', 'source', '.', 'exec', 'env', 'command', 'nohup', 'time', 'sudo', 'timeout', 'xargs'])

/** Shell words that start a command inside a loop or condition: `do bash x.sh`, `then ./x.sh`. */
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{'])

/**
 * Whether the word at `i` is what its simple command runs: the first word
 * after the last separator, past variable assignments, runners such as
 * `bash` or `timeout 60`, and their flags. A script named as an argument
 * (`cat boomi-deploy.sh`, `grep x boomi-deploy.sh`) is not run.
 */
const isRun = (tokens: readonly string[], i: number): boolean => {
  let start = i
  while (start > 0 && !SEPARATOR.test(tokens[start - 1]!)) start--
  for (let j = start; j < i; j++) {
    const word = tokens[j]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || RUNNERS.has(word) || KEYWORDS.has(word) || word.startsWith('-') || /^\d+[smh]?$/.test(word)) continue
    return false
  }
  return true
}

/** `dir` joined with `path`, `.` and `..` resolved; an absolute path stands alone. */
const joinPath = (dir: string, path: string): string => {
  const parts = (path.startsWith('/') || !dir ? path : `${dir}/${path}`).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '.' || (part === '' && out.length > 0)) continue
    if (part === '..' && out.length > 0 && out[out.length - 1] !== '..' && out[out.length - 1] !== '') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/**
 * The Companion scripts a shell command runs, with what each names. Help and
 * connection checks touch nothing, so they're left out, as is a script only
 * read or searched. A file named after a `cd` is taken from that folder, and
 * a script inside a quoted `bash -c '...'` is found too.
 */
export const scriptRuns = (command: string): ScriptRun[] => {
  const runs: ScriptRun[] = []
  const tokens = words(command)
  let dir = ''
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (/\s/.test(token) && token.includes('boomi-')) {
      runs.push(...scriptRuns(dir ? `cd ${dir} && ${token}` : token))
      continue
    }
    const following = tokens[i + 1]
    if ((token === 'cd' || token === 'pushd') && isRun(tokens, i) && following && !SEPARATOR.test(following)) {
      dir = joinPath(dir, following)
      continue
    }
    const found = kindOf(token)
    if (!found || !isRun(tokens, i)) continue
    const args: string[] = []
    for (const arg of tokens.slice(i + 1)) {
      if (SEPARATOR.test(arg)) break
      args.push(arg)
    }
    if (args.some(arg => ['-h', '--help', '--test-connection', '--list-environments'].includes(arg))) continue
    const run: ScriptRun = { kind: found.kind }
    if (token.includes('/')) run.scriptsDir = joinPath(dir, token).replace(/\/[^/]+$/, '')
    if (found.script) run.script = found.script
    if (found.kind === 'test') run.args = args
    for (let j = 0; j < args.length; j++) {
      const arg = args[j]!
      const value = args[j + 1]
      if (arg === '--process-id' && value) run.processId = value
      else if (arg === '--component-id' && value) run.componentId = value
      else if (arg === '--by-component' && value) run.file = joinPath(dir, value)
      if (TAKES_VALUE.has(arg)) {
        j++
        continue
      }
      if (arg.startsWith('-')) continue
      if (arg.endsWith('.xml')) run.file = joinPath(dir, arg)
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

/** Execution statuses that mean the run hasn't finished yet. */
export const isRunningStatus = (status: string | undefined): boolean =>
  status !== undefined && /^(INPROCESS|STARTED|PENDING|QUEUED)$/i.test(status)

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
  // A script's own ERROR line fails it, and its SUCCESS line passes it even
  // when something else in the command exited with an error. With neither,
  // the exit code decides.
  const reading: Reading = {
    outcome: error ? 'failed' : success || already || unchanged || !isError ? 'ok' : 'failed',
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

/** A result read from the output, with the kind of script that printed it when that shows. */
export type Result = Reading & { kind?: ActivityKind }

const ID = '([0-9a-f]{8}-[0-9a-f-]{27,})'

/**
 * Every result in a command's output, in order: one per SUCCESS or ERROR
 * line, "already exists", "nothing sent" or finished test. A script run in a
 * loop prints one per pass, so a loop over six components is six results.
 * Each takes the component the line before it names ("Creating component
 * 'X'", "Pushing component 'X' (id)", "Packaging 'X' (id)", "Executing test
 * for process id"), so an ERROR line keeps its component.
 */
export const parseResults = (output: string): Result[] => {
  const results: Result[] = []
  let pending: { kind: ActivityKind; name?: string; componentId?: string } | undefined
  // A test that was submitted and not (yet) followed by its status: its result
  // only if the script stopped there (--no-wait).
  let submitted: Result | undefined
  const settleSubmitted = () => {
    if (submitted) results.push(submitted)
    submitted = undefined
  }
  const push = (result: Result) => {
    settleSubmitted()
    results.push(result)
    pending = undefined
  }
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    let m: RegExpMatchArray | null
    // Progress lines that start with SUCCESS: but aren't a script's result:
    // a deploy packages first, and a test is submitted before it finishes.
    if (/^SUCCESS: Package /.test(line)) continue
    if (/^SUCCESS: Test submitted/.test(line)) {
      settleSubmitted()
      submitted = { kind: 'test', outcome: 'ok', detail: 'submitted, not waited for', componentId: pending?.kind === 'test' ? pending.componentId : undefined }
      continue
    }
    if (/^(Creating component|Pushing component|Packaging|Executing test|Undeploying) /.test(line)) settleSubmitted()
    if ((m = line.match(/^Creating component '([^']+)'/))) pending = { kind: 'create', name: m[1] }
    else if ((m = line.match(new RegExp(`^Pushing component '([^']+)' \\(${ID}\\)`)))) pending = { kind: 'push', name: m[1], componentId: m[2] }
    else if ((m = line.match(new RegExp(`^Packaging '([^']+)' \\(${ID}\\)`)))) pending = { kind: 'deploy', name: m[1], componentId: m[2] }
    else if ((m = line.match(/^Executing test for process (\S+)/))) pending = { kind: 'test', componentId: m[1] }
    else if ((m = line.match(/^Undeploying (\S+)/))) pending = { kind: 'undeploy' }
    else if ((m = line.match(/^Execution completed: status=([A-Z_]+), executionId=(\S+)/))) {
      const status = m[1]
      // The status is the result; the submission before it was progress.
      const testedId = submitted?.componentId
      submitted = undefined
      push({
        kind: 'test',
        outcome: isFailedStatus(status) ? 'failed' : 'ok',
        detail: `status ${status}`,
        executionStatus: status,
        executionId: m[2]?.replace(/[,.]$/, ''),
        componentId: pending?.kind === 'test' ? pending.componentId : testedId,
      })
    } else if (/^SUCCESS:|already exists with ID:|nothing sent to the platform/.test(line)) {
      const created = line.match(new RegExp(`[Cc]omponent '([^']+)' (?:created|already exists) with ID: ${ID}`))
      const pushed = line.match(/Pushed component '([^']+)'(?: — now version (\d+))?/)
      const deployed = line.match(/Deployed '([^']+)'/)
      const kind: ActivityKind | undefined = created
        ? 'create'
        : pushed || /nothing sent/.test(line)
          ? 'push'
          : deployed || /^SUCCESS: Package /.test(line)
            ? 'deploy'
            : /removed from environment/.test(line)
              ? 'undeploy'
              : /Test submitted/.test(line)
                ? 'test'
                : pending?.kind
      const unchanged = line.match(/Component '([^']+)' matches the last push/)
      push({
        kind,
        outcome: 'ok',
        detail: shorten(line),
        name: created?.[1] ?? pushed?.[1] ?? deployed?.[1] ?? unchanged?.[1] ?? pending?.name,
        componentId: created?.[2] ?? pending?.componentId,
        version: pushed?.[2],
      })
    } else if (/^ERROR:/.test(line)) {
      if (submitted) {
        // A test that was submitted, then failed while it was being waited for.
        submitted = { ...submitted, outcome: 'failed', detail: shorten(line) }
        continue
      }
      push({ kind: pending?.kind, outcome: 'failed', detail: shorten(line), name: pending?.name, componentId: pending?.componentId })
    }
  }
  settleSubmitted()
  return results
}

/** The results of one kind of script (or of no telling kind) in a command's output. */
export const readResults = (kind: ActivityKind, output: string, _isError: boolean): Result[] =>
  parseResults(output).filter(result => result.kind === kind || result.kind === undefined)

/**
 * Which result belongs to which script run, in order: each run takes the next
 * result of its kind. Results left over belong to the last run of their kind:
 * a script in a loop ran more often than it appears in the command. A result
 * of no telling kind goes to the command's only kind of script, if it has one.
 */
export const assignResults = (
  runs: readonly { id: number; kind: ActivityKind }[],
  results: readonly Result[],
): { first: Map<number, Result>; extras: Map<number, Result[]> } => {
  const kinds = [...new Set(runs.map(run => run.kind))]
  const queues = new Map<ActivityKind, Result[]>()
  for (const result of results) {
    const kind = result.kind ?? (kinds.length === 1 ? kinds[0] : undefined)
    if (!kind) continue
    queues.set(kind, [...(queues.get(kind) ?? []), result])
  }
  const first = new Map<number, Result>()
  const extras = new Map<number, Result[]>()
  for (const run of runs) {
    const next = queues.get(run.kind)?.shift()
    if (next) first.set(run.id, next)
  }
  for (const [kind, rest] of queues) {
    const last = [...runs].reverse().find(run => run.kind === kind)
    if (last && rest.length > 0) extras.set(last.id, rest)
  }
  return { first, extras }
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
  a.outcome === 'ok' && (isWarnStatus(a.executionStatus) || isSubmittedOnly(a)) ? 'warning' : LEVEL_OF[a.outcome]

/** A test that was submitted and not waited for (--no-wait): no result yet. */
const isSubmittedOnly = (a: Activity) => a.kind === 'test' && a.outcome === 'ok' && !a.executionStatus

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
  'event-streams-setup': 'Set up Event Streams',
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
  const byFile = new Map<string, ComponentRow>()
  for (const a of activity) {
    if (a.kind === 'other') continue
    // A step that names no file and no component can't be placed: it stays in Recently.
    if (!a.file && !a.componentId && !(a.kind === 'undeploy' && /^deployment /.test(a.subject))) continue
    // One component, however a step names it: by ID first, then by file.
    const known = (a.componentId && byId.get(a.componentId)) || (a.file && byFile.get(a.file))
    const key = known ? known.key : (a.file ?? a.componentId ?? a.subject)
    const row: ComponentRow = rows.get(key) ?? { key, name: a.subject, lastAt: a.startedAt, ids: [] }
    row.ids.push(a.id)
    // A real name beats a file name or a placeholder.
    const isPlaceholder = (name: string) => /\.xml$/.test(name) || name === 'a component' || name === key
    if (!isPlaceholder(a.subject) || isPlaceholder(row.name)) row.name = a.subject
    row.type = a.type ?? row.type
    row.componentId = a.componentId ?? row.componentId
    row.lastAt = Math.max(row.lastAt, a.endedAt ?? a.startedAt)
    if (a.kind === 'edit') row.edited = a
    else if (a.kind === 'create' || a.kind === 'push' || a.kind === 'pull') row.saved = a
    else if (a.kind === 'deploy' || a.kind === 'undeploy') row.deployed = a
    else if (a.kind === 'test') row.tested = a
    rows.set(key, row)
    if (row.componentId) byId.set(row.componentId, row)
    if (a.file) byFile.set(a.file, row)
  }
  return [...rows.values()].sort((a, b) => b.lastAt - a.lastAt)
}

export type Stage = { level: Level; text: string }

const when = (a: Activity) => a.endedAt ?? a.startedAt

/** The environment's runs of a component: by its ID, else by its name. */
export const runsOf = (row: { componentId?: string; name: string }, runs: readonly Run[]): Run[] =>
  runs.filter(run => (row.componentId && run.processId === row.componentId) || run.processName === row.name)

const runNoun = (runs: readonly Run[]) => (runs.length > 0 && runs.every(run => run.executionType === 'exec_listener') ? 'listener run' : 'run')

/** A component's journey as short steps, each with an icon and a label; its runs in Boomi last. */
export const stages = (row: ComponentRow, runs: readonly Run[] = []): Stage[] => {
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
  const mine = runsOf(row, runs)
  if (mine.length > 0) {
    const failed = mine.filter(run => isFailedStatus(run.status)).length
    const noun = runNoun(mine)
    out.push(
      failed > 0
        ? { level: 'critical', text: `${failed} of ${mine.length} ${noun}${mine.length === 1 ? '' : 's'} failed` }
        : { level: 'healthy', text: `${mine.length} ${noun}${mine.length === 1 ? '' : 's'} ok` },
    )
  }
  if (tested) {
    if (tested.outcome === 'running') out.push({ level: 'warning', text: 'testing…' })
    else if (tested.outcome === 'failed') out.push({ level: 'critical', text: `test ${tested.executionStatus ?? 'failed'}` })
    else if (tested.outcome === 'blocked') out.push({ level: 'serious', text: 'test blocked' })
    else if (!tested.executionStatus) out.push({ level: 'warning', text: 'test submitted, result not waited for' })
    else out.push({ level: levelOf(tested), text: tested.executionStatus === 'COMPLETE' ? 'test passed' : `test ${tested.executionStatus}` })
  }
  return out
}

// --- What needs attention --------------------------------------------------------

/**
 * One thing needing attention. `key` says what closing it closes: `step:<id>`
 * a failed step, `run:<execution id>` a failed run, `watch:<component id>` a
 * watched component someone else changed.
 */
export type Attention = {
  key: string
  level: Level
  title: string
  hint: string
  at: number
  executionId?: string
  /** A failed test's step, when it can be run again. */
  rerunId?: number
}

/** Runs in the window, newest first: a run from last month isn't news. */
export const recentRuns = (runs: readonly Run[], now: number, windowMs: number): Run[] =>
  runs.filter(run => {
    const at = Date.parse(run.at)
    return Number.isNaN(at) || now - at <= windowMs
  })

/**
 * The recent runs of this session's components, newest first: what someone
 * building with Companion cares about. Schedules and other people's runs of
 * other processes in the environment are left out.
 */
export const sessionRuns = (dashboard: Dashboard, now: number, windowMs: number): Run[] => {
  const rows = components(dashboard.activity)
  return recentRuns(dashboard.platform.runs, now, windowMs).filter(run => rows.some(row => runsOf(row, [run]).length > 0))
}

/** What failed and is still failing, each with what to do about it. */
export const attention = (dashboard: Dashboard, now: number, windowMs: number): Attention[] => {
  const items: Attention[] = []
  const closedSteps = new Set(dashboard.closedSteps ?? [])
  for (const row of components(dashboard.activity)) {
    for (const a of [row.saved, row.deployed, row.tested]) {
      if (!a || (a.outcome !== 'failed' && a.outcome !== 'blocked') || closedSteps.has(a.id)) continue
      const hint =
        a.outcome === 'blocked'
          ? a.detail
          : a.kind === 'test' && a.executionId
            ? `Execution ${a.executionId.replace(/^execution-/, '').slice(0, 8)}…: press Why? to read what failed.`
            : a.detail
      items.push({
        key: `step:${a.id}`,
        level: levelOf(a),
        title: describe(a),
        hint,
        at: when(a),
        executionId: a.kind === 'test' ? a.executionId : undefined,
        rerunId: a.kind === 'test' && a.args ? a.id : undefined,
      })
    }
  }
  const seenRuns = new Set(dashboard.seenRuns ?? [])
  const testRuns = new Set(dashboard.activity.filter(a => a.kind === 'test' && a.executionId).map(a => a.executionId!))
  const rows = components(dashboard.activity)
  for (const run of sessionRuns(dashboard, now, windowMs)) {
    if (!isFailedStatus(run.status) || seenRuns.has(run.executionId)) continue
    // A failed test Claude ran is the same execution: its step says so, or was closed.
    if (testRuns.has(run.executionId)) continue
    const at = Date.parse(run.at)
    const row = rows.find(r => runsOf(r, [run]).length > 0)
    const noun = run.executionType === 'exec_listener' ? 'Listener run' : 'Run'
    items.push({
      key: `run:${run.executionId}`,
      executionId: run.executionId,
      level: 'critical',
      title: `${noun} of ${row?.name ?? run.processName} ended ${run.status}`,
      hint: `Execution ${run.executionId.replace(/^execution-/, '').slice(0, 8)}…. Press Why? to read its log, or close this if the failure was expected.`,
      at: Number.isNaN(at) ? now : at,
    })
  }
  for (const w of dashboard.watched) {
    if (w.changedBy) {
      items.push({
        key: `watch:${w.componentId}`,
        level: 'warning',
        title: `${w.name ?? w.componentId} was changed by ${w.changedBy}`,
        hint: 'Pull it before you push, or you overwrite their change. Close this once you have.',
        at: w.modifiedDate ? Date.parse(w.modifiedDate) || now : now,
      })
    }
  }
  // The same failure reached twice (one component named two ways) is one item.
  const seen = new Set<string>()
  return items
    .sort((a, b) => b.at - a.at)
    .filter(item => {
      const key = `${item.title}\n${item.hint}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** How many items the person closed that would otherwise need attention now. */
export const closedCount = (dashboard: Dashboard, now: number, windowMs: number): number =>
  attention({ ...dashboard, closedSteps: [], seenRuns: [] }, now, windowMs).length - attention(dashboard, now, windowMs).length

/** What closing an item changes in the dashboard: a step is closed, a run seen, a watched change cleared. */
export const closeItem = (dashboard: Dashboard, key: string): Dashboard => {
  const [kind, ...rest] = key.split(':')
  const id = rest.join(':')
  if (kind === 'step') return { ...dashboard, closedSteps: [...new Set([...(dashboard.closedSteps ?? []), Number(id)])].slice(-200) }
  if (kind === 'run') return { ...dashboard, seenRuns: [...new Set([...(dashboard.seenRuns ?? []), id])].slice(-200) }
  if (kind === 'watch') return { ...dashboard, watched: dashboard.watched.map(w => (w.componentId === id ? { ...w, changedBy: undefined } : w)) }
  return dashboard
}

/** Brings back every closed step and run. (A watched change, once cleared, comes back with the next one.) */
export const reopenAll = (dashboard: Dashboard): Dashboard => ({ ...dashboard, closedSteps: [], seenRuns: [] })

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
/**
 * The session's new tokens: fresh input, output and what was written to the
 * prompt cache. Cache reads are left out: each call re-reads the conversation
 * so far from the cache, so in a long session they grow with every call and
 * would dwarf the work done; they're reported beside this, by cachedTokens.
 */
export const newTokens = (l: Ledger): number => l.input + l.output + l.cacheWrite

/** Tokens the prompt cache served: the conversation re-read on every call, billed at a fraction of new input. */
export const cachedTokens = (l: Ledger): number => l.cacheRead

/**
 * Tokens by kind in one line:
 * 412k new (18k in · 44k out · 350k cache writes) · 3.3M cache reads.
 */
export const tokenSplit = (t: TokenSplit): string => {
  const fresh = t.input + t.output + t.cacheWrite
  const parts = `${formatTokens(t.input)} in · ${formatTokens(t.output)} out · ${formatTokens(t.cacheWrite)} cache writes`
  return `${formatTokens(fresh)} new (${parts}) · ${formatTokens(t.cacheRead)} cache reads`
}

/** Each model's split, biggest first, when the session used more than one. */
export const modelSplits = (l: Ledger): string[] => {
  const entries = Object.entries(l.byModel ?? {})
  if (entries.length < 2) return []
  return entries
    .sort((a, b) => newTokens({ ...b[1], calls: 0 }) - newTokens({ ...a[1], calls: 0 }))
    .map(([id, split]) => `${modelName(id)}: ${tokenSplit(split)}`)
}

/** Every token the API counted, cache reads included. */
export const totalTokens = (l: Ledger): number => newTokens(l) + cachedTokens(l)

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
  let wasRestored: boolean | undefined
  for (const a of activity) {
    // Steps from an earlier session counted from that session's ledger: start over after them.
    if (wasRestored !== undefined && Boolean(a.isRestored) !== wasRestored) {
      tokens = 0
      usd = undefined
    }
    wasRestored = Boolean(a.isRestored)
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
  const left = budgetOf(usage.usd, usage.budgetUsd)
  if (left && left.level !== 'healthy') parts.push(`${STATUS[left.level].icon} ${left.text}`)
  return parts.join(' · ')
}

/**
 * Where the session's spend stands against its budget: warning from 80%,
 * critical once it's spent. Undefined without a budget or a cost.
 */
export const budgetOf = (usd: number | undefined, budgetUsd: number | undefined): { level: Level; percent: number; text: string } | undefined => {
  if (!budgetUsd || budgetUsd <= 0 || usd === undefined) return undefined
  const percent = (usd / budgetUsd) * 100
  const level: Level = percent >= 100 ? 'critical' : percent >= 80 ? 'warning' : 'healthy'
  const of = `of the ${formatCost(budgetUsd)} budget`
  return { level, percent, text: percent >= 100 ? `budget spent: ${formatCost(usd)} ${of}` : `${Math.round(percent)}% ${of}` }
}

/**
 * The step a process still needs after this session's work: deploy what was
 * saved, test what was deployed. Undefined while a step runs, or when the
 * latest process is saved, deployed and tested, or failed (Why? covers that).
 */
export const nextStep = (activity: readonly Activity[]): string | undefined => {
  const fresh = activity.filter(a => !a.isRestored)
  if (fresh.some(a => a.outcome === 'running')) return undefined
  const row = components(fresh).find(r => r.type === 'process' && (r.saved || r.deployed))
  if (!row) return undefined
  const after = (a: Activity | undefined, b: Activity | undefined) => !!a && (!b || a.startedAt > b.startedAt)
  if (row.saved?.outcome === 'ok' && row.saved.kind !== 'pull' && after(row.saved, row.deployed)) return `Deploy ${row.name} and test it`
  if (row.deployed?.outcome === 'ok' && row.deployed.kind === 'deploy' && after(row.deployed, row.tested)) return `Test ${row.name}`
  return undefined
}

export type Usage = {
  usd?: number
  /** The session's spend budget, from the budgetUsd setting. */
  budgetUsd?: number
  contextPercent?: number
  /** New tokens: input, output and cache writes (newTokens). */
  tokens?: number
  /** Tokens read from the prompt cache (cachedTokens). */
  cached?: number
  /** The session's tokens by kind, in words (tokenSplit), and each model's when there are several. */
  split?: string
  modelSplits?: string[]
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
  const lines: string[] = []
  const needs = attention(dashboard, now, windowMs)
  lines.push(needs.length > 0 ? `Needs attention (${needs.length}):` : '✓ Nothing needs attention.')
  needs.forEach((n, i) => lines.push(`  ${i + 1}. ${STATUS[n.level].icon} ${n.title}`, `      ${n.hint}`))
  const closed = closedCount(dashboard, now, windowMs)
  if (closed > 0) lines.push(`  (${closed} closed: /bc-dashboard reopen brings them back)`)
  else if (needs.length > 0) lines.push('  (/bc-dashboard close <number> closes one, or "all")')

  const all = spends(dashboard.activity)
  const rows = components(dashboard.activity)
  const runs = sessionRuns(dashboard, now, windowMs)
  lines.push('', rows.length > 0 ? 'Components this session:' : 'Components this session: none yet. They show up as Claude edits, saves, deploys and tests them.')
  if (dashboard.restored) lines.push(`  (${restoredNote(dashboard.restored, windowMs)})`)
  for (const row of rows) {
    const type = friendlyType(row.type)
    const spent = formatSpend(spendOf(row.ids, all))
    lines.push(`  ${row.name}${type ? ` (${type})` : ''}: ${stages(row, runs).map(s => `${STATUS[s.level].icon} ${s.text}`).join('  ')}${spent ? `  [${spent}]` : ''}`)
  }

  const feed = dashboard.activity.slice(-8).reverse()
  if (feed.length > 0) {
    lines.push('', "Claude's latest steps (what Claude just did with Companion, newest first):")
    for (const a of feed) {
      const spent = formatSpend(all.get(a.id))
      lines.push(`  ${STATUS[levelOf(a)].icon} ${describe(a)}, ${ago(when(a), now)}${a.source === 'log' ? " (from Companion's log)" : ''}${spent ? `  [${spent}]` : ''}`)
    }
  }

  if (dashboard.watched.length > 0) {
    lines.push('', 'Watched components:')
    if (dashboard.platform.phase !== 'ok' && dashboard.platform.checkedAt !== undefined) lines.push(`  ${dashboard.platform.message}`)
    for (const w of dashboard.watched) lines.push(`  ${watchedLine(w)}`)
  }

  const cost = formatCost(usage.usd)
  const context = usage.contextPercent === undefined ? undefined : `context ${Math.round(usage.contextPercent)}% full`
  const budget = budgetOf(usage.usd, usage.budgetUsd)
  const spentOf = budget ? `${STATUS[budget.level].icon} ${budget.text}` : undefined
  if (cost || context) lines.push('', `Session: ${[cost && `${cost} so far`, spentOf, context].filter(Boolean).join(' · ')}`)
  if (usage.split) lines.push(`Tokens: ${usage.split}`)
  for (const line of usage.modelSplits ?? []) lines.push(`  ${line}`)
  if (usage.model && !usage.modelSplits?.length) lines.push(`Model: ${usage.model}`)
  return lines.join('\n')
}

/** Says that some steps came back from an earlier session in this folder. */
export const restoredNote = (count: number, windowMs: number): string =>
  `${count} step${count === 1 ? '' : 's'} from an earlier session in this folder, last ${Math.round(windowMs / 3_600_000)}h`

/** The runs in one line, for a collapsed section: "10 in 24h, 1 failed". */
export const runsSummary = (runs: readonly Run[], hours: number): { level: Level; text: string } => {
  const failed = runs.filter(run => isFailedStatus(run.status)).length
  return {
    level: failed > 0 ? 'critical' : 'healthy',
    text: `${runs.length} in ${hours}h, ${failed > 0 ? `${failed} failed` : 'none failed'}`,
  }
}

/** The GitHub page of an origin remote, for git@, ssh and https forms; undefined when it isn't GitHub. */
export const githubUrl = (remote: string | null | undefined): string | undefined => {
  if (!remote) return undefined
  const m = remote.trim().match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https?:\/\/(?:[^@/]+@)?github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/)
  return m ? `https://github.com/${m[1]}/${m[2]}` : undefined
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
  PENDING: 'queued',
  QUEUED: 'queued',
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
// An 8-bit flamingo, 12 pixels wide and 16 tall, facing right. Each letter is
// a pixel: P is the flamingo's pink, L its pastel (wing and beak), K ink (eye
// and beak tip), and a dot is clear. Two pixel rows make one row of terminal
// cells. The long S-shaped neck and the bent, dark-tipped beak are what make it
// read as a flamingo, so the sprite keeps the room for them.

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

/** Resting: one straight leg down to its foot, the other folded up beside it, knee out. */
const ONE_LEG = ['......P.PPP.', '......P..P..', '......P.....', '.....PP.....']
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

/** How many animation frames it takes the flamingo to move one column: it steps in place between moves. */
export const FRAMES_PER_STEP = 2

/** How many columns the flamingo paces across while Claude works. */
export const FLAMINGO_TRAVEL = 6

/** The sprite facing the other way: each pixel row reversed. The sprite faces right. */
export const mirror = (pixels: readonly string[]): string[] => pixels.map(row => [...row].reverse().join(''))

/**
 * Where the flamingo is on its strip at a frame, and which way it faces: it
 * walks one column a frame to the end of the strip, turns, and walks back.
 */
export const pace = (frame: number, travel = FLAMINGO_TRAVEL): { offset: number; facing: 'right' | 'left' } => {
  const cycle = travel * 2
  const at = ((frame % cycle) + cycle) % cycle
  return at < travel ? { offset: at, facing: 'right' } : { offset: cycle - at, facing: 'left' }
}

/**
 * The flamingo as drawn: its pixels, mirrored when it faces left, and how many
 * columns in from the strip's left edge. Standing still while idle, it keeps
 * the spot and the way it faced when Claude stopped.
 */
export const flamingoView = (isWorking: boolean, frame: number, travel = FLAMINGO_TRAVEL) => {
  const { offset, facing } = pace(Math.floor(frame / FRAMES_PER_STEP), travel)
  const pixels = flamingo(isWorking, frame)
  return { pixels: facing === 'right' ? [...pixels] : mirror(pixels), offset, facing }
}

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

// --- Why a run failed ------------------------------------------------------------

/** What an execution's log says went wrong. */
export type Diagnosis = {
  /** The log's SEVERE lines (else its last few), timestamps left off, newest last. */
  lines: string[]
  /** How many SEVERE and WARNING lines the log has. */
  severe: number
  warnings: number
}

const LEVEL = /(?:^|\s)(SEVERE|WARNING|INFO|FINE)(?:\s|$)/

/**
 * Reads a Boomi process log as boomi-execution-query.sh --logs prints it: the
 * SEVERE lines say what failed and in which shape. Without any, the last lines
 * are the best clue. Each line loses its timestamp and is cut at 200 characters.
 */
export const diagnose = (log: string): Diagnosis => {
  const lines = log.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const strip = (line: string) => {
    const at = line.search(LEVEL)
    // A log's fields are tab-separated; a tab draws unevenly in a pane, so they're joined with a dot.
    const text = (at >= 0 ? line.slice(at).trim() : line).replace(/\s*\t+\s*/g, ' · ')
    return text.length > 200 ? `${text.slice(0, 199)}…` : text
  }
  const severe = lines.filter(line => LEVEL.exec(line)?.[1] === 'SEVERE')
  const warnings = lines.filter(line => LEVEL.exec(line)?.[1] === 'WARNING').length
  const errors = lines.filter(line => /^ERROR:/.test(line))
  const picked = severe.length > 0 ? severe.slice(-5) : errors.length > 0 ? errors : lines.slice(-5)
  return { lines: picked.map(strip), severe: severe.length, warnings }
}

/** The request the "Ask Claude to fix" button puts in the prompt box. */
export const fixPrompt = (title: string, executionId: string, diagnosis: Diagnosis): string =>
  [
    `${title} (execution ${executionId}). Its process log says:`,
    ...diagnosis.lines.map(line => `  ${line}`),
    'Find the cause in the process and fix it, then push, redeploy and test it again.',
  ].join('\n')

// --- The session report ------------------------------------------------------------

export type ReportFacts = {
  session: string
  date: string
  repo?: string
  usage: Usage
}

const cell = (text: string) => text.replace(/\|/g, '\\|')

/**
 * The session as Markdown, for a PR, a ticket or a hand-off: what was built and
 * where it stands, what was deployed and tested, what failed and was closed,
 * and the spend.
 */
export const report = (dashboard: Dashboard, facts: ReportFacts, now: number, windowMs: number): string => {
  const all = spends(dashboard.activity)
  const runs = sessionRuns(dashboard, now, windowMs)
  const rows = components(dashboard.activity)
  const needs = attention(dashboard, now, windowMs)
  const closed = closedCount(dashboard, now, windowMs)
  const u = facts.usage
  const lines: string[] = [
    '# Boomi Companion session report',
    '',
    [
      `Session ${facts.session}`,
      facts.date,
      u.startedAt === undefined ? undefined : duration(now - u.startedAt),
      u.model,
    ]
      .filter(Boolean)
      .join(' · '),
  ]
  if (facts.repo) lines.push(`Repository: ${facts.repo}`)

  lines.push('', `## Components (${rows.length})`, '')
  if (rows.length === 0) lines.push('None this session.')
  else {
    lines.push('| Component | Type | Where it stands | Tokens | Cost |', '|---|---|---|---|---|')
    for (const row of rows) {
      const spent = spendOf(row.ids, all)
      const where = stages(row, runs).map(s => `${STATUS[s.level].icon} ${s.text}`).join(' · ')
      lines.push(
        `| ${cell(row.name)} | ${cell(friendlyType(row.type) ?? '')} | ${cell(where)} | ${spent.tokens ? formatTokens(spent.tokens) : ''} | ${formatCost(spent.usd) ?? ''} |`,
      )
    }
  }

  const shipped = dashboard.activity.filter(a => (a.kind === 'deploy' || a.kind === 'undeploy' || a.kind === 'test') && a.outcome !== 'running')
  lines.push('', '## Deployments and tests', '')
  if (shipped.length === 0) lines.push('None this session.')
  for (const a of shipped) lines.push(`- ${STATUS[levelOf(a)].icon} ${describe(a)}${a.executionId ? ` (execution ${a.executionId})` : ''}`)

  lines.push('', '## Needs attention', '')
  if (needs.length === 0) lines.push('Nothing open.')
  for (const n of needs) lines.push(`- ${STATUS[n.level].icon} ${n.title}`)
  if (closed > 0) lines.push(`- ☑ ${closed} closed as expected or handled`)

  lines.push('', '## Spend', '')
  if (u.usd !== undefined) lines.push(`- Cost: ${formatCost(u.usd)}`)
  if (u.split) lines.push(`- Tokens: ${u.split}`)
  for (const line of u.modelSplits ?? []) lines.push(`  - ${line}`)
  return lines.join('\n')
}

// --- Past sessions ---------------------------------------------------------------

/** One session as scan-sessions.pl prints it. */
export type ScannedSession = {
  id: string
  project?: string
  startedAt?: string
  endedAt?: string
  costUsd?: number | null
  models?: Record<string, { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }>
  commands?: string[]
  title?: string
  firstPrompt?: string
}

const fileName = (path: string) => (path.split('/').pop() ?? path).replace(/\.xml$/, '')

/**
 * The scan's sessions that ran a Companion script, newest first. A command
 * that only names a script, as `cat` or `find` does, isn't a run: the same
 * reading as live steps decides.
 */
export const pastSessions = (scan: { sessions?: ScannedSession[] }): PastSession[] => {
  const found: PastSession[] = []
  for (const s of scan.sessions ?? []) {
    const runs: Partial<Record<ActivityKind, number>> = {}
    const files = new Set<string>()
    const ids = new Set<string>()
    for (const command of s.commands ?? []) {
      for (const run of scriptRuns(command)) {
        if (run.kind === 'other') continue
        runs[run.kind] = (runs[run.kind] ?? 0) + 1
        if (run.file) files.add(fileName(run.file))
        else if (run.processId ?? run.componentId) ids.add((run.processId ?? run.componentId)!)
      }
    }
    if (Object.keys(runs).length === 0) continue
    const models = Object.entries(s.models ?? {})
    const sum = (pick: (m: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }) => number) =>
      models.reduce((n, [, m]) => n + pick(m), 0)
    found.push({
      id: s.id,
      project: s.project,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      costUsd: typeof s.costUsd === 'number' ? s.costUsd : undefined,
      tokens: sum(m => (m.input ?? 0) + (m.output ?? 0) + (m.cacheWrite ?? 0)),
      cached: sum(m => m.cacheRead ?? 0),
      models: models.map(([id]) => modelName(id) ?? id),
      runs,
      // A file names a component; an ID only when the session named no file.
      components: files.size > 0 ? [...files] : [...ids].map(id => (id.length > 12 ? `${id.slice(0, 8)}…` : id)),
      label: s.title || s.firstPrompt || undefined,
    })
  }
  return found.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
}

const PAST_WORDS: [ActivityKind, string, string][] = [
  ['create', 'create', 'creates'],
  ['push', 'push', 'pushes'],
  ['pull', 'pull', 'pulls'],
  ['deploy', 'deploy', 'deploys'],
  ['undeploy', 'undeploy', 'undeploys'],
  ['test', 'test', 'tests'],
]

/** A past session's Companion work in words: 3 pushes · 1 deploy · 2 tests. */
export const runWords = (runs: PastSession['runs']): string =>
  PAST_WORDS.filter(([kind]) => runs[kind])
    .map(([kind, one, many]) => `${runs[kind]} ${runs[kind] === 1 ? one : many}`)
    .join(' · ')

export type HistoryTotals = { sessions: number; usd: number; unpriced: number; tokens: number }

/** The sessions that started within `ms` of now, added up. A session with no recorded cost counts as unpriced. */
export const historyTotals = (sessions: readonly PastSession[], now: number, ms = Infinity): HistoryTotals => {
  const within = sessions.filter(s => {
    const at = Date.parse(s.startedAt ?? '')
    return Number.isNaN(at) ? ms === Infinity : now - at <= ms
  })
  return {
    sessions: within.length,
    usd: within.reduce((n, s) => n + (s.costUsd ?? 0), 0),
    unpriced: within.filter(s => s.costUsd === undefined).length,
    tokens: within.reduce((n, s) => n + s.tokens, 0),
  }
}

const totalsLine = (label: string, t: HistoryTotals) =>
  t.sessions === 0
    ? undefined
    : `${label}: ${t.sessions} session${t.sessions === 1 ? '' : 's'} · ${formatCost(t.usd)}${t.unpriced ? ` (+${t.unpriced} without a recorded cost)` : ''} · ${formatTokens(t.tokens)} tokens`

/** How to show past sessions: whose is current, whether their folders differ, and in which time zone. */
export type PastView = { currentId?: string; withProject?: boolean; timeZone?: string }

/** Whether the sessions come from more than one folder, so the folder tells them apart. */
export const projectsDiffer = (sessions: readonly PastSession[]): boolean => new Set(sessions.map(s => s.project ?? '')).size > 1

const folderOf = (project: string | undefined) => (project ? (project.split('/').filter(Boolean).pop() ?? project) : undefined)

/**
 * A past session in two parts. The head says which session: when it started,
 * how long it ran, its cost and what it was about. The detail says what it did.
 */
export const pastParts = (s: PastSession, view: PastView = {}): { head: string; detail: string } => {
  const at = Date.parse(s.startedAt ?? '')
  const end = Date.parse(s.endedAt ?? '')
  const when = Number.isNaN(at)
    ? 'unknown date'
    : new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: view.timeZone })
  const length = Number.isNaN(at) || Number.isNaN(end) || end <= at ? undefined : duration(end - at)
  const cost = s.costUsd === undefined ? 'no recorded cost' : formatCost(s.costUsd)
  const head = [
    `${when}${s.id === view.currentId ? ' (this session)' : ''}`,
    length,
    cost,
    s.label ? `"${s.label}"` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  const names = s.components.length > 3 ? `${s.components.slice(0, 3).join(', ')} +${s.components.length - 3}` : s.components.join(', ')
  const detail = [runWords(s.runs), names || undefined, `${formatTokens(s.tokens)} tokens`, view.withProject ? folderOf(s.project) : undefined]
    .filter(Boolean)
    .join(' · ')
  return { head, detail }
}

/** One past session as text: its head, then what it did. */
export const pastLine = (s: PastSession, view: PastView = {}): string => {
  const { head, detail } = pastParts(s, view)
  return `${head}\n      ${detail}`
}

/** The history as text: totals for the week, the month and everything scanned, then each session. */
export const historySummary = (sessions: readonly PastSession[], now: number, days: number, view: PastView = {}): string => {
  if (sessions.length === 0) return `No Boomi Companion sessions in the transcripts on this machine from the last ${days} days.`
  const lines = [
    `Boomi Companion sessions on this machine, last ${days} days:`,
    ...[
      totalsLine('  This week', historyTotals(sessions, now, 7 * 86_400_000)),
      totalsLine('  Last 30 days', historyTotals(sessions, now, 30 * 86_400_000)),
      totalsLine(`  All ${days} days`, historyTotals(sessions, now)),
    ].filter((line): line is string => !!line),
    '',
    ...sessions.slice(0, 20).map(s => `  ${pastLine(s, { ...view, withProject: projectsDiffer(sessions) })}`),
  ]
  if (sessions.length > 20) lines.push(`  …and ${sessions.length - 20} more`)
  lines.push('', "Costs are Claude Code's own, from each transcript. Claude Code on the web and other machines keep their transcripts elsewhere.")
  return lines.join('\n')
}

// --- Guardrails: the other Boomi mods ---------------------------------------------

/** A guardrail line: a status (icon and label) or, without one, a plain note. */
export type GuardLine = { level?: Level; text: string }

const SCRIPT_NOUN: Record<string, string> = { create: 'create', push: 'push', deploy: 'deploy', check: '/standards check' }

/**
 * What boomi-standards and boomi-runtime say about the session, as lines.
 * A mod that isn't loaded (undefined) adds nothing.
 */
export const guardrails = (standards: StandardsSeen | undefined, runtime: RuntimeSeen | undefined): GuardLine[] => {
  const lines: GuardLine[] = []
  if (standards) {
    const last = standards.last
    const tally = `${standards.checks} check${standards.checks === 1 ? '' : 's'}, ${standards.blocked} blocked`
    const noun = last ? (SCRIPT_NOUN[last.script] ?? last.script) : ''
    const more = last && last.findings.length > 1 ? ` (+${last.findings.length - 1} more)` : ''
    if (!last) lines.push({ text: 'Standards: nothing checked yet. Each create, push and deploy is checked first.' })
    else if (last.isBlocked) lines.push({ level: 'serious', text: `Standards blocked the last ${noun}: ${last.findings[0] ?? 'see the refusal'}${more}` })
    else if (last.errors > 0) lines.push({ level: 'critical', text: `Standards: ${last.errors} error${last.errors === 1 ? '' : 's'} in the last ${noun}, not enforced: ${last.findings[0]}${more}` })
    else if (last.warnings > 0) lines.push({ level: 'warning', text: `Standards: ${last.warnings} warning${last.warnings === 1 ? '' : 's'} in the last ${noun}: ${last.findings[0]}${more}` })
    else lines.push({ level: 'healthy', text: `Standards: the last ${noun} passed (${tally})` })
  }
  if (runtime) {
    const name = runtime.name ? ` ${runtime.name}` : ''
    if (runtime.phase === 'idle') lines.push({ text: 'Runtime: none in this session. /boomi up starts one.' })
    else if (runtime.phase === 'online') {
      const smoke = runtime.smoke?.phase === 'passed' ? ', smoke test passed' : runtime.smoke?.phase === 'running' ? ', smoke test running' : ''
      lines.push({ level: 'healthy', text: `Runtime${name} online${smoke}` })
      if (runtime.smoke?.phase === 'failed') lines.push({ level: 'critical', text: `Smoke test failed: ${runtime.smoke.message}` })
    } else if (runtime.phase === 'error') lines.push({ level: 'critical', text: `Runtime error: ${runtime.message}` })
    else lines.push({ level: 'warning', text: `Runtime${name} ${runtime.phase}: ${runtime.message}` })
  }
  return lines
}

/** The guardrail lines as text, for /bc-dashboard text. */
export const guardrailText = (lines: readonly GuardLine[]): string =>
  lines.length === 0 ? '' : ['Guardrails:', ...lines.map(l => `  ${l.level ? `${STATUS[l.level].icon} ` : ''}${l.text}`)].join('\n')

// --- A new session's banner ---------------------------------------------------------

/**
 * What this session did with Companion, for the next session's banner. Only
 * this session's own steps count, not ones brought back from an earlier one.
 * Undefined when it did nothing with Companion.
 */
export const recapOf = (dashboard: Dashboard, now: number, windowMs: number, usd?: number): SessionRecap | undefined => {
  const fresh = dashboard.activity.filter(a => !a.isRestored && a.outcome !== 'running')
  if (!fresh.some(a => a.kind !== 'other')) return undefined
  const count = (kind: ActivityKind, outcome?: Outcome) => fresh.filter(a => a.kind === kind && (!outcome || a.outcome === outcome)).length
  return {
    endedAt: Math.max(...fresh.map(when)),
    components: components(fresh).length,
    saves: count('create') + count('push'),
    deploys: count('deploy'),
    tests: count('test'),
    testsFailed: count('test', 'failed'),
    open: attention({ ...dashboard, activity: fresh }, now, windowMs).filter(n => n.key.startsWith('step:')).length,
    usd,
  }
}

/** The banner's "Last session" line: when, what it did, how it ended and what it cost. */
export const recapLine = (recap: SessionRecap, now: number): { level: Level; text: string } => {
  const did = [
    recap.components > 0 ? plural(recap.components, 'component') : undefined,
    recap.saves > 0 ? plural(recap.saves, 'save') : undefined,
    recap.deploys > 0 ? plural(recap.deploys, 'deploy') : undefined,
    recap.tests > 0 ? `${plural(recap.tests, 'test')}${recap.testsFailed > 0 ? ` (${recap.testsFailed} failed)` : ''}` : undefined,
  ].filter(Boolean)
  const ended = recap.open > 0 ? `${recap.open} left to fix` : 'nothing left to fix'
  return {
    level: recap.open > 0 ? 'critical' : 'healthy',
    text: `Last session ${ago(recap.endedAt, now)}: ${[...did, ended, formatCost(recap.usd)].filter(Boolean).join(' · ')}`,
  }
}

/** What the banner turns through at the start of a session, before Companion has done anything. */
export const TIPS: readonly string[] = [
  'Tip: Why? on a failed test reads its log; Ask Claude to fix drafts the request',
  "Tip: Run again repeats a failed test without a turn of Claude's",
  'Tip: ask Claude "what\'s left to fix?" and it answers from the dashboard',
  'Tip: /bc-dashboard report save writes the session up for a PR or a hand-off',
  'Tip: set budgetUsd under /config for a warning at 80% of a spend budget',
  'Tip: Scan under Past Companion sessions shows what earlier sessions cost',
  'Tip: /bc-dashboard watch <component> flags changes someone else makes in Boomi',
  "Tip: BOOMI_COMPANION_LOG_ACTIVITY=1 in Companion's .env adds its activity log as a second source",
  'Tip: the Day, Night and Terminal buttons in the pane change its colors',
]

/**
 * The line the banner shows at turn `n` of its rotation: the last session's
 * recap first, when there is one, then each tip in turn.
 */
export const welcomeLine = (n: number, recap: SessionRecap | undefined, now: number): { level?: Level; text: string } => {
  const lines: { level?: Level; text: string }[] = [...(recap ? [recapLine(recap, now)] : []), ...TIPS.map(text => ({ text }))]
  return lines[((n % lines.length) + lines.length) % lines.length]!
}

// --- Companion's activity log -------------------------------------------------------

/**
 * One line of Companion's `.activity-log/activity.jsonl`, written by its
 * scripts' `log_activity` when `BOOMI_COMPANION_LOG_ACTIVITY=1` is in its .env.
 */
export type LogEntry = {
  at: number
  operation: string
  result: string
  httpCode?: number | string
  details: Record<string, unknown>
  /** What makes the entry unique: its time, operation, subject and result. */
  key: string
}

/** The log's operations that are a step of a component, as the dashboard's kinds. */
const LOG_KINDS: Record<string, ActivityKind> = {
  'component-create': 'create',
  'component-push': 'push',
  'component-pull': 'pull',
  'deploy-package': 'deploy',
  deploy: 'deploy',
  undeploy: 'undeploy',
  'test-execute': 'test',
}

const textOf = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

/** Reads the log's lines; a line that isn't a log entry (a partial first line, say) is skipped. */
export const parseActivityLog = (log: string): LogEntry[] => {
  const entries: LogEntry[] = []
  for (const line of log.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const at = Date.parse(String(raw.timestamp ?? ''))
    const operation = textOf(raw.operation)
    if (Number.isNaN(at) || !operation) continue
    const details = raw.details && typeof raw.details === 'object' ? (raw.details as Record<string, unknown>) : {}
    const subject = textOf(details.component_id) ?? textOf(details.process_id) ?? textOf(details.deployment_id) ?? textOf(details.file_path) ?? ''
    entries.push({
      at,
      operation,
      result: String(raw.result ?? ''),
      httpCode: (raw.http_code as number | string | null) ?? undefined,
      details,
      key: `${raw.timestamp}|${operation}|${subject}|${raw.result}`,
    })
  }
  return entries
}

/** A log entry as a step, in the words the dashboard uses for the same script's output. */
export const logStep = (entry: LogEntry, componentsDir: string, sessionStart: number): Omit<Activity, 'id'> | undefined => {
  const kind = LOG_KINDS[entry.operation]
  if (!kind) return undefined
  const d = entry.details
  const componentId = textOf(d.component_id) ?? textOf(d.process_id)
  const filePath = textOf(d.file_path)
  const file = filePath ? componentPath(filePath, componentsDir) : undefined
  const deployment = textOf(d.deployment_id)
  const subject = textOf(d.component_name) ?? filePath?.split('/').pop() ?? componentId ?? (deployment ? `deployment ${deployment}` : 'a component')
  const executionStatus = textOf(d.status)
  const isFailed = entry.result !== 'success' || isFailedStatus(executionStatus)
  const http = entry.httpCode === undefined || entry.httpCode === '' ? '' : ` (HTTP ${entry.httpCode})`
  const why = textOf(d.error) ?? (executionStatus ? `status=${executionStatus}` : undefined)
  const step: Omit<Activity, 'id'> = {
    kind,
    outcome: isFailed ? 'failed' : 'ok',
    subject,
    detail: isFailed
      ? shorten(`ERROR: ${entry.operation} failed${http}${why ? `: ${why}` : ''}`)
      : kind === 'test' && !executionStatus
        ? 'submitted, not waited for'
        : "from Companion's activity log",
    startedAt: entry.at,
    endedAt: entry.at,
    source: 'log',
    logKey: entry.key,
  }
  if (file) step.file = file
  if (componentId) step.componentId = componentId
  if (textOf(d.component_type)) step.type = textOf(d.component_type)
  if (textOf(d.version)) step.version = textOf(d.version)
  if (executionStatus) step.executionStatus = executionStatus
  if (textOf(d.execution_id)) step.executionId = textOf(d.execution_id)
  if (entry.at < sessionStart) step.isRestored = true
  return step
}

/** How far outside a step's own span its log entry may be: the log's times are whole seconds. */
const SAME_RUN_MS = 3_000

/**
 * The log's steps the dashboard doesn't have yet: entries in the window that
 * no step already covers. Claude's own script runs are seen in its tool
 * calls, so their entries match a step of the same kind and component that
 * was running when the entry was written; each step covers one entry, so a
 * loop over six components is six. The rest ran outside Claude's tool calls.
 */
export const newLogSteps = (
  entries: readonly LogEntry[],
  activity: readonly Activity[],
  opts: { now: number; windowMs: number; sessionStart: number; componentsDir: string },
): Omit<Activity, 'id'>[] => {
  const known = new Set(activity.map(a => a.logKey).filter(Boolean))
  const covered = new Set<number>()
  const out: Omit<Activity, 'id'>[] = []
  for (const entry of entries) {
    if (opts.now - entry.at > opts.windowMs || known.has(entry.key)) continue
    const step = logStep(entry, opts.componentsDir, opts.sessionStart)
    if (!step) continue
    known.add(entry.key)
    const same = activity.find(
      a =>
        a.source !== 'log' &&
        !covered.has(a.id) &&
        a.kind === step.kind &&
        entry.at >= a.startedAt - SAME_RUN_MS &&
        entry.at <= (a.endedAt ?? opts.now) + SAME_RUN_MS &&
        (!a.componentId || !step.componentId || a.componentId === step.componentId),
    )
    if (same) {
      covered.add(same.id)
      continue
    }
    out.push(step)
  }
  return out
}

// --- Picking an item for a command ---------------------------------------------------

/** A Needs attention item a command can act on, with its number in the text summary. */
export type Choice = { n: number; item: Attention }

/** The items a command can act on, numbered as /bc-dashboard text numbers them. */
export const choicesOf = (needs: readonly Attention[], fits: (item: Attention) => boolean): Choice[] =>
  needs.map((item, i) => ({ n: i + 1, item })).filter(c => fits(c.item))

/** A choice as an option of the picker: short, and numbered so a typed number finds it too. */
export const choiceLabel = (c: Choice): string => {
  const label = `${c.n}. ${c.item.title}`
  return label.length > 48 ? `${label.slice(0, 47)}…` : label
}

/** The choice an answer names: its option's label, or a number typed under "Other". */
export const choiceFrom = (answer: string, choices: readonly Choice[]): Choice | undefined => {
  const typed = answer.trim()
  return choices.find(c => choiceLabel(c) === typed) ?? choices.find(c => String(c.n) === typed.replace(/^#|\.$/g, ''))
}

/** The choices as a list to pick from by number, where no picker can be shown. */
export const choiceList = (question: string, choices: readonly Choice[], command: string, now: number): string =>
  [question, ...choices.map(c => `  ${c.n}. ${STATUS[c.item.level].icon} ${c.item.title}, ${ago(c.item.at, now)}`), `Run ${command} <number> with one of them.`].join('\n')
