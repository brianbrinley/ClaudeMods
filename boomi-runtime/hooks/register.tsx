// Provisions a temporary Boomi runtime in the session and hands it to Boomi
// Companion. Credentials come from Companion's .env and never leave this
// module: nothing here logs, stores or returns them.
// The lifecycle lives in this file because the engine follows $ only within it.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { RuntimeInfo, SmokeTest } from '../types'
import { credentialsFrom, parseEnv, setEnvValue } from './envfile'
import type { Credentials } from './envfile'
import {
  isNamedRuntimeHome,
  isRuntimeDir,
  linux,
  pickRuntimeHome,
  runtimeName,
  splitArgs,
  tail,
} from './linux'
import { platformClient } from './platform'
import type { PlatformClient } from './platform'
import { SMOKE_PROCESS, helloWorldProcess } from './smoke'

type Engine = EngineInterface

const runtime = atom({ plugin: 'boomi-runtime', key: 'runtime' } as const, {
  phase: 'idle',
  message: 'No runtime yet. Run /boomi up.',
  executions: [],
  log: [],
} as RuntimeInfo)

type Settings = {
  namePrefix: string
  installRoot: string
  envFile: string
  installerUrl: string
  installerArgs: string[]
  isEphemeral: boolean
}

const settingsFrom = (options: PluginOptions): Settings => ({
  namePrefix: String(options.namePrefix || 'cc'),
  installRoot: String(options.installRoot || ''),
  envFile: String(options.envFile || '.env'),
  installerUrl: String(
    options.installerUrl || 'https://platform.boomi.com/atom/atom_install64.sh',
  ),
  installerArgs: splitArgs(String(options.installerArgs || '')),
  isEphemeral: options.ephemeral !== false,
})

const ONLINE_TIMEOUT_MS = 10 * 60_000
const POLL_MS = 10_000
const SMOKE_TIMEOUT_MS = 5 * 60_000
const SELF_START_MS = 90_000
const PANE = 'boomi-runtime'

// The pane is a convenience: a surface that cannot seat one must not stop the work.
const openPane = ($: Engine) => {
  $.ui.open({ id: PANE, title: 'Boomi runtime' }).catch(() => undefined)
}

const patch = ($: Engine, change: Partial<RuntimeInfo>) =>
  update($, runtime, current => ({ ...current, ...change }))

const note = ($: Engine, line: string) =>
  update($, runtime, current => ({ ...current, log: [...current.log, line].slice(-200) }))

const isBusy = (info: RuntimeInfo) =>
  info.phase === 'installing' || info.phase === 'starting' || info.phase === 'stopping'

const envPath = async ($: Engine, settings: Settings) =>
  settings.envFile.startsWith('/')
    ? settings.envFile
    : `${await $.session.cwd()}/${settings.envFile}`

const installRoot = async ($: Engine, settings: Settings) =>
  settings.installRoot ||
  (await $.env.get('BOOMI_RUNTIME_ROOT')) ||
  `${(await $.env.get('HOME')) ?? '/tmp'}/.boomi-runtimes`

type Loaded = { credentials: Credentials; path: string; text: string }

// Variables a cloud environment can hold instead of a .env file. Each name is
// spelled out: the engine reads only literal names.
const processEnv = async ($: Engine): Promise<Record<string, string>> => {
  const values: Record<string, string | undefined> = {
    BOOMI_API_URL: await $.env.get('BOOMI_API_URL'),
    BOOMI_USERNAME: await $.env.get('BOOMI_USERNAME'),
    BOOMI_API_TOKEN: await $.env.get('BOOMI_API_TOKEN'),
    BOOMI_ACCOUNT_ID: await $.env.get('BOOMI_ACCOUNT_ID'),
    BOOMI_ENVIRONMENT_ID: await $.env.get('BOOMI_ENVIRONMENT_ID'),
    BOOMI_TARGET_FOLDER: await $.env.get('BOOMI_TARGET_FOLDER'),
  }
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])),
  )
}

/**
 * The credentials from Companion's .env, each missing one filled from the
 * process environment. With no .env, `text` is one seeded from those
 * variables, so the first write gives Companion a .env of its own.
 */
const loadEnv = async ($: Engine, settings: Settings): Promise<Loaded> => {
  const path = await envPath($, settings)
  const fallback = await processEnv($)
  const text = (await $.fs.exists(path))
    ? await $.fs.read(path)
    : Object.entries(fallback).reduce((seed, [key, value]) => setEnvValue(seed, key, value), '')
  const found = credentialsFrom({ ...fallback, ...parseEnv(text) })
  if ('missing' in found) {
    throw new Error(
      `missing ${found.missing.join(', ')}: set them in ${path} (/bc-integration:env-setup-guide) or as environment variables`,
    )
  }
  return { credentials: found.credentials, path, text }
}

const client = ($: Engine, credentials: Credentials) =>
  platformClient((url, init) => $.http.fetch(url, init), credentials)

/** Runs a command, streaming its output into the pane's log; resolves its exit code. */
const runLogged = async ($: Engine, argv: readonly string[], label: string) => {
  await note($, `$ ${label}`)
  const stream = $.process.spawn({ argv })
  let pending = ''
  for await (const { text } of stream) {
    const lines = (pending + text).split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) await note($, line)
  }
  if (pending.trim()) await note($, pending)
  const { code } = await stream.result
  return code ?? 1
}

const mustRun = async ($: Engine, argv: readonly string[], label: string) => {
  const code = await runLogged($, argv, label)
  if (code !== 0) throw new Error(`${label} exited with ${code}`)
}

/** The folder holding the runtime's bin/atom, wherever the installer put it. */
const locateRuntimeHome = async ($: Engine, dir: string, name: string) => {
  const home = (await $.env.get('HOME')) ?? '/root'
  const roots: string[] = []
  for (const root of [dir, ...linux.defaultRoots(home)]) {
    if (await $.fs.exists(root)) roots.push(root)
  }
  if (roots.length === 0) return undefined
  const found = await $.process.run(linux.findLaunchers(roots), { timeoutMs: 60_000 })
  const launchers = found.stdout.split('\n').filter(Boolean)
  return pickRuntimeHome(launchers, dir, name)
}

/**
 * Runs a command whose output goes to `logPath` (see linux.toLogFile), then
 * copies the log's last lines into the pane's log. Throws on a non-zero exit.
 */
const mustRunToFile = async (
  $: Engine,
  argv: readonly string[],
  label: string,
  logPath: string,
) => {
  const code = await runLogged($, linux.toLogFile(argv, logPath), label)
  const output = (await $.fs.exists(logPath)) ? tail(await $.fs.read(logPath), 40) : []
  for (const line of output) if (line.trim()) await note($, line)
  if (code !== 0) {
    throw new Error(`${label} exited with ${code}${output.length ? `: ${output.at(-1)}` : ''}`)
  }
}

/**
 * Installs, starts and registers a runtime, then points Companion at it.
 * Long-running: callers start it without awaiting and watch the state.
 */
/** Why `up` cannot start now, or undefined when it can. */
const upRefusal = (info: RuntimeInfo): string | undefined => {
  if (info.phase === 'online') return `${info.name} is already online.`
  if (isBusy(info)) return `${info.name} is ${info.phase}.`
  if (info.phase === 'error' && info.name) {
    return `${info.name} failed: ${info.message}\nRun /boomi down to clean it up before provisioning again.`
  }
  return undefined
}

const provision = async ($: Engine, settings: Settings): Promise<void> => {
  if (upRefusal(await read($, runtime))) return

  try {
    const { credentials } = await loadEnv($, settings)
    const platform = client($, credentials)
    const name = runtimeName(
      settings.namePrefix,
      await $.session.id(),
      new Date(await $.clock.now()),
    )
    const root = await installRoot($, settings)
    const dir = `${root}/${name}`
    openPane($)
    await patch($, {
      phase: 'installing',
      message: `Installing ${name}`,
      name,
      installDir: dir,
      runtimeHome: undefined,
      atomId: undefined,
      platformStatus: undefined,
      environmentId: undefined,
      isOwnEnvironment: undefined,
      smoke: undefined,
      executions: [],
      log: [],
    })
    await $.store.set(`runtime:${name}`, { dir, createdAt: await $.clock.now() })

    // 1. An installer token, and 2. an environment of the runtime's own.
    const token = await platform.createInstallerToken(60)
    await note($, 'Created an installer token (valid 60 minutes)')
    let environmentId: string
    try {
      environmentId = await platform.createEnvironment(name)
      await patch($, { environmentId, isOwnEnvironment: true })
      await note($, `Created environment ${name} (${environmentId})`)
    } catch (error) {
      if (!credentials.environmentId) throw error
      environmentId = credentials.environmentId
      await patch($, { environmentId, isOwnEnvironment: false })
      await note($, `Could not create an environment (${messageOf(error)}); using BOOMI_ENVIRONMENT_ID`)
    }

    // 3. The quiet install.
    await mustRun($, ['mkdir', '-p', root], `mkdir -p ${root}`)
    const installer = linux.installerPath(root)
    if (!(await $.fs.exists(installer))) {
      await mustRun($, linux.download(settings.installerUrl, installer), 'download installer')
      await mustRun($, linux.makeExecutable(installer), 'chmod +x installer')
    }
    // The command line holds the install token, so it is labelled, never echoed.
    await mustRunToFile(
      $,
      linux.install({
        installer,
        dir,
        name,
        accountId: credentials.accountId,
        token,
        extraArgs: settings.installerArgs,
      }),
      `install ${name} into ${dir}`,
      linux.installLog(root, name),
    )

    await patch($, { phase: 'starting', message: `Starting ${name}` })
    const home = await locateRuntimeHome($, dir, name)
    if (home) {
      await patch($, { runtimeHome: home })
      await note($, `Runtime folder: ${home}`)
    }

    // The quiet install starts the runtime itself: run bin/atom start only if
    // it has not registered as online after a short wait.
    const installedAt = await $.clock.now()
    let atom = await platform.findAtom(name)
    while (atom?.status !== 'ONLINE' && (await $.clock.now()) - installedAt < SELF_START_MS) {
      await $.clock.sleep(POLL_MS)
      atom = await platform.findAtom(name)
      await patch($, { platformStatus: atom?.status ?? 'not registered yet' })
    }
    if (atom?.status !== 'ONLINE') {
      if (!home) throw new Error(`found no bin/atom under ${dir} or the installer's default folders`)
      await mustRunToFile($, linux.start(home), `${linux.launcher(home)} start`, linux.startLog(root, name))
    }

    const startedAt = await $.clock.now()
    while (atom?.status !== 'ONLINE') {
      if ((await $.clock.now()) - startedAt > ONLINE_TIMEOUT_MS) {
        throw new Error(`${name} did not come online within 10 minutes`)
      }
      await $.clock.sleep(POLL_MS)
      atom = await platform.findAtom(name)
      await patch($, { platformStatus: atom?.status ?? 'not registered yet' })
    }
    await patch($, { atomId: atom.id, platformStatus: atom.status })

    // 4. Attach once the runtime has registered.
    await platform.attach(atom.id, environmentId)
    await note($, `Attached ${name} to environment ${environmentId}`)

    // Hand both to Companion, remembering what they pointed at before.
    const env = await loadEnv($, settings)
    let text = setEnvValue(env.text, 'BOOMI_TEST_ATOM_ID', atom.id)
    text = setEnvValue(text, 'BOOMI_ENVIRONMENT_ID', environmentId)
    await $.fs.write(env.path, text)
    await $.store.set(`runtime:${name}`, { dir, atomId: atom.id, environmentId, createdAt: startedAt })
    await patch($, {
      phase: 'online',
      message: `${name} is online`,
      previousAtomId: env.credentials.testAtomId,
      previousEnvironmentId: env.credentials.environmentId,
    })
    $.ui.toast(`Boomi runtime ${name} is online`)
  } catch (error) {
    await patch($, { phase: 'error', message: messageOf(error) })
    await note($, `error: ${messageOf(error)}`)
  }
}

/**
 * BOOMI_TARGET_FOLDER as a folder ID. A name or path is looked up, and the ID
 * written back to .env: Companion's scripts take only the ID.
 */
const targetFolderId = async (
  $: Engine,
  settings: Settings,
  platform: PlatformClient,
  value: string,
): Promise<string> => {
  const folder = await platform.resolveFolder(value)
  if (folder.id !== value) {
    await note($, `BOOMI_TARGET_FOLDER ${value} is folder ${folder.id} (${folder.fullPath})`)
    const env = await loadEnv($, settings)
    if (env.credentials.targetFolder === value) {
      await $.fs.write(env.path, setEnvValue(env.text, 'BOOMI_TARGET_FOLDER', folder.id))
    }
  }
  return folder.id
}

const setSmoke = ($: Engine, change: Partial<SmokeTest>) =>
  update($, runtime, current => ({
    ...current,
    smoke: { phase: 'running' as const, message: '', ...current.smoke, ...change },
  }))

/** 5–8: builds a hello-world process, deploys it, runs it and waits for the result. */
const smoke = async ($: Engine, settings: Settings): Promise<void> => {
  const info = await read($, runtime)
  if (info.phase !== 'online' || !info.atomId || !info.environmentId || !info.name) {
    await setSmoke($, { phase: 'failed', message: 'No online runtime: run /boomi up first.' })
    return
  }
  if (info.smoke?.phase === 'running') return
  const { atomId, environmentId } = info

  try {
    const { credentials } = await loadEnv($, settings)
    const platform = client($, credentials)
    await update($, runtime, current => ({
      ...current,
      smoke: { phase: 'running' as const, message: 'Finding the hello-world process' },
    }))

    const folderId = credentials.targetFolder
      ? await targetFolderId($, settings, platform, credentials.targetFolder)
      : undefined
    const existing = await platform.findComponent(SMOKE_PROCESS, folderId)
    const componentId =
      existing ?? (await platform.createComponent(helloWorldProcess(SMOKE_PROCESS, folderId)))
    await setSmoke($, { componentId, message: 'Packaging' })
    await note($, `Smoke: ${existing ? 'reusing' : 'created'} process ${componentId}`)

    const packageId = await platform.packageComponent(componentId, `smoke-${await $.clock.now()}`)
    await setSmoke($, { packageId, message: 'Deploying' })

    const deploymentId = await platform.deploy(packageId, environmentId)
    await setSmoke($, { deploymentId, message: 'Executing' })
    await note($, `Smoke: deployed package ${packageId} to ${environmentId}`)

    // The runtime picks the deployment up on its own schedule: retry the
    // execute call briefly rather than fail on the first refusal.
    let requestId: string | undefined
    for (let attempt = 1; requestId === undefined; attempt++) {
      try {
        requestId = await platform.execute(componentId, atomId)
      } catch (error) {
        if (attempt >= 6) throw error
        await $.clock.sleep(POLL_MS)
      }
    }
    await setSmoke($, { requestId, message: 'Waiting for the execution' })

    const startedAt = await $.clock.now()
    let outcome = await platform.executionOutcome(requestId)
    while (outcome === undefined) {
      if ((await $.clock.now()) - startedAt > SMOKE_TIMEOUT_MS) {
        throw new Error('the execution did not finish within 5 minutes')
      }
      await $.clock.sleep(5_000)
      outcome = await platform.executionOutcome(requestId)
    }

    const hasPassed = outcome.status === 'COMPLETE'
    await setSmoke($, {
      phase: hasPassed ? 'passed' : 'failed',
      executionId: outcome.executionId,
      status: outcome.status,
      message: hasPassed
        ? `Hello world ran: ${outcome.executionId}`
        : `Execution ${outcome.executionId} ended ${outcome.status}`,
    })
    await note($, `Smoke: execution ${outcome.executionId} ${outcome.status}`)
    await refresh($, settings)
  } catch (error) {
    await setSmoke($, { phase: 'failed', message: messageOf(error) })
    await note($, `Smoke error: ${messageOf(error)}`)
  }
}

/** 9: undeploys the smoke test, stops and deletes the runtime and its environment. */
const teardown = async ($: Engine, settings: Settings): Promise<string> => {
  const info = await read($, runtime)
  if (!info.name) return 'No runtime to tear down.'
  if (info.phase === 'stopping') return `${info.name} is already stopping.`

  await patch($, { phase: 'stopping', message: `Stopping ${info.name}` })
  const problems: string[] = []
  const attempt = async (label: string, work: () => Promise<unknown>) => {
    try {
      await work()
      await note($, label)
    } catch (error) {
      problems.push(`${label}: ${messageOf(error)}`)
    }
  }
  const dir = info.installDir

  const home = info.runtimeHome ?? dir
  if (home && (await $.fs.exists(linux.launcher(home)))) {
    const code = await runLogged($, linux.stop(home), `${linux.launcher(home)} stop`)
    if (code !== 0) problems.push(`stop exited with ${code}`)
  }

  try {
    const env = await loadEnv($, settings)
    const platform = client($, env.credentials)
    const { smoke: test } = info
    if (test?.deploymentId) {
      await attempt('Undeployed the smoke test', () => platform.undeploy(test.deploymentId ?? ''))
    }
    const atomId = info.atomId ?? (await platform.findAtom(info.name))?.id
    if (atomId) {
      await attempt(`Deleted runtime ${info.name}`, () => platform.deleteAtom(atomId))
    }
    if (info.isOwnEnvironment && info.environmentId) {
      const environmentId = info.environmentId
      await attempt(`Deleted environment ${environmentId}`, () =>
        platform.deleteEnvironment(environmentId),
      )
    }

    // Point Companion back at what it used before, unless someone changed it since.
    let text = env.text
    if (atomId && env.credentials.testAtomId === atomId) {
      text = setEnvValue(text, 'BOOMI_TEST_ATOM_ID', info.previousAtomId)
    }
    if (info.isOwnEnvironment && env.credentials.environmentId === info.environmentId) {
      text = setEnvValue(text, 'BOOMI_ENVIRONMENT_ID', info.previousEnvironmentId)
    }
    if (text !== env.text) await $.fs.write(env.path, text)
  } catch (error) {
    problems.push(messageOf(error))
  }

  const root = await installRoot($, settings)
  const leftovers = [dir, linux.installLog(root, info.name), linux.startLog(root, info.name)]
  if (info.runtimeHome && info.runtimeHome !== dir && isNamedRuntimeHome(info.runtimeHome, info.name)) {
    leftovers.push(info.runtimeHome)
  }
  for (const path of leftovers) {
    if (!path) continue
    const isOurs =
      isRuntimeDir(path, root, settings.namePrefix) ||
      (path === info.runtimeHome && isNamedRuntimeHome(path, info.name))
    if (!isOurs) continue
    const code = await runLogged($, linux.remove(path), `rm -rf ${path}`)
    if (code !== 0) problems.push(`removing ${path} exited with ${code}`)
  }
  await $.store.delete(`runtime:${info.name}`)

  const message =
    problems.length === 0
      ? `${info.name} torn down.`
      : `${info.name} torn down with problems: ${problems.join('; ')}`
  await patch($, {
    phase: problems.length === 0 ? 'idle' : 'error',
    message,
    atomId: undefined,
    platformStatus: undefined,
    environmentId: undefined,
    isOwnEnvironment: undefined,
    smoke: undefined,
    executions: [],
  })
  return message
}

/** Refreshes the platform's view of the runtime and its latest executions. */
const refresh = async ($: Engine, settings: Settings): Promise<void> => {
  const info = await read($, runtime)
  if (info.phase !== 'online' || !info.atomId) return
  try {
    const { credentials } = await loadEnv($, settings)
    const platform = client($, credentials)
    const atom = await platform.findAtom(info.name ?? '')
    const executions = await platform.recentExecutions(info.atomId)
    await patch($, {
      platformStatus: atom?.status ?? 'missing',
      executions: executions.map(run => ({
        id: run.executionId,
        process: run.processName,
        status: run.status,
        at: run.executionTime,
      })),
    })
  } catch (error) {
    await note($, `refresh: ${messageOf(error)}`)
  }
}

/** Deletes offline runtimes carrying this mod's prefix, the current one excepted. */
const reap = async ($: Engine, settings: Settings): Promise<string> => {
  const { credentials } = await loadEnv($, settings)
  const platform = client($, credentials)
  const current = await read($, runtime)
  const prefix = `${settings.namePrefix}-`
  const stale = (await platform.atomsNamedLike(prefix)).filter(
    atom =>
      atom.name.startsWith(prefix) && atom.status === 'OFFLINE' && atom.id !== current.atomId,
  )
  for (const atom of stale) await platform.deleteAtom(atom.id)
  return stale.length === 0
    ? `No offline runtimes named ${prefix}*.`
    : `Deleted ${stale.length}: ${stale.map(atom => atom.name).join(', ')}`
}

/** The last lines of the runtime's newest log file. */
const logs = async ($: Engine, lines: number): Promise<string> => {
  const info = await read($, runtime)
  const home = info.runtimeHome ?? info.installDir
  if (!home) return 'No runtime installed.'
  const folder = linux.logsDir(home)
  if (!(await $.fs.exists(folder))) return `No log folder yet at ${folder}.`
  const newest = (await $.fs.list(folder))
    .filter(entry => entry.kind === 'file' && entry.name.endsWith('.log'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  if (!newest) return `No log files in ${folder}.`
  const text = await $.fs.read(`${folder}/${newest.name}`)
  return [`${folder}/${newest.name}:`, ...tail(text, lines)].join('\n')
}

/** Checks what provisioning needs, one line per check. */
const doctor = async ($: Engine, settings: Settings): Promise<string> => {
  const lines: string[] = []
  const check = (isOk: boolean, label: string) => lines.push(`${isOk ? '✓' : '✗'} ${label}`)

  const os = await $.process.run(['uname', '-sm']).catch(() => undefined)
  check(os?.stdout.startsWith('Linux') === true, `Linux host (${os?.stdout.trim() || 'unknown'})`)

  const curl = await $.process.run(['curl', '--version']).catch(() => undefined)
  check(curl?.exitCode === 0, 'curl available')

  const root = await installRoot($, settings)
  check(true, `install root ${root}`)

  let credentials: Credentials | undefined
  try {
    credentials = (await loadEnv($, settings)).credentials
    check(true, `credentials found (${await envPath($, settings)} or environment variables)`)
    check(
      true,
      credentials.environmentId
        ? `creates its own environment; falls back to ${credentials.environmentId}`
        : 'creates its own environment (no BOOMI_ENVIRONMENT_ID to fall back to)',
    )
  } catch (error) {
    check(false, messageOf(error))
  }

  if (credentials) {
    try {
      await client($, credentials).findAtom('__boomi_runtime_doctor__')
      check(true, `Platform API reachable at ${credentials.apiUrl}`)
    } catch (error) {
      check(false, `Platform API: ${messageOf(error)}`)
    }
    if (credentials.targetFolder) {
      try {
        const folder = await client($, credentials).resolveFolder(credentials.targetFolder)
        check(true, `BOOMI_TARGET_FOLDER is ${folder.fullPath} (${folder.id})`)
      } catch (error) {
        check(false, `BOOMI_TARGET_FOLDER: ${messageOf(error)}`)
      }
    }
  }

  const head = await $.process
    .run(['curl', '-sSfI', '--max-time', '20', settings.installerUrl], { timeoutMs: 30_000 })
    .catch(() => undefined)
  check(
    head?.exitCode === 0,
    head?.exitCode === 0
      ? `installer reachable at ${settings.installerUrl}`
      : `installer unreachable at ${settings.installerUrl}: ${head?.stderr.trim() || 'no answer'}`,
  )
  return lines.join('\n')
}

const summarize = (info: RuntimeInfo): string =>
  [
    `phase: ${info.phase}`,
    `message: ${info.message}`,
    info.name && `name: ${info.name}`,
    info.atomId && `atomId: ${info.atomId}`,
    info.platformStatus && `platform status: ${info.platformStatus}`,
    info.environmentId && `environment: ${info.environmentId}`,
    info.installDir && `install dir: ${info.installDir}`,
    info.runtimeHome && info.runtimeHome !== info.installDir && `runtime folder: ${info.runtimeHome}`,
    info.smoke && `smoke test: ${info.smoke.phase}: ${info.smoke.message}`,
    ...info.executions.map(run => `execution ${run.at} ${run.status} ${run.process} (${run.id})`),
  ]
    .filter(Boolean)
    .join('\n')

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Valence status colors: fixed, and always shown with an icon and a label.
const STATUS = {
  healthy: { icon: '✓', color: '#0CA30C' },
  warning: { icon: '◐', color: '#FAB219' },
  serious: { icon: '⚠', color: '#EC835A' },
  critical: { icon: '✗', color: '#D03B3B' },
} as const

const SMOKE = {
  running: STATUS.warning,
  passed: STATUS.healthy,
  failed: STATUS.critical,
} as const

const statusOf = (info: RuntimeInfo) => {
  if (info.phase === 'error') return { ...STATUS.critical, label: 'error' }
  if (info.phase === 'online') {
    return info.platformStatus && info.platformStatus !== 'ONLINE'
      ? { ...STATUS.serious, label: info.platformStatus.toLowerCase() }
      : { ...STATUS.healthy, label: 'online' }
  }
  if (info.phase === 'idle') return undefined
  return { ...STATUS.warning, label: info.phase }
}

const statusLine = (info: RuntimeInfo) => {
  const status = statusOf(info)
  return status && `Boomi ${status.icon} ${status.label}${info.name ? ` · ${info.name}` : ''}`
}

const USAGE = [
  '/boomi up       install, start and register a runtime; point Companion at it',
  '/boomi status   show the runtime and open its pane',
  '/boomi smoke    deploy and run a hello-world process; wait for it to complete',
  '/boomi logs [n] the last n lines of the runtime log (default 40)',
  '/boomi down     stop it, delete it from the platform, remove its files',
  '/boomi reap     delete offline runtimes left by earlier sessions',
  '/boomi doctor   check what provisioning needs',
].join('\n')

export const register: Register = (on, options) => {
  const settings = settingsFrom(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'boomi',
      description: 'Temporary Boomi runtime for this session',
      argumentHint: 'up | smoke | status | logs [n] | down | reap | doctor',
    })
    await $.tool.register({
      name: 'up',
      description:
        'Install, start and register a temporary Boomi runtime in this session, then write its ID to BOOMI_TEST_ATOM_ID in Boomi Companion\'s .env. Returns at once; installing takes several minutes, so poll the status tool until phase is online or error.',
    })
    await $.tool.register({
      name: 'smoke',
      description:
        'Prove the temporary Boomi runtime works: create a hello-world process, deploy it to the runtime\'s environment, execute it and wait for the result. Returns at once; poll the status tool until the smoke test reads passed or failed.',
    })
    await $.tool.register({
      name: 'status',
      description:
        'The temporary Boomi runtime: phase (idle, installing, starting, online, stopping, error), name, atom ID, platform status and recent executions.',
    })
    await $.tool.register({
      name: 'logs',
      description: 'The last lines of the temporary Boomi runtime\'s newest log file.',
      inputSchema: {
        type: 'object',
        properties: { lines: { type: 'number', description: 'How many lines (default 40)' } },
      },
    })
    await $.tool.register({
      name: 'down',
      description:
        'Stop the temporary Boomi runtime, delete it from the platform, restore BOOMI_TEST_ATOM_ID and remove its files.',
    })
    await $.tool.register({
      name: 'doctor',
      description: 'Check what provisioning a Boomi runtime needs: host, credentials, network.',
    })

    $.clock.every(2_000, async () => $.ui.status(statusLine(await read($, runtime))))
    $.clock.every(30_000, () => refresh($, settings))
    return started
  })

  on('command.run', { command: 'boomi' }, async ($, e) => {
    const [action = 'status', count] = e.args.trim().split(/\s+/)
    try {
      switch (action) {
        case 'up': {
          const refusal = upRefusal(await read($, runtime))
          if (refusal) return { text: refusal }
          void provision($, settings)
          openPane($)
          return { text: 'Provisioning started. Progress is in the Boomi runtime pane.' }
        }
        case 'smoke':
          void smoke($, settings)
          openPane($)
          return { text: 'Smoke test started. Progress is in the Boomi runtime pane.' }
        case 'down':
          return { text: await teardown($, settings) }
        case 'logs':
          return { text: await logs($, Number(count) || 40) }
        case 'reap':
          return { text: await reap($, settings) }
        case 'doctor':
          return { text: await doctor($, settings) }
        case 'status':
          openPane($)
          return { text: summarize(await read($, runtime)) }
        default:
          return { text: USAGE }
      }
    } catch (error) {
      return { text: `boomi ${action}: ${messageOf(error)}` }
    }
  })

  on('tool.call', { tool: 'mcp__boomi-runtime__up' }, async $ => {
    const before = await read($, runtime)
    const refusal = upRefusal(before)
    if (refusal) return { result: `${refusal}\n${summarize(before)}` }
    void provision($, settings)
    openPane($)
    return { result: 'Provisioning started. Poll the status tool until phase is online or error.' }
  })

  on('tool.call', { tool: 'mcp__boomi-runtime__smoke' }, async $ => {
    void smoke($, settings)
    return { result: 'Smoke test started. Poll the status tool until it reads passed or failed.' }
  })

  on('tool.call', { tool: 'mcp__boomi-runtime__status' }, async $ => ({
    result: summarize(await read($, runtime)),
  }))

  on('tool.call', { tool: 'mcp__boomi-runtime__logs' }, async ($, e) => {
    const lines = Number((e as { lines?: unknown }).lines) || 40
    return { result: await logs($, lines) }
  })

  on('tool.call', { tool: 'mcp__boomi-runtime__down' }, async $ => ({
    result: await teardown($, settings),
  }))

  on('tool.call', { tool: 'mcp__boomi-runtime__doctor' }, async $ => ({
    result: await doctor($, settings),
  }))

  on('session.end', async ($, e, next) => {
    const info = await read($, runtime)
    if (settings.isEphemeral && info.name && e.reason !== 'clear') {
      await teardown($, settings).catch(() => undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const info = await read($, runtime)
    const status = statusOf(info)
    const smokeStatus = info.smoke && SMOKE[info.smoke.phase]
    const room = Math.max(3, (e.viewport?.rows ?? 30) - 12 - info.executions.length)

    return (
      <Box flexDirection="column">
        {status ? (
          <Text bold color={status.color}>
            {status.icon} {status.label}
          </Text>
        ) : (
          <Text dimColor>No runtime</Text>
        )}
        <Text>{info.message}</Text>
        {info.name && <Text dimColor>name     {info.name}</Text>}
        {info.atomId && <Text dimColor>atom ID  {info.atomId}</Text>}
        {info.platformStatus && <Text dimColor>platform {info.platformStatus}</Text>}
        {info.environmentId && <Text dimColor>env      {info.environmentId}</Text>}
        {smokeStatus && info.smoke && (
          <Text color={smokeStatus.color}>
            {smokeStatus.icon} smoke test {info.smoke.phase}: {info.smoke.message}
          </Text>
        )}
        {info.executions.length > 0 && <Text bold>Recent executions</Text>}
        {info.executions.map(run => (
          <Text>
            {run.status} {run.process} <Text dimColor>{run.at}</Text>
          </Text>
        ))}
        {info.log.length > 0 && <Text bold>Log</Text>}
        {info.log.slice(-room).map(line => (
          <Text dimColor>{line}</Text>
        ))}
      </Box>
    )
  })
}
