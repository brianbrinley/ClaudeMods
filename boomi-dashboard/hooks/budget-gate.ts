// Budget enforcement: which shell commands change something in Boomi through
// Companion, and what to tell Claude and the person once a budget is spent.
// Plain functions: nothing here touches the engine.

import { scriptRuns, shellScripts } from './activity'
import type { BudgetLine, ScriptRun } from './activity'

/** What a spent budget does: warn only (as before), ask before each change, or refuse them. */
export type Enforce = 'warn' | 'confirm' | 'block'

/**
 * bc-integration scripts outside the dashboard's own kinds that change
 * something, and with which subcommand when it matters. Keyed by the script's
 * name as a step has it (without `boomi-` and `.sh`). `isAccountWide` marks a
 * change to the account's components rather than the .env's environment, which
 * the production check leaves alone, as it does a push.
 */
const CHANGING: { script: string; verbs?: RegExp; what: string; isAccountWide?: true }[] = [
  { script: 'folder-create', what: 'create a folder in Boomi', isAccountWide: true },
  { script: 'folder-rename', what: 'rename a folder in Boomi', isAccountWide: true },
  { script: 'branch', verbs: /^(create|delete)$/, what: 'create or delete a branch', isAccountWide: true },
  { script: 'branch', verbs: /^merge(-execute|-revert|-delete)?$/, what: 'merge branches, or change a merge request', isAccountWide: true },
  { script: 'extensions', verbs: /^set$/, what: "set the environment's extensions" },
  { script: 'wss-test', what: 'call a deployed web service (it runs the process)' },
  { script: 'event-streams-setup', verbs: /^create[-\w]*$/, what: 'create an Event Streams topic, subscription or token' },
  { script: 'event-streams-setup', verbs: /^provision-connection$/, what: 'create an Event Streams connection component' },
  { script: 'event-streams-setup', verbs: /^rest-produce$/, what: 'send a message to an Event Streams topic' },
]

/**
 * bc-integration's scripts that only read, with the subcommands that do where
 * the script also writes. Read from bc-integration 1.0.103. A script or
 * subcommand in neither list counts as a change, so a new release can't slip
 * past the gates before it's listed here.
 */
const READS: { script: string; verbs?: RegExp }[] = [
  { script: 'branch', verbs: /^(list|default|merge-status)?$/ },
  { script: 'extensions', verbs: /^(get)?$/ },
  { script: 'event-streams-setup', verbs: /^(query-tokens|list-topics|query-topic)?$/ },
  { script: 'component-diff' },
  { script: 'component-search' },
  { script: 'env-check' },
  { script: 'execution-query' },
  { script: 'folder-list' },
  { script: 'shared-server-info' },
  { script: 'version-history' },
]

const matches = (entry: { script: string; verbs?: RegExp }, script: string | undefined, verb: string | undefined) =>
  entry.script === script && (!entry.verbs || entry.verbs.test(verb ?? ''))

/** What one of bc-integration's other scripts changes with this subcommand, in words; undefined when it only reads. One the dashboard doesn't know counts as a change. */
export const integrationChange = (script: string | undefined, verb: string | undefined): string | undefined => {
  if (!script) return undefined
  const known = CHANGING.find(c => matches(c, script, verb))
  if (known) return known.what
  if (READS.some(r => matches(r, script, verb))) return undefined
  return `run ${script}${verb ? ` ${verb}` : ''}, a Companion step the dashboard doesn't know`
}

/** Whether a change from one of bc-integration's other scripts touches the account's components, not the .env's environment. */
export const isAccountWide = (script: string | undefined, verb: string | undefined): boolean =>
  CHANGING.some(c => c.isAccountWide && matches(c, script, verb))

/**
 * The other plugins' steps that change nothing in Boomi, though the dashboard
 * shows them: checks and scaffolding on this machine, downloads and a pull
 * into a working file. Read from the plugins' own scripts (bc-connectordev
 * 0.0.50, bc-marketplace 0.2.10, bc-datahub 0.2.12, bc-bdi 0.2.5). Keyed by
 * the script, or the script and its verb.
 */
export const LOCAL_ONLY: ReadonlySet<string> = new Set([
  'connectordev-descriptor-lint',
  'connectordev-doctor',
  'connectordev-init',
  'connectordev-version validate',
  'boomi-marketplace-supporting-materials',
  'datahub-model pull',
  'datahub-source pull',
])

/** What the gate lets through: the local steps, and a cancel, which stops a run, so a spent budget never holds it back. */
const NOT_A_CHANGE = new Set([...LOCAL_ONLY, 'bdi-flow cancel'])

const KIND_WORDS: Record<string, string> = {
  create: 'create a component in Boomi',
  push: 'save a component to Boomi',
  deploy: 'deploy',
  undeploy: 'undeploy',
  test: 'run a test execution',
}

/**
 * The Companion changes a shell command would make, in words: creates,
 * pushes, deploys, undeploys and test executions; the other plugins'
 * subcommands that change something (the ones the dashboard counts as steps);
 * and bc-integration's other changing scripts. Reads (list, get, query,
 * status, logs, pull) are never in it.
 */
export const companionChanges = (command: string): string[] => scriptRuns(command).flatMap(run => runChange(run) ?? [])

/** The change one Companion step makes, in words; undefined when it only reads. */
export const runChange = (run: ScriptRun): string | undefined => {
  const what = run.file ?? run.processId ?? run.componentId ?? run.deploymentId ?? run.target
  if (run.kind in KIND_WORDS) return `${KIND_WORDS[run.kind]}${what ? ` (${what})` : ''}`
  if (run.kind !== 'other') return undefined
  if (run.product) {
    if (NOT_A_CHANGE.has(run.script ?? '') || NOT_A_CHANGE.has(`${run.script} ${run.verb}`)) return undefined
    return `${run.product} ${run.verb ?? 'change'}${run.target ? ` (${run.target})` : ''}`
  }
  return integrationChange(run.script, run.verb)
}

/** The Platform API: its hosts, its path, or Companion's own variables, such as `$BOOMI_API_URL`. */
const PLATFORM = /\b(?:api|platform)\.boomi\.com\b|\/api\/rest\/v1\b|\$\{?BOOMI_\w+/

/**
 * Calls straight to the Platform API that would change something: curl,
 * wget or HTTPie with PUT, PATCH, DELETE, or a POST that isn't a query (the
 * API's reads are POSTs to …/query and …/queryMore). A plain GET is a read.
 * A variable set earlier in the command counts as what it holds.
 */
export const platformWrites = (command: string): string[] => {
  const out: string[] = []
  const vars = new Map<string, string>()
  for (const raw of command.split(/(?:&&|\|\||;|\n)/)) {
    const part = raw.replace(/\$(?:\{(\w+)\}|(\w+))/g, (whole, braced, bare) => vars.get(braced ?? bare) ?? whole)
    const set = part.match(/^\s*(?:export\s+)?([A-Za-z_]\w*)=(?:"([^"]*)"|'([^']*)'|(\S*))\s*$/)
    if (set) vars.set(set[1]!, set[2] ?? set[3] ?? set[4] ?? '')
    if (!PLATFORM.test(part) || !/\b(curl|wget|http|https|xh)\b/.test(part)) continue
    const url = part.match(/https?:\/\/[^\s'"]*boomi\.com[^\s'"]*/)?.[0] ?? ''
    // -X in any form (-X POST, -XPOST, -sX POST, --request=POST) and a body in any form (-d'{}', -d@file, --data-raw, -F, -T, --json).
    // A method flag this can't read counts as a write.
    const named = part.match(/(?:^|\s)(?:-[a-zA-Z]*X|--request|--method)\s*=?\s*['"]?([A-Za-z]+)/)?.[1]?.toUpperCase()
    const httpie = part.match(/\b(?:http|https|xh)\s+(GET|POST|PUT|PATCH|DELETE)\b/i)?.[1]?.toUpperCase()
    const hasMethodFlag = /(?:^|\s)(?:-[a-zA-Z]*X|--request|--method)/.test(part)
    const hasBody = /\s(?:-d|-F|-T|--data\S*|--form\S*|--json\S*|--upload-file\S*|--post-data\S*|--post-file\S*|--body-data\S*)/.test(` ${part}`)
    const method = named ?? httpie ?? (hasMethodFlag ? 'UNKNOWN' : hasBody ? 'POST' : 'GET')
    if ((method === 'GET' || method === 'HEAD' || method === 'OPTIONS') && !hasBody) continue
    if (method === 'POST' && /\/(?:query|queryMore)(?:[?#'"\s]|$)/.test(url || part)) continue
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] || part.match(/\/api\/rest\/v1\/[^\s'"?]*/)?.[0] || 'the Platform API'
    out.push(`${method} ${path}`)
  }
  return out
}

/** Companion's own scripts, by name. */
const COMPANION_SCRIPT = /(?:^|\/)(?:(?:boomi|datahub|bdi|agentstudio|connectordev)-[\w-]+\.(?:sh|py)|event-streams-setup\.sh)$/

/** The scripts a command runs that aren't Companion's own, each with the folder it runs from: what the gates can't see into. */
export const wrapperRuns = (command: string): { path: string; dir: string }[] => shellScripts(command).filter(run => !COMPANION_SCRIPT.test(run.path))

/**
 * Local shell scripts a command runs that aren't Companion's own
 * (`bash run.sh`, `./deploy-all.sh`, `time ./x.sh`, `source x.sh`): what the
 * gate reads, in case one wraps a Companion change.
 */
export const wrapperScripts = (command: string): string[] => [...new Set(wrapperRuns(command).map(run => run.path))]

/** A budget as a sentence: "the session budget", "Companion's monthly amount". */
const budgetName = (line: BudgetLine) =>
  line.label === 'session' ? 'the session budget' : line.label === 'month' ? "Companion's monthly amount" : line.label === 'Claude budget' ? 'your monthly Claude budget' : `Companion's share of your usage limit (${line.label.replace(/^share,? ?/, '') || 'week'})`

/** The budgets spent past the grace, fullest first. */
export const spentBudgets = (lines: readonly BudgetLine[], gracePercent: number): BudgetLine[] =>
  lines.filter(l => l.percent >= 100 + Math.max(0, gracePercent)).sort((a, b) => b.percent - a.percent)

/** The spent budgets in words: "the session budget ($5.20 of $5.00, 104%)". */
export const spentText = (spent: readonly BudgetLine[]): string =>
  spent.map(l => `${budgetName(l)} (${l.detail}, ${Math.round(l.percent)}%)`).join(' and ')

/** What a refused step says under Needs attention: short, the budget first. */
export const blockedDetail = (spent: readonly BudgetLine[]): string => `blocked by budget: ${spentText(spent.slice(0, 1))}`

/**
 * The refusal Claude reads: which budget is spent and by how much, what was
 * stopped, to stop and report, and not to go around it.
 */
export const denyMessage = (spent: readonly BudgetLine[], changes: readonly string[], mode: Enforce, isChosen = false): string =>
  [
    `boomi-dashboard: ${isChosen ? 'the user chose to stop this' : 'refused'}: Boomi Companion's budget is spent: ${spentText(spent)}.`,
    `Companion changes are paused${mode === 'block' ? '' : ' until the user allows them'}. Not run: ${changes.join('; ')}.`,
    'Stop the Boomi work now and tell the user which budget is spent and what you were about to do. Do not work around this: no curl or other calls to api.boomi.com, no running the script another way, no wrapper script. The user can raise the budget with /bc-dashboard config budgets, or change budgetEnforce.',
  ].join('\n')

/** The note Claude gets with the person's prompt once enforcement starts or changes. */
export const enforcementNote = (spent: readonly BudgetLine[], mode: Enforce, isAllowed: boolean): string =>
  spent.length === 0
    ? 'boomi-dashboard: the Boomi Companion budget is no longer spent; Companion changes are allowed again.'
    : isAllowed
      ? `boomi-dashboard: Boomi Companion's budget is spent (${spentText(spent)}), and the user allowed Companion changes for the rest of this session.`
      : `boomi-dashboard: Boomi Companion's budget is spent (${spentText(spent)}). Companion changes (creates, pushes, deploys, tests, and changing calls to the Platform API) are ${mode === 'block' ? 'refused' : 'paused: each one asks the user first'}. Plan without them, and tell the user before you'd need one. Reads are fine.`
