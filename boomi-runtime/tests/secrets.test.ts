import { describe, expect, test } from 'claude-code/testing'

import { REDACTED, containsSecret, guardReason, maskEnv, redact, secretValues } from '../hooks/secrets'

const TOKEN = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

describe('the token guard', () => {
  const bash = (command: string) => guardReason('Bash', { command })

  test('refuses shell commands that would print the token', () => {
    for (const command of [
      'cat .env',
      'cat ./.env',
      'grep BOOMI .env',
      'source .env && curl x',
      'less /home/user/ClaudeMods/.env',
      'cat .env.local',
      'echo $BOOMI_API_TOKEN',
      'echo "${BOOMI_API_TOKEN}"',
      'printenv',
      'printenv BOOMI_USERNAME',
      'env',
      'env | grep BOOMI',
      'sudo env',
      'ls && env',
      'echo $(env)',
      'set',
      'export -p',
      'declare -p | grep x',
      'cat /proc/self/environ',
      'cat /proc/1234/environ',
    ]) {
      expect(bash(command)).toBeDefined()
    }
  })

  test('lets ordinary commands run', () => {
    for (const command of [
      'git status',
      'cat README.md',
      'bash skills/boomi-integration/scripts/boomi-deploy.sh "My Process"',
      'env FOO=1 node build.js',
      'node -e "console.log(process.env.HOME)"',
      'cp .env.example .env.example.bak',
      'cat .env.example',
      'set -euo pipefail; make',
      'export PATH=$PATH:/opt/bin',
      'ls -la',
      'grep -r environment docs/',
    ]) {
      expect(bash(command)).toBeUndefined()
    }
  })

  test('refuses reading or searching a .env file, but not a template', () => {
    expect(guardReason('Read', { file_path: '/home/user/ClaudeMods/.env' })).toBeDefined()
    expect(guardReason('Read', { file_path: '.env.production' })).toBeDefined()
    expect(guardReason('Read', { file_path: '/proc/self/environ' })).toBeDefined()
    expect(guardReason('Read', { file_path: '/home/user/ClaudeMods/.env.example' })).toBeUndefined()
    expect(guardReason('Read', { file_path: '/home/user/ClaudeMods/README.md' })).toBeUndefined()
    expect(guardReason('Grep', { pattern: 'BOOMI', path: '.env' })).toBeDefined()
    expect(guardReason('Grep', { pattern: 'BOOMI', glob: '**/.env' })).toBeDefined()
    expect(guardReason('Grep', { pattern: 'BOOMI_API_TOKEN' })).toBeDefined()
    expect(guardReason('Grep', { pattern: 'BOOMI_ACCOUNT_ID', path: 'docs' })).toBeUndefined()
    expect(guardReason('Write', { file_path: '.env', content: 'X=1' })).toBeUndefined()
  })
})

describe('redaction', () => {
  test('knows the token and the Basic auth pair built from it', () => {
    const secrets = secretValues(TOKEN, 'me@example.com')
    expect(secrets).toEqual([TOKEN, btoa(`BOOMI_TOKEN.me@example.com:${TOKEN}`)])
    expect(secretValues('short', 'me')).toEqual([])
    expect(secretValues(undefined, 'me')).toEqual([])
  })

  test('replaces every occurrence, and nothing else', () => {
    const secrets = secretValues(TOKEN, 'me@example.com')
    const leaked = `token=${TOKEN} auth=Basic ${secrets[1]} again ${TOKEN}`
    expect(containsSecret(leaked, secrets)).toBe(true)
    const cleaned = redact(leaked, secrets)
    expect(cleaned).toBe(`token=${REDACTED} auth=Basic ${REDACTED} again ${REDACTED}`)
    expect(containsSecret(cleaned, secrets)).toBe(false)
    expect(redact('nothing to hide', secrets)).toBe('nothing to hide')
  })

  test('masks secret-bearing lines of a .env file', () => {
    const env = `BOOMI_API_URL=https://api.boomi.com\nBOOMI_API_TOKEN=${TOKEN}\nexport OTHER_SECRET=x\nBOOMI_TEST_ATOM_ID=atom-1`
    const masked = maskEnv(env)
    expect(masked).not.toContain(TOKEN)
    expect(masked).toContain(`BOOMI_API_TOKEN=${REDACTED}`)
    expect(masked).toContain(`export OTHER_SECRET=${REDACTED}`)
    expect(masked).toContain('BOOMI_TEST_ATOM_ID=atom-1')
  })
})
