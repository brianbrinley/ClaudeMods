import { expect, test } from 'claude-code/testing'
import { environmentChanges, environmentGate, environmentNamed, environmentsFrom, wrapperRuns } from '../hooks/environment'
import type { Environment } from '../hooks/environment'

const S = 'bash /home/me/.claude/plugins/cache/boomi-companion/bc-integration/1.4.0/skills/boomi-integration/scripts'
const DEPLOY = `${S}/boomi-deploy.sh active-development/processes/Orders.xml`
const PUSH = `${S}/boomi-component-push.sh active-development/processes/Orders.xml`
const TEST = `${S}/boomi-test-execute.sh --process-id p-1`
const PROD: Environment = { id: 'e-prod', name: 'Production', classification: 'PROD' }
const TEST_ENV: Environment = { id: 'e-test', name: 'Test', classification: 'TEST' }

test('the environment list keeps the ID, name and upper-cased classification, and drops rows without an ID', () => {
  expect(environmentsFrom([{ id: 'e-1', name: 'Test', classification: 'test' }, { name: 'no id', classification: 'PROD' }, { id: 'e-2', name: 'Plain' }])).toEqual([
    { id: 'e-1', name: 'Test', classification: 'TEST' },
    { id: 'e-2', name: 'Plain', classification: undefined },
  ])
})

test('the .env environment is found by its ID, and none is found without one', () => {
  expect(environmentNamed([PROD, TEST_ENV], 'e-test')).toBe(TEST_ENV)
  expect(environmentNamed([PROD, TEST_ENV], 'e-missing')).toBeUndefined()
  expect(environmentNamed([PROD, TEST_ENV], undefined)).toBeUndefined()
})

test('the changes a command makes in the .env environment are deploy, undeploy and test runs; pushes are not among them', () => {
  expect(environmentChanges(DEPLOY)).toEqual(['deploy'])
  expect(environmentChanges(`${S}/boomi-undeploy.sh dep-1`)).toEqual(['undeploy'])
  expect(environmentChanges(TEST)).toEqual(['run a test execution'])
  expect(environmentChanges(PUSH)).toEqual([])
  expect(environmentChanges(`${S}/boomi-deploy.sh --help`)).toEqual([])
})

test('off and check never refuse, whatever the environment', () => {
  expect(environmentGate(DEPLOY, 'off', PROD)).toBeUndefined()
  expect(environmentGate(DEPLOY, 'check', PROD)).toBeUndefined()
  expect(environmentGate('bash run-all.sh', 'check', PROD)).toBeUndefined()
})

test('enforce refuses a deploy, undeploy or test run to a production environment, and says why', () => {
  const refused = environmentGate(DEPLOY, 'enforce', PROD)
  expect(refused?.short).toBe('Production is PROD, not TEST or DEV')
  expect(refused?.deny).toContain('Not run: deploy.')
  expect(refused?.deny).toContain('Do not work around this')
  expect(environmentGate(`${S}/boomi-undeploy.sh dep-1`, 'enforce', PROD)).toBeDefined()
  expect(environmentGate(TEST, 'enforce', PROD)).toBeDefined()
})

test('enforce lets a deploy run in a TEST or DEV environment', () => {
  expect(environmentGate(DEPLOY, 'enforce', TEST_ENV)).toBeUndefined()
  expect(environmentGate(DEPLOY, 'enforce', { id: 'e-dev', name: 'Dev', classification: 'DEV' })).toBeUndefined()
})

test('enforce refuses when the environment is unknown or has a classification it does not allow', () => {
  expect(environmentGate(DEPLOY, 'enforce', undefined)?.short).toBe("the .env's environment isn't in Boomi's environment list, so it can't be checked")
  expect(environmentGate(DEPLOY, 'enforce', undefined, 'Not connected: no credentials')?.short).toBe('Not connected: no credentials')
  expect(environmentGate(DEPLOY, 'enforce', { id: 'e-x', name: 'Odd', classification: undefined })?.short).toBe('Odd is unclassified, not TEST or DEV')
})

test('enforce refuses a raw Platform API write to production, and lets a read through', () => {
  const write = `curl -X POST -d '{}' https://api.boomi.com/api/rest/v1/acc-1/Component`
  expect(environmentGate(write, 'enforce', PROD)?.deny).toContain('POST /api/rest/v1/acc-1/Component')
  expect(environmentGate(write, 'enforce', TEST_ENV)).toBeUndefined()
  expect(environmentGate(`curl https://api.boomi.com/api/rest/v1/acc-1/Component`, 'enforce', PROD)).toBeUndefined()
})

test('enforce refuses a command that also names the .env, even aimed at a TEST environment', () => {
  const refused = environmentGate(`sed -i '' 's/TEST/PROD/' .env && ${DEPLOY}`, 'enforce', TEST_ENV)
  expect(refused?.short).toBe('the command also touches .env, so the environment could change while it runs')
  expect(environmentGate(DEPLOY, 'enforce', TEST_ENV)).toBeUndefined()
})

test('the configured env file counts as the .env, under whatever name it has', () => {
  expect(environmentGate(`${DEPLOY} && cat deploy.cfg`, 'enforce', TEST_ENV, undefined, 'config/deploy.cfg')?.short).toBe(
    'the command also touches deploy.cfg, so the environment could change while it runs',
  )
  expect(environmentGate(DEPLOY, 'enforce', TEST_ENV, undefined, 'config/deploy.cfg')).toBeUndefined()
})

test('a script the command runs is found, with the folder it runs from after any cd', () => {
  expect(wrapperRuns('cd deploy && bash run.sh')).toEqual([{ path: 'run.sh', dir: 'deploy' }])
  expect(wrapperRuns('bash run.sh; cd /opt/x && ./go.sh')).toEqual([
    { path: 'run.sh', dir: '' },
    { path: './go.sh', dir: '/opt/x' },
  ])
  expect(wrapperRuns('cd deploy && cd .. && source env.sh')).toEqual([{ path: 'env.sh', dir: 'deploy/..' }])
  expect(wrapperRuns(`${S}/boomi-deploy.sh x.xml`)).toEqual([])
})

test('enforce refuses any command that runs a script of its own, whatever it does, and check mode lets it run', () => {
  const refused = environmentGate('bash run-all.sh', 'enforce', TEST_ENV)
  expect(refused?.short).toBe('the command runs run-all.sh, a script the check can\'t see into')
  expect(refused?.deny).toContain('Not run: the script run-all.sh.')
  expect(environmentGate('cd deploy && ./go.sh', 'enforce', PROD)).toBeDefined()
  expect(environmentGate('bash run-all.sh', 'check', PROD)).toBeUndefined()
  expect(environmentGate(`${DEPLOY} && bash run-all.sh`, 'enforce', TEST_ENV)).toBeDefined()
})

test('enforce never refuses a push, a check or a command that changes nothing', () => {
  expect(environmentGate(PUSH, 'enforce', PROD)).toBeUndefined()
  expect(environmentGate(`${S}/boomi-deploy.sh --help`, 'enforce', undefined)).toBeUndefined()
  expect(environmentGate('ls -la', 'enforce', undefined)).toBeUndefined()
})
