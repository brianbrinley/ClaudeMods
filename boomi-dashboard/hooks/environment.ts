// Production read-only: which Companion steps change the .env's environment,
// and whether that environment's classification lets them run. Plain
// functions: nothing here touches the engine.

import { scriptRuns } from './activity'
import { wrapperScripts } from './budget-gate'

/** What the production check does: off reads nothing, check reports, enforce also refuses. */
export type EnvCheck = 'off' | 'check' | 'enforce'

/** The environment the .env points at, as Boomi lists it. */
export type Environment = { id: string; name: string; classification?: string }

/** Companion steps that change the environment in .env: a deploy, an undeploy, a test run. */
const CHANGES_ENVIRONMENT: Record<string, string> = {
  deploy: 'deploy',
  undeploy: 'undeploy',
  test: 'run a test execution',
}

/** Classifications a Companion change may run in. Anything else, production included, is refused. */
const ALLOWED = new Set(['TEST', 'DEV'])

/** The `Environment/query` rows, as the environments Boomi lists: id, name and classification. */
export const environmentsFrom = (rows: readonly Record<string, unknown>[]): Environment[] =>
  rows
    .map(raw => ({
      id: String(raw.id ?? ''),
      name: String(raw.name ?? ''),
      classification: typeof raw.classification === 'string' && raw.classification ? raw.classification.toUpperCase() : undefined,
    }))
    .filter(env => env.id)

/** The environment with this ID, or undefined when Boomi doesn't list it. */
export const environmentNamed = (list: readonly Environment[], id: string | undefined): Environment | undefined =>
  id ? list.find(env => env.id === id) : undefined

/**
 * The scripts a command runs, each with the folder it runs from: the last `cd`
 * before it in the command, relative to the session's folder ('' for that
 * folder itself, or an absolute path).
 */
export const wrapperRuns = (command: string): { path: string; dir: string }[] => {
  const out: { path: string; dir: string }[] = []
  let dir = ''
  for (const segment of command.split(/&&|\|\||[;|&\n]/).map(s => s.trim())) {
    const cd = /^(?:cd|pushd)\s+("[^"]*"|'[^']*'|\S+)$/.exec(segment)
    if (cd) {
      const target = cd[1]!.replace(/^["']|["']$/g, '')
      dir = target.startsWith('/') || !dir ? target : `${dir}/${target}`
      continue
    }
    for (const path of wrapperScripts(segment)) out.push({ path, dir })
  }
  return out
}

/** The steps a shell command would take in the .env's environment, in words: deploy, undeploy, run a test. Empty when it takes none. */
export const environmentChanges = (command: string): string[] =>
  scriptRuns(command)
    .filter(run => run.kind in CHANGES_ENVIRONMENT)
    .map(run => CHANGES_ENVIRONMENT[run.kind]!)

/**
 * Whether a shell command may run in the .env's environment, in enforce mode:
 * a deploy, undeploy or test run is refused unless the environment is listed
 * and classified TEST or DEV. `unknown` says why there is no environment to
 * check. Undefined lets the command run, and every mode other than enforce
 * lets it run.
 */
export const environmentGate = (
  command: string,
  mode: EnvCheck,
  environment: Environment | undefined,
  unknown = "the .env's environment isn't in Boomi's environment list, so it can't be checked",
  wrappers: readonly { path: string; text: string }[] = [],
): { deny: string; short: string } | undefined => {
  if (mode !== 'enforce') return undefined
  const changes = [
    ...environmentChanges(command),
    ...wrappers.flatMap(({ path, text }) => environmentChanges(text).map(change => `${change}, inside ${path}`)),
  ]
  if (changes.length === 0) return undefined
  if (environment?.classification && ALLOWED.has(environment.classification)) return undefined

  const short = environment ? `${environment.name} is ${environment.classification ?? 'unclassified'}, not TEST or DEV` : unknown
  return {
    short,
    deny: [
      `boomi-dashboard: refused: ${short}. Companion may not ${changes.join(' or ')} there in enforce mode (envCheck).`,
      `Not run: ${changes.join('; ')}.`,
      'Stop the Boomi work now and tell the user. Do not work around this: no curl or other calls to api.boomi.com, no running the script another way, no wrapper script. Production changes are a person\'s release through the normal process. The user can change envCheck with /bc-dashboard config.',
    ].join('\n'),
  }
}
