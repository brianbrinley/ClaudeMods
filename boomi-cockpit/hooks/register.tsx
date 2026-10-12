// A live summary of a Boomi Companion session: what Companion built, tested and
// deployed, what the session has cost, and, with Companion's credentials, the
// environment's recent runs and the components someone asked to watch.
// Companion's script runs are read from Claude's shell commands and their
// output, so the session's own activity needs no Platform API calls.
// Everything that touches the engine lives in this file because the engine
// follows $ only within it; parsing and formatting are in ./activity.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Activity, Cockpit, Platform, Watched } from '../types'
import {
  STATUS,
  VERB,
  compareWatched,
  componentOf,
  formatCost,
  isFailedStatus,
  levelOf,
  newFailures,
  readOutput,
  runLevel,
  runLine,
  scriptRuns,
  statusLine,
  summary,
  tiles,
  watchedLevel,
  watchedLine,
} from './activity'
import type { ScriptRun, Usage } from './activity'
import { credentialsFrom, parseEnv, platformClient } from './platform'
import type { Credentials } from './platform'

type Engine = EngineInterface

const OFF: Platform = { phase: 'off', message: 'not polled yet', runs: [] }

const cockpit = atom({ plugin: 'boomi-cockpit', key: 'cockpit' } as const, {
  activity: [],
  platform: OFF,
  watched: [],
} as Cockpit)

const isBandHidden = atom({ plugin: 'boomi-cockpit', key: 'isBandHidden' } as const, false)

type Settings = { envFile: string; pollSeconds: number; isToasting: boolean; isBanded: boolean }

const settingsFrom = (options: PluginOptions): Settings => ({
  envFile: String(options.envFile || '.env'),
  pollSeconds: Math.max(0, Number(options.pollSeconds ?? 60) || 0),
  isToasting: options.toasts !== false,
  isBanded: options.banner !== false,
})

const PANE = 'boomi-cockpit'
const WATCH_KEY = 'watched'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// The pane is a convenience: a surface that cannot seat one must not stop the work.
const openPane = ($: Engine) => {
  $.ui.open({ id: PANE, title: 'Boomi cockpit' }).catch(() => undefined)
}

const toast = ($: Engine, settings: Settings, text: string) => {
  if (settings.isToasting) $.ui.toast(text)
}

const usageOf = async ($: Engine): Promise<Usage> => {
  try {
    const usage = await $.session.usage()
    return { usd: usage.cost?.usd, contextPercent: usage.context.percent }
  } catch {
    return {}
  }
}

const refreshStatus = async ($: Engine) => {
  $.ui.status(statusLine(await read($, cockpit), (await usageOf($)).usd))
}

// --- Companion's script runs -----------------------------------------------

/** What the cockpit calls a run before its output names the component. */
const subjectOf = async ($: Engine, run: ScriptRun, current: Cockpit): Promise<{ subject: string; componentId?: string }> => {
  if (run.file) {
    try {
      const found = componentOf(String(await $.fs.read(run.file)))
      if (found.name) return { subject: found.name, componentId: found.componentId }
    } catch {}
    return { subject: run.file.split('/').pop() ?? run.file }
  }
  if (run.processId) {
    const known =
      current.activity.find(a => a.componentId === run.processId)?.subject ??
      current.watched.find(w => w.componentId === run.processId)?.name
    return { subject: known ?? run.processId, componentId: run.processId }
  }
  return { subject: run.deploymentId ? `deployment ${run.deploymentId}` : 'unknown' }
}

const outputOf = (ran: { text?: string; result?: unknown }): string => {
  const result = ran.result as { stdout?: unknown; stderr?: unknown } | undefined
  const streams = result && typeof result === 'object' ? [result.stdout, result.stderr].filter(s => typeof s === 'string') : []
  return [ran.text ?? '', ...streams].join('\n')
}

const record = ($: Engine, change: (list: Activity[]) => Activity[]) =>
  update($, cockpit, current => ({ ...current, activity: change(current.activity).slice(-100) }))

/** Notes each script run as running, before it runs. */
const noteStart = async ($: Engine, runs: readonly ScriptRun[]): Promise<Activity[]> => {
  const current = await read($, cockpit)
  const startedAt = await $.clock.now()
  let id = current.activity.reduce((max, a) => Math.max(max, a.id), 0)
  const started: Activity[] = []
  for (const run of runs) {
    const { subject, componentId } = await subjectOf($, run, current)
    started.push({ id: ++id, kind: run.kind, outcome: 'running', subject, detail: 'running', startedAt, file: run.file, componentId })
  }
  if (current.activity.length === 0) openPane($)
  await record($, list => [...list, ...started])
  void refreshStatus($)
  return started
}

type Ran = { deny?: string; text?: string; result?: unknown; isError?: boolean }

/** Reads how each run went from the command's output, or the refusal that stopped it. */
const noteEnd = async ($: Engine, settings: Settings, started: readonly Activity[], ran: Ran) => {
  if (started.length === 0) return
  const endedAt = await $.clock.now()
  const output = ran.deny === undefined ? outputOf(ran) : ''
  const done = started.map((a): Activity => {
    if (ran.deny !== undefined) {
      return { ...a, outcome: 'blocked', detail: ran.deny.split('\n')[0]!.slice(0, 160), endedAt }
    }
    const reading = readOutput(a.kind, output, ran.isError === true)
    return {
      ...a,
      outcome: reading.outcome,
      detail: reading.detail,
      endedAt,
      subject: reading.name ?? a.subject,
      componentId: reading.componentId ?? a.componentId,
      version: reading.version,
      executionStatus: reading.executionStatus,
      executionId: reading.executionId,
    }
  })
  await record($, list => list.map(a => done.find(d => d.id === a.id) ?? a))
  for (const a of done) announce($, settings, a)
  void refreshStatus($)
}

/** A toast for what someone would want to hear about without looking. */
const announce = ($: Engine, settings: Settings, a: Activity) => {
  const icon = STATUS[levelOf(a)].icon
  if (a.outcome === 'failed') toast($, settings, `${icon} ${a.kind} failed: ${a.subject}`)
  else if (a.outcome === 'blocked') toast($, settings, `${icon} ${a.kind} blocked: ${a.subject}`)
  else if (a.kind === 'deploy' || a.kind === 'test') toast($, settings, `${icon} ${a.subject} ${VERB[a.kind]}: ${a.detail}`)
}

// --- The Platform API --------------------------------------------------------

const envPath = async ($: Engine, settings: Settings) =>
  settings.envFile.startsWith('/') ? settings.envFile : `${await $.session.cwd()}/${settings.envFile}`

/** Companion's credentials from its .env, each missing one from the environment. */
const loadCredentials = async ($: Engine, settings: Settings): Promise<Credentials | string> => {
  const fromEnv: Record<string, string | undefined> = {
    BOOMI_API_URL: await $.env.get('BOOMI_API_URL'),
    BOOMI_USERNAME: await $.env.get('BOOMI_USERNAME'),
    BOOMI_API_TOKEN: await $.env.get('BOOMI_API_TOKEN'),
    BOOMI_ACCOUNT_ID: await $.env.get('BOOMI_ACCOUNT_ID'),
    BOOMI_ENVIRONMENT_ID: await $.env.get('BOOMI_ENVIRONMENT_ID'),
  }
  const path = await envPath($, settings)
  const fromFile = (await $.fs.exists(path)) ? parseEnv(String(await $.fs.read(path))) : {}
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(fromEnv)) if (value) values[key] = value
  Object.assign(values, Object.fromEntries(Object.entries(fromFile).filter(([, v]) => v)))
  const found = credentialsFrom(values)
  return 'missing' in found ? `off: no Platform API credentials (${found.missing.join(', ')} not set)` : found.credentials
}

let isPolling = false

/** Polls the environment's recent runs and the watched components; toasts what's new. */
const poll = async ($: Engine, settings: Settings): Promise<void> => {
  if (isPolling) return
  isPolling = true
  try {
    const loaded = await loadCredentials($, settings)
    if (typeof loaded === 'string') {
      await update($, cockpit, c => ({ ...c, platform: { ...OFF, message: loaded } }))
      return
    }
    const client = platformClient((url, init) => $.http.fetch(url, init), loaded)
    const before = await read($, cockpit)
    const checkedAt = await $.clock.now()

    let platform: Platform
    if (!loaded.environmentId) {
      platform = { phase: 'off', message: 'off: BOOMI_ENVIRONMENT_ID not set, so no environment to watch', runs: [], checkedAt }
    } else {
      try {
        const atoms = await client.environmentAtoms(loaded.environmentId)
        const runs = await client.recentRuns(atoms)
        platform = {
          phase: 'ok',
          message: atoms.length === 0 ? 'no runtimes attached to the environment' : `${atoms.length} runtime(s) watched`,
          environmentId: loaded.environmentId,
          checkedAt,
          runs,
        }
        // The first poll sets the baseline: only failures after it are news.
        if (before.platform.checkedAt !== undefined) {
          for (const run of newFailures(before.platform.runs, runs)) {
            toast($, settings, `${STATUS.critical.icon} ${run.processName} ${run.status.toLowerCase()} in the environment`)
          }
        }
      } catch (error) {
        platform = { ...before.platform, phase: 'error', message: `error: ${messageOf(error)}`, checkedAt }
      }
    }

    const watched: Watched[] = []
    for (const w of before.watched) {
      try {
        const now = await client.currentVersion(w.componentId)
        if (!now) {
          watched.push({ ...w, error: 'not found on the platform' })
          continue
        }
        const { next, isNewChange } = compareWatched({ ...w, error: undefined }, now, loaded.username)
        if (isNewChange) toast($, settings, `${STATUS.warning.icon} ${next.name ?? next.componentId} changed by ${next.changedBy}`)
        watched.push(next)
      } catch (error) {
        watched.push({ ...w, error: messageOf(error) })
      }
    }
    // A watch added or removed while this poll ran stands.
    await update($, cockpit, c => ({
      ...c,
      platform,
      watched: c.watched.map(w => watched.find(fresh => fresh.componentId === w.componentId) ?? w),
    }))
  } finally {
    isPolling = false
  }
}

// --- Watching components -----------------------------------------------------

const saveWatchList = async ($: Engine) => {
  const ids = (await read($, cockpit)).watched.map(w => w.componentId)
  await $.store.set(WATCH_KEY, ids)
}

/** Watches a component by ID or by its XML file under Companion's folders. */
const watch = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  if (!target) return 'Usage: /cockpit watch <component ID | component XML file>'
  let componentId = target
  let name: string | undefined
  if (target.endsWith('.xml')) {
    if (!(await $.fs.exists(target))) return `No file ${target}.`
    const found = componentOf(String(await $.fs.read(target)))
    if (!found.componentId) return `${target} has no componentId yet: create the component first.`
    componentId = found.componentId
    name = found.name
  }
  const current = await read($, cockpit)
  if (current.watched.some(w => w.componentId === componentId)) return `Already watching ${name ?? componentId}.`
  await update($, cockpit, c => ({ ...c, watched: [...c.watched, { componentId, name }] }))
  await saveWatchList($)
  await poll($, settings)
  const added = (await read($, cockpit)).watched.find(w => w.componentId === componentId)
  return `Watching ${added ? watchedLine(added) : componentId}`
}

const unwatch = async ($: Engine, target: string): Promise<string> => {
  const current = await read($, cockpit)
  const gone = current.watched.find(w => w.componentId === target || w.name === target)
  if (!gone) return `Not watching ${target}.`
  await update($, cockpit, c => ({ ...c, watched: c.watched.filter(w => w !== gone && w.componentId !== gone.componentId) }))
  await saveWatchList($)
  return `Stopped watching ${gone.name ?? gone.componentId}.`
}

/** Marks every watched change as seen, so only new ones count. */
const seen = async ($: Engine): Promise<string> => {
  await update($, cockpit, c => ({ ...c, watched: c.watched.map(w => ({ ...w, changedBy: undefined })) }))
  return 'Watched changes marked as seen.'
}

// --- Commands and tools ------------------------------------------------------

const USAGE = [
  '/cockpit                 the session summary; opens the cockpit pane where the surface has one',
  '/cockpit poll            poll the Platform API now',
  '/cockpit watch <id|file> watch a component for changes someone else makes',
  '/cockpit unwatch <id>    stop watching it',
  '/cockpit seen            mark watched changes as seen',
  '/cockpit banner          show the banner above the prompt again',
].join('\n')

const runCommand = async ($: Engine, settings: Settings, args: string): Promise<string> => {
  const [action = 'status', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const target = rest.join(' ')
  switch (action) {
    case 'status':
      openPane($)
      return summary(await read($, cockpit), await usageOf($))
    case 'poll':
      await poll($, settings)
      return summary(await read($, cockpit), await usageOf($))
    case 'watch':
      return watch($, settings, target)
    case 'unwatch':
      return unwatch($, target)
    case 'seen':
      return seen($)
    case 'banner':
      await update($, isBandHidden, () => false)
      return 'The cockpit banner is back above the prompt.'
    default:
      return USAGE
  }
}

export const register: Register = (on, options) => {
  const settings = settingsFrom(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'cockpit',
      description: 'Live summary of the Boomi Companion session: builds, tests, deploys, platform runs, cost',
      argumentHint: 'poll | watch <id|file> | unwatch <id> | seen | banner',
    })
    await $.tool.register({
      name: 'summary',
      description:
        "The Boomi Companion session at a glance: components created and pushed, test executions, deployments, the session's cost so far, the environment's recent runs and watched components. Use it to report progress or to find what failed.",
    })
    await $.tool.register({
      name: 'watch',
      description:
        'Watch a Boomi component for changes someone else makes on the platform; the cockpit shows a toast when its version moves. Takes a component ID or a component XML file Companion created.',
      inputSchema: {
        type: 'object',
        properties: { target: { type: 'string', description: 'A component ID, or the path of its XML file' } },
        required: ['target'],
      },
    })

    // The watch list outlives the session; restore it the first time.
    const ids = await $.store.get(WATCH_KEY)
    if (Array.isArray(ids)) {
      await update($, cockpit, c =>
        c.watched.length > 0 ? c : { ...c, watched: ids.map(id => ({ componentId: String(id) })) },
      )
    }

    $.clock.every(5_000, () => refreshStatus($))
    if (settings.pollSeconds > 0) {
      $.clock.after(2_000, () => poll($, settings))
      $.clock.every(settings.pollSeconds * 1000, () => poll($, settings))
    }
    return started
  })

  // Companion's scripts: note each run as it starts, then read how it went.
  // The cockpit only watches: its own trouble never stops the command.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const runs = scriptRuns(String(e.command ?? ''))
    if (runs.length === 0) return next(e)
    const started = await noteStart($, runs).catch(() => [] as Activity[])
    const ran = await next(e)
    await noteEnd($, settings, started, ran).catch(() => undefined)
    return ran
  })

  on('command.run', { command: 'cockpit' }, async ($, e) => ({ text: await runCommand($, settings, e.args) }))

  on('tool.call', { tool: 'mcp__boomi-cockpit__summary' }, async $ => ({
    result: await Promise.resolve()
      .then(async () => summary(await read($, cockpit), await usageOf($)))
      .catch(error => `The cockpit couldn't build its summary: ${messageOf(error)}`),
  }))

  on('tool.call', { tool: 'mcp__boomi-cockpit__watch' }, async ($, e) => ({
    result: await watch($, settings, String((e as { target?: unknown }).target ?? '').trim()).catch(
      error => `The cockpit couldn't watch that component: ${messageOf(error)}`,
    ),
  }))

  // The banner above the prompt: the summary in one row, once there's something to show.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, cockpit)
    const hasNews = current.activity.length > 0 || current.platform.runs.length > 0 || current.watched.length > 0
    if (!settings.isBanded || e.props.hasSurvey || !hasNews || (await read($, isBandHidden))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text bold>Cockpit </Text>
        {tiles(current).map(tile => (
          <Text>
            <Text color={STATUS[tile.level].color}>{STATUS[tile.level].icon}</Text> {tile.label}{'  '}
          </Text>
        ))}
        <Button key="open" label="Open" onPress={() => openPane($)} />
        <Text> </Text>
        <Button key="hide" label="Hide" onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, cockpit)
    const usage = await usageOf($)
    const cost = formatCost(usage.usd)
    const room = Math.max(3, (e.viewport?.rows ?? 30) - 14 - current.platform.runs.length - current.watched.length)

    return (
      <Box flexDirection="column">
        {tiles(current).map(tile => (
          <Text>
            <Text bold color={STATUS[tile.level].color}>
              {STATUS[tile.level].icon} {tile.label.padEnd(9)}
            </Text>{' '}
            {tile.text}
          </Text>
        ))}
        {(cost || usage.contextPercent !== undefined) && (
          <Text dimColor>
            {'  Session   '}
            {[cost && `${cost} so far`, usage.contextPercent !== undefined && `context ${Math.round(usage.contextPercent)}% full`]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        )}

        <Text bold>Companion activity</Text>
        {current.activity.length === 0 && <Text dimColor>No create, push, deploy or test yet.</Text>}
        {current.activity
          .slice(-room)
          .reverse()
          .map(a => (
            <Text>
              <Text color={STATUS[levelOf(a)].color}>{STATUS[levelOf(a)].icon}</Text> {a.kind.padEnd(8)} {a.subject}
              {a.version ? ` v${a.version}` : ''} <Text dimColor>{a.detail}</Text>
            </Text>
          ))}

        {current.platform.runs.length > 0 && <Text bold>Environment runs</Text>}
        {current.platform.runs.map(run => (
          <Text>
            <Text color={STATUS[runLevel(run)].color}>{STATUS[runLevel(run)].icon}</Text>{' '}
            <Text dimColor={!isFailedStatus(run.status)}>{runLine(run).slice(2)}</Text>
          </Text>
        ))}

        {current.watched.length > 0 && <Text bold>Watched components</Text>}
        {current.watched.map(w => (
          <Text>
            <Text color={STATUS[watchedLevel(w)].color}>{STATUS[watchedLevel(w)].icon}</Text> {watchedLine(w).slice(2)}
          </Text>
        ))}
        <Text dimColor>Platform: {current.platform.message}</Text>
      </Box>
    )
  })
}
