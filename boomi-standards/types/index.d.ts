// The state this mod keeps for the session: what its checks found, so the
// boomi-dashboard mod can show it beside the rest of the session.

/** One check: before a Companion script ran, or from /standards check. */
export type StandardsCheck = {
  at: number
  /** What triggered it: Companion's create, push or deploy, or /standards check. */
  script: 'create' | 'push' | 'deploy' | 'check'
  files: number
  errors: number
  warnings: number
  /** True when the mod refused the script. */
  isBlocked: boolean
  /** The first few findings, each `file: message`. */
  findings: string[]
}

export type StandardsActivity = {
  checks: number
  blocked: number
  last?: StandardsCheck
}

declare module 'claude-code' {
  interface PluginState {
    'boomi-standards': { activity: StandardsActivity }
  }
}
