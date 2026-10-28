// Production read-only: which Companion steps change the .env's environment,
// and whether that environment's classification lets them run. Plain
// functions: nothing here touches the engine.

import { scriptRuns } from './activity'
import { platformWrites, wrapperScripts } from './budget-gate'

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

/** The scripts a command runs that aren't Companion's own, each with the folder it runs from (the last `cd` before it). */
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
 * Every change a command would make in the .env's environment: Companion
 * deploys, undeploys and test runs, and any Platform API write made with
 * curl or a similar tool, since its target is unknown.
 */
export const environmentChangesIn = (command: string): string[] => [...environmentChanges(command), ...platformWrites(command)]

/**
 * Whether a shell command may run, in enforce mode. Refused, in order:
 * - any script of the command's own (not Companion's), since the check can't
 *   see what it does;
 * - a change to an environment that isn't TEST or DEV, or that Boomi doesn't
 *   list, including a raw Platform API write;
 * - any command that also names the .env (or the configured envFile), since
 *   the file could change while the command runs.
 * `unknown` says why there is no environment to check. Undefined lets the
 * command run, and every mode other than enforce lets it run.
 */
export const environmentGate = (
  command: string,
  mode: EnvCheck,
  environment: Environment | undefined,
  unknown = "the .env's environment isn't in Boomi's environment list, so it can't be checked",
  envFile = '.env',
): { deny: string; short: string } | undefined => {
  if (mode !== 'enforce') return undefined
  const refuse = (short: string, notRun: string) => ({
    short,
    deny: [
      `boomi-dashboard: refused: ${short}. Companion may not run this in enforce mode (envCheck).`,
      `Not run: ${notRun}.`,
      'Stop the Boomi work now and tell the user. Do not work around this: no curl or other calls to api.boomi.com, no running the script another way, no wrapper script. Production changes are a person\'s release through the normal process. The user can change envCheck with /bc-dashboard config.',
    ].join('\n'),
  })
  const scripts = wrapperRuns(command).map(run => run.path)
  if (scripts.length > 0) {
    return refuse(`the command runs ${scripts.join(', ')}, a script the check can't see into`, `the script${scripts.length > 1 ? 's' : ''} ${scripts.join(', ')}`)
  }
  const changes = environmentChangesIn(command)
  if (changes.length === 0) return undefined
  const envName = envFile.split('/').pop() || '.env'
  const names = [...new Set(['.env', envName])].map(name => new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`))
  if (names.some(name => name.test(command))) {
    return refuse(`the command also touches ${envName}, so the environment could change while it runs`, changes.join('; '))
  }
  if (environment?.classification && ALLOWED.has(environment.classification)) return undefined
  const short = environment ? `${environment.name} is ${environment.classification ?? 'unclassified'}, not TEST or DEV` : unknown
  return refuse(short, changes.join('; '))
}
