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

import type { Activity, CompanionPlugin, Dashboard, DiagnosisState, HistoryState, Ledger, PaneTheme, PastSession, Platform, RuntimeSeen, SessionRecap, StandardsSeen, Watched } from '../types'
import {
  EMPTY_LEDGER,
  STATUS,
  ago,
  duration,
  attention,
  closeItem,
  closedCount,
  diagnose,
  fixPrompt,
  report,
  pastSessions,
  pastParts,
  projectsDiffer,
  historySummary,
  historyTotals,
  guardrails,
  guardrailText,
  budgetOf,
  nextStep,
  compareWatched,
  componentOf,
  componentPath,
  components,
  describe,
  formatCost,
  formatSpend,
  formatTokens,
  assignResults,
  parseResults,
  friendlyType,
  githubUrl,
  headline,
  sceneAt,
  sceneRows,
  levelOf,
  meter,
  modelMix,
  modelName,
  modelSplits,
  pixelCells,
  pondRows,
  readOutput,
  recentRuns,
  reopenAll,
  restoredNote,
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
  choicesOf,
  choiceFrom,
  choiceLabel,
  choiceList,
  recapOf,
  welcomeLine,
  tipsFor,
  quarantineLines,
  agents,
  agentStages,
  connectors,
  connectorStages,
  agentName,
  agentOfDeployment,
  budgetLines,
  shareView,
  monthSpend,
  monthView,
  monthOf,
  dayOf,
  pruneDays,
  limitViews,
  limitsShort,
  earlierLabel,
  productSpendLine,
  resumable,
  resumeCommand,
  resumeLabel,
  parseActivityLog,
  newLogSteps,
} from './activity'
import type { Attention, Level, Reading, ScriptRun, SharePeriod, Usage } from './activity'
import { credentialsFrom, parseEnv, platformClient } from './platform'
import { agentstudioReading, bdiRunId, connectordevReading, bdiRunReading, bdiStatusChecks, causeWords, datahubDeployReading, datahubStatusChecks, deployState, quarantineChecks, quarantineReading, recipeComponents } from './products'
import { reportHtml } from './report-html'
import { hasComponents, isInstalled, pluginsFromFiles, pluginsFromList } from './plugins'
import { RESTART, checkText, compareVersions, isCheckDue, parseUpgrade, planText } from './upgrade'
import type { UpgradeReport } from './upgrade'
import { reviewLabel, reviewPrompt, reviewSession, reviewText } from './review'
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

/** Which line the banner shows while a new session hasn't worked with Companion yet: the recap, then the tips. */
const tip = atom({ plugin: 'boomi-dashboard', key: 'tip' } as const, 0)

/** What the last session in this folder did with Companion, for the banner. */
const recap = atom({ plugin: 'boomi-dashboard', key: 'recap' } as const, null as SessionRecap | null)

/** Whether the session runs in a Companion workspace: the banner only greets there. */
const isCompanionFolder = atom({ plugin: 'boomi-dashboard', key: 'isCompanionFolder' } as const, false)

/** The Boomi Companion plugins on in this session, read once at its start; null until then, or when Claude Code's list can't be read. */
const companionPlugins = atom({ plugin: 'boomi-dashboard', key: 'companionPlugins' } as const, null as CompanionPlugin[] | null)

/** What each failed execution's log says, by execution ID, once someone asks Why?. */
const diagnoses = atom({ plugin: 'boomi-dashboard', key: 'diagnoses' } as const, {} as Record<string, DiagnosisState>)

/** The tick the flamingo's scene last changed at: the pane draws sceneAt(it). */
const frame = atom({ plugin: 'boomi-dashboard', key: 'frame' } as const, 0)

/** Half-second ticks since the mod loaded, for the flamingo's scene. */
let sceneTick = 0

/**
 * Companion's share of the weekly limit: how far Companion sessions on this
 * machine moved it, by day (kept across sessions in the store), and this
 * session's baseline, the weekly limit when it first worked with Companion,
 * with how much of its movement is counted already.
 */
const share = atom(
  { plugin: 'boomi-dashboard', key: 'share' } as const,
  null as { days: Record<string, number>; baseline?: { resetsAt?: string; percent: number }; counted: number } | null,
)

/** Where Companion's daily movement of the weekly limit is kept. */
const SHARE_KEY = 'shareDays'

/** Each usage-limit window's last warning (80 or 100), by its kind and reset time, so each is toasted once. */
const limitAlerts = atom({ plugin: 'boomi-dashboard', key: 'limitAlerts' } as const, {} as Record<string, number>)

/** The budget's last warning, as a percent (0, 80 or 100), so each is toasted once. */
const budgetAlert = atom({ plugin: 'boomi-dashboard', key: 'budgetAlert' } as const, 0)

/** Past Companion sessions on this machine, from the last scan of the transcripts. */
const history = atom({ plugin: 'boomi-dashboard', key: 'history' } as const, { phase: 'idle' } as HistoryState)

/** How many of Claude's latest steps the pane lists: More adds a page, Fewer goes back to one. */
const STEPS_PAGE = 6
const stepsShown = atom({ plugin: 'boomi-dashboard', key: 'stepsShown' } as const, STEPS_PAGE)

/** The past session whose cost review is open in the pane. */
const reviewing = atom({ plugin: 'boomi-dashboard', key: 'reviewing' } as const, null as string | null)

/** The past session whose resume command was last copied, and whether the copy took. */
const copied = atom({ plugin: 'boomi-dashboard', key: 'copied' } as const, null as { id: string; isCopied: boolean } | null)

/** How many past sessions the pane lists: More adds a page, Fewer goes back to one. */
const PAST_PAGE = 5
const historyShown = atom({ plugin: 'boomi-dashboard', key: 'historyShown' } as const, PAST_PAGE)

/** The next step last suggested in the prompt box, so it isn't suggested after every turn. */
const suggested = atom({ plugin: 'boomi-dashboard', key: 'suggested' } as const, '')

type Settings = {
  envFile: string
  componentsDir: string
  pollSeconds: number
  windowMs: number
  paneTheme: PaneTheme
  isToasting: boolean
  isBanded: boolean
  hasFlamingo: boolean
  budgetUsd: number
  isSuggesting: boolean
  historyDays: number
  isReadingLog: boolean
  companionShare: number
  companionSharePeriod: SharePeriod
  companionMonthlyUsd: number
  paneRows: number
  paneColumns: number
  isCheckingUpdates: boolean
  updateCheckHours: number
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
  budgetUsd: Math.max(0, Number(options.budgetUsd ?? 0) || 0),
  isSuggesting: options.suggestions !== false,
  historyDays: Math.max(1, Number(options.historyDays ?? 90) || 90),
  isReadingLog: options.activityLog !== false,
  companionShare: Math.min(100, Math.max(0, Number(options.companionShare ?? 0) || 0)),
  companionSharePeriod: options.companionSharePeriod === 'day' || options.companionSharePeriod === 'month' ? options.companionSharePeriod : 'week',
  companionMonthlyUsd: Math.max(0, Number(options.companionMonthlyUsd ?? 0) || 0),
  paneRows: Math.max(0, Math.round(Number(options.paneRows ?? 0) || 0)),
  paneColumns: Math.max(0, Math.round(Number(options.paneColumns ?? 0) || 0)),
  isCheckingUpdates: options.updateCheck !== false,
  updateCheckHours: Math.max(0, Number(options.updateCheckHours ?? 24) || 0),
})

const PANE = 'boomi-dashboard'
const WATCH_KEY = 'watched'
const SCRIPTS_KEY = 'scriptsDir'
const THEME_KEY = 'theme'
const HISTORY_KEY = 'history'
const UPGRADE_KEY = 'upgradeCheckedAt'

/** How often the flamingo's frame moves on while Claude works. */
const FLAMINGO_TICK_MS = 500

/** How long the banner shows each line of a new session's recap and tips. */
const TIP_MS = 20_000

/** How often Companion's activity log is checked for steps Claude's tool calls didn't show. */
const LOG_CHECK_MS = 10_000

/** Companion's activity log, relative to the workspace, where its scripts write it. */
const ACTIVITY_LOG = '.activity-log/activity.jsonl'

const THEMES: readonly PaneTheme[] = ['day', 'night', 'terminal']
const THEME_NAMES: Record<PaneTheme, string> = { day: 'Day', night: 'Night', terminal: 'Terminal' }

const isTheme = (value: unknown): value is PaneTheme => THEMES.includes(value as PaneTheme)
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The pane's size, picked with /bc-dashboard size and kept; until then the settings'. 0 leaves it to Claude Code. */
const paneSize = atom({ plugin: 'boomi-dashboard', key: 'paneSize' } as const, null as { rows: number; columns: number } | null)
const SIZE_KEY = 'paneSize'

/**
 * The size the pane asks for as it opens: rows when it sits above the prompt,
 * columns when it's docked beside a fullscreen transcript. A request: a size
 * the person dragged it to wins.
 */
const sizeOf = async ($: Engine, settings: Settings) => {
  const picked = await read($, paneSize)
  const rows = picked?.rows ?? settings.paneRows
  const columns = picked?.columns ?? settings.paneColumns
  return { ...(rows > 0 ? { rows } : {}), ...(columns > 0 ? { columns } : {}) }
}

// The pane is a convenience: a surface that cannot seat one must not stop the work.
const openPane = async ($: Engine, settings: Settings) => {
  const size = await sizeOf($, settings).catch(() => ({}))
  $.ui.open({ id: PANE, title: 'Boomi Companion Dashboard', ...size }).catch(() => undefined)
}

/** /bc-dashboard size <rows> [columns]: the pane's size, now and for later sessions; with no numbers, back to the default. */
const resize = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  const [rows = '', columns = ''] = target.split(/\s+/).filter(Boolean)
  if (!rows) {
    await update($, paneSize, () => null)
    await $.store.delete(SIZE_KEY).catch(() => undefined)
    return 'The dashboard pane is back to its usual size. Drag its edge to resize it by hand.'
  }
  const r = Number(rows)
  const c = columns ? Number(columns) : 0
  if (!Number.isInteger(r) || r < 8 || r > 200 || (columns && (!Number.isInteger(c) || c < 40 || c > 400))) {
    return 'Usage: /bc-dashboard size <rows 8-200> [columns 40-400]. With nothing after size, back to the default.'
  }
  const size = { rows: r, columns: c }
  await update($, paneSize, () => size)
  await $.store.set(SIZE_KEY, size).catch(() => undefined)
  await $.ui.open({ id: PANE, title: 'Boomi Companion Dashboard', focus: true, closeOnEscape: true, ...(await sizeOf($, settings)) }).catch(() => undefined)
  return `The dashboard pane asks for ${r} rows${c ? ` and ${c} columns` : ''}, now and in later sessions. A size you drag it to wins.`
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
    const limits = usage.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, ...(r.resetsAt ? { resetsAt: r.resetsAt } : {}) }))
    return { usd: usage.cost?.usd, contextPercent: usage.context.percent, tokens, cached, startedAt: usage.startedAt, limits, now: await $.clock.now(), ...models }
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
  const read0 = { ...(await usageOf($)), budgetUsd: settings.budgetUsd }
  const usage = { ...read0, companion: await companionBudget($, settings, read0) }
  $.ui.status(statusLine(await read($, dashboard), now, settings.windowMs, usage, (await read($, recap)) ?? undefined))
  await warnBudget($, settings, usage.usd)
  await warnLimits($, settings, usage)
  await trackShare($, settings, usage)
  await warnCompanion($, settings, usage)
}

/**
 * Counts Companion's movement of the weekly limit: from the session's first
 * Companion step, each rise of the limit is added to the day it happened on,
 * so a share can run per day, week or month. A window that resets starts the
 * count again from zero.
 */
const trackShare = async ($: Engine, settings: Settings, usage: Usage) => {
  if (!settings.companionShare) return
  const weekly = usage.limits?.find(l => l.kind === 'seven_day')
  if (!weekly) return
  try {
    const now = usage.now ?? (await $.clock.now())
    const current = await read($, share)
    let days = current?.days ?? (((await $.store.get(SHARE_KEY)) as Record<string, number> | undefined) ?? {})
    let baseline = current?.baseline
    let counted = current?.counted ?? 0
    if ((await read($, dashboard)).activity.some(a => !a.isRestored)) {
      if (!baseline) baseline = { resetsAt: weekly.resetsAt, percent: weekly.percentUsed }
      if (baseline.resetsAt !== weekly.resetsAt) {
        baseline = { resetsAt: weekly.resetsAt, percent: 0 }
        counted = 0
      }
      const moved = Math.max(0, weekly.percentUsed - baseline.percent)
      const rise = Math.round((moved - counted) * 10) / 10
      if (rise >= 0.1) {
        const today = dayOf(now)
        days = pruneDays({ ...days, [today]: Math.round(((days[today] ?? 0) + rise) * 10) / 10 }, now)
        counted = Math.round((counted + rise) * 10) / 10
        await $.store.set(SHARE_KEY, days)
      }
    }
    const next = { days, counted, ...(baseline ? { baseline } : {}) }
    if (JSON.stringify(next) !== JSON.stringify(current)) await update($, share, () => next)
  } catch {}
}

/** Where Companion stands against the person's own budget, for the views. */
const companionBudget = async ($: Engine, settings: Settings, usage: Usage): Promise<Usage['companion']> => {
  const week = shareView((await read($, share))?.days, settings.companionShare, settings.companionSharePeriod, usage.now ?? (await $.clock.now()))
  const month = settings.companionMonthlyUsd
    ? monthView(monthSpend((await read($, history)).sessions, usage.now ?? (await $.clock.now()), await $.session.id().catch(() => undefined), usage.usd), settings.companionMonthlyUsd)
    : undefined
  return week || month ? { ...(week ? { week } : {}), ...(month ? { month } : {}) } : undefined
}

/** Toasts once as Companion passes 80% of its budget, and once when it's spent, per week and per month. */
const warnCompanion = async ($: Engine, settings: Settings, usage: Usage) => {
  const budget = await companionBudget($, settings, usage)
  const now = usage.now ?? (await $.clock.now())
  for (const [key, b] of [
    [`companion-share|${settings.companionSharePeriod}|${settings.companionSharePeriod === 'day' ? dayOf(now) : settings.companionSharePeriod === 'month' ? monthOf(now) : dayOf(now - (((new Date(now).getDay() + 6) % 7) * 86_400_000))}`, budget?.week],
    [`companion-month|${monthOf(now)}`, budget?.month],
  ] as const) {
    if (!b) continue
    const mark = b.percent >= 100 ? 100 : b.percent >= 80 ? 80 : 0
    if (mark === 0 || mark <= ((await read($, limitAlerts))[key] ?? 0)) continue
    await update($, limitAlerts, all => ({ ...all, [key]: mark }))
    toast($, settings, `${STATUS[b.level].icon} ${b.text}`)
  }
}

/** Toasts once as each usage-limit window passes 80%, and once when it's used up, per window until it resets. */
const warnLimits = async ($: Engine, settings: Settings, usage: Usage) => {
  for (const v of limitViews(usage.limits, usage.now ?? (await $.clock.now()))) {
    const mark = v.percent >= 100 ? 100 : v.percent >= 80 ? 80 : 0
    if (mark === 0) continue
    const key = `${v.kind}|${usage.limits?.find(l => l.kind === v.kind)?.resetsAt ?? ''}`
    if (mark <= ((await read($, limitAlerts))[key] ?? 0)) continue
    await update($, limitAlerts, all => ({ ...all, [key]: mark }))
    toast($, settings, `${STATUS[v.level].icon} ${mark >= 100 ? `Your ${v.name} Claude limit is used up` : `${Math.round(v.percent)}% of your ${v.name} Claude limit used`}${v.resetsIn ? `, resets in ${v.resetsIn}` : ''}`)
  }
}

/** Toasts once when the session passes 80% of its budget, and once when it's spent. */
const warnBudget = async ($: Engine, settings: Settings, usd: number | undefined) => {
  const left = budgetOf(usd, settings.budgetUsd)
  if (!left) return
  const mark = left.percent >= 100 ? 100 : left.percent >= 80 ? 80 : 0
  if (mark <= (await read($, budgetAlert))) return
  await update($, budgetAlert, () => mark)
  toast($, settings, `${STATUS[left.level].icon} Boomi session ${left.text}`)
}

const record = ($: Engine, change: (list: Activity[]) => Activity[]) =>
  update($, dashboard, current => ({ ...current, activity: change(current.activity).slice(-150) }))

/** Where this folder's activity is kept between sessions: one key per working directory. */
const activityKey = async ($: Engine) => `activity:${await $.session.cwd()}`

/**
 * Keeps the latest steps between sessions, so a restart (the one that loads
 * this mod, for one) doesn't empty the dashboard. Session state alone is
 * gone when the session ends.
 */
const saveActivity = async ($: Engine, settings: Settings) => {
  try {
    const current = await read($, dashboard)
    // Older steps not shown are kept too: the window is what shows, not what's saved.
    const shown = current.activity.filter(a => a.outcome !== 'running')
    const ids = new Set(shown.map(a => a.id))
    const list = [...(current.earlier ?? []).filter(a => !ids.has(a.id)), ...shown]
      .map(({ isRestored, isEarlier, ...a }) => a)
      .sort((a, b) => a.startedAt - b.startedAt)
    const { closedSteps, seenRuns } = current
    const now = await $.clock.now()
    // The recap is this session's once it has worked with Companion; until then the last one's stands.
    const last = recapOf(current, now, settings.windowMs, (await usageOf($)).usd) ?? (await read($, recap)) ?? undefined
    await $.store.set(await activityKey($), { savedAt: now, activity: list.slice(-KEPT_STEPS), closedSteps, seenRuns, recap: last })
  } catch {}
}

/**
 * At the start of a session with nothing yet, brings back this folder's steps
 * from the last window, and what the last session did, for the banner.
 */
const restoreActivity = async ($: Engine, settings: Settings) => {
  try {
    if ((await read($, dashboard)).activity.length > 0) return
    const saved = (await $.store.get(await activityKey($))) as
      | { activity?: Activity[]; closedSteps?: number[]; seenRuns?: string[]; recap?: SessionRecap }
      | undefined
    if (saved?.recap) await update($, recap, () => saved.recap!)
    const now = await $.clock.now()
    const all = saved?.activity ?? []
    idFloor = all.reduce((max, a) => Math.max(max, a.id), 0)
    const isRecent = (a: Activity) => now - (a.endedAt ?? a.startedAt) <= settings.windowMs
    const kept = all.filter(isRecent).map(a => ({ ...a, isRestored: true }))
    const earlier = all.filter(a => !isRecent(a)).map(a => ({ ...a, isRestored: true, isEarlier: true }))
    if (all.length === 0) return
    await update($, dashboard, c =>
      c.activity.length > 0
        ? c
        : { ...c, activity: kept, restored: kept.length, earlier, closedSteps: saved?.closedSteps, seenRuns: saved?.seenRuns },
    )
  } catch {}
}

/** The highest step ID this folder has kept, shown or not, so new steps never reuse one. */
let idFloor = 0

const nextId = (list: readonly Activity[]) => list.reduce((max, a) => Math.max(max, a.id), idFloor) + 1

/** How many steps a folder keeps across sessions, whatever their age. */
const KEPT_STEPS = 200

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
  if (run.product === 'agentstudio' && run.ref) {
    // A test conversation names its deployment; the deploy that made it names the agent.
    if (run.script === 'agentstudio-session') {
      const agentId = agentOfDeployment(current.activity, run.ref)
      return { subject: (agentId && agentName(current.activity, agentId)) || `deployment ${run.target}`, deploymentId: run.ref }
    }
    return { subject: agentName(current.activity, run.ref) ?? run.target ?? '' }
  }
  if (run.product) return { subject: run.target ?? '' }
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
    const args = run.kind === 'test' && run.args ? { args: run.args } : {}
    const product = run.product
      ? { product: run.product, verb: run.verb ?? '', ...(run.ref ? { ref: run.ref } : {}), ...(run.project ? { project: run.project } : {}), ...(run.group ? { group: run.group } : {}), ...(run.version ? { version: run.version } : {}) }
      : {}
    started.push({ id: id++, kind: run.kind, outcome: 'running', detail: 'running', startedAt, script: run.script, ...spent, ...found, ...args, ...product })
  }
  if (!current.activity.some(a => a.kind !== 'other' || a.product)) void openPane($, settings)
  void rememberScripts($, runs)
  await record($, list => [...list, ...started])
  void refreshStatus($, settings)
  return started
}

type Ran = { deny?: string; text?: string; result?: unknown; isError?: boolean }

/**
 * An Agentstudio step's response, when it was the command's only script run:
 * a new agent's ID and name, a package's version and the deployment
 * package-create --deploy or deploy made, a conversation's session. A 2xx
 * that says success: false failed. The reply's own words never rename the
 * step: an agent's answer may say anything.
 */
const readAgentstudio = (a: Activity, before: Activity, output: string) => {
  a.subject = before.subject
  if (!output) return
  const r = agentstudioReading(output)
  if (r.error && a.outcome === 'ok') {
    a.outcome = 'failed'
    a.detail = `ERROR: ${r.error}`.slice(0, 160)
  }
  if (a.outcome !== 'ok') return
  if (a.script === 'agentstudio-agent') {
    if (a.verb === 'create' && r.id) a.ref = r.id
    if (r.name) a.subject = r.name
    if (a.ref) a.detail = `agent ${a.ref}`
  } else if (a.script === 'agentstudio-deployment' && a.verb === 'package-create') {
    if (r.agentName) a.subject = r.agentName
    if (r.version) a.version = r.version
    if (r.deploymentId) a.deploymentId = r.deploymentId
    const pkg = r.packageId ?? r.id
    a.detail = [pkg ? `package ${pkg}` : 'packaged', r.version ? `v${r.version}` : '', r.deploymentId ? `deployed as ${r.deploymentId}` : ''].filter(Boolean).join(', ')
  } else if (a.script === 'agentstudio-deployment' && a.verb === 'deploy') {
    if (r.agentName) a.subject = r.agentName
    const deployment = r.deploymentId ?? r.id
    if (deployment) {
      a.deploymentId = deployment
      a.detail = `deployment ${deployment}`
    }
  } else if (a.script === 'agentstudio-session') {
    if (r.sessionId) a.sessionId = r.sessionId
    a.detail = r.sessionId ? `answered, session ${r.sessionId}` : 'answered'
  }
}

/**
 * A connector step's output: the version its words named (set, delete),
 * which the output never repeats; and, when it was the command's only
 * script run, an upload's new version ID, a version change's status, and
 * the line saying why a lint or doctor failed.
 */
const readConnectordev = (a: Activity, before: Activity, output: string) => {
  if (before.version) a.version = before.version
  if (!output || !a.script) return
  const r = connectordevReading(a.script, a.verb ?? '', output)
  if (r.detail && (a.outcome === 'failed') === r.detail.startsWith('ERROR:')) a.detail = r.detail.slice(0, 160)
  if (a.outcome !== 'ok') return
  if (r.versionId) {
    a.version = r.versionId
    a.detail = /^WARNING:/.test(a.detail) ? a.detail : `version ${r.versionId}`
  }
  if (r.status) {
    a.runStatus = r.status
    a.detail = `status ${r.status}`
  }
}

/** Reads how each run went from the command's output, or the refusal that stopped it. */
const noteEnd = async ($: Engine, settings: Settings, started: readonly Activity[], ran: Ran) => {
  if (started.length === 0) return
  const endedAt = await $.clock.now()
  const output = ran.deny === undefined ? outputOf(ran) : ''
  const isError = ran.isError === true
  // Each result in the output is one step: a loop over six components is six.
  const { first, extras } = assignResults(
    started.filter(a => a.kind !== 'other' && a.kind !== 'pull'),
    ran.deny === undefined ? parseResults(output) : [],
  )
  const done: Activity[] = []
  const added: Activity[] = []
  let id = nextId((await read($, dashboard)).activity)
  const finish = async (a: Activity, reading: Reading): Promise<Activity> => {
    // A create or pull writes the component's ID and name into its file.
    const path = a.file ?? reading.file
    const fresh = path && (a.kind === 'create' || a.kind === 'pull') ? await readComponent($, path) : {}
    const file = a.file ?? (reading.file ? componentPath(reading.file, settings.componentsDir) : undefined)
    return {
      ...a,
      ...(file ? { file } : {}),
      outcome: reading.outcome,
      detail: reading.detail,
      endedAt,
      subject: reading.name ?? fresh.name ?? a.subject,
      componentId: reading.componentId ?? fresh.componentId ?? a.componentId,
      type: fresh.type ?? a.type,
      version: reading.version,
      executionStatus: reading.executionStatus,
      executionId: reading.executionId,
    }
  }
  // A Marketplace install's copied components join the session's components, as from that recipe.
  const fromRecipes = (a: Activity) =>
    a.product === 'marketplace' && a.script === 'boomi-marketplace-install' && ran.deny === undefined
      ? recipeComponents(output).map(c => ({ ...c, recipe: a.subject }))
      : []
  for (const a of started) {
    if (ran.deny !== undefined) {
      done.push({ ...a, outcome: 'blocked', detail: ran.deny.split('\n')[0]!.slice(0, 160), endedAt })
      continue
    }
    done.push(await finish(a, first.get(a.id) ?? readOutput(a.kind, output, isError)))
    for (const extra of extras.get(a.id) ?? []) {
      // Another pass of the same script: its own component, not this run's file.
      added.push(await finish({ ...a, id: id++, file: undefined, componentId: undefined, subject: 'a component' }, extra))
    }
  }
  for (const a of done) {
    if (a.product === 'datahub' && a.verb === 'deploy' && a.outcome === 'ok') {
      const { deploymentId, status } = datahubDeployReading(output)
      if (deploymentId) a.runId = deploymentId
      if (status) a.runStatus = status
      if (deployState(status) === 'failed') {
        a.outcome = 'failed'
        a.detail = `ERROR: the deployment ended ${status}`
      } else if (deploymentId) a.detail = `deployment ${deploymentId}${status ? `: ${status}` : ''}`
    }
    if (a.product === 'connectordev' && ran.deny === undefined) readConnectordev(a, started.find(s => s.id === a.id)!, started.length === 1 ? output : '')
    if (a.product === 'agentstudio' && ran.deny === undefined) readAgentstudio(a, started.find(s => s.id === a.id)!, started.length === 1 ? output : '')
    if (a.product === 'bdi' && a.verb === 'run' && a.outcome === 'ok') {
      const runId = bdiRunId(output)
      if (runId) {
        a.runId = runId
        a.detail = `run ${runId}`
      }
    }
    const copied = a.outcome === 'ok' ? fromRecipes(a) : []
    if (copied.length > 0) a.detail = `${a.detail} · ${copied.length} component${copied.length === 1 ? '' : 's'}`
    for (const c of copied) {
      added.push({ id: id++, kind: 'create', outcome: 'ok', subject: c.componentId, detail: `installed from recipe ${c.recipe}`, startedAt: a.startedAt, endedAt: a.endedAt, componentId: c.componentId, recipe: c.recipe, ...(c.version ? { version: c.version } : {}) })
    }
  }
  await record($, list => [...list.map(a => done.find(d => d.id === a.id) ?? a), ...added])
  for (const a of [...done, ...added]) announce($, settings, a)
  void refreshStatus($, settings)
  void saveActivity($, settings)
}

/** A toast for what someone would want to hear about without looking. */
const announce = ($: Engine, settings: Settings, a: Activity) => {
  if (a.kind === 'other' || a.kind === 'pull') {
    if (a.outcome === 'failed' || a.outcome === 'blocked' || levelOf(a) === 'warning') toast($, settings, `${STATUS[levelOf(a)].icon} ${describe(a)}`)
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
  if (isFirst) void openPane($, settings)
  void refreshStatus($, settings)
  void saveActivity($, settings)
}

/**
 * Claude checking a BDI run with bdi-flow.sh status: what the check found
 * updates that run's step, so a run that started shows how it ended without
 * the dashboard calling BDI itself. A failure needs attention with BDI's
 * reason; a cancelled run is cancelled, not failed.
 */
const followBdiRuns = async ($: Engine, settings: Settings, checks: readonly { flow: string; run: string }[], ran: Ran) => {
  if (ran.deny !== undefined) return
  const reading = bdiRunReading(outputOf(ran))
  if (!reading || checks.length !== 1) return
  const { flow, run } = checks[0]!
  let changed: Activity | undefined
  await update($, dashboard, c => {
    const list = [...c.activity]
    const at = list.map(a => a.product === 'bdi' && a.verb === 'run' && (a.runId === run || (!a.runId && a.ref === flow))).lastIndexOf(true)
    if (at < 0 || list[at]!.runStatus === reading.status) return c
    const step = list[at]!
    changed = {
      ...step,
      runId: step.runId ?? run,
      runStatus: reading.status,
      outcome: reading.status === 'failed' ? 'failed' : 'ok',
      detail: reading.status === 'failed' ? `ERROR: ${reading.reason ?? 'the run failed'} (run ${run})` : `run ${run}: ${reading.status}`,
    }
    list[at] = changed
    return { ...c, activity: list }
  })
  if (changed && (changed.runStatus === 'failed' || changed.runStatus === 'succeeded')) announce($, settings, { ...changed, kind: 'test' })
  if (changed) {
    void refreshStatus($, settings)
    void saveActivity($, settings)
  }
}

/**
 * Claude checking a Data Hub deployment with datahub-deployment.sh status: the
 * status it found updates that deploy's step, until it's done or failed.
 */
const followDeploys = async ($: Engine, settings: Settings, checks: readonly { universe: string; deployment: string }[], ran: Ran) => {
  if (ran.deny !== undefined || checks.length !== 1) return
  const status = datahubDeployReading(outputOf(ran)).status
  const state = deployState(status)
  if (!state) return
  const { universe, deployment } = checks[0]!
  let changed: Activity | undefined
  await update($, dashboard, c => {
    const list = [...c.activity]
    const at = list.map(a => a.product === 'datahub' && a.verb === 'deploy' && (a.runId === deployment || a.ref === universe)).lastIndexOf(true)
    if (at < 0 || list[at]!.runStatus === status) return c
    const step = list[at]!
    changed = {
      ...step,
      runId: step.runId ?? deployment,
      runStatus: status,
      outcome: state === 'failed' ? 'failed' : 'ok',
      detail: state === 'failed' ? `ERROR: the deployment ended ${status} (deployment ${deployment})` : `deployment ${deployment}: ${status}`,
    }
    list[at] = changed
    return { ...c, activity: list }
  })
  if (changed && state !== 'pending') announce($, settings, { ...changed, kind: 'test' })
  if (changed) {
    void refreshStatus($, settings)
    void saveActivity($, settings)
  }
}

/**
 * Claude listing a universe's quarantine with datahub-quarantine.sh query:
 * with no filter, that's every active entry, so the dashboard keeps the
 * count, the causes and the first reason. More than before is toasted;
 * an empty list clears it.
 */
const followQuarantine = async ($: Engine, settings: Settings, checks: readonly { universe: string; isAll: boolean }[], ran: Ran) => {
  if (ran.deny !== undefined || checks.length !== 1 || !checks[0]!.isAll) return
  const entries = quarantineReading(outputOf(ran))
  if (!entries) return
  const universe = checks[0]!.universe
  const before = (await read($, dashboard)).quarantine?.[universe]
  const now = await $.clock.now()
  const seen = entries.length === 0 ? 0 : Math.min(before?.seen ?? 0, entries.length)
  await update($, dashboard, c => ({
    ...c,
    quarantine: {
      ...c.quarantine,
      [universe]: { count: entries.length, causes: causeWords(entries), ...(entries[0]?.reason ? { reason: entries[0].reason } : {}), checkedAt: now, seen },
    },
  }))
  if (entries.length > (before?.count ?? 0)) {
    toast($, settings, `${STATUS.warning.icon} Data Hub: ${entries.length} record${entries.length === 1 ? '' : 's'} in quarantine (${causeWords(entries)})`)
  }
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

/**
 * Checks the watched components' versions in Boomi and toasts a change by
 * someone else. No Platform API call while nothing is watched. (Up to 0.10.0
 * this also read the environment's process runs; that's set aside for now,
 * see IDEAS.md.)
 */
const poll = async ($: Engine, settings: Settings): Promise<void> => {
  if (isPolling || (await read($, dashboard)).watched.length === 0) return
  isPolling = true
  try {
    const checkedAt = await $.clock.now()
    const loaded = await loadCredentials($, settings)
    if (typeof loaded === 'string') {
      await update($, dashboard, c => ({ ...c, platform: { ...OFF, message: loaded, checkedAt } }))
      return
    }
    const client = platformClient((url, init) => $.http.fetch(url, init), loaded)
    const before = await read($, dashboard)
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
      platform: { phase: 'ok' as const, message: 'Connected.', checkedAt, runs: [] },
      watched: c.watched.map(w => watched.find(fresh => fresh.componentId === w.componentId) ?? w),
    }))
  } finally {
    isPolling = false
  }
}

// --- Companion's activity log ------------------------------------------------

/** The log's size and time when it was last read, so an unchanged log isn't read again. */
let logSeen = ''

/** Over this, only the log's tail is read, through tail(1): a mod's one read is capped at 4 MiB. */
const LOG_READ_MAX = 3_500_000

/**
 * Reads Companion's activity log, when its scripts write one
 * (BOOMI_COMPANION_LOG_ACTIVITY=1), and adds the steps Claude's tool calls
 * didn't show: a script run in a terminal, by another tool, or before this
 * mod loaded. Steps the dashboard already has are matched and left alone.
 */
const readActivityLog = async ($: Engine, settings: Settings) => {
  if (!settings.isReadingLog) return
  try {
    const path = `${await $.session.cwd()}/${ACTIVITY_LOG}`
    const stat = await $.fs.stat(path).catch(() => undefined)
    if (!stat || stat.kind !== 'file') return
    const seenNow = `${stat.size}:${stat.mtimeMs}`
    if (seenNow === logSeen) return
    const text =
      stat.size <= LOG_READ_MAX
        ? String(await $.fs.read(path))
        : (await $.process.run(['tail', '-c', String(LOG_READ_MAX), path], { timeoutMs: 10_000 })).stdout
    const now = await $.clock.now()
    const usage = await usageOf($)
    const steps = newLogSteps(parseActivityLog(text), (await read($, dashboard)).activity, {
      now,
      windowMs: settings.windowMs,
      sessionStart: usage.startedAt ?? now,
      componentsDir: settings.componentsDir,
    })
    logSeen = seenNow
    if (steps.length === 0) return
    let added: Activity[] = []
    await update($, dashboard, c => {
      // A step's logKey keeps it from being added twice, however reads overlap.
      const keys = new Set(c.activity.map(a => a.logKey))
      let id = nextId(c.activity)
      added = steps.filter(step => !keys.has(step.logKey)).map(step => ({ ...step, id: id++ }))
      return { ...c, activity: [...c.activity, ...added].sort((a, b) => a.startedAt - b.startedAt).slice(-150) }
    })
    for (const a of added) if (!a.isRestored) announce($, settings, a)
    if (added.length > 0) {
      void refreshStatus($, settings)
      void saveActivity($, settings)
    }
  } catch {}
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
  const changed = (await read($, dashboard)).watched.filter(w => w.changedBy).length
  await update($, dashboard, c => ({ ...c, watched: c.watched.map(w => ({ ...w, changedBy: undefined })) }))
  return `Marked as seen: ${changed} watched change${changed === 1 ? '' : 's'}. They leave Needs attention.`
}

// --- Which Companion plugins are installed ----------------------------------------

/**
 * The Companion plugins on in this session: what `claude plugin list --json`
 * says for the session's folder, else Claude Code's own files under its config
 * folder. Null when neither can be read, so nothing is hidden on a guess.
 */
const findPlugins = async ($: Engine): Promise<CompanionPlugin[] | null> => {
  const cwd = await $.session.cwd()
  const listed = await $.process.run(['claude', 'plugin', 'list', '--json'], { cwd, timeoutMs: 20_000 }).catch(() => undefined)
  const fromList = listed?.exitCode === 0 ? pluginsFromList(listed.stdout) : undefined
  if (fromList) return fromList
  const home = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) || `${(await $.env.get('HOME').catch(() => undefined)) ?? ''}/.claude`
  const text = (path: string) => $.fs.read(path).then(String).catch(() => undefined)
  const installed = await text(`${home}/plugins/installed_plugins.json`)
  const synced: string[] = []
  const syncedRoot = `${home}/plugins/synced`
  for (const bucket of await $.fs.list(syncedRoot).catch(() => [])) {
    for (const plugin of await $.fs.list(`${syncedRoot}/${bucket.name}`).catch(() => [])) {
      const manifest = await text(`${syncedRoot}/${bucket.name}/${plugin.name}/.claude-plugin/plugin.json`)
      if (manifest) synced.push(manifest)
    }
  }
  if (installed === undefined && synced.length === 0) return null
  const settings = await Promise.all([`${cwd}/.claude/settings.local.json`, `${cwd}/.claude/settings.json`, `${home}/settings.json`].map(text))
  return pluginsFromFiles(installed, settings, synced, cwd)
}

const notePlugins = async ($: Engine) => {
  const found = await findPlugins($).catch(() => null)
  await update($, companionPlugins, () => found)
}

// --- Why a run failed ------------------------------------------------------------

/** Notes where Companion's scripts are, from a command that ran one by its path. */
const rememberScripts = async ($: Engine, runs: readonly ScriptRun[]) => {
  const dir = runs.find(run => run.scriptsDir)?.scriptsDir
  if (!dir) return
  const absolute = dir.startsWith('/') ? dir : `${await $.session.cwd()}/${dir}`
  await $.store.set(SCRIPTS_KEY, absolute).catch(() => undefined)
}

/**
 * Companion's scripts folder: the one Claude last ran a script from, else the
 * newest bc-integration in the plugin cache. Undefined when neither is there.
 */
const findScripts = async ($: Engine): Promise<string | undefined> => {
  const known = await $.store.get(SCRIPTS_KEY).catch(() => undefined)
  if (typeof known === 'string' && (await $.fs.exists(`${known}/boomi-execution-query.sh`).catch(() => false))) return known
  const found = await $.process
    .run(['bash', '-c', 'ls -d "$HOME"/.claude/plugins/cache/*/bc-integration/*/skills/boomi-integration/scripts 2>/dev/null | sort -V | tail -1'], { timeoutMs: 10_000 })
    .catch(() => undefined)
  const dir = found?.stdout.trim()
  return dir ? dir : undefined
}

const setDiagnosis = ($: Engine, executionId: string, state: DiagnosisState) =>
  update($, diagnoses, all => ({ ...all, [executionId]: state }))

/**
 * Reads a failed execution's log with Companion's own boomi-execution-query.sh
 * --logs, run in the workspace so it finds Companion's .env, and keeps what the
 * log says went wrong. The API token never reaches the result: the script
 * doesn't print it, and any copy of it is masked anyway.
 */
const explain = async ($: Engine, settings: Settings, executionId: string): Promise<DiagnosisState> => {
  await setDiagnosis($, executionId, { phase: 'loading' })
  let state: DiagnosisState
  try {
    const scripts = await findScripts($)
    if (!scripts) {
      state = { phase: 'error', error: "Couldn't find Boomi Companion's scripts. Run any Companion script once, then try again." }
    } else {
      const ran = await $.process.run(['bash', `${scripts}/boomi-execution-query.sh`, '--execution-id', executionId, '--logs'], {
        cwd: await $.session.cwd(),
        timeoutMs: 240_000,
      })
      const loaded = await loadCredentials($, settings).catch(() => 'unavailable')
      const mask = (text: string) => (typeof loaded === 'string' || !loaded.apiToken ? text : text.split(loaded.apiToken).join('‹redacted›'))
      if (ran.exitCode !== 0) {
        const why = `${ran.stderr}\n${ran.stdout}`.split(/\r?\n/).find(line => /^ERROR:/.test(line.trim()))
        state = { phase: 'error', error: mask(why?.trim() ?? `The log script exited with ${ran.exitCode}.`) }
      } else {
        const found = diagnose(mask(ran.stdout))
        state = { phase: 'ready', lines: found.lines, severe: found.severe, warnings: found.warnings }
      }
    }
  } catch (error) {
    state = { phase: 'error', error: messageOf(error) }
  }
  await setDiagnosis($, executionId, state)
  return state
}

/** Puts a fix request for a failed execution in the prompt box, after whatever is typed there. */
const askToFix = async ($: Engine, title: string, executionId: string) => {
  const state = (await read($, diagnoses))[executionId]
  if (state?.phase !== 'ready') return
  const draft = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const text = fixPrompt(title, executionId, { lines: state.lines ?? [], severe: state.severe ?? 0, warnings: state.warnings ?? 0 })
  await $.prompt.fill({ text: draft.text.trim() ? `\n${text}` : text, mode: draft.text.trim() ? 'append' : 'replace' }).catch(() => undefined)
}

type Ask = { fits: (item: Attention) => boolean; none: string; question: string; header: string; command: string }

/**
 * The Needs attention item a command means: the one numbered, else the only
 * one it fits, else the person's pick in Claude Code's question dialog (up to
 * four, newest first; "Other" takes a number). Where no dialog can be shown,
 * or it's dismissed, the answer is the list to pick from by number.
 */
const pickItem = async ($: Engine, settings: Settings, target: string, ask: Ask): Promise<Attention | string> => {
  const now = await $.clock.now()
  const choices = choicesOf(attention(await read($, dashboard), now, settings.windowMs), ask.fits)
  if (choices.length === 0) return ask.none
  if (target) return choiceFrom(target, choices)?.item ?? `${target} isn't one of these.\n${choiceList(ask.question, choices, ask.command, now)}`
  if (choices.length === 1) return choices[0]!.item
  const shown = choices.slice(0, 4)
  const answer = await $.ui
    .ask(ask.question, { header: ask.header, options: shown.map(choiceLabel) })
    .catch(() => undefined)
  return (answer !== undefined && choiceFrom(answer, choices)?.item) || choiceList(ask.question, choices, ask.command, now)
}

/** /bc-dashboard why [number]: reads the log of a failed test or run under Needs attention. */
const whyByNumber = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  const item = await pickItem($, settings, target, {
    fits: n => n.executionId !== undefined,
    none: 'Nothing to look into: no failed test or run under Needs attention has a log to read.',
    question: 'Which failure should the dashboard read the log of?',
    header: 'Why?',
    command: '/bc-dashboard why',
  })
  if (typeof item === 'string') return item
  if (!item.executionId) return `${item.title} has no execution log to read.`
  const state = await explain($, settings, item.executionId)
  if (state.phase !== 'ready') return `Couldn't read the log of ${item.executionId}: ${state.error}`
  return [`${item.title} (execution ${item.executionId}):`, ...(state.lines ?? []).map(line => `  ${line}`)].join('\n')
}

/**
 * Runs a failed test again with the same arguments, through Companion's own
 * script, and records it as a new step: a pass clears the failure.
 */
const rerun = async ($: Engine, settings: Settings, stepId: number): Promise<string> => {
  const current = await read($, dashboard)
  const step = current.activity.find(a => a.id === stepId)
  if (!step?.args) return 'That test has no command to repeat.'
  if (current.activity.some(a => a.kind === 'test' && a.outcome === 'running' && a.componentId === step.componentId)) {
    return `A test of ${step.subject} is already running.`
  }
  const scripts = await findScripts($)
  if (!scripts) return "Couldn't find Boomi Companion's scripts. Run any Companion script once, then try again."
  const run: ScriptRun = { kind: 'test', args: step.args }
  if (step.componentId) run.processId = step.componentId
  const started = await noteStart($, settings, [run])
  let ran: Ran
  try {
    const result = await $.process.run(['bash', `${scripts}/boomi-test-execute.sh`, ...step.args], {
      cwd: await $.session.cwd(),
      timeoutMs: 600_000,
    })
    ran = { text: `${result.stdout}\n${result.stderr}`, isError: result.exitCode !== 0 }
  } catch (error) {
    ran = { text: `ERROR: ${messageOf(error)}`, isError: true }
  }
  await noteEnd($, settings, started, ran)
  const done = (await read($, dashboard)).activity.find(a => a.id === started[0]?.id)
  return done ? `${STATUS[levelOf(done)].icon} ${describe(done)}` : 'Ran the test again.'
}

/** /bc-dashboard rerun [number]: runs a failed test under Needs attention again. */
const rerunByNumber = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  const item = await pickItem($, settings, target, {
    fits: n => n.rerunId !== undefined,
    none: 'Nothing to run again: no failed test Claude ran is under Needs attention.',
    question: 'Which failed test should run again?',
    header: 'Run again',
    command: '/bc-dashboard rerun',
  })
  if (typeof item === 'string') return item
  if (item.rerunId === undefined) return `${item.title} isn't a test Claude ran, so there's nothing to run again.`
  return rerun($, settings, item.rerunId)
}

/** After Claude's turn, suggests the step a process still needs, once for each step. */
const suggestNext = async ($: Engine, settings: Settings) => {
  if (!settings.isSuggesting) return
  const text = nextStep((await read($, dashboard)).activity)
  if (!text || text === (await read($, suggested))) return
  await update($, suggested, () => text)
  await $.prompt.suggest({ text }).catch(() => undefined)
}

// --- Past sessions -----------------------------------------------------------------

/**
 * Reads the transcripts on this machine for past Companion sessions. A
 * transcript can be far over the 4 MiB a mod may read at once, so a script
 * reads them a line at a time and prints only each session's totals.
 */
const PERL_MISSING =
  'History needs Perl. macOS and most Linux have it; on Windows it comes with Git for Windows, in Git Bash. Install it, then try again.'

/**
 * Runs the scan script with Perl: first through bash, where Git for Windows
 * keeps its Perl on Windows (and where Companion's own scripts run), then
 * Perl on its own. Undefined when neither has Perl.
 */
const runScan = async ($: Engine, args: string[]) => {
  // Forward slashes: Git Bash's Perl reads C:/Users/... but not every backslash path.
  const script = `${$.plugin.root}/scripts/scan-sessions.pl`.replace(/\\/g, '/')
  const attempts = [
    ['bash', '-c', 'exec perl "$@"', 'scan-sessions', script, ...args],
    ['perl', script, ...args],
  ]
  for (const argv of attempts) {
    try {
      const ran = await $.process.run(argv, { timeoutMs: 300_000 })
      // 127: bash is there, Perl isn't.
      if (ran.exitCode !== 127) return ran
    } catch (error) {
      if (!/ENOENT|not found/i.test(messageOf(error))) throw error
    }
  }
  return undefined
}

/**
 * Reads the transcripts on this machine for past Companion sessions. A
 * transcript can be far over the 4 MiB a mod may read at once, so a script
 * reads them a line at a time and prints only each session's totals.
 */
const scanHistory = async ($: Engine, settings: Settings): Promise<HistoryState> => {
  await update($, history, (h): HistoryState => ({ ...h, phase: 'loading', error: undefined }))
  const now = await $.clock.now()
  let state: HistoryState
  try {
    const ran = await runScan($, ['--since', String(now - settings.historyDays * 86_400_000)])
    if (!ran) {
      state = { phase: 'error', error: PERL_MISSING }
    } else if (ran.exitCode !== 0) {
      const why = ran.stderr.split(/\r?\n/).find(line => line.trim()) ?? `exit ${ran.exitCode}`
      state = { phase: 'error', error: `The transcript scan failed: ${why.slice(0, 200)}` }
    } else if (ran.isStdoutTruncated) {
      state = { phase: 'error', error: 'Too many sessions to read at once. Lower the historyDays setting and try again.' }
    } else {
      const scan = JSON.parse(ran.stdout) as { sessions?: []; scanned?: number }
      state = { phase: 'ready', sessions: pastSessions(scan), scannedAt: now, scanned: scan.scanned }
      await $.store.set(HISTORY_KEY, { sessions: state.sessions, scannedAt: now, scanned: scan.scanned }).catch(() => undefined)
    }
  } catch (error) {
    state = { phase: 'error', error: messageOf(error) }
  }
  // A failed scan keeps the sessions from the last one that worked.
  await update($, history, h => (state.phase === 'error' ? { ...h, ...state } : state))
  return state
}

/** /bc-dashboard history: scans now, then lists the past sessions with their cost. */
const historyCommand = async ($: Engine, settings: Settings): Promise<string> => {
  const state = await scanHistory($, settings)
  if (state.phase === 'error') return state.error ?? 'The transcript scan failed.'
  return historySummary(state.sessions ?? [], await $.clock.now(), settings.historyDays, { currentId: await $.session.id().catch(() => undefined) })
}

/** Copies the command that reopens a past session, to paste in a new terminal; notes whether it took. */
const copyResume = async ($: Engine, s: PastSession, surface?: Parameters<Engine['ui']['copy']>[0]['surface']) => {
  const done = await $.ui.copy({ text: resumeCommand(s), ...(surface ? { surface } : {}) }).catch(() => ({ isCopied: false as const }))
  await update($, copied, () => ({ id: s.id, isCopied: done.isCopied }))
  return done.isCopied
}

/**
 * /bc-dashboard resume [number]: the command that reopens a past Companion
 * session in a new terminal, copied to the clipboard too. Without a number it
 * asks which, the four newest first, or lists them where it can't ask.
 */
const resumeCommandFor = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  if ((await read($, history)).sessions === undefined) await scanHistory($, settings)
  const sessions = (await read($, history)).sessions
  if (sessions === undefined) return (await read($, history)).error ?? 'The transcript scan failed.'
  const view = { currentId: await $.session.id().catch(() => undefined) }
  const list = resumable(sessions, view.currentId)
  if (list.length === 0) return `No earlier Companion sessions on this machine from the last ${settings.historyDays} days to reopen.`
  const listed = () =>
    ['Which session? Run /bc-dashboard resume <number>:', ...list.slice(0, 20).map((s, i) => `  ${resumeLabel(s, i + 1, view)}`)].join('\n')
  let picked: PastSession | undefined
  if (target) {
    picked = list[Number(target.replace(/^#/, '')) - 1]
    if (!picked) return `${target} isn't one of these.\n${listed()}`
  } else if (list.length === 1) {
    picked = list[0]
  } else {
    const labels = list.slice(0, 4).map((s, i) => resumeLabel(s, i + 1, view))
    const answer = await $.ui.ask('Which Companion session do you want to reopen?', { header: 'Resume', options: labels }).catch(() => undefined)
    const typed = answer?.trim().replace(/^#|\.$/g, '')
    picked = answer === undefined ? undefined : (list[labels.indexOf(answer)] ?? list[Number(typed) - 1])
    if (!picked) return listed()
  }
  if (!picked) return listed()
  const command = resumeCommand(picked)
  return (await copyResume($, picked))
    ? `Copied. Paste it into a new terminal to reopen that session:\n  ${command}`
    : `Run this in a new terminal to reopen that session:\n  ${command}`
}

/** Puts the request for Claude's closer look at a past session's cost in the prompt box, after whatever is typed there. */
const askToReview = async ($: Engine, s: PastSession) => {
  const draft = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const text = reviewPrompt(s)
  await $.prompt.fill({ text: draft.text.trim() ? `\n${text}` : text, mode: draft.text.trim() ? 'append' : 'replace' }).catch(() => undefined)
}

/**
 * /bc-dashboard review [number]: a past session's cost review, numbered as
 * Past Companion sessions lists them, newest first. Without a number it asks
 * which of the four costliest of the last 30 days, or lists them.
 */
const reviewCommand = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  if ((await read($, history)).sessions === undefined) await scanHistory($, settings)
  const sessions = (await read($, history)).sessions
  if (sessions === undefined) return (await read($, history)).error ?? 'The transcript scan failed.'
  if (sessions.length === 0) return `No Companion sessions on this machine from the last ${settings.historyDays} days to review.`
  const view = { currentId: await $.session.id().catch(() => undefined) }
  const numbered = sessions.map((s, i) => ({ s, n: i + 1 }))
  const listed = () => ['Which session? Run /bc-dashboard review <number>:', ...numbered.slice(0, 20).map(({ s, n }) => `  ${reviewLabel(s, n)}`)].join('\n')
  let picked: PastSession | undefined
  if (target) {
    picked = sessions[Number(target.replace(/^#/, '')) - 1]
    if (!picked) return `${target} isn't one of these.\n${listed()}`
  } else {
    const now = await $.clock.now()
    const costly = numbered
      .filter(({ s }) => s.startedAt && now - Date.parse(s.startedAt) <= 30 * 86_400_000)
      .sort((a, b) => (b.s.costUsd ?? 0) - (a.s.costUsd ?? 0))
      .slice(0, 4)
    if (costly.length === 1) picked = costly[0]!.s
    else if (costly.length > 1) {
      const labels = costly.map(({ s, n }) => reviewLabel(s, n))
      const answer = await $.ui.ask('Which session should the dashboard review?', { header: 'Review', options: labels }).catch(() => undefined)
      const typed = answer?.trim().replace(/^#|\.$/g, '')
      picked = answer === undefined ? undefined : (costly[labels.indexOf(answer)]?.s ?? sessions[Number(typed) - 1])
    }
    if (!picked) return listed()
  }
  return reviewText(picked, view)
}

// --- The session report ------------------------------------------------------------

const reportNow = async ($: Engine, settings: Settings) => {
  const now = await $.clock.now()
  const footer = await footerOf($)
  return report(
    await read($, dashboard),
    { session: footer.session, date: new Date(now).toISOString().slice(0, 10), repo: footer.repo, usage: await withBudget($, settings) },
    now,
    settings.windowMs,
  )
}

/** The dashboard's version, from its own plugin.json. */
const ownVersion = async ($: Engine): Promise<string | undefined> => {
  const json = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => undefined)
  return typeof json === 'string' ? json.match(/"version"\s*:\s*"([^"]+)"/)?.[1] : undefined
}

/**
 * /bc-dashboard report html: the report as one HTML file in the workspace, to
 * open in a browser or send to someone: Valence Day and Night, sortable
 * tables, a filterable list of steps and the spend charted.
 */
const reportHtmlCommand = async ($: Engine, settings: Settings): Promise<string> => {
  const now = await $.clock.now()
  const footer = await footerOf($)
  const page = reportHtml(
    await read($, dashboard),
    { session: footer.session, date: new Date(now).toISOString().slice(0, 10), repo: footer.repo, usage: await withBudget($, settings), version: await ownVersion($) },
    now,
    settings.windowMs,
  )
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const path = `${await $.session.cwd()}/boomi-session-report-${stamp}.html`
  await $.fs.write(path, page)
  return [
    `Saved the report as a web page: ${path}`,
    'Open it in a browser (it works offline; with a connection it also loads the Valence fonts). It is one file with nothing live in it and no credentials, so you can send it as it is.',
    'In it: Day and Night colors, sortable tables (click a column), the steps filtered by product or by what failed, a search, and the spend charted.',
  ].join('\n')
}

/** /bc-dashboard report [save|html]: the report as text; save also writes it as Markdown, html as a web page. */
const reportCommand = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  if (target === 'html') return reportHtmlCommand($, settings)
  const text = await reportNow($, settings)
  if (target !== 'save') return text
  const stamp = new Date(await $.clock.now()).toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const path = `${await $.session.cwd()}/boomi-session-report-${stamp}.md`
  await $.fs.write(path, `${text}\n`)
  return `Saved to ${path}.\n\n${text}`
}

/** Closes one Needs attention item by its key, and keeps that for later sessions. */
const close = async ($: Engine, settings: Settings, key: string) => {
  await update($, dashboard, c => closeItem(c, key))
  void saveActivity($, settings)
}

/** /bc-dashboard close <number|all>: closes items by their number in the text summary. */
const closeByNumber = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  const needs = attention(await read($, dashboard), await $.clock.now(), settings.windowMs)
  if (needs.length === 0) return 'Nothing needs attention.'
  const picked = target === 'all' ? needs : needs.filter((_, i) => String(i + 1) === target)
  if (picked.length === 0) return `Usage: /bc-dashboard close <1-${needs.length} | all>`
  for (const item of picked) await close($, settings, item.key)
  return `Closed: ${picked.map(item => item.title).join('; ')}. /bc-dashboard reopen brings closed items back.`
}

const reopen = async ($: Engine, settings: Settings): Promise<string> => {
  await update($, dashboard, reopenAll)
  void saveActivity($, settings)
  return 'Closed items are back under Needs attention, where they still apply.'
}

/** Shows this folder's steps from before the window too, marked as earlier: Show earlier, or /bc-dashboard earlier. */
const showEarlier = async ($: Engine): Promise<string> => {
  const earlier = (await read($, dashboard)).earlier ?? []
  if (earlier.length === 0) return 'No older steps in this folder: everything it kept is showing.'
  await update($, dashboard, c => ({
    ...c,
    activity: [...(c.earlier ?? []), ...c.activity].sort((a, b) => a.startedAt - b.startedAt),
    restored: (c.restored ?? 0) + (c.earlier?.length ?? 0),
    earlier: [],
  }))
  return `Showing ${earlier.length} older step${earlier.length === 1 ? '' : 's'} from this folder. Their failures are history: they don't go under Needs attention.`
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
  '/bc-dashboard                 open the dashboard pane (Esc closes it); where no pane fits, print it here',
  '/bc-dashboard text            the same as text, here in the conversation',
  '/bc-dashboard poll            check the watched components in Boomi now',
  '/bc-dashboard watch <id|file> watch a component for changes someone else makes',
  '/bc-dashboard unwatch <id>    stop watching it',
  '/bc-dashboard close <n|all>   close a Needs attention item by its number, or all of them',
  '/bc-dashboard reopen          bring closed items back',
  '/bc-dashboard earlier         show this folder\'s steps from before the last 24 hours too',
  '/bc-dashboard size <r> [c]    the pane\'s height in rows (and width in columns when docked); no numbers: the default',
  '/bc-dashboard why [n]         read the log of a failed test or run (no number: pick one)',
  '/bc-dashboard rerun [n]       run a failed test again, the same way Claude ran it (no number: pick one)',
  '/bc-dashboard report [save]   the session as a Markdown report; save also writes it to a file',
  '/bc-dashboard report html     the session as a web page to open in a browser or share: one file, sortable and filterable',
  '/bc-dashboard history         past Companion sessions on this machine and what each cost',
  '/bc-dashboard resume [n]      copy the command that reopens a past session in a new terminal',
  '/bc-dashboard review [n]      what made a past session cost what it did, and what to change next time',
  '/bc-dashboard seen            mark watched changes as seen (expected)',
  '/bc-dashboard banner          show the banner above the prompt again',
  '/bc-dashboard theme [name]    the pane\'s colors: day, night or terminal',
  '/bc-dashboard upgrade         update the dashboard from its GitHub checkout: --check only looks, --yes skips the question, --rollback goes back',
].join('\n')

/**
 * What boomi-standards and boomi-runtime say about the session, when they're
 * loaded and have written it. Only the owner writes; reading it here also
 * redraws the pane when it changes. The engine wants each reference spelled
 * out where it's read.
 */
const guardLines = async ($: Engine) => {
  const valueOf = async (got: Promise<unknown>) => {
    try {
      return ((await got) as { value?: unknown }).value
    } catch {
      return undefined
    }
  }
  return guardrails(
    (await valueOf($.state.get({ plugin: 'boomi-standards', key: 'activity' } as never))) as StandardsSeen | undefined,
    (await valueOf($.state.get({ plugin: 'boomi-runtime', key: 'runtime' } as never))) as RuntimeSeen | undefined,
  )
}

/** The session's usage with the person's budgets, for the text and the report. */
const withBudget = async ($: Engine, settings: Settings): Promise<Usage> => {
  const usage = { ...(await usageOf($)), budgetUsd: settings.budgetUsd }
  return { ...usage, companion: await companionBudget($, settings, usage) }
}

const summaryNow = async ($: Engine, settings: Settings) =>
  [
    summary(await read($, dashboard), await withBudget($, settings), await $.clock.now(), settings.windowMs),
    guardrailText(await guardLines($)),
  ]
    .filter(Boolean)
    .join('\n\n')

const runCommand = async ($: Engine, settings: Settings, args: string): Promise<string> => {
  const [action = 'status', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const target = rest.join(' ')
  switch (action) {
    case 'status': {
      // The dashboard draws in its pane, beside or above the conversation, and
      // leaves the transcript, the scrollback and the prompt as they were. Only
      // where no pane can be shown does the summary go into the transcript.
      const opened = await $.ui
        .open({ id: PANE, title: 'Boomi Companion Dashboard', focus: true, closeOnEscape: true, ...(await sizeOf($, settings)) })
        .catch(() => undefined)
      if (opened?.isPlaced) return 'Dashboard open. Esc closes it; /bc-dashboard text prints it here instead.'
      return summaryNow($, settings)
    }
    case 'text':
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
    case 'close':
      return closeByNumber($, settings, target)
    case 'why':
      return whyByNumber($, settings, target)
    case 'rerun':
      return rerunByNumber($, settings, target)
    case 'report':
      return reportCommand($, settings, target)
    case 'history':
      return historyCommand($, settings)
    case 'resume':
      return resumeCommandFor($, settings, target)
    case 'review':
      return reviewCommand($, settings, target)
    case 'reopen':
      return reopen($, settings)
    case 'earlier':
      return showEarlier($)
    case 'size':
      return resize($, settings, target)
    case 'theme':
      return theme($, settings, target)
    case 'upgrade':
      return upgradeCommand($, target)
    case 'banner':
      await update($, isBandHidden, () => false)
      return 'The dashboard banner is back above the prompt.'
    default:
      return USAGE
  }
}

// --- Upgrading the dashboard ----------------------------------------------------

/**
 * Runs scripts/upgrade.sh on the checkout the dashboard loads from, and reads
 * its report. Git never prompts; anything credential-shaped is masked.
 */
const runUpgrade = async ($: Engine, args: string[], timeoutMs: number): Promise<UpgradeReport> => {
  const ran = await $.process.run(['bash', `${$.plugin.root}/scripts/upgrade.sh`, args[0]!, $.plugin.root, ...args.slice(1)], {
    timeoutMs,
    env: { GIT_TERMINAL_PROMPT: '0' },
  })
  return parseUpgrade(`${ran.stdout}\n${ran.stderr}`)
}

/**
 * /bc-dashboard upgrade [--check] [--yes] [--rollback]: the check, then (after
 * a yes, or --yes) the script's install, which refuses rather than lose or
 * move anything of the person's and tests the new code before it goes live.
 */
const upgradeCommand = async ($: Engine, target: string): Promise<string> => {
  const flags = target.split(/\s+/).filter(Boolean)
  const unknown = flags.filter(f => !['--check', '--yes', '--rollback'].includes(f))
  if (unknown.length > 0) return `Unknown option ${unknown.join(' ')}. Usage: /bc-dashboard upgrade [--check] [--yes], or /bc-dashboard upgrade --rollback`
  if (flags.includes('--rollback')) {
    const back = await runUpgrade($, ['rollback'], 120_000)
    if (back.error) return `✗ ${back.error}`
    return [`✓ Rolled back to ${back.installedNow}: ${back.rolledBack}`, RESTART].join('\n')
  }
  const check = await runUpgrade($, ['check'], 120_000)
  await $.store.set(UPGRADE_KEY, await $.clock.now()).catch(() => undefined)
  const text = checkText(check)
  if (check.error || check.behind === 0 || flags.includes('--check')) return text
  const stop = planText(check)
  if (stop) return `${text}\n\n${stop}`
  if (!flags.includes('--yes')) {
    const answer = await $.ui
      .ask(`Install ${check.latest} over ${check.installed}? ${check.commits.length} commits, ${check.files.length} files, for ${check.mods.join(', ')}. Its validate and test run on the new code first.`, {
        header: 'Upgrade',
        options: ['Install', 'Cancel'],
      })
      .catch(() => undefined)
    if (answer !== 'Install') return `${text}\n\nNot installed. Run /bc-dashboard upgrade again to install, or with --yes to skip the question.`
  }
  const done = await runUpgrade($, ['install', check.target!], 600_000)
  if (done.isUpToDate) return `✓ Already up to date: ${check.latest}.`
  if (done.testsFailed) {
    return [text, '', `✗ The new version's ${done.testsFailed} failed, so it wasn't installed. You're still on ${check.installed}.`, ...done.lines.slice(-40)].join('\n')
  }
  if (done.error) return `${text}\n\n✗ ${done.error}`
  return [
    text,
    '',
    `✓ Installed ${done.installedNow} (was ${check.installed}). Validate and test passed on the new code for ${check.mods.join(', ')}.`,
    `/bc-dashboard upgrade --rollback goes back to ${check.installed}.`,
    RESTART,
  ].join('\n')
}

/** The once-a-day nudge: fetch and compare, never install, and say nothing when it can't tell. */
const nudgeUpgrade = async ($: Engine, settings: Settings) => {
  if (!settings.isCheckingUpdates) return
  const now = await $.clock.now()
  const last = (await $.store.get(UPGRADE_KEY).catch(() => undefined)) as number | undefined
  if (!isCheckDue(typeof last === 'number' ? last : undefined, now, settings.updateCheckHours)) return
  const check = await runUpgrade($, ['check'], 60_000).catch(() => undefined)
  if (!check || check.error || !check.latest || !check.installed) return
  await $.store.set(UPGRADE_KEY, now).catch(() => undefined)
  if (compareVersions(check.latest, check.installed) > 0) {
    $.ui.toast(`bc-dashboard ${check.latest} is available (you have ${check.installed}): run /bc-dashboard upgrade`)
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
  /** The water under it: Valence's seafoam. */
  water: string
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
    water: '#9FDED6',
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
    water: '#5EEAD4',
  },
  terminal: { text: 'text', muted: 'inactive', heading: 'claude', rule: 'subtle', bandText: 'claude', accent: 'suggestion', bird: '#C2185B', water: '#9FDED6' },
}

// The footer's facts, read once per load: the session's id and the repository's GitHub page.
let footerCache: { session: string; repo?: string } | undefined

/**
 * The footer: the session's whole ID (the mod API gives a plugin the
 * session's ID, not its name; claude --resume takes it) and the GitHub page of the working copy's
 * origin remote, read at run time. No link when origin isn't on GitHub.
 */
const footerOf = async ($: Engine): Promise<{ session: string; repo?: string }> => {
  if (footerCache) return footerCache
  const id = await $.session.id().catch(() => '')
  const repo = await $.session.repo().catch(() => null)
  // The whole ID: it's what claude --resume takes.
  footerCache = { session: id || 'unknown', repo: githubUrl(repo?.remote) }
  return footerCache
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
      argumentHint: 'text | poll | earlier | size <rows> [columns] | why [n] | rerun [n] | history | resume [n] | review [n] | report [save|html] | close <n|all> | reopen | watch <id|file> | unwatch <id> | seen | banner | theme [day|night|terminal] | upgrade [--check] [--yes] [--rollback]',
    })
    await $.tool.register({
      name: 'summary',
      description:
        "The Boomi Companion session at a glance: what failed and needs attention (with what to do), each component's stage (edited, saved to Boomi with its version, deployed, tested), recent Companion activity, the live environment's recent runs, watched components and the session's cost. Use it to report progress or to find what to fix next.",
    })
    await $.tool.register({
      name: 'report',
      description:
        "The Boomi Companion session as a Markdown report: each component and where it stands, deployments and tests, what needs attention and what was closed, the environment's runs, and the session's cost and tokens. Use it for a PR description, a ticket or a hand-off.",
    })
    await $.tool.register({
      name: 'history',
      description:
        "Past Boomi Companion sessions on this machine, from Claude Code's transcripts: each session's date, project, Companion work (pushes, deploys, tests), components and cost, with totals for the week and the month. Use it when asked what earlier Companion work cost.",
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
    const size = (await $.store.get(SIZE_KEY)) as { rows?: number; columns?: number } | undefined
    if (size && typeof size.rows === 'number') await update($, paneSize, () => ({ rows: size.rows!, columns: size.columns ?? 0 }))

    await restoreActivity($, settings)

    const scanned = (await $.store.get(HISTORY_KEY)) as { sessions?: PastSession[]; scannedAt?: number; scanned?: number } | undefined
    if (Array.isArray(scanned?.sessions)) {
      await update($, history, (): HistoryState => ({ phase: 'ready', sessions: scanned.sessions, scannedAt: scanned.scannedAt, scanned: scanned.scanned }))
    }

    const ids = await $.store.get(WATCH_KEY)
    if (Array.isArray(ids)) {
      await update($, dashboard, c =>
        c.watched.length > 0 ? c : { ...c, watched: ids.map(id => ({ componentId: String(id) })) },
      )
    }

    $.clock.every(5_000, () => refreshStatus($, settings))
    // The flamingo's scene: what it does next is checked every half second.
    if (settings.hasFlamingo) {
      // It stands in one place, working or not; the pane redraws only when the scene changes.
      $.clock.every(FLAMINGO_TICK_MS, async () => {
        sceneTick++
        if (JSON.stringify(sceneAt(sceneTick)) !== JSON.stringify(sceneAt(await read($, frame)))) await update($, frame, () => sceneTick)
      })
    }
    if (settings.pollSeconds > 0) {
      $.clock.after(2_000, () => poll($, settings))
      $.clock.every(settings.pollSeconds * 1000, () => poll($, settings))
    }

    // The banner greets only where Companion works: its components folder, its log, or an earlier session here.
    const cwd = await $.session.cwd()
    const exists = (path: string) => $.fs.exists(path.startsWith('/') ? path : `${cwd}/${path}`).catch(() => false)
    const isCompanion =
      (await read($, recap)) !== null ||
      (await read($, dashboard)).activity.length > 0 ||
      (await exists(settings.componentsDir)) ||
      (await exists(ACTIVITY_LOG))
    await update($, isCompanionFolder, () => isCompanion)
    // A new session's banner turns through the last session's recap and the tips until Companion does something.
    $.clock.every(TIP_MS, async () => {
      if (!(await read($, dashboard)).activity.some(a => !a.isRestored)) await update($, tip, n => n + 1)
    })
    // Which Companion plugins are here: the pane's sections and the tips follow them. Read once, just after the start.
    $.clock.after(1_000, () => notePlugins($))
    await readActivityLog($, settings)
    $.clock.every(LOG_CHECK_MS, () => readActivityLog($, settings))
    // Whether a newer dashboard is on GitHub, at most once a day; it never installs.
    $.clock.after(15_000, () => nudgeUpgrade($, settings).catch(() => undefined))
    // A monthly Companion amount counts earlier sessions' costs: read them once, soon after the start.
    if (settings.companionMonthlyUsd > 0) {
      $.clock.after(5_000, async () => {
        const known = await read($, history)
        const today = monthOf(await $.clock.now())
        if (known.phase !== 'loading' && (known.scannedAt === undefined || monthOf(known.scannedAt) !== today || (await $.clock.now()) - known.scannedAt > 3_600_000)) {
          await scanHistory($, settings).catch(() => undefined)
        }
      })
    }
    return started
  })

  // Companion's scripts: note each run as it starts, then read how it went.
  // The dashboard only watches: its own trouble never stops the command.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = String(e.command ?? '')
    const runs = scriptRuns(command)
    const checks = bdiStatusChecks(command)
    const deploys = datahubStatusChecks(command)
    const quarantines = quarantineChecks(command)
    if (runs.length === 0 && checks.length === 0 && deploys.length === 0 && quarantines.length === 0) return next(e)
    const started = runs.length > 0 ? await noteStart($, settings, runs).catch(() => [] as Activity[]) : []
    const ran = await next(e)
    if (runs.length > 0) await noteEnd($, settings, started, ran).catch(() => undefined)
    // Claude checking on work that finishes later, or on a universe's quarantine.
    if (checks.length > 0) await followBdiRuns($, settings, checks, ran).catch(() => undefined)
    if (deploys.length > 0) await followDeploys($, settings, deploys, ran).catch(() => undefined)
    if (quarantines.length > 0) await followQuarantine($, settings, quarantines, ran).catch(() => undefined)
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

  on('tool.call', { tool: 'mcp__boomi-dashboard__history' }, async $ => ({
    result: await historyCommand($, settings).catch(error => `The dashboard couldn't read past sessions: ${messageOf(error)}`),
  }))

  on('tool.call', { tool: 'mcp__boomi-dashboard__report' }, async $ => ({
    result: await reportNow($, settings).catch(error => `The dashboard couldn't build its report: ${messageOf(error)}`),
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
    if (e.reason === 'answer') void suggestNext($, settings)
    return done
  })

  // The banner above the prompt: the latest thing Companion did, what needs
  // attention and the spend so far, on one row. At the start of a session in
  // a Companion workspace, before Companion has done anything, it turns
  // through what the last session did and tips instead. Elsewhere it waits.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!settings.isBanded || e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    const current = await read($, dashboard)
    const now = await $.clock.now()
    const isNew = !current.activity.some(a => !a.isRestored)
    const latest = isNew ? undefined : headline(current.activity)
    const needs = attention(current, now, settings.windowMs)
    const welcome = isNew && (await read($, isCompanionFolder)) ? welcomeLine(await read($, tip), (await read($, recap)) ?? undefined, now, tipsFor(await read($, companionPlugins))) : undefined
    if (!latest && !welcome && needs.length === 0) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const count = components(current.activity).length
    const usage = await usageOf($)
    const cost = formatCost(usage.usd)
    const spent = [
      isNew ? cost && `${cost} this session` : [usage.tokens ? `${formatTokens(usage.tokens)} tokens` : undefined, cost].filter(Boolean).join(' · '),
      limitsShort(usage.limits, now),
    ]
      .filter(Boolean)
      .join(' │ ')
    const icon = (level: Level) => <Text color={STATUS[level].color}>{STATUS[level].icon}</Text>
    const first = latest ?? welcome

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
            {welcome && (
              <Text>
                {welcome.level ? <Text>{icon(welcome.level)} </Text> : undefined}
                <Text dimColor={!welcome.level}>{welcome.text}</Text>
              </Text>
            )}
            {needs.length > 0 && (
              <Text>
                <Text dimColor>{first ? ' │ ' : ''}</Text>
                {icon(worst(needs.map(n => n.level)))} {needs.length} need{needs.length === 1 ? 's' : ''} attention
              </Text>
            )}
            <Text dimColor>
              {!isNew && count > 0 ? ` │ ${count} component${count === 1 ? '' : 's'}` : ''}
              {spent ? ` │ ${spent}` : ''}
            </Text>
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text> </Text>
          <Button key="open" label="Open" onPress={() => void openPane($, settings)} />
          <Text> </Text>
          <Button key="hide" label="Hide" onPress={() => update($, isBandHidden, () => true)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const themeNow = await themeOf($, settings)
    const guards = await guardLines($)
    const past = await read($, history)
    const shown = await read($, historyShown)
    const copiedNow = await read($, copied)
    const reviewingNow = await read($, reviewing)
    const sessionId = await $.session.id().catch(() => undefined)
    const footer = await footerOf($)
    const p = PALETTES[themeNow]
    const current = await read($, dashboard)
    const now = await $.clock.now()
    const usage = await usageOf($)
    const working = await read($, isWorking)
    const flamingoFrame = await read($, frame)
    const needs = attention(current, now, settings.windowMs)
    const closedItems = closedCount(current, now, settings.windowMs)
    const whys = await read($, diagnoses)
    const rows = components(current.activity)
    const agentRows = agents(current.activity)
    const connectorRows = connectors(current.activity)
    const plugins = await read($, companionPlugins)
    const stepsLimit = await read($, stepsShown)
    const steps = current.activity.filter(a => !a.recipe).reverse()
    const feed = steps.slice(0, stepsLimit)
    const all = spends(current.activity)
    // The pane's padding and the surface's own frame take a few columns: leave room for both.
    const width = Math.max(30, (e.viewport?.columns ?? 64) - 6)
    const trail = current.activity
      .slice(-24)
      .map(a => all.get(a.id)?.tokens ?? 0)
    const last = feed[0] && all.get(feed[0].id)

    const limitsNow = limitViews(usage.limits, now)
    const mine = await companionBudget($, settings, usage)
    const budgets = budgetLines({ ...usage, ...(mine ? { companion: mine } : {}) }, settings)
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
    /** A product's row, as a component's: its name and spend, then its stages. */
    const stageRow = (name: string, ids: number[], list: { level: Level; text: string }[]) => {
      const spent = formatSpend(spendOf(ids, all))
      return (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Box flexShrink={1}>
              <Text backgroundColor={p.bg} wrap="truncate-end">
                {t(name, { bold: true })}
              </Text>
            </Box>
            {spent ? <Box flexShrink={0}>{t(`  ${spent}`, { color: p.muted })}</Box> : undefined}
          </Box>
          <Text backgroundColor={p.bg}>
            {t('  ')}
            {list.map(s => (
              <Text backgroundColor={p.bg}>
                {icon(s.level)}
                {t(` ${s.text}   `)}
              </Text>
            ))}
          </Text>
        </Box>
      )
    }
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
    // A gauge's notes go one to a line, so the gauges stay narrow enough to sit side by side.
    const gauge = (label: string, value: string, ...notes: (string | undefined)[]) => (
      <Box flexDirection="column" borderStyle="round" borderColor={p.rule} backgroundColor={p.bg} paddingX={1} flexGrow={1} minWidth={14}>
        {t(label, { color: p.muted, bold: true })}
        {t(value, { color: p.accent, bold: true })}
        {notes.filter(Boolean).map(note => t(note!, { color: p.muted }))}
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
        <Text color={p.rule} backgroundColor={p.bg} wrap="truncate-end">
          {decoRule(width)}
        </Text>

        <Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Box flexWrap="wrap" columnGap={1}>
              {gauge(
                'TOKENS',
                usage.tokens ? formatTokens(usage.tokens) : '—',
                last?.tokens ? `last step ${formatTokens(last.tokens)}` : undefined,
                usage.cached ? `+${formatTokens(usage.cached)} cached` : undefined,
              )}
              {gauge(
                'SPEND',
                formatCost(usage.usd) ?? '—',
                last?.usd ? `last step ${formatCost(last.usd)}` : undefined,
              )}
              {gauge(
                'CONTEXT',
                usage.contextPercent === undefined ? '—' : `${meter(usage.contextPercent, 8)} ${Math.round(usage.contextPercent)}%`,
              )}
              {limitsNow.length > 0 &&
                gauge(
                  'LIMITS',
                  `${meter(Math.min(100, limitsNow[0]!.percent), 8)} ${Math.round(limitsNow[0]!.percent)}%`,
                  `${limitsNow[0]!.name}${limitsNow[0]!.resetsIn ? `, resets ${limitsNow[0]!.resetsIn}` : ''}`,
                  limitsNow[0]!.pace ? `${STATUS[limitsNow[0]!.level].icon} ${limitsNow[0]!.pace}` : undefined,
                  ...limitsNow.slice(1).map(v => `${v.name} ${Math.round(v.percent)}%`),
                )}
              {budgets.length > 0 &&
                gauge(
                  'BUDGET',
                  `${meter(Math.min(100, budgets[0]!.percent), 8)} ${Math.round(budgets[0]!.percent)}%`,
                  ...budgets.map(b => `${STATUS[b.level].icon} ${b.label}: ${b.detail}`),
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
                const cells = (row: ReturnType<typeof pixelCells>[number]) =>
                  row.map(cell => (
                    <Text color={cell.color} backgroundColor={cell.bg ?? p.bg}>
                      {cell.char}
                    </Text>
                  ))
                return [
                  ...pixelCells(sceneRows(sceneAt(flamingoFrame)), { P: p.bird, L: '#F7A8C4', K: '#0B0B0B' }).map(row => (
                    <Text backgroundColor={p.bg}>{cells(row)}</Text>
                  )),
                  // The still water it stands in, across the strip.
                  ...pixelCells(pondRows(), { W: p.water }).map(row => <Text backgroundColor={p.bg}>{cells(row)}</Text>),
                ]
              })()}
            </Box>
          )}
        </Box>

        {heading('Needs attention')}
        {needs.length === 0 && line('healthy', 'All clear.')}
        {needs.map((n, i) => {
          const why = n.executionId ? whys[n.executionId] : undefined
          return (
            <Box flexDirection="column">
              <Box>
                <Box flexShrink={0}>
                  <Button key={`close-${i}`} label="☐" onPress={() => close($, settings, n.key)} />
                  {t(' ')}
                </Box>
                <Box flexGrow={1} flexShrink={1}>
                  {line(n.level, n.title, ago(n.at, now))}
                </Box>
              </Box>
              {!why && t(`      ${n.hint}`, { color: p.muted })}
              {why?.phase === 'loading' && t('      Reading the execution log…', { color: p.muted })}
              {why?.phase === 'error' && t(`      ${why.error}`, { color: p.muted })}
              {why?.phase === 'ready' && t(`      The log (${why.severe ?? 0} severe, ${why.warnings ?? 0} warnings):`, { color: p.muted })}
              {why?.phase === 'ready' && (why.lines ?? []).map(text => t(`        ${text}`))}
              {(n.executionId || n.rerunId !== undefined) && (
                <Box>
                  {t('      ')}
                  {n.executionId && why?.phase !== 'ready' && why?.phase !== 'loading' && (
                    <Button key={`why-${i}`} label="Why?" onPress={() => void explain($, settings, n.executionId!)} />
                  )}
                  {why?.phase === 'ready' && <Button key={`fix-${i}`} label="Ask Claude to fix" onPress={() => askToFix($, n.title, n.executionId!)} />}
                  {n.rerunId !== undefined && <Button key={`rerun-${i}`} label="Run again" onPress={() => void rerun($, settings, n.rerunId!)} />}
                </Box>
              )}
            </Box>
          )
        })}
        {closedItems > 0 && (
          <Box>
            {t(`☑ ${closedItems} closed  `, { color: p.muted })}
            <Button key="reopen" label="Reopen" onPress={() => reopen($, settings)} />
          </Box>
        )}

        {(rows.length > 0 || hasComponents(plugins)) && heading('Components this session')}
        {rows.length === 0 && hasComponents(plugins) && t('Components show up here as Claude edits, saves, deploys and tests them.', { color: p.muted })}
        {(current.restored || current.earlier?.length) ? (
          <Box>
            {current.restored ? note(`Includes ${restoredNote(current.restored, settings.windowMs, current.earlier?.length === 0)}.  `) : undefined}
            {current.earlier?.length ? <Button key="earlier" label={earlierLabel(current.earlier.length)} onPress={() => void showEarlier($)} /> : undefined}
          </Box>
        ) : undefined}
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

        {(connectorRows.length > 0 || (plugins && isInstalled(plugins, 'bc-connectordev'))) && heading('Custom connectors')}
        {connectorRows.length === 0 && plugins && isInstalled(plugins, 'bc-connectordev') && note('Connectors show up here as Claude lints, validates, uploads and releases them.')}
        {connectorRows.slice(0, 6).map(row => stageRow(row.name, row.ids, connectorStages(row)))}
        {connectorRows.length > 6 && t(`…and ${connectorRows.length - 6} more: /bc-dashboard lists them all.`, { color: p.muted })}

        {(agentRows.length > 0 || (plugins && isInstalled(plugins, 'bc-agentstudio'))) && heading('Agentstudio agents')}
        {agentRows.length === 0 && plugins && isInstalled(plugins, 'bc-agentstudio') && note('Agents show up here as Claude creates, packages, deploys and talks to them.')}
        {agentRows.slice(0, 6).map(row => stageRow(row.name, row.ids, agentStages(row)))}
        {agentRows.length > 6 && t(`…and ${agentRows.length - 6} more: /bc-dashboard lists them all.`, { color: p.muted })}

        {feed.length > 0 && heading("Claude's latest steps")}
        {feed.length > 0 && note('What Claude just did with Companion, newest first, and the tokens each step took.')}
        {feed.map(a => {
          const spent = all.get(a.id)?.tokens
          const aside = [ago(a.endedAt ?? a.startedAt, now), a.source === 'log' ? 'log' : undefined, spent ? `${formatTokens(spent)} tok` : undefined]
          return line(levelOf(a), describe(a), aside.filter(Boolean).join(' · '))
        })}
        {feed.length > 0 && productSpendLine(current.activity, all) && note(productSpendLine(current.activity, all)!)}
        {steps.length > STEPS_PAGE && (
          <Box>
            {t(`  Showing ${feed.length} of ${steps.length}  `, { color: p.muted })}
            {feed.length < steps.length && <Button key="steps-more" label="More" onPress={() => update($, stepsShown, n => n + STEPS_PAGE * 2)} />}
            {stepsLimit > STEPS_PAGE && <Button key="steps-fewer" label="Fewer" onPress={() => update($, stepsShown, () => STEPS_PAGE)} />}
          </Box>
        )}

        {(quarantineLines(current, now).length > 0 || (plugins && isInstalled(plugins, 'bc-datahub'))) && heading('Data Hub')}
        {quarantineLines(current, now).length === 0 && plugins && isInstalled(plugins, 'bc-datahub') && note("Quarantined entities show up here once Claude checks a universe's quarantine.")}
        {quarantineLines(current, now).map(q => line(q.level, q.text))}

        {guards.length > 0 && heading('Guardrails')}
        {guards.map(g => (g.level ? line(g.level, g.text) : note(g.text)))}

        <Box marginTop={1} justifyContent="space-between">
          <Box>
            {t('◇ ', { color: p.rule, bold: true })}
            {t('PAST COMPANION SESSIONS', { color: p.heading, bold: true })}
            {past.scannedAt !== undefined && t(`  scanned ${ago(past.scannedAt, now)}`, { color: p.muted })}
          </Box>
          {past.phase !== 'loading' && (
            <Button key="history-scan" label={past.phase === 'idle' ? 'Scan' : 'Rescan'} onPress={() => void scanHistory($, settings)} />
          )}
        </Box>
        {past.phase === 'idle' && note(`What earlier Companion sessions on this machine cost, from Claude Code's transcripts. Scan reads the last ${settings.historyDays} days.`)}
        {past.sessions && past.sessions.length > 0 && note('Review shows what made a session cost what it did. Copy puts the command that reopens it on the clipboard, for a new terminal.')}
        {past.phase === 'loading' && note('Reading the transcripts…')}
        {past.phase === 'error' && line('warning', past.error ?? 'The transcript scan failed.')}
        {past.sessions && past.sessions.length === 0 && note(`No Companion sessions in the last ${settings.historyDays} days.`)}
        {past.sessions && past.sessions.length > 0 && (() => {
          const week = historyTotals(past.sessions, now, 7 * 86_400_000)
          const month = historyTotals(past.sessions, now, 30 * 86_400_000)
          const total = (label: string, x: typeof week) =>
            `${label} ${formatCost(x.usd)}${x.unpriced ? ` +${x.unpriced} unpriced` : ''} · ${x.sessions} session${x.sessions === 1 ? '' : 's'}`
          return (
            <Box flexDirection="column">
              {t(`${total('This week', week)}   ${total('30 days', month)}`, { color: p.accent, bold: true })}
              {past.sessions.slice(0, shown).map((s, i) => {
                const { head, detail } = pastParts(s, { currentId: sessionId, withProject: projectsDiffer(past.sessions!) })
                const isThis = s.id === sessionId
                return (
                  <Box flexDirection="column">
                    <Box justifyContent="space-between">
                      <Box flexShrink={1}>
                        <Text backgroundColor={p.bg} wrap="truncate-end">
                          {t(`  ${head}`)}
                        </Text>
                      </Box>
                      <Box flexShrink={0}>
                        {t(' ')}
                        <Button
                          key={`history-review-${i}`}
                          label={reviewingNow === s.id ? 'Close' : 'Review'}
                          onPress={() => update($, reviewing, now => (now === s.id ? null : s.id))}
                        />
                        {!isThis && <Button key={`history-copy-${i}`} label="Copy" onPress={press => void copyResume($, s, press.surface)} />}
                      </Box>
                    </Box>
                    <Text backgroundColor={p.bg} wrap="truncate-end">
                      {t(`      ${detail}`, { color: p.muted })}
                    </Text>
                    {reviewingNow === s.id &&
                      (() => {
                        const review = reviewSession(s)
                        return (
                          <Box flexDirection="column">
                            {t(`      ${review.summary}`, { color: p.accent })}
                            {review.findings.length === 0 && line('healthy', 'Nothing stands out: its cost came from the work itself.')}
                            {review.findings.map(f => (
                              <Box flexDirection="column">
                                {line(f.level, f.title)}
                                {t(`      ${f.tip}`, { color: p.muted })}
                              </Box>
                            ))}
                            <Box>
                              {t('      ')}
                              <Button key={`history-ask-${i}`} label="Ask Claude to review" onPress={() => void askToReview($, s)} />
                            </Box>
                          </Box>
                        )
                      })()}
                    {copiedNow?.id === s.id &&
                      (copiedNow.isCopied
                        ? line('healthy', 'Copied. Paste it into a new terminal to reopen this session.')
                        : t(`      Run this in a new terminal: ${resumeCommand(s)}`, { color: p.accent }))}
                  </Box>
                )
              })}
              {past.sessions.length > PAST_PAGE && (
                <Box>
                  {t(`  Showing ${Math.min(shown, past.sessions.length)} of ${past.sessions.length}  `, { color: p.muted })}
                  {shown < past.sessions.length && (
                    <Button key="history-more" label="More" onPress={() => update($, historyShown, n => n + PAST_PAGE)} />
                  )}
                  {shown > PAST_PAGE && <Button key="history-fewer" label="Fewer" onPress={() => update($, historyShown, () => PAST_PAGE)} />}
                </Box>
              )}
            </Box>
          )
        })()}

        {current.watched.length > 0 && heading('Watched components')}
        {current.watched.length > 0 && note('Flagged when someone other than Companion changes one in Boomi.')}
        {current.watched.length > 0 && current.platform.phase !== 'ok' && current.platform.checkedAt !== undefined && line('warning', current.platform.message)}
        {current.watched.map(w => line(watchedLevel(w), watchedText(w)))}

        <Box marginTop={1}>
          <Text color={p.muted} backgroundColor={p.bg} dimColor>
            {`session ${footer.session}`}
            {footer.repo ? ' · ' : ''}
            {footer.repo ? <Link href={footer.repo} label={footer.repo.replace(/^https:\/\//, '')} /> : undefined}
          </Text>
        </Box>
      </Box>
    )
  })
}
