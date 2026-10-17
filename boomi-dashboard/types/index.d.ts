/**
 * What happened: a Companion script run, or Claude editing a component's XML.
 * `other` is any other Companion script (search, pull's siblings, env check, ...).
 */
export type ActivityKind = 'edit' | 'create' | 'push' | 'pull' | 'deploy' | 'undeploy' | 'test' | 'other'

/**
 * Which Boomi Companion plugin's script a step ran, beyond bc-integration's:
 * Marketplace recipes, Data Hub, BDI (formerly Rivery), Agentstudio, or
 * custom connector development. Absent for bc-integration's own.
 */
export type Product = 'marketplace' | 'datahub' | 'bdi' | 'agentstudio' | 'connectordev'

/** A Boomi Companion plugin on in this session (`bc-integration`, `bc-datahub`, ...), and its version when Claude Code knows it. */
export type CompanionPlugin = { name: string; version?: string }

/** How it went: `blocked` is a call another mod refused before it ran. */
export type Outcome = 'running' | 'ok' | 'failed' | 'blocked'

/** One thing that happened to a component this session. */
export type Activity = {
  id: number
  kind: ActivityKind
  outcome: Outcome
  /** The component's name, else its file, else the process ID. */
  subject: string
  /** The line that says what happened: Companion's SUCCESS or ERROR line. */
  detail: string
  startedAt: number
  endedAt?: number
  /** The component file, from `active-development/` on, when there is one. */
  file?: string
  componentId?: string
  /** The component's type as its XML has it: process, connector-settings, ... */
  type?: string
  /** For `other`: the script's name without `boomi-` and `.sh`. */
  script?: string
  /** Another Companion plugin's step: its product, and the script's subcommand (`deploy`, `run`, ...). One of bc-integration's other scripts has its subcommand too (`branch create`, `extensions set`). */
  product?: Product
  verb?: string
  /** A component a Marketplace recipe installed: the recipe's name. Its install is the step; this is the component. */
  recipe?: string
  /** What another plugin's step acted on, in full (its subject may be shortened): a BDI flow's ID, say. */
  ref?: string
  /**
   * Work another plugin started that finishes later: a BDI flow run, a Data
   * Hub deployment. Its ID, and its status as the latest response or status
   * check Claude ran found it.
   */
  runId?: string
  runStatus?: string
  /**
   * An Agentstudio step: the deployment a deploy (or package-create --deploy)
   * made or a test conversation talked to, and the conversation's session ID.
   * The agent's own ID is `ref`.
   */
  deploymentId?: string
  sessionId?: string
  /**
   * A connector step: the project folder its descriptor or archive is in,
   * and the connector group it uploads to or changes. The version it names
   * is `version`; a version change's classification is `ref`.
   */
  project?: string
  group?: string
  /** A pushed component's new version. */
  version?: string
  /** A test's execution status (COMPLETE, ERROR, ...) and ID. */
  executionStatus?: string
  executionId?: string
  /**
   * The session's tokens and cost when this step began. The difference from
   * the step before is what Claude spent getting to this one.
   */
  tokensAt?: number
  usdAt?: number
  /** The model that answered the latest call before this step. */
  model?: string
  /** The Claude Code session the step happened in (since 0.26.0): the report tells sessions apart by it. */
  session?: string
  /** Brought back from an earlier session in the same folder. */
  isRestored?: boolean
  /**
   * Older than the window, shown only when asked (Show earlier): history, so
   * its failures don't need attention now.
   */
  isEarlier?: boolean
  /** A test's arguments to its script, so Run again can repeat it. */
  args?: string[]
  /**
   * Read from Companion's activity log rather than seen in Claude's tool calls:
   * a script run outside them (a terminal, before the mod loaded). `logKey`
   * names the log entry, so it's added once.
   */
  source?: 'log'
  logKey?: string
  /** Refused by the dashboard's budget enforcement (budgetEnforce), not by Companion or a guard. */
  isBudgetBlocked?: true
  /** The person allowed a Companion change past a spent budget (confirm mode): kept as a step for the audit trail. */
  isBudgetOverride?: true
}

/**
 * What a session that worked with Companion did, kept for the next session in
 * the same folder: the banner's "Last session" line.
 */
export type SessionRecap = {
  endedAt: number
  components: number
  saves: number
  deploys: number
  tests: number
  testsFailed: number
  /** How many items still needed attention when it ended. */
  open: number
  usd?: number
}

/** Tokens by kind, as the API reports them. */
export type TokenSplit = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** Every token the session's model calls used, summed as the API reported them. */
export type Ledger = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** How many model calls the sums cover. */
  calls: number
  /** Tokens per model, by the id the API reports; absent in a ledger from an older version. */
  models?: Record<string, number>
  /** The model that answered the latest call. */
  lastModel?: string
  /** Each model's tokens by kind; absent in a ledger from an older version. */
  byModel?: Record<string, TokenSplit>
}

export type Run = {
  executionId: string
  processName: string
  status: string
  at: string
  /** The process's component ID, to match the run to a component. */
  processId?: string
  /** How it started: exec_listener for a listener, exec_manual, schedule, ... */
  executionType?: string
}

/** A component someone asked the dashboard to watch for changes on the platform. */
export type Watched = {
  componentId: string
  name?: string
  version?: string
  modifiedBy?: string
  modifiedDate?: string
  /** Set when its version moved since it was first seen, until /bc-dashboard seen. */
  changedBy?: string
  error?: string
}

/** What the Platform API polling found. */
export type Platform = {
  phase: 'off' | 'ok' | 'error'
  message: string
  environmentId?: string
  checkedAt?: number
  runs: Run[]
}

export type Dashboard = {
  activity: Activity[]
  platform: Platform
  watched: Watched[]
  /** How many steps came back from an earlier session in this folder. */
  restored?: number
  /** This folder's steps from before the window: kept, and shown when asked. */
  earlier?: Activity[]
  /** Failed runs marked as seen (expected), by execution ID: they leave Needs attention. */
  seenRuns?: string[]
  /** Failed steps closed from Needs attention, by activity ID. */
  closedSteps?: number[]
  /**
   * Data Hub quarantine, by universe ID, as Claude's latest query of all its
   * active entries found it: how many, their causes and the first reason.
   * `seen` is the count closed from Needs attention, so only more is news.
   */
  quarantine?: Record<string, QuarantineSeen>
}

/** Claude Code's /usage breakdown as the dashboard last read it (hooks/usage-breakdown.ts's UsageBreakdown). */
export type UsageBreakdownSeen = {
  isSubscription: boolean
  isUnreadable?: true
  extra?: { limitUsd: number; usedUsd: number; percent: number }
  day?: { companion?: number; plugins: { name: string; percent: number }[]; habits: { percent: number; text: string }[]; requests?: number; sessions?: number }
  week?: { companion?: number; plugins: { name: string; percent: number }[]; habits: { percent: number; text: string }[]; requests?: number; sessions?: number }
}

/** A prompt check: what a Companion prompt can leave out (see hooks/prompt-check.ts). */
export type PromptCheckCode = 'subject' | 'environment' | 'test' | 'production' | 'steps' | 'error' | 'build' | 'map' | 'secret' | 'aim'

/** One thing a prompt leaves out, as a line: `deploy: no environment named; the session points at …`. */
export type PromptTip = { code: PromptCheckCode; level: 'warning' | 'serious'; text: string }

/** The latest checked prompt that had tips: the prompt masked, its tips and the upgrade. Never the prompt as typed. */
export type PromptTips = {
  at: number
  masked: string
  tips: PromptTip[]
  upgrade: string
  /** Set once a model rewrote the upgrade (/bc-dashboard prompt upgrade): which model, and the tokens it took. */
  rewrittenBy?: string
  tokens?: number
  /** Every upgrade so far, the checks' first; `shown` is the one in `upgrade`. */
  tries?: PromptTry[]
  shown?: number
  /** What the shown rewrite says it changed and why, up to three notes. */
  why?: string[]
  /** The Companion plugins (with versions) whose docs the shown rewrite read. */
  guidedBy?: string[]
}

/** One upgrade of a prompt: by the checks, or by a model with the person's note. */
export type PromptTry = { text: string; by: string; note?: string; tokens?: number; why?: string[] }

/** How many prompts were checked and had tips this session, and how many tips the next prompt followed, per check. */
export type PromptCounts = {
  checked: number
  tipped: number
  followed: number
  /** Prompts that were a suggestion from the prompt box taken as it was: never checked. */
  suggested?: number
  byCode: Partial<Record<PromptCheckCode, { seen: number; followed: number }>>
}

/** One universe's Data Hub quarantine, as the dashboard last saw it. */
export type QuarantineSeen = { count: number; causes: string; reason?: string; checkedAt: number; seen?: number }

/** Reading a failed execution's log: fetching, what it says, or why it couldn't be read. */
export type DiagnosisState = {
  phase: 'loading' | 'ready' | 'error'
  /** Whose log it is: a BDI run's (severe then counts its ERROR lines), else a Boomi execution's. */
  source?: 'bdi'
  /** The log's SEVERE lines (else its last few), and how many SEVERE and WARNING lines it has. */
  lines?: string[]
  severe?: number
  warnings?: number
  error?: string
}

/** The pane's colors: Exosphere or Whimsical (Valence), each light and dark, `auto` (Exosphere in the system's light or dark), or the terminal's own theme. */
export type PaneTheme = 'auto' | 'exosphere-light' | 'exosphere-dark' | 'whimsical-light' | 'whimsical-dark' | 'terminal'

/** A past Companion session, from the transcripts on this machine. */
export type PastSession = {
  id: string
  project?: string
  startedAt?: string
  endedAt?: string
  /** Claude Code's own cost for the session, when its transcript recorded one. */
  costUsd?: number
  /** New tokens (input, output, cache writes) and cache reads. */
  tokens: number
  cached: number
  models: string[]
  /** Companion script runs by kind: push 3, deploy 1, ... */
  runs: Partial<Record<ActivityKind, number>>
  /** Other Companion plugins' steps that changed something, by product: datahub 2, bdi 1, ... */
  products?: Partial<Record<Product, number>>
  /** For the cost review: the person's prompts, the largest context one call sent, how often it compacted, its subagents' new tokens. */
  prompts?: number
  peakContext?: number
  compactions?: number
  subagentTokens?: number
  /** Its main transcript, for a closer look. */
  file?: string
  /** New tokens by model id. */
  modelTokens?: Record<string, number>
  /** The same step on the same component three times or more: tests, pushes, deploys. */
  repeats?: { name: string; kind: ActivityKind; count: number }[]
  /** The components the runs named: their file names, else their IDs. */
  components: string[]
  /** What the session was about: its title, else the person's first request. */
  label?: string
}

export type HistoryState = {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  sessions?: PastSession[]
  scannedAt?: number
  /** How many transcripts the scan read. */
  scanned?: number
  error?: string
}

/**
 * What the dashboard reads of the other Boomi mods' state, when they're
 * loaded: the shapes boomi-standards (`activity`) and boomi-runtime
 * (`runtime`) keep, cut to the fields shown here.
 */
export type StandardsSeen = {
  checks: number
  blocked: number
  last?: { script: string; files: number; errors: number; warnings: number; isBlocked: boolean; findings: string[] }
}

export type RuntimeSeen = {
  phase: 'idle' | 'installing' | 'starting' | 'online' | 'stopping' | 'error'
  message: string
  name?: string
  smoke?: { phase: 'running' | 'passed' | 'failed'; message: string }
}

declare module 'claude-code' {
  interface PluginState {
    'boomi-dashboard': { budgetAllowed: boolean; budgetPaused: string; enforceNoted: string; dashboard: Dashboard; isBandHidden: boolean; ledger: Ledger; isWorking: boolean; theme: PaneTheme | null; frame: number; bandFrame: number; paneSize: { rows: number; columns: number } | null; tip: number; recap: SessionRecap | null; isCompanionFolder: boolean; companionPlugins: CompanionPlugin[] | null; updateAvailable: string | null; diagnoses: Record<string, DiagnosisState>; budgetAlert: number; limitAlerts: Record<string, number>; share: { days: Record<string, number>; baseline?: { resetsAt?: string; percent: number }; counted: number } | null; suggested: string; shownSuggestion: string; history: HistoryState; copied: { id: string; isCopied: boolean } | null; reviewing: string | null; historyShown: number; stepsShown: number; promptTips: PromptTips | null; promptCounts: PromptCounts; promptBusy: boolean; promptNote: string; promptHeld: string | null; promptNudgeHidden: number; promptNoteDraft: string; promptExpanded: boolean; isPastCollapsed: boolean; isThemeListOpen: boolean; usageBreakdown: { breakdown: UsageBreakdownSeen; checkedAt: number; days?: Record<string, number> } | null }
  }
}
