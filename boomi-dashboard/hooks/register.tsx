// A live view of a Boomi Companion session while you build: each component
// Claude edits, saves, deploys and tests, what needs attention and what to do
// about it, the session's cost, and, with Companion's credentials, the live
// environment's recent runs and the components someone asked to watch.
// Companion's work is read from Claude's tool calls and their output, so the
// session's own activity needs no Platform API calls.
// Everything that touches the engine lives in this file because the engine
// follows $ only within it; parsing and wording are in ./activity.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Activity, Dashboard, Ledger, PaneTheme, Platform, Watched } from '../types'
import {
  EMPTY_LEDGER,
  STATUS,
  ago,
  duration,
  attention,
  compareWatched,
  componentOf,
  componentPath,
  components,
  describe,
  formatCost,
  formatSpend,
  formatTokens,
  isRunningStatus,
  friendlyType,
  headline,
  FLAMINGO_TRAVEL,
  flamingoView,
  levelOf,
  meter,
  modelMix,
  modelName,
  modelSplits,
  pixelCells,
  newFailures,
  readOutput,
  recentRuns,
  runLevel,
  runText,
  scriptRuns,
  spendOf,
  spends,
  sparkline,
  stages,
  statusLine,
  summary,
  tokenSplit,
  cachedTokens,
  newTokens,
  watchedLevel,
  watchedLine,
  watchedText,
  worst,
} from './activity'
import type { Level, ScriptRun, Usage } from './activity'
import { credentialsFrom, parseEnv, platformClient } from './platform'
import type { Credentials } from './platform'

type Engine = EngineInterface

const OFF: Platform = { phase: 'off', message: 'Checking Boomi…', runs: [] }

const dashboard = atom({ plugin: 'boomi-dashboard', key: 'dashboard' } as const, {
  activity: [],
  platform: OFF,
  watched: [],
} as Dashboard)

const isBandHidden = atom({ plugin: 'boomi-dashboard', key: 'isBandHidden' } as const, false)

const ledger = atom({ plugin: 'boomi-dashboard', key: 'ledger' } as const, EMPTY_LEDGER as Ledger)

const isWorking = atom({ plugin: 'boomi-dashboard', key: 'isWorking' } as const, false)

/** The theme picked in the pane or with /bc-dashboard theme; null follows the setting. */
const pickedTheme = atom({ plugin: 'boomi-dashboard', key: 'theme' } as const, null as PaneTheme | null)

/** The flamingo's animation frame, moved on while Claude works. */
const frame = atom({ plugin: 'boomi-dashboard', key: 'frame' } as const, 0)

type Settings = {
  envFile: string
  componentsDir: string
  pollSeconds: number
  windowMs: number
  paneTheme: PaneTheme
  isToasting: boolean
  isBanded: boolean
  hasFlamingo: boolean
}

const settingsFrom = (options: PluginOptions): Settings => ({
  envFile: String(options.envFile || '.env'),
  componentsDir: String(options.componentsDir || 'active-development'),
  pollSeconds: Math.max(0, Number(options.pollSeconds ?? 60) || 0),
  windowMs: Math.max(1, Number(options.recentHours ?? 24) || 24) * 3_600_000,
  paneTheme: options.paneTheme === 'night' || options.paneTheme === 'terminal' ? options.paneTheme : 'day',
  isToasting: options.toasts !== false,
  isBanded: options.banner !== false,
  hasFlamingo: options.flamingo !== false,
})

const PANE = 'boomi-dashboard'
const WATCH_KEY = 'watched'
const THEME_KEY = 'theme'

const THEMES: readonly PaneTheme[] = ['day', 'night', 'terminal']
const THEME_NAMES: Record<PaneTheme, string> = { day: 'Day', night: 'Night', terminal: 'Terminal' }

const isTheme = (value: unknown): value is PaneTheme => THEMES.includes(value as PaneTheme)
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// The pane is a convenience: a surface that cannot seat one must not stop the work.
const openPane = ($: Engine) => {
  $.ui.open({ id: PANE, title: 'Boomi Companion Dashboard' }).catch(() => undefined)
}

const toast = ($: Engine, settings: Settings, text: string) => {
  if (settings.isToasting) $.ui.toast(text)
}

const usageOf = async ($: Engine): Promise<Usage> => {
  const l = await read($, ledger)
  const tokens = newTokens(l) || undefined
  const cached = cachedTokens(l) || undefined
  const models = {
    model: modelName(l.lastModel),
    models: modelMix(l) || undefined,
    split: l.calls > 0 ? tokenSplit(l) : undefined,
    modelSplits: modelSplits(l),
  }
  try {
    const usage = await $.session.usage()
    return { usd: usage.cost?.usd, contextPercent: usage.context.percent, tokens, cached, startedAt: usage.startedAt, ...models }
  } catch {
    return { tokens, cached, ...models }
  }
}

/** The session's tokens and cost right now, stamped on each step as it begins. */
const snapshot = async ($: Engine) => {
  const usage = await usageOf($)
  return { tokensAt: usage.tokens ?? 0, usdAt: usage.usd, model: usage.model }
}

const refreshStatus = async ($: Engine, settings: Settings) => {
  const now = await $.clock.now()
  $.ui.status(statusLine(await read($, dashboard), now, settings.windowMs, await usageOf($)))
}

const record = ($: Engine, change: (list: Activity[]) => Activity[]) =>
  update($, dashboard, current => ({ ...current, activity: change(current.activity).slice(-150) }))

const nextId = (list: readonly Activity[]) => list.reduce((max, a) => Math.max(max, a.id), 0) + 1

/** A component file's name, ID and type, when the file can be read. */
const readComponent = async ($: Engine, path: string) => {
  try {
    return componentOf(String(await $.fs.read(path)))
  } catch {
    return {}
  }
}

// --- Companion's script runs -----------------------------------------------

/** What the dashboard calls a run before its output names the component. */
const subjectOf = async ($: Engine, settings: Settings, run: ScriptRun, current: Dashboard) => {
  if (run.file) {
    const found = await readComponent($, run.file)
    const file = componentPath(run.file, settings.componentsDir) ?? run.file
    return { subject: found.name ?? run.file.split('/').pop() ?? run.file, componentId: found.componentId, type: found.type, file }
  }
  const id = run.processId ?? run.componentId
  if (id) {
    const known =
      current.activity.find(a => a.componentId === id && !/\.xml$/.test(a.subject)) ??
      current.activity.find(a => a.componentId === id)
    const watched = current.watched.find(w => w.componentId === id)
    return { subject: known?.subject ?? watched?.name ?? id, componentId: id, type: known?.type, file: known?.file }
  }
  return { subject: run.deploymentId ? `deployment ${run.deploymentId}` : run.kind === 'other' ? (run.script ?? 'a Companion script') : 'a component' }
}

const outputOf = (ran: { text?: string; result?: unknown }): string => {
  const result = ran.result as { stdout?: unknown; stderr?: unknown } | undefined
  const streams = result && typeof result === 'object' ? [result.stdout, result.stderr].filter(s => typeof s === 'string') : []
  return [ran.text ?? '', ...streams].join('\n')
}

/** Notes each script run as running, before it runs. */
const noteStart = async ($: Engine, settings: Settings, runs: readonly ScriptRun[]): Promise<Activity[]> => {
  const current = await read($, dashboard)
  const startedAt = await $.clock.now()
  const spent = await snapshot($)
  let id = nextId(current.activity)
  const started: Activity[] = []
  for (const run of runs) {
    const found = await subjectOf($, settings, run, current)
    started.push({ id: id++, kind: run.kind, outcome: 'running', detail: 'running', startedAt, script: run.script, ...spent, ...found })
  }
  if (!current.activity.some(a => a.kind !== 'other')) openPane($)
  await record($, list => [...list, ...started])
  void refreshStatus($, settings)
  return started
}

type Ran = { deny?: string; text?: string; result?: unknown; isError?: boolean }

/** Reads how each run went from the command's output, or the refusal that stopped it. */
const noteEnd = async ($: Engine, settings: Settings, started: readonly Activity[], ran: Ran) => {
  if (started.length === 0) return
  const endedAt = await $.clock.now()
  const output = ran.deny === undefined ? outputOf(ran) : ''
  const done: Activity[] = []
  for (const a of started) {
    if (ran.deny !== undefined) {
      done.push({ ...a, outcome: 'blocked', detail: ran.deny.split('\n')[0]!.slice(0, 160), endedAt })
      continue
    }
    const reading = readOutput(a.kind, output, ran.isError === true)
    // A create or pull writes the component's ID and name into its file.
    const fresh = a.file && (a.kind === 'create' || a.kind === 'pull') ? await readComponent($, a.file) : {}
    done.push({
      ...a,
      outcome: reading.outcome,
      detail: reading.detail,
      endedAt,
      subject: reading.name ?? fresh.name ?? a.subject,
      componentId: reading.componentId ?? fresh.componentId ?? a.componentId,
      type: fresh.type ?? a.type,
      version: reading.version,
      executionStatus: reading.executionStatus,
      executionId: reading.executionId,
    })
  }
  await record($, list => list.map(a => done.find(d => d.id === a.id) ?? a))
  for (const a of done) announce($, settings, a)
  void refreshStatus($, settings)
  // A deploy or test starts runs in Boomi: look for them soon.
  if (done.some(a => a.kind === 'deploy' || a.kind === 'test')) pollSoon($, settings, 5_000)
}

/** A toast for what someone would want to hear about without looking. */
const announce = ($: Engine, settings: Settings, a: Activity) => {
  if (a.kind === 'other' || a.kind === 'pull') {
    if (a.outcome === 'failed' || a.outcome === 'blocked') toast($, settings, `${STATUS[levelOf(a)].icon} ${describe(a)}`)
    return
  }
  if (a.outcome !== 'ok' || a.kind === 'deploy' || a.kind === 'test') {
    toast($, settings, `${STATUS[levelOf(a)].icon} ${describe(a)}`)
  }
}

/** Notes Claude editing a component's XML: the step before Companion saves it. */
const noteEdit = async ($: Engine, settings: Settings, path: string) => {
  const file = componentPath(path, settings.componentsDir)
  if (!file) return
  const found = await readComponent($, path)
  const at = await $.clock.now()
  const spent = await snapshot($)
  const isFirst = !(await read($, dashboard)).activity.some(a => a.kind !== 'other')
  await record($, list => {
    // A run of edits to one file is one step.
    const last = list[list.length - 1]
    if (last?.kind === 'edit' && last.file === file) {
      return [...list.slice(0, -1), { ...last, ...spent, startedAt: at, endedAt: at, subject: found.name ?? last.subject, type: found.type ?? last.type }]
    }
    const edit: Activity = {
      id: nextId(list),
      kind: 'edit',
      outcome: 'ok',
      subject: found.name ?? file.split('/').pop() ?? file,
      detail: 'edited',
      startedAt: at,
      endedAt: at,
      ...spent,
      file,
      componentId: found.componentId,
      type: found.type,
    }
    return [...list, edit]
  })
  if (isFirst) openPane($)
  void refreshStatus($, settings)
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
  return 'missing' in found
    ? `Not connected: Companion's Boomi credentials aren't set (${found.missing.join(', ')}). Runs show up here once they are.`
    : found.credentials
}

let isPolling = false
let isFollowUpDue = false

/**
 * A check of Boomi soon, on top of the regular poll: after a deploy or test,
 * and while a run is still in progress, so a new run shows without the
 * regular poll's wait. One is pending at a time.
 */
const pollSoon = ($: Engine, settings: Settings, ms: number) => {
  if (settings.pollSeconds <= 0 || isFollowUpDue) return
  isFollowUpDue = true
  $.clock.after(ms, async () => {
    isFollowUpDue = false
    await poll($, settings)
  })
}

/** Polls the environment's recent runs and the watched components; toasts what's new. */
const poll = async ($: Engine, settings: Settings): Promise<void> => {
  if (isPolling) return
  isPolling = true
  try {
    const loaded = await loadCredentials($, settings)
    if (typeof loaded === 'string') {
      await update($, dashboard, c => ({ ...c, platform: { ...OFF, message: loaded } }))
      return
    }
    const client = platformClient((url, init) => $.http.fetch(url, init), loaded)
    const before = await read($, dashboard)
    const checkedAt = await $.clock.now()

    let platform: Platform
    if (!loaded.environmentId) {
      platform = { phase: 'off', message: 'Not connected: set BOOMI_ENVIRONMENT_ID to choose which environment to show.', runs: [], checkedAt }
    } else {
      try {
        const atoms = await client.environmentAtoms(loaded.environmentId)
        const runs = await client.recentRuns(atoms)
        platform = {
          phase: 'ok',
          message: atoms.length === 0 ? 'No runtimes are attached to the environment, so nothing can run there yet.' : `Watching ${atoms.length} runtime${atoms.length === 1 ? '' : 's'}.`,
          environmentId: loaded.environmentId,
          checkedAt,
          runs,
        }
        // The first poll sets the baseline: only failures after it are news.
        if (before.platform.checkedAt !== undefined) {
          for (const run of newFailures(before.platform.runs, runs)) {
            toast($, settings, `${STATUS.critical.icon} ${runText(run, checkedAt)} in the environment`)
          }
        }
      } catch (error) {
        platform = { ...before.platform, phase: 'error', message: `Couldn't reach Boomi: ${messageOf(error)}`, checkedAt }
      }
    }

    const watched: Watched[] = []
    for (const w of before.watched) {
      try {
        const now = await client.currentVersion(w.componentId)
        if (!now) {
          watched.push({ ...w, error: 'not found in Boomi' })
          continue
        }
        const { next, isNewChange } = compareWatched({ ...w, error: undefined }, now, loaded.username)
        if (isNewChange) toast($, settings, `${STATUS.warning.icon} ${next.name ?? next.componentId} was changed by ${next.changedBy}`)
        watched.push(next)
      } catch (error) {
        watched.push({ ...w, error: messageOf(error) })
      }
    }
    // A watch added or removed while this poll ran stands.
    await update($, dashboard, c => ({
      ...c,
      platform,
      watched: c.watched.map(w => watched.find(fresh => fresh.componentId === w.componentId) ?? w),
    }))
    if (platform.runs.some(run => isRunningStatus(run.status))) pollSoon($, settings, 10_000)
  } finally {
    isPolling = false
  }
}

// --- Watching components -----------------------------------------------------

const saveWatchList = async ($: Engine) => {
  const ids = (await read($, dashboard)).watched.map(w => w.componentId)
  await $.store.set(WATCH_KEY, ids)
}

/** Watches a component by ID or by its XML file under Companion's folders. */
const watch = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  if (!target) return 'Usage: /bc-dashboard watch <component ID | component XML file>'
  let componentId = target
  let name: string | undefined
  if (target.endsWith('.xml')) {
    if (!(await $.fs.exists(target))) return `No file ${target}.`
    const found = componentOf(String(await $.fs.read(target)))
    if (!found.componentId) return `${target} has no componentId yet: create the component first.`
    componentId = found.componentId
    name = found.name
  }
  const current = await read($, dashboard)
  if (current.watched.some(w => w.componentId === componentId)) return `Already watching ${name ?? componentId}.`
  await update($, dashboard, c => ({ ...c, watched: [...c.watched, { componentId, name }] }))
  await saveWatchList($)
  await poll($, settings)
  const added = (await read($, dashboard)).watched.find(w => w.componentId === componentId)
  return `Watching ${added ? watchedLine(added) : componentId}`
}

const unwatch = async ($: Engine, target: string): Promise<string> => {
  const current = await read($, dashboard)
  const gone = current.watched.find(w => w.componentId === target || w.name === target)
  if (!gone) return `Not watching ${target}.`
  await update($, dashboard, c => ({ ...c, watched: c.watched.filter(w => w.componentId !== gone.componentId) }))
  await saveWatchList($)
  return `Stopped watching ${gone.name ?? gone.componentId}.`
}

/** Marks every watched change as seen, so only new ones count. */
const seen = async ($: Engine): Promise<string> => {
  await update($, dashboard, c => ({ ...c, watched: c.watched.map(w => ({ ...w, changedBy: undefined })) }))
  return 'Watched changes marked as seen.'
}

/** Picks the pane's theme, now and for later sessions. */
const pickTheme = async ($: Engine, theme: PaneTheme) => {
  await update($, pickedTheme, () => theme)
  await $.store.set(THEME_KEY, theme)
}

const themeOf = async ($: Engine, settings: Settings): Promise<PaneTheme> => (await read($, pickedTheme)) ?? settings.paneTheme

/** /bc-dashboard theme [day|night|terminal]: picks one, or lists them. */
const theme = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  const wanted = target.toLowerCase()
  if (isTheme(wanted)) {
    await pickTheme($, wanted)
    return `Dashboard theme: ${THEME_NAMES[wanted]}.`
  }
  const current = await themeOf($, settings)
  const list = THEMES.map(t => `${t === current ? '◆' : '◇'} ${t}`).join('   ')
  return `${target ? `No theme called ${target}. ` : ''}Themes: ${list}\nPick one with /bc-dashboard theme <name>, or with the buttons in the pane.`
}

// --- Commands and tools ------------------------------------------------------

const USAGE = [
  '/bc-dashboard                 what needs attention, each component, recent activity, the live environment',
  '/bc-dashboard poll            check Boomi now',
  '/bc-dashboard watch <id|file> watch a component for changes someone else makes',
  '/bc-dashboard unwatch <id>    stop watching it',
  '/bc-dashboard seen            mark watched changes as seen',
  '/bc-dashboard banner          show the banner above the prompt again',
  '/bc-dashboard theme [name]    the pane\'s colors: day, night or terminal',
].join('\n')

const summaryNow = async ($: Engine, settings: Settings) =>
  summary(await read($, dashboard), await usageOf($), await $.clock.now(), settings.windowMs)

const runCommand = async ($: Engine, settings: Settings, args: string): Promise<string> => {
  const [action = 'status', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const target = rest.join(' ')
  switch (action) {
    case 'status':
      openPane($)
      return summaryNow($, settings)
    case 'poll':
      await poll($, settings)
      return summaryNow($, settings)
    case 'watch':
      return watch($, settings, target)
    case 'unwatch':
      return unwatch($, target)
    case 'seen':
      return seen($)
    case 'theme':
      return theme($, settings, target)
    case 'banner':
      await update($, isBandHidden, () => false)
      return 'The dashboard banner is back above the prompt.'
    default:
      return USAGE
  }
}

// --- Drawing -------------------------------------------------------------------

/**
 * The pane's colors: Valence Day or Night with a background of their own, or
 * the terminal's theme. `band` is the title bar, `accent` the gauges' values.
 */
type Palette = {
  bg?: string
  text: string
  muted: string
  heading: string
  rule: string
  band?: string
  bandText: string
  accent: string
  /** The flamingo's pink. */
  bird: string
}

const PALETTES: Record<PaneTheme, Palette> = {
  day: {
    bg: '#FBF6EE',
    text: '#0B0B0B',
    muted: '#52514E',
    heading: '#C2185B',
    rule: '#9A7B3F',
    band: '#C2185B',
    bandText: '#FBF6EE',
    accent: '#0F766E',
    bird: '#C2185B',
  },
  night: {
    bg: '#161A2E',
    text: '#FFFFFF',
    muted: '#C9CBE0',
    heading: '#F48FB1',
    rule: '#D4B46A',
    band: '#F48FB1',
    bandText: '#161A2E',
    accent: '#5EEAD4',
    bird: '#F48FB1',
  },
  terminal: { text: 'text', muted: 'inactive', heading: 'claude', rule: 'subtle', bandText: 'claude', accent: 'suggestion', bird: '#C2185B' },
}

/** The Deco rule under the title: double lines with a diamond at the center. */
const decoRule = (width: number): string => {
  const side = Math.max(2, Math.floor((width - 5) / 2))
  return `${'═'.repeat(side)}◇◆◇${'═'.repeat(Math.max(2, width - 3 - side))}`
}

export const register: Register = (on, options) => {
  const settings = settingsFrom(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'bc-dashboard',
      description: 'Boomi Companion at a glance: what needs attention, each component, the live environment, cost',
      argumentHint: 'poll | watch <id|file> | unwatch <id> | seen | banner | theme [day|night|terminal]',
    })
    await $.tool.register({
      name: 'summary',
      description:
        "The Boomi Companion session at a glance: what failed and needs attention (with what to do), each component's stage (edited, saved to Boomi with its version, deployed, tested), recent Companion activity, the live environment's recent runs, watched components and the session's cost. Use it to report progress or to find what to fix next.",
    })
    await $.tool.register({
      name: 'watch',
      description:
        'Watch a Boomi component for changes someone else makes in Boomi; the dashboard flags it when its version moves. Takes a component ID or a component XML file Companion created.',
      inputSchema: {
        type: 'object',
        properties: { target: { type: 'string', description: 'A component ID, or the path of its XML file' } },
        required: ['target'],
      },
    })

    // The watch list outlives the session; restore it the first time.
    const saved = await $.store.get(THEME_KEY)
    if (isTheme(saved)) await update($, pickedTheme, () => saved)

    const ids = await $.store.get(WATCH_KEY)
    if (Array.isArray(ids)) {
      await update($, dashboard, c =>
        c.watched.length > 0 ? c : { ...c, watched: ids.map(id => ({ componentId: String(id) })) },
      )
    }

    $.clock.every(5_000, () => refreshStatus($, settings))
    // The flamingo walks while Claude works: about three frames a second.
    if (settings.hasFlamingo) {
      $.clock.every(320, async () => {
        if (await read($, isWorking)) await update($, frame, n => (n + 1) % 1000)
      })
    }
    if (settings.pollSeconds > 0) {
      $.clock.after(2_000, () => poll($, settings))
      $.clock.every(settings.pollSeconds * 1000, () => poll($, settings))
    }
    return started
  })

  // Companion's scripts: note each run as it starts, then read how it went.
  // The dashboard only watches: its own trouble never stops the command.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const runs = scriptRuns(String(e.command ?? ''))
    if (runs.length === 0) return next(e)
    const started = await noteStart($, settings, runs).catch(() => [] as Activity[])
    const ran = await next(e)
    await noteEnd($, settings, started, ran).catch(() => undefined)
    return ran
  })

  // Claude editing a component's XML: the first step of every change.
  on('tool.call', async ($, e, next) => {
    if (!EDIT_TOOLS.has(String(e.tool))) return next(e)
    const ran = await next(e)
    const path = (e as { file_path?: unknown }).file_path
    if (ran.deny === undefined && ran.isError !== true && typeof path === 'string') {
      await noteEdit($, settings, path).catch(() => undefined)
    }
    return ran
  })

  on('command.run', { command: 'bc-dashboard' }, async ($, e) => ({ text: await runCommand($, settings, e.args) }))

  on('tool.call', { tool: 'mcp__boomi-dashboard__summary' }, async $ => ({
    result: await summaryNow($, settings).catch(error => `The dashboard couldn't build its summary: ${messageOf(error)}`),
  }))

  on('tool.call', { tool: 'mcp__boomi-dashboard__watch' }, async ($, e) => ({
    result: await watch($, settings, String((e as { target?: unknown }).target ?? '').trim()).catch(
      error => `The dashboard couldn't watch that component: ${messageOf(error)}`,
    ),
  }))

  // Every model call's tokens, as the API reported them: the running count.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const used = response.usage
    if (used) {
      // A model's share counts new tokens, as the headline does.
      const total = used.input_tokens + used.output_tokens + used.cache_creation_input_tokens
      await update($, ledger, l => ({
        input: l.input + used.input_tokens,
        output: l.output + used.output_tokens,
        cacheRead: l.cacheRead + used.cache_read_input_tokens,
        cacheWrite: l.cacheWrite + used.cache_creation_input_tokens,
        calls: l.calls + 1,
        models: { ...l.models, [used.model]: (l.models?.[used.model] ?? 0) + total },
        byModel: {
          ...l.byModel,
          [used.model]: {
            input: (l.byModel?.[used.model]?.input ?? 0) + used.input_tokens,
            output: (l.byModel?.[used.model]?.output ?? 0) + used.output_tokens,
            cacheRead: (l.byModel?.[used.model]?.cacheRead ?? 0) + used.cache_read_input_tokens,
            cacheWrite: (l.byModel?.[used.model]?.cacheWrite ?? 0) + used.cache_creation_input_tokens,
          },
        },
        lastModel: used.model,
      })).catch(() => undefined)
    }
    return response
  })

  // Working while Claude is on a turn, idle between turns.
  on('turn.start', async ($, e, next) => {
    await update($, isWorking, () => true).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await update($, isWorking, () => false).catch(() => undefined)
    void refreshStatus($, settings)
    return done
  })

  // The banner above the prompt: the latest thing Companion did, what needs
  // attention and the spend so far, on one row. Hidden until there's news.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!settings.isBanded || e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    const current = await read($, dashboard)
    const now = await $.clock.now()
    const latest = headline(current.activity)
    const needs = attention(current, now, settings.windowMs)
    if (!latest && needs.length === 0) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const count = components(current.activity).length
    const usage = await usageOf($)
    const spent = [usage.tokens ? `${formatTokens(usage.tokens)} tokens` : undefined, formatCost(usage.usd)].filter(Boolean).join(' · ')
    const icon = (level: Level) => <Text color={STATUS[level].color}>{STATUS[level].icon}</Text>

    return (
      <Box>
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            <Text bold color="claude">
              ◆ BC Dashboard{' '}
            </Text>
            {latest && (
              <Text>
                {icon(levelOf(latest))} {describe(latest)} <Text dimColor>{ago(latest.endedAt ?? latest.startedAt, now)}</Text>
              </Text>
            )}
            {needs.length > 0 && (
              <Text>
                <Text dimColor>{latest ? ' │ ' : ''}</Text>
                {icon(worst(needs.map(n => n.level)))} {needs.length} need{needs.length === 1 ? 's' : ''} attention
              </Text>
            )}
            <Text dimColor>
              {count > 0 ? ` │ ${count} component${count === 1 ? '' : 's'}` : ''}
              {spent ? ` │ ${spent}` : ''}
            </Text>
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text> </Text>
          <Button key="open" label="Open" onPress={() => openPane($)} />
          <Text> </Text>
          <Button key="hide" label="Hide" onPress={() => update($, isBandHidden, () => true)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const themeNow = await themeOf($, settings)
    const p = PALETTES[themeNow]
    const current = await read($, dashboard)
    const now = await $.clock.now()
    const usage = await usageOf($)
    const working = await read($, isWorking)
    const flamingoFrame = await read($, frame)
    const hours = Math.round(settings.windowMs / 3_600_000)
    const needs = attention(current, now, settings.windowMs)
    const rows = components(current.activity)
    const runs = recentRuns(current.platform.runs, now, settings.windowMs)
    const feed = current.activity.slice(-6).reverse()
    const all = spends(current.activity)
    const width = Math.max(30, (e.viewport?.columns ?? 64) - 2)
    const trail = current.activity
      .slice(-24)
      .map(a => all.get(a.id)?.tokens ?? 0)
    const last = feed[0] && all.get(feed[0].id)

    // Every Text carries the pane's colors, so it reads the same on any terminal.
    const t = (text: string, style: { color?: string; bold?: boolean; bg?: string } = {}) => (
      <Text color={style.color ?? p.text} backgroundColor={style.bg ?? p.bg} bold={style.bold}>
        {text}
      </Text>
    )
    const icon = (level: Level) => (
      <Text color={STATUS[level].color} backgroundColor={p.bg} bold>
        {STATUS[level].icon}
      </Text>
    )
    const heading = (text: string, aside?: string) => (
      <Box marginTop={1}>
        {t('◇ ', { color: p.rule, bold: true })}
        {t(text.toUpperCase(), { color: p.heading, bold: true })}
        {aside ? t(`  ${aside}`, { color: p.muted }) : undefined}
      </Box>
    )
    const note = (text: string) => t(text, { color: p.muted })
    const line = (level: Level, text: string, aside?: string) => (
      <Box justifyContent="space-between">
        <Box flexShrink={1}>
          <Text backgroundColor={p.bg} wrap="truncate-end">
            {icon(level)}
            {t(` ${text}`)}
          </Text>
        </Box>
        {aside ? <Box flexShrink={0}>{t(`  ${aside}`, { color: p.muted })}</Box> : undefined}
      </Box>
    )
    const gauge = (label: string, value: string, note?: string) => (
      <Box flexDirection="column" borderStyle="round" borderColor={p.rule} backgroundColor={p.bg} paddingX={1} flexGrow={1} minWidth={14}>
        {t(label, { color: p.muted, bold: true })}
        {t(value, { color: p.accent, bold: true })}
        {note ? t(note, { color: p.muted }) : t(' ')}
      </Box>
    )

    const status = working ? '● WORKING' : '◇ IDLE'
    const session = usage.startedAt === undefined ? undefined : `session ${duration(now - usage.startedAt)}`

    return (
      <Box flexDirection="column" backgroundColor={p.bg} paddingX={1} minHeight={e.viewport?.rows} width="100%">
        <Box justifyContent="space-between" backgroundColor={p.band ?? p.bg} paddingX={1}>
          {t('◆ BOOMI COMPANION DASHBOARD ◆', { color: p.bandText, bold: true, bg: p.band })}
          {t(status, { color: p.bandText, bold: true, bg: p.band })}
        </Box>
        <Box justifyContent="space-between" flexWrap="wrap">
          {t(
            [session, `${rows.length} component${rows.length === 1 ? '' : 's'}`, usage.model].filter(Boolean).join(' · '),
            { color: p.muted },
          )}
          <Box>
            {t('Theme ', { color: p.muted })}
            {THEMES.map(name => (
              <Button key={`theme-${name}`} label={name === themeNow ? `◆ ${THEME_NAMES[name]}` : THEME_NAMES[name]} onPress={() => pickTheme($, name)} />
            ))}
          </Box>
        </Box>
        {t(decoRule(width), { color: p.rule })}

        <Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Box flexWrap="wrap" columnGap={1}>
              {gauge(
                'TOKENS',
                usage.tokens ? formatTokens(usage.tokens) : '—',
                [last?.tokens ? `last step ${formatTokens(last.tokens)}` : undefined, usage.cached ? `+${formatTokens(usage.cached)} cached` : undefined]
                  .filter(Boolean)
                  .join(' · ') || undefined,
              )}
              {gauge('SPEND', formatCost(usage.usd) ?? '—', last?.usd ? `last step ${formatCost(last.usd)}` : undefined)}
              {gauge(
                'CONTEXT',
                usage.contextPercent === undefined ? '—' : `${meter(usage.contextPercent, 8)} ${Math.round(usage.contextPercent)}%`,
              )}
            </Box>
            {sparkline(trail) && (
              <Box>
                {t('tokens per step ', { color: p.muted })}
                {t(sparkline(trail), { color: p.accent })}
              </Box>
            )}
          </Box>
          {settings.hasFlamingo && (
            <Box flexDirection="column" flexShrink={0} marginLeft={1}>
              {(() => {
                const view = flamingoView(working, flamingoFrame)
                const pad = (n: number) => (n > 0 ? <Text backgroundColor={p.bg}>{' '.repeat(n)}</Text> : undefined)
                return pixelCells(view.pixels, { P: p.bird, L: '#F7A8C4', K: '#0B0B0B' }).map(row => (
                  <Text backgroundColor={p.bg}>
                    {pad(view.offset)}
                    {row.map(cell => (
                      <Text color={cell.color} backgroundColor={cell.bg ?? p.bg}>
                        {cell.char}
                      </Text>
                    ))}
                    {pad(FLAMINGO_TRAVEL - view.offset)}
                  </Text>
                ))
              })()}
            </Box>
          )}
        </Box>

        {heading('Needs attention')}
        {needs.length === 0 && line('healthy', 'All clear.')}
        {needs.map(n => (
          <Box flexDirection="column">
            {line(n.level, n.title, ago(n.at, now))}
            {t(`  ${n.hint}`, { color: p.muted })}
          </Box>
        ))}

        {heading('Components this session')}
        {rows.length === 0 && t('Components show up here as Claude edits, saves, deploys and tests them.', { color: p.muted })}
        {rows.slice(0, 8).map(row => {
          const spent = formatSpend(spendOf(row.ids, all))
          return (
            <Box flexDirection="column">
              <Box justifyContent="space-between">
                <Box flexShrink={1}>
                  <Text backgroundColor={p.bg} wrap="truncate-end">
                    {t(row.name, { bold: true })}
                    {friendlyType(row.type) ? t(`  ${friendlyType(row.type)}`, { color: p.muted }) : undefined}
                  </Text>
                </Box>
                {spent ? <Box flexShrink={0}>{t(`  ${spent}`, { color: p.muted })}</Box> : undefined}
              </Box>
              <Text backgroundColor={p.bg}>
                {t('  ')}
                {stages(row).map(s => (
                  <Text backgroundColor={p.bg}>
                    {icon(s.level)}
                    {t(` ${s.text}   `)}
                  </Text>
                ))}
              </Text>
            </Box>
          )
        })}
        {rows.length > 8 && t(`…and ${rows.length - 8} more: /bc-dashboard lists them all.`, { color: p.muted })}

        {feed.length > 0 && heading("Claude's latest steps")}
        {feed.length > 0 && note('What Claude just did with Companion, newest first, and the tokens each step took.')}
        {feed.map(a => {
          const spent = all.get(a.id)?.tokens
          return line(levelOf(a), describe(a), [ago(a.endedAt ?? a.startedAt, now), spent ? `${formatTokens(spent)} tok` : undefined].filter(Boolean).join(' · '))
        })}

        {heading('Process runs in Boomi', `last ${hours}h`)}
        {note("Every execution in your Boomi environment: this session's tests, schedules and other people's runs.")}
        {current.platform.phase !== 'ok' && line(current.platform.phase === 'error' ? 'serious' : 'warning', current.platform.message)}
        {current.platform.phase === 'ok' && runs.length === 0 && line('healthy', `No process ran in the last ${hours}h.`)}
        {current.platform.phase === 'ok' && runs.slice(0, 6).map(run => line(runLevel(run), runText(run, now)))}

        {current.watched.length > 0 && heading('Watched components')}
        {current.watched.length > 0 && note('Flagged when someone other than Companion changes one in Boomi.')}
        {current.watched.map(w => line(watchedLevel(w), watchedText(w)))}
      </Box>
    )
  })
}
