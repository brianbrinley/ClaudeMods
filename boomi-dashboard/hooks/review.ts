// A past Companion session's cost review: what drove its cost, read from the
// figures the transcript scan keeps, each with a change that would make the
// same work cheaper next time, pointing at Claude Code's own commands. Plain
// functions: nothing here touches the engine.

import type { PastSession } from '../types'
import type { Level } from './activity'
import { formatCost, formatTokens, modelName, pastParts } from './activity'

/** One thing that drove a session's cost, and what to do about it next time. */
export type Finding = { level: Level; title: string; tip: string }

export type Review = {
  /** The session in a line: its cost, prompts, tokens and peak context. */
  summary: string
  findings: Finding[]
}

/** Reviews start counting a pattern only past these: below them it's the work itself. */
const BIG_MODEL_SHARE = 0.6
const REREAD_SHARE = 0.9
const MANY_PROMPTS = 20
const BIG_CONTEXT = 120_000
const SUBAGENT_SHARE = 0.4
const REPEATS = { test: 4, push: 5, deploy: 4 } as const

const percent = (part: number, whole: number) => Math.round((part / whole) * 100)

/**
 * What made a session cost what it did, and what to change next time. Each
 * finding is a pattern the figures show, never a guess at the transcript's
 * content; with none, the cost came from the work itself.
 */
export const reviewSession = (s: PastSession): Review => {
  const findings: Finding[] = []
  const total = s.tokens + s.cached

  // The biggest model doing most of the work.
  const byModel = Object.entries(s.modelTokens ?? {}).sort((a, b) => b[1] - a[1])
  const [topId, topTokens] = byModel[0] ?? ['', 0]
  if (s.tokens > 0 && /opus/i.test(topId) && topTokens / s.tokens >= BIG_MODEL_SHARE) {
    findings.push({
      level: 'warning',
      title: `${modelName(topId) ?? topId} did ${percent(topTokens, s.tokens)}% of the work`,
      tip: 'Routine Companion steps (pushes, deploys, tests) rarely need the largest model. Switch with /model for them, and back for design work.',
    })
  }

  // A long conversation re-read on every call.
  if (total > 0 && s.cached / total >= REREAD_SHARE && (s.prompts ?? 0) >= MANY_PROMPTS) {
    findings.push({
      level: 'warning',
      title: `${percent(s.cached, total)}% of its tokens were the conversation re-read, over ${s.prompts} prompts`,
      tip: 'Each call re-reads the whole conversation. Use /clear between unrelated tasks, or start a new session per component.',
    })
  }

  // A context that grew large.
  if ((s.peakContext ?? 0) >= BIG_CONTEXT) {
    findings.push({
      level: 'warning',
      title: `The conversation reached ${formatTokens(s.peakContext!)} tokens of context`,
      tip: 'Use /compact when a task is done, before the next one, and keep large files and logs out of the chat.',
    })
  }

  // A session that kept compacting.
  if ((s.compactions ?? 0) >= 1) {
    findings.push({
      level: s.compactions! >= 2 ? 'warning' : 'healthy',
      title: `It compacted ${s.compactions} time${s.compactions === 1 ? '' : 's'}`,
      tip: 'A session that fills its context is doing several jobs. Split it, one session per task.',
    })
  }

  // The same step over and over on one component.
  for (const r of s.repeats ?? []) {
    if (r.kind !== 'test' && r.kind !== 'push' && r.kind !== 'deploy') continue
    if (r.count < REPEATS[r.kind]) continue
    const verb = r.kind === 'test' ? 'tested' : r.kind === 'push' ? 'pushed' : 'deployed'
    findings.push({
      level: 'warning',
      title: `${r.name} was ${verb} ${r.count} times`,
      tip:
        r.kind === 'test'
          ? "Read why a test failed (the dashboard's Why?) before running it again: each rerun is a turn of Claude's."
          : r.kind === 'push'
            ? 'Make the edits a component needs, then push once.'
            : 'Deploy once the component is ready, rather than after each change.',
    })
  }

  // Subagents doing much of the work.
  if (s.tokens > 0 && (s.subagentTokens ?? 0) / s.tokens >= SUBAGENT_SHARE) {
    findings.push({
      level: 'warning',
      title: `Subagents used ${percent(s.subagentTokens!, s.tokens)}% of its new tokens`,
      tip: 'Each subagent starts from scratch. Give them narrow tasks, and do small lookups in the main session.',
    })
  }

  const summary = [
    formatCost(s.costUsd) ?? 'cost not recorded',
    s.prompts !== undefined ? `${s.prompts} prompt${s.prompts === 1 ? '' : 's'}` : undefined,
    `${formatTokens(s.tokens)} new tokens`,
    s.cached ? `${formatTokens(s.cached)} re-read` : undefined,
    s.peakContext ? `peak context ${formatTokens(s.peakContext)}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  return { summary, findings }
}

/** A review as text, for /bc-dashboard review: the session, then each finding with its tip. */
export const reviewText = (s: PastSession, view: { currentId?: string } = {}): string => {
  const { summary, findings } = reviewSession(s)
  const lines = [`${pastParts(s, view).head}`, `  ${summary}`, '']
  if (findings.length === 0) lines.push('✓ Nothing stands out: its cost came from the work itself.')
  for (const f of findings) lines.push(`${f.level === 'healthy' ? '✓' : '◐'} ${f.title}`, `    ${f.tip}`)
  if (s.file) lines.push('', 'For a closer look, ask Claude to read the transcript: Ask Claude to review in the pane drafts the request.')
  return lines.join('\n')
}

/**
 * The request Ask Claude to review puts in the prompt box: read the session's
 * transcript and say how to do the same work for less. The transcript is
 * large, so it asks for it read in parts. Nothing is sent until the person
 * presses Enter.
 */
export const reviewPrompt = (s: PastSession): string => {
  const { summary, findings } = reviewSession(s)
  return [
    `Review my earlier Claude Code session ${s.id} for what made it cost what it did, and how I could do the same work for less next time.`,
    `It was: ${summary}.`,
    s.file ? `Its transcript is ${s.file}: JSON lines, one event each. It's large, so read it in parts (grep, head, tail), not all at once.` : undefined,
    findings.length > 0 ? `The dashboard noticed:\n${findings.map(f => `- ${f.title}`).join('\n')}` : undefined,
    'Give me three to five concrete changes to how I work with Claude Code and Boomi Companion, each with what it would save. Changes to my habits, not to my integration code.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** A past session as a picker option for /bc-dashboard review: its number, cost, date and what it was about. */
export const reviewLabel = (s: PastSession, n: number): string => {
  const label = `${n}. ${pastParts(s).head}`
  return label.length > 48 ? `${label.slice(0, 47)}…` : label
}
