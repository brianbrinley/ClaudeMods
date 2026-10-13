// Boomi Companion's other plugins: Marketplace recipes, Data Hub, BDI
// (formerly Rivery), Agentstudio and custom connector development. Each is a
// skill folder of bash scripts called as `<script> <verb> <id or file> [--flags]`,
// read from the plugins' own scripts (bc-marketplace 0.2.10, bc-datahub
// 0.2.12, bc-bdi 0.2.5, bc-agentstudio 0.1.42, bc-connectordev 0.0.50).
// Plain functions: nothing here touches the engine.

import type { Product } from '../types'

/** Each product's name, as a person reads it. */
export const PRODUCT_NAMES: Record<Product, string> = {
  marketplace: 'Marketplace',
  datahub: 'Data Hub',
  bdi: 'BDI',
  agentstudio: 'Agentstudio',
  connectordev: 'Connectors',
}

/**
 * A subcommand that changes something: what it did, what it does, and what it
 * acts on. `noun` is empty when the phrase names it already. Where the target
 * comes from: the first word after the verb that isn't a flag, else `last`
 * (the last such word), else a flag's value. Any subcommand not listed only
 * reads (list, get, query, status, logs, ...) and isn't a step.
 */
type Verb = { did: string; does: string; noun: string; target?: 'last' | `--${string}` }

type Script = { product: Product; verbs: Record<string, Verb> }

const v = (did: string, does: string, noun: string, target?: Verb['target']): Verb => ({ did, does, noun, ...(target ? { target } : {}) })

/** The usual verbs on a thing: created, updated, deleted. */
const crud = (noun: string, extra: Record<string, Verb> = {}): Record<string, Verb> => ({
  create: v('created', 'create', noun),
  update: v('updated', 'update', noun),
  delete: v('deleted', 'delete', noun),
  ...extra,
})

/** Scripts without subcommands: their one action is under ''. */
const PRODUCT_SCRIPTS: Record<string, Script> = {
  'boomi-marketplace-install.sh': { product: 'marketplace', verbs: { '': v('installed', 'install', 'recipe', '--bundle-id') } },
  'boomi-marketplace-supporting-materials.sh': {
    product: 'marketplace',
    verbs: { '': v('downloaded the supporting materials of', 'download the supporting materials of', 'recipe', '--bundle-id') },
  },

  'datahub-model.sh': {
    product: 'datahub',
    verbs: crud('model', {
      publish: v('published', 'publish', 'model'),
      pull: v('pulled', 'pull', 'model'),
      'add-quality-step': v('added a quality step to', 'add a quality step to', 'model'),
      'remove-quality-step': v('removed a quality step from', 'remove a quality step from', 'model'),
    }),
  },
  'datahub-source.sh': {
    product: 'datahub',
    verbs: crud('source', {
      pull: v('pulled', 'pull', 'source'),
      'enable-initial-load': v('started the initial load of', 'start the initial load of', 'source'),
      'finish-initial-load': v('finished the initial load of', 'finish the initial load of', 'source'),
    }),
  },
  'datahub-deployment.sh': {
    product: 'datahub',
    verbs: { deploy: v('deployed', 'deploy', 'universe'), undeploy: v('undeployed', 'undeploy', 'universe') },
  },
  'datahub-quarantine.sh': {
    product: 'datahub',
    verbs: {
      approve: v('approved', 'approve', 'quarantined record', 'last'),
      reject: v('rejected', 'reject', 'quarantined record'),
      delete: v('deleted', 'delete', 'quarantined record', 'last'),
    },
  },
  'datahub-golden-record.sh': {
    product: 'datahub',
    verbs: {
      update: v('updated', 'update', 'golden records'),
      enddate: v('end-dated', 'end-date', 'golden record'),
      'enddate-bulk': v('end-dated', 'end-date', 'golden records'),
      restore: v('restored', 'restore', 'golden record'),
      unlink: v('unlinked a source from', 'unlink a source from', 'golden record'),
    },
  },
  'datahub-repository.sh': { product: 'datahub', verbs: { create: v('created', 'create', 'repository', 'last') } },
  'datahub-connection.sh': { product: 'datahub', verbs: { bootstrap: v('created', 'create', 'connection', 'last') } },

  'bdi-flow.sh': {
    product: 'bdi',
    verbs: {
      run: v('ran', 'run', 'flow'),
      'run-sub': v('ran a sub-flow of', 'run a sub-flow of', 'flow'),
      cancel: v('cancelled a run of', 'cancel a run of', 'flow'),
      activate: v('activated', 'activate', 'flow'),
      disable: v('disabled', 'disable', 'flow'),
      copy: v('copied', 'copy', 'flow'),
      create: v('created', 'create', 'flow'),
      edit: v('updated', 'update', 'flow'),
      restore: v('restored a version of', 'restore a version of', 'flow'),
    },
  },
  'bdi-connection.sh': {
    product: 'bdi',
    verbs: {
      create: v('created', 'create', 'connection'),
      edit: v('updated', 'update', 'connection'),
      'add-file': v('uploaded a file for', 'upload a file for', 'connection'),
    },
  },
  'bdi-cdc.sh': {
    product: 'bdi',
    verbs: {
      enable: v('turned on CDC for', 'turn on CDC for', 'flow'),
      disable: v('turned off CDC for', 'turn off CDC for', 'flow'),
      set: v('set the CDC offset of', 'set the CDC offset of', 'flow'),
      delete: v('cleared the CDC offset of', 'clear the CDC offset of', 'flow'),
    },
  },
  'bdi-env.sh': { product: 'bdi', verbs: { create: v('created', 'create', 'environment'), edit: v('updated', 'update', 'environment') } },
  'bdi-variable.sh': {
    product: 'bdi',
    verbs: {
      'env-set': v('set environment variables', 'set environment variables', ''),
      'env-delete': v('deleted environment variable', 'delete environment variable', ''),
      'river-set': v('set the variables of', 'set the variables of', 'flow'),
    },
  },
  'bdi-dataframe.sh': {
    product: 'bdi',
    verbs: { add: v('created', 'create', 'dataframe'), update: v('updated', 'update', 'dataframe'), clear: v('cleared', 'clear', 'dataframe') },
  },
  'bdi-logicode.sh': { product: 'bdi', verbs: { upload: v('uploaded Python file', 'upload Python file', '') } },

  'agentstudio-agent.sh': { product: 'agentstudio', verbs: { create: v('created', 'create', 'agent'), update: v('updated', 'update', 'agent') } },
  'agentstudio-tool.sh': {
    product: 'agentstudio',
    verbs: {
      create: v('created', 'create', 'tool'),
      update: v('updated', 'update', 'tool'),
      install: v('installed', 'install', 'tool'),
      uninstall: v('uninstalled', 'uninstall', 'tool'),
    },
  },
  'agentstudio-source.sh': { product: 'agentstudio', verbs: { create: v('added', 'add', 'MCP server'), update: v('updated', 'update', 'MCP server') } },
  'agentstudio-deployment.sh': {
    product: 'agentstudio',
    verbs: { 'package-create': v('packaged', 'package', 'agent'), deploy: v('deployed', 'deploy', 'agent') },
  },
  'agentstudio-session.sh': {
    product: 'agentstudio',
    verbs: {
      invoke: v('talked to', 'talk to', 'deployment', '--deployment'),
      continue: v('talked to', 'talk to', 'deployment', '--deployment'),
    },
  },

  'connectordev-init.sh': { product: 'connectordev', verbs: { '': v('created connector project', 'create connector project', '') } },
  'connectordev-descriptor-lint.sh': { product: 'connectordev', verbs: { '': v('linted connector descriptor', 'lint connector descriptor', '') } },
  'connectordev-doctor.sh': { product: 'connectordev', verbs: { '': v('checked connector project', 'check connector project', '') } },
  'connectordev-version.sh': {
    product: 'connectordev',
    verbs: {
      upload: v('uploaded a version to', 'upload a version to', 'connector group', '--group'),
      validate: v('validated connector descriptor', 'validate connector descriptor', ''),
      delete: v('deleted a version of', 'delete a version of', 'connector group'),
    },
  },
  'connectordev-group.sh': {
    product: 'connectordev',
    verbs: {
      create: v('created a connector group', 'create a connector group', ''),
      delete: v('deleted', 'delete', 'connector group'),
      'classification-add': v('added a connector classification', 'add a connector classification', ''),
      'classification-delete': v('deleted', 'delete', 'connector classification'),
    },
  },
  'connectordev-version-change.sh': {
    product: 'connectordev',
    verbs: {
      set: v('changed the connector version of', 'change the connector version of', 'classification'),
      cancel: v('cancelled the version change of', 'cancel the version change of', 'classification'),
    },
  },
}

/** Whether a word names one of the other plugins' scripts, read-only ones included. */
export const isProductScript = (name: string): boolean =>
  name in PRODUCT_SCRIPTS || /^(datahub|bdi|agentstudio|connectordev)-[a-z-]+\.sh$/.test(name) || /^boomi-marketplace-[a-z-]+\.sh$/.test(name)

/** Flags that stand alone: everything else that starts with -- takes the next word. */
const SWITCHES = new Set([
  '--draft',
  '--dry-run',
  '--no-wait',
  '--deploy',
  '--all',
  '--all-schemas',
  '--icons',
  '--skip-network',
  '--has-active-deployments',
  '--include-deleted',
  '--deployable',
])

/** An ID shortened as the rest of the dashboard does, a path to its file name, a name as it is. */
const shortTarget = (word: string): string => {
  const base = word.includes('/') ? (word.split('/').filter(Boolean).pop() ?? word) : word
  return /^[0-9a-f-]{16,}$/i.test(base) || (base.length > 24 && !/\s/.test(base)) ? `${base.slice(0, 8)}…` : base
}

/** One run of another plugin's script: its product, its verb and what it acted on. */
export type ProductRun = { product: Product; script: string; verb: string; target?: string; ref?: string }

/**
 * A run of another plugin's script, from its name and the words after it.
 * Undefined for a script that isn't one, help, and a subcommand that only reads.
 */
export const productRun = (name: string, args: readonly string[]): ProductRun | undefined => {
  const script = PRODUCT_SCRIPTS[name]
  if (!script) return undefined
  if (args.some(arg => arg === '-h' || arg === '--help' || arg === 'help')) return undefined
  const hasVerbs = !('' in script.verbs)
  const verb = hasVerbs ? (args[0] ?? '') : ''
  const found = script.verbs[verb]
  if (!found) return undefined
  const rest = hasVerbs ? args.slice(1) : args
  const positional: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    if (arg.startsWith('--')) {
      const [flag, inline] = arg.split('=', 2) as [string, string | undefined]
      if (inline !== undefined) flags[flag] = inline
      else if (!SWITCHES.has(flag) && rest[i + 1] !== undefined) flags[flag] = rest[++i]!
    } else if (!arg.startsWith('-')) positional.push(arg)
  }
  const raw = found.target?.startsWith('--')
    ? flags[found.target]
    : found.target === 'last'
      ? positional[positional.length - 1]
      : positional[0]
  const run: ProductRun = { product: script.product, script: name.replace(/\.sh$/, ''), verb }
  if (raw) {
    run.target = shortTarget(raw)
    run.ref = raw
  }
  return run
}

/** What a product step did, in words: "Data Hub: deployed universe 3f2a9c1e…". */
export const productWords = (
  run: { product: Product; script: string; verb: string; subject?: string },
  how: 'did' | 'doing' | 'failed',
): string => {
  const found = PRODUCT_SCRIPTS[`${run.script}.sh`]?.verbs[run.verb]
  const name = PRODUCT_NAMES[run.product]
  if (!found) return `${name}: ${run.script} ${run.verb}`.trim()
  const what = run.subject ? [found.noun, run.subject].filter(Boolean).join(' ') : found.noun ? `a ${found.noun}` : ''
  const phrase = (verb: string) => [verb, what].filter(Boolean).join(' ')
  if (how === 'did') return `${name}: ${phrase(found.did)}`
  if (how === 'doing') return `${name}: ${phrase(found.does)}…`
  return `${name}: couldn't ${phrase(found.does)}`
}

/**
 * The components a Marketplace install copied into the account, from its
 * output: after "Copied component IDs:", one "  <id> (v<version>)" line each.
 */
export const recipeComponents = (output: string): { componentId: string; version?: string }[] => {
  const at = output.indexOf('Copied component IDs:')
  if (at < 0) return []
  return [...output.slice(at).matchAll(/^\s+([0-9a-f][0-9a-f-]{7,})\s+\(v(\d+|\?)\)\s*$/gim)].map(m => ({
    componentId: m[1]!,
    ...(m[2] && m[2] !== '?' ? { version: m[2] } : {}),
  }))
}

// --- BDI flow runs ------------------------------------------------------------------

/** A BDI run's status, as BDI reports it: pending and running, then succeeded, failed, canceled or skipped. */
export type BdiRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'skipped'

/** The run ID a `bdi-flow.sh run` response carries. */
export const bdiRunId = (output: string): string | undefined => output.match(/"run_id"\s*:\s*"([^"]+)"/)?.[1]

/** A `bdi-flow.sh status <flow-id> <run-id>` in a command: Claude checking how a run went. */
export const bdiStatusChecks = (command: string): { flow: string; run: string }[] =>
  [...command.matchAll(/bdi-flow\.sh\s+status\s+(?:'|")?([^\s'";&|]+)(?:'|")?\s+(?:'|")?([^\s'";&|]+)/g)].map(m => ({ flow: m[1]!, run: m[2]! }))

/**
 * How a run went, from a status check's response: its status, and the
 * reason a failed one gives. BDI reports a cancelled run as failed with
 * "Run canceled"; that reads as cancelled. Undefined when the response
 * names no status.
 */
export const bdiRunReading = (output: string): { status: BdiRunStatus | string; reason?: string } | undefined => {
  let body: unknown
  try {
    body = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1))
  } catch {
    return undefined
  }
  const top = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const run = (top.run && typeof top.run === 'object' ? top.run : top) as Record<string, unknown>
  const raw = run.status ?? run.run_status
  if (typeof raw !== 'string' || !raw) return undefined
  const reason = typeof run.error_description === 'string' && run.error_description ? run.error_description : undefined
  const status = raw.toLowerCase()
  if (status === 'failed' && reason && /^run cancel+ed$/i.test(reason.trim())) return { status: 'canceled' }
  return reason ? { status, reason } : { status }
}
