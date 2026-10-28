// What the Boomi roles of the login in Companion's .env say about its access:
// only the Companion roles, nothing broader. Plain functions: nothing here
// touches the engine.

/** The roles the boomi-ai-role-setup skill creates for Companion: full access in non-PROD, read-only in PROD. */
export const COMPANION_ROLES: readonly string[] = ['CR-Boomi-Companion-Non-Prod-FullAccess', 'CR-Boomi-Companion-Prod-ReadOnly']

/** A role in the account, with the privileges it grants. */
export type AccountRole = { id: string; name: string; privileges: string[] }

export type LoginCheck = { level: 'healthy' | 'warning' | 'serious' | 'critical'; text: string }

const privilegeName = (raw: unknown): string => {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') {
    const named = raw as { name?: unknown; privilege?: unknown }
    return String(named.name ?? named.privilege ?? '')
  }
  return ''
}

/** The `Role/query` rows as roles: ID, name and privileges. */
export const accountRolesFrom = (rows: readonly Record<string, unknown>[]): AccountRole[] =>
  rows
    .map(raw => ({
      id: String(raw.id ?? ''),
      name: String(raw.name ?? ''),
      privileges: Array.isArray(raw.Privileges) ? raw.Privileges.map(privilegeName).filter(Boolean) : [],
    }))
    .filter(role => role.id)

/**
 * The check for the .env login, from the IDs of the roles linked to it and
 * the account's roles. Critical when it holds an account-admin privilege;
 * serious when it holds roles beyond the Companion ones, or none of them.
 */
export const loginCheck = (linked: readonly string[], roles: readonly AccountRole[]): LoginCheck => {
  if (linked.length === 0) return { level: 'warning', text: 'The .env login holds no roles in Boomi, or Boomi has no such login' }
  const held = roles.filter(role => linked.includes(role.id))
  const unnamed = linked.length - held.length
  const admin = held.filter(role => role.privileges.some(privilege => /ACCOUNT_ADMIN/i.test(privilege)))
  if (admin.length > 0) return { level: 'critical', text: `The .env login holds an account admin role: ${admin.map(role => role.name).join(', ')}` }
  if (unnamed > 0) return { level: 'warning', text: `The .env login holds ${linked.length} roles, and ${unnamed} of them couldn't be read` }
  const names = held.map(role => role.name)
  const beyond = names.filter(name => !COMPANION_ROLES.includes(name))
  if (!names.some(name => COMPANION_ROLES.includes(name))) return { level: 'serious', text: `The .env login holds no Companion role, and ${beyond.length} other role${beyond.length === 1 ? '' : 's'}` }
  if (beyond.length > 0) return { level: 'serious', text: `The .env login holds roles beyond the Companion roles: ${beyond.join(', ')}` }
  return { level: 'healthy', text: 'The .env login holds only the Companion roles' }
}
