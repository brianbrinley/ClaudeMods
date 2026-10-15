// Reads Boomi Companion's work from Claude's tool calls and their output, and
// turns it into the dashboard's views: each component's stage, what needs
// attention, the recent feed and the live environment. Plain functions:
// nothing here touches the engine, so the tests call them directly.

import type { Activity, ActivityKind, CompanionPlugin, Dashboard, Ledger, Outcome, PastSession, Product, Run, RuntimeSeen, SessionRecap, StandardsSeen, TokenSplit, Watched } from '../types'
import type { SpendPace } from './spend-history'
import { PRODUCT_NAMES, bdiReasonOf, deployState, isAwaitingApproval, isProductScript, productRun, productWords } from './products'
import { installedTip } from './plugins'

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
  /** Another Companion plugin's step: its product, subcommand and what it acted on, shortened and in full. */
  product?: Product
  verb?: string
  target?: string
  ref?: string
  project?: string
  group?: string
  version?: string
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
 * The words with each `$NAME` or `${NAME}` a variable set earlier in the same
 * command stands for: `D=active-development/processes && bash x.sh "$D/X.xml"`
 * names `active-development/processes/X.xml`. A variable the command doesn't
 * set (a loop's, the environment's) stays as it is.
 */
const expandVariables = (tokens: readonly string[]): string[] => {
  const vars = new Map<string, string>()
  const expand = (word: string) => word.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (whole, braced, bare) => vars.get(braced ?? bare) ?? whole)
  return tokens.map((token, i) => {
    const word = expand(token)
    const set = word.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s)
    // An assignment that starts a command, or follows export, sets the variable.
    if (set && (isRun(tokens, i) || tokens[i - 1] === 'export')) vars.set(set[1]!, set[2]!)
    return word
  })
}

/**
 * The Companion scripts a shell command runs, with what each names. Help and
 * connection checks touch nothing, so they're left out, as is a script only
 * read or searched. A file named after a `cd` is taken from that folder, and
 * a script inside a quoted `bash -c '...'` is found too.
 */
export const scriptRuns = (command: string): ScriptRun[] => {
  const runs: ScriptRun[] = []
  const tokens = expandVariables(words(command))
  let dir = ''
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (/\s/.test(token) && /(boomi|datahub|bdi|agentstudio|connectordev)-[a-z-]+\.sh/.test(token)) {
      runs.push(...scriptRuns(dir ? `cd ${dir} && ${token}` : token))
      continue
    }
    const following = tokens[i + 1]
    if ((token === 'cd' || token === 'pushd') && isRun(tokens, i) && following && !SEPARATOR.test(following)) {
      dir = joinPath(dir, following)
      continue
    }
    const name = token.split('/').pop() ?? ''
    if (isProductScript(name)) {
      if (!isRun(tokens, i)) continue
      const args: string[] = []
      for (const arg of tokens.slice(i + 1)) {
        if (SEPARATOR.test(arg)) break
        args.push(arg)
      }
      // Another plugin's script: a step only when it changes something.
      const found = productRun(name, args)
      if (found) runs.push({ kind: 'other', ...found })
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
    // One of bc-integration's other scripts: its subcommand (`branch create`, `extensions set`), which says whether it changes anything.
    const verb = found.kind === 'other' ? args.find(arg => !arg.startsWith('-')) : undefined
    if (verb && /^[a-z][a-z-]*$/.test(verb)) run.verb = verb
    if (found.kind === 'test') run.args = args
    for (let j = 0; j < args.length; j++) {
      const arg = args[j]!
      const value = args[j + 1]
      // An ID the shell fills in (`"$PID"`, `$(cat id)`) isn't known yet: the script's output names it.
      const isKnown = value !== undefined && value !== '' && !value.includes('$')
      if (arg === '--process-id' && isKnown) run.processId = value
      else if (arg === '--component-id' && isKnown) run.componentId = value
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
  /** The file a pull saved the component to, when the output names it. */
  file?: string
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

  // A script that warns but doesn't fail: the warning is what to read.
  const warning = !success && reading.outcome === 'ok' ? firstLine(output, /^\s*WARNING:/) : undefined
  if (warning) reading.detail = shorten(warning)

  const name = output.match(/[Cc]omponent '([^']+)'|Deployed '([^']+)'|Installed '([^']+)'/)
  if (name) reading.name = name[1] ?? name[2] ?? name[3]
  const id = output.match(/(?:with ID|componentId):?\s*([0-9a-f]{8}-[0-9a-f-]{27,})/i)
  if (id) reading.componentId = id[1]
  const version = output.match(/now version (\d+)/)
  if (version) reading.version = version[1]
  // A pull by component ID names its file only in its output.
  const saved = output.match(/Component saved to (.+\.xml)\s*$/m)
  if (saved) reading.file = saved[1]!.trim()

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
    // The same line twice (an output echoed by tee, or printed by a wrapper too) is one result.
    const isEcho = results.some(r => r.kind === result.kind && r.detail === result.detail && r.executionId === result.executionId && r.name === result.name)
    if (!isEcho) results.push(result)
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

/**
 * A run with no result of its own in a command that ran several scripts: it
 * failed if the command did, else it isn't known how it went.
 */
export const unclaimedReading = (isError: boolean): Reading =>
  isError
    ? { outcome: 'failed', detail: 'ERROR: the command failed before this script printed a result' }
    : { outcome: 'ok', detail: 'no result of its own (it ran in a command with other scripts)' }

/** The name a component ID has in the latest step that named it, if any. */
export const knownName = (activity: readonly Activity[], componentId: string): string | undefined =>
  [...activity].reverse().find(a => a.componentId === componentId && a.subject !== 'a component' && !/\.xml$/.test(a.subject))?.subject

/**
 * Steps recorded by older versions, made readable: "a component" gets the name
 * its component ID has in another step, a step that named a component but not
 * its ID takes the one ID that name has elsewhere, and a test that took
 * another script's SUCCESS line (before 0.26.0) says it had no result of its own.
 */
export const repaired = (activity: readonly Activity[]): Activity[] => {
  const names = new Map<string, string>()
  const ids = new Map<string, Set<string>>()
  for (const a of activity) {
    if (!a.componentId || a.subject === 'a component' || /\.xml$/.test(a.subject)) continue
    names.set(a.componentId, a.subject)
    ids.set(a.subject, (ids.get(a.subject) ?? new Set()).add(a.componentId))
  }
  return activity.map(a => {
    let b = a
    const only = ids.get(b.subject)
    if (b.kind !== 'other' && !b.componentId && !b.file && only?.size === 1) b = { ...b, componentId: [...only][0] }
    if (b.subject === 'a component' && b.componentId && names.has(b.componentId)) b = { ...b, subject: names.get(b.componentId)! }
    if (b.kind === 'test' && !b.executionStatus && /^SUCCESS:/.test(b.detail)) b = { ...b, detail: 'no result of its own (it ran in a command with other scripts)' }
    return b
  })
}

/** What makes a step the same as another: a test's execution, a deploy's package, a save's own line. */
const echoKey = (a: Activity): string | undefined => {
  if (a.product || a.outcome === 'running') return undefined
  if (a.kind === 'test') return a.executionId ? `test:${a.executionId}` : undefined
  if (a.kind === 'deploy') {
    const pkg = a.detail.match(/\(package: ([^)\s]+)\)/)?.[1]
    return pkg ? `deploy:${pkg}` : undefined
  }
  if ((a.kind === 'create' || a.kind === 'push') && /^SUCCESS:/.test(a.detail)) return `${a.kind}:${a.detail}`
  return undefined
}

/** How much a step says: a file, a real name and a tool call beat their absence. */
const richness = (a: Activity) => (a.file ? 4 : 0) + (a.subject !== 'a component' ? 2 : 0) + (a.source !== 'log' ? 1 : 0)

/**
 * The steps without echoes: the same test execution, deploy package or save
 * line twice within a few minutes is one step, the one that says the most.
 * Steps recorded before 0.26.0 could count a result printed twice as two, and
 * Companion's activity log can repeat a tool call's run.
 */
export const withoutEchoes = (activity: readonly Activity[]): Activity[] => {
  const best = new Map<string, Activity>()
  const dropped = new Set<number>()
  for (const a of activity) {
    const key = echoKey(a)
    if (!key) continue
    const seen = best.get(key)
    if (seen && Math.abs(a.startedAt - seen.startedAt) <= 5 * 60_000) {
      const keep = richness(a) > richness(seen) ? a : seen
      dropped.add(keep === a ? seen.id : a.id)
      best.set(key, keep)
    } else best.set(key, a)
  }
  return dropped.size === 0 ? [...activity] : activity.filter(a => !dropped.has(a.id))
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
  a.outcome === 'ok' && (isWarnStatus(a.executionStatus) || isSubmittedOnly(a) || isProductWarning(a)) ? 'warning' : LEVEL_OF[a.outcome]

/**
 * Another plugin's step that finished with a WARNING line, such as a
 * descriptor accepted with warnings; or a BDI run that started and hasn't
 * been seen to finish.
 */
const isProductWarning = (a: Activity) => a.product !== undefined && (/^WARNING:/.test(a.detail) || isUnderway(a))

/** Another plugin's work that started and hasn't been seen to finish: a BDI run, a Data Hub deployment. */
const isUnderway = (a: Activity) =>
  a.outcome === 'ok' &&
  !!a.runId &&
  ((a.product === 'bdi' && a.verb === 'run' && (!a.runStatus || a.runStatus === 'running' || a.runStatus === 'pending')) ||
    (a.product === 'datahub' && a.verb === 'deploy' && deployState(a.runStatus) === 'pending'))

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
  if (a.isBudgetOverride) return `Budget override: ${a.detail}`
  if (a.isBudgetBlocked) return describe({ ...a, isBudgetBlocked: undefined }).replace(/^Blocked: /, 'Blocked by budget: ')
  if (a.product === 'bdi' && a.verb === 'run' && a.runId && a.outcome !== 'running') {
    const flow = `BDI: flow ${a.subject}`
    if (a.runStatus === 'succeeded') return `${flow} ran and succeeded`
    if (a.runStatus === 'failed') return `${flow} run failed`
    if (a.runStatus === 'canceled') return `${flow} run cancelled`
    if (a.runStatus === 'skipped') return `${flow} run skipped`
    if (a.outcome === 'ok') return `${flow} run ${a.runStatus === 'pending' ? 'pending' : 'started'}`
  }
  if (a.product === 'datahub' && a.verb === 'deploy' && a.runId && a.outcome !== 'running') {
    const state = deployState(a.runStatus)
    if (state === 'pending') return `Data Hub: universe ${a.subject} deploying`
    if (state === 'failed') return `Data Hub: deploy of universe ${a.subject} failed`
  }
  if (isConversation(a)) {
    const who = a.subject || 'an agent'
    if (a.outcome === 'running') return `Agentstudio: talking to ${who}…`
    if (a.outcome === 'failed') return `Agentstudio: a test conversation with ${who} failed`
    if (a.outcome === 'blocked') return `Blocked: a test conversation with ${who}`
    return `Agentstudio: ${a.verb === 'continue' ? 'continued' : 'started'} a test conversation with ${who}`
  }
  if (a.product && a.script && a.verb !== undefined) {
    const run = { product: a.product, script: a.script, verb: a.verb, subject: a.subject }
    if (a.outcome === 'running') return productWords(run, 'doing')
    if (a.outcome === 'failed') return productWords(run, 'failed')
    if (a.outcome === 'blocked') return `Blocked: ${productWords(run, 'doing').replace(/…$/, '')}`
    return productWords(run, 'did')
  }
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
      return a.executionStatus
        ? `Test of ${a.subject} ${a.executionStatus === 'COMPLETE' ? 'passed' : `ended ${a.executionStatus}`}`
        : /^submitted/.test(a.detail)
          ? `Test of ${a.subject} ${a.detail}`
          : `Test of ${a.subject}: ${a.detail}`
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
  /** The Marketplace recipe it came from, when a recipe installed it. */
  recipe?: string
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
    if (a.recipe) row.recipe = a.recipe
    row.lastAt = Math.max(row.lastAt, a.endedAt ?? a.startedAt)
    if (a.kind === 'edit') row.edited = a
    else if (a.kind === 'create' || a.kind === 'push' || a.kind === 'pull') row.saved = a
    else if (a.kind === 'deploy' || a.kind === 'undeploy') row.deployed = a
    else if (a.kind === 'test') row.tested = a
    rows.set(key, row)
    if (row.componentId) byId.set(row.componentId, row)
    if (a.file) byFile.set(a.file, row)
  }
  // Only a process can be test-run: a tested component whose XML wasn't read is one.
  for (const row of rows.values()) if (!row.type && row.tested) row.type = 'process'
  return [...rows.values()].sort((a, b) => b.lastAt - a.lastAt)
}

export type Stage = { level: Level; text: string }

// --- Connector releases ---------------------------------------------------------

const isConnectorStep = (a: Activity) =>
  a.product === 'connectordev' &&
  (a.script === 'connectordev-descriptor-lint' ||
    (a.script === 'connectordev-version' && (a.verb === 'validate' || a.verb === 'upload')) ||
    a.script === 'connectordev-version-change')

/** A folder the OS keeps for temporary files: a descriptor checked there was unpacked from an archive. */
const isTempFolder = (path: string) => /^(?:\/tmp|\/private\/tmp|\/var\/folders|\/private\/var\/folders)\b/.test(path)

/** One custom connector this session: its latest descriptor checks, upload and version change. */
export type ConnectorRow = {
  key: string
  name: string
  project?: string
  group?: string
  linted?: Activity
  validated?: Activity
  uploaded?: Activity
  changed?: Activity
  lastAt: number
  ids: number[]
}

/** A classification's tier: what follows its group in `<groupType>-<tier>`, as dev, qa or prod. */
const tierOf = (classification: string, group?: string) =>
  group && classification.startsWith(`${group}-`) ? classification.slice(group.length + 1) : (classification.split('-').pop() ?? classification)

/**
 * The session's custom connectors, newest first. A descriptor check or an
 * upload names a path in its project, and an upload names its group too, so
 * steps group by project, then by group; a version change finds its row
 * through its classification, `<groupType>-<tier>`. A descriptor checked in
 * a temporary folder, unpacked from an archive, joins the latest connector.
 */
export const connectors = (activity: readonly Activity[]): ConnectorRow[] => {
  const rows = new Map<string, ConnectorRow>()
  const byProject = new Map<string, string>()
  const byGroup = new Map<string, string>()
  let latest: string | undefined
  for (const a of activity) {
    if (!isConnectorStep(a)) continue
    const isChange = a.script === 'connectordev-version-change'
    const group =
      a.group ??
      (isChange && a.ref ? ([...byGroup.keys()].find(g => a.ref!.startsWith(`${g}-`)) ?? a.ref.replace(/-[^-]+$/, '')) : undefined)
    const isCheck = a.script === 'connectordev-descriptor-lint' || a.verb === 'validate'
    const key =
      (a.project && byProject.get(a.project)) ||
      (group && byGroup.get(group)) ||
      (isCheck && a.project && isTempFolder(a.project) && latest) ||
      (a.project ? `project:${a.project}` : group ? `group:${group}` : undefined)
    if (!key) continue
    const row: ConnectorRow = rows.get(key) ?? { key, name: '', lastAt: a.startedAt, ids: [] }
    if (a.project && !isTempFolder(a.project) && !row.project) row.project = a.project
    if (group && !row.group) row.group = group
    const folder = row.project && row.project !== '.' && row.project !== '/' ? row.project.split('/').filter(Boolean).pop() : undefined
    row.name = folder ?? (row.group ? (row.group.length > 24 ? `${row.group.slice(0, 8)}…` : row.group) : 'Connector project')
    row.ids.push(a.id)
    row.lastAt = Math.max(row.lastAt, a.endedAt ?? a.startedAt)
    if (a.script === 'connectordev-descriptor-lint') row.linted = a
    else if (a.verb === 'validate') row.validated = a
    else if (a.verb === 'upload') row.uploaded = a
    else row.changed = a
    rows.set(key, row)
    if (row.project) byProject.set(row.project, key)
    if (a.project) byProject.set(a.project, key)
    if (row.group) byGroup.set(row.group, key)
    latest = key
  }
  return [...rows.values()].sort((a, b) => b.lastAt - a.lastAt)
}

/** A connector's release as short steps, each with an icon and a label, as a component's are. */
export const connectorStages = (row: ConnectorRow): Stage[] => {
  const out: Stage[] = []
  const { linted, validated, uploaded, changed } = row
  const common = (a: Activity, doing: string, failed: string): Stage | undefined => {
    if (a.outcome === 'running') return { level: 'warning', text: `${doing}…` }
    if (a.outcome === 'blocked') return { level: 'serious', text: `${doing} blocked` }
    if (a.outcome === 'failed') return { level: 'critical', text: failed }
    return undefined
  }
  if (linted) out.push(common(linted, 'linting', 'lint failed') ?? { level: 'healthy', text: 'descriptor linted' })
  if (validated) {
    out.push(
      common(validated, 'validating', 'descriptor rejected') ??
        (/^WARNING:/.test(validated.detail) ? { level: 'warning', text: 'validated with warnings' } : { level: 'healthy', text: 'validated' }),
    )
  }
  if (uploaded) out.push(common(uploaded, 'uploading', 'upload failed') ?? { level: 'healthy', text: uploaded.version ? `uploaded v${uploaded.version}` : 'uploaded' })
  if (changed) {
    const tier = changed.ref ? tierOf(changed.ref, row.group) : 'its classification'
    const v = changed.version ? `v${changed.version}` : 'the version'
    if (changed.verb === 'cancel') out.push(common(changed, 'cancelling', 'cancel failed') ?? { level: 'healthy', text: `change on ${tier} cancelled` })
    else {
      out.push(
        common(changed, 'changing the version', 'version change failed') ??
          (isAwaitingApproval(changed.runStatus) ? { level: 'warning', text: `${v} awaiting approval on ${tier}` } : { level: 'healthy', text: `${v} active on ${tier}` }),
      )
    }
  }
  // An upload is used only once a version change makes it active: say so until one does.
  if (uploaded?.outcome === 'ok' && (!changed || changed.outcome !== 'ok' || changed.verb !== 'set' || when(changed) < when(uploaded) || (!!changed.version && !!uploaded.version && changed.version !== uploaded.version))) {
    out.push({ level: 'warning', text: `${uploaded.version ? `v${uploaded.version}` : 'the upload'} not active yet` })
  }
  return out
}

// --- Agentstudio agents ---------------------------------------------------------

/** A turn of a test conversation with a deployed Agentstudio agent. */
const isConversation = (a: Activity) => a.product === 'agentstudio' && a.script === 'agentstudio-session' && (a.verb === 'invoke' || a.verb === 'continue')

/** An Agentstudio step on an agent itself: authored, packaged or deployed. Its `ref` is the agent's ID. */
const isAgentStep = (a: Activity) =>
  a.product === 'agentstudio' &&
  ((a.script === 'agentstudio-agent' && (a.verb === 'create' || a.verb === 'update')) ||
    (a.script === 'agentstudio-deployment' && (a.verb === 'package-create' || a.verb === 'deploy')))

/** An agent's name as Claude's steps learned it, by its ID. */
export const agentName = (activity: readonly Activity[], agentId: string): string | undefined =>
  [...activity].reverse().find(a => isAgentStep(a) && a.ref === agentId && a.subject && !agentId.startsWith(a.subject.replace(/…$/, '')))?.subject

/** The agent a deployment belongs to, from the deploy that made it. */
export const agentOfDeployment = (activity: readonly Activity[], deploymentId: string): string | undefined =>
  [...activity].reverse().find(a => isAgentStep(a) && a.deploymentId === deploymentId && a.ref)?.ref

/** One Agentstudio agent this session: its latest authoring, packaging and deploy, and its test conversations. */
export type AgentRow = {
  key: string
  name: string
  agentId?: string
  authored?: Activity
  packaged?: Activity
  deployed?: Activity
  /** Every turn of its test conversations, oldest first. */
  turns: Activity[]
  lastAt: number
  ids: number[]
}

/**
 * The session's Agentstudio agents, newest first. Steps on an agent group by
 * its ID; a test conversation joins the agent whose deployment it talked
 * to, else a row of its own for that deployment.
 */
export const agents = (activity: readonly Activity[]): AgentRow[] => {
  const rows = new Map<string, AgentRow>()
  for (const a of activity) {
    const conversation = isConversation(a)
    if (!conversation && !isAgentStep(a)) continue
    const agentId = conversation ? (a.deploymentId ? agentOfDeployment(activity, a.deploymentId) : undefined) : a.ref
    const key = agentId ? `agent:${agentId}` : conversation && a.deploymentId ? `deployment:${a.deploymentId}` : undefined
    if (!key) continue
    const name = agentId ? (agentName(activity, agentId) ?? (agentId.length > 14 ? `${agentId.slice(0, 8)}…` : agentId)) : a.subject
    const row: AgentRow = rows.get(key) ?? { key, name, ...(agentId ? { agentId } : {}), turns: [], lastAt: a.startedAt, ids: [] }
    row.name = name
    row.ids.push(a.id)
    row.lastAt = Math.max(row.lastAt, a.endedAt ?? a.startedAt)
    if (conversation) row.turns.push(a)
    else if (a.verb === 'create' || a.verb === 'update') row.authored = a
    else if (a.verb === 'package-create') {
      row.packaged = a
      // Packaged with --deploy: the response named the deployment, so it's deployed too.
      if (a.deploymentId && a.outcome === 'ok') row.deployed = a
    } else row.deployed = a
    rows.set(key, row)
  }
  return [...rows.values()].sort((a, b) => b.lastAt - a.lastAt)
}

/** An agent's journey as short steps, each with an icon and a label, as a component's are. */
export const agentStages = (row: AgentRow): Stage[] => {
  const out: Stage[] = []
  const { authored, packaged, deployed, turns } = row
  const okAt = (a: Activity | undefined) => (a && a.outcome === 'ok' ? when(a) : undefined)
  if (authored) {
    const verb = authored.verb === 'create' ? 'create' : 'update'
    if (authored.outcome === 'running') out.push({ level: 'warning', text: 'saving…' })
    else if (authored.outcome === 'blocked') out.push({ level: 'serious', text: `${verb} blocked` })
    else if (authored.outcome === 'failed') out.push({ level: 'critical', text: `${verb} failed` })
    else out.push({ level: 'healthy', text: verb === 'create' ? 'created' : 'updated' })
  }
  if (packaged) {
    if (packaged.outcome === 'running') out.push({ level: 'warning', text: 'packaging…' })
    else if (packaged.outcome === 'blocked') out.push({ level: 'serious', text: 'packaging blocked' })
    else if (packaged.outcome === 'failed') out.push({ level: 'critical', text: 'packaging failed' })
    else out.push({ level: 'healthy', text: packaged.version ? `packaged v${packaged.version}` : 'packaged' })
  }
  if (deployed && deployed !== packaged) {
    if (deployed.outcome === 'running') out.push({ level: 'warning', text: 'deploying…' })
    else if (deployed.outcome === 'blocked') out.push({ level: 'serious', text: 'deploy blocked' })
    else if (deployed.outcome === 'failed') out.push({ level: 'critical', text: 'deploy failed' })
    else out.push({ level: 'healthy', text: 'deployed' })
  } else if (deployed) out.push({ level: 'healthy', text: 'deployed' })
  // Edits go live only through a new package, deployed: say which step is still to do.
  const authoredAt = okAt(authored)
  const packagedAt = okAt(packaged)
  const deployedAt = okAt(deployed)
  if (authoredAt !== undefined && packagedAt !== undefined && authoredAt > packagedAt) out.push({ level: 'warning', text: 'changed since packaged' })
  else if (authoredAt !== undefined && deployedAt !== undefined && packagedAt === undefined && authoredAt > deployedAt) out.push({ level: 'warning', text: 'changes not live' })
  else if (packagedAt !== undefined && deployedAt !== undefined && packagedAt > deployedAt) out.push({ level: 'warning', text: 'new package not deployed' })
  const done = turns.filter(t => t.outcome !== 'running')
  if (turns.some(t => t.outcome === 'running')) out.push({ level: 'warning', text: 'talking…' })
  if (done.length > 0) {
    const conversations = Math.max(1, done.filter(t => t.verb === 'invoke').length)
    const failed = done.filter(t => t.outcome === 'failed' || t.outcome === 'blocked').length
    const last = done[done.length - 1]!
    const what = `${plural(conversations, 'test conversation')}, ${plural(done.length, 'turn')}`
    if (last.outcome === 'failed' || last.outcome === 'blocked') out.push({ level: 'critical', text: `${what}; the last failed` })
    else if (failed > 0) out.push({ level: 'warning', text: `${what}; ${failed} failed` })
    else out.push({ level: 'healthy', text: `${what}, all answered` })
  }
  return out
}

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

  // Where it came from, when a Marketplace recipe installed it; its install is its first save.
  if (row.recipe) out.push({ level: 'healthy', text: `from recipe ${row.recipe}${saved?.recipe && saved.version ? ` (v${saved.version})` : ''}` })
  if (edited && (!saved || when(edited) > when(saved))) {
    out.push({ level: 'warning', text: saved ? 'edited since last save' : 'edited, not in Boomi yet' })
  }
  if (saved && !saved.recipe) {
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
  /** A failed BDI run, whose log Why? reads: its flow, run and the reason BDI gave. */
  bdiRun?: { flow: string; run: string; reason?: string }
  /** A failed test's step, when it can be run again. */
  rerunId?: number
}

/** Where an item's Why? keeps what it read: a test's execution, or a BDI run. */
export const logKeyOf = (n: Pick<Attention, 'executionId' | 'bdiRun'>): string | undefined => n.executionId ?? (n.bdiRun ? `bdi:${n.bdiRun.run}` : undefined)

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

/**
 * A test's arguments to run it again: a process ID the shell filled in
 * (`"$PID"`, `$(cat id)`) becomes the one its output gave. Undefined when
 * that ID isn't known or another argument still needs the shell.
 */
export const rerunArgs = (args: readonly string[], componentId: string | undefined): string[] | undefined => {
  const out = args.map((arg, i) => (args[i - 1] === '--process-id' && arg.includes('$') && componentId ? componentId : arg))
  return out.some(arg => arg.includes('$')) ? undefined : out
}

/** What failed and is still failing, each with what to do about it. */
export const attention = (dashboard: Dashboard, now: number, windowMs: number): Attention[] => {
  const items: Attention[] = []
  const closedSteps = new Set(dashboard.closedSteps ?? [])
  for (const row of components(dashboard.activity)) {
    for (const a of [row.saved, row.deployed, row.tested]) {
      if (!a || a.isEarlier || (a.outcome !== 'failed' && a.outcome !== 'blocked') || closedSteps.has(a.id)) continue
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
        rerunId: a.kind === 'test' && a.args && rerunArgs(a.args, a.componentId) ? a.id : undefined,
      })
    }
  }
  for (const a of productIssues(dashboard.activity)) {
    if (closedSteps.has(a.id) || a.isEarlier) continue
    // A failed BDI run whose flow and run are known: Why? reads its log.
    const isBdiRun = a.product === 'bdi' && a.verb === 'run' && a.outcome === 'failed' && a.runId !== undefined && a.ref !== undefined
    const reason = isBdiRun ? bdiReasonOf(a.detail) : undefined
    items.push({
      key: `step:${a.id}`,
      level: levelOf(a),
      title: describe(a),
      hint: isBdiRun ? `${reason ? `${reason}. ` : ''}Run ${a.runId!.slice(0, 8)}…: press Why? to read its log.` : a.detail,
      at: when(a),
      ...(isBdiRun ? { bdiRun: { flow: a.ref!, run: a.runId!, ...(reason ? { reason } : {}) } } : {}),
    })
  }
  for (const [universe, q] of Object.entries(dashboard.quarantine ?? {})) {
    if (q.count <= (q.seen ?? 0)) continue
    items.push({
      key: `quarantine:${universe}`,
      level: 'warning',
      title: `${q.count} record${q.count === 1 ? '' : 's'} in Data Hub quarantine, universe ${shortId(universe)}`,
      hint: `${q.causes}.${q.reason ? ` First: ${q.reason}` : ''} Close this once they're handled; more will show again.`,
      at: q.checkedAt,
    })
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
  attention(reopenAll(dashboard), now, windowMs).length - attention(dashboard, now, windowMs).length

/** What closing an item changes in the dashboard: a step is closed, a run seen, a watched change cleared. */
export const closeItem = (dashboard: Dashboard, key: string): Dashboard => {
  const [kind, ...rest] = key.split(':')
  const id = rest.join(':')
  if (kind === 'step') return { ...dashboard, closedSteps: [...new Set([...(dashboard.closedSteps ?? []), Number(id)])].slice(-200) }
  if (kind === 'run') return { ...dashboard, seenRuns: [...new Set([...(dashboard.seenRuns ?? []), id])].slice(-200) }
  if (kind === 'watch') return { ...dashboard, watched: dashboard.watched.map(w => (w.componentId === id ? { ...w, changedBy: undefined } : w)) }
  if (kind === 'quarantine' && dashboard.quarantine?.[id]) {
    return { ...dashboard, quarantine: { ...dashboard.quarantine, [id]: { ...dashboard.quarantine[id]!, seen: dashboard.quarantine[id]!.count } } }
  }
  return dashboard
}

/** Brings back every closed step and run. (A watched change, once cleared, comes back with the next one.) */
export const reopenAll = (dashboard: Dashboard): Dashboard => ({
  ...dashboard,
  closedSteps: [],
  seenRuns: [],
  ...(dashboard.quarantine ? { quarantine: Object.fromEntries(Object.entries(dashboard.quarantine).map(([u, q]) => [u, { ...q, seen: 0 }])) } : {}),
})

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
  let session: string | undefined
  for (const a of activity) {
    // Each session counts from its own ledger: start over where the session changes,
    // or where the running cost goes down (a session from before steps named theirs).
    const isNewSession =
      (wasRestored !== undefined && Boolean(a.isRestored) !== wasRestored) ||
      (a.session !== undefined && session !== undefined && a.session !== session) ||
      (a.usdAt !== undefined && usd !== undefined && a.usdAt < usd)
    if (isNewSession) {
      tokens = 0
      usd = undefined
    }
    wasRestored = Boolean(a.isRestored)
    session = a.session ?? session
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
  [...activity].reverse().find(a => (a.kind !== 'other' || a.product) && a.kind !== 'edit') ?? activity[activity.length - 1]

/**
 * The status line: the latest thing Companion did, then what needs attention,
 * then the session's tokens and cost. The engine prefixes it with the mod's name.
 * Until Companion does something this session, a step from an earlier one isn't
 * news: it says the session is new, and when the last one ended, as the banner does.
 */
export const statusLine = (dashboard: Dashboard, now: number, windowMs: number, usage: Usage = {}, recap?: SessionRecap): string => {
  const parts: string[] = []
  if (usage.isPaused) parts.push(PAUSED)
  const isNew = !dashboard.activity.some(a => !a.isRestored)
  const latest = isNew ? undefined : headline(dashboard.activity)
  const needs = attention(dashboard, now, windowMs)
  if (latest) parts.push(`${STATUS[levelOf(latest)].icon} ${describe(latest)}`)
  else if (recap) {
    const left = needs.length > 0 ? '' : recap.open > 0 ? `, ${recap.open} left to fix` : ', nothing left to fix'
    parts.push(`New session · last one ${ago(recap.endedAt, now)}${left}`)
  }
  if (needs.length > 0) parts.push(`${STATUS[worst(needs.map(n => n.level))].icon} ${needs.length} need${needs.length === 1 ? 's' : ''} attention`)
  if (parts.length === 0) parts.push('waiting for Companion')
  const spent = [usage.tokens ? `${formatTokens(usage.tokens)} tokens` : undefined, formatCost(usage.usd)].filter(Boolean)
  if (spent.length > 0) parts.push(`${spent.join(' · ')} this session`)
  const left = budgetOf(usage.usd, usage.budgetUsd)
  if (left && left.level !== 'healthy') parts.push(`${STATUS[left.level].icon} ${left.text}`)
  for (const b of [usage.companion?.week, usage.companion?.month]) if (b && b.level !== 'healthy') parts.push(`${STATUS[b.level].icon} ${b.text}`)
  const tight = limitViews(usage.limits, usage.now ?? now).find(v => v.level !== 'healthy')
  if (tight) parts.push(`${STATUS[tight.level].icon} ${tight.name} limit ${Math.round(tight.percent)}%${tight.isRunningOut ? `, ${tight.pace}` : ''}`)
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
  /** The seat's usage limits, as Claude Code reports them; empty off a subscription. */
  limits?: Limit[]
  /** When these were read, for the limits' reset times and pace. */
  now?: number
  /** Where Companion stands against the person's own budget: its share of the weekly limit, its month. */
  companion?: { week?: BudgetView; month?: BudgetView }
  /** Set while a spent budget pauses Companion changes (budgetEnforce confirm or block). */
  isPaused?: boolean
  /** Companion's share of all the person's usage, from Claude Code's /usage breakdown: "20% of your usage today · 18% this week". */
  companionUse?: string
  /** The habit that drove most of the week's usage, from the same breakdown: "44% of your usage was at >150k context". */
  usageHabit?: string
  /** Set when /usage's text had windows but nothing the dashboard understood, so a reworded output says so instead of going quiet. */
  isUsageUnreadable?: true
  /** The account's monthly Claude budget and what's used, from the headless /usage run's `extra_usage`. */
  extraUsage?: { limitUsd: number; usedUsd: number; percent: number }
  /** The reset, today's spend and where the month leads, from the daily figures the dashboard keeps. */
  pace?: SpendPace
}

/**
 * The monthly Claude budget's reset, pace and today's spend in words: one
 * line for where the month leads, one for today. The pace is the month's
 * average so far carried to the reset, not a forecast of what you'll do.
 */
export const paceWords = (extra: { limitUsd: number }, pace: SpendPace | undefined, now: number): { pace?: string; isRunningOut?: true; today?: string } => {
  if (!pace) return {}
  const left = span(Math.max(0, pace.resetsAt - now))
  const out: { pace?: string; isRunningOut?: true; today?: string } = {}
  if (pace.exhaustsAt !== undefined && pace.dailyUsd !== undefined) {
    out.pace = `at ${formatCost(pace.dailyUsd)}/day it's used up in ${span(Math.max(0, pace.exhaustsAt - now))}, before the reset in ${left}`
    out.isRunningOut = true
  } else if (pace.projectedUsd !== undefined) out.pace = `on pace for ${formatCost(pace.projectedUsd)} (${Math.round((pace.projectedUsd / extra.limitUsd) * 100)}%) by the reset in ${left}`
  else out.pace = `resets in ${left}`
  const today = [pace.todayUsd === undefined ? undefined : `${formatCost(pace.todayUsd)} today`, pace.dailyUsd === undefined ? undefined : `${formatCost(pace.dailyUsd)}/day this month`].filter(Boolean)
  if (today.length > 0) out.today = today.join(' · ')
  return out
}

/**
 * The lines the headless /usage run adds to the usage, for the text summary and
 * the Markdown report: the monthly Claude budget in dollars, Companion's share
 * of all usage, and the habit behind most of it. The pane and the HTML report
 * draw the same facts from budgetLines.
 */
export const usageReadLines = (usage: Usage): string[] => {
  const x = usage.extraUsage
  const lines: string[] = []
  if (x) {
    const level: Level = x.percent >= 100 ? 'critical' : x.percent >= 80 ? 'warning' : 'healthy'
    lines.push(`${STATUS[level].icon} Claude budget: ${formatCost(x.usedUsd)} of ${formatCost(x.limitUsd)} this month (${Math.round(x.percent)}%)`)
  }
  if (x) {
    const w = paceWords(x, usage.pace, usage.now ?? Date.now())
    if (w.pace) lines.push(`Claude pace: ${w.pace}`)
    if (w.today) lines.push(`Claude spend: ${w.today}`)
  }
  if (usage.companionUse) lines.push(`Companion: ${usage.companionUse} (Claude Code's estimate, this machine)`)
  if (usage.isUsageUnreadable) lines.push("Companion: couldn't read Claude Code's /usage (its wording changed); update the dashboard")
  if (usage.usageHabit) lines.push(`This week: ${usage.usageHabit}`)
  return lines
}

/** What the status line and banner say while a spent budget pauses Companion changes. */
export const PAUSED = '⛔ budget reached, Companion changes paused'

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
  if (dashboard.restored) lines.push(`  (${restoredNote(dashboard.restored, windowMs, dashboard.earlier?.length === 0)})`)
  if (dashboard.earlier?.length) lines.push(`  (${dashboard.earlier.length} older step${dashboard.earlier.length === 1 ? '' : 's'}: /bc-dashboard earlier shows them)`)
  for (const row of rows) {
    const type = friendlyType(row.type)
    const spent = formatSpend(spendOf(row.ids, all))
    lines.push(`  ${row.name}${type ? ` (${type})` : ''}: ${stages(row, runs).map(s => `${STATUS[s.level].icon} ${s.text}`).join('  ')}${spent ? `  [${spent}]` : ''}`)
  }

  const byProduct = productSpendLine(dashboard.activity, all)
  if (byProduct) lines.push(`  ${byProduct}`)

  const connectorRows = connectors(dashboard.activity)
  if (connectorRows.length > 0) {
    lines.push('', 'Custom connectors:')
    for (const row of connectorRows) {
      const spent = formatSpend(spendOf(row.ids, all))
      lines.push(`  ${row.name}: ${connectorStages(row).map(s => `${STATUS[s.level].icon} ${s.text}`).join('  ')}${spent ? `  [${spent}]` : ''}`)
    }
  }

  const agentRows = agents(dashboard.activity)
  if (agentRows.length > 0) {
    lines.push('', 'Agentstudio agents:')
    for (const row of agentRows) {
      const spent = formatSpend(spendOf(row.ids, all))
      lines.push(`  ${row.name}: ${agentStages(row).map(s => `${STATUS[s.level].icon} ${s.text}`).join('  ')}${spent ? `  [${spent}]` : ''}`)
    }
  }

  const feed = dashboard.activity.filter(a => !a.recipe).slice(-8).reverse()
  if (feed.length > 0) {
    lines.push('', "Claude's latest steps (what Claude just did with Companion, newest first):")
    for (const a of feed) {
      const spent = formatSpend(all.get(a.id))
      lines.push(`  ${STATUS[levelOf(a)].icon} ${describe(a)}, ${ago(when(a), now)}${a.source === 'log' ? " (from Companion's log)" : ''}${spent ? `  [${spent}]` : ''}`)
    }
  }

  const quarantine = quarantineLines(dashboard, now)
  if (quarantine.length > 0) {
    lines.push('', 'Data Hub quarantine:')
    for (const q of quarantine) lines.push(`  ${STATUS[q.level].icon} ${q.text}`)
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
  const limits = limitsLine(usage.limits, usage.now ?? now)
  if (limits) lines.push(limits)
  for (const b of [usage.companion?.week, usage.companion?.month]) if (b) lines.push(`${STATUS[b.level].icon} ${b.text}`)
  lines.push(...usageReadLines(usage))
  if (usage.split) lines.push(`Tokens: ${usage.split}`)
  for (const line of usage.modelSplits ?? []) lines.push(`  ${line}`)
  if (usage.model && !usage.modelSplits?.length) lines.push(`Model: ${usage.model}`)
  return lines.join('\n')
}

/** Says that some steps came back from an earlier session in this folder. */
export const restoredNote = (count: number, windowMs: number, isAll = false): string =>
  `${count} step${count === 1 ? '' : 's'} from earlier sessions in this folder${isAll ? '' : `, last ${Math.round(windowMs / 3_600_000)}h`}`

/** How many of this folder's older steps can still be shown, in words: "Show 12 earlier". */
export const earlierLabel = (count: number): string => `Show ${count} earlier`

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
/** Resting: one straight leg down to its foot, the other folded up beside it, knee out. */
const ONE_LEG = ['......P.PPP.', '......P..P..', '......P.....', '.....PP.....']

/** A sprite's rows reflected across a vertical line: x becomes `about - x`, within 12 pixels. */
const reflect = (rows: readonly string[], about: number): string[] =>
  rows.map(row => {
    const out = Array.from({ length: 12 }, () => '.')
    ;[...row].forEach((c, x) => {
      if (c !== '.' && about - x >= 0 && about - x < 12) out[about - x] = c
    })
    return out.join('')
  })

/** Standing on the other leg: the standing leg and the tucked one trade places under the body. */
const OTHER_LEG = reflect(ONE_LEG, 14)

/** The head turned to look back over its shoulder: the head and neck reflected about the neck. */
const LOOKING_BACK = reflect(HEAD, 11)

/** Standing on one leg, as the flamingo mostly does. */
export const FLAMINGO_IDLE: readonly string[] = [...HEAD, ...WING_DOWN, ...ONE_LEG]

/** The flamingo's width in pixels, and the strip it stands in: room either side for it to turn, and for a visitor. */
export const FLAMINGO_WIDTH = 12
export const STRIP_WIDTH = 18
/** Where it stands in the strip: in the middle. */
const STAND_AT = 3

/** What the flamingo is doing: which way it faces, which leg it stands on, whether it looks back or blinks, and how far a visitor has peeked in. */
export type FlamingoScene = { facing: 'right' | 'left'; leg: 'one' | 'other'; isLookingBack: boolean; isBlinking: boolean; visitor: number }

/**
 * A number from 0 to 2^32 that looks random but is always the same for the
 * same inputs: so the flamingo's habits vary, and a tick always draws the same.
 */
const noise = (n: number, salt: number): number => {
  let x = Math.imul(n ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return (x ^ (x >>> 16)) >>> 0
}

/** Ticks of half a second, grouped into stretches of 15 seconds: in about half of them it does one small thing. */
const SLOT_TICKS = 30
/** It may shift its weight each minute, and may turn around every two: each a coin flip. */
const LEG_SLOTS = 4
const TURN_SLOTS = 8
/** A neighbour may drop by in each 10-minute stretch, at a random moment: columns shown, tick by tick. */
const VISIT_TICKS = 1200
const VISIT = [2, 4, 6, 6, 6, 6, 6, 4, 2]

/**
 * The flamingo at a tick: standing in one place, as flamingos do. In about
 * half of its 15-second stretches it glances back over its shoulder for a
 * second or two, and in the others it may blink; now and then it shifts to
 * the other leg or turns around; and once in a while a neighbour looks in
 * and leaves. Something every 10 to 15 seconds: enough to see it's alive,
 * never so much it distracts.
 */
export const sceneAt = (tick: number): FlamingoScene => {
  const t = Math.max(0, Math.floor(tick))
  const slot = Math.floor(t / SLOT_TICKS)
  const at = t % SLOT_TICKS
  // A glance back in half the stretches, starting at a random moment, 1.5 to 3 seconds long.
  const glance = noise(slot, 1)
  const isGlancing = glance % 2 === 0
  const glanceAt = 3 + (glance % 18)
  const isLookingBack = isGlancing && at >= glanceAt && at < glanceAt + 3 + ((glance >>> 8) % 4)
  // In most of the others, a blink: half a second.
  const blink = noise(slot, 2)
  const isBlinking = !isGlancing && blink % 4 !== 0 && at === 2 + (blink % 26)
  const visitEpoch = Math.floor(t / VISIT_TICKS)
  const visit = noise(visitEpoch, 5)
  const v = t % VISIT_TICKS - (visit % (VISIT_TICKS - VISIT.length))
  return {
    facing: noise(Math.floor(slot / TURN_SLOTS), 3) % 2 === 0 ? 'right' : 'left',
    leg: noise(Math.floor(slot / LEG_SLOTS), 4) % 2 === 0 ? 'one' : 'other',
    isLookingBack,
    isBlinking,
    visitor: visit % 2 === 0 && v >= 0 && v < VISIT.length ? VISIT[v]! : 0,
  }
}

/** The flamingo's own pixels for a scene, 12 wide: head, wing and legs as the scene has them, reflected to face left. */
export const flamingo = (scene: FlamingoScene): string[] => {
  const head = scene.isLookingBack ? LOOKING_BACK : HEAD
  // A blink: the eye closes for a moment, its one dark pixel gone pink.
  const eyes = scene.isBlinking ? [head[0]!, head[1]!.replace('K', 'P'), ...head.slice(2)] : head
  const pixels = [...eyes, ...WING_DOWN, ...(scene.leg === 'one' ? ONE_LEG : OTHER_LEG)]
  return scene.facing === 'right' ? pixels : reflect(pixels, 11)
}

/**
 * The whole strip for a scene, 16 pixel rows: the flamingo in the middle, and
 * the visitor's head and neck peeking in from the edge it faces, looking at
 * it. A visitor shows the columns nearest the edge first.
 */
export const sceneRows = (scene: FlamingoScene, width = STRIP_WIDTH): string[] => {
  const rows = flamingo(scene).map(row => ('.'.repeat(STAND_AT) + row).padEnd(width, '.').slice(0, width).split(''))
  if (scene.visitor > 0) {
    // The neighbour comes in from the side the flamingo faces, facing it.
    const fromRight = scene.facing === 'right'
    const head = fromRight ? reflect(HEAD, 11) : [...HEAD]
    const cols = [...Array(12).keys()].filter(x => head.some(r => r[x] !== '.'))
    const near = fromRight ? Math.min(...cols) : Math.max(...cols)
    head.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c === '.') return
        const at = fromRight ? width - scene.visitor + (x - near) : scene.visitor - 1 - (near - x)
        if (at >= 0 && at < width) rows[y]![at] = c
      }),
    )
  }
  return rows.map(r => r.join(''))
}

/** The water the flamingo stands in: one thin, still pixel row across the strip, three on and one off, under an empty row. */
export const pondRows = (width = STRIP_WIDTH): string[] => ['.'.repeat(width), Array.from({ length: width }, (_, x) => 'WWW.'[x % 4]).join('')]

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

/** The request "Ask Claude to fix" puts in the prompt box for a failed BDI run. */
export const bdiFixPrompt = (title: string, run: { flow: string; run: string }, diagnosis: Diagnosis): string =>
  [
    `${title} (flow ${run.flow}, run ${run.run}). BDI says:`,
    ...diagnosis.lines.map(line => `  ${line}`),
    "Find the cause in the flow, following bc-bdi's troubleshooting guide, and propose a fix. Don't change the flow until I approve it.",
  ].join('\n')

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
  /** The Platform changes section's lines (changes.ts), placed after the budget overrides. */
  changes?: readonly string[]
  /** The Prompt tips section's lines (prompt-check.ts's reportLines), none before a prompt was checked. */
  promptLines?: readonly string[]
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

  const connectorRows = connectors(dashboard.activity)
  if (connectorRows.length > 0) {
    lines.push('', `## Custom connectors (${connectorRows.length})`, '')
    lines.push('| Connector | Where it stands | Tokens | Cost |', '|---|---|---|---|')
    for (const row of connectorRows) {
      const spent = spendOf(row.ids, all)
      const where = connectorStages(row).map(s => `${STATUS[s.level].icon} ${s.text}`).join(' · ')
      lines.push(`| ${cell(row.name)}${row.group && row.name !== row.group ? ` (${cell(row.group)})` : ''} | ${cell(where)} | ${spent.tokens ? formatTokens(spent.tokens) : ''} | ${formatCost(spent.usd) ?? ''} |`)
    }
  }

  const agentRows = agents(dashboard.activity)
  if (agentRows.length > 0) {
    lines.push('', `## Agentstudio agents (${agentRows.length})`, '')
    lines.push('| Agent | Where it stands | Tokens | Cost |', '|---|---|---|---|')
    for (const row of agentRows) {
      const spent = spendOf(row.ids, all)
      const where = agentStages(row).map(s => `${STATUS[s.level].icon} ${s.text}`).join(' · ')
      lines.push(`| ${cell(row.name)} | ${cell(where)} | ${spent.tokens ? formatTokens(spent.tokens) : ''} | ${formatCost(spent.usd) ?? ''} |`)
    }
  }

  const shipped = dashboard.activity.filter(a => (a.kind === 'deploy' || a.kind === 'undeploy' || a.kind === 'test') && a.outcome !== 'running')
  lines.push('', '## Deployments and tests', '')
  if (shipped.length === 0) lines.push('None this session.')
  for (const a of shipped) lines.push(`- ${STATUS[levelOf(a)].icon} ${describe(a)}${a.executionId ? ` (execution ${a.executionId})` : ''}`)

  const others = dashboard.activity.filter(a => a.product && a.outcome !== 'running')
  if (others.length > 0) {
    lines.push('', "## Companion's other plugins", '')
    for (const a of others) lines.push(`- ${STATUS[levelOf(a)].icon} ${describe(a)}`)
  }
  const quarantine = quarantineLines(dashboard, now)
  if (quarantine.length > 0) {
    lines.push('', '## Data Hub quarantine', '')
    for (const q of quarantine) lines.push(`- ${STATUS[q.level].icon} ${q.text}`)
  }

  lines.push('', '## Needs attention', '')
  if (needs.length === 0) lines.push('Nothing open.')
  for (const n of needs) lines.push(`- ${STATUS[n.level].icon} ${n.title}`)
  if (closed > 0) lines.push(`- ☑ ${closed} closed as expected or handled`)

  const overrides = dashboard.activity.filter(a => a.isBudgetOverride)
  if (overrides.length > 0) {
    lines.push('', '## Budget overrides', '', 'Companion changes allowed past a spent budget, as the user chose:', '')
    for (const a of overrides) lines.push(`- ${new Date(a.startedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC: ${a.detail}`)
  }
  if (facts.changes && facts.changes.length > 0) lines.push('', ...facts.changes)

  lines.push(...(facts.promptLines ?? []))

  lines.push('', '## Spend', '')
  if (u.usd !== undefined) lines.push(`- Cost: ${formatCost(u.usd)}`)
  const limits = limitsLine(u.limits, u.now ?? now)
  if (limits) lines.push(`- ${limits}`)
  for (const b of [u.companion?.week, u.companion?.month]) if (b) lines.push(`- ${STATUS[b.level].icon} ${b.text}`)
  for (const line of usageReadLines(u)) lines.push(`- ${line}`)
  const byProduct = productSpendLine(dashboard.activity, all)
  if (byProduct) lines.push(`- ${byProduct}`)
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
  prompts?: number
  peakContext?: number
  compactions?: number
  subagentTokens?: number
  file?: string
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
    const products: Partial<Record<Product, number>> = {}
    const files = new Set<string>()
    const ids = new Set<string>()
    // The same step on the same component, counted, for the cost review.
    const repeats = new Map<string, { name: string; kind: ActivityKind; count: number }>()
    for (const command of s.commands ?? []) {
      for (const run of scriptRuns(command)) {
        if (run.product) products[run.product] = (products[run.product] ?? 0) + 1
        if (run.kind === 'other') continue
        const which = run.file ? fileName(run.file) : (run.processId ?? run.componentId)
        if (which && (run.kind === 'test' || run.kind === 'push' || run.kind === 'deploy')) {
          const key = `${run.kind}|${which}`
          const seen = repeats.get(key) ?? { name: which.length > 12 && !run.file ? `${which.slice(0, 8)}…` : which, kind: run.kind, count: 0 }
          repeats.set(key, { ...seen, count: seen.count + 1 })
        }
        runs[run.kind] = (runs[run.kind] ?? 0) + 1
        if (run.file) files.add(fileName(run.file))
        else if (run.processId ?? run.componentId) ids.add((run.processId ?? run.componentId)!)
      }
    }
    if (Object.keys(runs).length === 0 && Object.keys(products).length === 0) continue
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
      ...(Object.keys(products).length > 0 ? { products } : {}),
      ...(typeof s.prompts === 'number' ? { prompts: s.prompts } : {}),
      ...(typeof s.peakContext === 'number' ? { peakContext: s.peakContext } : {}),
      ...(typeof s.compactions === 'number' ? { compactions: s.compactions } : {}),
      ...(typeof s.subagentTokens === 'number' ? { subagentTokens: s.subagentTokens } : {}),
      ...(s.file ? { file: s.file } : {}),
      modelTokens: Object.fromEntries(models.map(([id, m]) => [id, (m.input ?? 0) + (m.output ?? 0) + (m.cacheWrite ?? 0)])),
      repeats: [...repeats.values()].filter(r => r.count >= 3).sort((a, b) => b.count - a.count),
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
 * "Oct 10, 09:00": a time as month, day and 24-hour clock, put together from
 * its parts. toLocaleString joins date and time with whatever the runtime's
 * locale data says (", " in some ICU versions, " at " in others), so the same
 * session would read differently from one machine to the next.
 */
export const shortWhen = (at: number, timeZone?: string): string => {
  const parts = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).formatToParts(new Date(at))
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${part('month')} ${part('day')}, ${part('hour')}:${part('minute')}`
}

/**
 * A past session in two parts. The head says which session: when it started,
 * how long it ran, its cost and what it was about. The detail says what it did.
 */
export const pastParts = (s: PastSession, view: PastView = {}): { head: string; detail: string } => {
  const at = Date.parse(s.startedAt ?? '')
  const end = Date.parse(s.endedAt ?? '')
  const when = Number.isNaN(at) ? 'unknown date' : shortWhen(at, view.timeZone)
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
  const detail = [runWords(s.runs) || undefined, productCountWords(s.products) || undefined, names || undefined, `${formatTokens(s.tokens)} tokens`, view.withProject ? folderOf(s.project) : undefined]
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
  lines.push('/bc-dashboard resume copies the command that reopens one of them in a new terminal.')
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

/** A new-session tip, and the Companion plugin it's about; tips without one apply everywhere. */
type Tip = { text: string; plugin?: string }

const TIP_LIST: readonly Tip[] = [
  { text: 'Tip: Why? on a failed test reads its log; Ask Claude to fix drafts the request', plugin: 'bc-integration' },
  { text: "Tip: Run again repeats a failed test without a turn of Claude's", plugin: 'bc-integration' },
  { text: 'Tip: ask Claude "what\'s left to fix?" and it answers from the dashboard' },
  { text: 'Tip: /bc-dashboard report save writes the session up for a PR or a hand-off' },
  { text: 'Tip: /bc-dashboard config budget sets a spend budget, with figures from your past sessions' },
  { text: 'Tip: Scan under Past Companion sessions shows what earlier sessions cost' },
  { text: 'Tip: /bc-dashboard watch <component> flags changes someone else makes in Boomi', plugin: 'bc-integration' },
  { text: "Tip: BOOMI_COMPANION_LOG_ACTIVITY=1 in Companion's .env adds its activity log as a second source", plugin: 'bc-integration' },
  { text: 'Tip: the Day, Night and Terminal buttons in the pane change its colors' },
]

/** Tips about the other Companion plugins, shown only where the plugin is installed. */
const PRODUCT_TIPS: readonly Tip[] = [
  { text: 'Tip: components a Marketplace recipe installs join Components this session', plugin: 'bc-marketplace' },
  { text: "Tip: after Claude checks a universe's quarantine, the Data Hub section shows what's waiting", plugin: 'bc-datahub' },
  { text: "Tip: a BDI flow run that fails shows under Needs attention with BDI's own error", plugin: 'bc-bdi' },
  { text: "Tip: Agentstudio agents shows each agent's stages and its test conversations", plugin: 'bc-agentstudio' },
  { text: 'Tip: Custom connectors shows each release: linted, validated, uploaded, made active', plugin: 'bc-connectordev' },
]

/** What the banner turns through at the start of a session, before Companion has done anything. */
export const TIPS: readonly string[] = TIP_LIST.map(tip => tip.text)

/**
 * The tips for the Companion plugins installed: first a line naming them, then
 * the tips that apply everywhere and those about an installed plugin. With the
 * plugins unknown (null), the usual tips.
 */
export const tipsFor = (plugins: readonly CompanionPlugin[] | null | undefined): readonly string[] => {
  if (!plugins) return TIPS
  const has = (tip: Tip) => !tip.plugin || plugins.some(p => p.name === tip.plugin)
  const here = installedTip(plugins)
  return [...(here ? [here] : []), ...[...TIP_LIST, ...PRODUCT_TIPS].filter(has).map(tip => tip.text)]
}

/**
 * The line the banner shows at turn `n` of its rotation: the last session's
 * recap first, when there is one, then each tip in turn.
 */
export const welcomeLine = (n: number, recap: SessionRecap | undefined, now: number, tips: readonly string[] = TIPS): { level?: Level; text: string } => {
  const lines: { level?: Level; text: string }[] = [...(recap ? [recapLine(recap, now)] : []), ...tips.map(text => ({ text }))]
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

// --- Reopening a past session ------------------------------------------------------

/** A path as one shell word: as it is when it's plain, else in single quotes. */
const shellWord = (text: string): string => (/^[A-Za-z0-9_./~@%+=:,-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`)

/** What reopens a past session in a new terminal: its folder, then Claude Code resuming it by ID. */
export const resumeCommand = (s: PastSession): string => `${s.project ? `cd ${shellWord(s.project)} && ` : ''}claude --resume ${shellWord(s.id)}`

/** The past sessions there are to reopen, newest first: every one but this one. */
export const resumable = (sessions: readonly PastSession[], currentId?: string): PastSession[] => sessions.filter(s => s.id !== currentId)

/** A past session as an option of the picker: its number, when and what it was about. */
export const resumeLabel = (s: PastSession, n: number, view: PastView = {}): string => {
  const label = `${n}. ${pastParts(s, view).head}`
  return label.length > 48 ? `${label.slice(0, 47)}…` : label
}

// --- Companion's other plugins -------------------------------------------------------

/**
 * Other plugins' steps that failed or warned and haven't been done since:
 * the latest of each action (the same script, verb and subject) is what counts,
 * so a later success clears an earlier failure, as it does for components.
 */
export const productIssues = (activity: readonly Activity[]): Activity[] => {
  const latest = new Map<string, Activity>()
  for (const a of activity) {
    if (!a.product || a.outcome === 'running') continue
    latest.set(`${a.product}|${a.script}|${a.verb}|${a.subject}`, a)
  }
  return [...latest.values()].filter(a => a.outcome === 'failed' || a.outcome === 'blocked' || (isProductWarning(a) && !isUnderway(a)))
}

/** Each product's share of the session: bc-integration's steps, then each other plugin's, by what they took. */
export const productSpends = (
  activity: readonly Activity[],
  all: Map<number, Spend>,
): ({ name: string } & Spend)[] => {
  const groups = new Map<string, number[]>()
  for (const a of activity) {
    const name = a.product ? PRODUCT_NAMES[a.product] : 'Integration'
    groups.set(name, [...(groups.get(name) ?? []), a.id])
  }
  return [...groups].map(([name, ids]) => ({ name, ...spendOf(ids, all) }))
}

/** The products' shares in one line, when the session used more than one: "By product: Integration $1.20 · Data Hub $0.40". */
export const productSpendLine = (activity: readonly Activity[], all: Map<number, Spend>): string | undefined => {
  const shares = productSpends(activity, all)
  if (shares.length < 2) return undefined
  return `By product: ${shares.map(s => `${s.name} ${formatSpend(s) ?? 'no spend yet'}`).join(' · ')}`
}

/** A past session's steps with other plugins, in words: "2 Data Hub steps · 1 BDI step". */
export const productCountWords = (products: PastSession['products']): string =>
  Object.entries(products ?? {})
    .filter(([, n]) => n)
    .map(([product, n]) => `${n} ${PRODUCT_NAMES[product as Product]} step${n === 1 ? '' : 's'}`)
    .join(' · ')

// --- Usage limits ------------------------------------------------------------------

/** A window of the seat's usage limits, as Claude Code reports it: `five_hour`, `seven_day`, or an admin's `spend_limit`. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** Each window's name, and how long it runs, for a pace. A spend limit's period isn't reported. */
const LIMIT_WINDOWS: Record<string, { name: string; ms?: number }> = {
  five_hour: { name: '5-hour', ms: 5 * 3_600_000 },
  seven_day: { name: 'weekly', ms: 7 * 86_400_000 },
  spend_limit: { name: 'spend limit' },
}

/** A stretch of time in words, to the hour past a day: 45m, 3h 12m, 2d 4h. */
export const span = (ms: number): string => {
  if (ms < 86_400_000) return duration(ms)
  const hours = Math.floor(ms / 3_600_000)
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export type LimitView = {
  kind: string
  name: string
  percent: number
  level: Level
  /** When it resets, from now: "3d 4h". */
  resetsIn?: string
  /** Where the pace so far leads: "used up in 1d 6h" before it resets, or "on pace for 64% by reset". */
  pace?: string
  /** True when the pace runs out before the window resets. */
  isRunningOut?: boolean
}

/**
 * The seat's usage limits as the dashboard shows them: the busiest window
 * first. Warning from 80% or when the pace so far would use it up before it
 * resets; critical once it's used up. A pace needs a tenth of the window gone,
 * so the first minutes of a window don't project wildly.
 */
export const limitViews = (limits: readonly Limit[] | undefined, now: number): LimitView[] =>
  (limits ?? [])
    .map(limit => {
      const window = LIMIT_WINDOWS[limit.kind] ?? { name: limit.kind.replace(/_/g, ' ') }
      const percent = limit.percentUsed
      const reset = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
      const left = Number.isNaN(reset) ? undefined : Math.max(0, reset - now)
      const view: LimitView = { kind: limit.kind, name: window.name, percent, level: percent >= 100 ? 'critical' : percent >= 80 ? 'warning' : 'healthy' }
      if (left !== undefined) view.resetsIn = span(left)
      if (window.ms && left !== undefined && percent > 0 && percent < 100) {
        const elapsed = window.ms - left
        if (elapsed >= window.ms / 10) {
          const outIn = ((100 - percent) * elapsed) / percent
          if (outIn < left) {
            view.pace = `used up in ${span(outIn)}`
            view.isRunningOut = true
            if (view.level === 'healthy') view.level = 'warning'
          } else view.pace = `on pace for ${Math.round((percent * window.ms) / elapsed)}% by reset`
        }
      }
      return view
    })
    .sort((a, b) => b.percent - a.percent)

/** One window in a few words: "weekly 42%, resets in 3d 4h, used up in 1d 6h at this pace". */
export const limitText = (v: LimitView): string =>
  [`${v.name} ${Math.round(v.percent)}%`, v.resetsIn ? `resets in ${v.resetsIn}` : undefined, v.pace ? `${v.isRunningOut ? 'at this pace, ' : ''}${v.pace}` : undefined]
    .filter(Boolean)
    .join(', ')

/** All the windows on one line, for text and the report; undefined off a subscription. */
export const limitsLine = (limits: readonly Limit[] | undefined, now: number): string | undefined => {
  const views = limitViews(limits, now)
  return views.length === 0 ? undefined : `Usage limits: ${views.map(v => `${STATUS[v.level].icon} ${limitText(v)}`).join(' · ')}`
}

/** The windows in a few characters, for the banner: "week 42% · 5h 12%". */
export const limitsShort = (limits: readonly Limit[] | undefined, now: number): string | undefined => {
  const short: Record<string, string> = { five_hour: '5h', seven_day: 'week', spend_limit: 'spend' }
  const views = limitViews(limits, now)
  return views.length === 0 ? undefined : views.map(v => `${short[v.kind] ?? v.name} ${Math.round(v.percent)}%`).join(' · ')
}

// --- A personal Companion budget ---------------------------------------------------

/** Where Companion stands against a budget the person set: its level and the words for it. */
export type BudgetView = { level: Level; percent: number; text: string }

const budgetLevel = (percent: number): Level => (percent >= 100 ? 'critical' : percent >= 80 ? 'warning' : 'healthy')

/** The period a relative Companion budget runs over. */
export type SharePeriod = 'day' | 'week' | 'month'

/** The day a moment falls in, where the dashboard runs: "2026-10-13". */
export const dayOf = (at: number): string => {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** How many days the month of a moment has. */
const daysInMonth = (at: number): number => {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

/**
 * Companion's relative budget: how much of the weekly limit Companion
 * sessions on this machine moved in the period (today, the last 7 days, or
 * this month), against the share the person gave it, scaled to the period:
 * a day is a seventh of a week, a month its days' sevenths. `days` holds
 * Companion's movement of the weekly limit by day. Undefined without a share.
 */
export const shareView = (
  days: Readonly<Record<string, number>> | undefined,
  sharePercent: number,
  period: SharePeriod,
  now: number,
): BudgetView | undefined => {
  if (!sharePercent || sharePercent <= 0 || days === undefined) return undefined
  const today = dayOf(now)
  const month = monthOf(now)
  const week = new Set(Array.from({ length: 7 }, (_, i) => dayOf(now - i * 86_400_000)))
  const inPeriod = (day: string) => (period === 'day' ? day === today : period === 'week' ? week.has(day) : day.startsWith(month))
  const used = Object.entries(days).reduce((sum, [day, n]) => sum + (inPeriod(day) ? n : 0), 0)
  const allowance = sharePercent * (period === 'day' ? 1 / 7 : period === 'week' ? 1 : daysInMonth(now) / 7)
  const percent = (used / allowance) * 100
  const label = period === 'day' ? 'today' : period === 'week' ? 'the last 7 days' : 'this month'
  return {
    level: budgetLevel(percent),
    percent,
    text: `Companion ${label}: ${used.toFixed(1)}% of your weekly limit, ${Math.round(percent)}% of its ${allowance.toFixed(1)}% (${sharePercent}% share per ${period === 'day' ? 'week, a seventh a day' : period})`,
  }
}

/** Keeps the last 40 days of Companion's daily movement of the weekly limit, enough for any month. */
export const pruneDays = (days: Readonly<Record<string, number>>, now: number): Record<string, number> => {
  const oldest = dayOf(now - 40 * 86_400_000)
  return Object.fromEntries(Object.entries(days).filter(([day]) => day >= oldest))
}

/** The calendar month a moment falls in, where the dashboard runs: "2026-10". */
export const monthOf = (at: number): string => {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * What Companion cost this calendar month: earlier Companion sessions on this
 * machine, from the last scan, and this session as it runs. Claude Code's own
 * cost figures; on a seat, what the same use would cost on the API.
 */
export const monthSpend = (sessions: readonly PastSession[] | undefined, now: number, currentId: string | undefined, liveUsd: number | undefined): number => {
  const month = monthOf(now)
  const earlier = (sessions ?? [])
    .filter(s => s.id !== currentId && s.startedAt && monthOf(Date.parse(s.startedAt)) === month)
    .reduce((sum, s) => sum + (s.costUsd ?? 0), 0)
  return earlier + (liveUsd ?? 0)
}

/** Companion's month against the monthly amount the person set. Undefined without one. */
export const monthView = (spent: number, monthlyUsd: number): BudgetView | undefined => {
  if (!monthlyUsd || monthlyUsd <= 0) return undefined
  const percent = (spent / monthlyUsd) * 100
  return { level: budgetLevel(percent), percent, text: `Companion this month: ${formatCost(spent)} of ${formatCost(monthlyUsd)}` }
}

/** A budget the person set, as the BUDGET gauge lists it: what it is and how full. */
/** One budget's line. Unmeasured: set, but there's nothing to measure it by, so it shows no status or percent. */
export type BudgetLine = { label: string; level: Level; percent: number; detail: string; isUnmeasured?: true }

/**
 * Every budget the person set, for the BUDGET gauge: the session's spend, the
 * month's Companion amount and Companion's share of the limit, the fullest
 * first. Empty when none is set.
 */
export const budgetLines = (
  usage: Usage,
  settings: { budgetUsd: number; companionShare: number; companionSharePeriod: SharePeriod; companionMonthlyUsd: number; seatBudgetUsd?: number },
): BudgetLine[] => {
  const lines: BudgetLine[] = []
  // The monthly budget the account reports, in dollars, when /usage has it; else the one the person's admin assigned, from the spend limit Claude Code reports.
  const extra = usage.extraUsage
  const seat = settings.seatBudgetUsd ?? 0
  if (extra) {
    const level: Level = extra.percent >= 100 ? 'critical' : extra.percent >= 80 ? 'warning' : 'healthy'
    lines.push({ label: 'Claude budget', level, percent: extra.percent, detail: `${formatCost(extra.usedUsd)} of ${formatCost(extra.limitUsd)} this month` })
    const w = paceWords(extra, usage.pace, usage.now ?? Date.now())
    if (w.pace) lines.push({ label: 'Claude pace', level: w.isRunningOut ? 'warning' : 'healthy', percent: 0, detail: w.pace, isUnmeasured: true })
    if (w.today) lines.push({ label: 'Claude spend', level: 'healthy', percent: 0, detail: w.today, isUnmeasured: true })
  } else if (seat > 0) {
    const spend = usage.limits?.find(l => l.kind === 'spend_limit')
    if (spend) {
      const level: Level = spend.percentUsed >= 100 ? 'critical' : spend.percentUsed >= 80 ? 'warning' : 'healthy'
      lines.push({ label: 'Claude budget', level, percent: spend.percentUsed, detail: `${formatCost((spend.percentUsed / 100) * seat)} of ${formatCost(seat)}` })
    } else {
      lines.push({ label: 'Claude budget', level: 'healthy', percent: 0, detail: `${formatCost(seat)} set; this login doesn't report how much of it is used`, isUnmeasured: true })
    }
  }
  if (usage.companionUse) lines.push({ label: 'Companion', level: 'healthy', percent: 0, detail: `${usage.companionUse} (Claude Code's estimate, this machine)`, isUnmeasured: true })
  if (usage.isUsageUnreadable) lines.push({ label: 'Companion', level: 'healthy', percent: 0, detail: "couldn't read Claude Code's /usage (its wording changed); update the dashboard", isUnmeasured: true })
  if (usage.usageHabit) lines.push({ label: 'this week', level: 'healthy', percent: 0, detail: usage.usageHabit, isUnmeasured: true })
  const session = budgetOf(usage.usd ?? 0, settings.budgetUsd)
  if (session) lines.push({ label: 'session', level: session.level, percent: session.percent, detail: `${formatCost(usage.usd ?? 0)} of ${formatCost(settings.budgetUsd)}` })
  const month = usage.companion?.month
  if (month) lines.push({ label: 'month', level: month.level, percent: month.percent, detail: month.text.replace(/^Companion this month: /, '') })
  const share = usage.companion?.week
  if (share) {
    const period = settings.companionSharePeriod === 'day' ? 'today' : settings.companionSharePeriod === 'week' ? '7 days' : 'month'
    lines.push({ label: `share, ${period}`, level: share.level, percent: share.percent, detail: `${Math.round(share.percent)}% of ${settings.companionShare}%` })
  } else if (settings.companionShare > 0) {
    lines.push(
      usage.limits?.length
        ? { label: 'share', level: 'healthy', percent: 0, detail: 'no Companion work yet' }
        : { label: 'share', level: 'healthy', percent: 0, detail: 'this login reports no weekly limit', isUnmeasured: true },
    )
  }
  return lines.sort((a, b) => b.percent - a.percent)
}

/** An ID in a line of text: a long one shortened as elsewhere, a short one as it is. */
const shortId = (id: string): string => (id.length > 14 ? `${id.slice(0, 8)}…` : id)

/** Data Hub's quarantine, a line per universe Claude has looked at, for the pane, the text and the report. */
export const quarantineLines = (dashboard: Dashboard, now: number): { level: Level; text: string }[] =>
  Object.entries(dashboard.quarantine ?? {}).map(([universe, q]) => ({
    level: q.count > 0 ? 'warning' : 'healthy',
    text: `Universe ${shortId(universe)}: ${q.count === 0 ? 'nothing in quarantine' : `${q.count} in quarantine (${q.causes})`}, checked ${ago(q.checkedAt, now)}`,
  }))
