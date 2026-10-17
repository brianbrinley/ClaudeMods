// The dashboard's own list of what Claude has to ask before each kind of Boomi
// work, which the prompt rewrite turns into [decide: …] placeholders. It is
// tagged by the Companion plugin it applies to and stamped with the version of
// that plugin it was written against, so an upgrade shows up as drift to
// review (`/bc-dashboard prompt guide`) and a model drafts the edits
// (`/bc-dashboard prompt guide refresh`) for a person to read and commit.
// Plain functions: the tests call them directly.

import { changelogBetween, compareVersions } from './upgrade'

/** One thing a better prompt answers up front, for a kind of work in a Companion plugin. */
export type GuideEntry = { plugin: string; task: string; ask: string }

/** The version of each Companion plugin this guide was last checked against. A plugin with no stamp has no entries yet. */
export const GUIDE_STAMP: Readonly<Record<string, string>> = { 'bc-integration': '1.0.83' }

/** The guide. Entries for the other Companion plugins come from `guide refresh`, read against that plugin's own docs and changelog, never written from memory. */
export const GUIDE: readonly GuideEntry[] = [
  { plugin: 'bc-integration', task: 'a new process', ask: 'the source and target systems, what starts it, the data format, and what happens to a record that fails' },
  { plugin: 'bc-integration', task: 'a deploy', ask: 'the environment, and whether to test after' },
  { plugin: 'bc-integration', task: 'a fix', ask: 'the error or execution ID, and what correct looks like' },
  { plugin: 'bc-integration', task: 'a map', ask: 'the source and target profiles, and any field rules' },
  { plugin: 'bc-integration', task: 'a test', ask: 'the data to use, and what a pass is' },
  { plugin: 'bc-integration', task: 'anything in production', ask: 'whether Claude may change or run it' },
]

/** The guide's lines for the plugins on in this session; the integration plugin's always, since every Boomi prompt is partly about it. */
export const guideFor = (installed: readonly string[], guide: readonly GuideEntry[] = GUIDE): GuideEntry[] =>
  guide.filter(e => e.plugin === 'bc-integration' || installed.includes(e.plugin))

/** A guide line as the model reads it: `a deploy: the environment, and whether to test after`. */
export const guideLine = (e: GuideEntry): string => `${e.task}: ${e.ask}`

export type GuideState = 'current' | 'drifted' | 'unwritten' | 'unknown'

/** One Companion plugin's guide against what is installed: current, drifted (Companion moved on), unwritten (no entries yet) or unknown (no version read). */
export type GuideStatus = { plugin: string; installed?: string; stamped?: string; state: GuideState }

export const guideStatus = (installed: readonly { name: string; version?: string }[], stamp: Readonly<Record<string, string>> = GUIDE_STAMP): GuideStatus[] =>
  installed.map(({ name, version }) => {
    const stamped = stamp[name]
    const state: GuideState = !stamped ? 'unwritten' : !version ? 'unknown' : compareVersions(version, stamped) === 0 ? 'current' : 'drifted'
    return { plugin: name, ...(version ? { installed: version } : {}), ...(stamped ? { stamped } : {}), state }
  })

/** The Prompt tab's one line when Companion has moved on from the guide; undefined when nothing has. */
export const driftNote = (status: readonly GuideStatus[]): string | undefined => {
  const drifted = status.filter(s => s.state === 'drifted')
  if (drifted.length === 0) return undefined
  const what = drifted.map(s => `${s.plugin} ${s.stamped} (now ${s.installed})`).join(', ')
  return `The dashboard's guide was written for ${what}. Check what changed: /bc-dashboard prompt guide`
}

/** `/bc-dashboard prompt guide`: each plugin's state, and the changelog lines since the version the guide was written for. */
export const guideText = (status: readonly GuideStatus[], changelogs: Readonly<Record<string, readonly string[]>> = {}): string => {
  if (status.length === 0) return "No Companion plugins are on in this session, so there is nothing to compare the dashboard's guide with."
  const lines = ["The dashboard's prompt guide against the Companion plugins on in this session:", '']
  for (const s of status) {
    const icon = s.state === 'current' ? '✓' : '◐'
    const said =
      s.state === 'current' ? `written for ${s.stamped}, installed ${s.installed}: up to date` :
      s.state === 'drifted' ? `written for ${s.stamped}, installed ${s.installed}: Companion has moved on` :
      s.state === 'unwritten' ? `no entries yet${s.installed ? ` (installed ${s.installed})` : ''}` :
      `written for ${s.stamped}, installed version unknown`
    lines.push(`  ${icon} ${s.plugin}: ${said}`)
    const notes = s.state === 'drifted' && s.stamped && s.installed ? changelogBetween(changelogs[s.plugin] ?? [], s.stamped, s.installed) : []
    for (const n of notes.slice(0, 40)) lines.push(`      ${n}`)
    if (notes.length > 40) lines.push(`      …and ${notes.length - 40} more lines`)
  }
  const stale = status.filter(s => s.state === 'drifted' || s.state === 'unwritten')
  lines.push('', stale.length > 0 ? `/bc-dashboard prompt guide refresh has a model draft the edits for ${stale.map(s => s.plugin).join(', ')}, for you to read. It changes nothing.` : 'Nothing to refresh.')
  return lines.join('\n')
}

export const REFRESH_SYSTEM = [
  "You maintain a short list of what Claude has to ask a person before each kind of Boomi work, for one Boomi Companion plugin. A prompt rewrite turns each line into a [decide: …] placeholder.",
  "You are given the plugin's current lines (possibly none), and either the changelog entries since the version they were written for or, for a plugin with no lines yet, its changelog and doc headings.",
  'Propose edits only where the notes show something that changes what a person must decide up front: a new required field, a new way to do a task, a rule Claude must follow. Never write a question from general knowledge of Boomi; every line you add or change must name the changelog line or doc heading that supports it.',
  'Reply with one edit per line, in this form, and nothing else:',
  'ADD | <task> | <what to ask> | <the note that supports it>',
  'CHANGE | <task> | <new text> | <the note that supports it>',
  'REMOVE | <task> | | <the note that supports it>',
  'A task is a short phrase such as "a deploy" or "a Data Hub model". What to ask is the questions in a few words, like the current lines. If nothing in the notes changes the list, reply exactly: Nothing to change.',
].join('\n')

/** What the model reads to draft a plugin's edits: its lines, and the notes since the version they were written for. */
export const refreshRequest = (plugin: string, stamped: string | undefined, installed: string | undefined, entries: readonly GuideEntry[], notes: readonly string[], headings: readonly string[] = []): string =>
  [
    `Plugin: ${plugin}`,
    `The lines were written for version ${stamped ?? '(none yet)'}; installed is ${installed ?? 'unknown'}.`,
    '',
    'Current lines:',
    ...(entries.length > 0 ? entries.map(e => `- ${guideLine(e)}`) : ['- none']),
    '',
    stamped ? 'Changelog entries since then:' : "The plugin's changelog:",
    ...(notes.length > 0 ? notes : ['(none found)']),
    ...(headings.length > 0 ? ['', "Headings in the plugin's reference docs:", ...headings.map(h => `- ${h}`)] : []),
  ].join('\n')

/** The draft as a person reads it: the model's edit lines, and how to apply them. Nothing is written anywhere. */
export const refreshText = (plugin: string, installed: string | undefined, reply: string, by: string): string =>
  [
    `Draft edits to the guide for ${plugin}${installed ? ` ${installed}` : ''}, by ${by}. Read each against the note it names before using it:`,
    '',
    reply.trim(),
    '',
    `To use them: edit GUIDE in hooks/prompt-guide.ts and set GUIDE_STAMP['${plugin}'] to '${installed ?? '<version>'}'. Nothing was changed.`,
  ].join('\n')
