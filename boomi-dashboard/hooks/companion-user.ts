// Whether the Boomi login Companion signs in with looks like a person's own
// login rather than a dedicated one. A name check only: it nudges, and it
// never enforces. Plain functions: nothing here touches the engine.

/** `same-as-claude-account`: the email of the Claude account the person is signed into. `your-login`: the person's own login, as set in personalLogin. `personal-looking`: a name like first.last@domain. */
export type LoginNudge = 'same-as-claude-account' | 'your-login' | 'personal-looking'

/** Words in a login that mark it as a dedicated one (an AI user, a service account), so it isn't flagged. */
const DEDICATED = /(?:^|[._+-])(?:ai|companion|svc|service|bot|integration|api|automation)(?:[._+-]|\d|$)/i

/** A username that reads as a person: letters, joined by dots, dashes or underscores, at a domain. */
const PERSONAL = /^[a-z]+(?:[._-][a-z]+)+@/i

/**
 * The nudge for the .env username, or undefined when there's nothing to say.
 * `claudeEmail` is the email of the Claude account the person is signed into,
 * when known: a claim from the Claude login record, not verified by Boomi.
 */
export const loginNudge = (username: string, personalLogin: string, claudeEmail = ''): LoginNudge | undefined => {
  const login = username.trim().toLowerCase()
  if (!login) return undefined
  if (claudeEmail.trim() && login === claudeEmail.trim().toLowerCase()) return 'same-as-claude-account'
  if (personalLogin.trim() && login === personalLogin.trim().toLowerCase()) return 'your-login'
  const local = login.split('@')[0] ?? ''
  if (DEDICATED.test(local)) return undefined
  return PERSONAL.test(login) ? 'personal-looking' : undefined
}
