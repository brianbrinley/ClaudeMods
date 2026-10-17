// /bc-dashboard config: the dashboard's settings as a guided walk, a group at a
// time, each setting a question with its current value first, two likely
// values (the budget's taken from what past sessions really cost) and a way
// back to the menu; "Other" takes a typed value. Plain functions: nothing here
// touches the engine.

import type { PastSession } from '../types'

export type Value = boolean | number | string

type Unit = 'usd' | 'percent' | 'hours' | 'days' | 'seconds' | 'rows' | 'columns'

export type Field = {
  /** The `userConfig` field, as plugin.json names it. */
  key: string
  label: string
  /** One sentence: what it does. */
  about: string
  kind: 'boolean' | 'number' | 'choice' | 'text'
  default: Value
  unit?: Unit
  /** For a choice, its values; for a number, the values worth offering. */
  options?: readonly string[]
  presets?: readonly number[]
  /** What 0 means, for a number where it turns the thing off or leaves it to Claude Code. */
  zero?: string
  /** Read once as the session starts: a change takes effect in the next one. */
  isNextSession?: boolean
  max?: number
  isWhole?: boolean
}

export type Group = { name: string; header: string; fields: readonly Field[] }

export const GROUPS: readonly Group[] = [
  {
    name: 'Budget',
    header: 'Budget',
    fields: [
      { key: 'budgetUsd', label: 'Session budget', about: 'The status line and pane warn at 80% of it and when it is spent.', kind: 'number', unit: 'usd', default: 0, zero: 'off' },
      { key: 'companionMonthlyUsd', label: 'Monthly amount for Companion', about: 'What Companion sessions may cost in a calendar month, by Claude Code’s own cost figures; warns at 80% and when it is reached.', kind: 'number', unit: 'usd', default: 0, zero: 'off' },
      { key: 'companionShare', label: 'Companion’s share of your usage limit', about: 'How much of your weekly Claude usage limit Companion work may use; warns at 80% and when it is used. Needs a Claude login that reports a weekly limit.', kind: 'number', unit: 'percent', default: 0, zero: 'off', presets: [25, 50, 75], max: 100 },
      { key: 'companionSharePeriod', label: 'Period for the share', about: 'What the share runs over: today, the last 7 days, or this calendar month.', kind: 'choice', options: ['day', 'week', 'month'], default: 'week' },
      { key: 'seatBudgetUsd', label: 'Your Claude budget', about: 'Only for a login whose usage Claude Code reports as a spend limit, in percent: the BUDGET gauge shows it in dollars. Where the account reports its monthly budget in dollars (most do), that is used and this is not needed.', kind: 'number', unit: 'usd', default: 0, zero: 'off' },
      { key: 'budgetEnforce', label: 'When a budget is spent', about: 'Warn only warns. Confirm asks you before each Companion change (create, push, deploy, test and the like); block refuses them. Reads are never stopped, and a change already running finishes.', kind: 'choice', options: ['warn', 'confirm', 'block'], default: 'warn' },
      { key: 'budgetGrace', label: 'Grace past a budget', about: 'How far past a budget, in percent, before confirm or block starts.', kind: 'number', unit: 'percent', default: 0, zero: 'none, at 100%', presets: [5, 10, 20], max: 100 },
    ],
  },
  {
    name: 'Pane and banner',
    header: 'Pane',
    fields: [
      { key: 'paneTheme', label: 'Theme', about: 'Auto is Exosphere, Boomi’s design system, in your system’s light or dark. Exosphere and Whimsical (the Art Deco look with the flamingo) each have a light and a dark; Terminal takes your terminal’s theme.', kind: 'choice', options: ['auto', 'exosphere-light', 'exosphere-dark', 'whimsical-light', 'whimsical-dark', 'terminal'], default: 'auto' },
      { key: 'paneRows', label: 'Pane height', about: 'How many rows the pane asks for above the prompt. A size you drag it to, or set with /bc-dashboard size, wins.', kind: 'number', unit: 'rows', default: 0, zero: 'Claude Code decides', presets: [12, 20, 30], isWhole: true },
      { key: 'paneColumns', label: 'Pane width', about: 'How many columns the pane asks for when docked beside a fullscreen transcript. A width you drag it to wins.', kind: 'number', unit: 'columns', default: 0, zero: 'Claude Code decides', presets: [60, 80, 100], isWhole: true },
      { key: 'banner', label: 'Banner above the prompt', about: 'The latest Companion step and what needs attention; at the start of a session, the last session’s recap and tips.', kind: 'boolean', default: true },
      { key: 'logo', label: 'Logo', about: 'The mark in the pane and banner: the Boomi logo in Exosphere (where the terminal draws pictures), the flamingo in Whimsical.', kind: 'boolean', default: true },
      { key: 'bandAnimation', label: 'Animate the banner flamingo', about: 'A sparkle in the flamingo’s place for a second in every five. Only in the Whimsical themes.', kind: 'boolean', default: true, isNextSession: true },
      { key: 'handoffNudge', label: 'Suggest /handoff on the way out', about: 'The first /exit, /quit or /clear of a session that did work suggests /handoff first, which saves a summary for the next session; typing the command again goes through.', kind: 'boolean', default: true },
      { key: 'toasts', label: 'Toasts', about: 'A pop-up when a step fails, a deploy or test finishes, or a watched component changes.', kind: 'boolean', default: true },
      { key: 'suggestions', label: 'Suggest the next step', about: 'With a component saved but not deployed, or deployed but not tested, offer that step in the prompt box (Tab takes it).', kind: 'boolean', default: true },
      { key: 'promptCheck', label: 'Prompt tips', about: 'Check each Boomi prompt for what it leaves out and suggest an upgrade. Confirm holds a flagged prompt until you send it or the upgrade; suggest shows tips and sends it. A password or token in a prompt always asks unless this is off.', kind: 'choice', options: ['off', 'suggest', 'confirm'], default: 'confirm' },
      { key: 'promptView', label: 'Prompt tab', about: 'Auto opens the Prompt tab beside the pane when a prompt gets tips; manual only from /bc-dashboard prompt or the pane’s Prompt tab button; off never.', kind: 'choice', options: ['auto', 'manual', 'off'], default: 'auto' },
      { key: 'promptRewrite', label: 'Rewrite prompts automatically', about: 'Auto has the prompt model polish a prompt that gets tips, in the background, right after the checks; it costs a few cents at most per prompt. Manual rewrites only when you press Upgrade with a model or run /bc-dashboard prompt upgrade.', kind: 'choice', options: ['auto', 'manual'], default: 'auto' },
      { key: 'promptModel', label: 'Prompt rewrite model', about: 'The model that rewrites a prompt: automatically after the checks, or when you ask.', kind: 'text', default: 'haiku' },
      { key: 'promptSkip', label: 'Prompt checks to skip', about: 'Checks to leave out, separated by commas: subject, environment, test, production, steps, error, build, map, secret, aim.', kind: 'text', default: '' },
    ],
  },
  {
    name: 'Data and reports',
    header: 'Data',
    fields: [
      { key: 'recentHours', label: 'Window for earlier steps', about: 'How far back earlier sessions’ steps and Companion’s activity log count.', kind: 'number', unit: 'hours', default: 24, presets: [12, 24, 48, 72] },
      { key: 'historyDays', label: 'Past sessions window', about: 'How far back history, review and the all-sessions report read Claude Code’s transcripts.', kind: 'number', unit: 'days', default: 90, presets: [30, 90, 180], isWhole: true },
      { key: 'pollSeconds', label: 'Checking watched components', about: 'How often the dashboard checks watched components in Boomi.', kind: 'number', unit: 'seconds', default: 60, zero: 'off', presets: [30, 60, 300], isNextSession: true },
      { key: 'reportStyle', label: 'HTML report style', about: 'Exosphere is Boomi\u2019s design system, for anything Boomi people read; expressive is the Valence theme, Miami Deco.', kind: 'choice', options: ['exosphere', 'expressive'], default: 'exosphere' },
      { key: 'reportOpen', label: 'Open the HTML report', about: 'Open /bc-dashboard report html’s page in your browser once it is saved.', kind: 'boolean', default: true },
      { key: 'usageBreakdown', label: 'Read Claude Code’s usage breakdown', about: 'Every 15 minutes, run claude -p "/usage" (no model call, no session kept) for Companion’s share of all your usage on this machine.', kind: 'boolean', default: true, isNextSession: true },
      { key: 'activityLog', label: 'Read Companion’s activity log', about: 'Also read .activity-log/activity.jsonl for script runs Claude’s tool calls didn’t show.', kind: 'boolean', default: true, isNextSession: true },
      { key: 'updateCheck', label: 'Check for updates', about: 'At the start of a session, say when a newer dashboard is out. It never installs.', kind: 'boolean', default: true, isNextSession: true },
      { key: 'updateCheckHours', label: 'Time between update checks', about: 'How long the dashboard waits between update checks.', kind: 'number', unit: 'hours', default: 24, zero: 'off', presets: [24, 168], isNextSession: true },
      { key: 'envFile', label: 'Companion’s .env file', about: 'Where the dashboard reads the Platform API credentials, relative to the session’s folder.', kind: 'text', default: '.env' },
      { key: 'componentsDir', label: 'Components folder', about: 'Where Companion keeps component XML; edits under it show as edited components.', kind: 'text', default: 'active-development' },
    ],
  },
]

export const FIELDS: readonly Field[] = GROUPS.flatMap(g => g.fields)

export const PLUGIN = 'boomi-dashboard'
export const configKey = (field: Field) => `${PLUGIN}.${field.key}`

/** A field by its name, as plugin.json or the menu spells it, in any case. */
export const fieldNamed = (name: string): Field | undefined => {
  const wanted = name.trim().toLowerCase().replace(/^boomi-dashboard\./, '')
  return FIELDS.find(f => f.key.toLowerCase() === wanted)
}

/** A group by a word of its name: `budget`, `pane`, `data`. */
export const groupNamed = (name: string): Group | undefined => {
  const wanted = name.trim().toLowerCase()
  return wanted ? GROUPS.find(g => g.name.toLowerCase() === wanted || g.header.toLowerCase() === wanted || g.name.toLowerCase().startsWith(wanted)) : undefined
}

/**
 * `/bc-dashboard config budget warn`: a group with a value would start the
 * walk and lose the value. Says so, and which of the group's settings takes it.
 */
export const groupWithValue = (group: Group, text: string): string => {
  const fits = group.fields.filter(f => f.kind !== 'text' && !('error' in parseValue(f, text))).slice(0, 3)
  const meant = fits.length > 0 ? ` Did you mean ${fits.map(f => `/bc-dashboard config ${f.key} ${text}`).join(' or ')}?` : ''
  return `${group.header} is a group of settings, so "${text}" wasn't saved.${meant} Run /bc-dashboard config ${group.name.toLowerCase()} on its own to go through the group a question at a time.`
}

const money = (usd: number) => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(0)}`

/** A value as a person reads it: "$5.00", "off", "24 hours", "on". */
export const show = (field: Field, value: Value): string => {
  if (field.kind === 'boolean') return value ? 'on' : 'off'
  if (field.kind !== 'number') return String(value)
  const n = Number(value)
  if (n === 0 && field.zero) return field.zero
  switch (field.unit) {
    case 'usd':
      return money(n)
    case 'percent':
      return `${n}%`
    case 'hours':
      return n === 168 ? '1 week' : `${n} hour${n === 1 ? '' : 's'}`
    case 'days':
      return `${n} day${n === 1 ? '' : 's'}`
    case 'seconds':
      return n >= 60 && n % 60 === 0 ? `${n / 60} minute${n === 60 ? '' : 's'}` : `${n} seconds`
    default:
      return `${n} ${field.unit ?? ''}`.trim()
  }
}

/** Rounded up to a figure a person would pick: 25 cents under $1, 50 under $10, $5 under $100. */
export const roundUp = (usd: number): number => {
  const step = usd < 1 ? 0.25 : usd < 10 ? 0.5 : usd < 100 ? 5 : 10
  return Math.max(step, Math.ceil((usd - 1e-9) / step) * step)
}

/** What Companion sessions on this machine have cost: a typical one, the costliest, and the last 30 days. */
export type PastSpend = { sessions: number; typical?: number; most?: number; last30?: number }

export const pastSpend = (sessions: readonly PastSession[] | undefined, now: number): PastSpend => {
  const costs = (sessions ?? []).map(s => s.costUsd).filter((c): c is number => typeof c === 'number' && c > 0).sort((a, b) => a - b)
  if (costs.length === 0) return { sessions: 0 }
  const since = now - 30 * 86_400_000
  const last30 = (sessions ?? []).filter(s => s.startedAt && Date.parse(s.startedAt) >= since).reduce((sum, s) => sum + (s.costUsd ?? 0), 0)
  return { sessions: costs.length, typical: costs[Math.floor((costs.length - 1) / 2)], most: costs[costs.length - 1], ...(last30 > 0 ? { last30 } : {}) }
}

/** What past sessions cost, in a sentence for the budget questions. */
const spendNote = (field: Field, spend: PastSpend): string => {
  if (field.key === 'budgetUsd' && spend.typical !== undefined)
    return ` Your ${spend.sessions} Companion session${spend.sessions === 1 ? '' : 's'} on this machine cost ${money(spend.typical)} typically, ${money(spend.most!)} at most.`
  if (field.key === 'companionMonthlyUsd' && spend.last30 !== undefined) return ` Companion cost ${money(spend.last30)} over the last 30 days.`
  return ''
}

type Choice = { label: string; value: Value }

/** Two values worth offering besides the current one; for a budget, from real spend. */
const offers = (field: Field, current: Value, spend: PastSpend): Choice[] => {
  const n = Number(current)
  const out: Choice[] = []
  const add = (value: number, why?: string) => {
    if (value !== n && !out.some(c => c.value === value)) out.push({ label: why ? `${show(field, value)} (${why})` : show(field, value), value })
  }
  if (field.key === 'budgetUsd') {
    if (spend.typical !== undefined) {
      add(roundUp(spend.typical * 2), 'twice a typical session')
      add(roundUp(spend.most!), 'your costliest session')
    }
    for (const v of [5, 10]) add(v)
  } else if (field.key === 'companionMonthlyUsd') {
    if (spend.last30 !== undefined) {
      add(roundUp(spend.last30 * 1.25), 'a quarter above the last 30 days')
      add(roundUp(spend.last30 * 2), 'twice the last 30 days')
    }
    for (const v of [50, 100]) add(v)
  } else {
    for (const v of field.presets ?? []) add(v)
  }
  const picks = out.slice(0, 2)
  // A setting that's on can be turned off in one pick.
  if (field.zero && n !== 0) picks[1] = { label: field.zero === 'off' ? 'Off' : field.zero[0]!.toUpperCase() + field.zero.slice(1), value: 0 }
  return picks.filter(Boolean)
}

export const BACK = 'Back to the menu'

/** One question of the walk: its words, its options (2-4) and what each answer means. */
export type Question = { question: string; header: string; options: string[]; answer: (text: string) => Answer }
export type Answer = { kind: 'keep' } | { kind: 'back' } | { kind: 'set'; value: Value } | { kind: 'unreadable'; text: string }

/** Reads a typed value for a field, or says why it can't. */
export const parseValue = (field: Field, text: string): { value: Value } | { error: string } => {
  const t = text.trim()
  if (field.kind === 'boolean') {
    if (/^(on|yes|true|y|1)$/i.test(t)) return { value: true }
    if (/^(off|no|false|n|0)$/i.test(t)) return { value: false }
    return { error: `${field.label} takes on or off` }
  }
  if (field.kind === 'choice') {
    const v = field.options?.find(o => o.toLowerCase() === t.toLowerCase())
    return v ? { value: v } : { error: `${field.label} takes ${field.options!.join(', ')}` }
  }
  if (field.kind === 'text') {
    if (!t || /[\r\n]/.test(t)) return { error: `${field.label} takes a path` }
    return { value: t }
  }
  if (/^(off|none|no)$/i.test(t) && field.zero) return { value: 0 }
  const n = Number(t.replace(/^\$|\s*(%|usd|dollars?|hours?|h|days?|d|seconds?|s|rows?|columns?)$/gi, '').replace(/,/g, ''))
  if (!Number.isFinite(n) || n < 0 || t === '') return { error: `${field.label} takes a number${field.zero ? ` (0 for ${field.zero})` : ''}` }
  if (field.max !== undefined && n > field.max) return { error: `${field.label} goes up to ${field.max}` }
  if (field.zero === undefined && n === 0) return { error: `${field.label} can't be 0` }
  return { value: field.isWhole ? Math.round(n) : Math.round(n * 100) / 100 }
}

/** The question for one setting: keep it first, two likely changes, then back to the menu. */
export const questionFor = (field: Field, current: Value, spend: PastSpend, place: { index: number; of: number; group: Group }): Question => {
  const keep = `Keep ${show(field, current)}`
  let changes: Choice[]
  if (field.kind === 'boolean') changes = [{ label: current ? 'Turn off' : 'Turn on', value: !current }]
  else if (field.kind === 'choice') changes = (field.options ?? []).filter(o => o !== current).slice(0, 2).map(o => ({ label: o[0]!.toUpperCase() + o.slice(1), value: o }))
  else if (field.kind === 'text') changes = current !== field.default ? [{ label: `Back to ${field.default}`, value: field.default }] : []
  else changes = offers(field, current, spend)
  const typed = field.kind === 'boolean' ? '' : field.kind === 'text' ? ' Or type one under Other.' : field.kind === 'choice' ? '' : ' Or type a number under Other.'
  const question = `${field.label}: ${field.about}${spendNote(field, spend)} Now ${show(field, current)}.${field.isNextSession ? ' A change takes effect in your next session.' : ''}${typed}`
  const options = [keep, ...changes.map(c => c.label), BACK]
  return {
    question,
    header: `${place.group.header} ${place.index}/${place.of}`.slice(0, 12),
    options,
    answer: text => {
      if (text === keep) return { kind: 'keep' }
      if (text === BACK) return { kind: 'back' }
      const picked = changes.find(c => c.label === text)
      if (picked) return { kind: 'set', value: picked.value }
      const typedValue = parseValue(field, text)
      return 'value' in typedValue ? (typedValue.value === current ? { kind: 'keep' } : { kind: 'set', value: typedValue.value }) : { kind: 'unreadable', text }
    },
  }
}

export const DONE = 'Done'

/** The menu: each group with what's set in it now, and Done. */
export const menuQuestion = (values: Readonly<Record<string, Value>>, changed: number): { question: string; options: string[] } => {
  const budget = GROUPS[0]!.fields.filter(f => f.kind === 'number' && Number(values[f.key]) > 0).map(f => `${f.label.toLowerCase()} ${show(f, values[f.key]!)}`)
  const now = budget.length ? `Budgets now: ${budget.join(', ')}.` : 'No budget is set.'
  return {
    question: `Which dashboard settings do you want to go through? ${now}${changed ? ` ${changed} change${changed === 1 ? '' : 's'} so far, saved when you pick Done.` : ''}`,
    options: [...GROUPS.map(g => g.name), DONE],
  }
}

/** Every setting and its value, for where the menu can't ask (a -p run), with how to change one. */
export const listing = (values: Readonly<Record<string, Value>>): string => {
  const lines = GROUPS.flatMap(g => [
    `${g.name}:`,
    ...g.fields.map(f => `  ${f.key.padEnd(22)}${show(f, values[f.key] ?? f.default)}${values[f.key] !== undefined && values[f.key] !== f.default ? '' : '  (default)'}`),
  ])
  return [...lines, '', 'Change one with /bc-dashboard config <setting> <value>, for example /bc-dashboard config budgetUsd 5, or walk through them with /bc-dashboard config.'].join('\n')
}

/** A field's value from a `/config` row's, or its default when the row holds nothing it can read. */
export const valueOf = (field: Field, raw: unknown): Value => {
  if (field.kind === 'boolean') return typeof raw === 'boolean' ? raw : field.default
  if (field.kind === 'number') return typeof raw === 'number' && Number.isFinite(raw) ? raw : typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : field.default
  if (field.kind === 'choice') return typeof raw === 'string' && field.options?.includes(raw) ? raw : field.default
  return typeof raw === 'string' && raw.trim() ? raw : field.default
}

/** What a saved change says: "Session budget: off → $5.00", with when it applies. */
export const changeLine = (field: Field, from: Value, to: Value): string =>
  `${field.label}: ${show(field, from)} → ${show(field, to)}${field.isNextSession ? ' (from your next session)' : ''}`
