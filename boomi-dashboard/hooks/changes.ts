// The report's Platform changes: every change the session made in Boomi
// through Companion, oldest first, with the budget override that let it
// through when there was one. Plain functions: nothing here touches the
// engine.

import type { Activity } from '../types'
import { STATUS, describe, levelOf } from './activity'
import { LOCAL_ONLY, integrationChange } from './budget-gate'
import { PRODUCT_NAMES } from './products'
import { mask } from './upgrade'
import type { Table } from './export'

/**
 * Whether a step changed something in Boomi, or tried to: a create, save,
 * deploy, undeploy or test, another plugin's step that isn't local, or one of
 * bc-integration's other scripts run with a subcommand that changes something
 * (a folder, a branch, extensions, Event Streams). Edits and pulls are local; an override is
 * the person's choice, not a change; a recipe's component is part of its
 * install.
 */
export const isPlatformChange = (a: Activity): boolean => {
  if (a.isBudgetOverride || a.recipe) return false
  if (a.kind === 'create' || a.kind === 'push' || a.kind === 'deploy' || a.kind === 'undeploy' || a.kind === 'test') return true
  if (a.kind !== 'other') return false
  if (a.product) return !LOCAL_ONLY.has(a.script ?? '') && !LOCAL_ONLY.has(`${a.script} ${a.verb}`)
  return integrationChange(a.script, a.verb) !== undefined
}

/** An override in words: "allowed once, with the session budget ($5.20 of $5.00, 104%) spent". */
const overrideText = (o: Activity): string => {
  const spent = o.detail.match(/, with (.+) spent$/)?.[1]
  const how = /^allowed once\b/.test(o.detail) ? 'allowed once' : 'allowed for the session'
  return spent ? `${how}, with ${spent} spent` : how
}

/**
 * The override that let each change through, by the change's id. "Allowed
 * once" covers the first change that ran after it; "for the rest of the
 * session" covers every later change in that session. A change the gate
 * refused took no override.
 */
export const overridesFor = (activity: readonly Activity[]): Map<number, string> => {
  const out = new Map<number, string>()
  const sorted = [...activity].sort((a, b) => a.startedAt - b.startedAt || a.id - b.id)
  const open = new Map<string, { override: Activity; isOnce: boolean; used: boolean }>()
  for (const a of sorted) {
    const session = a.session ?? ''
    if (a.isBudgetOverride) {
      open.set(session, { override: a, isOnce: /^allowed once\b/.test(a.detail), used: false })
      continue
    }
    if (!isPlatformChange(a) || a.outcome === 'blocked') continue
    const held = open.get(session)
    if (!held || (held.isOnce && held.used)) continue
    out.set(a.id, overrideText(held.override))
    held.used = true
  }
  return out
}

/** How a change went, in a word or two. */
export const resultOf = (a: Activity): string => {
  if (a.isBudgetBlocked) return 'blocked by budget, not run'
  if (a.outcome === 'blocked') return 'blocked, not run'
  if (a.outcome === 'running') return 'still running'
  if (a.kind === 'test' && a.executionStatus) return a.executionStatus === 'COMPLETE' ? 'passed' : a.executionStatus.toLowerCase()
  if (a.runStatus && a.outcome !== 'failed') return a.runStatus.toLowerCase()
  return a.outcome === 'ok' ? 'done' : 'failed'
}

/** The ID a change left to find it by: a deploy's package, a test's execution, a run, a version. */
export const referenceOf = (a: Activity): string => {
  const pkg = a.kind === 'deploy' ? a.detail.match(/\(package: ([^)\s]+)\)/)?.[1] : undefined
  if (pkg) return `package ${pkg}`
  if (a.executionId) return `execution ${a.executionId}`
  if (a.runId) return `run ${a.runId}`
  if (a.deploymentId) return `deployment ${a.deploymentId}`
  if (a.kind === 'push' && a.version) return `version ${a.version}`
  return ''
}

/** A time for a spreadsheet: `2026-10-13 17:15`, in UTC. */
const sheetTime = (at: number) => new Date(at).toISOString().slice(0, 16).replace('T', ' ')

/** The session's platform changes, oldest first. */
export const platformChanges = (activity: readonly Activity[]): Activity[] =>
  activity.filter(isPlatformChange).sort((a, b) => a.startedAt - b.startedAt || a.id - b.id)

/**
 * Every platform change as a table to take elsewhere: when, which product,
 * what it did, the component's ID, how it went, the ID it left, and the
 * budget override that let it through. A cell the session doesn't know is
 * left empty.
 */
export const changeTable = (activity: readonly Activity[]): Table => {
  const overrides = overridesFor(activity)
  return {
    header: ['When (UTC)', 'Product', 'Change', 'Component ID', 'Result', 'Reference', 'Budget override'],
    rows: platformChanges(activity).map(a => [
      sheetTime(a.startedAt),
      a.product ? PRODUCT_NAMES[a.product] : 'Integration',
      mask(describe(a)),
      a.componentId ?? '',
      resultOf(a),
      referenceOf(a),
      overrides.get(a.id) ?? '',
    ]),
  }
}

const cell = (text: string) => text.replace(/\|/g, '\\|')

/**
 * The Markdown report's Platform changes section, as its lines: a table of
 * every change, oldest first, each result with its icon and label. Empty when
 * the session changed nothing in Boomi.
 */
export const changeLines = (activity: readonly Activity[]): string[] => {
  const changes = platformChanges(activity)
  if (changes.length === 0) return []
  const overrides = overridesFor(activity)
  const lines = ['## Platform changes', '', 'Every change made in Boomi, oldest first:', '', '| When (UTC) | Change | Result | Reference | Budget override |', '|---|---|---|---|---|']
  for (const a of changes) {
    lines.push(`| ${sheetTime(a.startedAt)} | ${cell(mask(describe(a)))} | ${STATUS[levelOf(a)].icon} ${resultOf(a)} | ${cell(referenceOf(a))} | ${cell(overrides.get(a.id) ?? '')} |`)
  }
  return lines
}
