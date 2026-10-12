// Where the Platform API token comes from, and when Companion's scripts get it.
//
// Companion's scripts read ./.env with `source`, then require the token to be
// set. A variable .env doesn't assign keeps the value the process inherited,
// so a token kept in Claude Code's secure storage can reach a script through
// its environment alone, for just that command. A line in .env that assigns the
// token, even to nothing, wins over it: such a line has to go.

const TOKEN_KEY = 'BOOMI_API_TOKEN'

export type TokenSource = 'secure setting' | '.env' | 'environment' | 'none'

/** Where the token in use comes from: the secure setting first, then .env, then the environment. */
export const tokenSource = (secure: string, envValues: Record<string, string>, inherited: string | undefined): TokenSource =>
  secure ? 'secure setting' : envValues[TOKEN_KEY] ? '.env' : inherited ? 'environment' : 'none'

/** Whether .env has a line that assigns the token, empty or not (a comment doesn't count). */
export const hasTokenLine = (envText: string): boolean =>
  envText.split(/\r?\n/).some(line => new RegExp(`^\\s*(export\\s+)?${TOKEN_KEY}\\s*=`).test(line))

/**
 * Whether a shell command runs one of Companion's scripts, which need the
 * token: every boomi-*.sh, and event-streams-setup.sh, which isn't named so.
 */
export const runsCompanionScript = (command: string): boolean =>
  /(^|[\s/'"])(boomi-[a-z-]+|event-streams-setup)\.sh\b/.test(command)

/** What to tell someone whose .env still assigns the token while the secure setting holds it. */
export const TOKEN_LINE_ADVICE =
  `Delete the ${TOKEN_KEY} line from Companion's .env: the token now comes from the mod's secure setting, and a line in .env, even an empty one, overrides it.`
