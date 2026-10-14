// /bc-dashboard report html: the session report as one self-contained HTML
// file to open in a browser or share. It holds the same facts as the Markdown
// report, styled to Boomi's Exosphere design system (its Exo III tokens, light
// and dark, Poppins and Noto Sans), with charts of the session, sortable
// tables and a filterable list of steps. Plain functions: nothing here touches
// the engine.

import type { Activity, Dashboard, PastSession, Product } from '../types'
import type { ComponentDetails } from './platform'
import {
  STATUS,
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
  limitsLine,
  quarantineLines,
  sessionRuns,
  spendOf,
  spends,
  shortWhen,
  stages,
  withoutEchoes,
} from './activity'
import type { Level, ReportFacts, Stage } from './activity'
import { PRODUCT_NAMES } from './products'
import { mask } from './upgrade'

/** Text made safe for HTML, credential-shaped strings masked first. */
export const esc = (text: string): string =>
  mask(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const LABEL: Record<Level, string> = { healthy: 'Healthy', warning: 'Warning', serious: 'Blocked', critical: 'Failed' }
const LEVELS: Level[] = ['healthy', 'warning', 'serious', 'critical']

/** A status: icon and label together, never color alone. */
const status = (level: Level, text: string) =>
  `<span class="status status-${level}"><span class="icon" aria-hidden="true">${STATUS[level].icon}</span><span class="sr">${LABEL[level]}: </span>${esc(text)}</span>`

/** A component's or agent's stages as Exosphere badges. */
const badges = (list: readonly Stage[]) =>
  list.map(s => `<span class="badge badge-${s.level}"><span class="icon" aria-hidden="true">${STATUS[s.level].icon}</span><span class="sr">${LABEL[s.level]}: </span>${esc(s.text)}</span>`).join(' ')

/** A cell that sorts by a number, not its text. */
const num = (value: number | undefined, shown: string | undefined) => `<td class="n" data-sort="${value ?? -1}">${esc(shown ?? '')}</td>`

const table = (id: string, caption: string, head: string[], rows: string[], cls = '') =>
  rows.length === 0
    ? ''
    : `<section id="${id}" class="card"><h2>${esc(caption)} <span class="count">${rows.length}</span></h2>
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

const legend = (items: { cls: string; label: string; icon?: string }[]) =>
  `<ul class="legend">${items.map(i => `<li><span class="swatch ${i.cls}" aria-hidden="true"></span>${i.icon ? `<span class="icon ${i.cls}-ink" aria-hidden="true">${i.icon}</span>` : ''}${esc(i.label)}</li>`).join('')}</ul>`

/** A bar's or column's top: square at the baseline, a 4px rounded data end. */
const hbar = (x: number, y: number, w: number, h: number, r = 4) => {
  const rr = Math.min(r, w / 2, h / 2)
  return `M${x} ${y}h${(w - rr).toFixed(1)}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${(h - 2 * rr).toFixed(1)}a${rr} ${rr} 0 0 1 -${rr} ${rr}h-${(w - rr).toFixed(1)}z`
}
const vbar = (x: number, y: number, w: number, h: number, r = 4) => {
  const rr = Math.min(r, w / 2, h / 2)
  return `M${x} ${y + h}v-${(h - rr).toFixed(1)}a${rr} ${rr} 0 0 1 ${rr} -${rr}h${(w - 2 * rr).toFixed(1)}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${(h - rr).toFixed(1)}z`
}

const BUCKETS = [5, 10, 15, 30, 60, 120, 240, 480, 1440].map(m => m * 60_000)

/** Steps over the session, a column per time span stacked by how they went. */
const stepsOverTime = (steps: readonly Activity[], isAll = false): string => {
  if (steps.length < 2) return ''
  const t0 = Math.min(...steps.map(a => a.startedAt))
  const t1 = Math.max(...steps.map(a => a.startedAt))
  const size = BUCKETS.find(b => (t1 - t0) / b < 24) ?? BUCKETS[BUCKETS.length - 1]!
  const start = Math.floor(t0 / size) * size
  const n = Math.floor((t1 - start) / size) + 1
  const cols = Array.from({ length: n }, (_, i) => ({ at: start + i * size, counts: { healthy: 0, warning: 0, serious: 0, critical: 0 } as Record<Level, number> }))
  for (const a of steps) cols[Math.floor((a.startedAt - start) / size)]!.counts[levelOf(a)]++
  const max = Math.max(...cols.map(c => LEVELS.reduce((s, l) => s + c.counts[l], 0)))
  const W = 560
  const H = 160
  const left = 32
  const plotW = W - left - 8
  const colW = plotW / n
  const barW = Math.max(4, Math.min(28, colW - 6))
  const y = (v: number) => H - 22 - (v / max) * (H - 40)
  const label = (t: number) => new Date(t).toISOString().slice(11, 16)
  const marks = cols
    .map((c, i) => {
      const x = left + i * colW + (colW - barW) / 2
      let base = 0
      const total = LEVELS.reduce((s, l) => s + c.counts[l], 0)
      const segs = LEVELS.filter(l => c.counts[l] > 0).map((l, k, shown) => {
        const h = y(base) - y(base + c.counts[l])
        const top = y(base + c.counts[l])
        base += c.counts[l]
        // A 2px surface gap between stacked segments; only the top one is rounded.
        const gap = k > 0 ? 2 : 0
        const d = k === shown.length - 1 ? vbar(x, top, barW, Math.max(1, h - gap)) : `M${x} ${top.toFixed(1)}h${barW}v${Math.max(1, h - gap).toFixed(1)}h-${barW}z`
        return `<path d="${d}" class="fill-${l}"/>`
      })
      const tip = `${label(c.at)} UTC: ${total} step${total === 1 ? '' : 's'}${LEVELS.filter(l => c.counts[l]).map(l => `, ${c.counts[l]} ${LABEL[l].toLowerCase()}`).join('')}`
      return `<g class="hit" tabindex="0" data-tip="${esc(tip)}"><rect x="${(left + i * colW).toFixed(1)}" y="8" width="${colW.toFixed(1)}" height="${H - 30}" class="target"/>${segs.join('')}</g>`
    })
    .join('')
  const ticks = cols
    .map((c, i) => (i % Math.ceil(n / 6) === 0 ? `<text x="${(left + i * colW + colW / 2).toFixed(1)}" y="${H - 6}" class="axis" text-anchor="middle">${label(c.at)}</text>` : ''))
    .join('')
  return `<figure class="card chart"><figcaption><h3>${isAll ? 'Steps over time' : 'Steps over the session'}</h3><span class="sub">per ${Math.round(size / 60_000)} minutes, UTC</span></figcaption>
${legend(LEVELS.map(l => ({ cls: `fill-${l}`, label: LABEL[l], icon: STATUS[l].icon })))}
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Steps over the session, stacked by outcome">
<line x1="${left}" y1="${y(0)}" x2="${W - 8}" y2="${y(0)}" class="baseline"/><text x="${left - 6}" y="${y(max) + 4}" class="axis" text-anchor="end">${max}</text>
${marks}${ticks}</svg>
${dataTable(['Time (UTC)', ...LEVELS.map(l => LABEL[l])], cols.map(c => [label(c.at), ...LEVELS.map(l => c.counts[l])]))}</figure>`
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
  return `<figure class="card chart"><figcaption><h3>Outcomes by product</h3><span class="sub">click a product to list its steps</span></figcaption>
${legend(LEVELS.map(l => ({ cls: `fill-${l}`, label: LABEL[l], icon: STATUS[l].icon })))}
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
  return `<figure class="card chart"><figcaption><h3>Spend by product</h3><span class="sub">${byUsd ? 'cost' : 'tokens'} Claude spent getting to each product's steps</span></figcaption>
<svg viewBox="0 0 560 ${measured.length * rowH}" role="img" aria-label="Spend by product">${marks}</svg>
${dataTable(['Product', byUsd ? 'Cost' : 'Tokens'], measured.map(r => [productName(r.key), byUsd ? (formatCost(r.usd) ?? '$0') : formatTokens(r.tokens ?? 0)]))}</figure>`
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
  return `<figure class="card chart"><figcaption><h3>Cost over the session</h3><span class="sub">what the session had cost at each step</span></figcaption>
<svg viewBox="0 0 560 160" role="img" aria-label="Cost over the session">
<line x1="${left}" y1="140" x2="552" y2="140" class="baseline"/><line x1="${left}" y1="20" x2="552" y2="20" class="grid"/>
<text x="${left - 6}" y="144" class="axis" text-anchor="end">$0</text><text x="${left - 6}" y="24" class="axis" text-anchor="end">${esc(formatCost(top) ?? '')}</text>
<text x="${left}" y="156" class="axis">${new Date(t0).toISOString().slice(11, 16)}</text><text x="552" y="156" class="axis" text-anchor="end">${new Date(t1).toISOString().slice(11, 16)} UTC</text>
<path d="${area}" class="area"/><path d="${path}" class="line"/>${dots}</svg>
${dataTable(['Time (UTC)', 'Cost so far'], points.map(p => [new Date(p.at).toISOString().slice(11, 16), formatCost(p.usd) ?? '$0']))}</figure>`
}

/** How far the session's components got: touched, saved in Boomi, deployed, tested and passing. */
const pipeline = (dashboard: Dashboard, isAll = false): string => {
  const rows = components(dashboard.activity)
  if (rows.length === 0) return ''
  const ok = (a: Activity | undefined) => a?.outcome === 'ok'
  const steps = [
    { name: 'Worked on', n: rows.length },
    { name: 'Saved in Boomi', n: rows.filter(r => ok(r.saved) && r.saved!.kind !== 'pull').length },
    { name: 'Deployed', n: rows.filter(r => ok(r.deployed) && r.deployed!.kind === 'deploy').length },
    { name: 'Tested, passing', n: rows.filter(r => ok(r.tested) && levelOf(r.tested!) === 'healthy').length },
  ]
  const max = steps[0]!.n || 1
  const rowH = 30
  const left = 120
  const marks = steps
    .map((s, i) => {
      const w = Math.max(2, (s.n / max) * 340)
      return `<g class="hit" tabindex="0" data-tip="${esc(`${s.name}: ${s.n} of ${rows.length}`)}"><rect x="0" y="${i * rowH}" width="560" height="${rowH}" class="target"/>
<text x="0" y="${i * rowH + 19}" class="label">${esc(s.name)}</text><path d="${hbar(left, i * rowH + 6, s.n === 0 ? 2 : w, 18)}" class="seq"/><text x="${(left + (s.n === 0 ? 2 : w) + 6).toFixed(1)}" y="${i * rowH + 19}" class="value">${s.n}</text></g>`
    })
    .join('')
  return `<figure class="card chart"><figcaption><h3>Component pipeline</h3><span class="sub">how far ${isAll ? 'these sessions\'' : 'this session\'s'} components got</span></figcaption>
<svg viewBox="0 0 560 ${steps.length * rowH}" role="img" aria-label="Component pipeline">${marks}</svg>
${dataTable(['Stage', 'Components'], steps.map(s => [s.name, s.n]))}</figure>`
}

/** Which steps a report covers: this Claude Code session's, or every session's this folder kept. */
export type ReportScope = 'session' | 'all'

/**
 * The dashboard as a report of `scope` sees it: this session's own steps, or
 * every step this folder kept (the window's and the earlier ones), in order.
 */
export const scoped = (dashboard: Dashboard, scope: ReportScope): Dashboard => {
  if (scope === 'session') return { ...dashboard, activity: withoutEchoes(dashboard.activity.filter(a => !a.isRestored && !a.isEarlier)), earlier: [], restored: 0 }
  const seen = new Set<number>()
  const activity = [...(dashboard.earlier ?? []), ...dashboard.activity]
    .filter(a => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => a.startedAt - b.startedAt)
  return { ...dashboard, activity: withoutEchoes(activity), earlier: [] }
}

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

/** How far outside a past session's start and end a step still counts as its own. */
const SESSION_SLACK_MS = 60_000

/**
 * The session each step belongs to, by step ID: the one it names; else this
 * session for a step that wasn't brought back; else the past session (from
 * Claude Code's transcripts, in this folder) whose time covers it; else an
 * `earlier-<n>`, a new one wherever the running cost goes down, as it does
 * when a new session starts.
 */
export const assignSessions = (activity: readonly Activity[], current: string | undefined, past: readonly PastSession[] = [], folder?: string): Map<number, string> => {
  const out = new Map<number, string>()
  const here = past.filter(p => !folder || !p.project || p.project === folder)
  let n = 0
  let lastUsd: number | undefined
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
    if (n === 0 || (a.usdAt !== undefined && lastUsd !== undefined && a.usdAt < lastUsd)) n++
    if (a.usdAt !== undefined) lastUsd = a.usdAt
    out.set(a.id, `earlier-${n}`)
  }
  return out
}

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

/** The deployment package a deploy made, from its SUCCESS line. */
export const packageOf = (detail: string): string | undefined => detail.match(/\(package: ([^)\s]+)\)/)?.[1]

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
}

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
  const shortSession = (id: string) => (id.startsWith('earlier-') ? `earlier ${id.slice(8)}` : id.slice(0, 8))
  const sessionOf = (a: Activity) => sessionIds.get(a.id) ?? 'this'
  const when = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 16)

  // The hero: what this is about (the repository, else the Boomi account, else the folder), then its facts as chips.
  const title = facts.repo ? facts.repo.replace(/^https?:\/\/(www\.)?github\.com\//, '') : (boomi?.accountName ?? facts.folder ?? 'Companion session')
  const span = steps.length > 0 ? `${shortWhen(steps[0]!.startedAt, 'UTC')} → ${shortWhen(steps[steps.length - 1]!.startedAt, 'UTC')} UTC` : undefined
  const chips = (
    isAll
      ? [
          ['Sessions', String(sessions.length)],
          span && ['When', span],
          facts.folder && facts.folder !== title && ['Folder', facts.folder],
        ]
      : [
          ['Session', facts.session.slice(0, 8), facts.session],
          ['Date', facts.date],
          u.startedAt !== undefined && ['Running', duration(now - u.startedAt)],
          u.model && ['Model', u.model],
        ]
  ).filter(Boolean) as string[][]
  const chipList = chips
    .map(([label, value, full]) => `<li${full ? ` title="${esc(full)}"` : ''}><span class="chip-label">${esc(label!)}</span> ${esc(value!)}</li>`)
    .join('')

  const tile = (label: string, value: string, note?: string, level?: Level) =>
    `<div class="card tile"><div class="label">${esc(label)}</div><div class="value">${level ? status(level, value) : esc(value)}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`
  const budgetPct = u.budgetUsd && u.usd !== undefined ? Math.round((u.usd / u.budgetUsd) * 100) : undefined
  const total = sessionsCost(sessions)
  const costNote = [
    total.isAtLeast ? 'at least: some sessions are counted to their last Companion step' : undefined,
    total.missing > 0 ? `${total.missing} session${total.missing === 1 ? '' : 's'} with no cost recorded` : undefined,
  ].filter(Boolean).join('; ')
  const tiles = [
    isAll
      ? tile('Cost', total.usd === undefined ? '—' : `${total.isAtLeast ? '≥ ' : ''}${formatCost(total.usd) ?? '$0'}`, costNote || 'across the sessions, from Claude Code\'s own figures')
      : tile('Cost', formatCost(u.usd) ?? '—', u.budgetUsd ? `${budgetPct}% of the ${formatCost(u.budgetUsd)} budget` : undefined, budgetPct === undefined ? undefined : budgetPct >= 100 ? 'critical' : budgetPct >= 80 ? 'warning' : undefined),
    isAll
      ? tile('Sessions', String(sessions.length), sessions.length > 0 ? `the latest ${when(sessions[0]!.lastAt)} UTC` : undefined)
      : tile('Tokens', u.tokens !== undefined ? formatTokens(u.tokens) : '—', u.cached ? `and ${formatTokens(u.cached)} cache reads` : undefined),
    tile('Components', String(rows.length), `${steps.length} step${steps.length === 1 ? '' : 's'}${failed ? `, ${failed} failed or blocked` : ''}`),
    tile('Needs attention', String(needs.length), closed ? `${closed} closed` : needs.length === 0 ? 'all clear' : undefined, needs.length === 0 ? 'healthy' : needs.some(n => n.level === 'critical') ? 'critical' : 'warning'),
  ].join('')

  const attentionList =
    needs.length === 0
      ? `<p>${status('healthy', 'Nothing needs attention.')}</p>`
      : `<ol class="attention">${needs.map(n => `<li class="alert alert-${n.level}">${status(n.level, n.title)}<div class="hint">${esc(n.hint)}</div></li>`).join('')}</ol>`

  const componentRows = rows.map(row => {
    const spent = spendOf(row.ids, all)
    const d = row.componentId ? boomi?.components[row.componentId] : undefined
    const renamed = d?.name && d.name !== row.name ? `<div class="sub">In Boomi now: ${esc(d.name)}</div>` : ''
    const type = friendlyType(d?.type ?? row.type) ?? d?.type ?? row.type ?? ''
    const link = row.componentId && boomi?.accountId ? ` <a href="${esc(boomiLink(boomi.accountId, row.componentId))}" target="_blank" rel="noopener">Open in Boomi</a>` : ''
    const id = row.componentId ? `<code>${esc(row.componentId)}</code>${link}` : '<span class="muted">not created in Boomi</span>'
    const version = d?.version ?? row.saved?.version
    const changed = d?.modifiedDate ? `${esc(d.modifiedDate.replace('T', ' ').slice(0, 16))}${d.modifiedBy ? `<div class="sub">${esc(d.modifiedBy)}</div>` : ''}` : ''
    return `<tr><th scope="row">${esc(row.name)}${renamed}${row.recipe ? `<div class="sub">from recipe ${esc(row.recipe)}</div>` : ''}</th><td>${esc(type)}</td><td>${esc(d?.folderName ?? '')}</td><td class="id">${id}</td>${num(version === undefined ? undefined : Number(version), version === undefined ? '' : `v${version}`)}<td>${changed}</td><td>${badges(stages(row, runs))}</td>${num(spent.tokens, spent.tokens ? formatTokens(spent.tokens) : '')}${num(spent.usd, formatCost(spent.usd))}</tr>`
  })

  // Every deploy and test with the ID to find it by in Boomi: the package, or the execution.
  const releaseRows = steps
    .filter(a => !a.product && (a.kind === 'deploy' || a.kind === 'undeploy' || a.kind === 'test') && a.outcome !== 'running')
    .reverse()
    .map(a => {
      const id = a.kind === 'test' ? a.executionId : (packageOf(a.detail) ?? a.deploymentId)
      const what = a.kind === 'test' ? (a.executionId ? 'execution' : '') : a.kind === 'deploy' ? 'package' : 'deployment'
      return `<tr><td data-sort="${a.startedAt}"><time datetime="${new Date(a.startedAt).toISOString()}">${esc(when(a.startedAt))} UTC</time></td><th scope="row">${status(levelOf(a), describe(a))}</th><td>${id ? `<span class="muted">${what}</span> <code>${esc(id)}</code>` : ''}</td>${a.kind === 'test' ? `<td>${esc(a.executionStatus ?? '')}</td>` : '<td></td>'}${isAll ? `<td><code>${esc(shortSession(sessionOf(a)))}</code></td>` : ''}</tr>`
    })

  const sessionRows = sessions.map(s => {
    const cost = s.usd === undefined ? 'not recorded' : `${s.usdIs === 'atLeast' ? 'at least ' : ''}${formatCost(s.usd) ?? '$0'}`
    const label = sessionLabel(s.id)
    return `<tr><th scope="row"><code>${esc(label)}</code>${s.isCurrent ? ' <span class="tag tag-1">this session</span>' : ''}</th><td data-sort="${s.firstAt}">${esc(when(s.firstAt))} UTC</td><td data-sort="${s.lastAt}">${esc(when(s.lastAt))} UTC</td>${num(s.steps, String(s.steps))}${num(s.failed, String(s.failed))}${num(s.components, String(s.components))}${num(s.usd, cost)}</tr>`
  })

  const account = boomi && (boomi.accountId || boomi.environmentId)
    ? `<section id="account" class="card"><h2>Boomi account</h2><dl class="facts">${[
        boomi.accountName && `<dt>Account</dt><dd>${esc(boomi.accountName)}</dd>`,
        boomi.accountId && `<dt>Account ID</dt><dd><code>${esc(boomi.accountId)}</code></dd>`,
        boomi.environmentId && `<dt>Environment ID</dt><dd><code>${esc(boomi.environmentId)}</code></dd>`,
        boomi.apiHost && `<dt>Platform API</dt><dd>${esc(boomi.apiHost)}</dd>`,
      ].filter(Boolean).join('')}</dl>${boomi.note ? `<p class="muted">${esc(boomi.note)}</p>` : ''}</section>`
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
  const stepItems = [...steps]
    .reverse()
    .map(a => {
      const level = levelOf(a)
      const product = productName(productKey(a))
      const spent = all.get(a.id)
      const aside = [spent?.tokens ? `${formatTokens(spent.tokens)} tokens` : '', formatCost(spent?.usd) ?? '', a.source === 'log' ? "from Companion's log" : ''].filter(Boolean).join(' · ')
      const pkg = a.kind === 'deploy' ? packageOf(a.detail) : undefined
      const took = a.endedAt !== undefined && a.endedAt > a.startedAt ? duration(a.endedAt - a.startedAt) : undefined
      const detail = [
        a.detail && `<dt>Result</dt><dd>${esc(a.detail)}</dd>`,
        a.componentId && `<dt>Component</dt><dd><code>${esc(a.componentId)}</code>${boomi?.accountId ? ` <a href="${esc(boomiLink(boomi.accountId, a.componentId))}" target="_blank" rel="noopener">Open in Boomi</a>` : ''}</dd>`,
        a.version && `<dt>Version</dt><dd>v${esc(a.version)}</dd>`,
        pkg && `<dt>Package</dt><dd><code>${esc(pkg)}</code></dd>`,
        a.executionId && `<dt>Execution</dt><dd><code>${esc(a.executionId)}</code></dd>`,
        a.ref && `<dt>Acts on</dt><dd><code>${esc(a.ref)}</code></dd>`,
        a.file && `<dt>File</dt><dd><code>${esc(a.file)}</code></dd>`,
        took && `<dt>Took</dt><dd>${esc(took)}</dd>`,
        `<dt>Seen in</dt><dd>${a.source === 'log' ? "Companion's activity log" : "Claude's tool call"}</dd>`,
        isAll && `<dt>Session</dt><dd><code>${esc(sessionLabel(sessionOf(a)))}</code></dd>`,
      ]
        .filter(Boolean)
        .join('')
      const at = isAll ? `${when(a.startedAt)} UTC` : `${new Date(a.startedAt).toISOString().slice(11, 16)} UTC`
      return `<li data-level="${level}" data-product="${esc(product)}"><details><summary><time datetime="${new Date(a.startedAt).toISOString()}">${esc(at)}</time> ${status(level, describe(a))} <span class="tag tag-${slot(productKey(a))}">${esc(product)}</span>${aside ? ` <span class="aside">${esc(aside)}</span>` : ''}</summary><dl>${detail}</dl></details></li>`
    })
    .join('\n')

  const spendFacts = [
    limitsLine(u.limits, u.now ?? now) ? `<li>${esc(limitsLine(u.limits, u.now ?? now)!)}</li>` : '',
    ...[u.companion?.week, u.companion?.month].filter(Boolean).map(b => `<li>${status(b!.level, b!.text)}</li>`),
    u.split ? `<li>Tokens: ${esc(u.split)}</li>` : '',
    ...(u.modelSplits ?? []).map(line => `<li class="sub">${esc(line)}</li>`),
  ].join('')

  const charts = [stepsOverTime(steps, isAll), outcomesByProduct(steps), isAll ? '' : costOverTime(dashboard.activity, u.usd, now), spendByProduct(dashboard.activity, all), pipeline(dashboard, isAll)].filter(Boolean)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="boomi-dashboard${facts.version ? ` ${esc(facts.version)}` : ''}">
<title>${isAll ? 'Companion Sessions Report' : 'Companion Session Report'}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&family=Noto+Sans:wght@400;600;700&family=Fira+Mono&display=swap">
<style>${STYLE}</style>
</head>
<body${isAll ? ' data-days' : ''}>
<header class="hero">
  <div class="hero-inner">
    <div class="hero-top">
      <p class="eyebrow"><span class="mark" aria-hidden="true">◆</span> Boomi Companion <span class="sep" aria-hidden="true">·</span> ${isAll ? 'All sessions' : 'Session report'}</p>
      <div class="theme" role="group" aria-label="Theme">
        <button type="button" data-theme-pick="light" aria-pressed="false">Light</button>
        <button type="button" data-theme-pick="dark" aria-pressed="false">Dark</button>
      </div>
    </div>
    <h1>${esc(title)}</h1>
    <ul class="chips">${chipList}</ul>
  </div>
  <div class="spectrum" aria-hidden="true"><span class="s1"></span><span class="s2"></span><span class="s3"></span><span class="s4"></span><span class="s5"></span><span class="s6"></span></div>
</header>
<main>
<section class="tiles" aria-label="At a glance">${tiles}</section>
${account}
<section id="attention" class="card"><h2>Needs attention</h2>${attentionList}</section>
${charts.length > 0 ? `<section id="charts" aria-label="Charts"><div class="charts">${charts.join('\n')}</div></section>` : ''}
${isAll ? table('sessions', 'Sessions', ['Session', 'Started', 'Last step', 'Steps', 'Failed or blocked', 'Components', 'Cost'], sessionRows) : ''}
${componentRows.length === 0 ? `<section id="components" class="card"><h2>Components</h2><p class="muted">None ${isAll ? 'in these sessions' : 'this session'}.</p></section>` : table('components', 'Components', ['Component', 'Type', 'Folder', 'Component ID', 'Version', 'Changed in Boomi', 'Where it stands', 'Tokens', 'Cost'], componentRows, 'wide')}
${table('releases', 'Deployments and tests', ['When', 'Step', 'ID in Boomi', 'Status', ...(isAll ? ['Session'] : [])], releaseRows)}
${table('connectors', 'Custom connectors', ['Connector', 'Group', 'Where it stands', 'Tokens', 'Cost'], connectorRows)}
${table('agents', 'Agentstudio agents', ['Agent', 'Where it stands', 'Tokens', 'Cost'], agentRows)}
${quarantine.length === 0 ? '' : `<section id="quarantine" class="card"><h2>Data Hub quarantine</h2><ul class="plain">${quarantine.map(q => `<li>${status(q.level, q.text)}</li>`).join('')}</ul></section>`}
${spendFacts ? `<section id="usage" class="card"><h2>Usage</h2><ul class="plain">${spendFacts}</ul></section>` : ''}
<section id="steps" class="card"><h2>Claude's steps <span class="count">${steps.length}</span></h2>
${
  steps.length === 0
    ? '<p class="muted">No Companion steps this session.</p>'
    : `<div class="controls">
  <label class="search"><span class="sr">Search steps</span><input type="search" placeholder="Search steps" data-search></label>
  <div class="filters" role="group" aria-label="Show">
    <button type="button" data-filter="all" aria-pressed="true">All</button>
    <button type="button" data-filter="issues" aria-pressed="false">Failed or warned</button>
    ${products.length > 1 ? products.map(p => `<button type="button" data-filter="product:${esc(p)}" aria-pressed="false">${esc(p)}</button>`).join('\n    ') : ''}
  </div>
  <span class="shown" aria-live="polite"></span>
</div>
<ol class="steps">${stepItems}</ol>`
}
</section>
</main>
<footer>A snapshot of ${isAll ? `every Boomi Companion session the dashboard kept in ${esc(facts.folder ?? 'this folder')}` : 'a Boomi Companion session'}${facts.sessionId ? ` (Claude Code session ${esc(facts.sessionId)})` : ''}, made by boomi-dashboard${facts.version ? ` ${esc(facts.version)}` : ''} on ${esc(new Date(now).toISOString().replace('T', ' ').slice(0, 16))} UTC, styled to Boomi's Exosphere design system. Nothing in it is live, and it holds no credentials.</footer>
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
.hero{background:var(--exo-color-background-brand);color:var(--exo-color-font-inverse);position:relative;overflow:hidden}
.hero::after{content:"";position:absolute;right:-6rem;top:-8rem;width:26rem;height:26rem;border-radius:50%;background:radial-gradient(closest-side,var(--cat-1),transparent);opacity:.35;pointer-events:none}
.hero-inner{position:relative;z-index:1;max-width:1180px;margin:0 auto;padding:var(--exo-spacing-large) var(--exo-spacing-large) var(--exo-spacing-x-large)}
.hero-top{display:flex;justify-content:space-between;align-items:center;gap:var(--exo-spacing-standard);flex-wrap:wrap}
.eyebrow{margin:0;font:600 .75rem/1.5 var(--exo-font-family);letter-spacing:.12em;text-transform:uppercase;opacity:.9}.eyebrow .mark{color:var(--cat-6)}.eyebrow .sep{opacity:.6;margin:0 .25em}
.hero h1{font:400 clamp(1.75rem,4vw,2.75rem)/1.15 var(--exo-font-brand);margin:var(--exo-spacing-standard) 0 var(--exo-spacing-standard);overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;margin:0;padding:0}
.chips li{border:1px solid color-mix(in srgb,var(--exo-color-font-inverse) 35%,transparent);background:color-mix(in srgb,var(--exo-color-font-inverse) 8%,transparent);border-radius:1.5625rem;padding:.2rem .75rem;font-size:.813rem;font-variant-numeric:tabular-nums;white-space:nowrap}
.chip-label{opacity:.75;margin-right:.25em}
.spectrum{display:flex;height:4px}.spectrum span{flex:1}.spectrum .s1{background:var(--cat-1)}.spectrum .s2{background:var(--cat-2)}.spectrum .s3{background:var(--cat-3)}.spectrum .s4{background:var(--cat-4)}.spectrum .s5{background:var(--cat-5)}.spectrum .s6{background:var(--cat-6)}
main{max-width:1180px;overflow-wrap:break-word;margin:0 auto;padding:var(--exo-spacing-large)}
h1,h2,h3{font-family:var(--exo-font-brand);font-weight:400;line-height:1.25;margin:0}
h1{font-size:1.75rem}h2{font-size:1.25rem;margin-bottom:var(--exo-spacing-small)}h3{font-size:1rem}
.muted,.note,.hint,.aside,.sub,footer,.count{color:var(--exo-color-font-secondary)}
.card{background:var(--exo-color-background);border:1px solid var(--exo-color-border-secondary);border-radius:var(--exo-radius-standard);box-shadow:0 0 .3125rem 0 var(--exo-color-shadow-moderate);padding:var(--exo-spacing-standard) var(--exo-spacing-large);margin-bottom:var(--exo-spacing-standard)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:var(--exo-spacing-standard);margin-bottom:var(--exo-spacing-standard)}
.tile{margin:0}.tile .label{font-weight:600;color:var(--exo-color-font-secondary)}.tile .value{font:400 2rem/1.25 var(--exo-font-brand);font-variant-numeric:tabular-nums;margin:.25rem 0}
.status .icon{white-space:nowrap}.status .icon,.badge .icon{font-weight:700;margin-right:.35em}
.status-healthy .icon{color:var(--exo-color-background-success-strong)}.status-warning .icon{color:var(--exo-color-background-warning-strong)}.status-serious .icon{color:var(--exo-color-background-highlight)}.status-critical .icon{color:var(--exo-color-background-danger-strong)}
.badge{display:inline-block;border-radius:var(--exo-radius-standard);padding:0 .5rem;margin:0 .35rem .3rem 0;font-size:.813rem;line-height:1.6rem;border:1px solid transparent}
.badge-healthy{background:var(--exo-color-background-success)}.badge-healthy .icon{color:var(--exo-color-background-success-strong)}
.badge-warning{background:var(--exo-color-background-warning)}.badge-warning .icon{color:var(--exo-color-background-warning-strong)}
.badge-serious{background:var(--exo-color-background-secondary);border-color:var(--exo-color-background-highlight)}.badge-serious .icon{color:var(--exo-color-background-highlight)}
.badge-critical{background:var(--exo-color-background-danger-weak)}.badge-critical .icon{color:var(--exo-color-background-danger-strong)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
ol.attention{list-style:none;padding:0;margin:0}
.alert{border-left:4px solid var(--exo-color-border);background:var(--exo-color-background-secondary);border-radius:var(--exo-radius-standard);padding:.5rem .75rem;margin-bottom:.5rem}
.alert-warning{border-left-color:var(--exo-color-background-warning-strong);background:var(--exo-color-background-warning)}.alert-critical{border-left-color:var(--exo-color-background-danger-strong);background:var(--exo-color-background-danger-weak)}.alert-serious{border-left-color:var(--exo-color-background-highlight)}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:var(--exo-spacing-standard);margin-bottom:var(--exo-spacing-standard)}
.chart{margin:0}figcaption{display:flex;flex-wrap:wrap;align-items:baseline;gap:.5rem;margin-bottom:.5rem}
svg{display:block;width:100%;height:auto;overflow:visible}
svg text{font:12px var(--exo-font-family);fill:var(--exo-color-font)}svg .axis{fill:var(--exo-color-font-secondary)}svg .value{font-weight:600}
svg .baseline{stroke:var(--exo-color-border);stroke-width:1}svg .grid{stroke:var(--exo-color-border-secondary);stroke-dasharray:2 3}
.fill-healthy{fill:var(--exo-color-background-success-strong);background:var(--exo-color-background-success-strong)}.fill-warning{fill:var(--exo-color-background-warning-strong);background:var(--exo-color-background-warning-strong)}
.fill-serious{fill:var(--exo-color-background-highlight);background:var(--exo-color-background-highlight)}.fill-critical{fill:var(--exo-color-background-danger-strong);background:var(--exo-color-background-danger-strong)}
.fill-healthy-ink{color:var(--exo-color-background-success-strong)}.fill-warning-ink{color:var(--exo-color-background-warning-strong)}.fill-serious-ink{color:var(--exo-color-background-highlight)}.fill-critical-ink{color:var(--exo-color-background-danger-strong)}
.cat-1{fill:var(--cat-1)}.cat-2{fill:var(--cat-2)}.cat-3{fill:var(--cat-3)}.cat-4{fill:var(--cat-4)}.cat-5{fill:var(--cat-5)}.cat-6{fill:var(--cat-6)}.seq{fill:var(--seq)}
svg .line{fill:none;stroke:var(--cat-1);stroke-width:2;stroke-linejoin:round}svg .area{fill:var(--cat-1);opacity:.12}
svg .dot{fill:var(--exo-color-background);stroke:var(--cat-1);stroke-width:2}
svg .target{fill:transparent}svg .hit{cursor:default;outline:none}svg .hit[role="button"]{cursor:pointer}
svg .hit:hover .target,svg .hit:focus-visible .target{fill:var(--exo-color-font);opacity:.05}svg .hit:hover .dot,svg .hit:focus-visible .dot{fill:var(--cat-1)}
.legend{display:flex;flex-wrap:wrap;gap:.25rem 1rem;list-style:none;padding:0;margin:0 0 .5rem;font-size:.813rem}
.legend li{display:flex;align-items:center;gap:.3rem}.legend .swatch{width:.75rem;height:.75rem;border-radius:2px;display:inline-block}.legend .icon{font-weight:700}
details.data{margin-top:.5rem;font-size:.813rem;overflow-x:auto}details.data summary{cursor:pointer;color:var(--exo-color-font-link);font-weight:600}
.scroll{overflow-x:auto;position:relative}.card{position:relative}.scroll table{min-width:560px}.scroll table.wide{min-width:1040px}thead th{white-space:nowrap}
td.id code{overflow-wrap:anywhere}td .sub,th .sub{font-weight:400;font-size:.813rem;color:var(--exo-color-font-secondary)}
a{color:var(--exo-color-font-link)}dl.facts{margin:0}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:.5rem .75rem;border-bottom:1px solid var(--exo-color-border-secondary);vertical-align:top}
thead th{background:var(--exo-color-background-secondary)}tbody th{font-weight:600}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
thead button{all:unset;cursor:pointer;font-weight:600;font-size:.813rem;color:var(--exo-color-font)}
thead button:hover{color:var(--exo-color-font-link);text-decoration:underline}
thead button[data-dir="asc"]::after{content:" ▲"}thead button[data-dir="desc"]::after{content:" ▼"}
button{font:inherit}
.theme button{background:transparent;color:var(--exo-color-font-inverse);border:1px solid var(--exo-color-font-inverse);border-radius:var(--exo-radius-x-large,1.5625rem);padding:.25rem .875rem;cursor:pointer;font-weight:600}
.theme button[aria-pressed="true"]{background:var(--exo-color-font-inverse);color:var(--exo-color-background-brand)}
.filters button{background:var(--exo-color-background);color:var(--exo-color-font);border:1px solid var(--exo-color-border);border-radius:1.5625rem;padding:.25rem .875rem;cursor:pointer;font-weight:600}
.filters button[aria-pressed="true"]{background:var(--exo-color-background-selected);border-color:var(--exo-color-background-selected);color:var(--exo-color-font-inverse)}
:focus-visible{outline:2px solid var(--exo-color-background-selected);outline-offset:2px}
.controls{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;margin-bottom:.75rem}
.filters{display:flex;flex-wrap:wrap;gap:.5rem}
.search input{background:var(--exo-color-background);color:var(--exo-color-font);border:1px solid var(--exo-color-border);border-radius:var(--exo-radius-standard);padding:.4rem .75rem;min-width:240px;font:inherit}
ol.steps{list-style:none;padding:0;margin:0}
ol.steps li{border-bottom:1px solid var(--exo-color-border-secondary)}
ol.steps summary{cursor:pointer;padding:.5rem .25rem}
ol.steps time{font-variant-numeric:tabular-nums;color:var(--exo-color-font-secondary);margin-right:.5em}
.tag{font-size:.75rem;font-weight:600;border-radius:var(--exo-radius-standard);padding:0 .45rem;margin-left:.4em;border:1px solid var(--exo-color-border);border-left-width:4px}
.tag-1{border-left-color:var(--cat-1)}.tag-2{border-left-color:var(--cat-2)}.tag-3{border-left-color:var(--cat-3)}.tag-4{border-left-color:var(--cat-4)}.tag-5{border-left-color:var(--cat-5)}.tag-6{border-left-color:var(--cat-6)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.125rem .75rem;margin:.125rem 0 .75rem 1.75rem}dt{color:var(--exo-color-font-secondary)}dd{margin:0;overflow-wrap:anywhere}
code{font:.813rem var(--exo-font-monospace)}
ul.plain{list-style:none;padding:0;margin:0}ul.plain li{margin:.25rem 0}ul.plain li.sub{margin-left:1.4em;color:var(--exo-color-font-secondary)}
.tooltip{position:fixed;z-index:10;pointer-events:none;max-width:320px;background:var(--exo-color-font);color:var(--exo-color-background);border-radius:var(--exo-radius-standard);padding:.35rem .6rem;font-size:.813rem;box-shadow:0 0 1rem 0 var(--exo-color-shadow-moderate)}
footer{max-width:1180px;margin:0 auto;padding:var(--exo-spacing-standard) var(--exo-spacing-large) var(--exo-spacing-x-large);font-size:.813rem}
@media (max-width:640px){main,footer,.hero-inner{padding-left:1rem;padding-right:1rem}.chips li{white-space:normal}.card{padding:.75rem 1rem}.search input{min-width:0;width:100%}.tile .value{font-size:1.5rem}}
@media print{.theme,.controls,details.data{display:none}.card{box-shadow:none}}
@media (forced-colors:active){.badge,.alert{border:1px solid CanvasText}}
`

/** The theme, sorting, the chart tooltip and the steps' filter and search: no libraries, nothing sent anywhere. */
const SCRIPT = `
(function(){
  var root=document.documentElement;
  function pick(t){root.classList.remove('ex-theme-light','ex-theme-dark');root.classList.add('ex-theme-'+t);
    document.querySelectorAll('[data-theme-pick]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-theme-pick')===t))});
    try{localStorage.setItem('bc-report-theme',t)}catch(e){}}
  var saved=null;try{saved=localStorage.getItem('bc-report-theme')}catch(e){}
  pick(saved||(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
  document.querySelectorAll('[data-theme-pick]').forEach(function(b){b.addEventListener('click',function(){pick(b.getAttribute('data-theme-pick'))})});
  var days=document.body.hasAttribute('data-days');
  document.querySelectorAll('time[datetime]').forEach(function(t){var d=new Date(t.getAttribute('datetime'));if(!isNaN(d))t.textContent=days?d.toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})});
  document.querySelectorAll('table.sortable').forEach(function(table){
    table.querySelectorAll('thead button').forEach(function(btn){btn.addEventListener('click',function(){
      var col=+btn.getAttribute('data-col'),dir=btn.getAttribute('data-dir')==='asc'?'desc':'asc';
      table.querySelectorAll('thead button').forEach(function(b){b.removeAttribute('data-dir')});btn.setAttribute('data-dir',dir);
      var body=table.tBodies[0],rows=Array.prototype.slice.call(body.rows);
      rows.sort(function(a,b){var x=a.cells[col],y=b.cells[col],nx=x.getAttribute('data-sort'),ny=y.getAttribute('data-sort');
        var c=nx!==null&&ny!==null?(+nx)-(+ny):x.textContent.localeCompare(y.textContent);return dir==='asc'?c:-c});
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
  var list=document.querySelector('ol.steps');if(!list)return;
  var items=Array.prototype.slice.call(list.children),filter='all',search=document.querySelector('[data-search]'),shown=document.querySelector('.shown');
  function apply(){var q=(search.value||'').toLowerCase(),n=0;items.forEach(function(li){
    var lv=li.getAttribute('data-level'),pr='product:'+li.getAttribute('data-product');
    var ok=(filter==='all'||(filter==='issues'&&lv!=='healthy')||filter===pr)&&(!q||li.textContent.toLowerCase().indexOf(q)>=0);
    li.hidden=!ok;if(ok)n++});shown.textContent=n===items.length?'':n+' of '+items.length+' shown'}
  function setFilter(f){filter=f;var any=false;document.querySelectorAll('[data-filter]').forEach(function(x){var on=x.getAttribute('data-filter')===f;any=any||on;x.setAttribute('aria-pressed',String(on))});
    if(!any)document.querySelectorAll('[data-filter]').forEach(function(x){x.setAttribute('aria-pressed',String(false))});apply()}
  document.querySelectorAll('[data-filter]').forEach(function(b){b.addEventListener('click',function(){setFilter(b.getAttribute('data-filter'))})});
  document.querySelectorAll('[data-pick]').forEach(function(g){function go(){setFilter(g.getAttribute('data-pick'));document.getElementById('steps').scrollIntoView({behavior:'smooth'})}
    g.addEventListener('click',go);g.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}})});
  search.addEventListener('input',apply);
})();
`
