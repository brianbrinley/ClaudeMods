// /bc-dashboard report html: the session report as one self-contained HTML
// file to open in a browser or share. It holds the same facts as the Markdown
// report, styled to Boomi's Exosphere design system (its Exo III tokens, light
// and dark, Poppins and Noto Sans), with charts of the session, sortable
// tables and a filterable list of steps. Plain functions: nothing here touches
// the engine.

import type { Activity, Dashboard, PastSession, Product } from '../types'
import type { ComponentDetails } from './platform'
import {
  agentStages,
  agents,
  attention,
  closedCount,
  components,
  connectorStages,
  connectors,
  describe,
  duration,
  formatCost,
  formatTokens,
  friendlyType,
  levelOf,
  FLAMINGO_IDLE,
  limitsLine,
  quarantineLines,
  sessionRuns,
  spendOf,
  spends,
  shortWhen,
  repaired,
  stages,
  withoutEchoes,
} from './activity'
import type { BudgetLine, Level, ReportFacts, Stage } from './activity'
import { PRODUCT_NAMES } from './products'
import { mask } from './upgrade'
import { toCsv, toTsv } from './export'
import { changeTable, overridesFor, platformChanges, referenceOf, resultOf } from './changes'
import type { Table } from './export'

/** Text made safe for HTML, credential-shaped strings masked first. */
export const esc = (text: string): string =>
  mask(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const LABEL: Record<Level, string> = { healthy: 'Healthy', warning: 'Warning', serious: 'Blocked', critical: 'Failed' }
const LEVELS: Level[] = ['healthy', 'warning', 'serious', 'critical']

/**
 * The status icons, drawn on a 16px grid in one stroke: a check, a half-filled
 * circle, a warning triangle and a cross. Always beside a label, never alone.
 */
const ICON_PATHS: Record<Level, string> = {
  healthy: '<circle cx="8" cy="8" r="6.25"/><path d="M5.3 8.2l1.9 1.9 3.5-3.8"/>',
  warning: '<circle cx="8" cy="8" r="6.25"/><path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" class="solid"/>',
  serious: '<path d="M8 2.1l6.2 11H1.8z"/><path d="M8 6.4v3M8 11.2v.05"/>',
  critical: '<circle cx="8" cy="8" r="6.25"/><path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2"/>',
}
export const icon = (level: Level) => `<svg class="i" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICON_PATHS[level]}</svg>`

/** A drawn "i" in a circle: information, not a status, so it takes no status color. */
const INFO_ICON = '<svg class="i" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.25"/><path d="M8 7.2v4M8 4.9v.05"/></svg>'

/**
 * What the report shows where something is missing, always with the reason
 * (on hover, and read out by a screen reader):
 * - `notDone`: it didn't happen, nothing to fix: "—".
 * - `unavailable`: it happened, or should be there, but we couldn't find it out.
 * - `notSet`: it needs setting up, and the reason says how.
 */
export const notDone = (why: string) => `<span class="nd" title="${esc(why)}">—<span class="sr"> ${esc(why)}</span></span>`
export const unavailable = (what: string, why: string) => `<span class="na" title="${esc(why)}">${INFO_ICON}${esc(what)}<span class="sr">: ${esc(why)}</span></span>`
export const notSet = (what: string, how: string) => `<span class="na na-set" title="${esc(how)}">${INFO_ICON}${esc(what)}</span> <span class="na-how">${how}</span>`

/** A status: icon and label together, never color alone. */
const status = (level: Level, text: string) =>
  `<span class="status status-${level}">${icon(level)}<span class="sr">${LABEL[level]}: </span>${esc(text)}</span>`

/** A component's or agent's stages as Exosphere badges. */
const badges = (list: readonly Stage[]) =>
  `<span class="rail">${list.map(s => `<span class="badge badge-${s.level}">${icon(s.level)}<span class="sr">${LABEL[s.level]}: </span>${esc(s.text)}</span>`).join(' ')}</span>`

/** A cell that sorts by a number, not its text. */
const num = (value: number | undefined, shown: string | undefined) => `<td class="n" data-sort="${value ?? -1}">${esc(shown ?? '')}</td>`

const table = (id: string, caption: string, head: string[], rows: string[], cls = '', note = '', tools = '') =>
  rows.length === 0
    ? ''
    : `<section id="${id}"><h2>${esc(caption)} <span class="count">${rows.length}</span>${note ? ` <span class="aside">${esc(note)}</span>` : ''}</h2>${tools}
<div class="scroll"><table class="sortable${cls ? ` ${cls}` : ''}"><thead><tr>${head.map((h, i) => `<th scope="col"><button type="button" data-col="${i}">${esc(h)}</button></th>`).join('')}</tr></thead>
<tbody>${rows.join('\n')}</tbody></table></div></section>`

/** Each product's fixed slot in the categorical palette: color follows the product, never its rank. */
const PRODUCT_ORDER: (Product | 'integration')[] = ['integration', 'marketplace', 'datahub', 'bdi', 'agentstudio', 'connectordev']
const productKey = (a: Activity): Product | 'integration' => a.product ?? 'integration'
const productName = (key: Product | 'integration') => (key === 'integration' ? 'Integration' : PRODUCT_NAMES[key])
const slot = (key: Product | 'integration') => PRODUCT_ORDER.indexOf(key) + 1

/** A chart's data as a table, for screen readers and anyone who'd rather read numbers. */
const dataTable = (head: string[], rows: (string | number)[][]) =>
  `<details class="data"><summary>Show the data</summary><table><thead><tr>${head.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map(r => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(String(c))}</th>` : `<td class="n">${esc(String(c))}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table></details>`

const legend = (items: { cls: string; label: string; level?: Level }[]) =>
  `<ul class="legend">${items.map(i => `<li><span class="swatch ${i.cls}" aria-hidden="true"></span>${i.level ? `<span class="${i.cls}-ink">${icon(i.level)}</span>` : ''}${esc(i.label)}</li>`).join('')}</ul>`

/** A bar: square at the baseline, a 4px rounded data end. */
const hbar = (x: number, y: number, w: number, h: number, r = 4) => {
  const rr = Math.min(r, w / 2, h / 2)
  return `M${x} ${y}h${(w - rr).toFixed(1)}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${(h - 2 * rr).toFixed(1)}a${rr} ${rr} 0 0 1 -${rr} ${rr}h-${(w - rr).toFixed(1)}z`
}

/** How each product's steps went, a bar per product stacked by outcome; a click filters the steps below. */
const outcomesByProduct = (steps: readonly Activity[]): string => {
  const groups = new Map<Product | 'integration', Record<Level, number>>()
  for (const a of steps) {
    const key = productKey(a)
    const c = groups.get(key) ?? { healthy: 0, warning: 0, serious: 0, critical: 0 }
    c[levelOf(a)]++
    groups.set(key, c)
  }
  if (groups.size === 0) return ''
  const rows = PRODUCT_ORDER.filter(k => groups.has(k)).map(k => ({ key: k, counts: groups.get(k)! }))
  const max = Math.max(...rows.map(r => LEVELS.reduce((s, l) => s + r.counts[l], 0)))
  const rowH = 30
  const left = 104
  const plotW = 380
  const marks = rows
    .map((r, i) => {
      let x = left
      const total = LEVELS.reduce((s, l) => s + r.counts[l], 0)
      const shown = LEVELS.filter(l => r.counts[l] > 0)
      const segs = shown.map((l, k) => {
        const w = (r.counts[l] / max) * plotW - (k < shown.length - 1 ? 2 : 0)
        const d = k === shown.length - 1 ? hbar(x, i * rowH + 6, Math.max(1, w), 18) : `M${x.toFixed(1)} ${i * rowH + 6}h${Math.max(1, w).toFixed(1)}v18h-${Math.max(1, w).toFixed(1)}z`
        x += w + 2
        return `<path d="${d}" class="fill-${l}"/>`
      })
      const tip = `${productName(r.key)}: ${total} step${total === 1 ? '' : 's'}${LEVELS.filter(l => r.counts[l]).map(l => `, ${r.counts[l]} ${LABEL[l].toLowerCase()}`).join('')}`
      return `<g class="hit" tabindex="0" role="button" data-tip="${esc(tip)}" data-pick="product:${esc(productName(r.key))}"><rect x="0" y="${i * rowH}" width="560" height="${rowH}" class="target"/>
<text x="0" y="${i * rowH + 19}" class="label">${esc(productName(r.key))}</text>${segs.join('')}<text x="${(x + 4).toFixed(1)}" y="${i * rowH + 19}" class="value">${total}</text></g>`
    })
    .join('')
  return `<figure class="chart"><figcaption><h3>Outcomes by product</h3><span class="sub screen-only">click a product to list its steps</span></figcaption>
${legend(LEVELS.map(l => ({ cls: `fill-${l}`, label: LABEL[l], level: l })))}
<svg viewBox="0 0 560 ${rows.length * rowH}" role="img" aria-label="Steps per product, stacked by outcome">${marks}</svg>
${dataTable(['Product', ...LEVELS.map(l => LABEL[l])], rows.map(r => [productName(r.key), ...LEVELS.map(l => r.counts[l])]))}</figure>`
}

/** What each product took, in cost (or tokens before any cost is known), a bar each in the product's own color. */
const spendByProduct = (activity: readonly Activity[], all: ReturnType<typeof spends>): string => {
  const groups = new Map<Product | 'integration', number[]>()
  for (const a of activity) groups.set(productKey(a), [...(groups.get(productKey(a)) ?? []), a.id])
  const rows = PRODUCT_ORDER.filter(k => groups.has(k)).map(k => ({ key: k, ...spendOf(groups.get(k)!, all) }))
  const byUsd = rows.some(r => (r.usd ?? 0) > 0)
  const value = (r: { usd?: number; tokens?: number }) => (byUsd ? (r.usd ?? 0) : (r.tokens ?? 0))
  const measured = rows.filter(r => value(r) > 0)
  if (measured.length === 0) return ''
  const max = Math.max(...measured.map(value))
  const rowH = 30
  const left = 104
  const marks = measured
    .map((r, i) => {
      const w = Math.max(2, (value(r) / max) * 360)
      const shown = byUsd ? (formatCost(r.usd) ?? '$0') : formatTokens(r.tokens ?? 0)
      return `<g class="hit" tabindex="0" data-tip="${esc(`${productName(r.key)}: ${shown}${byUsd && r.tokens ? `, ${formatTokens(r.tokens)} tokens` : ''}`)}"><rect x="0" y="${i * rowH}" width="560" height="${rowH}" class="target"/>
<text x="0" y="${i * rowH + 19}" class="label">${esc(productName(r.key))}</text><path d="${hbar(left, i * rowH + 6, w, 18)}" class="cat-${slot(r.key)}"/><text x="${(left + w + 6).toFixed(1)}" y="${i * rowH + 19}" class="value">${esc(shown)}</text></g>`
    })
    .join('')
  return `<figure class="chart"><figcaption><h3>Spend by product</h3><span class="sub">${byUsd ? 'cost' : 'tokens'} Claude spent getting to each product's steps</span></figcaption>
<svg viewBox="0 0 560 ${measured.length * rowH}" role="img" aria-label="Spend by product">${marks}</svg>
${dataTable(['Product', byUsd ? 'Cost' : 'Tokens'], measured.map(r => [productName(r.key), byUsd ? (formatCost(r.usd) ?? '$0') : formatTokens(r.tokens ?? 0)]))}</figure>`
}

/** A session's name on a chart: its day and start time. */
const sessionTick = (at: number) => `${new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} · ${new Date(at).toISOString().slice(11, 16)}`

/**
 * Each session in its own row, oldest first: what it cost (a paler bar for a
 * cost counted only up to its last Companion step), and how its steps went,
 * stacked by outcome. A click opens that session's steps. Needs two sessions.
 */
const sessionCharts = (summaries: readonly SessionSummary[], steps: readonly Activity[], sessionOf: (a: Activity) => string): string[] => {
  if (summaries.length < 2) return []
  const rows = [...summaries].sort((a, b) => a.firstAt - b.firstAt)
  const rowH = 30
  const left = 112
  const pick = (id: string, inner: string) => `<a class="session-pick" href="#${sessionAnchor(id)}">${inner}</a>`
  const charts: string[] = []

  const costed = rows.filter(s => s.usd !== undefined)
  if (costed.length >= 2) {
    const max = Math.max(...costed.map(s => s.usd!)) || 1
    const shown = (s: SessionSummary) => `${s.usdIs === 'atLeast' ? 'at least ' : ''}${formatCost(s.usd) ?? '$0'}`
    const marks = costed
      .map((s, i) => {
        const w = Math.max(2, (s.usd! / max) * 330)
        const tip = `${sessionTick(s.firstAt)} UTC: ${shown(s)}, ${s.steps} step${s.steps === 1 ? '' : 's'}`
        return pick(s.id, `<g class="hit" data-tip="${esc(tip)}"><rect x="0" y="${i * rowH}" width="560" height="${rowH}" class="target"/>
<text x="0" y="${i * rowH + 19}" class="label">${esc(sessionTick(s.firstAt))}</text><path d="${hbar(left, i * rowH + 6, w, 18)}" class="cat-1${s.usdIs === 'atLeast' ? ' at-least' : ''}"/><text x="${(left + w + 6).toFixed(1)}" y="${i * rowH + 19}" class="value">${esc(shown(s))}</text></g>`)
      })
      .join('')
    const hasAtLeast = costed.some(s => s.usdIs === 'atLeast')
    charts.push(`<figure class="chart"><figcaption><h3>Cost by session</h3><span class="sub"><span class="screen-only">click a session to open its steps${hasAtLeast ? '; ' : ''}</span>${hasAtLeast ? 'a paler bar is counted only up to its last Companion step' : ''}</span></figcaption>
<svg viewBox="0 0 560 ${costed.length * rowH}" role="img" aria-label="Cost by session">${marks}</svg>
${dataTable(['Session (UTC)', 'Cost'], costed.map(s => [sessionTick(s.firstAt), shown(s)]))}</figure>`)
  }

  const counts = new Map<string, Record<Level, number>>()
  for (const a of steps) {
    const c = counts.get(sessionOf(a)) ?? { healthy: 0, warning: 0, serious: 0, critical: 0 }
    c[levelOf(a)]++
    counts.set(sessionOf(a), c)
  }
  const counted = rows.filter(s => counts.has(s.id))
  if (counted.length >= 2) {
    const total = (id: string) => LEVELS.reduce((sum, l) => sum + counts.get(id)![l], 0)
    const max = Math.max(...counted.map(s => total(s.id)))
    const marks = counted
      .map((s, i) => {
        const c = counts.get(s.id)!
        const levels = LEVELS.filter(l => c[l] > 0)
        let x = left
        const segs = levels.map((l, k) => {
          const w = Math.max(1, (c[l] / max) * 330 - (k < levels.length - 1 ? 2 : 0))
          const d = k === levels.length - 1 ? hbar(x, i * rowH + 6, w, 18) : `M${x.toFixed(1)} ${i * rowH + 6}h${w.toFixed(1)}v18h-${w.toFixed(1)}z`
          x += w + 2
          return `<path d="${d}" class="fill-${l}"/>`
        })
        const tip = `${sessionTick(s.firstAt)} UTC: ${total(s.id)} step${total(s.id) === 1 ? '' : 's'}${levels.map(l => `, ${c[l]} ${LABEL[l].toLowerCase()}`).join('')}`
        return pick(s.id, `<g class="hit" data-tip="${esc(tip)}"><rect x="0" y="${i * rowH}" width="560" height="${rowH}" class="target"/>
<text x="0" y="${i * rowH + 19}" class="label">${esc(sessionTick(s.firstAt))}</text>${segs.join('')}<text x="${(x + 4).toFixed(1)}" y="${i * rowH + 19}" class="value">${total(s.id)}</text></g>`)
      })
      .join('')
    charts.push(`<figure class="chart"><figcaption><h3>Outcomes by session</h3><span class="sub">each session's steps, stacked by how they went</span></figcaption>
${legend(LEVELS.map(l => ({ cls: `fill-${l}`, label: LABEL[l], level: l })))}
<svg viewBox="0 0 560 ${counted.length * rowH}" role="img" aria-label="Steps per session, stacked by outcome">${marks}</svg>
${dataTable(['Session (UTC)', ...LEVELS.map(l => LABEL[l])], counted.map(s => [sessionTick(s.firstAt), ...LEVELS.map(l => counts.get(s.id)![l])]))}</figure>`)
  }
  return charts
}

/** The session's cost as it grew, a point per step; hovering a point names the step. */
const costOverTime = (activity: readonly Activity[], endUsd: number | undefined, now: number): string => {
  const points = activity.filter(a => a.usdAt !== undefined).map(a => ({ at: a.startedAt, usd: a.usdAt!, what: describe(a) }))
  if (endUsd !== undefined && points.length > 0) points.push({ at: Math.max(now, points[points.length - 1]!.at), usd: endUsd, what: 'now' })
  if (points.length < 2) return ''
  const t0 = points[0]!.at
  const t1 = Math.max(points[points.length - 1]!.at, t0 + 1)
  const top = Math.max(...points.map(p => p.usd)) || 1
  const left = 48
  const x = (t: number) => left + ((t - t0) / (t1 - t0)) * (552 - left)
  const y = (usd: number) => 140 - (usd / top) * 120
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.at).toFixed(1)} ${y(p.usd).toFixed(1)}`).join(' ')
  const area = `${path} L${x(points[points.length - 1]!.at).toFixed(1)} 140 L${x(t0).toFixed(1)} 140 Z`
  const dots = points
    .map(p => {
      const tip = `${new Date(p.at).toISOString().slice(11, 16)} UTC · ${formatCost(p.usd) ?? '$0'}${p.what === 'now' ? ' now' : ` before: ${p.what}`}`
      return `<g class="hit" tabindex="0" data-tip="${esc(tip)}"><circle cx="${x(p.at).toFixed(1)}" cy="${y(p.usd).toFixed(1)}" r="12" class="target"/><circle cx="${x(p.at).toFixed(1)}" cy="${y(p.usd).toFixed(1)}" r="4" class="dot"/></g>`
    })
    .join('')
  return `<figure class="chart"><figcaption><h3>Cost over the session</h3><span class="sub">what the session had cost at each step</span></figcaption>
<svg viewBox="0 0 560 160" role="img" aria-label="Cost over the session">
<line x1="${left}" y1="140" x2="552" y2="140" class="baseline"/><line x1="${left}" y1="20" x2="552" y2="20" class="grid"/>
<text x="${left - 6}" y="144" class="axis" text-anchor="end">$0</text><text x="${left - 6}" y="24" class="axis" text-anchor="end">${esc(formatCost(top) ?? '')}</text>
<text x="${left}" y="156" class="axis">${new Date(t0).toISOString().slice(11, 16)}</text><text x="552" y="156" class="axis" text-anchor="end">${new Date(t1).toISOString().slice(11, 16)} UTC</text>
<path d="${area}" class="area"/><path d="${path}" class="line"/>${dots}</svg>
${dataTable(['Time (UTC)', 'Cost so far'], points.map(p => [new Date(p.at).toISOString().slice(11, 16), formatCost(p.usd) ?? '$0']))}</figure>`
}


/** Which steps a report covers: this Claude Code session's, or every session's this folder kept. */
export type ReportScope = 'session' | 'all'

/**
 * The dashboard as a report of `scope` sees it: this session's own steps, or
 * every step this folder kept (the window's and the earlier ones), in order.
 */
export const scoped = (dashboard: Dashboard, scope: ReportScope): Dashboard => {
  if (scope === 'session') return { ...dashboard, activity: repaired(withoutEchoes(dashboard.activity.filter(a => !a.isRestored && !a.isEarlier))), earlier: [], restored: 0 }
  const seen = new Set<number>()
  const activity = [...(dashboard.earlier ?? []), ...dashboard.activity]
    .filter(a => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => a.startedAt - b.startedAt)
  return { ...dashboard, activity: repaired(withoutEchoes(activity)), earlier: [] }
}

/** Budget lines that are readings or estimates, not budgets with nothing to measure them by. */
const ESTIMATES: ReadonlySet<string> = new Set(['Companion', 'this week', 'Claude pace', 'Claude spend'])

/** Whether there's anything from earlier sessions, so asking which steps to cover means something. */
export const hasEarlierSteps = (dashboard: Dashboard): boolean =>
  dashboard.activity.some(a => a.isRestored) || (dashboard.earlier?.length ?? 0) > 0

/** One Claude Code session in an all-sessions report. */
export type SessionSummary = {
  /**
   * Its Claude Code session ID; or, for steps from before steps named their
   * session that no transcript accounts for, `earlier-<n>`, in order.
   */
  id: string
  isCurrent: boolean
  firstAt: number
  lastAt: number
  steps: number
  failed: number
  components: number
  /** Claude Code's own cost for it: this session's from its usage, an earlier one's from its transcript. */
  usd?: number
  /** Where usd came from: `exact`, or `atLeast` (what it had cost by its last Companion step). */
  usdIs?: 'exact' | 'atLeast'
  project?: string
}

/** A quiet spell this long between unnamed steps starts another session. */
const QUIET_MS = 2 * 3_600_000

/** How far outside a past session's start and end a step still counts as its own. */
const SESSION_SLACK_MS = 60_000

/**
 * The session each step belongs to, by step ID: the one it names; else this
 * session for a step that wasn't brought back; else the past session (from
 * Claude Code's transcripts, in this folder) whose time covers it; else an
 * `earlier-<n>`, a new one wherever the running cost goes down, as it does
 * when a new session starts, or after two quiet hours.
 */
export const assignSessions = (activity: readonly Activity[], current: string | undefined, past: readonly PastSession[] = [], folder?: string): Map<number, string> => {
  const out = new Map<number, string>()
  const here = past.filter(p => !folder || !p.project || p.project === folder)
  let n = 0
  let lastUsd: number | undefined
  let lastAt: number | undefined
  for (const a of [...activity].sort((x, y) => x.startedAt - y.startedAt)) {
    if (a.session) {
      out.set(a.id, a.session)
      continue
    }
    if (!a.isRestored && !a.isEarlier) {
      out.set(a.id, current ?? 'this')
      continue
    }
    const covering = here.find(p => {
      const start = Date.parse(p.startedAt ?? '')
      const end = Date.parse(p.endedAt ?? p.startedAt ?? '')
      return !Number.isNaN(start) && !Number.isNaN(end) && a.startedAt >= start - SESSION_SLACK_MS && a.startedAt <= end + SESSION_SLACK_MS
    })
    if (covering) {
      out.set(a.id, covering.id)
      continue
    }
    const isQuiet = lastAt !== undefined && a.startedAt - lastAt > QUIET_MS
    if (n === 0 || isQuiet || (a.usdAt !== undefined && lastUsd !== undefined && a.usdAt < lastUsd)) {
      n++
      lastUsd = undefined
    }
    if (a.usdAt !== undefined) lastUsd = a.usdAt
    lastAt = a.endedAt ?? a.startedAt
    out.set(a.id, `earlier-${n}`)
  }
  return out
}

/** An earlier session no step named and no transcript claimed: `earlier-<n>`. */
const isUnnamed = (id: string) => /^earlier-\d+$/.test(id)

/**
 * The steps an all-sessions report still has to match to a transcript: brought
 * back from an earlier session, naming none (recorded before 0.26.0), and not
 * covered by any past session already known for this folder. Usually none: a
 * past session's cost never changes, so an old scan still answers for it.
 */
export const stepsToMatch = (activity: readonly Activity[], past: readonly PastSession[], folder?: string): Activity[] => {
  const unnamed = activity.filter(a => !a.session && (a.isRestored || a.isEarlier))
  if (unnamed.length === 0) return []
  const of = assignSessions(unnamed, undefined, past, folder)
  return unnamed.filter(a => isUnnamed(of.get(a.id) ?? ''))
}

/**
 * Where Claude Code keeps one folder's transcripts: its projects folder, named
 * after the working directory with every character but a letter or digit as -.
 */
export const transcriptsFolder = (configDir: string, cwd: string): string => `${configDir}/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}`

/** A session's ID as a person reads it: whole, or which unnamed earlier one it is. */
export const sessionLabel = (id: string): string => {
  const m = id.match(/^earlier-(\d+)$/)
  return m ? `Earlier session ${m[1]} (no ID recorded)` : id
}

/**
 * Each session the steps came from, newest first: when, how many steps and
 * failures, the components it touched, and what it cost. This session's cost
 * is its usage; an earlier one's is Claude Code's own figure from its
 * transcript when it was scanned, else at least what it had cost by its last
 * Companion step. A session with no cost recorded at all has none, not $0.
 */
export const sessionSummaries = (
  activity: readonly Activity[],
  current: string | undefined,
  currentUsd: number | undefined,
  past: readonly PastSession[] = [],
  folder?: string,
): SessionSummary[] => {
  const of = assignSessions(activity, current, past, folder)
  const groups = new Map<string, Activity[]>()
  for (const a of activity) {
    const id = of.get(a.id)!
    groups.set(id, [...(groups.get(id) ?? []), a])
  }
  return [...groups.entries()]
    .map(([id, steps]): SessionSummary => {
      const isCurrent = id === current || id === 'this'
      const scanned = past.find(p => p.id === id)
      const known = steps.flatMap(a => (a.usdAt === undefined ? [] : [a.usdAt]))
      const usd = isCurrent ? currentUsd : (scanned?.costUsd ?? (known.length > 0 ? Math.max(...known) : undefined))
      const usdIs = usd === undefined ? undefined : isCurrent || scanned?.costUsd !== undefined ? 'exact' : 'atLeast'
      return {
        id,
        isCurrent,
        firstAt: Math.min(...steps.map(a => a.startedAt)),
        lastAt: Math.max(...steps.map(a => a.endedAt ?? a.startedAt)),
        steps: steps.filter(a => !a.recipe).length,
        failed: steps.filter(a => a.outcome === 'failed' || a.outcome === 'blocked').length,
        components: components(steps).length,
        ...(usd !== undefined ? { usd, usdIs } : {}),
        ...(scanned?.project ? { project: scanned.project } : {}),
      }
    })
    .sort((a, b) => b.lastAt - a.lastAt)
}

/** The sessions' cost: what's known, whether some is only a lower bound, and whether any is missing. */
export const sessionsCost = (sessions: readonly SessionSummary[]): { usd?: number; isAtLeast: boolean; missing: number } => {
  const known = sessions.filter(s => s.usd !== undefined)
  return {
    ...(known.length > 0 ? { usd: known.reduce((sum, s) => sum + s.usd!, 0) } : {}),
    isAtLeast: known.some(s => s.usdIs === 'atLeast'),
    missing: sessions.length - known.length,
  }
}

/** The Boomi account the session worked in, and its components as Boomi has them now. */
export type BoomiFacts = {
  accountId?: string
  accountName?: string
  environmentId?: string
  /** The Platform API host, without credentials. */
  apiHost?: string
  components: Record<string, ComponentDetails>
  /** Why Boomi's own details are missing, when they are. */
  note?: string
}

/** A component's page in Boomi's build console. */
export const boomiLink = (accountId: string, componentId: string): string =>
  `https://platform.boomi.com/AtomSphere.html#build;accountId=${encodeURIComponent(accountId)};components=${encodeURIComponent(componentId)}`

/** A time for a spreadsheet: `2026-10-13 17:15`, in UTC. */
const sheetTime = (at: number | undefined) => (at === undefined ? '' : new Date(at).toISOString().slice(0, 16).replace('T', ' '))

/**
 * Every component as a table to take elsewhere: its name, type and folder, its
 * ID, the version Boomi has, how its last deploy and test went (with when, the
 * package and the execution), what it cost, and its page in Boomi. One row
 * each, newest first; a cell the session doesn't know is left empty.
 */
export const componentTable = (activity: readonly Activity[], boomi?: BoomiFacts): Table => {
  const all = spends(activity)
  const rows = components(activity).map(row => {
    const d = row.componentId ? boomi?.components[row.componentId] : undefined
    const deployed = row.deployed
    const tested = row.tested
    const deploy = !deployed ? '' : deployed.kind === 'undeploy' ? 'undeployed' : deployed.outcome === 'ok' ? 'deployed' : deployed.outcome
    const test = !tested
      ? ''
      : tested.executionStatus
        ? tested.executionStatus === 'COMPLETE' ? 'passed' : tested.executionStatus.toLowerCase()
        : tested.outcome === 'ok' ? 'submitted' : tested.outcome
    const usd = spendOf(row.ids, all).usd
    return [
      row.name,
      friendlyType(d?.type ?? row.type) ?? d?.type ?? row.type ?? '',
      d?.folderName ?? '',
      row.componentId ?? '',
      d?.version ?? row.saved?.version ?? '',
      deploy,
      sheetTime(deployed?.endedAt ?? deployed?.startedAt),
      (deployed && packageOf(deployed.detail)) ?? '',
      test,
      sheetTime(tested?.endedAt ?? tested?.startedAt),
      tested?.executionId ?? '',
      usd === undefined ? '' : usd.toFixed(2),
      row.componentId && boomi?.accountId ? boomiLink(boomi.accountId, row.componentId) : '',
    ]
  })
  return {
    header: ['Component', 'Type', 'Folder', 'Component ID', 'Version', 'Deploy', 'Deployed (UTC)', 'Package ID', 'Test', 'Tested (UTC)', 'Execution ID', 'Cost (USD)', 'Boomi link'],
    rows,
  }
}

/**
 * The buttons that copy or save a table, with the table as data the page's
 * script reads: tab-separated to paste into a spreadsheet, CSV to copy or
 * save. Empty for a table with no rows.
 */
const exportGroup = (id: string, noun: string, what: string, exported: Table, file: string) => {
  if (exported.rows.length === 0) return ''
  const data = JSON.stringify({ tsv: toTsv(exported), csv: toCsv(exported), file, rows: exported.rows.length, noun }).replace(/</g, '\\u003c')
  return `<div class="export" role="group" aria-label="Copy or save the ${what}" data-source="${id}"><span class="export-label">Take this list elsewhere, with every ID:</span>
<button type="button" data-export="tsv" title="Tab-separated: paste straight into Excel, Google Sheets or Numbers">Copy for a spreadsheet</button>
<button type="button" data-export="csv">Copy as CSV</button>
<button type="button" data-export="download">Save as CSV</button>
<span class="export-done" role="status" aria-live="polite"></span></div>
<script type="application/json" id="${id}">${data}</script>`
}

/** The deployment package a deploy made, from its SUCCESS line. */
export const packageOf = (detail: string): string | undefined => detail.match(/\(package: ([^)\s]+)\)/)?.[1]

/** A session's anchor on the page: its steps' heading. */
const sessionAnchor = (id: string) => `s-${id.replace(/[^A-Za-z0-9-]/g, '')}`

/** What a step did to its subject, as a past-tense verb. */
const VERBS: Partial<Record<Activity['kind'], string>> = {
  edit: 'edited',
  create: 'created',
  push: 'saved',
  pull: 'pulled',
  deploy: 'deployed',
  undeploy: 'undeployed',
  test: 'tested',
}

/** Housekeeping: a connection check, a listing, a read of results. It went fine and changed nothing. */
const isChoreStep = (a: Activity) => a.kind === 'other' && !a.product && !a.isBudgetOverride && levelOf(a) === 'healthy'

/**
 * What a session did, in words: each thing it worked on and what happened to
 * it, in order ("Orders Sync: created, deployed, tested (1 failed)"), then how
 * many housekeeping steps it took. Markup, escaped.
 */
export const workSentence = (list: readonly Activity[]): string => {
  const things = new Map<string, { verbs: string[]; failed: Map<string, number>; blocked: Map<string, number> }>()
  let chores = 0
  const troubles: string[] = []
  for (const a of [...list].sort((x, y) => x.startedAt - y.startedAt)) {
    if (isChoreStep(a)) {
      chores++
      continue
    }
    if (a.kind === 'other' && !a.product && !a.isBudgetOverride) {
      troubles.push(a.isBudgetBlocked ? 'a Boomi change blocked by budget' : `${a.script ?? 'a script'} ${a.outcome === 'ok' ? 'warned' : a.outcome}`)
      continue
    }
    const thing = a.isBudgetOverride ? 'Budget' : a.subject === 'a component' ? 'another component' : a.subject
    const verb = a.isBudgetOverride ? 'override allowed' : a.product ? (a.verb ? `${a.verb}${/e$/.test(a.verb) ? 'd' : 'ed'}` : 'ran') : (VERBS[a.kind] ?? a.kind)
    const t = things.get(thing) ?? { verbs: [] as string[], failed: new Map<string, number>(), blocked: new Map<string, number>() }
    if (!t.verbs.includes(verb)) t.verbs.push(verb)
    if (a.outcome === 'failed') t.failed.set(verb, (t.failed.get(verb) ?? 0) + 1)
    if (a.outcome === 'blocked') t.blocked.set(verb, (t.blocked.get(verb) ?? 0) + 1)
    things.set(thing, t)
  }
  const parts = [...things.entries()].map(([thing, t]) => {
    const verbs = t.verbs.map(v => {
      const notes = [t.failed.get(v) ? `${t.failed.get(v)} failed` : '', t.blocked.get(v) ? `${t.blocked.get(v)} blocked` : ''].filter(Boolean).join(', ')
      return notes ? `${v} (${notes})` : v
    })
    const name = thing === 'another component' ? `<strong>another component</strong> ${unavailable('name not available', "Companion's output didn't name it.")}` : `<strong>${esc(thing)}</strong>`
    return `${name}: ${esc(verbs.join(', '))}`
  })
  const choreText = chores > 0 ? `${parts.length > 0 ? 'and ' : ''}${chores} housekeeping step${chores === 1 ? '' : 's'}` : ''
  return [...parts, ...troubles.map(t => esc(t)), choreText].filter(Boolean).join(' · ') || 'Nothing recorded'
}

/**
 * The sessions as a ledger, oldest first: a row each saying when it ran, what
 * it did in words, how its steps went (each status with its icon) and what it
 * cost, linked to its steps, with the idle time since the session before. `costs` is markup, each session's cost already escaped.
 */
export const sessionLedger = (steps: readonly Activity[], sessionOf: (a: Activity) => string, label: (id: string) => string, costs: ReadonlyMap<string, string>): string => {
  if (steps.length === 0) return ''
  const groups = new Map<string, Activity[]>()
  for (const a of steps) groups.set(sessionOf(a), [...(groups.get(sessionOf(a)) ?? []), a])
  const rows = [...groups.entries()]
    .map(([id, list]) => ({ id, list, first: Math.min(...list.map(a => a.startedAt)), last: Math.max(...list.map(a => a.endedAt ?? a.startedAt)) }))
    .sort((a, b) => a.first - b.first)
  const clock = (t: number) => new Date(t).toISOString().slice(11, 16)
  const date = (t: number) => new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const parts: string[] = []
  rows.forEach((r, i) => {
    const idle = i > 0 ? r.first - rows[i - 1]!.last : 0
    const after = idle > 60_000 ? ` · ${duration(idle)} later` : ''
    const counts = LEVELS.map(l => [l, r.list.filter(a => levelOf(a) === l).length] as const).filter(([, n]) => n > 0)
    const how = counts.map(([l, n]) => status(l, String(n))).join(' ')
    const span = r.last - r.first
    parts.push(
      `<li class="ledger-row"><a class="ledger-link" href="#${sessionAnchor(r.id)}" title="${esc(r.id === 'this' || isUnnamed(r.id) ? label(r.id) : r.id)}">` +
        `<span class="l-when"><strong>${esc(date(r.first))}</strong><span>${esc(`${clock(r.first)}–${clock(r.last)} UTC${span >= 60_000 ? ` · ${duration(span)}` : ''}`)}</span><span class="l-id">${esc(label(r.id) + after)}</span></span>` +
        `<span class="l-what">${workSentence(r.list)}</span>` +
        `<span class="l-how">${how}<span class="l-steps">${esc(`${r.list.length} step${r.list.length === 1 ? '' : 's'}`)}</span></span>` +
        `<span class="l-cost">${costs.get(r.id) ?? unavailable('Cost not available', isUnnamed(r.id) ? 'No transcript on this machine covers this session, and its steps carry no cost.' : "Claude Code's transcript for this session doesn't record a cost.")}</span></a></li>`,
    )
  })
  return `<div class="ledger-wrap"><h2 class="ledger-title">${rows.length === 1 ? 'The session' : 'The sessions'}</h2><ol class="ledger">${parts.join('')}</ol></div>`
}

/** What the HTML report needs beyond the Markdown one: the dashboard's own version, what it covers, the sessions and the Boomi account. */
export type HtmlFacts = ReportFacts & {
  version?: string
  scope?: ReportScope
  /** This Claude Code session's ID, whole. */
  sessionId?: string
  /** Past Companion sessions from Claude Code's transcripts: their IDs, times and exact costs. */
  pastSessions?: PastSession[]
  /** The workspace folder's full path, to match past sessions to it; never shown. */
  cwd?: string
  boomi?: BoomiFacts
  /** The workspace folder's name (not its path). */
  folder?: string
  /** Every budget the person set, as the pane's BUDGET gauge lists them. */
  budgets?: BudgetLine[]
  /** The per-session spend budget (budgetUsd), to hold each session against in an all-sessions report. */
  sessionBudgetUsd?: number
  /** Exosphere (the default, for Boomi people) or expressive: the repository's own Valence theme. */
  style?: ReportStyle
}

/** How the report looks: Boomi's Exosphere, or Valence (Miami Deco), the repository's own theme. */
export type ReportStyle = 'exosphere' | 'expressive'

/** The session report as one HTML page, styles and scripts inside it. */
export const reportHtml = (dashboard: Dashboard, facts: HtmlFacts, now: number, windowMs: number): string => {
  const all = spends(dashboard.activity)
  const runs = sessionRuns(dashboard, now, windowMs)
  const needs = attention(dashboard, now, windowMs)
  const closed = closedCount(dashboard, now, windowMs)
  const u = facts.usage
  const steps = dashboard.activity.filter(a => !a.recipe)
  const failed = steps.filter(a => a.outcome === 'failed' || a.outcome === 'blocked').length
  const rows = components(dashboard.activity)
  const isAll = facts.scope === 'all'
  const sessionIds = assignSessions(dashboard.activity, facts.sessionId, facts.pastSessions, facts.cwd)
  const sessions = isAll ? sessionSummaries(dashboard.activity, facts.sessionId, u.usd, facts.pastSessions, facts.cwd) : []
  const boomi = facts.boomi
  const shortSession = (id: string) => (isUnnamed(id) ? `earlier ${id.slice(8)}` : id.slice(0, 8))
  const sessionOf = (a: Activity) => sessionIds.get(a.id) ?? 'this'
  const when = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 16)

  // The opening: what this is about (the Boomi account, else the folder), then what happened, in sentences.
  const title = boomi?.accountName ?? facts.folder ?? 'Companion session'
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const day = (t: number) => shortWhen(t, 'UTC').replace(/, \d\d:\d\d$/, '')
  const strong = (text: string) => `<strong>${esc(text)}</strong>`
  const budgetPct = u.budgetUsd && u.usd !== undefined ? Math.round((u.usd / u.budgetUsd) * 100) : undefined
  const total = sessionsCost(sessions)
  const did = rows.length > 0
    ? `worked on ${strong(plural(rows.length, 'component'))} in ${plural(steps.length, 'step')}`
    : `took ${strong(plural(steps.length, 'Companion step'))}`
  const trouble = failed > 0 ? `, ${failed} of which failed or ${failed === 1 ? 'was' : 'were'} blocked` : ''
  const lede: string[] = []
  if (isAll) {
    const first = steps[0]?.startedAt
    const last = steps[steps.length - 1]?.startedAt
    const range = first === undefined || last === undefined ? '' : day(first) === day(last!) ? ` on ${day(first)}` : ` between ${day(first)} and ${day(last!)}`
    lede.push(`${sessions.length === 1 ? 'One session' : `${sessions.length} sessions`} in ${strong(facts.folder ?? 'this folder')}${range} ${did}${trouble}.`)
    lede.push(
      total.usd === undefined
        ? 'Their cost wasn’t recorded.'
        : `They cost ${strong(`${total.isAtLeast ? 'at least ' : ''}${formatCost(total.usd) ?? '$0'}`)}${total.isAtLeast ? ', counting some sessions only up to their last Companion step' : ''}${total.missing > 0 ? `, with ${plural(total.missing, 'session')} not recorded` : ''}.`,
    )
  } else {
    lede.push(`This session${u.startedAt === undefined ? '' : ` has run for ${esc(duration(now - u.startedAt))} and`} ${did}${trouble}.`)
    if (u.usd !== undefined) {
      const budget = u.budgetUsd ? `, ${budgetPct}% of the ${formatCost(u.budgetUsd)} budget` : ''
      const tokens = u.tokens !== undefined ? ` (${formatTokens(u.tokens)} tokens${u.cached ? `, ${formatTokens(u.cached)} cache reads` : ''})` : ''
      const level: Level | undefined = budgetPct === undefined ? undefined : budgetPct >= 100 ? 'critical' : budgetPct >= 80 ? 'warning' : undefined
      lede.push(`It has cost ${strong(formatCost(u.usd) ?? '$0')} so far${level ? ` ${status(level, budget.slice(2))}` : budget}${tokens}.`)
    }
  }
  lede.push(
    needs.length === 0
      ? `${status('healthy', failed > 0 ? `None of ${failed === 1 ? 'it' : 'them'} still needs attention` : 'Nothing needs attention')}${closed ? ` (${closed} closed)` : ''}.`
      : `${status(needs.some(n => n.level === 'critical') ? 'critical' : 'warning', needs.length === 1 ? `1 thing needs attention: ${needs[0]!.title}` : `${needs.length} things need attention`)}.`,
  )
  const dateline = [
    isAll ? 'All sessions' : `Session <code title="${esc(facts.session)}">${esc(facts.session.slice(0, 8))}</code>`,
    esc(facts.date),
    u.model && !isAll ? esc(u.model) : undefined,
    facts.version ? `boomi-dashboard ${esc(facts.version)}` : undefined,
  ].filter(Boolean).join(' · ')

  const attentionList = `<ol class="attention">${needs.map(n => `<li class="alert alert-${n.level}">${status(n.level, n.title)}<div class="hint">${esc(n.hint)}</div></li>`).join('')}</ol>`

  // Copyable IDs: a click puts the ID on the clipboard.
  const idCode = (id: string) => `<code class="copy" data-copy="${esc(id)}" title="Copy">${esc(id)}</code>`
  const shortClock = (t: number) => (isAll ? `${day(t)}, ${new Date(t).toISOString().slice(11, 16)}` : new Date(t).toISOString().slice(11, 16))

  // Components as swimlanes: saved, deployed, tested, each in its own column, in the dashboard's own words.
  const laneRank: Record<Level, number> = { critical: 0, serious: 1, warning: 2, healthy: 3 }
  const lane = (list: readonly Stage[], step: Activity | undefined, sub: string | undefined, none: string) => {
    if (list.length === 0) return `<td class="lane" data-sort="-1">${notDone(none)}</td>`
    const worst = list.reduce((w, s) => (laneRank[s.level] < laneRank[w.level] ? s : w), list[0]!)
    const when = step && step.outcome !== 'running' ? shortClock(step.endedAt ?? step.startedAt) : undefined
    return `<td class="lane" data-sort="${laneRank[worst.level]}">${list.map(s => status(s.level, s.text)).join('<br>')}${[when, sub].filter(Boolean).length ? `<div class="sub">${[when && esc(when), sub].filter(Boolean).join(' · ')}</div>` : ''}</td>`
  }
  const isDeployStage = (s: Stage) => /deploy|undeploy|\bruns?\b|ok$/.test(s.text) && !/^test/.test(s.text)
  const isTestStage = (s: Stage) => /^test/.test(s.text)
  const savedOk = rows.filter(r => r.saved?.outcome === 'ok').length
  const deployedOk = rows.filter(r => r.deployed?.outcome === 'ok' && r.deployed.kind === 'deploy').length
  const passing = rows.filter(r => r.tested && levelOf(r.tested) === 'healthy').length
  const componentRows = rows.map(row => {
    const spent = spendOf(row.ids, all)
    const d = row.componentId ? boomi?.components[row.componentId] : undefined
    const list = stages(row, runs)
    const deployList = list.filter(isDeployStage)
    const testList = list.filter(isTestStage)
    const saveList = list.filter(s => !isDeployStage(s) && !isTestStage(s))
    const type = friendlyType(d?.type ?? row.type) ?? d?.type ?? row.type
    // Boomi's view: what it has, or why it isn't here.
    const boomiMissing = !row.componentId || d
      ? ''
      : !boomi?.accountId
        ? ''
        : boomi.note
          ? unavailable('Boomi details not available', boomi.note)
          : unavailable('not found in Boomi', 'Boomi has no current version of this component: it may have been deleted, or it belongs to another account.')
    const about = [type ? esc(type) : unavailable('type not available', "Neither the component's XML nor Boomi said what type it is."), d?.folderName && esc(d.folderName)].filter(Boolean).join(' · ')
    const renamed = d?.name && d.name !== row.name ? `<div class="sub">In Boomi now: ${esc(d.name)}</div>` : ''
    const link = row.componentId && boomi?.accountId ? ` <a href="${esc(boomiLink(boomi.accountId, row.componentId))}" target="_blank" rel="noopener">Open in Boomi</a>` : ''
    const id = row.componentId ? `<div class="sub">${idCode(row.componentId)}${link}</div>${boomiMissing ? `<div class="sub">${boomiMissing}</div>` : ''}` : `<div class="sub">${notDone('Not created in Boomi in these sessions')} not created in Boomi</div>`
    const inBoomi = d?.version ? `in Boomi v${esc(d.version)}${d.modifiedBy ? ` by ${esc(d.modifiedBy)}` : ''}` : undefined
    const pkg = row.deployed ? packageOf(row.deployed.detail) : undefined
    const exec = row.tested?.executionId
    const pkgText = pkg ? `package ${idCode(pkg)}` : row.deployed?.kind === 'deploy' && row.deployed.outcome === 'ok' ? unavailable('package ID not available', "The deploy's output didn't name its package.") : undefined
    const execText = exec ? idCode(exec) : row.tested && row.tested.outcome !== 'blocked' && row.tested.executionStatus === undefined ? unavailable('execution ID not available', 'The test was submitted without waiting, so its execution ID never came back.') : undefined
    return `<tr><th scope="row" data-sort="${esc(row.name)}">${esc(row.name)}${about ? `<div class="sub">${about}</div>` : ''}${renamed}${row.recipe ? `<div class="sub">from recipe ${esc(row.recipe)}</div>` : ''}${id}</th>${lane(saveList, row.saved ?? row.edited, inBoomi, 'Not saved in these sessions')}${lane(deployList, row.deployed, pkgText, 'Not deployed in these sessions')}${lane(testList, row.tested, execText, 'Not tested in these sessions')}${num(spent.usd, formatCost(spent.usd))}</tr>`
  })
  const overrides = steps.filter(a => a.isBudgetOverride)
  const pipelineLine = rows.length > 0 ? `${savedOk} saved · ${deployedOk} deployed · ${passing} passing` : ''
  // The components as text to take elsewhere: tab-separated to paste into a spreadsheet, CSV to copy or save.
  const exportTools = exportGroup('component-export', 'component', 'components', componentTable(dashboard.activity, boomi), `boomi-components-${facts.date}.csv`)

  // Every change made in Boomi, oldest first, with the override that let it through.
  const changes = platformChanges(dashboard.activity)
  const changeOverrides = overridesFor(dashboard.activity)
  const changeRows = changes.map(a => {
    const ref = referenceOf(a)
    const [refWord, ...refId] = ref.split(' ')
    const at = new Date(a.startedAt).toISOString()
    return `<tr><td data-sort="${a.startedAt}"><time datetime="${at}">${esc(at.slice(0, 16).replace('T', ' '))}</time></td><td>${esc(mask(describe(a)))}</td><td data-sort="${esc(resultOf(a))}">${status(levelOf(a), resultOf(a))}</td><td>${ref ? `${esc(refWord!)} ${idCode(refId.join(' '))}` : ''}</td><td>${esc(changeOverrides.get(a.id) ?? '')}</td></tr>`
  })
  const changeTools = exportGroup('change-export', 'change', 'changes', changeTable(dashboard.activity), `boomi-changes-${facts.date}.csv`)

  const account = boomi && (boomi.accountId || boomi.environmentId)
    ? `<p class="account-line" id="account"><span class="label">Boomi account</span> ${[
        boomi.accountName ? `<strong>${esc(boomi.accountName)}</strong>` : unavailable('name not available', boomi.note ?? "Boomi didn't return the account's name: the API user may lack Account read access."),
        boomi.accountId && idCode(boomi.accountId),
        boomi.environmentId ? `environment ${idCode(boomi.environmentId)}` : notSet('no environment', 'Add <code>BOOMI_ENVIRONMENT_ID</code> to Companion&#39;s <code>.env</code> to show it.'),
        boomi.apiHost && esc(boomi.apiHost),
      ].filter(Boolean).join(' · ')}${boomi.note && boomi.accountName ? ` ${unavailable('some details not available', boomi.note)}` : ''}</p>`
    : boomi
      ? `<p class="account-line" id="account"><span class="label">Boomi account</span> ${notSet('Not set up', `Add the Platform API credentials to Companion&#39;s <code>.env</code> (or the environment) to show the account and each component as Boomi has it.${boomi.note ? ` ${esc(boomi.note)}` : ''}`)}</p>`
      : ''
  const connectorRows = connectors(dashboard.activity).map(row => {
    const spent = spendOf(row.ids, all)
    return `<tr><th scope="row">${esc(row.name)}</th><td>${esc(row.group ?? '')}</td><td>${badges(connectorStages(row))}</td>${num(spent.tokens, spent.tokens ? formatTokens(spent.tokens) : '')}${num(spent.usd, formatCost(spent.usd))}</tr>`
  })
  const agentRows = agents(dashboard.activity).map(row => {
    const spent = spendOf(row.ids, all)
    return `<tr><th scope="row">${esc(row.name)}</th><td>${badges(agentStages(row))}</td>${num(spent.tokens, spent.tokens ? formatTokens(spent.tokens) : '')}${num(spent.usd, formatCost(spent.usd))}</tr>`
  })

  const quarantine = quarantineLines(dashboard, now)
  const products = PRODUCT_ORDER.filter(k => steps.some(a => productKey(a) === k)).map(productName)
  const isRelease = (a: Activity) => !a.product && (a.kind === 'deploy' || a.kind === 'undeploy' || a.kind === 'test')
  const stepItem = (a: Activity) => {
    const level = levelOf(a)
    const product = productName(productKey(a))
    const spent = all.get(a.id)
    const aside = [spent?.tokens ? `${formatTokens(spent.tokens)} tokens` : '', formatCost(spent?.usd) ?? '', a.source === 'log' ? "from Companion's log" : ''].filter(Boolean).join(' · ')
    const pkg = a.kind === 'deploy' ? packageOf(a.detail) : undefined
    const took = a.endedAt !== undefined && a.endedAt > a.startedAt ? duration(a.endedAt - a.startedAt) : undefined
    const detail = [
      a.detail && `<dt>Result</dt><dd>${esc(a.detail)}</dd>`,
      a.componentId && `<dt>Component</dt><dd>${idCode(a.componentId)}${boomi?.accountId ? ` <a href="${esc(boomiLink(boomi.accountId, a.componentId))}" target="_blank" rel="noopener">Open in Boomi</a>` : ''}</dd>`,
      a.version && `<dt>Version</dt><dd>v${esc(a.version)}</dd>`,
      pkg && `<dt>Package</dt><dd>${idCode(pkg)}</dd>`,
      a.executionId && `<dt>Execution</dt><dd>${idCode(a.executionId)}</dd>`,
      a.ref && `<dt>Acts on</dt><dd>${idCode(a.ref)}</dd>`,
      a.file && `<dt>File</dt><dd><code>${esc(a.file)}</code></dd>`,
      took && `<dt>Took</dt><dd>${esc(took)}</dd>`,
      `<dt>Seen in</dt><dd>${a.source === 'log' ? "Companion's activity log" : "Claude's tool call"}</dd>`,
      isAll && `<dt>Session</dt><dd>${isUnnamed(sessionOf(a)) ? esc(sessionLabel(sessionOf(a))) : idCode(sessionOf(a))}</dd>`,
    ]
      .filter(Boolean)
      .join('')
    const at = isAll ? `${when(a.startedAt)} UTC` : `${new Date(a.startedAt).toISOString().slice(11, 16)} UTC`
    // A failure says what went wrong without being opened.
    const why = level === 'critical' || level === 'serious' ? `<div class="why">${esc(a.detail)}${a.executionId ? ` · execution ${idCode(a.executionId)}` : ''}</div>` : ''
    const isChore = !isWork(a)
    const unnamed = a.subject === 'a component' ? ` ${unavailable('name not available', "Companion's output didn't name this component, and no other step gives its ID.")}` : ''
    return `<li id="step-${a.id}"${isChore ? ' class="chore"' : ''} data-level="${level}" data-product="${esc(product)}"${isRelease(a) ? ' data-kind="release"' : ''} data-at="${a.startedAt}"><details><summary><time datetime="${new Date(a.startedAt).toISOString()}">${esc(at)}</time> ${status(level, describe(a))}${unnamed} <span class="tag tag-${slot(productKey(a))}">${esc(product)}</span>${aside ? ` <span class="aside">${esc(aside)}</span>` : ''}${why}</summary><dl>${detail}</dl></details></li>`
  }
  // The steps by session, newest first (the page's Oldest first turns both around); one report's session needs no heading.
  const groups = new Map<string, Activity[]>()
  for (const a of steps) groups.set(isAll ? sessionOf(a) : 'this', [...(groups.get(isAll ? sessionOf(a) : 'this') ?? []), a])
  const sortedGroups = [...groups.entries()]
    .map(([id, list]) => ({ id, list, firstAt: Math.min(...list.map(a => a.startedAt)), lastAt: Math.max(...list.map(a => a.endedAt ?? a.startedAt)) }))
    .sort((a, b) => b.firstAt - a.firstAt)
  const isWork = (a: Activity) => !isChoreStep(a)
  const openFirst = sortedGroups.find(g => g.list.some(isWork)) ?? sortedGroups[0]
  const stepGroups = sortedGroups
    .map(g => {
      const summary = sessions.find(s => s.id === g.id)
      const cost = summary?.usd === undefined ? undefined : `${summary.usdIs === 'atLeast' ? 'at least ' : ''}${formatCost(summary.usd) ?? '$0'}`
      const name = isUnnamed(g.id) ? esc(sessionLabel(g.id)) : `Session ${idCode(g.id)}`
      const facts = [`${esc(when(g.firstAt))} – ${esc(when(g.lastAt).slice(11))} UTC`, esc(`${g.list.length} step${g.list.length === 1 ? '' : 's'}`), cost && esc(cost)].filter(Boolean).join(' · ')
      const items = [...g.list].sort((a, b) => b.startedAt - a.startedAt).map(stepItem).join('\n')
      if (!isAll) return `<div class="step-group" id="${sessionAnchor(g.id)}" data-at="${g.firstAt}"><ol class="steps">${items}</ol></div>`
      const head = `<summary class="group-head">${name}${summary?.isCurrent ? ' <span class="tag tag-1">this session</span>' : ''} <span class="aside">${facts}</span></summary>`
      return `<details class="step-group" id="${sessionAnchor(g.id)}" data-at="${g.firstAt}"${g === openFirst ? ' open' : ''}>${head}<ol class="steps">${items}</ol></details>`
    })
    .join('\n')

  const spendFacts = [
    limitsLine(u.limits, u.now ?? now) ? `<li>${esc(limitsLine(u.limits, u.now ?? now)!)}</li>` : '',
    u.split ? `<li>Tokens: ${esc(u.split)}</li>` : '',
    ...(u.modelSplits ?? []).map(line => `<li class="sub">${esc(line)}</li>`),
  ].join('')

  // Budgets: every one the person set, as a meter; in an all-sessions report, each session against the session budget too.
  const budgetRows = (facts.budgets ?? []).map(b => {
    const label =
      b.label === 'session' ? (isAll ? 'This session' : 'Session')
      : b.label === 'month' ? 'Companion this month'
      : b.label === 'Claude budget' ? 'Your Claude budget'
      : b.label === 'Companion' ? 'Companion, all your usage'
      : b.label === 'this week' ? 'What drove this week'
      : b.label === 'Claude pace' ? 'Pace this month'
      : b.label === 'Claude spend' ? 'Spend per day'
      : `Companion's share (${b.label.replace(/^share,? ?/, '') || 'limit'})`
    if (b.isUnmeasured) return `<li class="meter meter-none"><div class="meter-head"><span>${esc(label)}</span><span class="na">${ESTIMATES.has(b.label) ? 'estimate' : 'not measured'}</span></div><div class="sub">${esc(b.detail)}</div></li>`
    const shown = Math.min(100, Math.max(0, b.percent))
    return `<li class="meter meter-${b.level}"><div class="meter-head"><span>${esc(label)}</span>${status(b.level, `${Math.round(b.percent)}%`)}</div><div class="meter-bar" role="img" aria-label="${esc(`${label}: ${Math.round(b.percent)}%, ${b.detail}`)}"><span style="width:${shown.toFixed(1)}%"></span></div><div class="sub">${esc(b.detail)}</div></li>`
  })
  const perSession = isAll && facts.sessionBudgetUsd ? sessions.filter(s => s.usd !== undefined) : []
  const over = perSession.filter(s => s.usd! >= facts.sessionBudgetUsd!)
  const budgetBlock = `<aside class="budgets" id="budget" aria-label="Budgets"><h2>Budget</h2>${
    budgetRows.length > 0
      ? `<ul class="plain">${budgetRows.join('')}</ul>`
      : `<p class="note">${notSet('No budget set', 'Run <code>/bc-dashboard config budget</code> to set one for each session or for the month, and see spending against it here.')}</p>`
  }${perSession.length > 0 ? `<p class="note">${over.length === 0 ? status('healthy', `Every session stayed under the ${formatCost(facts.sessionBudgetUsd!)} session budget`) : status('critical', `${over.length} of ${perSession.length} sessions reached the ${formatCost(facts.sessionBudgetUsd!)} session budget`)}.</p>` : ''}</aside>`
  if (over.length > 0) lede.splice(lede.length - 1, 0, `${plural(over.length, 'session')} reached the ${strong(formatCost(facts.sessionBudgetUsd!) ?? '$0')} session budget.`)

  const ofBudget = (usd: number) => {
    if (!facts.sessionBudgetUsd) return ''
    const pct = Math.round((usd / facts.sessionBudgetUsd) * 100)
    const level: Level = pct >= 100 ? 'critical' : pct >= 80 ? 'warning' : 'healthy'
    return `<br><span class="l-budget">${level === 'healthy' ? esc(`${pct}% of budget`) : status(level, `${pct}% of budget`)}</span>`
  }
  const costs = new Map(sessions.flatMap(s => (s.usd === undefined ? [] : [[s.id, `${esc(`${s.usdIs === 'atLeast' ? 'at least ' : ''}${formatCost(s.usd) ?? '$0'}`)}${ofBudget(s.usd)}`] as [string, string]])))
  if (!isAll && u.usd !== undefined) costs.set('this', `${esc(formatCost(u.usd) ?? '$0')}${ofBudget(u.usd)}`)
  const strip = sessionLedger(steps, a => (isAll ? sessionOf(a) : 'this'), id => (id === 'this' ? 'This session' : isUnnamed(id) ? `Earlier ${id.slice(8)}` : id === facts.sessionId ? 'This session' : `Session ${id.slice(0, 8)}`), costs)
  // A product chart only says something with two products or more.
  // In an all-sessions report, a chart per session in place of the one session's cost over time.
  const charts = [
    ...(isAll ? sessionCharts(sessions, steps, sessionOf) : [costOverTime(dashboard.activity, u.usd, now)]),
    products.length > 1 ? outcomesByProduct(steps) : '',
    products.length > 1 ? spendByProduct(dashboard.activity, all) : '',
  ].filter(Boolean)

  const sectionsShown: [string, string][] = [
    ['timeline', isAll ? 'Sessions' : 'Timeline'],
    ...(needs.length > 0 ? ([['attention', 'Attention']] as [string, string][]) : []),
    ...(overrides.length > 0 ? ([['overrides', 'Overrides']] as [string, string][]) : []),
    ...(changeRows.length > 0 ? ([['changes', 'Changes']] as [string, string][]) : []),
    ['components', 'Components'],
    ...(charts.length > 0 ? ([['charts', 'Charts']] as [string, string][]) : []),
    ['steps', 'Steps'],
  ]
  const nav = sectionsShown.map(([id, label]) => `<a href="#${id}">${esc(label)}</a>`).join('')
  const atLeastNote = total.isAtLeast ? '<p class="note">“At least”: a session from before the dashboard recorded session IDs, that no transcript on this machine covers, is counted up to its last Companion step.</p>' : ''

  return `<!doctype html>
<html lang="en"${facts.style === 'expressive' ? ' data-style="expressive"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="boomi-dashboard${facts.version ? ` ${esc(facts.version)}` : ''}">
<title>${isAll ? 'Companion Sessions Report' : 'Companion Session Report'}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${
  facts.style === 'expressive'
    ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poiret+One&family=Josefin+Sans:wght@400;600;700&display=swap">'
    : '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&family=Noto+Sans:wght@400;600;700&family=Fira+Mono&display=swap">'
}
<style>${STYLE}${facts.style === 'expressive' ? VALENCE_STYLE : ''}${PRINT_STYLE}${facts.style === 'expressive' ? VALENCE_PRINT : ''}${pageMargins(`${title} · ${isAll ? 'Companion sessions' : 'Companion session'} · ${facts.date}`)}</style>
</head>
<body${isAll ? ' data-days' : ''}>
<header class="masthead">
  <div class="bar">
    <a class="wordmark" href="#top">${facts.style === 'expressive' ? '' : BOOMI_LOGO_SVG('logo')}Boomi Companion</a>
    <nav aria-label="Sections">${nav}</nav>
    <div class="theme">
      <button type="button" class="theme-toggle" data-theme-toggle aria-label="Switch to the dark theme" title="Dark theme"><svg class="moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/></svg><svg class="sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg></button>
    </div>
    <button type="button" class="print" data-print title="Print the report, or save it as a PDF from the print dialog">Print or save as PDF</button>
  </div>
</header>
<div class="band" id="top">
  <div class="band-inner">
    <div class="opening">
      <div>
        <h1>${esc(title)}</h1>
        <p class="lede">${lede.join(' ')}</p>
        ${atLeastNote}
        <p class="dateline">${dateline}</p>
      </div>
      ${budgetBlock}
    </div>
  </div>
</div>
<main>
${strip ? `<section id="timeline" class="first">${strip}</section>` : ''}
${account}
${needs.length > 0 ? `<section id="attention"><h2>Needs attention</h2>${attentionList}</section>` : ''}
${overrides.length > 0 ? `<section id="overrides"><h2>Budget overrides <span class="count">${overrides.length}</span> <span class="aside">Companion changes allowed past a spent budget, as you chose</span></h2><ul class="plain overrides">${overrides.map(a => `<li><time datetime="${new Date(a.startedAt).toISOString()}">${esc(new Date(a.startedAt).toISOString().slice(0, 16).replace('T', ' '))} UTC</time> ${esc(a.detail)}</li>`).join('')}</ul></section>` : ''}
${table('changes', 'Platform changes', ['When (UTC)', 'Change', 'Result', 'Reference', 'Budget override'], changeRows, '', 'Every change made in Boomi, oldest first', changeTools)}
${componentRows.length === 0 ? `<section id="components"><h2>Components</h2><p class="muted">None ${isAll ? 'in these sessions' : 'this session'}.</p></section>` : table('components', 'Components', ['Component', 'Saved', 'Deployed', 'Tested', 'Cost'], componentRows, 'lanes', pipelineLine, exportTools)}
${table('connectors', 'Custom connectors', ['Connector', 'Group', 'Where it stands', 'Tokens', 'Cost'], connectorRows)}
${table('agents', 'Agentstudio agents', ['Agent', 'Where it stands', 'Tokens', 'Cost'], agentRows)}
${quarantine.length === 0 ? '' : `<section id="quarantine"><h2>Data Hub quarantine</h2><ul class="plain">${quarantine.map(q => `<li>${status(q.level, q.text)}</li>`).join('')}</ul></section>`}
${charts.length > 0 ? `<section id="charts"><h2>Charts</h2><div class="charts">${charts.join('\n')}</div></section>` : ''}
<section id="steps"><h2>Claude's steps <span class="count">${steps.length}</span></h2>
${
  steps.length === 0
    ? '<p class="muted">No Companion steps this session.</p>'
    : `<div class="controls">
  <label class="search"><span class="sr">Search steps</span><input type="search" placeholder="Search steps" data-search></label>
  <div class="filters" role="group" aria-label="Show">
    <button type="button" data-filter="all" aria-pressed="true">All</button>
    <button type="button" data-filter="issues" aria-pressed="false">Failed or warned</button>
    <button type="button" data-filter="kind:release" aria-pressed="false">Deploys &amp; tests</button>
    ${products.length > 1 ? products.map(p => `<button type="button" data-filter="product:${esc(p)}" aria-pressed="false">${esc(p)}</button>`).join('\n    ') : ''}
  </div>
  <div class="filters order" role="group" aria-label="Order">
    <button type="button" data-order="desc" aria-pressed="true">Newest first</button>
    <button type="button" data-order="asc" aria-pressed="false">Oldest first</button>
    <button type="button" data-expand aria-pressed="false">Expand all</button>
  </div>
  <span class="shown" aria-live="polite"></span>
</div>
<div class="step-groups" data-steps>${stepGroups}</div>`
}
</section>
${spendFacts ? `<section id="usage"><h2>Usage</h2><ul class="plain">${spendFacts}</ul></section>` : ''}
</main>
<footer>${facts.style === 'expressive' ? `<svg class="maker" viewBox="0 0 12 16" aria-hidden="true" focusable="false" shape-rendering="crispEdges">${FLAMINGO_IDLE.flatMap((row, y) => [...row].map((c, x) => (c === '.' ? '' : `<rect x="${x}" y="${y}" width="1" height="1"/>`))).join('')}</svg>` : BOOMI_LOGO_SVG('maker-logo')}A snapshot of ${isAll ? `every Boomi Companion session the dashboard kept in ${esc(facts.folder ?? 'this folder')}` : 'a Boomi Companion session'}${facts.sessionId ? ` (Claude Code session ${esc(facts.sessionId)})` : ''}, made by boomi-dashboard${facts.version ? ` ${esc(facts.version)}` : ''} on ${esc(new Date(now).toISOString().replace('T', ' ').slice(0, 16))} UTC, styled to Boomi's Exosphere design system. Nothing in it is live, and it holds no credentials.</footer>
<div class="tooltip" role="tooltip" hidden></div>
<script>${SCRIPT}</script>
</body>
</html>
`
}

/**
 * Exosphere's Exo III tokens as exosphere.boomi.com publishes them (light,
 * then dark), and the page built from them. Charts use a categorical set of
 * Exosphere ramp steps validated for color vision and contrast, one slot per
 * product, and the status fills only for status.
 */
/**
 * Valence, Miami Deco: brand/tokens.json's Day and Night themes laid over the
 * report's tokens, for reportStyle expressive. Poiret One for the title and
 * wordmark only, Josefin Sans for headings and labels, the system's sans for
 * text and data. Status keeps Valence's fixed status colors, with its icon and
 * label as always. The signature accent, Flamingo, marks the sessions only.
 * The navy band gives way to the page's own Sand (Midnight Navy at night),
 * closed by a Deco Gold double rule.
 */
const valenceTokens = (t: { page: string; surface: string; text: string; muted: string; primary: string; secondary: string; line: string; inverse: string; cats: string[] }) =>
  `--exo-color-page:${t.page};--exo-color-body:${t.page};--exo-color-background:${t.surface};--exo-color-background-secondary:${t.page};--exo-color-background-brand:${t.page};` +
  `--exo-color-font:${t.text};--exo-color-font-secondary:${t.muted};--exo-color-font-inverse:${t.inverse};--exo-color-font-link:${t.secondary};` +
  `--exo-color-border:${t.line};--exo-color-border-secondary:color-mix(in srgb,${t.line} 28%,transparent);--exo-color-background-selected:${t.primary};` +
  `--exo-color-background-success:color-mix(in srgb,#0CA30C 16%,transparent);--exo-color-background-success-strong:#0CA30C;` +
  `--exo-color-background-warning:color-mix(in srgb,#FAB219 18%,transparent);--exo-color-background-warning-strong:#FAB219;` +
  `--exo-color-background-danger-weak:color-mix(in srgb,#D03B3B 14%,transparent);--exo-color-background-danger-strong:#D03B3B;--exo-color-background-highlight:#EC835A;` +
  t.cats.map((c, i) => `--cat-${i + 1}:${c};`).join('') +
  `--seq:${t.secondary};--band-bg:${t.page};--valence-primary:${t.primary};--valence-line:${t.line}`
const DAY = valenceTokens({ page: '#FBF6EE', surface: '#FFFFFF', text: '#0B0B0B', muted: '#52514E', primary: '#C2185B', secondary: '#0F766E', line: '#9A7B3F', inverse: '#FFFFFF', cats: ['#C2185B', '#0F766E', '#9A7B3F', '#F7A8C4', '#9FDED6', '#52514E'] })
const NIGHT = valenceTokens({ page: '#161A2E', surface: '#1F2440', text: '#FFFFFF', muted: '#C9CBE0', primary: '#F48FB1', secondary: '#5EEAD4', line: '#D4B46A', inverse: '#161A2E', cats: ['#F48FB1', '#5EEAD4', '#D4B46A', '#FBE7A1', '#C9CBE0', '#99F6E4'] })
const X = 'html[data-style=expressive]'
const VALENCE_STYLE = `
${X},${X} .band,${X}.ex-theme-light,${X}.ex-theme-light .band{${DAY};color-scheme:light}
${X}.ex-theme-dark,${X}.ex-theme-dark .band{${NIGHT};color-scheme:dark}
@media (prefers-color-scheme:dark){${X}:not(.ex-theme-light),${X}:not(.ex-theme-light) .band{${NIGHT};color-scheme:dark}}
${X}{--exo-font-family:system-ui,-apple-system,"Segoe UI",sans-serif;--exo-font-brand:"Josefin Sans",system-ui,sans-serif;--exo-font-monospace:ui-monospace,"SF Mono",Menlo,monospace}
${X} .band{color:var(--exo-color-font);border-bottom:3px double var(--valence-line)}
${X} .masthead{color:var(--exo-color-font);border-bottom:1px solid var(--exo-color-border-secondary)}
${X} .wordmark{font:400 1.25rem/1 "Poiret One",system-ui,sans-serif;color:var(--valence-primary);letter-spacing:.04em}
${X} .opening h1{font:400 clamp(2rem,4.4vw,3.25rem)/1.1 "Poiret One",system-ui,sans-serif;letter-spacing:.02em}
${X} h2,${X} h3,${X} thead th,${X} .label,${X} .budgets h2{font-family:"Josefin Sans",system-ui,sans-serif}
${X} main>section>h2,${X} .ledger-title{font-weight:600;letter-spacing:.06em;text-transform:uppercase;font-size:1rem}
${X} button.print,${X} .theme-toggle{color:var(--exo-color-font);border-color:var(--exo-color-border)}
${X} .ledger{border:3px double var(--valence-line)}
${X} .l-when strong{color:var(--valence-primary)}
`

/** Valence's Day tokens for print, whatever theme the page shows. */
const VALENCE_PRINT = `@media print{${X},${X} .band{${DAY.split(';').map(d => `${d} !important`).join(';')}}}`

/** The Boomi logo, drawn from its own vector file: a navy disc, a white b and a coral dot. For the Exosphere report's masthead and footer, in place of the flamingo. */
export const BOOMI_LOGO_SVG = (className: string): string =>
  `<svg class="${className}" viewBox="0 0 1000 1000" aria-hidden="true" focusable="false"><path fill="#003D58" d="M999.995,499.997c0,276.141-223.859,500-500,500S0,776.138,0,499.997S223.859,0.003,500,0.003 s500,223.859,500,500"/><path fill="#FFFFFF" d="M541.021,386.958c-63.126,0-118.501,22.836-159.005,60.56V150.11c0-7.495-8.113-12.178-14.605-8.434 l-71.704,41.399c-1.594,0.918-2.575,2.62-2.571,4.459v629.698c0,5.377,4.358,9.74,9.735,9.74h69.41c5.372,0,9.735-4.363,9.735-9.74 v-41.826c40.503,37.719,95.879,60.56,159.005,60.56c131.112,0,228.996-98.332,228.996-224.505S672.138,386.958,541.021,386.958 M541.021,752.454c-81.268,0-140.089-61.515-140.089-140.991s58.821-140.996,140.089-140.996s140.089,61.52,140.089,140.996 S622.289,752.454,541.021,752.454"/><path fill="#FF7C66" d="M820.165,334.213c0,30.47-24.703,55.173-55.173,55.173c-30.469,0-55.173-24.703-55.173-55.173 s24.703-55.173,55.173-55.173C795.462,279.04,820.165,303.743,820.165,334.213"/></svg>`

const STYLE = `
:root,.ex-theme-light{--exo-color-page:#ffffff;--exo-color-body:#f5f5f5;--exo-color-background:#ffffff;--exo-color-background-secondary:#f5f5f5;--exo-color-background-brand:#072b55;--exo-color-font:#1f1f1f;--exo-color-font-secondary:#707070;--exo-color-font-inverse:#ffffff;--exo-color-font-link:#006cd6;--exo-color-border:#cccccc;--exo-color-border-secondary:#e5e5e5;--exo-color-background-selected:#006cd6;
--exo-color-background-success:#cff3e8;--exo-color-background-success-strong:#009058;--exo-color-background-warning:#fcedbd;--exo-color-background-warning-strong:#cf761b;--exo-color-background-danger-weak:#ffedf0;--exo-color-background-danger-strong:#c71739;--exo-color-background-highlight:#ff7c66;--exo-color-shadow-moderate:rgba(0,0,0,.08);
--cat-1:#006cd6;--cat-2:#c76cb8;--cat-3:#a16123;--cat-4:#8462a5;--cat-5:#db6b58;--cat-6:#3894dc;--seq:#072b55;color-scheme:light}
.ex-theme-dark{--exo-color-page:#1a1a1a;--exo-color-body:#1f1f1f;--exo-color-background:#2e2e2e;--exo-color-background-secondary:#1f1f1f;--exo-color-background-brand:#9caabb;--exo-color-font:#ffffff;--exo-color-font-secondary:#cccccc;--exo-color-font-inverse:#1f1f1f;--exo-color-font-link:#66b6f6;--exo-color-border:#707070;--exo-color-border-secondary:#454545;--exo-color-background-selected:#66b6f6;
--exo-color-background-success:#003d18;--exo-color-background-success-strong:#3ecfa2;--exo-color-background-warning:#4e2d0e;--exo-color-background-warning-strong:#ec9932;--exo-color-background-danger-weak:#43191b;--exo-color-background-danger-strong:#ff5c6c;--exo-color-background-highlight:#b2301a;--exo-color-shadow-moderate:rgba(0,0,0,.4);
--cat-1:#3894dc;--cat-2:#c76cb8;--cat-3:#a16123;--cat-4:#8462a5;--cat-5:#db6b58;--cat-6:#0085f0;--seq:#9caabb;color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not(.ex-theme-light){--exo-color-page:#1a1a1a;--exo-color-body:#1f1f1f;--exo-color-background:#2e2e2e;--exo-color-background-secondary:#1f1f1f;--exo-color-background-brand:#9caabb;--exo-color-font:#ffffff;--exo-color-font-secondary:#cccccc;--exo-color-font-inverse:#1f1f1f;--exo-color-font-link:#66b6f6;--exo-color-border:#707070;--exo-color-border-secondary:#454545;--exo-color-background-selected:#66b6f6;
--exo-color-background-success:#003d18;--exo-color-background-success-strong:#3ecfa2;--exo-color-background-warning:#4e2d0e;--exo-color-background-warning-strong:#ec9932;--exo-color-background-danger-weak:#43191b;--exo-color-background-danger-strong:#ff5c6c;--exo-color-background-highlight:#b2301a;--exo-color-shadow-moderate:rgba(0,0,0,.4);
--cat-1:#3894dc;--cat-2:#c76cb8;--cat-3:#a16123;--cat-4:#8462a5;--cat-5:#db6b58;--cat-6:#0085f0;--seq:#9caabb;color-scheme:dark}}
:root{--exo-font-family:"Noto Sans",system-ui,sans-serif;--exo-font-brand:"Poppins","Noto Sans",system-ui,sans-serif;--exo-font-monospace:"Fira Mono",ui-monospace,monospace;--exo-radius-standard:.3125rem;--exo-radius-large:.625rem;--exo-spacing-x-small:.5rem;--exo-spacing-small:.75rem;--exo-spacing-standard:1rem;--exo-spacing-large:1.5rem;--exo-spacing-x-large:2rem}
*{box-sizing:border-box}
html{background:var(--exo-color-body)}
body{margin:0;background:var(--exo-color-body);color:var(--exo-color-font);font:400 .875rem/1.5 var(--exo-font-family)}
.masthead{background:var(--exo-color-background-brand);color:var(--exo-color-font-inverse);position:sticky;top:0;z-index:5}
html{scroll-padding-top:3.75rem}
.bar{max-width:1440px;margin:0 auto;padding:.625rem var(--exo-spacing-large);display:flex;align-items:center;gap:var(--exo-spacing-large)}
.wordmark{font:600 1.0625rem/1 var(--exo-font-brand);color:inherit;text-decoration:none;white-space:nowrap}
.masthead nav{display:flex;gap:1.25rem;flex:1;overflow-x:auto;scrollbar-width:none}
.masthead nav a{color:inherit;text-decoration:none;font-size:.875rem;opacity:.82;white-space:nowrap;padding:.25rem 0;border-bottom:1px solid transparent}
.masthead nav a:hover{opacity:1;border-bottom-color:currentColor}
.opening{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,340px);gap:1rem 3rem;align-items:end;margin-top:2rem}.opening.alone{grid-template-columns:minmax(0,1fr)}
.account h2{font:600 .813rem/1.4 var(--exo-font-family);color:var(--exo-color-font-secondary);margin:0 0 .5rem}.account dl{grid-template-columns:max-content minmax(0,1fr);margin:0;font-size:.875rem}.account{padding-left:1.5rem;border-left:1px solid var(--exo-color-border-secondary)}
.opening h1{font:600 clamp(1.75rem,3.6vw,2.5rem)/1.15 var(--exo-font-brand);letter-spacing:-.01em;margin:0 0 .75rem;overflow-wrap:anywhere;text-wrap:balance}
.lede{font-size:1.0625rem;line-height:1.6;max-width:70ch;margin:0 0 .5rem}.lede strong{font-weight:600}.lede .status{white-space:normal}
.dateline{font-size:.813rem;color:var(--exo-color-font-secondary);margin:0}.dateline code{font-size:.75rem}
main{max-width:1440px;overflow-wrap:break-word;margin:0 auto;padding:var(--exo-spacing-large)}
h1,h2,h3{font-family:var(--exo-font-brand);font-weight:400;line-height:1.25;margin:0}
h1{font-size:1.75rem}h2{font-size:1.25rem;margin-bottom:var(--exo-spacing-small)}h3{font-size:1rem}
.muted,.note,.hint,.aside,.sub,footer,.count{color:var(--exo-color-font-secondary)}
main>section{margin-top:2rem;padding-top:1rem;border-top:1px solid var(--exo-color-border-secondary)}
main>section>h2{margin-bottom:.75rem}
h2 .aside{font:400 .875rem/1.4 var(--exo-font-family);margin-left:.9rem;white-space:nowrap}
.chart{margin:0}
svg.i{display:inline-block;width:1.05em;height:1.05em;vertical-align:-.17em;margin-right:.35em;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex:none}.i .solid{fill:currentColor;stroke:none}
.status-healthy .i,.badge-healthy .i{color:var(--exo-color-background-success-strong)}.status-warning .i,.badge-warning .i{color:var(--exo-color-background-warning-strong)}.status-serious .i,.badge-serious .i{color:var(--exo-color-background-highlight)}.status-critical .i,.badge-critical .i{color:var(--exo-color-background-danger-strong)}
::selection{background:var(--exo-color-background-selected);color:var(--exo-color-font-inverse)}
html{scrollbar-color:var(--exo-color-border) transparent;accent-color:var(--exo-color-background-selected)}
a{text-underline-offset:.2em;text-decoration-thickness:1px}
table,.lede,.legend{font-variant-numeric:tabular-nums}
input::placeholder{color:var(--exo-color-font-secondary)}
.status-healthy .icon{color:var(--exo-color-background-success-strong)}.status-warning .icon{color:var(--exo-color-background-warning-strong)}.status-serious .icon{color:var(--exo-color-background-highlight)}.status-critical .icon{color:var(--exo-color-background-danger-strong)}
.badge{display:inline-flex;align-items:center;white-space:nowrap;border-radius:var(--exo-radius-standard);padding:0 .5rem;margin:0 .35rem .3rem 0;font-size:.813rem;line-height:1.6rem;border:1px solid transparent}
.badge-healthy{background:var(--exo-color-background-success)}.badge-healthy .icon{color:var(--exo-color-background-success-strong)}
.badge-warning{background:var(--exo-color-background-warning)}.badge-warning .icon{color:var(--exo-color-background-warning-strong)}
.badge-serious{background:var(--exo-color-background-secondary);border-color:var(--exo-color-background-highlight)}.badge-serious .icon{color:var(--exo-color-background-highlight)}
.badge-critical{background:var(--exo-color-background-danger-weak)}.badge-critical .icon{color:var(--exo-color-background-danger-strong)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
ol.attention{list-style:none;padding:0;margin:0}
.alert{background:var(--exo-color-background-secondary);border-radius:var(--exo-radius-standard);padding:.5rem .75rem;margin-bottom:.5rem}
.alert-warning{background:var(--exo-color-background-warning)}.alert-critical{background:var(--exo-color-background-danger-weak)}.alert-serious{box-shadow:inset 0 0 0 1px var(--exo-color-background-highlight)}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:1.5rem 2rem;margin-bottom:var(--exo-spacing-standard)}
.chart{margin:0}figcaption{display:flex;flex-wrap:wrap;align-items:baseline;gap:.5rem;margin-bottom:.5rem}
svg{display:block;width:100%;height:auto;overflow:visible}
svg text{font:12px var(--exo-font-family);fill:var(--exo-color-font)}svg .axis{fill:var(--exo-color-font-secondary)}svg .value{font-weight:600}
svg .baseline{stroke:var(--exo-color-border);stroke-width:1}svg .grid{stroke:var(--exo-color-border-secondary);stroke-dasharray:2 3}
.fill-healthy{fill:var(--exo-color-background-success-strong);background:var(--exo-color-background-success-strong)}.fill-warning{fill:var(--exo-color-background-warning-strong);background:var(--exo-color-background-warning-strong)}
.fill-serious{fill:var(--exo-color-background-highlight);background:var(--exo-color-background-highlight)}.fill-critical{fill:var(--exo-color-background-danger-strong);background:var(--exo-color-background-danger-strong)}
.fill-healthy-ink{color:var(--exo-color-background-success-strong)}.fill-warning-ink{color:var(--exo-color-background-warning-strong)}.fill-serious-ink{color:var(--exo-color-background-highlight)}.fill-critical-ink{color:var(--exo-color-background-danger-strong)}
.cat-1{fill:var(--cat-1)}.cat-1.at-least{fill-opacity:.45}.cat-2{fill:var(--cat-2)}.cat-3{fill:var(--cat-3)}.cat-4{fill:var(--cat-4)}.cat-5{fill:var(--cat-5)}.cat-6{fill:var(--cat-6)}.seq{fill:var(--seq)}
svg .line{fill:none;stroke:var(--cat-1);stroke-width:2;stroke-linejoin:round}svg .area{fill:var(--cat-1);opacity:.12}
svg .dot{fill:var(--exo-color-background);stroke:var(--cat-1);stroke-width:2}
svg .target{fill:transparent}svg .hit{cursor:default;outline:none}svg .hit[role="button"]{cursor:pointer}
svg .hit:hover .target,svg .hit:focus-visible .target{fill:var(--exo-color-font);opacity:.05}svg .hit:hover .dot,svg .hit:focus-visible .dot{fill:var(--cat-1)}
.legend{display:flex;flex-wrap:wrap;gap:.25rem 1rem;list-style:none;padding:0;margin:0 0 .5rem;font-size:.813rem}
.legend li{display:flex;align-items:center;gap:.3rem}.legend .swatch{width:.75rem;height:.75rem;border-radius:2px;display:inline-block}.legend .icon{font-weight:700}
details.data{margin-top:.5rem;font-size:.813rem;overflow-x:auto}details.data summary{cursor:pointer;color:var(--exo-color-font-link);font-weight:600}
.scroll{overflow-x:auto;position:relative}.scroll table{min-width:560px}.scroll table.wide{min-width:1040px}thead th{white-space:nowrap}
td.id code{white-space:nowrap}td.stages{min-width:15rem}table.wide tbody th{min-width:11rem}td.id{white-space:nowrap}td .sub,th .sub{font-weight:400;font-size:.813rem;color:var(--exo-color-font-secondary)}
a{color:var(--exo-color-font-link)}dl.facts{margin:0}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:.4rem .65rem;border-bottom:1px solid var(--exo-color-border-secondary);vertical-align:top}
thead th{background:var(--exo-color-background-secondary)}tbody th{font-weight:600}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
thead button{all:unset;cursor:pointer;font-weight:600;font-size:.813rem;color:var(--exo-color-font)}
thead button:hover{color:var(--exo-color-font-link);text-decoration:underline}
thead button[data-dir="asc"]::after{content:" ▲"}thead button[data-dir="desc"]::after{content:" ▼"}
button{font:inherit}
button.print{background:transparent;color:inherit;border:1px solid color-mix(in srgb,currentColor 40%,transparent);border-radius:999px;padding:.3rem .875rem;cursor:pointer;font:400 .813rem/1.4 var(--exo-font-family)}button.print:hover{border-color:currentColor}button.print{white-space:nowrap}@media (max-width:640px){button.print{display:none}}
.theme-toggle{width:2.25rem;height:2.25rem;display:inline-flex;align-items:center;justify-content:center;padding:0;background:transparent;color:inherit;border:1px solid color-mix(in srgb,currentColor 40%,transparent);border-radius:999px;cursor:pointer}.theme-toggle:hover{border-color:currentColor}.theme-toggle svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}.theme-toggle .sun,.ex-theme-dark .theme-toggle .moon{display:none}.ex-theme-dark .theme-toggle .sun{display:block}
.filters button{background:var(--exo-color-background);color:var(--exo-color-font);border:1px solid var(--exo-color-border);border-radius:1.5625rem;padding:.25rem .875rem;cursor:pointer;font-weight:600}
.filters button[aria-pressed="true"]{background:var(--exo-color-background-selected);border-color:var(--exo-color-background-selected);color:var(--exo-color-font-inverse)}
:focus-visible{outline:2px solid var(--exo-color-background-selected);outline-offset:2px}
.controls{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;margin-bottom:.75rem}
.filters{display:flex;flex-wrap:wrap;gap:.5rem}
.search input{background:var(--exo-color-background);color:var(--exo-color-font);border:1px solid var(--exo-color-border);border-radius:var(--exo-radius-standard);padding:.4rem .75rem;min-width:240px;font:inherit}
.timeline .legend{margin-top:.75rem}
.rail{display:inline-flex;flex-wrap:wrap;align-items:center;gap:.25rem 1rem}
.rail .badge{background:none;border:0;padding:0;margin:0;font-size:.813rem;line-height:1.5}
.badge-critical{color:var(--exo-color-background-danger-strong)}.badge-serious{color:var(--exo-color-background-highlight)}
footer .maker{width:.75rem;height:1rem;vertical-align:-.2rem;margin-right:.5rem;fill:var(--exo-color-font-secondary)}

.band{--band-bg:#072b55;background:var(--band-bg);color:#ffffff;
--exo-color-font:#ffffff;--exo-color-font-secondary:#cccccc;--exo-color-background:rgba(255,255,255,.07);--exo-color-body:#0d3664;--exo-color-border:rgba(255,255,255,.35);--exo-color-border-secondary:rgba(255,255,255,.18);--exo-color-font-link:#66b6f6;
--exo-color-background-success-strong:#3ecfa2;--exo-color-background-warning-strong:#ec9932;--exo-color-background-danger-strong:#ff5c6c;--exo-color-background-highlight:#ff8a75;--exo-color-background-selected:#66b6f6}
.ex-theme-dark .band{--band-bg:#262626;--exo-color-body:#2b2b2b}
@media (prefers-color-scheme:dark){:root:not(.ex-theme-light) .band{--band-bg:#262626;--exo-color-body:#2b2b2b}}
.band-inner{max-width:1440px;margin:0 auto;padding:1.75rem var(--exo-spacing-large) 1.5rem}
.band .opening{margin-top:0;align-items:start}
.band .legend,.band .note{color:var(--exo-color-font-secondary)}
.band details.data summary{color:var(--exo-color-font-link)}.band details.data table{background:rgba(0,0,0,.2)}
.budgets h2{font:600 .813rem/1.4 var(--exo-font-family);color:var(--exo-color-font-secondary);margin:0 0 .6rem;letter-spacing:.02em}
.budgets{padding-left:1.5rem;border-left:1px solid var(--exo-color-border-secondary)}
.meter{margin:0 0 .9rem}.meter-head{display:flex;justify-content:space-between;gap:1rem;font-size:.875rem}
.meter-bar{height:.5rem;border-radius:.25rem;background:var(--exo-color-background);margin:.35rem 0 .25rem;overflow:hidden;box-shadow:inset 0 0 0 1px var(--exo-color-border-secondary)}
.meter-bar span{display:block;height:100%;border-radius:.25rem;background:var(--exo-color-background-success-strong)}
.meter-warning .meter-bar span{background:var(--exo-color-background-warning-strong)}.meter-critical .meter-bar span{background:var(--exo-color-background-danger-strong)}
.note{font-size:.813rem;color:var(--exo-color-font-secondary);margin:.35rem 0}.note .na-how{display:block;margin-top:.2rem}
.account-line{font-size:.875rem;margin:1.25rem 0 0;color:var(--exo-color-font-secondary)}.account-line strong{color:var(--exo-color-font);font-weight:600}.account-line .label{font-weight:600;margin-right:.35rem}
table.lanes td.lane{min-width:11rem}table.lanes tbody th{min-width:16rem}table.lanes td.lane .status{display:inline-block;margin:.05rem 0}
.export{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .5rem;margin:0 0 .75rem}.export-label{font-size:.813rem;color:var(--exo-color-font-secondary);margin-right:.25rem}.export button{background:var(--exo-color-background);color:var(--exo-color-font);border:1px solid var(--exo-color-border);border-radius:var(--exo-radius-x-large,1.5625rem);padding:.25rem .875rem;font:600 .813rem/1.4 var(--exo-font-family);cursor:pointer}.export button:hover{border-color:var(--exo-color-background-selected)}.export-done{font-size:.813rem;color:var(--exo-color-font-secondary)}
.overrides li{padding:.35rem 0;border-bottom:1px solid var(--exo-color-border-secondary)}.overrides time{color:var(--exo-color-font-secondary);margin-right:.5rem;font-variant-numeric:tabular-nums}
code.copy{cursor:copy}td a,th a,.sub a{white-space:nowrap}code.copy.copied{outline:1px solid var(--exo-color-background-success-strong);outline-offset:1px;border-radius:2px}
.why{font-size:.813rem;color:var(--exo-color-font-secondary);margin:.15rem 0 0 1.4rem}
svg.maker{display:inline-block}
.wordmark .logo{width:1.5rem;height:1.5rem;vertical-align:-.4rem;margin-right:.5rem}
footer .maker-logo{width:1rem;height:1rem;vertical-align:-.2rem;margin-right:.5rem}
@media (max-width:900px){.budgets{padding-left:0;border-left:0;padding-top:1rem;border-top:1px solid var(--exo-color-border-secondary)}}
@media print{.band{background:none;color:inherit}}
main>section.first{margin-top:0;padding-top:0;border-top:0}
.ledger{list-style:none;margin:0;padding:.25rem .5rem;background:var(--exo-color-background);border:1px solid var(--exo-color-border-secondary);border-radius:var(--exo-radius-large)}.ledger-row:last-child .ledger-link{border-bottom:0}
.ledger-link{display:grid;grid-template-columns:13rem minmax(0,1fr) 11rem 8rem;gap:.25rem 1.5rem;align-items:baseline;padding:.6rem .5rem;color:inherit;text-decoration:none;border-bottom:1px solid var(--exo-color-border-secondary);border-radius:var(--exo-radius-standard)}
.ledger-link:hover{background:var(--exo-color-body)}.ledger-link:hover .l-id{text-decoration:underline}
.l-when{display:flex;flex-direction:column;font-size:.875rem;line-height:1.4}.l-when span{color:var(--exo-color-font-secondary);font-size:.813rem;font-variant-numeric:tabular-nums}.l-when .l-id{font-size:.75rem}
.l-what{font-size:.938rem;line-height:1.55}.l-what strong{font-weight:600}
.l-how{display:flex;flex-wrap:wrap;gap:.15rem .75rem;font-size:.875rem;font-variant-numeric:tabular-nums}.l-steps{flex-basis:100%;font-size:.75rem;color:var(--exo-color-font-secondary)}
.l-cost{text-align:right;font-size:.938rem;font-variant-numeric:tabular-nums}.l-budget{font-size:.75rem;color:var(--exo-color-font-secondary)}
@media (max-width:900px){.ledger-link{grid-template-columns:minmax(0,1fr) auto}.l-what{grid-column:1/-1}.l-how{grid-column:1}.l-cost{grid-row:1;grid-column:2}}
.na{color:var(--exo-color-font-secondary);font-size:.813rem;font-weight:400;white-space:nowrap;cursor:help;border-bottom:1px dotted var(--exo-color-border)}.na .i{color:var(--exo-color-font-secondary);margin-right:.25em}.na-set{cursor:default}.na-how{font-size:.813rem;color:var(--exo-color-font-secondary)}
.nd{color:var(--exo-color-font-secondary);cursor:help}
ol.steps{list-style:none;padding:0;margin:0}
.step-group+.step-group{margin-top:1rem}details.step-group>summary.group-head{cursor:pointer;list-style-position:outside}details.step-group:not([open])>summary.group-head{border-bottom-color:var(--exo-color-border-secondary)}li.chore summary{color:var(--exo-color-font-secondary)}.group-head{font:600 .95rem/1.4 var(--exo-font-family);margin:0 0 .25rem;padding-bottom:.4rem;border-bottom:1px solid var(--exo-color-border)}.group-head .aside{font-weight:400;font-size:.813rem;margin-left:.35em}
.order{margin-left:auto}
ol.steps li{border-bottom:1px solid var(--exo-color-border-secondary)}
ol.steps summary{cursor:pointer;padding:.5rem .25rem}
ol.steps time{font-variant-numeric:tabular-nums;color:var(--exo-color-font-secondary);margin-right:.5em}
.tag{display:inline-flex;align-items:center;gap:.35em;font-size:.75rem;font-weight:600;border-radius:1rem;padding:0 .55rem;margin-left:.4em;border:1px solid var(--exo-color-border-secondary);color:var(--exo-color-font-secondary)}.tag::before{content:"";width:.5rem;height:.5rem;border-radius:2px;background:var(--tag,var(--exo-color-border))}
.tag-1{--tag:var(--cat-1)}.tag-2{--tag:var(--cat-2)}.tag-3{--tag:var(--cat-3)}.tag-4{--tag:var(--cat-4)}.tag-5{--tag:var(--cat-5)}.tag-6{--tag:var(--cat-6)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.125rem .75rem;margin:.125rem 0 .75rem 1.75rem}dt{color:var(--exo-color-font-secondary)}dd{margin:0;overflow-wrap:anywhere}
code{font:.813rem var(--exo-font-monospace)}
ul.plain{list-style:none;padding:0;margin:0}ul.plain li{margin:.25rem 0}ul.plain li.sub{margin-left:1.4em;color:var(--exo-color-font-secondary)}
.tooltip{position:fixed;z-index:10;pointer-events:none;max-width:320px;background:var(--exo-color-font);color:var(--exo-color-background);border-radius:var(--exo-radius-standard);padding:.35rem .6rem;font-size:.813rem;box-shadow:0 0 1rem 0 var(--exo-color-shadow-moderate)}
footer{max-width:1440px;margin:0 auto;padding:var(--exo-spacing-standard) var(--exo-spacing-large) var(--exo-spacing-x-large);font-size:.813rem}
@media (max-width:900px){.opening{grid-template-columns:minmax(0,1fr)}.account{padding-left:0;border-left:0;padding-top:1rem;border-top:1px solid var(--exo-color-border-secondary)}}
@media (max-width:640px){main,footer,.bar{padding-left:1rem;padding-right:1rem}.bar{flex-wrap:wrap;row-gap:.25rem}.masthead nav{order:3;flex-basis:100%;gap:1rem}.search input{min-width:0;width:100%}}
@media print{.theme,.controls,details.data,.masthead nav{display:none}}
@media (forced-colors:active){.badge,.alert{border:1px solid CanvasText}}
`

/** Text for a CSS string: quotes, backslashes and line breaks escaped. */
const cssString = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`

/** Each printed page's margins: the report's name and date at the top, the page number at the bottom. */
const pageMargins = (heading: string) =>
  `@media print{@page{margin:16mm 14mm 18mm;@top-left{content:${cssString(heading)};font:400 8pt system-ui,sans-serif;color:#707070}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:400 8pt system-ui,sans-serif;color:#707070}}}`

/**
 * The report on paper, or saved as a PDF: the light theme whatever the screen
 * shows, every session's steps unfolded (each step's details stay closed; a
 * failure's reason shows without them), tables fitted to the page with long
 * IDs wrapping, a Boomi link's address printed after it, nothing cut across a
 * page break, and the controls left off. Charts and status icons keep their
 * colors.
 */
const PRINT_STYLE = `
@media print{
:root,.band{${(STYLE.match(/:root,\.ex-theme-light\{([^}]*)\}/)?.[1] ?? '').replace(/\n/g, '').split(';').filter(Boolean).map(d => `${d} !important`).join(';')};color-scheme:light}
html,body{background:#fff !important}
html{font-size:11.5px}
.masthead{position:static;background:none;color:var(--exo-color-font);border-bottom:1px solid var(--exo-color-border-secondary)}
.masthead nav,.theme,.print,.controls,details.data,.copy-hint,.screen-only,.export{display:none !important}
.bar,.band-inner,main,footer{max-width:none;padding-left:0;padding-right:0}
.band{background:none !important;color:var(--exo-color-font);border-bottom:1px solid var(--exo-color-border-secondary)}
.opening{grid-template-columns:minmax(0,1fr) 15rem}
.scroll{overflow:visible}.scroll table,.scroll table.wide{min-width:0 !important}
table.lanes td.lane,table.lanes tbody th{min-width:0}
code,.sub{overflow-wrap:anywhere;word-break:break-word}
a[href^="http"]{white-space:normal !important}a[href^="http"]::after{content:attr(href);display:block;font-size:6.5pt;line-height:1.3;color:var(--exo-color-font-secondary);overflow-wrap:anywhere;word-break:break-all}
.charts{grid-template-columns:1fr 1fr;gap:1rem 1.5rem}
table{font-size:8.5pt}table.lanes tbody th{width:32%}
ol.steps summary{list-style:none}ol.steps summary::-webkit-details-marker{display:none}ol.steps summary::marker{content:""}
details.step-group::details-content{content-visibility:visible;display:block}
.ledger-row,tr,figure.chart,ol.steps>li,.meter,.account-line,.why{break-inside:avoid}
h2,h3,.group-head,figcaption{break-after:avoid}
main>section{break-inside:auto}
svg,.status .i,.fill-healthy,.fill-warning,.fill-serious,.fill-critical,.meter-bar,.meter-bar span,.tag{print-color-adjust:exact;-webkit-print-color-adjust:exact}
.hit .target{display:none}
#tip,.tooltip{display:none !important}
}
`

/** The theme, sorting, the chart tooltip and the steps' filter and search: no libraries, nothing sent anywhere. */
const SCRIPT = `
(function(){
  var root=document.documentElement;
  function pick(t){root.classList.remove('ex-theme-light','ex-theme-dark');root.classList.add('ex-theme-'+t);
    var toggle=document.querySelector('[data-theme-toggle]');if(toggle){var next=t==='dark'?'light':'dark';toggle.setAttribute('aria-label','Switch to the '+next+' theme');toggle.title=next==='dark'?'Dark theme':'Light theme'}
    try{localStorage.setItem('bc-report-theme',t)}catch(e){}}
  var saved=null;try{saved=localStorage.getItem('bc-report-theme')}catch(e){}
  pick(saved||(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
  var toggler=document.querySelector('[data-theme-toggle]');if(toggler)toggler.addEventListener('click',function(){pick(root.classList.contains('ex-theme-dark')?'light':'dark')});
  var days=document.body.hasAttribute('data-days');
  document.querySelectorAll('time[datetime]').forEach(function(t){var d=new Date(t.getAttribute('datetime'));if(!isNaN(d))t.textContent=days?d.toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})});
  document.querySelectorAll('table.sortable').forEach(function(table){
    table.querySelectorAll('thead button').forEach(function(btn){btn.addEventListener('click',function(){
      var col=+btn.getAttribute('data-col'),dir=btn.getAttribute('data-dir')==='asc'?'desc':'asc';
      table.querySelectorAll('thead button').forEach(function(b){b.removeAttribute('data-dir')});btn.setAttribute('data-dir',dir);
      var body=table.tBodies[0],rows=Array.prototype.slice.call(body.rows);
      rows.sort(function(a,b){var x=a.cells[col],y=b.cells[col],nx=x.getAttribute('data-sort'),ny=y.getAttribute('data-sort');
        var c=nx!==null&&ny!==null?(isNaN(+nx)||isNaN(+ny)?nx.localeCompare(ny):(+nx)-(+ny)):x.textContent.localeCompare(y.textContent);return dir==='asc'?c:-c});
      rows.forEach(function(r){body.appendChild(r)});
    })});
  });
  var tip=document.querySelector('.tooltip');
  function show(el,x,y){tip.textContent=el.getAttribute('data-tip');tip.hidden=false;var r=tip.getBoundingClientRect();
    tip.style.left=Math.max(8,Math.min(innerWidth-r.width-8,x+12))+'px';tip.style.top=Math.max(8,y-r.height-12)+'px'}
  document.querySelectorAll('[data-tip]').forEach(function(el){
    el.addEventListener('mousemove',function(e){show(el,e.clientX,e.clientY)});
    el.addEventListener('mouseleave',function(){tip.hidden=true});
    el.addEventListener('focus',function(){var r=el.getBoundingClientRect();show(el,r.left+r.width/2,r.top)});
    el.addEventListener('blur',function(){tip.hidden=true});
  });
  var box=document.querySelector('[data-steps]');if(!box)return;
  var groups=Array.prototype.slice.call(box.querySelectorAll('.step-group'));
  var items=Array.prototype.slice.call(box.querySelectorAll('ol.steps > li')),filter='all',search=document.querySelector('[data-search]'),shown=document.querySelector('.shown');
  function apply(){var q=(search.value||'').toLowerCase(),n=0;items.forEach(function(li){
    var lv=li.getAttribute('data-level'),pr='product:'+li.getAttribute('data-product');
    var ok=(filter==='all'||(filter==='issues'&&lv!=='healthy')||filter===pr||(filter==='kind:release'&&li.getAttribute('data-kind')==='release'))&&(!q||li.textContent.toLowerCase().indexOf(q)>=0);
    li.hidden=!ok;if(ok)n++});
    groups.forEach(function(g){g.hidden=!g.querySelector('ol.steps > li:not([hidden])');if((q||filter!=='all')&&!g.hidden&&g.tagName==='DETAILS')g.open=true});
    shown.textContent=n===items.length?'':n+' of '+items.length+' shown'}
  function order(dir){var by=function(a,b){var x=+a.getAttribute('data-at'),y=+b.getAttribute('data-at');return dir==='asc'?x-y:y-x};
    groups.sort(by).forEach(function(g){box.appendChild(g);var ol=g.querySelector('ol.steps');Array.prototype.slice.call(ol.children).sort(by).forEach(function(li){ol.appendChild(li)})});
    document.querySelectorAll('[data-order]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-order')===dir))});
    try{localStorage.setItem('bc-report-order',dir)}catch(e){}}
  document.querySelectorAll('[data-order]').forEach(function(b){b.addEventListener('click',function(){order(b.getAttribute('data-order'))})});
  var savedOrder=null;try{savedOrder=localStorage.getItem('bc-report-order')}catch(e){}
  if(savedOrder==='asc')order('asc');
  function setFilter(f){filter=f;var any=false;document.querySelectorAll('[data-filter]').forEach(function(x){var on=x.getAttribute('data-filter')===f;any=any||on;x.setAttribute('aria-pressed',String(on))});
    if(!any)document.querySelectorAll('[data-filter]').forEach(function(x){x.setAttribute('aria-pressed',String(false))});apply()}
  document.querySelectorAll('[data-filter]').forEach(function(b){b.addEventListener('click',function(){setFilter(b.getAttribute('data-filter'))})});
  document.querySelectorAll('[data-pick]').forEach(function(g){function go(){setFilter(g.getAttribute('data-pick'));document.getElementById('steps').scrollIntoView({behavior:'smooth'})}
    g.addEventListener('click',go);g.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}})});
  search.addEventListener('input',apply);
  var expand=document.querySelector('[data-expand]');
  if(expand)expand.addEventListener('click',function(){var open=expand.getAttribute('aria-pressed')!=='true';
    items.forEach(function(li){var d=li.querySelector('details');if(d)d.open=open});if(open)groups.forEach(function(g){if(g.tagName==='DETAILS')g.open=true});expand.setAttribute('aria-pressed',String(open));expand.textContent=open?'Collapse all':'Expand all'});
  document.addEventListener('click',function(e){var c=e.target.closest&&e.target.closest('[data-copy]');if(!c)return;e.preventDefault();
    var done=function(){c.classList.add('copied');c.title='Copied';setTimeout(function(){c.classList.remove('copied');c.title='Copy'},1200)};
    if(navigator.clipboard)navigator.clipboard.writeText(c.getAttribute('data-copy')).then(done,function(){});});
  // Printing unfolds every session's steps, and folds them back after.
  var folded=[];
  window.addEventListener('beforeprint',function(){folded=[];document.querySelectorAll('details.step-group:not([open])').forEach(function(g){folded.push(g);g.open=true})});
  window.addEventListener('afterprint',function(){folded.forEach(function(g){g.open=false});folded=[]});
  // The components and the platform changes, copied or saved for a spreadsheet: with the clipboard where the browser allows it, else a selected text box.
  function fallback(text){var box=document.createElement('textarea');box.value=text;box.setAttribute('readonly','');box.style.position='fixed';box.style.opacity='0';document.body.appendChild(box);box.select();var ok=false;try{ok=document.execCommand('copy')}catch(e){}document.body.removeChild(box);return ok}
  document.querySelectorAll('.export[data-source]').forEach(function(group){var exportEl=document.getElementById(group.getAttribute('data-source'));if(!exportEl)return;
    var data=JSON.parse(exportEl.textContent);var said=group.querySelector('.export-done');
    function say(t){if(!said)return;said.textContent=t;clearTimeout(say.t);say.t=setTimeout(function(){said.textContent=''},2500)}
    function copy(text,what){var done=function(){say('Copied '+data.rows+' '+data.noun+(data.rows===1?'':'s')+' '+what+'.')};var failed=function(){if(fallback(text))done();else say('Your browser blocked copying. Use Save as CSV instead.')};
      if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(done,failed);else failed()}
    group.querySelectorAll('[data-export]').forEach(function(b){b.addEventListener('click',function(){var kind=b.getAttribute('data-export');
      if(kind==='tsv')copy(data.tsv,'for a spreadsheet: paste into the first cell');
      else if(kind==='csv')copy(data.csv,'as CSV');
      else{var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\\ufeff'+data.csv],{type:'text/csv;charset=utf-8'}));a.download=data.file;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},0);say('Saved '+data.file+'.')}})})});
  var printer=document.querySelector('[data-print]');if(printer)printer.addEventListener('click',function(){window.print()});
  document.querySelectorAll('.ledger-link,.session-pick').forEach(function(l){l.addEventListener('click',function(){
    var g=document.querySelector(l.getAttribute('href'));if(g&&g.tagName==='DETAILS')g.open=true})});
})();
`
