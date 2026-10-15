// Prompt tips: what a prompt in a Companion session leaves out for Boomi
// work, and a better prompt built from what the session already knows. Plain
// functions, with no model call: the tests call them directly.

import type { PromptCheckCode, PromptCounts, PromptTip, PromptTips } from '../types'
import { STATUS } from './activity'
import { mask } from './upgrade'

/** What the session knows that a prompt might lean on, from the dashboard's own steps. */
export type PromptFacts = {
  /** The component Claude worked on last this session. */
  component?: { name: string; type?: string; id?: string }
  /** Every component's name this session, so a prompt that names one counts as specific. */
  names: readonly string[]
  /** The environment Companion's .env points at. */
  environmentId?: string
  /** The latest failed test or step, with its execution ID when it has one. */
  failed?: { name: string; executionId?: string; detail: string }
}

/** The checks in the order their tips show. */
export const CHECKS: readonly PromptCheckCode[] = ['secret', 'production', 'subject', 'environment', 'error', 'test', 'build', 'map', 'steps', 'aim']

/** Checks that only nudge: a look around changes nothing in Boomi, so confirm doesn't hold a prompt for them alone. */
export const NUDGE_ONLY: ReadonlySet<PromptCheckCode> = new Set(['aim'])

const SHORT_REPLY =
  /^(y|yes|yep|yeah|no|nope|ok|okay|sure|go|go on|go ahead|keep going|continue|carry on|next|thanks|thank you|do it|looks good|lgtm|stop|done|great|perfect|please do)[.!]*$/i

/** Words that mark a prompt as Boomi work; a prompt with none of them gets no tips. */
const BOOMI =
  /\b(boomi|companion|process(es)?|components?|(un|re)?deploy\w*|(re-?)?test\w*|execut\w*|maps?|mapping|profiles?|connectors?|connections?|operations?|environments?|atoms?|runtimes?|listeners?|schedul\w*|integrations?|data ?hub|bdi|flows?|agents?|recipes?|push|pull)\b/i

/** Whether a prompt is worth checking: not a short reply ("yes", "keep going") and not one word. */
export const isCheckable = (text: string): boolean => {
  const trimmed = text.trim()
  if (!trimmed || SHORT_REPLY.test(trimmed)) return false
  return trimmed.split(/\s+/).length >= 2 && BOOMI.test(trimmed)
}

// --- Secrets ---------------------------------------------------------------------

const SECRETS: readonly { kind: string; find: RegExp; hide: (text: string) => string }[] = [
  { kind: 'an API key', find: /\b(sk-|glc_)[A-Za-z0-9_-]{8,}/, hide: t => t.replace(/\b(sk-|glc_)[A-Za-z0-9_-]{8,}/g, '$1****') },
  { kind: 'a JWT', find: /\beyJ[A-Za-z0-9._-]{10,}/, hide: t => t.replace(/\beyJ[A-Za-z0-9._-]{10,}/g, 'eyJ****') },
  { kind: 'an auth header', find: /\b(Bearer|Basic) [A-Za-z0-9+/=._~-]{8,}/, hide: t => t.replace(/\b(Bearer|Basic) [A-Za-z0-9+/=._~-]{8,}/g, '$1 ****') },
  {
    kind: 'a password or token',
    find: /\b(password|passwd|pwd|secret|token|api[_ -]?key|BOOMI_API_TOKEN)\s*[=:]\s*['"]?[^\s'"]{4,}/i,
    hide: t => t.replace(/\b(password|passwd|pwd|secret|token|api[_ -]?key|BOOMI_API_TOKEN)(\s*[=:]\s*['"]?)[^\s'"]{4,}/gi, '$1$2****'),
  },
  { kind: 'a private key', find: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, hide: t => t.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key]') },
  { kind: 'an AWS key', find: /\bAKIA[0-9A-Z]{16}\b/, hide: t => t.replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA****') },
]

/** What kinds of secret the text holds: "a password or token", "a JWT". */
export const findSecrets = (text: string): string[] => SECRETS.filter(s => s.find.test(text)).map(s => s.kind)

/** The text with anything shaped like a credential hidden: the dashboard's mask(), and passwords and keys typed inline. */
export const maskPrompt = (text: string): string => SECRETS.reduce((t, s) => s.hide(t), mask(text))

// --- The checks -------------------------------------------------------------------

const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
const QUOTED = /["“‘`'][^"”’`']{2,}["”’`']/
/** A name in title case after the first word: "deploy Orders Sync". */
const TITLED = /\s[A-Z][A-Za-z0-9]+(?: [A-Z][A-Za-z0-9]+)+/
/** "it", or "this" and "that" standing alone ("fix this", not "this error" or "a process that syncs"), or "the process". */
const VAGUE = /\bit\b|\b(this|that)\b(?=\s*([.,;!?]|$|(and|then|to|in|on|with|again|now|first)\b))|\bthe (process|component|map|flow|integration|connector|connection|profile|one)\b/i
/** Deploying as something to do: "deploy it", not "the deployed processes". */
const DEPLOY = /\b(re)?deploy(s|ing)?\b/i
const ENVIRONMENT = /\b(environments?|env|dev|development|qa|uat|stag\w*|sandbox|prod\w*)\b|\b(to|in|on|into) (the )?test\b/i
const TEST = /\b(re-?)?test(s|ing)?\b(?!\s+(fail\w*|run|result\w*|execution\w*|data))/i
const TEST_DATA = /\b(data|samples?|payloads?|files?|inputs?|documents?|records?|expect\w*|should|pass(es)?|results?)\b|\.(json|xml|csv|edi|txt)\b/i
const PRODUCTION = /\b(prod|production|live (system|data|environment|orders|customers)|real (orders|customers|customer data|data)|customer data)\b/i
/** Asking for a fix, not a look at what failed: a fix word, or something still failing or broken. */
const FAILING = /\b(fix\w*|broken|doesn'?t work|not working|wrong|(still|keeps?|is|are) fail\w*|throws? (an )?errors?|getting (an )?errors?)\b/i
const ERROR_GIVEN = /["“][^"”]{6,}["”]|error:|exception|execution-[0-9a-z]|\bexecution\b|\blogs?\b|\bsays\b|\bsaid\b|\bmessage\b|stack ?trace|HTTP \d{3}|status=|\d{3} error/i
const BUILD = /\b(build|create|make|set up)\b.*\b(process|integration|flow)\b/i
const ENDPOINTS =
  /\bfrom\b.+\bto\b|\b(salesforce|netsuite|sap|sftp|ftp|https?|rest|soap|database|db|s3|kafka|disk|mail|email|api|workday|dynamics|shopify|snowflake|servicenow|jira)\b/i
const TRIGGER = /\b(schedul\w*|every|daily|hourly|nightly|weekly|listen\w*|webhook|events?|real[- ]time|on demand|manual\w*|cron|trigger\w*)\b/i
const FORMAT = /\b(json|xml|csv|flat ?file|edi|x12|edifact|profiles?|database|db)\b/i
const MAP = /\b(a|the|this|new) map\b|\bmap (the|it|this|these|fields?)\b|\bmapping\b/i
const MAP_DETAIL = /\b(profiles?|fields?)\b|\bfrom\b.+\bto\b/i
/** A look around the account with nothing named to find: "check out my account", "explore the environment". */
const LOOK = /\b(check (out|on)|look (at|into|around)|explore|see what'?s|take a look|poke around|browse|show me what'?s|go through)\b/i
const WHERE = /\b(account|environments?|workspace|tenant|everything|stuff|what'?s there|what i have|boomi|companion)\b/i
const SPECIFIC = /\b(processe?s?|deploy\w*|executions?|fail\w*|errors?|runtimes?|atoms?|folders?|components?|connections?|maps?|profiles?|listeners?|schedules?|packages?|extensions?|logs?)\b/i
const STEPS: readonly RegExp[] = [/\b(build|create|make|add|write)\b/i, DEPLOY, TEST, /\bfix\b/i]

/** A component's type as a person says it: "process", "connection". */
const typeName = (type: string | undefined) =>
  !type ? 'component' : type === 'process' ? 'process' : type === 'connector-settings' ? 'connection' : type === 'connector-action' ? 'operation' : type.replace(/[.-]/g, ' ')

const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 8)}…` : id)

/** Whether the prompt names something specific: an ID, a quoted or title-case name, or a component of this session. */
const isNamed = (text: string, facts: PromptFacts) =>
  GUID.test(text) || QUOTED.test(text) || TITLED.test(text) || facts.names.some(n => n.length > 1 && text.toLowerCase().includes(n.toLowerCase()))

/**
 * The tips for a prompt: each thing Boomi work needs that it leaves out, with
 * the session's likely answer when the dashboard knows it. None for a prompt
 * that isn't Boomi work, or says it all.
 */
export const checkPrompt = (text: string, facts: PromptFacts, skip: ReadonlySet<string> = new Set()): PromptTip[] => {
  const tips: PromptTip[] = []
  const add = (code: PromptCheckCode, level: PromptTip['level'], line: string) => {
    if (!skip.has(code)) tips.push({ code, level, text: line })
  }
  const secrets = findSecrets(text)
  if (secrets.length > 0) add('secret', 'serious', `secret: ${secrets.join(' and ')} in the prompt; it will be masked unless you send it as is`)
  if (!isCheckable(text)) return tips
  const named = isNamed(text, facts)
  const c = facts.component
  if (PRODUCTION.test(text)) add('production', 'serious', 'production: say whether Claude may change or run anything there')
  if (VAGUE.test(text) && !named) {
    add('subject', 'warning', c ? `"it": the ${typeName(c.type)} ${c.name}, the last one this session?` : '"it": no component named; say which process or component')
  }
  if (DEPLOY.test(text) && !ENVIRONMENT.test(text) && !GUID.test(text)) {
    add('environment', 'warning', facts.environmentId ? `deploy: no environment named; the session points at ${shortId(facts.environmentId)}` : 'deploy: no environment named')
  }
  if (FAILING.test(text) && !ERROR_GIVEN.test(text)) {
    const f = facts.failed
    add('error', 'warning', f ? `fix: no error given; the last failure was ${f.name}${f.executionId ? ` (${f.executionId})` : ''}` : 'fix: no error, log or execution ID given')
  }
  if (TEST.test(text) && !TEST_DATA.test(text)) add('test', 'warning', 'test: say what to test with, and what a pass looks like')
  if (BUILD.test(text)) {
    const missing = [
      ENDPOINTS.test(text) ? '' : 'the source and target',
      TRIGGER.test(text) ? '' : 'what starts it',
      FORMAT.test(text) ? '' : 'the data format',
    ].filter(Boolean)
    if (missing.length > 0) add('build', 'warning', `new process: doesn't say ${listed(missing)}`)
  }
  if (MAP.test(text) && !MAP_DETAIL.test(text)) add('map', 'warning', 'map: name the source and target profiles or fields')
  if (LOOK.test(text) && WHERE.test(text) && !SPECIFIC.test(text) && !named) {
    add('aim', 'warning', 'look-around: say what you want to find out (deployed processes, failed runs, a folder\'s components, runtimes)')
  }
  const steps = STEPS.filter(s => s.test(text)).length
  if (steps >= 3) add('steps', 'warning', `${steps} big steps in one prompt: stop between them to check each`)
  return CHECKS.flatMap(code => tips.filter(t => t.code === code))
}

const listed = (parts: readonly string[]) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`)

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

/**
 * The prompt with what its tips found filled in: the session's facts as
 * sentences where it knows them, and a Details list of [placeholders] for the
 * rest. Never an invented name or ID. The prompt itself is masked.
 */
export const upgradePrompt = (text: string, facts: PromptFacts, tips: readonly PromptTip[]): string => {
  const c = facts.component
  const f = facts.failed
  const parts = [sentence(maskPrompt(text).trim().replace(/\s+/g, ' '))]
  const details: string[] = []
  for (const tip of tips) {
    switch (tip.code) {
      case 'subject':
        if (c) parts.push(`By "it" I mean the ${typeName(c.type)} ${c.name}${c.id ? ` (${c.id})` : ''}.`)
        else details.push('The process or component: [which one]')
        break
      case 'environment':
        if (facts.environmentId) parts.push(`Deploy to environment ${facts.environmentId}.`)
        else details.push('Environment: [which environment]')
        break
      case 'error':
        if (f) {
          parts.push(
            `The last failure was ${f.name}${f.executionId ? ` (execution ${f.executionId})` : ''}: ${maskPrompt(f.detail).slice(0, 160)}. Read its process log and tell me the cause before you change anything.`,
          )
        } else {
          parts.push('Read the process log and tell me the cause before you change anything.')
          details.push('The error: [the error message or execution ID]')
        }
        break
      case 'test':
        details.push('Test data: [what to test with]; a pass means [the expected result]')
        break
      case 'production':
        parts.push('Ask me before you change or run anything in production.')
        break
      case 'build':
        if (!ENDPOINTS.test(text)) details.push('Source and target: [source system] to [target system]')
        if (!TRIGGER.test(text)) details.push('What starts it: [a schedule or a listener]')
        if (!FORMAT.test(text)) details.push('Data format: [JSON, XML, CSV, flat file or EDI]')
        break
      case 'map':
        details.push('Map: [the source profile] to [the target profile]')
        break
      case 'aim':
        details.push('What to find out: [deployed processes and where, recent failed executions, the components in a folder, or the runtimes and whether they are online]')
        break
      case 'steps':
        parts.push('Do one step at a time, and stop after each to show me the result.')
        break
      case 'secret':
        parts.push('Read the credential from .env instead of this message.')
        break
    }
  }
  const said = parts.join(' ')
  return details.length > 0 ? `${said}\n\nDetails:\n${details.map(d => `- ${d}`).join('\n')}` : said
}

// --- A model's rewrite, on demand -------------------------------------------------

export const REWRITE_SYSTEM = [
  "You rewrite a person's prompt to Claude Code for Boomi integration work done with Boomi Companion.",
  'Keep exactly what they meant and asked for. Add only what the notes, facts, components and guidance below give.',
  'Never invent component names, IDs, environments, systems, fields, data or numbers. Use a listed component only where the prompt clearly means it. Where something is unknown, leave a [placeholder] in square brackets.',
  "When the person adds a note for this try, follow it. When an earlier try is given, write a different one that follows the note.",
  'Never add features, steps, systems, logic or requirements the person did not ask for (no upserts, write-backs, subprocesses or error handling they did not mention). The components and guidance below only tell you which existing names fit and what to ask the person about: turn a gap into a question or a [placeholder], never into a decision.',
  'Write one request in plain language and the first person, as the person would type it, about as long as it needs to be and no longer. Ask Claude to stop and show results between big steps.',
  'Reply with the rewritten prompt only: no preamble, no quotes, no list of changes.',
].join('\n')

/** What else a rewrite reads: the folder's components and Companion's guidance (retrieve.ts), the person's note, the try before. */
export type RewriteExtras = { context?: readonly string[]; note?: string; previous?: string }

/** What the model reads: the masked prompt, what it leaves out, the session's facts, the cheap upgrade, and any extras. */
export const rewriteRequest = (masked: string, facts: PromptFacts, tips: readonly PromptTip[], draft: string, extras: RewriteExtras = {}): string => {
  // Only the facts a tip needs: the last failure for a fix, the environment for a deploy, the component for "it".
  const needs = new Set(tips.map(t => t.code))
  const known = [
    needs.has('subject') && facts.component ? `- Component worked on last: the ${typeName(facts.component.type)} ${facts.component.name}${facts.component.id ? ` (${facts.component.id})` : ''}` : '',
    needs.has('environment') && facts.environmentId ? `- Environment the session points at: ${facts.environmentId}` : '',
    needs.has('error') && facts.failed
      ? `- Last failure: ${facts.failed.name}${facts.failed.executionId ? ` (execution ${facts.failed.executionId})` : ''}: ${maskPrompt(facts.failed.detail).slice(0, 200)}`
      : '',
  ].filter(Boolean)
  return [
    'The prompt:',
    '<prompt>',
    masked,
    '</prompt>',
    '',
    'What it leaves out:',
    ...(tips.length > 0 ? tips.map(t => `- ${t.text}`) : ['- nothing the checks found']),
    '',
    'Facts from this session:',
    ...(known.length > 0 ? known : ['- none']),
    '',
    ...(extras.context ?? []),
    '',
    'A first draft from simple checks:',
    draft,
    ...(extras.previous ? ['', 'The try before (write a different one):', maskPrompt(extras.previous)] : []),
    ...(extras.note ? ['', "The person's note for this try:", maskPrompt(extras.note)] : []),
  ].join('\n')
}

/**
 * A text in lines no wider than `columns`, as a narrow card draws it:
 * broken at spaces, a word longer than a line cut. Blank lines are kept.
 */
export const wrapLines = (text: string, columns: number): string[] => {
  const width = Math.max(8, columns)
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (word.length > width) {
        if (line) out.push(line)
        out.push(word.slice(0, width))
        word = word.slice(width)
        line = ''
      }
      if (!line) line = word
      else if (line.length + 1 + word.length <= width) line += ` ${word}`
      else {
        out.push(line)
        line = word
      }
    }
    out.push(line)
  }
  return out
}

/** The model's rewrite, trimmed of quotes and fences and masked again; undefined when it gave nothing. */
export const rewriteFrom = (reply: string): string | undefined => {
  const text = reply
    .trim()
    .replace(/^```\w*\n?|\n?```$/g, '')
    .replace(/^<prompt>\s*|\s*<\/prompt>$/g, '')
    .trim()
    .replace(/^["“](.*)["”]$/s, '$1')
    .trim()
  return text ? maskPrompt(text) : undefined
}

// --- Counting and saying it -------------------------------------------------------

export const NO_COUNTS: PromptCounts = { checked: 0, tipped: 0, followed: 0, byCode: {} }

/**
 * The counts after a checked prompt: a tip on the prompt before that this one
 * no longer needs counts as followed.
 */
export const countsAfter = (counts: PromptCounts, before: readonly PromptTip[] | undefined, tips: readonly PromptTip[]): PromptCounts => {
  const byCode = { ...counts.byCode }
  const now = new Set(tips.map(t => t.code))
  let followed = 0
  for (const t of before ?? []) {
    if (now.has(t.code) || t.code === 'secret') continue
    followed++
    const was = byCode[t.code] ?? { seen: 0, followed: 0 }
    byCode[t.code] = { ...was, followed: was.followed + 1 }
  }
  for (const t of tips) {
    const was = byCode[t.code] ?? { seen: 0, followed: 0 }
    byCode[t.code] = { ...was, seen: was.seen + 1 }
  }
  return { checked: counts.checked + 1, tipped: counts.tipped + (tips.length > 0 ? 1 : 0), followed: counts.followed + followed, byCode }
}

const LABELS: Record<PromptCheckCode, string> = {
  secret: 'a secret in the prompt',
  production: 'production named',
  subject: 'no component named',
  environment: 'deploy with no environment',
  error: 'fix with no error',
  test: 'test with no test data',
  build: 'new process missing details',
  map: 'map with no profiles',
  steps: 'several big steps at once',
  aim: 'a look around with nothing to find',
}

/** The tip seen most this session, as a person says it, with its count. */
const mostOften = (counts: PromptCounts) => {
  const top = Object.entries(counts.byCode).sort((a, b) => (b[1]?.seen ?? 0) - (a[1]?.seen ?? 0))[0]
  return top && (top[1]?.seen ?? 0) > 0 ? `${LABELS[top[0] as PromptCheckCode]} (${top[1]!.seen})` : undefined
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The counts in a line: "6 prompts checked · 4 with tips · 3 tips followed". */
export const countsLine = (counts: PromptCounts): string =>
  [plural(counts.checked, 'prompt') + ' checked', `${counts.tipped} with tips`, plural(counts.followed, 'tip') + ' followed'].join(' · ')

/** The status line's part: "◐ 3 prompt tips", or that a prompt is held. Serious when one is (a secret, production). */
export const statusPart = (tips: PromptTips | null, isHeld = false): string | undefined => {
  if (!tips || tips.tips.length === 0) return undefined
  if (isHeld) return '⏸ prompt held: Boomi Dashboard Prompt tips'
  const level = tips.tips.some(t => t.level === 'serious') ? 'serious' : 'warning'
  return `${STATUS[level].icon} ${plural(tips.tips.length, 'prompt tip')}: /bc-dashboard prompt`
}

/** `/bc-dashboard prompt`: the last prompt's tips and its upgrade, then the session's counts. */
export const tipsText = (tips: PromptTips | null, counts: PromptCounts, mode: string): string => {
  const lines = [`Prompt tips (promptCheck: ${mode})`]
  if (mode === 'off') lines.push('Prompts are not checked. /bc-dashboard config promptCheck suggest turns it on.')
  if (!tips || tips.tips.length === 0) {
    lines.push(counts.checked > 0 ? 'Your last Boomi prompt had nothing to add.' : 'No Boomi prompt checked yet this session.')
  } else {
    lines.push('', `Your last prompt: ${tips.masked}`, '')
    for (const t of tips.tips) lines.push(`  ${STATUS[t.level].icon} ${t.text}`)
    lines.push('', tips.rewrittenBy ? `Upgraded by ${tips.rewrittenBy}${tips.tokens ? ` (${tips.tokens} tokens)` : ''}:` : 'Upgraded:', `  ${tips.upgrade}`, '')
    lines.push('/bc-dashboard prompt use puts it in the prompt box. /bc-dashboard prompt upgrade has a model rewrite it.')
  }
  if (counts.checked > 0) {
    const top = mostOften(counts)
    lines.push('', `This session: ${countsLine(counts)}${top ? `. Most often: ${top}` : ''}`)
  }
  return lines.join('\n')
}

/** The report's lines for its Prompt tips section; none before a prompt was checked. */
export const reportLines = (counts: PromptCounts | undefined): string[] => {
  if (!counts || counts.checked === 0) return []
  const top = mostOften(counts)
  return ['', '## Prompt tips', '', `- ${countsLine(counts)}`, ...(top ? [`- Most often: ${top}`] : [])]
}
