// Holds Boomi Companion's components to the team's standards. Before Companion
// creates, pushes or deploys a component, this mod reads the component XML the
// script names and refuses the call when it breaks a rule, with the reasons, so
// Claude fixes the component and tries again.
// Everything that touches the engine lives in this file because the engine
// follows $ only within it; the rules themselves are in ./rules.

import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import {
  DEFAULT_STANDARDS,
  RULES,
  checkComponent,
  companionCalls,
  errorsIn,
  formatReports,
  parseStandards,
  statusLine,
  warningsIn,
} from './rules'
import type { CheckMode, FileReport, RuleId, Standards } from './rules'

type Engine = EngineInterface

type Settings = { isEnforced: boolean; rulesFile: string; componentsDir: string }

const settingsFrom = (options: PluginOptions): Settings => ({
  isEnforced: options.enforce !== false,
  rulesFile: String(options.rulesFile || 'boomi-standards.json'),
  componentsDir: String(options.componentsDir || 'active-development'),
})

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

type Loaded = { standards: Standards; source: string; problem?: string }

/** The team's standards file, or the defaults. A broken file falls back to the defaults and says why. */
const loadStandards = async ($: Engine, settings: Settings): Promise<Loaded> => {
  if (!(await $.fs.exists(settings.rulesFile))) {
    return { standards: DEFAULT_STANDARDS, source: `defaults (no ${settings.rulesFile})` }
  }
  try {
    return { standards: parseStandards(String(await $.fs.read(settings.rulesFile))), source: settings.rulesFile }
  } catch (error) {
    return {
      standards: DEFAULT_STANDARDS,
      source: 'defaults',
      problem: `${settings.rulesFile} couldn't be used, so the default rules apply: ${messageOf(error)}`,
    }
  }
}

const checkFiles = async ($: Engine, paths: readonly string[], mode: CheckMode, standards: Standards) => {
  const reports: FileReport[] = []
  for (const path of paths) {
    try {
      reports.push({ path, findings: checkComponent(String(await $.fs.read(path)), mode, standards) })
    } catch (error) {
      reports.push({ path, findings: [], unreadable: messageOf(error) })
    }
  }
  return reports
}

/** Every component XML file under a folder, depth first. */
const componentFiles = async ($: Engine, dir: string): Promise<string[]> => {
  if (!(await $.fs.exists(dir))) return []
  const found: string[] = []
  for (const entry of await $.fs.list(dir)) {
    const path = `${dir.replace(/\/+$/, '')}/${entry.name}`
    if (entry.kind === 'dir' && entry.name !== 'inventories') found.push(...(await componentFiles($, path)))
    else if (entry.kind === 'file' && entry.name.endsWith('.xml')) found.push(path)
  }
  return found.sort()
}

/** Checks the named files, or every component in the components folder. */
const check = async ($: Engine, settings: Settings, paths: readonly string[]): Promise<string> => {
  const loaded = await loadStandards($, settings)
  const targets = paths.length > 0 ? paths : await componentFiles($, settings.componentsDir)
  const reports = await checkFiles($, targets, 'check', loaded.standards)
  if (reports.length > 0) $.ui.status(statusLine(reports))
  return [
    loaded.problem,
    `Standards: ${loaded.source}`,
    formatReports(paths.length > 0 || reports.length > 0 ? reports : []),
    paths.length === 0 && reports.length === 0 ? `(nothing under ${settings.componentsDir}/)` : undefined,
  ]
    .filter(Boolean)
    .join('\n')
}

const describeRules = async ($: Engine, settings: Settings): Promise<string> => {
  const { standards, source, problem } = await loadStandards($, settings)
  const lines = [problem, `Standards: ${source}`, `Enforced: ${settings.isEnforced ? 'yes' : 'no, findings are only reported'}`, '']
  for (const [rule, what] of Object.entries(RULES)) {
    lines.push(`${standards.severity[rule as RuleId].padEnd(7)} ${rule}: ${what}`)
  }
  const naming = Object.entries(standards.naming)
  if (naming.length > 0) {
    lines.push('', 'Names:')
    for (const [type, pattern] of naming) lines.push(`  ${type}: ${pattern}`)
  }
  if (standards.folders.length > 0) lines.push('', `Folders: ${standards.folders.join(', ')}`)
  for (const { pattern, message } of standards.forbiddenText) lines.push(`Forbidden: ${pattern} (${message})`)
  return lines.filter(line => line !== undefined).join('\n')
}

const USAGE = [
  '/standards check [file...]  check component XML (default: everything under the components folder)',
  '/standards rules            the rules in force and where they come from',
].join('\n')

const splitArgs = (args: string): string[] => args.trim().split(/\s+/).filter(Boolean)

export const register: Register = (on, options) => {
  const settings = settingsFrom(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'standards',
      description: "Check Boomi components against the team's standards",
      argumentHint: 'check [file...] | rules',
    })
    await $.tool.register({
      name: 'check',
      description:
        "Check Boomi component XML files against the team's standards (naming, folders, no hard-coded credentials). With no paths, checks every component under the components folder. Run it before creating, pushing or deploying components; those calls are refused while a component breaks a rule.",
      inputSchema: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'Component XML files to check' },
        },
      },
    })
    return started
  })

  // The guardrail: before a Companion script sends components to the platform,
  // check the files it names.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const calls = companionCalls(String(e.command ?? ''))
    if (calls.length === 0) return next(e)
    const loaded = await loadStandards($, settings)
    const reports: FileReport[] = []
    for (const call of calls) reports.push(...(await checkFiles($, call.files, call.mode, loaded.standards)))
    if (reports.length === 0) return next(e)
    $.ui.status(statusLine(reports))

    const report = [loaded.problem, formatReports(reports)].filter(Boolean).join('\n')
    if (settings.isEnforced && errorsIn(reports) > 0) {
      return {
        deny: `boomi-standards: refused, because these components break the team's standards (${loaded.source}). Fix them and run the command again.\n${report}`,
      }
    }
    const ran = await next(e)
    if (ran.deny !== undefined || (errorsIn(reports) === 0 && warningsIn(reports) === 0 && !loaded.problem)) return ran
    return { ...ran, context: [...(ran.context ?? []), `boomi-standards:\n${report}`] }
  })

  on('command.run', { command: 'standards' }, async ($, e) => {
    const [action = 'help', ...rest] = splitArgs(e.args)
    if (action === 'check') return { text: await check($, settings, rest) }
    if (action === 'rules') return { text: await describeRules($, settings) }
    return { text: USAGE }
  })

  on('tool.call', { tool: 'mcp__boomi-standards__check' }, async ($, e) => {
    const paths = (e as { paths?: unknown }).paths
    const list = Array.isArray(paths) ? paths.map(String) : []
    return { result: await check($, settings, list) }
  })
}
