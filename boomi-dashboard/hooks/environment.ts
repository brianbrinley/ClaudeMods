// Production read-only: which Companion steps change the .env's environment,
// and whether that environment's classification lets them run. Plain
// functions: nothing here touches the engine.

import { scriptRuns } from './activity'
import { platformWrites, wrapperScripts } from './budget-gate'

/** What the production check does: off reads nothing, check reports, enforce also refuses. */
export type EnvCheck = 'off' | 'check' | 'enforce'

/** The environment the .env points at, as Boomi lists it. */
export type Environment = { id: string; name: string; classification?: string }

/** The scripts a command runs, read where they could be. `unreadable` names those that couldn't be read; `overLimit` says the chain is too long or too deep to check. */
export type WrapperFind = {
  wrappers: { path: string; text: string }[]
  unreadable: string[]
  overLimit: boolean
}

export const NO_WRAPPERS: WrapperFind = { wrappers: [], unreadable: [], overLimit: false }

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
 * Every change a command and the scripts it runs would make in the .env's
 * environment: Companion deploys, undeploys and test runs, and any Platform
 * API write made with curl or a similar tool, since its target is unknown.
 */
export const environmentChangesIn = (command: string, found: WrapperFind = NO_WRAPPERS): string[] => {
  const inside = (text: string, path?: string) => {
    const suffix = path ? `, inside ${path}` : ''
    return [...environmentChanges(text), ...platformWrites(text)].map(change => `${change}${suffix}`)
  }
  return [...inside(command), ...found.wrappers.flatMap(({ path, text }) => inside(text, path))]
}

/**
 * Whether a shell command may run in the .env's environment, in enforce mode.
 * Refused: a change to an environment that isn't TEST or DEV (or that Boomi
 * doesn't list), and any command that also touches the .env, since the file
 * could change while the command runs. Also refused: a script that couldn't
 * be read, or a chain too long to check. `unknown` says why there is no
 * environment to check. Undefined lets the command run; every mode other
 * than enforce lets it run.
 */
export const environmentGate = (
  command: string,
  mode: EnvCheck,
  environment: Environment | undefined,
  unknown = "the .env's environment isn't in Boomi's environment list, so it can't be checked",
  found: WrapperFind = NO_WRAPPERS,
): { deny: string; short: string } | undefined => {
  if (mode !== 'enforce') return undefined
  const refuse = (short: string, changes: string[]) => ({
    short,
    deny: [
      `boomi-dashboard: refused: ${short}. Companion may not run these in enforce mode (envCheck): ${changes.join('; ')}.`,
      `Not run: ${changes.join('; ')}.`,
      'Stop the Boomi work now and tell the user. Do not work around this: no curl or other calls to api.boomi.com, no running the script another way, no wrapper script. Production changes are a person\'s release through the normal process. The user can change envCheck with /bc-dashboard config.',
    ].join('\n'),
  })
  if (found.unreadable.length > 0) {
    return refuse(`${found.unreadable.join(', ')} couldn't be read, so what it runs can't be checked`, found.unreadable.map(path => `read ${path}`))
  }
  if (found.overLimit) return refuse('the scripts it runs go deeper or further than can be checked', ['run scripts that cannot be checked'])
  const changes = environmentChangesIn(command, found)
  if (changes.length === 0) return undefined
  const touchesEnvFile = [command, ...found.wrappers.map(w => w.text)].some(text => /\.env\b/.test(text))
  if (touchesEnvFile) return refuse('the command also touches .env, so the environment could change while it runs', changes)
  if (environment?.classification && ALLOWED.has(environment.classification)) return undefined
  const short = environment ? `${environment.name} is ${environment.classification ?? 'unclassified'}, not TEST or DEV` : unknown
  return refuse(short, changes)
}
