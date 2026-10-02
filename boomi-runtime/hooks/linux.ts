// The Linux runtime: how it is named, installed, started, stopped and removed.
// Other platforms (Windows, containers) are meant to sit beside this file with
// the same shape.

export const runtimeName = (prefix: string, sessionId: string, now: Date): string => {
  const date = now.toISOString().slice(0, 10).replaceAll('-', '')
  const session = sessionId.replace(/[^A-Za-z0-9]/g, '').slice(-8)
  return `${prefix}-${date}-${session}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
}

export const splitArgs = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean)

/** True when `dir` is a runtime folder this mod made: one level under `root`. */
export const isRuntimeDir = (dir: string, root: string, prefix: string): boolean => {
  const base = root.replace(/\/+$/, '')
  if (!base.startsWith('/') || base === '' || !dir.startsWith(`${base}/`)) return false
  const rest = dir.slice(base.length + 1)
  return !rest.includes('/') && rest.startsWith(`${prefix}-`) && !rest.includes('..')
}

export type InstallRequest = {
  installer: string
  dir: string
  name: string
  accountId: string
  token: string
  extraArgs: string[]
}

export const linux = {
  installerPath: (root: string) => `${root}/atom_install64.sh`,
  download: (url: string, dest: string) => ['curl', '-fsSL', '--retry', '3', '-o', dest, url],
  makeExecutable: (path: string) => ['chmod', '+x', path],
  install: (request: InstallRequest) => [
    request.installer,
    '-q',
    '-console',
    '-dir',
    request.dir,
    `-VatomName=${request.name}`,
    `-VaccountId=${request.accountId}`,
    `-VinstallToken=${request.token}`,
    ...request.extraArgs,
  ],
  launcher: (dir: string) => `${dir}/bin/atom`,
  /** Finds bin/atom under `roots`; the quiet installer may not use -dir as is. */
  findLaunchers: (roots: readonly string[]) => [
    'find',
    ...roots,
    '-maxdepth',
    '4',
    '-path',
    '*/bin/atom',
    '-type',
    'f',
  ],
  /** Where install4j installers put a runtime when they ignore -dir. */
  defaultRoots: (home: string) => [`${home}/Boomi AtomSphere`, '/opt/Boomi AtomSphere'],
  start: (dir: string) => [`${dir}/bin/atom`, 'start'],
  stop: (dir: string) => [`${dir}/bin/atom`, 'stop'],
  remove: (dir: string) => ['rm', '-rf', '--', dir],
  /**
   * Runs `argv` with its output sent to `logPath` instead of the caller's pipe.
   * `bin/atom start` (and a quiet install that starts the runtime) leaves a
   * daemon holding whatever stdout it was given: on a pipe, the caller would
   * wait for an end that never comes.
   */
  toLogFile: (argv: readonly string[], logPath: string) => [
    'sh',
    '-c',
    'log="$1"; shift; "$@" >"$log" 2>&1 </dev/null',
    'sh',
    logPath,
    ...argv,
  ],
  installLog: (root: string, name: string) => `${root}/${name}-install.log`,
  startLog: (root: string, name: string) => `${root}/${name}-start.log`,
  logsDir: (dir: string) => `${dir}/logs`,
}

/**
 * The runtime folder for `name` among `launchers` (paths ending in /bin/atom):
 * one inside `dir` first, then one whose path names the runtime.
 */
export const pickRuntimeHome = (
  launchers: readonly string[],
  dir: string,
  name: string,
): string | undefined => {
  const homes = launchers.map(path => path.replace(/\/bin\/atom$/, ''))
  return homes.find(home => home === dir || home.startsWith(`${dir}/`)) ??
    homes.find(home => (home.split('/').pop() ?? '').includes(name))
}

/** True when `home` is a folder named for runtime `name`, safe to delete. */
export const isNamedRuntimeHome = (home: string, name: string): boolean => {
  const last = home.replace(/\/+$/, '').split('/').pop() ?? ''
  return home.startsWith('/') && name.length > 0 && last.includes(name) && !home.includes('..')
}

/** The last `count` lines of `text`, without a trailing blank line. */
export const tail = (text: string, count: number): string[] =>
  text.replace(/\s+$/, '').split(/\r?\n/).slice(-count)
