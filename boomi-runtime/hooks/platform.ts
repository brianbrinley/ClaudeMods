// A small Boomi Platform API client: just the calls a runtime's lifecycle needs.
// Auth matches Boomi Companion's scripts: BOOMI_TOKEN.<username> and the API token.

import type { HttpInit, HttpResponse } from 'claude-code'

import type { Credentials } from './envfile'

export type Fetch = (url: string, init?: HttpInit) => Promise<HttpResponse>

export type Atom = {
  id: string
  name: string
  status: string
  hostName?: string
}

export type Execution = {
  executionId: string
  processName: string
  status: string
  executionTime: string
}

export type Folder = {
  id: string
  fullPath: string
}

export type ExecutionOutcome = {
  executionId: string
  status: string
}

export class PlatformError extends Error {
  constructor(
    readonly action: string,
    readonly status: number,
    body: string,
  ) {
    super(`${action} failed (HTTP ${status})${summary(body)}`)
  }
}

// The platform's error text, cut short: enough to diagnose, never a whole page.
const summary = (body: string): string => {
  try {
    const parsed = JSON.parse(body) as { message?: unknown }
    if (typeof parsed.message === 'string') return `: ${parsed.message.slice(0, 200)}`
  } catch {}
  const text = body.replace(/\s+/g, ' ').trim().slice(0, 200)
  return text ? `: ${text}` : ''
}

/**
 * A successful answer's JSON, or undefined when it has none: the platform
 * answers some calls (a DELETE, for one) with a body that is not JSON.
 */
const parseJson = (text: string): unknown => {
  try {
    return text ? JSON.parse(text) : undefined
  } catch {
    return undefined
  }
}

const requireString = (value: unknown, action: string, field: string): string => {
  if (typeof value === 'string' && value) return value
  throw new PlatformError(action, 200, `no ${field} in the answer`)
}

/** Reads `name` from a JSON or XML answer: `"name": "v"` or `name="v"`. */
export const attribute = (text: string, name: string): string | undefined =>
  text.match(new RegExp(`"?${name}"?\\s*[:=]\\s*"([^"]+)"`))?.[1]

/** The text of the first `<name>` or `<prefix:name>` element in an XML answer. */
export const element = (text: string, name: string): string | undefined =>
  text.match(new RegExp(`<(?:[A-Za-z]+:)?${name}>([^<]*)</`))?.[1]

export const escapeXml = (text: string): string =>
  text.replace(/[<>&"']/g, char => `&#${char.charCodeAt(0)};`)

export const basicAuth = (credentials: Credentials): string => {
  const pair = `BOOMI_TOKEN.${credentials.username}:${credentials.apiToken}`
  const bytes = new TextEncoder().encode(pair)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

const byName = (name: string) => ({
  QueryFilter: {
    expression: { operator: 'EQUALS', property: 'name', argument: [name] },
  },
})

export const platformClient = (fetch: Fetch, credentials: Credentials) => {
  const base = `${credentials.apiUrl}/api/rest/v1/${credentials.accountId}`
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: basicAuth(credentials),
  }

  const send = async (
    action: string,
    method: string,
    path: string,
    body?: string,
    contentType = 'application/json',
    accept = 'application/json',
  ): Promise<HttpResponse> => {
    const response = await fetch(`${base}/${path}`, {
      method,
      headers: { ...headers, 'Content-Type': contentType, Accept: accept },
      body,
    })
    if (!response.ok) throw new PlatformError(action, response.status, response.text)
    return response
  }

  const call = async (
    action: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> => {
    const response = await send(
      action,
      method,
      path,
      body === undefined ? undefined : JSON.stringify(body),
    )
    return parseJson(response.text)
  }

  const results = (answer: unknown): Record<string, unknown>[] => {
    const list = (answer as { result?: unknown } | undefined)?.result
    return Array.isArray(list) ? list : []
  }

  const toAtom = (raw: Record<string, unknown>): Atom => ({
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    status: String(raw.status ?? 'UNKNOWN'),
    hostName: raw.hostName === undefined ? undefined : String(raw.hostName),
  })

  return {
    /** A short-lived token the quiet installer registers the runtime with. */
    createInstallerToken: async (durationMinutes = 60): Promise<string> => {
      const answer = (await call('Create installer token', 'POST', 'InstallerToken', {
        installType: 'ATOM',
        durationMinutes,
      })) as { token?: unknown } | undefined
      if (typeof answer?.token !== 'string') {
        throw new PlatformError('Create installer token', 200, 'no token in the answer')
      }
      return answer.token
    },

    findAtom: async (name: string): Promise<Atom | undefined> => {
      const found = results(await call('Find runtime', 'POST', 'Atom/query', byName(name)))
      return found[0] ? toAtom(found[0]) : undefined
    },

    atomsNamedLike: async (prefix: string): Promise<Atom[]> => {
      const query = {
        QueryFilter: {
          expression: { operator: 'LIKE', property: 'name', argument: [`${prefix}%`] },
        },
      }
      return results(await call('List runtimes', 'POST', 'Atom/query', query)).map(toAtom)
    },

    attach: async (atomId: string, environmentId: string): Promise<void> => {
      await call('Attach runtime to environment', 'POST', 'EnvironmentAtomAttachment', {
        atomId,
        environmentId,
      })
    },

    deleteAtom: async (atomId: string): Promise<void> => {
      await call('Delete runtime', 'DELETE', `Atom/${encodeURIComponent(atomId)}`)
    },

    recentExecutions: async (atomId: string, limit = 5): Promise<Execution[]> => {
      const query = {
        QueryFilter: {
          expression: { operator: 'EQUALS', property: 'atomId', argument: [atomId] },
        },
        QuerySort: { sortField: [{ fieldName: 'executionTime', sortOrder: 'DESC' }] },
      }
      return results(await call('List executions', 'POST', 'ExecutionRecord/query', query))
        .slice(0, limit)
        .map(raw => ({
          executionId: String(raw.executionId ?? ''),
          processName: String(raw.processName ?? ''),
          status: String(raw.status ?? ''),
          executionTime: String(raw.executionTime ?? ''),
        }))
    },

    /**
     * The folder `value` names: a folder ID, a name, or a full path such as
     * `Account/Parent/Folder`. Deleted folders never match; a name shared by
     * several folders is refused, listing their paths.
     */
    resolveFolder: async (value: string): Promise<Folder> => {
      const wanted = value.trim().replace(/\/+$/, '')
      const name = wanted.split('/').pop() ?? wanted
      const query = {
        QueryFilter: { expression: { operator: 'EQUALS', property: 'name', argument: [name] } },
      }
      const toFolder = (raw: Record<string, unknown>): Folder => ({
        id: String(raw.id ?? ''),
        fullPath: String(raw.fullPath ?? ''),
      })
      const live = results(await call('Find folder', 'POST', 'Folder/query', query)).filter(
        raw => raw.deleted !== true && raw.deleted !== 'true' && String(raw.name ?? '') === name,
      )
      const matches = (wanted.includes('/')
        ? live.filter(raw => String(raw.fullPath ?? '') === wanted)
        : live
      ).map(toFolder)
      if (matches.length === 1 && matches[0]) return matches[0]
      if (matches.length > 1) {
        throw new PlatformError(
          'Find folder',
          200,
          `several folders are named ${value}: ${matches.map(folder => folder.fullPath).join(', ')}. Use the full path or the folder ID`,
        )
      }
      try {
        const raw = (await call('Find folder', 'GET', `Folder/${encodeURIComponent(wanted)}`)) as
          | Record<string, unknown>
          | undefined
        if (raw && raw.deleted !== true && raw.deleted !== 'true') return toFolder(raw)
      } catch {}
      throw new PlatformError('Find folder', 404, `no folder has the name, path or ID ${value}`)
    },

    createEnvironment: async (name: string): Promise<string> => {
      const answer = (await call('Create environment', 'POST', 'Environment', {
        name,
        classification: 'TEST',
      })) as { id?: unknown } | undefined
      return requireString(answer?.id, 'Create environment', 'id')
    },

    deleteEnvironment: async (environmentId: string): Promise<void> => {
      await call('Delete environment', 'DELETE', `Environment/${encodeURIComponent(environmentId)}`)
    },

    /** Creates a component from its XML; resolves its componentId. */
    createComponent: async (xml: string): Promise<string> => {
      // The Component API answers only in XML (JSON is refused with 406).
      const response = await send(
        'Create component',
        'POST',
        'Component',
        xml,
        'application/xml',
        'application/xml',
      )
      return requireString(attribute(response.text, 'componentId'), 'Create component', 'componentId')
    },

    /**
     * The current, undeleted component named `name` (in `folderId`, when given).
     * The Platform API cannot delete components, so the smoke test reuses one.
     */
    findComponent: async (name: string, folderId?: string): Promise<string | undefined> => {
      const query = {
        QueryFilter: { expression: { operator: 'EQUALS', property: 'name', argument: [name] } },
      }
      const found = results(await call('Find component', 'POST', 'ComponentMetadata/query', query))
      const isTrue = (value: unknown) => value === true || value === 'true'
      const current = found.find(
        raw =>
          String(raw.name ?? '') === name &&
          isTrue(raw.currentVersion) &&
          !isTrue(raw.deleted) &&
          (folderId === undefined || String(raw.folderId ?? '') === folderId),
      )
      return current ? String(current.componentId ?? '') || undefined : undefined
    },

    packageComponent: async (componentId: string, packageVersion: string): Promise<string> => {
      const answer = (await call('Package component', 'POST', 'PackagedComponent', {
        componentId,
        packageVersion,
        notes: 'boomi-runtime smoke test',
      })) as { packageId?: unknown } | undefined
      return requireString(answer?.packageId, 'Package component', 'packageId')
    },

    deploy: async (packageId: string, environmentId: string): Promise<string> => {
      const answer = (await call('Deploy package', 'POST', 'DeployedPackage', {
        packageId,
        environmentId,
        notes: 'boomi-runtime smoke test',
      })) as { deploymentId?: unknown } | undefined
      return requireString(answer?.deploymentId, 'Deploy package', 'deploymentId')
    },

    undeploy: async (deploymentId: string): Promise<void> => {
      await call('Undeploy package', 'DELETE', `DeployedPackage/${encodeURIComponent(deploymentId)}`)
    },

    /** Starts a process on a runtime; resolves the request ID to poll. */
    execute: async (processId: string, atomId: string): Promise<string> => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?><ExecutionRequest processId="${escapeXml(processId)}" atomId="${escapeXml(atomId)}" xmlns="http://api.platform.boomi.com/"/>`
      const response = await send(
        'Execute process',
        'POST',
        'ExecutionRequest',
        xml,
        'application/xml',
        'application/xml',
      )
      return requireString(attribute(response.text, 'requestId'), 'Execute process', 'requestId')
    },

    /** The execution a request started, or undefined while it is still running. */
    executionOutcome: async (requestId: string): Promise<ExecutionOutcome | undefined> => {
      // XML, as Boomi Companion reads it.
      const response = await send(
        'Read execution',
        'GET',
        `ExecutionRecord/async/${encodeURIComponent(requestId)}`,
        undefined,
        'application/json',
        'application/xml',
      )
      if (response.status === 202 || !response.text) return undefined
      const status = element(response.text, 'status')
      if (!status || status === 'INPROCESS' || status === 'STARTED') return undefined
      return { executionId: element(response.text, 'executionId') ?? '', status }
    },
  }
}

export type PlatformClient = ReturnType<typeof platformClient>
