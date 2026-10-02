import type { CommandRunInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const boomi = (args: string) => ({ command: 'boomi', args }) as CommandRunInput

test('/boomi lists its actions and status starts idle', async $ => {
  const usage = await $.command.run(boomi('help'))
  expect(usage.text).toContain('/boomi up')
  expect(usage.text).toContain('/boomi smoke')

  const status = await $.command.run(boomi('status'))
  expect(status.text).toContain('phase: idle')
})

test('the smoke test refuses without an online runtime', async $ => {
  await $.command.run(boomi('smoke'))
  const status = await $.command.run(boomi('status'))
  expect(status.text).toContain('smoke test: failed: No online runtime')
})

test('the guard refuses a tool call that would print the environment', async ($, on) => {
  let ran = false
  on('tool.call', { tool: 'Bash' }, async () => {
    ran = true
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  const answer = await $.tool.call({ tool: 'Bash', command: 'printenv' })
  expect(answer.deny).toContain('boomi-runtime')
  expect(ran).toBe(false)
})

test('the guard lets ordinary tool calls through', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, async () => ({
    result: { stdout: 'clean', stderr: '', interrupted: false },
  }))
  const answer = await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(answer.deny).toBeUndefined()
})

test('the guard withholds output that contains the token', async ($, on) => {
  const token = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  mock.env(on, { BOOMI_API_TOKEN: token, BOOMI_USERNAME: 'me@example.com' })
  on('tool.call', { tool: 'Bash' }, async () => ({
    result: { stdout: `deploy log: auth ${token}`, stderr: '', interrupted: false },
  }))
  const answer = await $.tool.call({ tool: 'Bash', command: 'bash scripts/boomi-deploy.sh' })
  expect(answer.deny).toContain('withheld')
  expect(JSON.stringify(answer)).not.toContain(token)
})
