import { expect, test } from 'claude-code/testing'
import { accountRolesFrom, loginCheck } from '../hooks/login-roles'
import type { AccountRole } from '../hooks/login-roles'

const FULL = { id: 'r-full', name: 'CR-Boomi-Companion-Non-Prod-FullAccess', privileges: ['API'] }
const READ = { id: 'r-read', name: 'CR-Boomi-Companion-Prod-ReadOnly', privileges: ['API'] }
const STANDARD = { id: 'r-std', name: 'Standard User', privileges: [] as string[] }
const ADMIN = { id: 'r-admin', name: 'Administrator', privileges: ['ACCOUNT_ADMIN'] }
const ROLES: AccountRole[] = [FULL, READ, STANDARD, ADMIN]

test('a login holding only the Companion roles is healthy', () => {
  expect(loginCheck(['r-full', 'r-read'], ROLES)).toEqual({ level: 'healthy', text: 'The .env login holds only the Companion roles' })
})

test('a login with roles beyond the Companion ones is serious, and names them', () => {
  expect(loginCheck(['r-full', 'r-std'], ROLES)).toEqual({ level: 'serious', text: 'The .env login holds roles beyond the Companion roles: Standard User' })
})

test('a login holding no Companion role is serious', () => {
  expect(loginCheck(['r-std'], ROLES).level).toBe('serious')
  expect(loginCheck(['r-std'], ROLES).text).toBe('The .env login holds no Companion role, and 1 other role')
})

test('an account admin privilege is critical, whatever else the login holds', () => {
  expect(loginCheck(['r-full', 'r-admin'], ROLES)).toEqual({ level: 'critical', text: 'The .env login holds an account admin role: Administrator' })
})

test('a login with no roles, or a role it can\'t read, is a warning', () => {
  expect(loginCheck([], ROLES).level).toBe('warning')
  expect(loginCheck(['r-full', 'r-missing'], ROLES)).toEqual({ level: 'warning', text: "The .env login holds 2 roles, and 1 of them couldn't be read" })
})

test('privileges are read as names whether Boomi sends strings or objects', () => {
  const roles = accountRolesFrom([
    { id: 'a', name: 'One', Privileges: ['ACCOUNT_ADMIN', 'API'] },
    { id: 'b', name: 'Two', Privileges: [{ name: 'ACCOUNT_ADMIN' }, { privilege: 'API' }] },
    { id: '', name: 'No id' },
  ])
  expect(roles).toEqual([
    { id: 'a', name: 'One', privileges: ['ACCOUNT_ADMIN', 'API'] },
    { id: 'b', name: 'Two', privileges: ['ACCOUNT_ADMIN', 'API'] },
  ])
  expect(loginCheck(['b'], roles).level).toBe('critical')
})
