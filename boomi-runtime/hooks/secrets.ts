// Keeps the Boomi Platform API token out of what Claude reads: a guard that
// refuses tool calls that would show it, and redaction for everything else.

export const REDACTED = '‹redacted›'

// Shorter values could be ordinary words; a real token is far longer.
const MIN_SECRET_LENGTH = 8

/** The strings that give the token away: the token and the Basic auth pair built from it. */
export const secretValues = (token: string | undefined, username: string | undefined): string[] => {
  if (!token || token.length < MIN_SECRET_LENGTH) return []
  const values = [token]
  if (username) {
    const bytes = new TextEncoder().encode(`BOOMI_TOKEN.${username}:${token}`)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    values.push(btoa(binary))
  }
  return values
}

export const containsSecret = (text: string, secrets: readonly string[]): boolean =>
  secrets.some(secret => text.includes(secret))

export const redact = (text: string, secrets: readonly string[]): string =>
  secrets.reduce((clean, secret) => clean.replaceAll(secret, REDACTED), text)

// A .env file, but not a template such as .env.example.
const ENV_FILE = /(^|\/)\.env(\.(?!example$|sample$|template$|dist$)[\w-]+)?$/
const PROCESS_ENVIRON = /\/proc\/[^/\s]+\/environ\b/

const isEnvFile = (path: unknown): boolean =>
  typeof path === 'string' && (ENV_FILE.test(path.trim()) || PROCESS_ENVIRON.test(path))

// Shell commands that print the environment or a .env file.
const SHELL_LEAKS: readonly [RegExp, string][] = [
  [/BOOMI_API_TOKEN/, 'it names BOOMI_API_TOKEN'],
  [/(^|[\s'"<=/])\.env(\.(?!example\b|sample\b|template\b|dist\b)[\w-]+)?(?=$|[\s'";|&)<>])/, 'it reads a .env file'],
  [PROCESS_ENVIRON, "it reads a process's environment"],
  [/\bprintenv\b/, 'printenv prints the environment'],
  [/(^|[;&|(`]|\$\()\s*(sudo\s+)?env\s*(-0\s*)?($|[;&|)>`])/, 'env on its own prints the environment'],
  [/(^|[;&|(`]|\$\()\s*(set|export|declare|typeset)(\s+-p)?\s*($|[;&|)>`])/, 'it prints every variable'],
]

/** Why a tool call would show the token, or undefined when it's safe to run. */
export const guardReason = (tool: string, input: Record<string, unknown>): string | undefined => {
  if ((tool === 'Read' || tool === 'NotebookRead') && isEnvFile(input.file_path)) {
    return 'reading a .env file would show the Boomi API token. Use /boomi env to see it with the token masked.'
  }
  if (tool === 'Grep') {
    if (isEnvFile(input.path) || (typeof input.glob === 'string' && /\.env\b/.test(input.glob))) {
      return 'searching a .env file would show the Boomi API token. Use /boomi env to see it with the token masked.'
    }
    if (typeof input.pattern === 'string' && input.pattern.includes('BOOMI_API_TOKEN')) {
      return 'searching for BOOMI_API_TOKEN would show the Boomi API token.'
    }
  }
  if (tool === 'Bash' && typeof input.command === 'string') {
    for (const [pattern, why] of SHELL_LEAKS) {
      if (pattern.test(input.command)) {
        return `this command could show the Boomi API token: ${why}. Use /boomi env to see the settings with the token masked.`
      }
    }
  }
  return undefined
}

/** A .env file's lines with every secret-bearing value masked. */
export const maskEnv = (text: string): string =>
  text
    .split(/\r?\n/)
    .map(line =>
      /^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_]*(TOKEN|SECRET|PASSWORD|KEY)\s*=/.test(line)
        ? line.replace(/=.*$/, `=${REDACTED}`)
        : line,
    )
    .join('\n')
