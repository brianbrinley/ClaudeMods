// The read-only Platform API calls the cockpit polls, and reading Companion's
// .env. Auth matches Companion's scripts: BOOMI_TOKEN.<username> and the API
// token. Nothing here logs or returns the token.

import type { HttpInit, HttpResponse } from 'claude-code'

import type { Run } from '../types'

export type Fetch = (url: string, init?: HttpInit) => Promise<HttpResponse>

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/

const unquote = (raw: string): string => {
  const quoted = raw.match(/^(['"])(.*)\1$/)
  if (quoted) return quoted[2] ?? ''
  return raw.replace(/\s+#.*$/, '')
}

export const parseEnv = (text: string): Record<string, string> => {
  const values: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue
    const match = line.match(LINE)
    if (match && match[1]) values[match[1]] = unquote(match[2] ?? '')
  }
  return values
}

export type Credentials = {
  apiUrl: string
  username: string
  apiToken: string
  accountId: string
  environmentId?: string
}

const REQUIRED = ['BOOMI_API_URL', 'BOOMI_USERNAME', 'BOOMI_API_TOKEN', 'BOOMI_ACCOUNT_ID'] as const

/** The Platform API credentials in Companion's .env, or the names missing. */
export const credentialsFrom = (
  values: Record<string, string>,
): { credentials: Credentials } | { missing: string[] } => {
  const missing = REQUIRED.filter(name => !values[name])
  if (missing.length > 0) return { missing }
  return {
    credentials: {
      apiUrl: (values.BOOMI_API_URL ?? '').replace(/\/+$/, ''),
      username: values.BOOMI_USERNAME ?? '',
      apiToken: values.BOOMI_API_TOKEN ?? '',
      accountId: values.BOOMI_ACCOUNT_ID ?? '',
      environmentId: values.BOOMI_ENVIRONMENT_ID || undefined,
    },
  }
}

export const basicAuth = (credentials: Credentials): string => {
  const bytes = new TextEncoder().encode(`BOOMI_TOKEN.${credentials.username}:${credentials.apiToken}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

/** The platform's answer to a failed call, without its body: that can echo a request back. */
export class PlatformError extends Error {
  constructor(
    readonly action: string,
    readonly status: number,
  ) {
    super(`${action} failed (HTTP ${status})`)
  }
}

export type ComponentVersion = {
  name?: string
  version?: string
  modifiedBy?: string
  modifiedDate?: string
}

const text = (value: unknown): string | undefined =>
  value === undefined || value === null || value === '' ? undefined : String(value)

export const platformClient = (fetch: Fetch, credentials: Credentials) => {
  const base = `${credentials.apiUrl}/api/rest/v1/${credentials.accountId}`

  const query = async (action: string, path: string, body: unknown): Promise<Record<string, unknown>[]> => {
    const response = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: basicAuth(credentials),
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new PlatformError(action, response.status)
    try {
      const list = (JSON.parse(response.text) as { result?: unknown }).result
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }

  const equals = (property: string, value: string) => ({
    operator: 'EQUALS',
    property,
    argument: [value],
  })

  return {
    /** The IDs of the runtimes attached to an environment. */
    environmentAtoms: async (environmentId: string): Promise<string[]> =>
      (
        await query('List environment runtimes', 'EnvironmentAtomAttachment/query', {
          QueryFilter: { expression: equals('environmentId', environmentId) },
        })
      )
        .map(raw => String(raw.atomId ?? ''))
        .filter(Boolean),

    /** The newest executions on any of the runtimes, newest first. */
    recentRuns: async (atomIds: readonly string[], limit = 10): Promise<Run[]> => {
      if (atomIds.length === 0) return []
      const expression =
        atomIds.length === 1
          ? equals('atomId', atomIds[0]!)
          : { operator: 'or', nestedExpression: atomIds.map(id => equals('atomId', id)) }
      const found = await query('List executions', 'ExecutionRecord/query', {
        QueryFilter: { expression },
        QuerySort: { sortField: [{ fieldName: 'executionTime', sortOrder: 'DESC' }] },
      })
      return found.slice(0, limit).map(raw => ({
        executionId: String(raw.executionId ?? ''),
        processName: String(raw.processName ?? ''),
        status: String(raw.status ?? ''),
        at: String(raw.executionTime ?? ''),
      }))
    },

    /** A component's current version on the account's default branch. */
    currentVersion: async (componentId: string): Promise<ComponentVersion | undefined> => {
      const found = await query('Read component metadata', 'ComponentMetadata/query', {
        QueryFilter: {
          expression: {
            operator: 'and',
            nestedExpression: [equals('componentId', componentId), equals('currentVersion', 'true')],
          },
        },
      })
      const raw = found[0]
      if (!raw) return undefined
      return {
        name: text(raw.name),
        version: text(raw.version),
        modifiedBy: text(raw.modifiedBy),
        modifiedDate: text(raw.modifiedDate),
      }
    },
  }
}

export type PlatformClient = ReturnType<typeof platformClient>
