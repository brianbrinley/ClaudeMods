import type { CommandRunInput, On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { hasTokenLine, runsCompanionScript, tokenSource } from '../hooks/tokens'

const boomi = (args: string) => ({ command: 'boomi', args }) as CommandRunInput
const SECURE = 'f00dbabe-1111-2222-3333-444455556666'
const KEY = 'BOOMI_API_TOKEN'

test('a Companion script run is told apart from other commands', () => {
  expect(runsCompanionScript('bash /x/skills/boomi-integration/scripts/boomi-deploy.sh a.xml')).toBe(true)
  expect(runsCompanionScript('cd ws && bash "$S/boomi-test-execute.sh" --process-id 1')).toBe(true)
  expect(runsCompanionScript('bash /x/scripts/event-streams-setup.sh create-topic orders')).toBe(true)
  expect(runsCompanionScript('git status')).toBe(false)
  expect(runsCompanionScript('ls my-boomi-deploy.shelf')).toBe(false)
})

test('a .env line assigns the token even when empty; a comment does not', () => {
  expect(hasTokenLine(`BOOMI_API_URL=x\n${KEY}=\n`)).toBe(true)
  expect(hasTokenLine(`export ${KEY}=abc`)).toBe(true)
  expect(hasTokenLine(`# ${KEY}=abc\nBOOMI_USERNAME=me`)).toBe(false)
})

test('the secure setting comes first, then .env, then the environment', () => {
  expect(tokenSource(SECURE, { [KEY]: 'file' }, 'env')).toBe('secure setting')
  expect(tokenSource('', { [KEY]: 'file' }, 'env')).toBe('.env')
  expect(tokenSource('', {}, 'env')).toBe('environment')
  expect(tokenSource('', {}, undefined)).toBe('none')
})

/** An environment the plugin can read and change, with every change recorded. */
const environment = (on: On, start: Record<string, string> = {}) => {
  const vars = new Map(Object.entries(start))
  const changes: (string | undefined)[] = []
  on('env.get', async (_$, e) => ({ value: vars.get(e.name) }))
  on('env.set', async (_$, e) => {
    if (e.name === KEY) changes.push(e.value)
    if (e.value === undefined) vars.delete(e.name)
    else vars.set(e.name, e.value)
    return { value: undefined }
  })
  return { vars, changes }
}

/** The shell beneath the plugins: records the token each command could see. */
const shell = (on: On, vars: Map<string, string>) => {
  const seen: (string | undefined)[] = []
  on('tool.call', { tool: 'Bash' }, async () => {
    seen.push(vars.get(KEY))
    return { result: { stdout: 'SUCCESS: done', stderr: '', interrupted: false } }
  })
  return seen
}

test('with the secure setting, a Companion script gets the token only while it runs', { options: { apiToken: SECURE } }, async ($, on) => {
  const { vars, changes } = environment(on)
  const seen = shell(on, vars)
  await $.tool.call({ tool: 'Bash', command: 'bash scripts/boomi-component-push.sh a.xml' })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(seen).toEqual([SECURE, undefined])
  expect(changes).toEqual([SECURE, undefined])
  expect(vars.has(KEY)).toBe(false)
})

test('a token already in the environment is put back afterwards', { options: { apiToken: SECURE } }, async ($, on) => {
  const { vars } = environment(on, { [KEY]: 'from-the-cloud-environment-0000' })
  const seen = shell(on, vars)
  await $.tool.call({ tool: 'Bash', command: 'bash scripts/boomi-deploy.sh a.xml' })
  expect(seen).toEqual([SECURE])
  expect(vars.get(KEY)).toBe('from-the-cloud-environment-0000')
})

test('the token is taken out again even when the script fails', { options: { apiToken: SECURE } }, async ($, on) => {
  const { vars } = environment(on)
  on('tool.call', { tool: 'Bash' }, async () => ({ isError: true as const, result: 'ERROR: boom', text: 'ERROR: boom' }))
  await $.tool.call({ tool: 'Bash', command: 'bash scripts/boomi-deploy.sh a.xml' })
  expect(vars.has(KEY)).toBe(false)
})

test('the guard withholds output that shows the secure token', { options: { apiToken: SECURE } }, async ($, on) => {
  const { vars } = environment(on)
  on('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: `debug ${vars.get(KEY)}`, stderr: '', interrupted: false } }))
  const answer = await $.tool.call({ tool: 'Bash', command: 'bash scripts/boomi-deploy.sh a.xml' })
  expect(answer.deny).toContain('withheld')
  expect(JSON.stringify(answer)).not.toContain(SECURE)
})

test('without the secure setting, nothing is put in the environment', async ($, on) => {
  const { vars, changes } = environment(on)
  shell(on, vars)
  await $.tool.call({ tool: 'Bash', command: 'bash scripts/boomi-deploy.sh a.xml' })
  expect(changes).toEqual([])
})

test('/boomi doctor says where the token comes from, and flags a .env line that would override it', { options: { apiToken: SECURE } }, async ($, on) => {
  environment(on, { BOOMI_API_URL: 'https://api.boomi.com', BOOMI_USERNAME: 'me@example.com', BOOMI_ACCOUNT_ID: 'acct' })
  let envText = 'BOOMI_ACCOUNT_ID=acct\n'
  on('session.cwd', async () => ({ value: '/work' }))
  on('fs.exists', async (_$, e) => ({ value: e.path === '/work/.env' }))
  on('fs.read', async () => ({ value: envText }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: 'Linux x86_64', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('http.fetch', async () => ({ value: { status: 200, ok: true, headers: {}, text: '{"numberOfResults":0}' } }))
  const clean = await $.command.run(boomi('doctor'))
  expect(clean.text).toContain("✓ API token in Claude Code's secure storage")
  expect(clean.text).not.toContain(SECURE)
  envText = `BOOMI_ACCOUNT_ID=acct\n${KEY}=\n`
  const flagged = await $.command.run(boomi('doctor'))
  expect(flagged.text).toContain(`✗ API token in secure storage, but Delete the ${KEY} line`)
})
