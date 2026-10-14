// Budget enforcement: which shell commands change something in Boomi through
// Companion, and what to tell Claude and the person once a budget is spent.
// Plain functions: nothing here touches the engine.

import { scriptRuns } from './activity'
import type { BudgetLine } from './activity'

/** What a spent budget does: warn only (as before), ask before each change, or refuse them. */
export type Enforce = 'warn' | 'confirm' | 'block'

/** bc-integration scripts outside the dashboard's own kinds that change something, and when. */
const CHANGING: { script: RegExp; when?: RegExp; what: string }[] = [
  { script: /boomi-folder-create\.sh/, what: 'create a folder in Boomi' },
  { script: /boomi-branch\.sh/, when: /boomi-branch\.sh['"]?\s+(create|delete)\b/, what: 'create or delete a branch' },
  { script: /boomi-extensions\.sh/, when: /boomi-extensions\.sh['"]?\s+set\b/, what: "set the environment's extensions" },
  { script: /boomi-wss-test\.sh/, what: 'call a deployed web service (it runs the process)' },
  { script: /event-streams-setup\.sh/, when: /event-streams-setup\.sh['"]?\s+create[-\w]*/, what: 'create an Event Streams topic, subscription or token' },
]

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
export const companionChanges = (command: string): string[] => {
  const out: string[] = []
  for (const run of scriptRuns(command)) {
    const what = run.file ?? run.processId ?? run.componentId ?? run.deploymentId ?? run.target
    if (run.kind in KIND_WORDS) out.push(`${KIND_WORDS[run.kind]}${what ? ` (${what})` : ''}`)
    else if (run.kind === 'other' && run.product) out.push(`${run.product} ${run.verb ?? 'change'}${run.target ? ` (${run.target})` : ''}`)
    else if (run.kind === 'other' && run.script) {
      const changing = CHANGING.find(c => c.script.test(`boomi-${run.script}.sh`) || c.script.test(`${run.script}.sh`))
      if (changing && (!changing.when || changing.when.test(command))) out.push(changing.what)
    }
  }
  return out
}

/** The Platform API's hosts. */
const PLATFORM = /\b(?:api|platform)\.boomi\.com\b/

/**
 * Calls straight to the Platform API that would change something: curl,
 * wget or HTTPie with PUT, PATCH, DELETE, or a POST that isn't a query (the
 * API's reads are POSTs to …/query and …/queryMore). A plain GET is a read.
 */
export const platformWrites = (command: string): string[] => {
  const out: string[] = []
  for (const part of command.split(/(?:&&|\|\||;|\n)/)) {
    if (!PLATFORM.test(part) || !/\b(curl|wget|http|https|xh)\b/.test(part)) continue
    const url = part.match(/https?:\/\/[^\s'"]*boomi\.com[^\s'"]*/)?.[0] ?? ''
    const named = part.match(/(?:-X|--request|--method)[=\s]+['"]?([A-Za-z]+)/)?.[1]?.toUpperCase()
    const httpie = part.match(/\b(?:http|https|xh)\s+(GET|POST|PUT|PATCH|DELETE)\b/i)?.[1]?.toUpperCase()
    const hasBody = /\s(?:-d|--data(?:-[a-z]+)?|-F|--form|--json|-T|--upload-file|--post-data|--post-file|--body-data)[=\s]/.test(` ${part}`)
    const method = named ?? httpie ?? (hasBody ? 'POST' : 'GET')
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') continue
    if (method === 'POST' && /\/(?:query|queryMore)(?:[?#'"\s]|$)/.test(url || part)) continue
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] || 'the Platform API'
    out.push(`${method} ${path}`)
  }
  return out
}

/**
 * Local shell scripts a command runs that aren't Companion's own
 * (`bash run.sh`, `./deploy-all.sh`, `source x.sh`): what the gate reads, in
 * case one wraps a Companion change.
 */
export const wrapperScripts = (command: string): string[] => {
  const out = new Set<string>()
  const pattern = /(?:^|[;&|(]\s*|\b(?:bash|sh|zsh|source)\s+(?:-[a-z]+\s+)*|\.\s+)((?:\.{0,2}\/)?[\w./-]+\.(?:sh|bash))\b/g
  for (const m of command.matchAll(pattern)) {
    const path = m[1]!
    if (/(?:^|\/)(?:boomi|datahub|bdi|agentstudio|connectordev)-[\w-]+\.sh$|event-streams-setup\.sh$/.test(path)) continue
    out.add(path)
  }
  return [...out]
}

/** A budget as a sentence: "the session budget", "Companion's monthly amount". */
const budgetName = (line: BudgetLine) =>
  line.label === 'session' ? 'the session budget' : line.label === 'month' ? "Companion's monthly amount" : `Companion's share of your usage limit (${line.label.replace(/^share,? ?/, '') || 'week'})`

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
    'Stop the Boomi work now and tell the user which budget is spent and what you were about to do. Do not work around this: no curl or other calls to api.boomi.com, no running the script another way, no wrapper script. The user can raise the budget with /bc-dashboard config budget, or change budgetEnforce.',
  ].join('\n')

/** The note Claude gets with the person's prompt once enforcement starts or changes. */
export const enforcementNote = (spent: readonly BudgetLine[], mode: Enforce, isAllowed: boolean): string =>
  spent.length === 0
    ? 'boomi-dashboard: the Boomi Companion budget is no longer spent; Companion changes are allowed again.'
    : isAllowed
      ? `boomi-dashboard: Boomi Companion's budget is spent (${spentText(spent)}), and the user allowed Companion changes for the rest of this session.`
      : `boomi-dashboard: Boomi Companion's budget is spent (${spentText(spent)}). Companion changes (creates, pushes, deploys, tests, and changing calls to the Platform API) are ${mode === 'block' ? 'refused' : 'paused: each one asks the user first'}. Plan without them, and tell the user before you'd need one. Reads are fine.`
