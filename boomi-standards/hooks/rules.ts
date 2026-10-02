// The team's standards for Boomi components, and the checks that hold
// Companion's component XML to them. Plain functions: nothing here touches the
// engine, so every rule is unit-tested on its own.

export type Severity = 'error' | 'warning' | 'off'

export type RuleId =
  | 'component-id-on-create'
  | 'folder-missing'
  | 'folder-not-allowed'
  | 'name-placeholder'
  | 'name-pattern'
  | 'password-in-xml'
  | 'password-token'
  | 'password-property-default'
  | 'secret-pattern'
  | 'forbidden-text'
  | 'try-catch'

export type ForbiddenText = { pattern: string; message: string }

export type Standards = {
  /** Component type (the XML's type=, `*` for any) → a regular expression its name must match. */
  naming: Record<string, string>
  /** Folder IDs components may be created or pushed into; empty allows any. */
  folders: string[]
  /** Text no component may contain, such as production hostnames. */
  forbiddenText: ForbiddenText[]
  /** Each rule's severity: errors block a create, push or deploy; warnings are reported. */
  severity: Record<RuleId, Severity>
}

export const RULES: Record<RuleId, string> = {
  'component-id-on-create': 'A new component has an empty componentId; the platform assigns it.',
  'folder-missing': 'Every component has a real folderId, not empty or a {placeholder}.',
  'folder-not-allowed': 'Components go only in the folders the standards list.',
  'name-placeholder': 'Names are set, with no {placeholder} left in them.',
  'name-pattern': "Names match the team's pattern for their component type.",
  'password-in-xml': 'No password is written into a password field; set it in the Boomi GUI.',
  'password-token': 'No pulled password token is pushed back (it would replace the real password).',
  'password-property-default': 'Password process properties have no default; use Environment Extensions.',
  'secret-pattern': 'No keys, tokens or private keys appear anywhere in the XML.',
  'forbidden-text': 'No text the standards forbid, such as production hostnames.',
  'try-catch': 'Every process has a Try/Catch step.',
}

export const DEFAULT_STANDARDS: Standards = {
  naming: {},
  folders: [],
  forbiddenText: [],
  severity: {
    'component-id-on-create': 'error',
    'folder-missing': 'error',
    'folder-not-allowed': 'error',
    'name-placeholder': 'error',
    'name-pattern': 'error',
    'password-in-xml': 'error',
    'password-token': 'error',
    'password-property-default': 'error',
    'secret-pattern': 'error',
    'forbidden-text': 'error',
    'try-catch': 'off',
  },
}

const SEVERITIES: readonly Severity[] = ['error', 'warning', 'off']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The standards from a boomi-standards.json file, over the defaults. Throws on
 * anything malformed, naming what is wrong, so a typo never quietly turns a
 * rule off.
 */
export const parseStandards = (text: string): Standards => {
  const raw: unknown = JSON.parse(text)
  if (!isRecord(raw)) throw new Error('the standards file must hold a JSON object')
  const standards: Standards = {
    naming: {},
    folders: [],
    forbiddenText: [],
    severity: { ...DEFAULT_STANDARDS.severity },
  }
  if (raw.naming !== undefined) {
    if (!isRecord(raw.naming)) throw new Error('"naming" must map component types to patterns')
    for (const [type, pattern] of Object.entries(raw.naming)) {
      if (typeof pattern !== 'string') throw new Error(`naming["${type}"] must be a string`)
      try {
        new RegExp(pattern)
      } catch {
        throw new Error(`naming["${type}"] is not a valid regular expression: ${pattern}`)
      }
      standards.naming[type] = pattern
    }
  }
  if (raw.folders !== undefined) {
    if (!Array.isArray(raw.folders) || raw.folders.some(f => typeof f !== 'string')) {
      throw new Error('"folders" must be a list of folder IDs')
    }
    standards.folders = raw.folders as string[]
  }
  if (raw.forbiddenText !== undefined) {
    if (!Array.isArray(raw.forbiddenText)) throw new Error('"forbiddenText" must be a list')
    for (const entry of raw.forbiddenText) {
      if (!isRecord(entry) || typeof entry.pattern !== 'string') {
        throw new Error('each "forbiddenText" entry needs a "pattern" string')
      }
      try {
        new RegExp(entry.pattern)
      } catch {
        throw new Error(`forbiddenText pattern is not a valid regular expression: ${entry.pattern}`)
      }
      const message = typeof entry.message === 'string' ? entry.message : `matches ${entry.pattern}`
      standards.forbiddenText.push({ pattern: entry.pattern, message })
    }
  }
  if (raw.severity !== undefined) {
    if (!isRecord(raw.severity)) throw new Error('"severity" must map rule IDs to error, warning or off')
    for (const [rule, level] of Object.entries(raw.severity)) {
      if (!(rule in RULES)) throw new Error(`unknown rule "${rule}" in "severity"`)
      if (!SEVERITIES.includes(level as Severity)) {
        throw new Error(`severity["${rule}"] must be error, warning or off`)
      }
      standards.severity[rule as RuleId] = level as Severity
    }
  }
  return standards
}

export type Finding = { rule: RuleId; severity: 'error' | 'warning'; message: string }

/** create: a new component; push: an update; deploy: a process going to a runtime. */
export type CheckMode = 'create' | 'push' | 'deploy' | 'check'

const decode = (value: string): string =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

/** The attributes of one start tag, decoded. */
export const attributes = (tag: string): Record<string, string> => {
  const found: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    found[match[1]!] = decode(match[3] ?? match[4] ?? '')
  }
  return found
}

const PLACEHOLDER = /\{[^{}]*\}/
// A pulled password field's value: a reference to the stored secret, not the secret.
const PASSWORD_TOKEN = /^[0-9a-f]{128}$/

// Shapes that are secrets wherever they appear.
const SECRET_SHAPES: readonly [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key ID'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'a GitHub token'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'an API secret key'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/, 'a bearer token'],
  [/\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}(?![A-Za-z0-9+/=])/, 'a Basic auth credential'],
  [/[?&](api[_-]?key|access[_-]?token|client[_-]?secret|password)=[^&\s"'<]{6,}/i, 'a credential in a URL'],
]

const lineOf = (xml: string, index: number): number => xml.slice(0, index).split('\n').length

/** Checks one component's XML against the standards. Throws when it isn't a component. */
export const checkComponent = (xml: string, mode: CheckMode, standards: Standards): Finding[] => {
  const findings: Finding[] = []
  const add = (rule: RuleId, message: string) => {
    const level = standards.severity[rule]
    if (level !== 'off') findings.push({ rule, severity: level, message })
  }

  const root = /<bns:Component\b[^>]*>/.exec(xml)
  if (!root) throw new Error('not a Boomi component: no <bns:Component> element')
  const component = attributes(root[0])
  const type = component.type ?? ''
  const name = component.name ?? ''

  if (mode === 'create' && component.componentId) {
    add('component-id-on-create', `componentId is "${component.componentId}"; leave it empty on a new component`)
  }

  const folderId = component.folderId
  if (mode === 'create' && !folderId) {
    add('folder-missing', 'folderId is empty, so the component would land in the account root')
  } else if (folderId !== undefined && PLACEHOLDER.test(folderId)) {
    add('folder-missing', `folderId is the placeholder "${folderId}"`)
  } else if (folderId && standards.folders.length > 0 && !standards.folders.includes(folderId)) {
    add('folder-not-allowed', `folder ${folderId} isn't one of the folders the standards allow`)
  }

  if (!name.trim()) {
    add('name-placeholder', 'the component has no name')
  } else if (PLACEHOLDER.test(name)) {
    add('name-placeholder', `name "${name}" still has a placeholder`)
  } else {
    const pattern = standards.naming[type] ?? standards.naming['*']
    if (pattern !== undefined && !new RegExp(pattern).test(name)) {
      add('name-pattern', `${type || 'component'} name "${name}" doesn't match ${pattern}`)
    }
  }

  // Password fields: empty is right; anything else is a password in the file or a token.
  for (const match of xml.matchAll(/<field\b[^>]*>/g)) {
    const field = attributes(match[0])
    if (field.type !== 'password' || !field.value) continue
    const where = `field "${field.id ?? '?'}" (line ${lineOf(xml, match.index ?? 0)})`
    if (PASSWORD_TOKEN.test(field.value)) {
      add('password-token', `${where} holds a pulled password token; pushing it replaces the real password. Leave it out of the push or set the password in the Boomi GUI`)
    } else {
      add('password-in-xml', `${where} has a password written into it; leave the value empty and set it in the Boomi GUI`)
    }
  }

  for (const match of xml.matchAll(/<definedProcessProperty\b[^>]*>([\s\S]*?)<\/definedProcessProperty>/g)) {
    const body = match[1] ?? ''
    if (!/<type>\s*password\s*<\/type>/.test(body)) continue
    const fallback = /<defaultValue>([\s\S]*?)<\/defaultValue>/.exec(body)
    if (fallback?.[1]?.trim()) {
      const key = attributes(match[0]).key ?? '?'
      add('password-property-default', `password property "${key}" has a default value; leave it empty and set it with Environment Extensions`)
    }
  }

  // Password field values are covered above; look everywhere else.
  const elsewhere = xml.replace(/(<field\b[^>]*\btype="password"[^>]*\bvalue=")[^"]*"/g, '$1"')
  for (const [shape, what] of SECRET_SHAPES) {
    const hit = shape.exec(elsewhere)
    if (hit) add('secret-pattern', `line ${lineOf(elsewhere, hit.index)} has what looks like ${what}`)
  }

  for (const { pattern, message } of standards.forbiddenText) {
    const hit = new RegExp(pattern).exec(xml)
    if (hit) add('forbidden-text', `line ${lineOf(xml, hit.index)}: ${message}`)
  }

  if (type === 'process' && !/shapetype="catcherrors"/.test(xml)) {
    add('try-catch', 'the process has no Try/Catch step')
  }

  return findings
}

export type CompanionCall = { script: 'create' | 'push' | 'deploy'; mode: CheckMode; files: string[] }

const SCRIPTS: Record<string, CompanionCall['script']> = {
  'boomi-component-create.sh': 'create',
  'boomi-component-push.sh': 'push',
  'boomi-deploy.sh': 'deploy',
}

/** Splits a shell command into words and separators, honoring quotes. */
const words = (command: string): string[] => {
  const out: string[] = []
  let word = ''
  let quote = ''
  let started = false
  const flush = () => {
    if (started) out.push(word)
    word = ''
    started = false
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote) {
      if (ch === quote) quote = ''
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) word += command[++i]!
      else word += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (ch === '\\' && i + 1 < command.length) {
      word += command[++i]!
      started = true
    } else if (/\s/.test(ch)) {
      flush()
    } else if (';&|()'.includes(ch)) {
      flush()
      out.push(ch)
    } else {
      word += ch
      started = true
    }
  }
  flush()
  return out
}

const SEPARATOR = /^[;&|()]$/

const joinPath = (dir: string, path: string): string =>
  path.startsWith('/') || !dir ? path : `${dir.replace(/\/+$/, '')}/${path}`

/**
 * The Companion scripts a shell command runs that send components to the
 * platform, each with the component files it names. Paths are made relative to
 * a `cd` earlier in the command, when there is one.
 */
export const companionCalls = (command: string): CompanionCall[] => {
  const calls: CompanionCall[] = []
  const tokens = words(command)
  let dir = ''
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    const following = tokens[i + 1]
    if (token === 'cd' && following && !SEPARATOR.test(following)) {
      dir = joinPath(dir, following)
      continue
    }
    const script = SCRIPTS[token.split('/').pop() ?? '']
    if (!script) continue
    const files: string[] = []
    for (const arg of tokens.slice(i + 1)) {
      if (SEPARATOR.test(arg)) break
      if (arg.endsWith('.xml') && !arg.startsWith('-')) files.push(joinPath(dir, arg))
    }
    calls.push({ script, mode: script, files })
  }
  return calls
}

export type FileReport = { path: string; findings: Finding[]; unreadable?: string }

export const errorsIn = (reports: readonly FileReport[]): number =>
  reports.reduce((n, r) => n + r.findings.filter(f => f.severity === 'error').length, 0)

export const warningsIn = (reports: readonly FileReport[]): number =>
  reports.reduce((n, r) => n + r.findings.filter(f => f.severity === 'warning').length, 0)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** One line for the status line: an icon and a label, never color alone. */
export const statusLine = (reports: readonly FileReport[]): string => {
  const errors = errorsIn(reports)
  const warnings = warningsIn(reports)
  if (errors) return `✗ standards: ${plural(errors, 'error')}`
  if (warnings) return `⚠ standards: ${plural(warnings, 'warning')}`
  return `✓ standards: ${plural(reports.length, 'component')} pass`
}

/** The findings as text for Claude and the person. */
export const formatReports = (reports: readonly FileReport[]): string => {
  if (reports.length === 0) return 'No component files to check.'
  const lines: string[] = []
  for (const report of reports) {
    if (report.unreadable) {
      lines.push(`? ${report.path}: couldn't read it (${report.unreadable})`)
    } else if (report.findings.length === 0) {
      lines.push(`✓ ${report.path}`)
    } else {
      lines.push(`${report.findings.some(f => f.severity === 'error') ? '✗' : '⚠'} ${report.path}`)
      for (const f of report.findings) lines.push(`  ${f.severity} [${f.rule}] ${f.message}`)
    }
  }
  lines.push(statusLine(reports))
  return lines.join('\n')
}
