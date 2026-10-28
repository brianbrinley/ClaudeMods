// A live view of a Boomi Companion session while you build: each component
// Claude edits, saves, deploys and tests, what needs attention and what to do
// about it, the session's cost, and, with Companion's credentials, the live
// environment's recent runs and the components someone asked to watch.
// Companion's work is read from Claude's tool calls and their output, so the
// session's own activity needs no Platform API calls.
// Everything that touches the engine lives in this file because the engine
// follows $ only within it; parsing and wording are in ./activity.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, PromptSubmitInput, Register } from 'claude-code'

import type { Activity, CompanionPlugin, Dashboard, DiagnosisState, HistoryState, Ledger, PaneTheme, PastSession, Platform, PromptCounts, PromptTips, PromptTry, UsageBreakdownSeen, RuntimeSeen, SessionRecap, StandardsSeen, Watched } from '../types'
import {
  EMPTY_LEDGER,
  STATUS,
  ago,
  duration,
  attention,
  closeItem,
  closedCount,
  diagnose,
  bdiFixPrompt,
  fixPrompt,
  logKeyOf,
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
  backgroundOf,
  isSettled,
  parseResults,
  friendlyType,
  githubUrl,
  headline,
  bandFlamingoAt,
  handoffNudgeText,
  shouldNudgeHandoff,
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
  unclaimedReading,
  withoutEchoes,
  repaired,
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
  PAUSED,
  rerunArgs,
  knownName,
} from './activity'
import type { Attention, BudgetLine, Level, Reading, ScriptRun, SharePeriod, Usage } from './activity'
import { credentialsFrom, parseEnv, platformClient } from './platform'
import { environmentChanges, environmentGate, environmentNamed, environmentsFrom, wrapperRuns } from './environment'
import type { EnvCheck, Environment } from './environment'
import { agentstudioReading, bdiDiagnosis, bdiFailedStep, bdiRunId, connectordevReading, bdiRunReading, bdiStatusChecks, causeWords, datahubDeployReading, datahubStatusChecks, deployState, quarantineChecks, quarantineReading, recipeComponents } from './products'
import { componentTable, hasEarlierSteps, reportHtml, scoped, stepsToMatch, transcriptsFolder } from './report-html'
import { toCsv, toTsv } from './export'
import { changeLines } from './changes'
import type { BoomiFacts, ReportScope, ReportStyle } from './report-html'
import { DONE, FIELDS, changeLine, configKey, fieldNamed, groupNamed, groupWithValue, listing, menuQuestion, parseValue, pastSpend, questionFor, show, valueOf } from './config'
import type { Group, PastSpend, Value } from './config'
import { blockedDetail, companionChanges, denyMessage, enforcementNote, platformWrites, spentBudgets, spentText } from './budget-gate'
import type { Enforce } from './budget-gate'
import { BOOMI_MARK_PNG, drawsPictures } from './boomi-mark'
import { PALETTES, THEMES, THEME_NAMES, THEME_LABELS, THEME_OPTIONS, isDarkAppearance, markOf, resolveTheme, themeFromOptions, themeNamed } from './themes'
import type { DrawnTheme, Family } from './themes'
import { COMPANION_PLUGINS, hasComponents, isInstalled, pluginsFromFiles, pluginsFromList } from './plugins'
import { RESTART, asUpdateSeen, changelogBetween, checkText, isCheckDue, parseUpgrade, pendingUpdate, planText, updateNotice } from './upgrade'
import type { UpgradeReport } from './upgrade'
import { reviewLabel, reviewPrompt, reviewSession, reviewText } from './review'
import { EMPTY_INDEX, contextLines, docName, folderComponentOf, indexFile, isCurrent, relevantComponents, relevantPlaces, relevantSections, sectionsOf } from './retrieve'
import type { DocIndex, FolderComponent, Section } from './retrieve'
import { GUIDE, GUIDE_STAMP, REFRESH_SYSTEM, driftNote, guideFor, guideStatus, guideText, refreshRequest, refreshText } from './prompt-guide'
import { companionUseLine, isFresh, parseUsage, topHabit, usageArgv } from './usage-breakdown'
import { paceOf, recordDay } from './spend-history'
import type { SpendDays } from './spend-history'
import { NO_COUNTS, NUDGE_ONLY, checkPrompt, countsAfter, countsLine, wrapLines, findSecrets, isCheckable, isClosingOut, isSuggestionTaken, maskPrompt, reportLines, rewriteParts, rewriteRequest, rewriteSystem, statusPart, tipsText, upgradePrompt } from './prompt-check'
import type { PromptFacts } from './prompt-check'
import { ACTIVITY_LOG_LINE, activityLogSetting, turnOffActivityLog, turnOnActivityLog } from './activity-env'
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

/** A newer dashboard version on GitHub, for the pane's footer: toasted once, then mentioned quietly until installed. */
const updateAvailable = atom({ plugin: 'boomi-dashboard', key: 'updateAvailable' } as const, null as string | null)

/** What each failed execution's log says, by execution ID, once someone asks Why?. */
const diagnoses = atom({ plugin: 'boomi-dashboard', key: 'diagnoses' } as const, {} as Record<string, DiagnosisState>)

/** The tick the flamingo's scene last changed at: the pane draws sceneAt(it). */
const frame = atom({ plugin: 'boomi-dashboard', key: 'frame' } as const, 0)
/** Which turn of the spinner the Prompt tab shows while a rewrite is running; ticks only then. */
const spin = atom({ plugin: 'boomi-dashboard', key: 'spin' } as const, 0)

/** The tick the banner's flamingo last changed at: the banner draws bandFlamingoAt(it). */
const bandFrame = atom({ plugin: 'boomi-dashboard', key: 'bandFrame' } as const, 0)

/** Half-second ticks since the mod loaded, for the flamingo's scene. */
let sceneTick = 0

/** Seconds since the mod loaded, for the banner's flamingo. */
let bandTick = 0

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

/** The person allowed Companion changes past a spent budget for the rest of this session (confirm mode). */
const budgetAllowed = atom({ plugin: 'boomi-dashboard', key: 'budgetAllowed' } as const, false)

/** What the spent budgets are while they pause Companion changes, for the banner; empty otherwise. */
const budgetPaused = atom({ plugin: 'boomi-dashboard', key: 'budgetPaused' } as const, '')

/** The enforcement state Claude was last told about with a prompt, so it's told once, and again on a change. */
const enforceNoted = atom({ plugin: 'boomi-dashboard', key: 'enforceNoted' } as const, '')

/** The .env's environment as Boomi lists it: read at session start, kept for the session. Never the token. */
const envTarget = atom({ plugin: 'boomi-dashboard', key: 'envTarget' } as const, { checkedAt: 0, environment: undefined as Environment | undefined, note: '' })

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
/** The last text the prompt box showed dim as a suggestion, from Claude or a plugin, for Tab to take. */
const shownSuggestion = atom({ plugin: 'boomi-dashboard', key: 'shownSuggestion' } as const, '')

/** The latest checked prompt that had tips, masked, with its upgrade; null once a prompt needs none. */
const promptTips = atom({ plugin: 'boomi-dashboard', key: 'promptTips' } as const, null as PromptTips | null)

/** How many prompts were checked, had tips, and followed the tips before them, this session. */
const promptCounts = atom({ plugin: 'boomi-dashboard', key: 'promptCounts' } as const, NO_COUNTS as PromptCounts)

/** True while a model rewrites the upgrade from the Prompt tab. */
const promptBusy = atom({ plugin: 'boomi-dashboard', key: 'promptBusy' } as const, false)

/** What the Prompt tab's last button did, under its buttons; cleared by the next prompt. */
const promptNote = atom({ plugin: 'boomi-dashboard', key: 'promptNote' } as const, '')

/**
 * A prompt held in confirm mode, as typed, until the person sends it, the
 * upgrade, or neither from the Prompt tab or the banner. Claude hasn't seen
 * it. Only this session's state holds it, and only until then.
 */
const promptHeld = atom({ plugin: 'boomi-dashboard', key: 'promptHeld' } as const, null as string | null)

/** The note for the next rewrite as it's typed: how many rows its field takes, for fitting the tab to the pane. */
const promptNoteDraft = atom({ plugin: 'boomi-dashboard', key: 'promptNoteDraft' } as const, '')

/** Claude Code's own breakdown of what used the person's limits, read from `claude -p "/usage"` now and then. */
const usageBreakdown = atom({ plugin: 'boomi-dashboard', key: 'usageBreakdown' } as const, null as { breakdown: UsageBreakdownSeen; checkedAt: number; days?: SpendDays } | null)

/** How often the breakdown is read again: it covers a day and a week, so a quarter of an hour is plenty. */
const BREAKDOWN_MS = 15 * 60_000

/** Where the breakdown is kept across sessions, so the sessions on this machine share one reading. */
const BREAKDOWN_KEY = 'usageBreakdown'

/** Whether this Claude Code knew `--safe-mode`: once it has refused, the plain run is used. */
let isSafeModeKnown = true

/**
 * Reads Claude Code's /usage breakdown with a headless run of it: no model
 * call, no session kept (`--no-session-persistence`) and none of the person's
 * hooks or plugins (`--safe-mode`). A reading another session took in the last
 * quarter of an hour, from the store, is used instead of a new run. Nothing
 * changes when the command fails or has no breakdown (off a subscription).
 */
const readBreakdown = async ($: Engine) => {
  const now = await $.clock.now()
  const kept = (await $.store.get(BREAKDOWN_KEY).catch(() => undefined)) as { breakdown: UsageBreakdownSeen; checkedAt: number; days?: SpendDays } | undefined
  if (kept && isFresh(kept.checkedAt, now, BREAKDOWN_MS)) {
    if (kept.checkedAt !== (await read($, usageBreakdown))?.checkedAt) await update($, usageBreakdown, () => kept)
    return
  }
  const cwd = await $.session.cwd()
  const run = (isSafe: boolean) => $.process.run(usageArgv(isSafe), { cwd, timeoutMs: 30_000 }).catch(() => undefined)
  let ran = await run(isSafeModeKnown)
  if (isSafeModeKnown && ran?.exitCode !== 0) {
    isSafeModeKnown = false
    ran = await run(false)
  }
  const breakdown = ran?.exitCode === 0 ? parseUsage(ran.stdout) : undefined
  if (breakdown) {
    const checkedAt = await $.clock.now()
    // The last figure of each day, kept with the reading, so the dashboard can say what today and the month came to.
    const days = breakdown.extra ? recordDay(kept?.days ?? (await read($, usageBreakdown))?.days, checkedAt, breakdown.extra.usedUsd) : (kept?.days ?? undefined)
    const seen = { breakdown, checkedAt, ...(days ? { days } : {}) }
    await update($, usageBreakdown, () => seen)
    await $.store.set(BREAKDOWN_KEY, seen).catch(() => undefined)
  }
}

/** The usage with what only the dashboard's own reads add: Companion's share of all usage, from the /usage breakdown. */
const withUse = async ($: Engine, usage: Usage): Promise<Usage> => {
  const seen = await read($, usageBreakdown)
  const breakdown = seen?.breakdown
  const now = await $.clock.now()
  const use = companionUseLine(breakdown)
  const habit = topHabit(breakdown)
  return { ...usage, ...(use ? { companionUse: use } : {}), ...(habit ? { usageHabit: habit } : {}), ...(breakdown?.isUnreadable ? { isUsageUnreadable: true as const } : {}), ...(breakdown?.extra ? { extraUsage: breakdown.extra, pace: paceOf(breakdown.extra, seen?.days, now), now: usage.now ?? now } : {}) }
}

/** Past Companion sessions folded to their totals, to leave the pane's room to this session; kept across sessions. */
/** Whether the pane's theme list is open under its Theme button. */
const isThemeListOpen = atom({ plugin: 'boomi-dashboard', key: 'isThemeListOpen' } as const, false)
const isPastCollapsed = atom({ plugin: 'boomi-dashboard', key: 'isPastCollapsed' } as const, true)
const PAST_COLLAPSED_KEY = 'pastCollapsed'

/** Folds or unfolds Past Companion sessions, and keeps the choice for later sessions. */
const togglePast = async ($: Engine) => {
  const next = !(await read($, isPastCollapsed))
  await update($, isPastCollapsed, () => next)
  await $.store.set(PAST_COLLAPSED_KEY, next).catch(() => undefined)
}

/** True once the person pressed Show all: the Prompt tab's cards draw whole and the pane scrolls. */
const promptExpanded = atom({ plugin: 'boomi-dashboard', key: 'promptExpanded' } as const, false)

/** The tips (by their time) whose nudge the person closed in the banner. */
const promptNudgeHidden = atom({ plugin: 'boomi-dashboard', key: 'promptNudgeHidden' } as const, 0)

/** The offer to turn on Companion's activity log was put off ("Not now") for this session. */
const isLogOfferDeclined = atom({ plugin: 'boomi-dashboard', key: 'isLogOfferDeclined' } as const, false)

/** What Companion's env file says about the activity log, as last read; `unknown` before the first look. Never its text. */
const logState = atom({ plugin: 'boomi-dashboard', key: 'logState' } as const, 'unknown' as 'on' | 'off' | 'absent' | 'no-file' | 'unreadable' | 'unknown')

type Settings = {
  envFile: string
  componentsDir: string
  pollSeconds: number
  windowMs: number
  paneTheme: PaneTheme
  isToasting: boolean
  isBanded: boolean
  /** The look `auto` settles into: Exosphere, or Whimsical for a person who had chosen the flamingo. */
  themeFamily: Family
  /** The mark: the Boomi logo in Exosphere, the flamingo in Whimsical. */
  hasLogo: boolean
  isBandAnimated: boolean
  isNudgingHandoff: boolean
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
  isOpeningReport: boolean
  budgetEnforce: Enforce
  budgetGrace: number
  envCheck: EnvCheck
  reportStyle: ReportStyle
  promptCheck: 'off' | 'suggest' | 'confirm'
  promptModel: string
  promptRewrite: 'auto' | 'manual'
  promptSuggested: 'skip' | 'check'
  activityLogPrompt: 'ask' | 'never'
  promptSkip: ReadonlySet<string>
  promptView: 'auto' | 'manual' | 'off'
  seatBudgetUsd: number
  isReadingBreakdown: boolean
  /** The options these settings came from, for a change to one of them. */
  options: Readonly<Record<string, unknown>>
}

const settingsFrom = (options: PluginOptions): Settings => ({
  envFile: String(options.envFile || '.env'),
  componentsDir: String(options.componentsDir || 'active-development'),
  pollSeconds: Math.max(0, Number(options.pollSeconds ?? 60) || 0),
  windowMs: Math.max(1, Number(options.recentHours ?? 24) || 24) * 3_600_000,
  paneTheme: themeFromOptions(options).theme,
  themeFamily: themeFromOptions(options).family,
  isToasting: options.toasts !== false,
  isBanded: options.banner !== false,
  // `flamingo` is the setting `logo` replaced: a person who had turned the flamingo off keeps the mark off.
  hasLogo: options.logo === undefined ? options.flamingo !== false : options.logo !== false,
  isBandAnimated: options.bandAnimation !== false,
  isNudgingHandoff: options.handoffNudge !== false,
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
  isOpeningReport: options.reportOpen !== false,
  budgetEnforce: options.budgetEnforce === 'confirm' || options.budgetEnforce === 'block' ? options.budgetEnforce : 'warn',
  budgetGrace: Math.min(100, Math.max(0, Number(options.budgetGrace ?? 0) || 0)),
  envCheck: options.envCheck === 'check' || options.envCheck === 'enforce' ? options.envCheck : 'off',
  reportStyle: options.reportStyle === 'expressive' ? 'expressive' : 'exosphere',
  promptCheck: options.promptCheck === 'off' || options.promptCheck === 'suggest' ? options.promptCheck : 'confirm',
  promptModel: String(options.promptModel || 'haiku').trim() || 'haiku',
  promptRewrite: options.promptRewrite === 'manual' ? 'manual' : 'auto',
  promptSuggested: options.promptSuggested === 'check' ? 'check' : 'skip',
  activityLogPrompt: options.activityLogPrompt === 'never' ? 'never' : 'ask',
  seatBudgetUsd: Math.max(0, Number(options.seatBudgetUsd ?? 0) || 0),
  isReadingBreakdown: options.usageBreakdown !== false,
  promptView: options.promptView === 'manual' || options.promptView === 'off' ? options.promptView : 'auto',
  promptSkip: new Set(String(options.promptSkip ?? '').split(/[\s,]+/).filter(Boolean)),
  options: { ...options },
})

const PANE = 'boomi-dashboard'

/** The Prompt tab: a second pane, so Claude Code's tab row shows it beside the dashboard's. */
const PROMPT_PANE = 'boomi-dashboard-prompt'
const WATCH_KEY = 'watched'
const SCRIPTS_KEY = 'scriptsDir'
const DOCS_KEY = 'docIndex'
const THEME_KEY = 'theme'
const HISTORY_KEY = 'history'
const UPGRADE_KEY = 'upgradeCheckedAt'
/** Per folder: when an all-sessions report last read that folder's transcripts, and the sessions it found. */
const REPORT_SCAN_KEY = 'reportScan'
/** The newest version an update check found, and the newest already toasted (UpdateSeen). */
const UPDATE_SEEN_KEY = 'updateSeen'

/** How often the flamingo's frame moves on while Claude works. */
/** The rewrite's spinner turns this often, and only while a rewrite runs. */
const SPIN_MS = 250
const SPINNER = ['◐', '◓', '◑', '◒'] as const
const FLAMINGO_TICK_MS = 500

/** Boomi's coral, the banner's round mark when the icon is set to boomi. */

/** How often the banner's flamingo moves on. */
const BAND_FLAMINGO_TICK_MS = 1_000

/** How long the banner shows each line of a new session's recap and tips. */
const TIP_MS = 20_000

/** How often Companion's activity log is checked for steps Claude's tool calls didn't show. */
const LOG_CHECK_MS = 10_000

/** Companion's activity log, relative to the workspace, where its scripts write it. */
const ACTIVITY_LOG = '.activity-log/activity.jsonl'

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Saves one of the dashboard's settings where /config keeps it, and puts it to
 * work in this session. False when /config refused it (an organization's lock,
 * a value it won't take, no settings to write to): the caller keeps it its own way.
 */
const saveSetting = async ($: Engine, settings: Settings, field: string, value: Value): Promise<boolean> => {
  const done = await $.config.set({ key: `boomi-dashboard.${field}`, value }).catch(() => ({ deny: 'unavailable' }))
  if (done.deny !== undefined) return false
  Object.assign(settings, settingsFrom({ ...settings.options, [field]: value } as PluginOptions))
  return true
}

/** The pane's size, picked with /bc-dashboard size where /config wouldn't keep it; otherwise the settings'. 0 leaves it to Claude Code. */
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
    await saveSetting($, settings, 'paneRows', 0)
    await saveSetting($, settings, 'paneColumns', 0)
    return 'The dashboard pane is back to its usual size. Drag its edge to resize it by hand.'
  }
  const r = Number(rows)
  const c = columns ? Number(columns) : 0
  if (!Number.isInteger(r) || r < 8 || r > 200 || (columns && (!Number.isInteger(c) || c < 40 || c > 400))) {
    return 'Usage: /bc-dashboard size <rows 8-200> [columns 40-400]. With nothing after size, back to the default.'
  }
  const size = { rows: r, columns: c }
  if ((await saveSetting($, settings, 'paneRows', r)) && (await saveSetting($, settings, 'paneColumns', c))) {
    await update($, paneSize, () => null)
    await $.store.delete(SIZE_KEY).catch(() => undefined)
  } else {
    await update($, paneSize, () => size)
    await $.store.set(SIZE_KEY, size).catch(() => undefined)
  }
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
  const session = await $.session.id().catch(() => undefined)
  return { tokensAt: usage.tokens ?? 0, usdAt: usage.usd, model: usage.model, ...(session ? { session } : {}) }
}

const refreshStatus = async ($: Engine, settings: Settings) => {
  const now = await $.clock.now()
  const read0 = { ...(await usageOf($)), budgetUsd: settings.budgetUsd }
  const usage: Usage = await withUse($, { ...read0, companion: await companionBudget($, settings, read0) })
  usage.isPaused = await notePause($, settings, usage)
  const line = statusLine(await read($, dashboard), now, settings.windowMs, usage, (await read($, recap)) ?? undefined)
  const tips = settings.promptCheck === 'off' ? undefined : statusPart(await read($, promptTips), (await read($, promptHeld)) !== null)
  $.ui.status(tips ? `${line} · ${tips}` : line)
  await warnBudget($, settings, usage.usd)
  await warnLimits($, settings, usage)
  await trackShare($, settings, usage)
  await warnCompanion($, settings, usage)
  await warnExtra($, settings, usage)
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

/** Toasts once as the account's monthly Claude budget passes 80%, and once when it's spent, per month. */
const warnExtra = async ($: Engine, settings: Settings, usage: Usage) => {
  const x = usage.extraUsage
  if (!x) return
  const mark = x.percent >= 100 ? 100 : x.percent >= 80 ? 80 : 0
  const key = `extra-usage|${monthOf(usage.now ?? (await $.clock.now()))}`
  if (mark === 0 || mark <= ((await read($, limitAlerts))[key] ?? 0)) return
  await update($, limitAlerts, all => ({ ...all, [key]: mark }))
  toast($, settings, `${STATUS[mark >= 100 ? 'critical' : 'warning'].icon} ${mark >= 100 ? 'Your monthly Claude budget is used up' : `${Math.round(x.percent)}% of your monthly Claude budget used`} (${formatCost(x.usedUsd)} of ${formatCost(x.limitUsd)})`)
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
    // After a /clear, the folder's saved steps come back first, so this save doesn't write over them.
    await ensureSession($, settings)
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
    // Steps recorded before results printed twice counted once lose their echoes here.
    const all = repaired(withoutEchoes(saved?.activity ?? []))
    idFloor = (saved?.activity ?? []).reduce((max, a) => Math.max(max, a.id), 0)
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
      : run.verb
        ? { verb: run.verb }
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
  // Claude Code moved the command to the background (it outlasted the Bash timeout): what came back is its notice, not the script's output. The steps stay running, and `settleBackground` reads the result from the output file once it's there.
  // Believed only when the notice's task ID is the one in the result's own structured field: a script's printed text can say anything, but cannot set that.
  const noticed = ran.deny === undefined ? backgroundOf(output) : undefined
  const background = noticed && (ran.result as { backgroundTaskId?: unknown } | undefined)?.backgroundTaskId === noticed.id ? noticed : undefined
  if (background) {
    await record($, list => list.map(a => (started.some(s => s.id === a.id) ? { ...a, detail: 'running in the background', watchFile: background.file } : a)))
    void refreshStatus($, settings)
    void saveActivity($, settings)
    return
  }
  // Each result in the output is one step: a loop over six components is six.
  const { first, extras } = assignResults(
    started.filter(a => a.kind !== 'other' && a.kind !== 'pull'),
    ran.deny === undefined ? parseResults(output) : [],
  )
  const done: Activity[] = []
  const added: Activity[] = []
  const before = (await read($, dashboard)).activity
  let id = nextId(before)
  const finish = async (a: Activity, reading: Reading): Promise<Activity> => {
    // A create or pull writes the component's ID and name into its file.
    const path = a.file ?? reading.file
    const fresh = path && (a.kind === 'create' || a.kind === 'pull') ? await readComponent($, path) : {}
    const file = a.file ?? (reading.file ? componentPath(reading.file, settings.componentsDir) : undefined)
    const componentId = reading.componentId ?? fresh.componentId ?? a.componentId
    return {
      ...a,
      ...(file ? { file } : {}),
      outcome: reading.outcome,
      detail: reading.detail,
      endedAt,
      watchFile: undefined,
      // An ID only the output gave (the command's came from the shell) takes the name it has in another step.
      subject: reading.name ?? fresh.name ?? (a.subject === 'a component' && componentId ? knownName(before, componentId) : undefined) ?? a.subject,
      componentId,
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
    // With several scripts in one command, another script's lines aren't this run's result.
    const fallback = started.length > 1 ? unclaimedReading(isError) : readOutput(a.kind, output, isError)
    done.push(await finish(a, first.get(a.id) ?? fallback))
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

/** How long a backgrounded command is watched: a test polls for ten minutes at most, so this is well past its end. */
const BACKGROUND_GIVE_UP_MS = 30 * 60_000
const BACKGROUND_CHECK_MS = 5_000

/**
 * Steps whose command Claude Code moved to the background: reads each one's
 * output file, and when the script's final line is in it, settles the steps
 * as if the command had returned it. A file with nothing yet leaves them
 * running; past `BACKGROUND_GIVE_UP_MS` they say the result wasn't seen.
 */
const settleBackground = async ($: Engine, settings: Settings) => {
  const waiting = (await read($, dashboard)).activity.filter(a => a.watchFile && a.outcome === 'running')
  if (waiting.length === 0) return
  const now = await $.clock.now()
  for (const file of new Set(waiting.map(a => a.watchFile!))) {
    const group = waiting.filter(a => a.watchFile === file)
    const text = String(await $.fs.read(file).catch(() => '')).slice(0, 200_000)
    if (text && group.every(a => a.kind === 'other' || a.kind === 'pull' || isSettled(a.kind, text))) {
      await noteEnd($, settings, group, { text })
    } else if (now - Math.min(...group.map(a => a.startedAt)) > BACKGROUND_GIVE_UP_MS) {
      await record($, list => list.map(a => (group.some(g => g.id === a.id) ? { ...a, outcome: 'ok' as const, detail: 'result not seen', endedAt: now } : a)))
      void refreshStatus($, settings)
      void saveActivity($, settings)
    }
  }
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

/**
 * Reads the .env's environment from Boomi and keeps its name and
 * classification for the session. Off reads nothing. A failure is kept as a
 * note, and enforce mode then refuses the environment's changes.
 */
const loadEnvironment = async ($: Engine, settings: Settings): Promise<void> => {
  if (settings.envCheck === 'off') return
  const checkedAt = await $.clock.now()
  const loaded = await loadCredentials($, settings)
  if (typeof loaded === 'string') {
    await update($, envTarget, () => ({ checkedAt, environment: undefined, note: loaded }))
    return
  }
  const rows = await platformClient((url, init) => $.http.fetch(url, init), loaded)
    .environments()
    .catch(() => undefined)
  if (!rows) {
    await update($, envTarget, () => ({ checkedAt, environment: undefined, note: "Boomi's environment list couldn't be read" }))
    return
  }
  const environment = environmentNamed(environmentsFrom(rows), loaded.environmentId)
  const note = environment ? '' : "the .env's environment isn't in Boomi's environment list, so it can't be checked"
  await update($, envTarget, () => ({ checkedAt, environment, note }))
  if (settings.envCheck === 'enforce' && environment?.classification === 'PROD') {
    toast($, settings, `Production is read-only for Companion: deploys, undeploys and test runs to ${environment.name} are refused.`)
  }
}

/**
 * The refusal for a Companion deploy, undeploy or test run in the .env's
 * environment, in enforce mode. Reads the environment once if the session
 * didn't (a failed read counts as unknown, so the change is refused).
 */
const environmentRefusal = async ($: Engine, settings: Settings, command: string) => {
  if (settings.envCheck !== 'enforce') return undefined
  // Scripts the command runs (a deploy wrapper, a local helper) are read too, from the folder the command runs them in.
  const wrappers = await wrapperTexts($, command)
  if (environmentChanges(command).length === 0 && wrappers.every(({ text }) => environmentChanges(text).length === 0)) return undefined
  if ((await read($, envTarget)).checkedAt === 0) await loadEnvironment($, settings).catch(() => undefined)
  const target = await read($, envTarget)
  return environmentGate(command, settings.envCheck, target.environment, target.note || undefined, wrappers)
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
    const session = await $.session.id().catch(() => undefined)
    let added: Activity[] = []
    await update($, dashboard, c => {
      // A step's logKey keeps it from being added twice, however reads overlap.
      const keys = new Set(c.activity.map(a => a.logKey))
      let id = nextId(c.activity)
      added = steps.filter(step => !keys.has(step.logKey)).map(step => ({ ...step, id: id++, ...(session && !step.isRestored ? { session } : {}) }))
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

/** bc-bdi's scripts: the newest bc-bdi in the plugin cache. Undefined when it isn't installed. */
const findBdiScripts = async ($: Engine): Promise<string | undefined> => {
  const found = await $.process
    .run(['bash', '-c', 'ls -d "$HOME"/.claude/plugins/cache/*/bc-bdi/*/skills/boomi-bdi/scripts 2>/dev/null | sort -V | tail -1'], { timeoutMs: 10_000 })
    .catch(() => undefined)
  const dir = found?.stdout.trim()
  return dir ? dir : undefined
}

/**
 * Reads a failed BDI run's evidence the way bc-bdi's troubleshooting guide
 * does: the run's log (bdi-flow.sh logs, its ERROR lines) and, for a logic
 * flow, the first step that failed (bdi-flow.sh steps), led by the reason BDI
 * gave. Run in the workspace, so bc-bdi finds its own settings; read-only.
 */
const explainBdi = async ($: Engine, run: NonNullable<Attention['bdiRun']>): Promise<DiagnosisState> => {
  const key = logKeyOf({ bdiRun: run })!
  await setDiagnosis($, key, { phase: 'loading', source: 'bdi' })
  let state: DiagnosisState
  try {
    const scripts = await findBdiScripts($)
    if (!scripts) {
      state = { phase: 'error', source: 'bdi', error: "Couldn't find bc-bdi's scripts. Is the bc-bdi plugin installed?" }
    } else {
      const cwd = await $.session.cwd()
      const logs = await $.process.run(['bash', `${scripts}/bdi-flow.sh`, 'logs', run.flow, run.run], { cwd, timeoutMs: 120_000 })
      if (logs.exitCode !== 0) {
        const why = `${logs.stderr}\n${logs.stdout}`.split(/\r?\n/).map(line => line.trim()).find(Boolean)
        state = { phase: 'error', source: 'bdi', error: why ? why.slice(0, 300) : `bdi-flow.sh logs exited with ${logs.exitCode}.` }
      } else {
        // Only a logic flow has steps; any other answers with an error, which says nothing about the failure.
        const steps = await $.process.run(['bash', `${scripts}/bdi-flow.sh`, 'steps', run.flow, run.run], { cwd, timeoutMs: 120_000 }).catch(() => undefined)
        const step = steps && steps.exitCode === 0 ? bdiFailedStep(steps.stdout) : undefined
        const found = bdiDiagnosis(logs.stdout, run.reason, step)
        state = { phase: 'ready', source: 'bdi', lines: found.lines, severe: found.errors, warnings: found.warnings }
      }
    }
  } catch (error) {
    state = { phase: 'error', source: 'bdi', error: messageOf(error) }
  }
  await setDiagnosis($, key, state)
  return state
}

/** Why? for an item under Needs attention: a test's execution log, or a BDI run's. */
const explainItem = (
  $: Engine,
  settings: Settings,
  n: Pick<Attention, 'executionId' | 'bdiRun'>,
): Promise<DiagnosisState> | undefined =>
  n.executionId ? explain($, settings, n.executionId) : n.bdiRun ? explainBdi($, n.bdiRun) : undefined

/** Puts a fix request for a failed execution or BDI run in the prompt box, after whatever is typed there. */
const askToFix = async ($: Engine, n: Pick<Attention, 'title' | 'executionId' | 'bdiRun'>) => {
  const key = logKeyOf(n)
  const state = key ? (await read($, diagnoses))[key] : undefined
  if (state?.phase !== 'ready') return
  const draft = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const found = { lines: state.lines ?? [], severe: state.severe ?? 0, warnings: state.warnings ?? 0 }
  const text = n.executionId ? fixPrompt(n.title, n.executionId, found) : bdiFixPrompt(n.title, n.bdiRun!, found)
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
    fits: n => logKeyOf(n) !== undefined,
    none: 'Nothing to look into: no failed test or run under Needs attention has a log to read.',
    question: 'Which failure should the dashboard read the log of?',
    header: 'Why?',
    command: '/bc-dashboard why',
  })
  if (typeof item === 'string') return item
  const state = await explainItem($, settings, item)
  if (!state) return `${item.title} has no log to read.`
  const which = item.executionId ? `execution ${item.executionId}` : `BDI run ${item.bdiRun!.run}`
  if (state.phase !== 'ready') return `Couldn't read the log of ${which}: ${state.error}`
  return [`${item.title} (${which}):`, ...(state.lines ?? []).map(line => `  ${line}`)].join('\n')
}

/**
 * Runs a failed test again with the same arguments, through Companion's own
 * script, and records it as a new step: a pass clears the failure.
 */
const rerun = async ($: Engine, settings: Settings, stepId: number): Promise<string> => {
  const current = await read($, dashboard)
  const step = current.activity.find(a => a.id === stepId)
  const args = step?.args && rerunArgs(step.args, step.componentId)
  if (!step || !args) return 'That test has no command to repeat.'
  if (current.activity.some(a => a.kind === 'test' && a.outcome === 'running' && a.componentId === step.componentId)) {
    return `A test of ${step.subject} is already running.`
  }
  const scripts = await findScripts($)
  if (!scripts) return "Couldn't find Boomi Companion's scripts. Run any Companion script once, then try again."
  const run: ScriptRun = { kind: 'test', args }
  if (step.componentId) run.processId = step.componentId
  const started = await noteStart($, settings, [run])
  let ran: Ran
  try {
    const result = await $.process.run(['bash', `${scripts}/boomi-test-execute.sh`, ...args], {
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
  const state = await read($, dashboard)
  return report(
    state,
    { session: footer.session, date: new Date(now).toISOString().slice(0, 10), repo: footer.repo, usage: await withBudget($, settings), changes: changeLines(state.activity), promptLines: reportLines(await read($, promptCounts)) },
    now,
    settings.windowMs,
  )
}

/** The dashboard's version, from its own plugin.json. */
const ownVersion = async ($: Engine): Promise<string | undefined> => {
  const json = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => undefined)
  return typeof json === 'string' ? json.match(/"version"\s*:\s*"([^"]+)"/)?.[1] : undefined
}

/** The pane's quiet Report button: the same page as /bc-dashboard report html, its outcome as a toast. */
const reportFromPane = async ($: Engine, settings: Settings) => {
  $.ui.toast('Making the report…')
  const said = await reportHtmlCommand($, settings, []).catch(() => 'The report could not be made.')
  $.ui.toast(said.split('\n')[0]!)
}

/**
 * /bc-dashboard report html: the report as one HTML file in the workspace, to
 * open in a browser or send to someone: Valence Day and Night, sortable
 * tables, a filterable list of steps and the spend charted.
 */
/** The report's style: --style <name> (or --style=<name>) on the command, else the reportStyle setting. */
const styleOf = (words: readonly string[], settings: Settings): ReportStyle => {
  const at = words.findIndex(w => w === '--style' || w.startsWith('--style='))
  const named = at < 0 ? undefined : words[at]!.includes('=') ? words[at]!.split('=')[1] : words[at + 1]
  return named === 'expressive' || named === 'exosphere' ? named : settings.reportStyle
}

const reportHtmlCommand = async ($: Engine, settings: Settings, words: readonly string[]): Promise<string> => {
  const now = await $.clock.now()
  const footer = await footerOf($)
  const current = await read($, dashboard)
  // This session, or every session this folder kept: asked when there's a choice to make.
  let scope: ReportScope = words.includes('all') ? 'all' : 'session'
  if (!words.includes('all') && !words.includes('session') && hasEarlierSteps(current)) {
    const options = ['This session', 'All sessions in this folder']
    const answer = await $.ui
      .ask('Which steps should the report cover?', { header: 'Report', options })
      .catch(() => undefined)
    if (answer === undefined) return 'No report made. Run /bc-dashboard report html session or /bc-dashboard report html all to skip the question.'
    scope = answer === options[1] || /all/i.test(answer) ? 'all' : 'session'
  }
  const view = scoped(current, scope)
  const usage = await withBudget($, settings)
  const sessionId = await $.session.id().catch(() => undefined)
  const cwd = await $.session.cwd()
  const page = reportHtml(
    view,
    {
      session: footer.session,
      sessionId,
      date: new Date(now).toISOString().slice(0, 10),
      usage,
      version: await ownVersion($),
      scope,
      folder: cwd.split('/').filter(Boolean).pop(),
      boomi: await boomiFacts($, settings, view),
      cwd,
      budgets: budgetLines(usage, settings),
      ...(settings.budgetUsd > 0 ? { sessionBudgetUsd: settings.budgetUsd } : {}),
      ...(scope === 'all' ? { pastSessions: await pastForReport($, view, cwd) } : {}),
      style: styleOf(words, settings),
    },
    now,
    settings.windowMs,
  )
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const path = `${cwd}/boomi-${scope === 'all' ? 'sessions' : 'session'}-report-${stamp}.html`
  await $.fs.write(path, page)
  const opened = settings.isOpeningReport && !words.includes('--no-open') ? await openInBrowser($, path) : false
  return [
    `Saved the report as a web page: ${path}`,
    opened
      ? 'Opened it in your browser. It is one file with nothing live in it and no credentials, so you can send it as it is.'
      : 'Open it in a browser (it works offline; with a connection it also loads the fonts). It is one file with nothing live in it and no credentials, so you can send it as it is.',
    `In it: ${scope === 'all' ? 'every session this folder kept, each with its steps and cost; ' : ''}the Boomi account, each component's ID, type, folder and version in Boomi with a link to open it, every deploy's package and test's execution ID, sortable tables, the steps filtered by product or by what failed, and the charts.`,
  ].join('\n')
}

/**
 * Past Companion sessions for an all-sessions report: their IDs, times and
 * Claude Code's own costs. The last scan answers when it covers every step
 * that names no session (a past session's cost never changes). Otherwise only
 * this folder's transcripts are read, and only those written since the
 * earliest such step: never the whole machine's history, which can take
 * minutes. What can't be read leaves those steps counted as "at least".
 */
const pastForReport = async ($: Engine, view: Dashboard, cwd: string) => {
  const key = `${REPORT_SCAN_KEY}:${cwd}`
  const kept = (await $.store.get(key).catch(() => undefined)) as { at?: number; sessions?: PastSession[] } | undefined
  const fromScan = (await read($, history)).sessions ?? []
  const known = [...fromScan.filter(k => !(kept?.sessions ?? []).some(f => f.id === k.id)), ...(kept?.sessions ?? [])]
  const missing = stepsToMatch(view.activity, known, cwd)
  if (missing.length === 0) return known
  // Scanned after the last of these steps had long ended: their transcripts were there to find, so a rescan finds nothing new.
  const latest = Math.max(...missing.map(a => a.endedAt ?? a.startedAt))
  if (kept?.at !== undefined && kept.at > latest + 3_600_000) return known
  const config = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) || `${(await $.env.get('HOME').catch(() => undefined)) ?? ''}/.claude`
  const folder = transcriptsFolder(config, cwd)
  if (!(await $.fs.exists(folder).catch(() => false))) return known
  const since = Math.min(...missing.map(a => a.startedAt)) - 86_400_000
  const ran = await runScan($, ['--root', folder, '--since', String(since)]).catch(() => undefined)
  if (!ran || ran.exitCode !== 0 || ran.isStdoutTruncated) return known
  try {
    const found = pastSessions(JSON.parse(ran.stdout) as { sessions?: [] })
    const merged = [...(kept?.sessions ?? []).filter(k => !found.some(f => f.id === k.id)), ...found]
    await $.store.set(key, { at: await $.clock.now(), sessions: merged }).catch(() => undefined)
    return [...known.filter(k => !found.some(f => f.id === k.id)), ...found]
  } catch {
    return known
  }
}

/**
 * The Boomi account and the report's components as Boomi has them now, read
 * with Companion's credentials: never the token or the user name, only IDs,
 * names, types, folders and versions. What can't be read is said, not guessed.
 */
const boomiFacts = async ($: Engine, settings: Settings, view: Dashboard): Promise<BoomiFacts> => {
  const loaded = await loadCredentials($, settings).catch(() => 'unavailable')
  if (typeof loaded === 'string') return { components: {}, note: `Boomi's own details aren't included: ${loaded}` }
  const facts: BoomiFacts = { accountId: loaded.accountId, environmentId: loaded.environmentId, apiHost: loaded.apiUrl.replace(/^https?:\/\//, ''), components: {} }
  const client = platformClient((url, init) => $.http.fetch(url, init), loaded)
  const ids = components(view.activity).flatMap(row => (row.componentId ? [row.componentId] : []))
  const [name, found] = await Promise.all([
    client.accountName().catch(() => undefined),
    client.componentDetails(ids).catch((error: unknown) => {
      facts.note = `Boomi's current details for the components couldn't be read: ${messageOf(error)}`
      return []
    }),
  ])
  if (name) facts.accountName = name
  for (const d of found) facts.components[d.componentId] = d
  return facts
}

/**
 * Opens a file in the person's browser with the system's own opener: open on
 * macOS, wslview or Explorer under WSL, start on Windows, xdg-open where
 * there's a desktop. False where there's none (a container, a server).
 */
const openInBrowser = async ($: Engine, path: string): Promise<boolean> => {
  const ran = await $.process.run(['bash', '-c', OPEN_SCRIPT, 'open-report', path], { timeoutMs: 15_000 }).catch(() => undefined)
  return ran?.exitCode === 0
}

const OPEN_SCRIPT = [
  'case "$(uname -s)" in',
  '  Darwin) exec open "$1" ;;',
  '  MINGW*|MSYS*|CYGWIN*) exec cmd //c start "" "$1" ;;',
  'esac',
  'if grep -qi microsoft /proc/version 2>/dev/null; then',
  '  if command -v wslview >/dev/null 2>&1; then exec wslview "$1"; fi',
  '  if command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$(wslpath -w "$1")"; exit 0; fi',
  'fi',
  'if command -v xdg-open >/dev/null 2>&1 && { [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; }; then exec xdg-open "$1"; fi',
  'exit 3',
].join('\n')

/** /bc-dashboard report [save|html [session|all] [--no-open] [--style exosphere|expressive]]: the report as text; save also writes it as Markdown, html as a web page. */
const reportCommand = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  const words = target.split(/\s+/).filter(Boolean)
  if (words[0] === 'html') return reportHtmlCommand($, settings, words.slice(1))
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

/**
 * Picks the pane's theme, now and for later sessions: saved in /config where it
 * will take it, else kept in the dashboard's own store. The pane redraws at once.
 */
const pickTheme = async ($: Engine, settings: Settings, theme: PaneTheme) => {
  await update($, pickedTheme, () => theme)
  if (await saveSetting($, settings, 'paneTheme', theme)) {
    await $.store.delete(THEME_KEY).catch(() => undefined)
    await update($, pickedTheme, () => null)
  } else {
    await $.store.set(THEME_KEY, theme).catch(() => undefined)
  }
}

const themeOf = async ($: Engine, settings: Settings): Promise<PaneTheme> => (await read($, pickedTheme)) ?? settings.paneTheme

/** How long the operating system's light or dark is trusted before it is asked again. */
const APPEARANCE_MS = 30_000

let appearanceCache: { at: number; isDark: boolean } | undefined

/** Whether the operating system is in dark mode. macOS is asked; anywhere it can't be read the answer is light, and nothing is thrown. */
const isOsDark = async ($: Engine): Promise<boolean> => {
  const now = await $.clock.now()
  if (appearanceCache && now - appearanceCache.at < APPEARANCE_MS) return appearanceCache.isDark
  const asked = await $.process.run(['defaults', 'read', '-g', 'AppleInterfaceStyle'], { timeoutMs: 2_000 }).catch(() => undefined)
  appearanceCache = { at: now, isDark: isDarkAppearance(asked?.stdout) }
  return appearanceCache.isDark
}

/** The theme the pane and banner draw now: what is picked, with `auto` settled by the operating system's light or dark. */
const drawnThemeOf = async ($: Engine, settings: Settings): Promise<DrawnTheme> => {
  const picked = await themeOf($, settings)
  return resolveTheme(picked, settings.themeFamily, picked === 'auto' ? await isOsDark($) : false)
}

/** True where the terminal can draw the logo as a picture. */
const drawsPicturesHere = async ($: Engine): Promise<boolean> =>
  drawsPictures({ TERM: await $.env.get('TERM').catch(() => undefined), TERM_PROGRAM: await $.env.get('TERM_PROGRAM').catch(() => undefined) })

/** /bc-dashboard theme [name]: picks one, or lists them. Day and night, the names earlier versions used, pick Whimsical's light and dark. */
const theme = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  const wanted = themeNamed(target)
  if (wanted) {
    await pickTheme($, settings, wanted)
    return `Dashboard theme: ${THEME_NAMES[wanted]}.`
  }
  const current = await themeOf($, settings)
  const list = THEMES.map(t => `${t === current ? '◆' : '◇'} ${t}`).join('   ')
  return `${target ? `No theme called ${target}. ` : ''}Themes: ${list}\nPick one with /bc-dashboard theme <name> (auto follows your system's light or dark), or with the Theme picker at the bottom of the pane.`
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
  '/bc-dashboard components      copy every component with its IDs for a spreadsheet (csv: as CSV; save: also write a .csv file)',
  '/bc-dashboard report html     the session as a web page to open in a browser or share: one file, sortable and filterable (--style expressive for the Valence look)',
  '/bc-dashboard history         past Companion sessions on this machine and what each cost',
  '/bc-dashboard resume [n]      copy the command that reopens a past session in a new terminal',
  '/bc-dashboard review [n]      what made a past session cost what it did, and what to change next time',
  '/bc-dashboard prompt [use|upgrade|guide] your last Boomi prompt\'s tips and an upgraded prompt; use puts it in the prompt box, upgrade has a model rewrite it',
  '/bc-dashboard activity-log [on|off|status|never] turn Companion\'s activity log on or off in its env file (one line, asked first), or stop the offer',
  '/bc-dashboard seen            mark watched changes as seen (expected)',
  '/bc-dashboard banner          show the banner above the prompt again',
  '/bc-dashboard theme [name]    the pane\'s colors: auto, exosphere-light, exosphere-dark, whimsical-light, whimsical-dark or terminal',
  '/bc-dashboard config [group]  walk through the dashboard\'s settings (budget, pane, data); config <setting> <value> sets one; config list shows them',
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
  return withUse($, { ...usage, companion: await companionBudget($, settings, usage) })
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
    case 'components':
      return componentsCommand($, settings, target)
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
    case 'config':
    case 'settings':
      return configCommand($, settings, target)
    case 'prompt':
      return promptCommand($, settings, target)
    case 'activity-log':
      return activityLogCommand($, settings, target)
    case 'banner':
      await update($, isBandHidden, () => false)
      return 'The dashboard banner is back above the prompt.'
    default:
      return USAGE
  }
}

// --- Prompt tips ---------------------------------------------------------------------

const SEND_MASKED = 'Send it with the secret masked'
const SEND_AS_TYPED = 'Send it as typed'
const USE_UPGRADE = 'Use the upgrade'
const EDIT_FIRST = 'Edit it first'

/** Typed by the person: the prompt box, Remote Control, an SDK host, or a plugin sending the person's own words. */
const isTyped = (origin: PromptSubmitInput['origin']) =>
  origin.kind === 'composer' ||
  origin.kind === 'bridge' ||
  origin.kind === 'sdk' ||
  // A prompt the dashboard sends from the Prompt tab is never checked again, so it can't come back to the tab.
  (origin.kind === 'plugin' && (origin as { asUser?: boolean }).asUser === true && (origin as { name?: string }).name !== 'boomi-dashboard')

/** The environment Companion points at: the session's own variable, else its .env. Only that key is read. */
const environmentOf = async ($: Engine, settings: Settings): Promise<string | undefined> => {
  const fromEnv = await $.env.get('BOOMI_ENVIRONMENT_ID').catch(() => undefined)
  if (fromEnv) return fromEnv
  const path = await envPath($, settings)
  if (!(await $.fs.exists(path).catch(() => false))) return undefined
  return parseEnv(String(await $.fs.read(path).catch(() => ''))).BOOMI_ENVIRONMENT_ID || undefined
}

/** What the session knows that a prompt might lean on: the last component, the environment, the last failure. */
const promptFacts = async ($: Engine, settings: Settings): Promise<PromptFacts> => {
  const current = await read($, dashboard)
  const recent = current.activity.filter(a => !a.isEarlier)
  const rows = components(recent).sort((a, b) => b.lastAt - a.lastAt)
  const last = rows[0]
  const failed = [...recent].reverse().find(a => a.outcome === 'failed' && !(current.closedSteps ?? []).includes(a.id))
  return {
    component: last ? { name: last.name, type: last.type, id: last.componentId } : undefined,
    names: rows.map(r => r.name),
    environmentId: current.platform.environmentId ?? (await environmentOf($, settings)),
    failed: failed ? { name: failed.kind === 'test' ? `the test of ${failed.subject}` : describe(failed), executionId: failed.executionId, detail: failed.detail } : undefined,
  }
}

/** Puts text in the prompt box; false where no box could take it, so nothing typed is ever dropped. */
const refill = async ($: Engine, text: string) => (await $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined))?.isFilled === true

/** The commands that close a session out, or save what it did for the next. */
const CLOSING_COMMANDS: ReadonlySet<string> = new Set(['exit', 'quit', 'clear', 'handoff'])

/** Lets go of a prompt the dashboard was holding or tipping about: its tips, its note, the Prompt tab. */
const clearPromptCheck = async ($: Engine, settings: Settings) => {
  await update($, promptHeld, () => null)
  await update($, promptTips, () => null)
  await update($, promptNote, () => '')
  await refreshStatus($, settings).catch(() => undefined)
  await closePromptTab($, settings)
}

/**
 * Checks a prompt the person typed in a Companion folder. Undefined lets it
 * through as typed; `text` sends another text (the `>` taken off, or the
 * secret masked); `drop` holds it, its text already back in the prompt box.
 */
const checkSubmitted = async ($: Engine, settings: Settings, e: PromptSubmitInput): Promise<{ text?: string; drop?: string } | undefined> => {
  // Closing out comes first: whatever the dashboard was holding or tipping about is let go of, so nothing stands between the person and the way out.
  if (e.command && CLOSING_COMMANDS.has(e.command.name)) {
    await clearPromptCheck($, settings)
    return undefined
  }
  if (settings.promptCheck === 'off' || e.command || e.isMeta || e.turnId || !isTyped(e.origin)) return undefined
  const typed = e.text
  if (!(await read($, isCompanionFolder)) && !((await read($, companionPlugins))?.length)) return undefined
  if (/^\s*>/.test(typed)) return { text: typed.replace(/^\s*>\s?/, '') }
  const hasSecret = findSecrets(typed).length > 0
  // A wrap-up in words ("write a handoff for the Orders Sync process") is not work to check, whatever Boomi word it holds; a secret in one still asks.
  if (!hasSecret && isClosingOut(typed)) {
    await clearPromptCheck($, settings)
    return undefined
  }
  // A suggestion taken with Tab and sent as it was isn't the person's own words: Claude's guess, or the dashboard's next step. Each is taken once, and a secret is still asked about.
  const taken = isSuggestionTaken(typed, [await read($, shownSuggestion), await read($, suggested)])
  if (taken) await update($, shownSuggestion, () => '')
  if (taken && !hasSecret && settings.promptSuggested === 'skip') {
    await update($, promptHeld, () => null)
    await update($, promptCounts, c => ({ ...c, suggested: (c.suggested ?? 0) + 1 }))
    await update($, promptTips, () => null)
    await update($, promptNote, () => '')
    await refreshStatus($, settings).catch(() => undefined)
    await closePromptTab($, settings)
    return undefined
  }
  if (!hasSecret && !isCheckable(typed)) return undefined
  // A new prompt takes the place of one still held, and its cards start fitted to the pane.
  await update($, promptHeld, () => null)
  await update($, promptExpanded, () => false)
  const facts = await promptFacts($, settings)
  const tips = checkPrompt(typed, facts, settings.promptSkip)
  const before = await read($, promptTips)
  await update($, promptCounts, c => countsAfter(c, before?.tips, tips))
  const upgrade = tips.length > 0 ? upgradePrompt(typed, facts, tips) : ''
  const at = await $.clock.now()
  await update($, promptTips, (): PromptTips | null =>
    tips.length > 0 ? { at, masked: maskPrompt(typed).trim().slice(0, 4000), tips, upgrade, tries: [{ text: upgrade, by: 'the checks' }], shown: 0 } : null,
  )
  await update($, promptNote, () => '')
  await refreshStatus($, settings).catch(() => undefined)
  if (tips.length === 0) {
    await closePromptTab($, settings)
    return undefined
  }
  if (settings.promptView === 'auto') await showPromptTab($, tips.length)
  // A timer, not a bare call: the model call outlives this hook, which would abort it. A secret alone has nothing to rewrite.
  if (settings.promptRewrite === 'auto' && tips.some(t => t.code !== 'secret')) $.clock.after(0, () => autoRewrite($, settings, at).catch(() => undefined))

  // A secret asks in any mode: once sent, it's in the transcript. No answer sends it masked.
  if (hasSecret) {
    const kinds = findSecrets(typed).join(' and ')
    const answer = await $.ui
      .ask(`Your prompt has ${kinds} in it. Once it's sent, it stays in the transcript. Send it with the secret masked?`, { header: 'Secret', options: [SEND_MASKED, EDIT_FIRST, SEND_AS_TYPED] })
      .catch(() => undefined)
    if (answer === SEND_AS_TYPED) return undefined
    if (answer === EDIT_FIRST && (await refill($, typed))) return { drop: 'Held by the dashboard: your prompt is back in the prompt box to edit.' }
    return { text: maskPrompt(typed) }
  }
  if (settings.promptCheck !== 'confirm') return undefined
  // A look around changes nothing in Boomi: its tip nudges, and holds nothing on its own.
  if (tips.every(t => NUDGE_ONLY.has(t.code))) return undefined
  // Confirm holds the prompt in the Prompt tab, where the person sends it, the upgrade, or neither. Claude doesn't see it until then.
  if (settings.promptView !== 'off' && (await showPromptTab($, tips.length))) {
    await update($, promptHeld, () => typed)
    await refreshStatus($, settings).catch(() => undefined)
    return { drop: 'Held by the Boomi Dashboard: Claude hasn\'t seen it yet. Send it, or the upgrade, from Boomi Dashboard Prompt tips.' }
  }
  // Where the tab can't show (the web, a narrow window), a question instead.
  const said = tips.map(t => t.text).join('; ')
  const answer = await $.ui
    .ask(`This prompt leaves out: ${said}. Send it as typed?`, { header: 'Prompt', options: [SEND_AS_TYPED, USE_UPGRADE, EDIT_FIRST] })
    .catch(() => undefined)
  if (answer === USE_UPGRADE && (await refill($, upgrade))) return { drop: 'Held by the dashboard: the upgraded prompt is in the prompt box. Fill in any [placeholder], then press Enter.' }
  if (answer === EDIT_FIRST && (await refill($, typed))) return { drop: 'Held by the dashboard: your prompt is back in the prompt box to edit.' }
  return undefined
}

/** The Prompt tab's title, in its tab: "Boomi Dashboard Prompt tips · 3". */
const promptTitle = (count: number) => `Boomi Dashboard Prompt tips · ${count}`

/** Opens (or retitles) the Prompt tab; whether a surface draws it. */
const openPromptTab = async ($: Engine, count: number) =>
  (await $.ui.open({ id: PROMPT_PANE, title: promptTitle(count) }).catch(() => undefined))?.isPlaced === true

/** True while the dashboard pane is closed to show the Prompt tab, so leaving the tab brings the dashboard back. */
let isDashboardSwappedOut = false

/**
 * Shows the Prompt tab. Claude Code has no call that brings a tab forward,
 * and a pane opened while another is shown can wait behind it, so a shown
 * dashboard pane closes first and comes back when the tab is left.
 */
const showPromptTab = async ($: Engine, count: number) => {
  const open = await $.ui.panes().catch(() => [])
  if (open.some(pane => pane.id === PANE && pane.isShown)) {
    isDashboardSwappedOut = true
    await $.ui.close({ id: PANE }).catch(() => undefined)
  }
  return openPromptTab($, count)
}

/** Closes the Prompt tab if it's open (a prompt with nothing to add, Dismiss, ◀ Dashboard), and brings back the dashboard it took the place of. */
const closePromptTab = async ($: Engine, settings: Settings) => {
  const open = await $.ui.panes().catch(() => [])
  if (open.some(pane => pane.id === PROMPT_PANE)) await $.ui.close({ id: PROMPT_PANE }).catch(() => undefined)
  if (isDashboardSwappedOut) {
    isDashboardSwappedOut = false
    await openPane($, settings).catch(() => undefined)
  }
}

/** Sends a held prompt (or its upgrade) as the person's own words; the dashboard never checks its own sends. */
const sendHeld = async ($: Engine, settings: Settings, which: 'upgrade' | 'typed') => {
  const held = await read($, promptHeld)
  const tips = await read($, promptTips)
  if (held === null || !tips) return
  const text = which === 'upgrade' ? tips.upgrade : held
  await update($, promptHeld, () => null)
  await update($, promptNote, () => (which === 'upgrade' ? 'Sent the upgrade to Claude.' : 'Sent your prompt to Claude as typed.'))
  await refreshStatus($, settings).catch(() => undefined)
  await closePromptTab($, settings)
  // A held prompt went back to the box when it was dropped; sending it from here leaves that copy behind, so clear it, unless the person has typed something else since.
  const box = await $.prompt.read().catch(() => undefined)
  if (box && box.text.trim() === held.trim()) await $.prompt.fill({ text: '', mode: 'replace' }).catch(() => undefined)
  await $.prompt.submit({ text, asUser: true }).catch(() => undefined)
}

/** Puts the upgrade in the prompt box to edit; the held prompt stays unsent. (The box already holds what was typed: a dropped prompt goes back to it.) */
const editHeld = async ($: Engine, settings: Settings) => {
  const held = await read($, promptHeld)
  const tips = await read($, promptTips)
  if (held === null || !tips) return
  if (!(await refill($, tips.upgrade))) {
    await update($, promptNote, () => "The prompt box couldn't take it here: send it from here instead.")
    return
  }
  await update($, promptHeld, () => null)
  await update($, promptNote, () => 'The upgrade is in the prompt box to edit. Nothing was sent.')
  await refreshStatus($, settings).catch(() => undefined)
}

/** Drops a held prompt: nothing is sent. */
const discardHeld = async ($: Engine, settings: Settings) => {
  await update($, promptHeld, () => null)
  await update($, promptNote, () => 'Discarded: nothing was sent.')
  await refreshStatus($, settings).catch(() => undefined)
}

/** The folder's components, read once a minute at most. */
let retrieved: { at: number; components: FolderComponent[] } | undefined

/** Every component XML under the components folder (up to 200 files, three folders deep). */
const folderComponents = async ($: Engine, settings: Settings): Promise<FolderComponent[]> => {
  const now = await $.clock.now()
  if (retrieved && now - retrieved.at < 60_000) return retrieved.components
  const cwd = await $.session.cwd()
  const root = settings.componentsDir.startsWith('/') ? settings.componentsDir : `${cwd}/${settings.componentsDir}`
  const files: string[] = []
  const walk = async (dir: string, depth: number) => {
    if (depth > 3 || files.length >= 200) return
    for (const entry of await $.fs.list(dir).catch(() => [])) {
      if (entry.kind === 'dir') await walk(`${dir}/${entry.name}`, depth + 1)
      else if (entry.kind === 'file' && entry.name.endsWith('.xml') && files.length < 200) files.push(`${dir}/${entry.name}`)
    }
  }
  await walk(root, 0)
  const components: FolderComponent[] = []
  for (const file of files) {
    const found = folderComponentOf(String(await $.fs.read(file).catch(() => '')).slice(0, 4000))
    if (found && !components.some(c => c.name === found.name && c.type === found.type)) components.push(found)
  }
  retrieved = { at: now, components }
  return components
}

/** Each Companion plugin on this machine: its newest installed version and its folder (with a trailing slash), from Claude Code's plugin cache. */
const installedCompanion = async ($: Engine): Promise<Record<string, { version: string; dir: string }>> => {
  const names = COMPANION_PLUGINS.map(p => p.name).join(' ')
  const found = await $.process
    .run(['bash', '-c', `for n in ${names}; do d=$(ls -d "$HOME"/.claude/plugins/cache/*/$n/*/ 2>/dev/null | sort -V | tail -1); [ -n "$d" ] && echo "$n=$d"; done`], { timeoutMs: 10_000 })
    .catch(() => undefined)
  const out: Record<string, { version: string; dir: string }> = {}
  for (const line of (found?.stdout ?? '').split('\n')) {
    const [name, dir] = line.trim().split('=')
    if (name && dir) out[name] = { version: dir.replace(/\/$/, '').split('/').pop() ?? '', dir }
  }
  return out
}

/** The index of Companion's reference docs, kept in memory and in the store. */
let docIndex: DocIndex | undefined

/** Every Markdown doc under a plugin's skills' references folders (up to 400, four folders deep), as paths from the plugin's folder. */
const referenceDocs = async ($: Engine, dir: string): Promise<string[]> => {
  const files: string[] = []
  const walk = async (rel: string, depth: number) => {
    if (depth > 4 || files.length >= 400) return
    for (const entry of await $.fs.list(`${dir}${rel}`).catch(() => [])) {
      if (entry.kind === 'dir') await walk(`${rel}/${entry.name}`, depth + 1)
      else if (entry.kind === 'file' && entry.name.endsWith('.md') && files.length < 400) files.push(`${rel}/${entry.name}`)
    }
  }
  for (const skill of await $.fs.list(`${dir}skills`).catch(() => [])) if (skill.kind === 'dir') await walk(`skills/${skill.name}/references`, 0)
  return files
}

/**
 * Companion's docs as an index of pointers (retrieve.ts): kept from the last
 * session while every plugin's version is the one it was built for, and
 * rebuilt when one changes, reading each doc again only to see whether it did.
 */
const companionDocs = async ($: Engine): Promise<{ index: DocIndex; installed: Record<string, { version: string; dir: string }> }> => {
  const installed = await installedCompanion($)
  let index = docIndex
  if (!index) {
    const stored = (await $.store.get(DOCS_KEY).catch(() => undefined)) as DocIndex | undefined
    index = stored?.built === 1 ? stored : EMPTY_INDEX
  }
  if (!isCurrent(index, installed)) {
    const files: DocIndex['files'] = {}
    for (const [plugin, { dir }] of Object.entries(installed)) {
      for (const rel of await referenceDocs($, dir)) {
        const key = `${plugin}:${rel}`
        files[key] = indexFile(plugin, rel, String(await $.fs.read(`${dir}${rel}`).catch(() => '')).slice(0, 150_000), index.files[key])
      }
    }
    index = { built: 1, plugins: installed, files }
    await $.store.set(DOCS_KEY, index).catch(() => undefined)
  }
  docIndex = index
  return { index, installed }
}

/** The sections of Companion's docs that best match a prompt, read from the docs themselves, and the plugins (with versions) they came from. */
const companionSections = async ($: Engine, prompt: string): Promise<{ sections: Section[]; guidedBy: string[] }> => {
  const { index, installed } = await companionDocs($)
  const read_: Section[] = []
  const texts = new Map<string, Section[]>()
  for (const place of relevantPlaces(index, prompt)) {
    const dir = installed[place.file.plugin]?.dir
    if (!dir) continue
    const path = `${dir}${place.file.file}`
    const all = texts.get(path) ?? sectionsOf(docName(place.file), String(await $.fs.read(path).catch(() => '')))
    texts.set(path, all)
    const found = all.find(s => s.heading === place.heading)
    if (found) read_.push(found)
  }
  const sections = relevantSections(read_, prompt)
  const guidedBy = [...new Set(sections.map(s => s.source.split('/')[0]!))].map(name => `${name} ${installed[name]?.version ?? ''}`.trim())
  return { sections, guidedBy }
}

/** The Prompt tab's Upgrade with a model and Regenerate: the same rewrite as /bc-dashboard prompt upgrade, its first line kept as the note. */
const rewriteFromTab = async ($: Engine, settings: Settings, note?: string) => {
  if (await read($, promptBusy)) return
  await update($, promptBusy, () => true)
  try {
    const isHeld = (await read($, promptHeld)) !== null
    const said = await rewritePrompt($, settings, note, !isHeld)
    await update($, promptNote, () => said.split('\n')[0] ?? '')
  } catch (error) {
    await update($, promptNote, () => `The rewrite didn't work: ${messageOf(error)}. Your prompt is safe.`)
  } finally {
    await update($, promptBusy, () => false)
  }
}

/** The prompt whose automatic rewrite is running, so a newer prompt's takes its place. */
let autoRewriting = 0

/**
 * With promptRewrite auto, the model's rewrite of a prompt that got tips, in
 * the background: the checks' upgrade shows at once and this takes its place
 * as the next try. It never fills the prompt box (the person may be editing
 * there), and a failure leaves the checks' upgrade where it is.
 */
const autoRewrite = async ($: Engine, settings: Settings, at: number) => {
  autoRewriting = at
  await update($, promptBusy, () => true)
  try {
    const said = await rewritePrompt($, settings, undefined, false, at)
    if (said && autoRewriting === at) await update($, promptNote, () => said.split('\n')[0] ?? '')
  } catch (error) {
    if (autoRewriting === at) await update($, promptNote, () => `The rewrite didn't work: ${messageOf(error)}. The upgrade from the checks is still there.`)
  } finally {
    if (autoRewriting === at) await update($, promptBusy, () => false)
  }
}

/** Shows another try in the Prompt tab: the one before or after. */
const showTry = async ($: Engine, step: number) =>
  update($, promptTips, t => {
    const tries = t?.tries ?? []
    if (!t || tries.length < 2) return t
    const shown = Math.min(tries.length - 1, Math.max(0, (t.shown ?? tries.length - 1) + step))
    const pick = tries[shown]!
    return { ...t, shown, upgrade: pick.text, rewrittenBy: pick.by === 'the checks' ? undefined : pick.by, tokens: pick.tokens, why: pick.why }
  })

/**
 * A model's rewrite of the last prompt's upgrade, on demand. It reads the
 * masked prompt, the session's facts, the folder's components and the
 * sections of Companion's reference docs that match the prompt, the person's
 * note, and the try before; never Companion's .env. Each try is kept.
 */
const rewritePrompt = async ($: Engine, settings: Settings, note?: string, isFilling = true, onlyFor?: number): Promise<string> => {
  const tips = await read($, promptTips)
  if (!tips) return 'Nothing to upgrade yet: no Boomi prompt this session has had tips.'
  const facts = await promptFacts($, settings)
  const components = relevantComponents(await folderComponents($, settings).catch(() => [] as FolderComponent[]), tips.masked)
  const { sections, guidedBy } = await companionSections($, tips.masked).catch(() => ({ sections: [] as Section[], guidedBy: [] as string[] }))
  const guide = guideFor(((await read($, companionPlugins)) ?? []).map(p => p.name))
  const tries = tips.tries ?? [{ text: tips.upgrade, by: 'the checks' }]
  const previous = tries.length > 1 ? tips.upgrade : undefined
  const reply = await $.model.complete({
    model: settings.promptModel,
    system: rewriteSystem([], guide),
    prompt: rewriteRequest(tips.masked, facts, tips.tips, tries[0]!.text, { context: contextLines(components, sections), note: note?.trim() || undefined, previous }),
    maxTokens: 1000,
    effort: 'low',
  })
  if (!reply.isAnswered) {
    return `${settings.promptModel} couldn't rewrite it (${reply.reason}). Your prompt is safe, and the upgrade from the checks is still there: /bc-dashboard prompt use.`
  }
  const parts = rewriteParts(reply.text)
  if (!parts) return `${settings.promptModel} gave back nothing. The upgrade from the checks is still there: /bc-dashboard prompt use.`
  const { text, why } = parts
  const tokens = reply.usage.input_tokens + reply.usage.output_tokens
  const added: PromptTry = { text, by: settings.promptModel, tokens, ...(why.length > 0 ? { why } : {}), ...(note?.trim() ? { note: note.trim() } : {}) }
  // A newer prompt took this one's place while the model worked: its tips are not this rewrite's to change.
  if (onlyFor !== undefined && (await read($, promptTips))?.at !== onlyFor) return ''
  await update($, promptTips, t => (t ? { ...t, upgrade: text, rewrittenBy: settings.promptModel, tokens, why, guidedBy, tries: [...(t.tries ?? tries), added], shown: (t.tries ?? tries).length } : t))
  const read_ = [components.length > 0 ? `${components.length} of this folder's components` : '', sections.length > 0 ? `${sections.length} part${sections.length === 1 ? '' : 's'} of Companion's guidance (${guidedBy.join(', ')})` : '']
    .filter(Boolean)
    .join(' and ')
  const where = isFilling && (await refill($, text)) ? " It's in the prompt box: fill in any [placeholder], then press Enter." : ''
  return `Rewritten by ${settings.promptModel} (${tokens} tokens${read_ ? `, reading ${read_}` : ''}).${where}\n\n${text}`
}

/**
 * /bc-dashboard prompt guide: the dashboard's guide against each Companion
 * plugin's installed version, with the changelog lines since the one it was
 * written for. `refresh` has a model draft the edits for each plugin that has
 * moved on or has none yet; it prints them and changes nothing.
 */
const guideCommand = async ($: Engine, settings: Settings, rest: string): Promise<string> => {
  const plugins = (await read($, companionPlugins)) ?? []
  const status = guideStatus(plugins)
  const { index, installed } = await companionDocs($)
  const stale = status.filter(s => s.state === 'drifted' || s.state === 'unwritten')
  const notesOf = async (plugin: string): Promise<string[]> => {
    const dir = installed[plugin]?.dir
    return dir ? String(await $.fs.read(`${dir}CHANGELOG.md`).catch(() => '')).split('\n') : []
  }
  const changelogs: Record<string, string[]> = {}
  for (const s of stale) changelogs[s.plugin] = await notesOf(s.plugin)
  if (rest.split(/\s+/)[0] !== 'refresh') return guideText(status, changelogs)
  if (stale.length === 0) return 'The dashboard\'s guide is up to date with every Companion plugin on in this session. Nothing to refresh.'
  const drafts: string[] = []
  for (const s of stale) {
    const all = changelogs[s.plugin] ?? []
    const notes = (s.stamped && s.installed ? changelogBetween(all, s.stamped, s.installed) : all.slice(0, 120)).slice(0, 120)
    const headings = s.stamped ? [] : Object.values(index.files).filter(f => f.plugin === s.plugin).flatMap(f => f.sections.map(x => x.heading)).filter(Boolean).slice(0, 80)
    const reply = await $.model.complete({
      model: settings.promptModel,
      system: REFRESH_SYSTEM,
      prompt: refreshRequest(s.plugin, s.stamped, s.installed, GUIDE.filter(e => e.plugin === s.plugin), notes, headings),
      maxTokens: 1500,
      effort: 'low',
    })
    drafts.push(reply.isAnswered ? refreshText(s.plugin, s.installed, reply.text, settings.promptModel) : `${s.plugin}: ${settings.promptModel} couldn't draft it (${reply.reason}). Nothing was changed.`)
  }
  return drafts.join('\n\n')
}

/** /bc-dashboard prompt: the last prompt's tips; `use` puts the upgrade in the prompt box; `upgrade` has a model rewrite it. */
const promptCommand = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  const verb = target.trim().split(/\s+/)[0] ?? ''
  try {
    if (!verb) {
      const tips = await read($, promptTips)
      const text = tipsText(tips, await read($, promptCounts), settings.promptCheck)
      // The tab opens beside the answer; it's quick, so the answer doesn't wait long.
      if (tips && settings.promptView !== 'off') await showPromptTab($, tips.tips.length).catch(() => undefined)
      return text
    }
    if (verb === 'use') {
      const tips = await read($, promptTips)
      if (!tips) return 'No upgraded prompt yet: no Boomi prompt this session has had tips.'
      return (await refill($, tips.upgrade))
        ? 'The upgraded prompt is in the prompt box: fill in any [placeholder], then press Enter.'
        : `The prompt box couldn't take it here. The upgraded prompt:\n\n${tips.upgrade}`
    }
    if (verb === 'guide') return await guideCommand($, settings, target.trim().slice('guide'.length).trim())
    if (verb === 'upgrade') return await rewritePrompt($, settings, target.trim().slice('upgrade'.length).trim() || undefined)
    return 'Usage: /bc-dashboard prompt shows your last Boomi prompt\'s tips; prompt use puts the upgrade in the prompt box; prompt upgrade [a note] has a model rewrite it, following the note; prompt guide [refresh] compares the dashboard\'s guide with the Companion plugins installed and, with refresh, has a model draft edits.'
  } catch (error) {
    return `The dashboard couldn't do that: ${messageOf(error)}. Your prompt is safe.`
  }
}

// --- Budget enforcement --------------------------------------------------------------

/**
 * The budgets spent past the grace while enforcement is on (confirm or
 * block), and whether the person allowed changes for the rest of the
 * session. Nothing is spent in warn mode.
 */
const enforcementNow = async ($: Engine, settings: Settings, usage?: Usage) => {
  if (settings.budgetEnforce === 'warn') return { spent: [] as BudgetLine[], isAllowed: false }
  const u = usage ?? (await withBudget($, settings))
  return { spent: spentBudgets(budgetLines(u, settings), settings.budgetGrace), isAllowed: await read($, budgetAllowed) }
}

/** Keeps the banner's pause in step, toasting once as a pause starts. True while Companion changes are paused. */
const notePause = async ($: Engine, settings: Settings, usage: Usage): Promise<boolean> => {
  const { spent, isAllowed } = await enforcementNow($, settings, usage).catch(() => ({ spent: [] as BudgetLine[], isAllowed: false }))
  const paused = spent.length > 0 && !isAllowed ? spentText(spent) : ''
  const before = await read($, budgetPaused)
  if (paused !== before) {
    await update($, budgetPaused, () => paused)
    if (paused && !before) {
      toast($, settings, `⛔ Budget reached: ${paused}. Companion changes are ${settings.budgetEnforce === 'block' ? 'refused' : 'paused: each asks you first'}.`)
    }
  }
  return paused !== ''
}

/** A refused change that wasn't a Companion script (a call to the Platform API, a wrapper script): a blocked step of its own. */
const recordBlocked = async ($: Engine, settings: Settings, detail: string) => {
  const at = await $.clock.now()
  await record($, list => [...list, { id: nextId(list), kind: 'other', outcome: 'blocked', subject: 'Boomi change', detail, startedAt: at, endedAt: at, isBudgetBlocked: true }])
  await refreshStatus($, settings).catch(() => undefined)
  await saveActivity($, settings).catch(() => undefined)
}

/** Marks the steps the budget refused as such, for their words. */
const markBudgetBlocked = async ($: Engine, ids: readonly number[]) => {
  if (ids.length === 0) return
  await record($, list => list.map(a => (ids.includes(a.id) ? { ...a, isBudgetBlocked: true as const } : a)))
}

/** A Companion change the person allowed past a spent budget, kept as a step for the audit trail. */
const recordOverride = async ($: Engine, settings: Settings, text: string) => {
  const at = await $.clock.now()
  await record($, list => [...list, { id: nextId(list), kind: 'other', outcome: 'ok', subject: 'Budget override', detail: text, startedAt: at, endedAt: at, isBudgetOverride: true }])
  await saveActivity($, settings).catch(() => undefined)
}

const ALLOW_ONE = 'Allow this one'
const ALLOW_SESSION = 'Allow for the rest of this session'
const RAISE = 'Raise the budget'
const STOP = 'Stop'

/**
 * Whether a shell command may run while a budget is spent: the Companion
 * changes it would make (its own scripts, a changing call to the Platform
 * API, or either inside a local script it runs), held against the spent
 * budgets. Block refuses; confirm asks the person, who can allow this one,
 * allow the rest of the session, raise the budget, or stop. Undefined lets
 * the command run; reads always do.
 */
/**
 * The scripts a command runs, with their text, read from the folder the
 * command runs them in (after any cd before them). Both gates check these
 * too, so a change can't hide in a wrapper; at most five are read.
 */
const wrapperTexts = async ($: Engine, command: string): Promise<{ path: string; text: string }[]> => {
  const out: { path: string; text: string }[] = []
  const cwd = await $.session.cwd()
  for (const { path, dir } of wrapperRuns(command).slice(0, 5)) {
    const folder = dir.startsWith('/') ? dir : dir ? `${cwd}/${dir}` : cwd
    const full = path.startsWith('/') ? path : `${folder}/${path.replace(/^\.\//, '')}`
    out.push({ path, text: await $.fs.read(full).then(String).catch(() => '') })
  }
  return out
}

const budgetGate = async ($: Engine, settings: Settings, command: string): Promise<{ deny: string; short: string } | undefined> => {
  if (settings.budgetEnforce === 'warn') return undefined
  const changes = [...companionChanges(command), ...platformWrites(command)]
  for (const { path, text } of await wrapperTexts($, command)) {
    changes.push(...[...companionChanges(text), ...platformWrites(text)].map(c => `${c}, inside ${path}`))
  }
  if (changes.length === 0) return undefined
  const { spent, isAllowed } = await enforcementNow($, settings)
  if (spent.length === 0 || isAllowed) return undefined
  const refuse = (isChosen = false) => ({ deny: denyMessage(spent, changes, settings.budgetEnforce, isChosen), short: blockedDetail(spent) })
  if (settings.budgetEnforce === 'block') return refuse()
  const said = spentText(spent)
  const answer = await $.ui
    .ask(`Boomi Companion's budget is spent: ${said}. Claude wants to ${changes.join('; ')}. Let it?`, { header: 'Budget', options: [ALLOW_ONE, ALLOW_SESSION, RAISE, STOP] })
    .catch(() => undefined)
  if (answer === ALLOW_ONE) {
    await recordOverride($, settings, `allowed once: ${changes.join('; ')}, with ${said} spent`)
    return undefined
  }
  if (answer === ALLOW_SESSION) {
    await update($, budgetAllowed, () => true)
    await recordOverride($, settings, `allowed for the rest of the session, starting with: ${changes.join('; ')}, with ${said} spent`)
    await refreshStatus($, settings).catch(() => undefined)
    return undefined
  }
  if (answer === RAISE) {
    await configCommand($, settings, 'budget').catch(() => undefined)
    const after = await enforcementNow($, settings)
    if (after.spent.length === 0) {
      await refreshStatus($, settings).catch(() => undefined)
      return undefined
    }
    return { deny: denyMessage(after.spent, changes, settings.budgetEnforce, true), short: blockedDetail(after.spent) }
  }
  return refuse(answer === STOP)
}

/**
 * The note Claude gets with a prompt: once as enforcement starts, and again
 * when it changes (an override for the session, a raised budget, a reset),
 * so it plans without Companion changes instead of finding the gate mid-plan.
 */
const enforcementContext = async ($: Engine, settings: Settings): Promise<string | undefined> => {
  if (settings.budgetEnforce === 'warn') return undefined
  const { spent, isAllowed } = await enforcementNow($, settings)
  const key = spent.length === 0 ? '' : `${settings.budgetEnforce}|${isAllowed}|${spent.map(l => l.label).join(',')}`
  const before = await read($, enforceNoted)
  if (key === before) return undefined
  await update($, enforceNoted, () => key)
  return enforcementNote(spent, settings.budgetEnforce, isAllowed)
}

// --- Components, to take elsewhere -------------------------------------------------

/**
 * /bc-dashboard components [csv] [save]: every component this folder's
 * sessions touched, with its IDs, copied to the clipboard as tab-separated
 * text (pastes into a spreadsheet's cells), or as CSV; save also writes the
 * CSV into the workspace. Boomi's details (folder, version) where the Platform
 * API credentials are there.
 */
const componentsCommand = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  const words = target.toLowerCase().split(/\s+/).filter(Boolean)
  const view = scoped(await read($, dashboard), 'all')
  const table = componentTable(view.activity, await boomiFacts($, settings, view))
  if (table.rows.length === 0) return 'No components yet: they show up once Claude creates, saves, deploys or tests one.'
  const isCsv = words.includes('csv')
  const copied = await $.ui.copy({ text: isCsv ? toCsv(table) : toTsv(table) }).catch(() => ({ isCopied: false as const }))
  let saved: string | undefined
  if (words.includes('save')) {
    const now = await $.clock.now()
    saved = `${await $.session.cwd()}/boomi-components-${new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, '')}.csv`
    await $.fs.write(saved, `\ufeff${toCsv(table)}`)
  }
  const n = table.rows.length
  return [
    copied.isCopied
      ? `Copied ${n} component${n === 1 ? '' : 's'} ${isCsv ? 'as CSV' : 'for a spreadsheet: paste into the first cell'}. Columns: ${table.header.join(', ')}.`
      : `Couldn't reach the clipboard here.${saved ? '' : ' Run /bc-dashboard components save to write a CSV file instead.'}`,
    saved ? `Saved them as ${saved}.` : '',
    ...table.rows.map(row => `  ${row[0]}${row[3] ? `  ${row[3]}` : '  (not in Boomi yet)'}`),
  ]
    .filter(Boolean)
    .join('\n')
}

// --- Settings -------------------------------------------------------------------

/** The dashboard's rows of /config: each field's value (the pane's colors as shown now), and which a trusted source locks. */
const configNow = async ($: Engine, settings: Settings) => {
  const rows = await $.config.list()
  const values: Record<string, Value> = {}
  const locked = new Set<string>()
  for (const field of FIELDS) {
    const row = rows.find(r => r.key === configKey(field))
    values[field.key] = valueOf(field, row?.value)
    if (row?.isLocked) locked.add(field.key)
  }
  values.paneTheme = await themeOf($, settings)
  return { values, locked }
}

/**
 * Writes each change through /config, so it lasts and shows there too, then
 * puts it to work in this session where it can: the settings in place, the
 * pane's colors, the status line. Says what changed, or why a change didn't take.
 */
const saveConfig = async ($: Engine, settings: Settings, values: Record<string, Value>, changes: ReadonlyMap<string, Value>): Promise<string[]> => {
  const lines: string[] = []
  const applied = { ...values }
  for (const [key, value] of changes) {
    const field = fieldNamed(key)!
    const done = await $.config.set({ key: configKey(field), value }).catch((error: unknown) => ({ deny: messageOf(error) }))
    if (done.deny !== undefined) {
      lines.push(`${field.label}: not changed: ${done.deny}`)
      continue
    }
    lines.push(changeLine(field, values[key]!, value))
    applied[key] = value
    if (key === 'paneTheme') {
      await $.store.delete(THEME_KEY).catch(() => undefined)
      await update($, pickedTheme, () => null)
    }
  }
  Object.assign(settings, settingsFrom(applied as PluginOptions))
  await refreshStatus($, settings).catch(() => undefined)
  return lines
}

/**
 * /bc-dashboard config: the settings a group at a time, each a question with
 * the current value first; the budget's offers come from what past sessions
 * cost. Changes are saved at Done, or when the menu is closed before it.
 * `config <group>` walks one group, `config <setting> <value>` sets one,
 * `config list` (and a run that can't ask) lists them all.
 */
const configCommand = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  const words = target.split(/\s+/).filter(Boolean)
  let now: Awaited<ReturnType<typeof configNow>>
  try {
    now = await configNow($, settings)
  } catch (error) {
    return `The dashboard couldn't read its settings: ${messageOf(error)}. They're under /config too.`
  }
  const { values, locked } = now
  const lockedNote = (label: string) => `${label} is set by your organization's settings, so it can't be changed here.`
  if (words[0] === 'list') return listing(values)

  // One setting, by name.
  const named = words[0] ? fieldNamed(words[0]) : undefined
  if (named) {
    const current = values[named.key]!
    if (words.length === 1) return `${named.label}: ${show(named, current)}. ${named.about} Change it with /bc-dashboard config ${named.key} <value>.`
    if (locked.has(named.key)) return lockedNote(named.label)
    const parsed = parseValue(named, words.slice(1).join(' '))
    if ('error' in parsed) return `${parsed.error}. ${named.label} stays ${show(named, current)}.`
    if (parsed.value === current) return `${named.label} is already ${show(named, current)}.`
    return (await saveConfig($, settings, values, new Map([[named.key, parsed.value]]))).join('\n')
  }
  const only = words[0] ? groupNamed(words[0]) : undefined
  if (words[0] && !only) return `No setting or group called ${words[0]}.\n\n${listing(values)}`
  if (only && words.length > 1) return groupWithValue(only, words.slice(1).join(' '))

  // The walk.
  const changes = new Map<string, Value>()
  const current = (key: string): Value => (changes.has(key) ? changes.get(key)! : values[key]!)
  const notes: string[] = []
  let spend: PastSpend | undefined
  const spendNow = async (): Promise<PastSpend> => {
    if (spend) return spend
    const sessions = (await read($, history)).sessions ?? (await scanHistory($, settings).catch(() => undefined))?.sessions
    spend = pastSpend(sessions, await $.clock.now())
    return spend
  }
  let asked = 0
  const walk = async (group: Group) => {
    const fields = group.fields.filter(f => {
      if (!locked.has(f.key)) return true
      if (!notes.includes(lockedNote(f.label))) notes.push(lockedNote(f.label))
      return false
    })
    for (let i = 0, retries = 0; i < fields.length; i++) {
      const field = fields[i]!
      // The share's period only matters with a share set.
      if (field.key === 'companionSharePeriod' && Number(current('companionShare')) === 0) continue
      // The grace only matters once a spent budget does something.
      if (field.key === 'budgetGrace' && current('budgetEnforce') === 'warn') continue
      const q = questionFor(field, current(field.key), field.unit === 'usd' ? await spendNow() : { sessions: 0 }, { index: i + 1, of: fields.length, group })
      const retry = retries > 0 ? notes.pop() : undefined
      const text = await $.ui.ask(retry ? `${retry} ${q.question}` : q.question, { header: q.header, options: q.options })
      asked++
      const answer = q.answer(text)
      if (answer.kind === 'back') return
      if (answer.kind === 'unreadable' && retries === 0) {
        const why = parseValue(field, answer.text)
        notes.push(`"${answer.text}" didn't work: ${'error' in why ? why.error : 'not a value it takes'}.`)
        retries++
        i--
        continue
      }
      retries = 0
      if (answer.kind === 'set') {
        if (answer.value === values[field.key]) changes.delete(field.key)
        else changes.set(field.key, answer.value)
      }
    }
  }
  let isClosed = false
  try {
    if (only) await walk(only)
    else
      for (let round = 0; round < 12; round++) {
        const menu = menuQuestion(Object.fromEntries(FIELDS.map(f => [f.key, current(f.key)])), changes.size)
        const picked = await $.ui.ask(menu.question, { header: 'Settings', options: menu.options })
        asked++
        const group = picked === DONE ? undefined : groupNamed(picked)
        if (!group) break
        await walk(group)
      }
  } catch {
    isClosed = true
  }
  // Where nothing could be asked (a -p run) or the menu closed at once: the settings as they are.
  if (asked === 0) return listing(values)
  const saved = changes.size > 0 ? await saveConfig($, settings, values, changes) : []
  return [
    saved.length > 0 ? ['Saved to /config:', ...saved.map(line => `  ${line}`)].join('\n') : 'Nothing changed.',
    isClosed && saved.length > 0 ? 'The menu closed before Done; what you picked before it closed is saved.' : '',
    ...notes,
  ]
    .filter(Boolean)
    .join('\n')
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
  const notice = updateNotice(asUpdateSeen(await $.store.get(UPDATE_SEEN_KEY).catch(() => undefined)), check.installed, check.latest)
  await $.store.set(UPDATE_SEEN_KEY, notice.seen ?? null).catch(() => undefined)
  await update($, updateAvailable, () => notice.seen?.latest ?? null)
  if (notice.isToasting) $.ui.toast(`bc-dashboard ${check.latest} is available (you have ${check.installed}): run /bc-dashboard upgrade`)
}

/** At the start, the newer version an earlier check found, for the footer, without fetching again. */
const restoreUpdate = async ($: Engine) => {
  const seen = asUpdateSeen(await $.store.get(UPDATE_SEEN_KEY).catch(() => undefined))
  const pending = pendingUpdate(seen, await ownVersion($))
  await update($, updateAvailable, () => pending ?? null)
}

// --- Drawing -------------------------------------------------------------------

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

// --- Companion's activity log -------------------------------------------------------
// Companion's scripts keep .activity-log/activity.jsonl only when its env file says
// BOOMI_COMPANION_LOG_ACTIVITY=1. The dashboard offers to add that one line, asks
// first, and does the write itself, so the file never enters the conversation. It
// reads the file for that one key and says nothing of the rest. Where the write is
// refused, it shows the line and where it goes.

const LOG_NEVER_KEY = 'activityLogNever'
const LOG_YES = 'Yes, add it'
const LOG_LATER = 'Not now'
const LOG_NEVER = 'Never ask again'

/** What Companion's env file says about the log. `no-file` and `unreadable` where it can't be read. */
const readLogSetting = async ($: Engine, settings: Settings): Promise<'on' | 'off' | 'absent' | 'no-file' | 'unreadable'> => {
  const path = await envPath($, settings)
  if (!(await $.fs.exists(path).catch(() => false))) return 'no-file'
  const text = await $.fs.read(path).catch(() => undefined)
  const state = text === undefined ? 'unreadable' : activityLogSetting(text)
  await update($, logState, () => state)
  return state
}

/** Where to put the line by hand, for a write that was refused. */
const logByHand = (settings: Settings, path: string): string =>
  `Add this line to ${path} yourself:\n  ${ACTIVITY_LOG_LINE}\nFrom a terminal in this folder: echo '${ACTIVITY_LOG_LINE}' >> ${settings.envFile}`

/**
 * Puts the log on or off in Companion's env file: one line, appended or removed
 * and every other byte kept. Checks by reading it back, and says plainly when the
 * write was refused.
 */
const switchLog = async ($: Engine, settings: Settings, isOn: boolean): Promise<{ isDone: boolean; text: string }> => {
  const path = await envPath($, settings)
  const before = await $.fs.read(path).catch(() => undefined)
  if (before === undefined) return { isDone: false, text: `There is no readable env file at ${path}. Companion's setup creates it; then run this again, or add the line yourself:\n  ${ACTIVITY_LOG_LINE}` }
  const after = isOn ? turnOnActivityLog(before) : turnOffActivityLog(before)
  if (after === undefined) return { isDone: true, text: isOn ? `The activity log is already on in ${path}.` : `${path} has no activity log line to remove.` }
  try {
    await $.fs.write(path, after)
  } catch (error) {
    return { isDone: false, text: `Couldn't change ${path}: ${messageOf(error)}\n${logByHand(settings, path)}` }
  }
  const state = await readLogSetting($, settings)
  if (isOn ? state !== 'on' : state !== 'absent') return { isDone: false, text: `${path} didn't take the change.\n${logByHand(settings, path)}` }
  return { isDone: true, text: isOn ? `Added ${ACTIVITY_LOG_LINE} to ${path}. Companion's scripts keep the log from their next run, and the dashboard reads it.` : `Removed the activity log line from ${path}. Companion's scripts stop keeping the log from their next run.` }
}

/** Stops the offer for good: the setting where /config takes it, the store where it doesn't. */
const neverOfferLog = async ($: Engine, settings: Settings) => {
  if (!(await saveSetting($, settings, 'activityLogPrompt', 'never'))) await $.store.set(LOG_NEVER_KEY, true).catch(() => undefined)
  // Unseen again until read: the pane's advisory row goes, and the pane redraws.
  await update($, logState, () => 'unknown')
}

const isLogOfferOff = async ($: Engine, settings: Settings): Promise<boolean> =>
  settings.activityLogPrompt === 'never' || (await $.store.get(LOG_NEVER_KEY).catch(() => undefined)) === true

/**
 * At the start of a session in Companion's folder: where the env file says nothing
 * about the log, asks once whether to add the line. Yes adds it; Not now asks again
 * next session; Never ask stops the offer.
 */
const offerActivityLog = async ($: Engine, settings: Settings) => {
  if ((await isLogOfferOff($, settings)) || (await read($, isLogOfferDeclined)) || !(await read($, isCompanionFolder))) return
  if ((await readLogSetting($, settings)) !== 'absent') return
  const path = await envPath($, settings)
  const answer = await $.ui
    .ask(`Turn on Companion's activity log? This adds one line, ${ACTIVITY_LOG_LINE}, to ${path} and changes nothing else. Companion's scripts then record each operation in .activity-log/activity.jsonl on this machine, and the dashboard shows the runs Claude's tool calls didn't.`, {
      header: 'Activity log',
      options: [LOG_YES, LOG_LATER, LOG_NEVER],
    })
    .catch(() => undefined)
  if (answer === LOG_YES) {
    await turnOnLogFromPane($, settings)
    return
  }
  if (answer === LOG_NEVER) {
    await neverOfferLog($, settings)
    return
  }
  await update($, isLogOfferDeclined, () => true)
}

/** The pane's Turn it on button: the same write as the command, said in a toast. */
const turnOnLogFromPane = async ($: Engine, settings: Settings) => {
  const done = await switchLog($, settings, true)
  toast($, settings, done.isDone ? `Activity log on: added ${ACTIVITY_LOG_LINE} to ${settings.envFile}.` : `Couldn't turn the activity log on. /bc-dashboard activity-log says how to add the line yourself.`)
}

const activityLogStatus = async ($: Engine, settings: Settings): Promise<string> => {
  const path = await envPath($, settings)
  const state = await readLogSetting($, settings)
  const offer = (await isLogOfferOff($, settings)) ? 'The offer to turn it on is off.' : 'The dashboard offers to turn it on at the start of a session, until you say yes or never.'
  switch (state) {
    case 'on':
      return `The activity log is on: ${path} has ${ACTIVITY_LOG_LINE}. Companion's scripts write each operation to .activity-log/activity.jsonl, and the dashboard reads it.`
    case 'off':
      return `${path} sets the activity log to something other than 1, so Companion keeps none (only exactly 1 counts). /bc-dashboard activity-log on sets it to 1.`
    case 'absent':
      return `The activity log is off: ${path} doesn't set it. /bc-dashboard activity-log on adds ${ACTIVITY_LOG_LINE} to it. ${offer}`
    case 'no-file':
      return `There is no env file at ${path}, so there is nothing to turn on yet.`
    default:
      return `Couldn't read ${path}.`
  }
}

const activityLogCommand = async ($: Engine, settings: Settings, target: string): Promise<string> => {
  const verb = target.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  switch (verb) {
    case '':
    case 'status':
      return activityLogStatus($, settings)
    case 'on':
      return (await switchLog($, settings, true)).text
    case 'off': {
      const path = await envPath($, settings)
      const answer = await $.ui.ask(`Remove the activity log line from ${path}? Nothing else in it changes.`, { header: 'Activity log', options: ['Yes, remove it', 'Keep it'] }).catch(() => undefined)
      return answer === 'Yes, remove it' ? (await switchLog($, settings, false)).text : `Left ${path} as it was.`
    }
    case 'never':
      await neverOfferLog($, settings)
      return 'The dashboard will not offer to turn the activity log on. /bc-dashboard activity-log on still does it.'
    default:
      return 'Usage: /bc-dashboard activity-log [on|off|status|never]'
  }
}

/**
 * The session's values the dashboard sets up from the store and the folder:
 * the folder's earlier steps, past sessions, the watch list, and whether this
 * is a Companion folder. Run at the session's start, and again when the
 * session ID changes without one (a /clear goes on under a new ID and fires
 * no session.start), so nothing saved is written over and the checks see the
 * folder.
 */
/** The session the dashboard last set up: a /clear changes the ID. */
let setUpFor: string | undefined

const setUpSession = async ($: Engine, settings: Settings) => {
  setUpFor = await $.session.id().catch(() => undefined)
  await loadEnvironment($, settings).catch(() => undefined)
  // The watch list outlives the session; restore it the first time.
  // A theme or size kept in the store (by 0.33.0 and earlier, or where /config refused it) moves to /config once it will take it.
  appearanceCache = undefined
  const saved = themeNamed(await $.store.get(THEME_KEY))
  if (saved) {
    if (await saveSetting($, settings, 'paneTheme', saved)) await $.store.delete(THEME_KEY).catch(() => undefined)
    else await update($, pickedTheme, () => saved)
  }
  const size = (await $.store.get(SIZE_KEY)) as { rows?: number; columns?: number } | undefined
  if (size && typeof size.rows === 'number') {
    if ((await saveSetting($, settings, 'paneRows', size.rows)) && (await saveSetting($, settings, 'paneColumns', size.columns ?? 0))) await $.store.delete(SIZE_KEY).catch(() => undefined)
    else await update($, paneSize, () => ({ rows: size.rows!, columns: size.columns ?? 0 }))
  }

  await restoreActivity($, settings)

  const scanned = (await $.store.get(HISTORY_KEY)) as { sessions?: PastSession[]; scannedAt?: number; scanned?: number } | undefined
  if (Array.isArray(scanned?.sessions)) {
    await update($, history, (): HistoryState => ({ phase: 'ready', sessions: scanned.sessions, scannedAt: scanned.scannedAt, scanned: scanned.scanned }))
  }

  const folded = await $.store.get(PAST_COLLAPSED_KEY).catch(() => undefined)
  if (typeof folded === 'boolean') await update($, isPastCollapsed, () => folded)

  const ids = await $.store.get(WATCH_KEY)
  if (Array.isArray(ids)) {
    await update($, dashboard, c =>
      c.watched.length > 0 ? c : { ...c, watched: ids.map(id => ({ componentId: String(id) })) },
    )
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
}

/**
 * Sets the session up again after a /clear: once per new session ID, before
 * anything reads or saves its steps. Only once a session was set up, as
 * session.start always does first.
 */
const ensureSession = async ($: Engine, settings: Settings) => {
  if (setUpFor === undefined) return
  const id = await $.session.id().catch(() => undefined)
  if (id === undefined || id === setUpFor) return
  setUpFor = id
  await setUpSession($, settings)
  void notePlugins($)
}

export const register: Register = (on, options) => {
  const settings = settingsFrom(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'bc-dashboard',
      description: 'Boomi Companion at a glance: what needs attention, each component, the live environment, cost',
      argumentHint: 'text | poll | earlier | size <rows> [columns] | why [n] | rerun [n] | history | components [csv] [save] | resume [n] | review [n] | report [save|html [session|all] [--no-open] [--style exosphere|expressive]] | close <n|all> | reopen | watch <id|file> | unwatch <id> | prompt [use|upgrade] | activity-log [on|off|status|never] | seen | banner | theme [day|night|terminal] | config [budget|pane|data|list|<setting> <value>] | upgrade [--check] [--yes] [--rollback]',
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

    await setUpSession($, settings)
    // Offered on a timer, not here: the question must not hold the session's start up. Every interactive session, until the answer is yes or never.
    if (e.isInteractive) $.clock.after(3_000, () => offerActivityLog($, settings).catch(() => undefined))

    $.clock.every(5_000, () => refreshStatus($, settings))
    // Claude Code's /usage breakdown: Companion's share of all usage. Only in an interactive session, so the headless run it starts never starts another.
    if (settings.isReadingBreakdown && e.isInteractive) {
      $.clock.after(20_000, () => readBreakdown($).catch(() => undefined))
      $.clock.every(BREAKDOWN_MS, () => readBreakdown($).catch(() => undefined))
    }
    // A command Claude Code moved to the background: its steps settle when its output file has the result.
    $.clock.every(BACKGROUND_CHECK_MS, () => settleBackground($, settings).catch(() => undefined))
    // The Prompt tab's spinner: it turns only while a rewrite runs, so the pane isn't redrawn the rest of the time.
    $.clock.every(SPIN_MS, async () => {
      if (await read($, promptBusy)) await update($, spin, n => n + 1)
    })
    // The flamingo's scene: what it does next is checked every half second, in Whimsical only.
    if (settings.hasLogo) {
      // It stands in one place, working or not; the pane redraws only when the scene changes.
      $.clock.every(FLAMINGO_TICK_MS, async () => {
        if (markOf(await drawnThemeOf($, settings)) !== 'flamingo') return
        sceneTick++
        if (JSON.stringify(sceneAt(sceneTick)) !== JSON.stringify(sceneAt(await read($, frame)))) await update($, frame, () => sceneTick)
      })
    }
    // The banner's flamingo: a sparkle in its place for a second in five; the banner redraws only when that changes.
    if (settings.isBanded && settings.isBandAnimated && settings.hasLogo) {
      $.clock.every(BAND_FLAMINGO_TICK_MS, async () => {
        if (markOf(await drawnThemeOf($, settings)) !== 'flamingo') return
        bandTick++
        if (bandFlamingoAt(bandTick) !== bandFlamingoAt(await read($, bandFrame))) await update($, bandFrame, () => bandTick)
      })
    }
    if (settings.pollSeconds > 0) {
      $.clock.after(2_000, () => poll($, settings))
      $.clock.every(settings.pollSeconds * 1000, () => poll($, settings))
    }

    // A new session's banner turns through the last session's recap and the tips until Companion does something.
    $.clock.every(TIP_MS, async () => {
      if (!(await read($, dashboard)).activity.some(a => !a.isRestored)) await update($, tip, n => n + 1)
    })
    // Which Companion plugins are here: the pane's sections and the tips follow them. Read once, just after the start.
    $.clock.after(1_000, () => notePlugins($))
    await readActivityLog($, settings)
    $.clock.every(LOG_CHECK_MS, () => readActivityLog($, settings))
    // Whether a newer dashboard is on GitHub, at most once a day; it never installs.
    if (settings.isCheckingUpdates) await restoreUpdate($).catch(() => undefined)
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
    await ensureSession($, settings).catch(() => undefined)
    const command = String(e.command ?? '')
    // A spent budget, with budgetEnforce confirm or block, stops Companion changes before they run.
    // Production read-only (envCheck enforce) comes first: a refused change never reaches the budget question.
    const envRefusal = await environmentRefusal($, settings, command).catch(() => undefined)
    const gate = envRefusal ?? (await budgetGate($, settings, command).catch(() => undefined))
    const runs = scriptRuns(command)
    const checks = bdiStatusChecks(command)
    const deploys = datahubStatusChecks(command)
    const quarantines = quarantineChecks(command)
    if (gate) {
      const started = runs.length > 0 ? await noteStart($, settings, runs).catch(() => [] as Activity[]) : []
      if (started.length > 0) await noteEnd($, settings, started, { deny: gate.short }).catch(() => undefined)
      else await recordBlocked($, settings, gate.short).catch(() => undefined)
      if (!envRefusal) await markBudgetBlocked($, started.map(a => a.id)).catch(() => undefined)
      // Settled before Claude hears the refusal, so the status line and the saved steps already show it.
      await refreshStatus($, settings).catch(() => undefined)
      await saveActivity($, settings).catch(() => undefined)
      return { deny: gate.deny }
    }
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

  // On the way out: the first /exit, /quit or /clear of a session that did work says what /handoff saves; typing it again goes through.
  let isHandoffMade = false
  let isHandoffNudged = false
  on('command.run', { command: 'handoff' }, ($, e, next) => {
    isHandoffMade = true
    return next(e)
  })
  for (const name of ['exit', 'quit', 'clear']) {
    on('command.run', { command: name }, async ($, e, next) => {
      const calls = (await read($, ledger)).calls
      if (!shouldNudgeHandoff({ isOn: settings.isNudgingHandoff, calls, isNudged: isHandoffNudged, isDone: isHandoffMade })) return next(e)
      isHandoffNudged = true
      return { text: handoffNudgeText(name) }
    })
  }

  on('command.run', { command: 'bc-dashboard' }, async ($, e) => {
    await ensureSession($, settings).catch(() => undefined)
    return { text: await runCommand($, settings, e.args) }
  })

  // Notes what the prompt box shows dim as a suggestion (Claude's guess after a turn, or a plugin's), so a prompt sent as it was can be told from one the person wrote. The suggestion goes on to the box untouched.
  on('prompt.suggest', async ($, e, next) => {
    const result = await next(e)
    if (result.isShown) await update($, shownSuggestion, () => e.text)
    return result
  })

  // A spent budget that pauses Companion changes: Claude hears it with the person's prompt, once and on a change.
  // A Boomi prompt is checked first: tips in suggest mode, a question in confirm mode or when it holds a secret.
  on('prompt.submit', async ($, e, next) => {
    await ensureSession($, settings).catch(() => undefined)
    const checked = await checkSubmitted($, settings, e).catch(() => undefined)
    if (checked?.drop !== undefined) return { drop: checked.drop }
    const note = await enforcementContext($, settings).catch(() => undefined)
    const typed = checked?.text === undefined ? e : { ...e, text: checked.text }
    return next(note ? { ...typed, context: [...(e.context ?? []), note] } : typed)
  })

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
    const paused = await read($, budgetPaused)
    const welcome = isNew && (await read($, isCompanionFolder)) ? welcomeLine(await read($, tip), (await read($, recap)) ?? undefined, now, tipsFor(await read($, companionPlugins))) : undefined
    // A gentle nudge just above the prompt box: the dashboard suggests a clearer prompt, or holds one.
    const tipsNow = settings.promptCheck === 'off' ? null : await read($, promptTips)
    const held = await read($, promptHeld)
    const nudge = tipsNow && (held !== null || tipsNow.at !== (await read($, promptNudgeHidden))) ? tipsNow : null
    if (!latest && !welcome && needs.length === 0 && !paused && !nudge) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    // The mark before the name, by theme. Exosphere's is the Boomi logo, in a column of its own beside the rows: the picture where the terminal draws pictures, nothing elsewhere. Whimsical's is the flamingo (animated unless turned off), one cell of text. The logo setting turns either off.
    const drawn = await drawnThemeOf($, settings)
    const mark = settings.hasLogo ? markOf(drawn) : undefined
    const palette = PALETTES[drawn]
    const inlineMark = mark === 'flamingo' ? `${settings.isBandAnimated ? bandFlamingoAt(await read($, bandFrame)) : '🦩'} ` : ''
    const Picture = (mark === 'logo' ? ($.ui.resolve(e) as { Image?: typeof Text }).Image : undefined) as ((props: { source: { png: string }; columns: number; rows: number; alt: string }) => unknown) | undefined
    const hasPictures = Picture !== undefined && (await drawsPicturesHere($))
    const withMark = (body: ReturnType<typeof h>) =>
      mark === 'logo' && hasPictures ? (
        <Box>
          <Box flexShrink={0} flexDirection="column" marginRight={1}>
            {Picture!({ source: { png: BOOMI_MARK_PNG }, columns: 4, rows: 2, alt: ' ' })}
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} justifyContent="center">
            {body}
          </Box>
        </Box>
      ) : (
        body
      )
    const count = components(current.activity).length
    const usage = await usageOf($)
    const cost = formatCost(usage.usd)
    const spent = [
      isNew ? cost && `${cost} this session` : [usage.tokens ? `${formatTokens(usage.tokens)} tokens` : undefined, cost].filter(Boolean).join(' · '),
      limitsShort(usage.limits, now),
    ]
      .filter(Boolean)
      .join(' │ ')
    const icon = (level: Level) => <Text color={palette.status[level]}>{STATUS[level].icon}</Text>
    const first = latest ?? welcome
    const nudgeRow = nudge ? (
      <Box>
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            <Text bold color="claude">
              {inlineMark}BC Dashboard{' '}
            </Text>
            {held !== null ? <Text color={STATUS.warning.color}>⏸ Held: </Text> : <Text>{icon(nudge.tips.some(t => t.level === 'serious') ? 'serious' : 'warning')} </Text>}
            <Text>Boomi Dashboard suggests a clearer prompt</Text>
            <Text dimColor>
              {' '}
              · {nudge.tips.length} tip{nudge.tips.length === 1 ? '' : 's'}
              {held !== null ? " · Claude hasn't seen it yet" : ''}
            </Text>
          </Text>
        </Box>
        <Box flexShrink={0} columnGap={1} marginLeft={1}>
          {held !== null ? <Button key="nudge-send-upgrade" label="Send the upgrade" onPress={() => sendHeld($, settings, 'upgrade')} /> : undefined}
          {held !== null ? <Button key="nudge-send-typed" label="Send as typed" onPress={() => sendHeld($, settings, 'typed')} /> : undefined}
          {held === null ? (
            <Button key="nudge-use" label="Use it" onPress={async () => {
              await refill($, nudge.upgrade)
              await update($, promptNudgeHidden, () => nudge.at)
            }} />
          ) : undefined}
          <Button key="nudge-see" label="See it" onPress={() => showPromptTab($, nudge.tips.length)} />
          {held === null ? <Button key="nudge-hide" label="✕" onPress={() => update($, promptNudgeHidden, () => nudge.at)} /> : undefined}
        </Box>
      </Box>
    ) : undefined
    if (!latest && !welcome && needs.length === 0 && !paused) return withMark(nudgeRow!)

    return withMark(
      <Box flexDirection="column">
      {nudgeRow}
      <Box>
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            <Text bold color="claude">
              {inlineMark}BC Dashboard{' '}
            </Text>
            {paused && (
              <Text color={STATUS.critical.color}>
                {PAUSED}
                <Text dimColor>{latest || welcome ? ' │ ' : ''}</Text>
              </Text>
            )}
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
      </Box>,
    )
  })

  // The Prompt tab: whether the prompt is held, the tips, the prompt beside its upgrade, then the buttons right under them.
  on('ui.render', { component: 'Pane', requestId: PROMPT_PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const p = PALETTES[await drawnThemeOf($, settings)]
    const tips = await read($, promptTips)
    const counts = await read($, promptCounts)
    const busy = await read($, promptBusy)
    const spinner = SPINNER[(await read($, spin)) % SPINNER.length]!
    const said = await read($, promptNote)
    const held = await read($, promptHeld)
    const draft = await read($, promptNoteDraft)
    const isExpanded = await read($, promptExpanded)
    const width = Math.max(30, (e.props.bodyColumns || e.viewport?.columns || 64) - 2)
    const isWide = width >= 90
    const t = (text: string, style: { color?: string; bold?: boolean; bg?: string } = {}) => (
      <Text color={style.color ?? p.text} backgroundColor={style.bg ?? p.bg} bold={style.bold}>
        {text}
      </Text>
    )
    const heading = (text: string) => (
      <Box marginTop={1}>
        {t('◇ ', { color: p.rule, bold: true })}
        {t(text.toUpperCase(), { color: p.heading, bold: true })}
      </Box>
    )
    const tries = tips?.tries ?? []
    const shown = tips?.shown ?? Math.max(0, tries.length - 1)
    const guideDrift = driftNote(guideStatus((await read($, companionPlugins)) ?? []))
    const intro = held !== null
      ? "⏸ Held: Claude hasn't seen this prompt yet. Send it, or the upgrade, below."
      : 'The Boomi Dashboard suggests a clearer prompt. Your prompt went to Claude as typed; use the upgrade next time, or now.'
    // Fitted to the pane: the rows everything but the cards' text takes, so the buttons under the cards stay in view.
    const room = e.props.scroll?.bodyRows || e.viewport?.rows || 40
    const cardColumns = Math.max(12, (isWide ? Math.floor(width / 2) - 1 : width) - 4)
    const tipRows = (tips?.tips ?? []).reduce((n, tip) => n + wrapLines(`  ${tip.text}`, width).length, 0)
    // The note's field wraps as it's typed, beside its Regenerate hint.
    const noteRows = Math.max(1, wrapLines(draft, width - 14).length) - 1
    const fixedRows = 3 + wrapLines(intro, width).length + 2 + tipRows + 4 + 1 + (said ? wrapLines(said, width).length : 0) + 2 + 2 + noteRows + 1 + (tries[shown]?.note ? 1 : 0) + (busy ? wrapLines(`${spinner} ${settings.promptModel} is writing a better upgrade. The one above is the quick version, and it stays until the new one arrives.`, width).length : 0) + (tips?.guidedBy?.length ? 1 : 0) + (guideDrift ? wrapLines(guideDrift, width).length : 0) + ((tips?.why?.length ?? 0) > 0 ? 2 + (tips?.why ?? []).reduce((n, line) => n + wrapLines(`  ${line}`, width).length, 0) : 0)
    const textRows = Math.max(4, room - fixedRows - 1)
    // Side by side the cards share the rows; one above the other, your prompt takes up to a third.
    const promptRows = isWide ? textRows : Math.max(2, Math.min(Math.floor(textRows / 3), wrapLines(tips?.masked ?? '', cardColumns).length))
    const upgradeRows = isWide ? textRows : Math.max(3, textRows - promptRows - 3)
    const fit = (text: string, rows: number) => {
      const lines = wrapLines(text, cardColumns)
      return isExpanded || lines.length <= rows ? { text, hidden: 0 } : { text: lines.slice(0, rows - 1).join('\n'), hidden: lines.length - (rows - 1) }
    }
    const wasLong = isExpanded && !!tips && (wrapLines(tips.masked, cardColumns).length > promptRows || wrapLines(tips.upgrade, cardColumns).length > upgradeRows)
    const card = (title: string, text: string, isUpgrade: boolean, rows: number) => {
      const shownText = fit(text, rows)
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={isUpgrade ? p.heading : p.rule} backgroundColor={p.bg} paddingX={1} flexGrow={1} width={isWide ? '50%' : '100%'}>
          {t(title, { color: isUpgrade ? p.heading : p.muted, bold: true })}
          {t(shownText.text)}
          {shownText.hidden > 0 ? (
            <Box columnGap={1}>
              {t(`▼ ${shownText.hidden} more line${shownText.hidden === 1 ? '' : 's'}`, { color: p.muted, bold: true })}
              <Button key={isUpgrade ? 'prompt-expand' : 'prompt-expand-yours'} label="Show all" onPress={() => update($, promptExpanded, () => true)} />
            </Box>
          ) : undefined}
        </Box>
      )
    }
    const firstButton = held !== null ? 'prompt-send-upgrade' : 'prompt-use'
    return (
      <Box flexDirection="column" backgroundColor={p.bg} paddingX={1} minHeight={e.viewport?.rows} width="100%">
        <Box justifyContent="space-between" backgroundColor={p.band ?? p.bg} paddingX={1}>
          {t('◆ BOOMI DASHBOARD PROMPT TIPS ◆', { color: p.bandText, bold: true, bg: p.band })}
          {t(`promptCheck: ${settings.promptCheck}`, { color: p.bandText, bg: p.band })}
        </Box>
        <Box justifyContent="flex-end">
          <Button key="prompt-back" label="◀ Dashboard" onPress={async () => {
            const wasSwapped = isDashboardSwappedOut
            await closePromptTab($, settings)
            if (!wasSwapped) await openPane($, settings)
          }} />
        </Box>
        <Text color={p.rule} backgroundColor={p.bg} wrap="truncate-end">
          {decoRule(width)}
        </Text>
        {!tips ? (
          <Box flexDirection="column">
            {t(counts.checked > 0 ? 'Your last Boomi prompt had nothing to add.' : 'No Boomi prompt checked yet this session.', { color: p.muted })}
            <Box marginTop={1}>
              <Button key="prompt-dismiss" label="Close" onPress={() => closePromptTab($, settings)} />
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column">
            {held !== null ? t(intro, { color: STATUS.warning.color, bold: true }) : t(intro, { color: p.muted })}
            {wasLong ? (
              <Box flexWrap="wrap" columnGap={1}>
                {t('▼ Shown in full: scroll with ↓ or the wheel', { color: p.muted, bold: true })}
                <Button key="prompt-jump" label="Jump to the buttons" onPress={() => $.ui.scroll({ in: PROMPT_PANE, to: { key: firstButton }, block: 'nearest' }).catch(() => undefined)} />
                <Button key="prompt-collapse" label="Fit to the pane" onPress={() => update($, promptExpanded, () => false)} />
              </Box>
            ) : undefined}
            {heading('What it leaves out')}
            {tips.tips.map(tip => (
              <Text backgroundColor={p.bg}>
                <Text color={p.status[tip.level]} backgroundColor={p.bg} bold>
                  {STATUS[tip.level].icon}
                </Text>
                {t(` ${tip.text}`)}
              </Text>
            ))}
            <Box flexDirection={isWide ? 'row' : 'column'} columnGap={1} marginTop={1}>
              {card('YOUR PROMPT', tips.masked, false, promptRows)}
              {card(busy ? `UPGRADED  ${spinner} ${settings.promptModel.toUpperCase()} IS WRITING A BETTER ONE…` : tips.rewrittenBy ? `UPGRADED BY ${tips.rewrittenBy.toUpperCase()}` : 'UPGRADED', tips.upgrade, true, upgradeRows)}
            </Box>
            <Box flexWrap="wrap" columnGap={1}>
              {held !== null ? (
                <Box flexWrap="wrap" columnGap={1}>
                  <Button key="prompt-send-upgrade" label="Send the upgrade" onPress={() => sendHeld($, settings, 'upgrade')} />
                  <Button key="prompt-send-typed" label="Send as typed" onPress={() => sendHeld($, settings, 'typed')} />
                  <Button key="prompt-edit" label="Edit in the prompt box" onPress={() => editHeld($, settings)} />
                  <Button key="prompt-discard" label="Discard" onPress={() => discardHeld($, settings)} />
                </Box>
              ) : (
                <Box flexWrap="wrap" columnGap={1}>
                  <Button key="prompt-use" label="Use the upgrade" onPress={async () => {
                    const isFilled = await refill($, tips.upgrade)
                    await update($, promptNote, () => (isFilled ? 'In the prompt box: fill in any [placeholder], then press Enter.' : "The prompt box couldn't take it here: use Copy."))
                  }} />
                  <Button key="prompt-copy" label="Copy" onPress={async () => {
                    const done = await $.ui.copy({ text: tips.upgrade, surface: e.surface }).catch(() => ({ isCopied: false as const }))
                    await update($, promptNote, () => (done.isCopied ? 'Copied the upgrade.' : "Couldn't copy here."))
                  }} />
                  <Button key="prompt-dismiss" label="Dismiss" onPress={() => closePromptTab($, settings)} />
                </Box>
              )}
            </Box>
            {busy ? t(`${spinner} ${settings.promptModel} is writing a better upgrade. The one above is the quick version, and it stays until the new one arrives.`, { color: p.heading }) : undefined}
            {said ? t(said, { color: p.muted }) : undefined}
            {(tips.why?.length ?? 0) > 0 && heading('Why it changed')}
            {(tips.why ?? []).map(line => t(`  ${line}`))}
            {tips.guidedBy && tips.guidedBy.length > 0 ? t(`Read Companion's guidance: ${tips.guidedBy.join(', ')}`, { color: p.muted }) : undefined}
            {guideDrift ? t(guideDrift, { color: STATUS.warning.color }) : undefined}
            <Box flexWrap="wrap" columnGap={1} marginTop={1}>
              <Button key="prompt-rewrite" label={busy ? `${spinner} Rewriting…` : tries.length > 1 ? 'Regenerate' : 'Upgrade with a model'} onPress={() => void rewriteFromTab($, settings)} />
              {tries.length > 1 ? (
                <Box columnGap={1}>
                  <Button key="prompt-try-back" label="◀" onPress={() => showTry($, -1)} />
                  {t(`try ${shown + 1} of ${tries.length}`, { color: p.muted })}
                  <Button key="prompt-try-next" label="▶" onPress={() => showTry($, 1)} />
                </Box>
              ) : undefined}
            </Box>
            {tries.length > 1 && tries[shown]?.note ? t(`This try's note: ${tries[shown]!.note}`, { color: p.muted }) : undefined}
            {t('Note for the rewrite (Enter regenerates)', { color: p.muted, bold: true })}
            <Input
              key="prompt-note"
              placeholder="shorter, ask for a listener, split into steps…"
              submitLabel="Regenerate"
              onInput={value => void update($, promptNoteDraft, () => value)}
              onSubmit={value => {
                void update($, promptNoteDraft, () => '')
                void rewriteFromTab($, settings, value)
              }}
            />

            {t(`This session: ${countsLine(counts)}`, { color: p.muted })}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button: PlainButton, Text } = $.ui.resolve(e)
    const logoPicture = ((await drawsPicturesHere($)) ? ($.ui.resolve(e) as { Image?: typeof Text }).Image : undefined) as ((props: { source: { png: string }; columns: number; rows: number; alt: string }) => unknown) | undefined
    const themeNow = await themeOf($, settings)
    const drawnNow = await drawnThemeOf($, settings)
    const markNow = settings.hasLogo ? markOf(drawnNow) : undefined
    const guards = await guardLines($)
    const past = await read($, history)
    const pastHidden = await read($, isPastCollapsed)
    const themeListOpen = await read($, isThemeListOpen)
    const promptWorking = await read($, promptBusy)
    const spinNow = await read($, spin)
    const shown = await read($, historyShown)
    const copiedNow = await read($, copied)
    const reviewingNow = await read($, reviewing)
    const sessionId = await $.session.id().catch(() => undefined)
    const footer = await footerOf($)
    const p = PALETTES[drawnNow]
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
    const newer = await read($, updateAvailable)
    const stepsLimit = await read($, stepsShown)
    const lastTips = settings.promptCheck === 'off' ? null : await read($, promptTips)
    // Companion's activity log is off in its env file: said until it is on, or the offer is stopped.
    const logNow = await read($, logState)
    const isLogAdvised = (logNow === 'absent' || logNow === 'off') && (await read($, isCompanionFolder)) && !(await isLogOfferOff($, settings))
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
    const budgets = budgetLines(await withUse($, { ...usage, ...(mine ? { companion: mine } : {}) }), settings)
    const measured = budgets.find(b => !b.isUnmeasured)
    // Every Text carries the pane's colors, so it reads the same on any terminal.
    const t = (text: string, style: { color?: string; bold?: boolean; bg?: string } = {}) => (
      <Text color={style.color ?? p.text} backgroundColor={style.bg ?? p.bg} bold={style.bold}>
        {text}
      </Text>
    )
    const icon = (level: Level) => (
      <Text color={p.status[level]} backgroundColor={p.bg} bold>
        {STATUS[level].icon}
      </Text>
    )
    // A Button's own label takes the terminal's colors (black on a light terminal, unreadable on a dark pane): draw it as Text in the pane's accent instead. The label stays, to name the control.
    const Button = (props: Parameters<typeof PlainButton>[0]) => (
      <PlainButton {...props}>
        <Text color={p.accent} backgroundColor={p.bg}>
          {props.label}
        </Text>
      </PlainButton>
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
        </Box>
        <Text color={p.rule} backgroundColor={p.bg} wrap="truncate-end">
          {decoRule(width)}
        </Text>
        {lastTips && settings.promptView !== 'off' ? (
          <Box>
            <Text backgroundColor={p.bg}>
              {icon(lastTips.tips.some(tip => tip.level === 'serious') ? 'serious' : 'warning')}
              {t(` ${lastTips.tips.length} prompt tip${lastTips.tips.length === 1 ? '' : 's'} for your last prompt${promptWorking ? ` · ${SPINNER[spinNow % SPINNER.length]} upgrading it…` : ''}  `)}
            </Text>
            <Button key="prompt-open" label="Prompt tips" onPress={() => showPromptTab($, lastTips.tips.length)} />
          </Box>
        ) : undefined}
        {isLogAdvised ? (
          <Box flexWrap="wrap" columnGap={1}>
            <Text backgroundColor={p.bg}>
              {icon('warning')}
              {t(" Companion's activity log is off, so runs outside Claude's tool calls go unseen. ")}
            </Text>
            <Button key="log-on" label="Turn it on" onPress={() => void turnOnLogFromPane($, settings)} />
            <Button key="log-never" label="Don't ask" onPress={() => void neverOfferLog($, settings)} />
          </Box>
        ) : undefined}

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
                  measured ? `${meter(Math.min(100, measured.percent), 8)} ${Math.round(measured.percent)}%` : 'not measured',
                  ...budgets.map(b => `${b.isUnmeasured ? '·' : STATUS[b.level].icon} ${b.label}: ${b.detail}`),
                )}
            </Box>
            {sparkline(trail) && (
              <Box>
                {t('tokens per step ', { color: p.muted })}
                {t(sparkline(trail), { color: p.accent })}
              </Box>
            )}
          </Box>
          {markNow === 'logo' && logoPicture && (
            <Box flexDirection="column" flexShrink={0} marginLeft={1}>
              {logoPicture({ source: { png: BOOMI_MARK_PNG }, columns: 6, rows: 3, alt: ' ' })}
            </Box>
          )}
          {markNow === 'flamingo' && (
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
          const logKey = logKeyOf(n)
          const why = logKey ? whys[logKey] : undefined
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
              {why?.phase === 'loading' && t(`      Reading the ${why.source === 'bdi' ? "run's" : 'execution'} log…`, { color: p.muted })}
              {why?.phase === 'error' && t(`      ${why.error}`, { color: p.muted })}
              {why?.phase === 'ready' &&
                t(why.source === 'bdi' ? `      BDI says (${why.severe ?? 0} errors, ${why.warnings ?? 0} warnings in the log):` : `      The log (${why.severe ?? 0} severe, ${why.warnings ?? 0} warnings):`, { color: p.muted })}
              {why?.phase === 'ready' && (why.lines ?? []).map(text => t(`        ${text}`))}
              {(logKey || n.rerunId !== undefined) && (
                <Box>
                  {t('      ')}
                  {logKey && why?.phase !== 'ready' && why?.phase !== 'loading' && (
                    <Button key={`why-${i}`} label="Why?" onPress={() => void explainItem($, settings, n)} />
                  )}
                  {why?.phase === 'ready' && <Button key={`fix-${i}`} label="Ask Claude to fix" onPress={() => askToFix($, n)} />}
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
          <Box columnGap={1}>
            <Button key="history-toggle" label={pastHidden ? '▸ Show' : '▾ Hide'} onPress={() => togglePast($)} />
            {past.phase !== 'loading' && (
              <Button key="history-scan" label={past.phase === 'idle' ? 'Scan' : 'Rescan'} onPress={() => void scanHistory($, settings)} />
            )}
          </Box>
        </Box>
        {!pastHidden && past.phase === 'idle' && note(`What earlier Companion sessions on this machine cost, from Claude Code's transcripts. Scan reads the last ${settings.historyDays} days.`)}
        {!pastHidden && past.sessions && past.sessions.length > 0 && note('Review shows what made a session cost what it did. Copy puts the command that reopens it on the clipboard, for a new terminal.')}
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
              {pastHidden && t(`  ${past.sessions.length} session${past.sessions.length === 1 ? '' : 's'} listed: Show lists them, with Review and Copy`, { color: p.muted })}
              {!pastHidden && past.sessions.slice(0, shown).map((s, i) => {
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
              {!pastHidden && past.sessions.length > PAST_PAGE && (
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

        {newer && (
          <Box marginTop={1}>
            {t(`↑ bc-dashboard ${newer} is available: /bc-dashboard upgrade`, { color: p.muted })}
          </Box>
        )}
        <Box marginTop={newer ? 0 : 1} justifyContent="space-between">
          <Text color={p.muted} backgroundColor={p.bg} dimColor>
            {`session ${footer.session}`}
          </Text>
          <Button key="report-html" label="Report ↗" onPress={() => void reportFromPane($, settings)} />
        </Box>
        <Box>
          {t('🎨 Theme  ', { color: p.muted })}
          <Button key="theme" label={`${THEME_LABELS[themeNow]} ${themeListOpen ? '▴' : '▾'}`} onPress={() => update($, isThemeListOpen, open => !open)} />
        </Box>
        {themeListOpen && (
          <Box flexDirection="column" marginLeft={3}>
            {THEME_OPTIONS.map(option => (
              <Button
                key={`theme-${option.value}`}
                label={`${option.value === themeNow ? '◆' : '◇'} ${option.label}`}
                onPress={async () => {
                  await pickTheme($, settings, themeNamed(option.value) ?? 'auto')
                  await update($, isThemeListOpen, () => false)
                }}
              />
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
