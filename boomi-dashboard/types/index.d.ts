/**
 * What happened: a Companion script run, or Claude editing a component's XML.
 * `other` is any other Companion script (search, pull's siblings, env check, ...).
 */
export type ActivityKind = 'edit' | 'create' | 'push' | 'pull' | 'deploy' | 'undeploy' | 'test' | 'other'

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
  /** Brought back from an earlier session in the same folder. */
  isRestored?: boolean
  /** A test's arguments to its script, so Run again can repeat it. */
  args?: string[]
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
  /** Failed runs marked as seen (expected), by execution ID: they leave Needs attention. */
  seenRuns?: string[]
  /** Failed steps closed from Needs attention, by activity ID. */
  closedSteps?: number[]
}

/** Reading a failed execution's log: fetching, what it says, or why it couldn't be read. */
export type DiagnosisState = {
  phase: 'loading' | 'ready' | 'error'
  /** The log's SEVERE lines (else its last few), and how many SEVERE and WARNING lines it has. */
  lines?: string[]
  severe?: number
  warnings?: number
  error?: string
}

/** The pane's colors: Valence Day, Valence Night, or the terminal's own theme. */
export type PaneTheme = 'day' | 'night' | 'terminal'

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
  /** The components the runs named: their file names, else their IDs. */
  components: string[]
}

export type HistoryState = {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  sessions?: PastSession[]
  scannedAt?: number
  /** How many transcripts the scan read. */
  scanned?: number
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'boomi-dashboard': { dashboard: Dashboard; isBandHidden: boolean; ledger: Ledger; isWorking: boolean; theme: PaneTheme | null; frame: number; isRunsCollapsed: boolean; diagnoses: Record<string, DiagnosisState>; budgetAlert: number; suggested: string; history: HistoryState }
  }
}
