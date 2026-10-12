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
}

export type Run = {
  executionId: string
  processName: string
  status: string
  at: string
}

/** A component someone asked the cockpit to watch for changes on the platform. */
export type Watched = {
  componentId: string
  name?: string
  version?: string
  modifiedBy?: string
  modifiedDate?: string
  /** Set when its version moved since it was first seen, until /cockpit seen. */
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

export type Cockpit = {
  activity: Activity[]
  platform: Platform
  watched: Watched[]
}

declare module 'claude-code' {
  interface PluginState {
    'boomi-cockpit': { cockpit: Cockpit; isBandHidden: boolean }
  }
}
