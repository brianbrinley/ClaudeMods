import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const dashboard = (args = '') => ({ command: 'bc-dashboard', args }) as CommandRunInput
const SECURE = 'f00dbabe-1111-2222-3333-444455556666'
const ID = '1a2b3c4d-1111-2222-3333-444455556666'
const NOW = Date.parse('2026-10-12T12:00:00Z')

/** Lets the work a step leaves running (the status line, the saved steps) finish before the test ends. */
const settle = async ($: { command: { run: (input: CommandRunInput) => Promise<unknown> } }) => {
  for (let i = 0; i < 3; i++) await $.command.run(dashboard('text'))
}

/** A workspace whose .env has everything but the token, which lives in secure storage. */
const workspace = (on: On) => {
  const files: Record<string, string> = {
    '/work/.env': 'BOOMI_API_URL=https://api.boomi.com\nBOOMI_USERNAME=me@example.com\nBOOMI_ACCOUNT_ID=acct\nBOOMI_ENVIRONMENT_ID=env\n',
    '/work/scripts/boomi-execution-query.sh': '',
  }
  on('fs.exists', async (_$, e) => ({ value: e.path in files }))
  on('fs.read', async (_$, e) => (files[e.path] === undefined ? { deny: 'ENOENT' } : { value: files[e.path]! }))
  on('session.cwd', async () => ({ value: '/work' }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: false as const, reason: 'tests' } }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }))
  mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, {})
}

test('with the token in secure storage, the dashboard reaches Boomi without one in .env', { options: { apiToken: SECURE } }, async ($, on) => {
  workspace(on)
  const auth: string[] = []
  on('http.fetch', async (_$, e) => {
    auth.push(String((e.init?.headers as Record<string, string> | undefined)?.Authorization ?? ''))
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ result: e.url.endsWith('EnvironmentAtomAttachment/query') ? [{ atomId: 'a1' }] : [] }) } }
  })
  const text = await $.command.run(dashboard('poll'))
  expect(text.text).not.toContain('Not connected')
  const expected = `Basic ${btoa(`BOOMI_TOKEN.me@example.com:${SECURE}`)}`
  expect(auth.length).toBeGreaterThan(0)
  expect(auth.every(a => a === expected)).toBe(true)
  await settle($)
})

test('Run again hands the secure token to that one script, in its environment, never its arguments', { options: { apiToken: SECURE } }, async ($, on) => {
  workspace(on)
  on('http.fetch', async () => ({ value: { status: 200, ok: true, headers: {}, text: '{"result":[]}' } }))
  on('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: 'Execution completed: status=ERROR, executionId=execution-1', stderr: '', interrupted: false } }))
  const runs: { argv: string[]; env?: Record<string, string> }[] = []
  on('process.run', async (_$, e) => {
    runs.push({ argv: [...e.argv], env: e.init?.env })
    return { value: { exitCode: 0, stdout: 'Execution completed: status=COMPLETE, executionId=execution-2', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
  await $.command.run(dashboard('rerun 1'))
  expect(runs).toHaveLength(1)
  expect(runs[0]!.env).toEqual({ BOOMI_API_TOKEN: SECURE })
  expect(runs[0]!.argv.join(' ')).not.toContain(SECURE)
  await settle($)
})

test('without the secure setting, scripts run with the environment as it is', async ($, on) => {
  workspace(on)
  on('http.fetch', async () => ({ value: { status: 200, ok: true, headers: {}, text: '{"result":[]}' } }))
  on('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: 'Execution completed: status=ERROR, executionId=execution-1', stderr: '', interrupted: false } }))
  const envs: (Record<string, string> | undefined)[] = []
  on('process.run', async (_$, e) => {
    envs.push(e.init?.env)
    return { value: { exitCode: 0, stdout: 'Execution completed: status=COMPLETE, executionId=execution-2', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.tool.call({ tool: 'Bash', command: `bash scripts/boomi-test-execute.sh --process-id ${ID}` })
  await $.command.run(dashboard('rerun 1'))
  expect(envs).toEqual([undefined])
  await settle($)
})
