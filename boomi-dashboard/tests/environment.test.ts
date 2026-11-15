import { expect, test } from 'claude-code/testing'
import { changeFolders, environmentChanges, environmentGate, environmentNamed, environmentsFrom, wrapperRuns } from '../hooks/environment'
import type { Environment } from '../hooks/environment'
import { guardrails } from '../hooks/activity'

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
  expect(wrapperRuns('cd deploy && cd .. && source env.sh')).toEqual([{ path: 'env.sh', dir: '' }])
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

test('the pane says what the production check is doing, and says nothing while it is off', () => {
  expect(guardrails(undefined, undefined, { mode: 'off' })).toEqual([])
  expect(guardrails(undefined, undefined, { mode: 'check', note: "the .env's environment isn't known yet" })[0]?.text).toBe(
    "Production check on, not checking: the .env's environment isn't known yet",
  )
  expect(guardrails(undefined, undefined, { mode: 'check', name: 'Test', classification: 'TEST' })[0]).toEqual({ level: 'healthy', text: 'Production check: Test is TEST' })
  expect(guardrails(undefined, undefined, { mode: 'check', name: 'Production', classification: 'PROD' })[0]?.level).toBe('warning')
  expect(guardrails(undefined, undefined, { mode: 'enforce', name: 'Production', classification: 'PROD' })[0]?.level).toBe('serious')
})

test('enforce never refuses a push, a check or a command that changes nothing', () => {
  expect(environmentGate(PUSH, 'enforce', PROD)).toBeUndefined()
  expect(environmentGate(`${S}/boomi-deploy.sh --help`, 'enforce', undefined)).toBeUndefined()
  expect(environmentGate('ls -la', 'enforce', undefined)).toBeUndefined()
})

test('enforce refuses every Companion change that reaches the environment, not only deploys', () => {
  for (const command of [
    'bash scripts/datahub-deployment.sh deploy x',
    'bash scripts/agentstudio-deployment.sh deploy x',
    'bash scripts/bdi-flow.sh run x',
    'bash scripts/boomi-extensions.sh set --file x.json',
    'bash scripts/boomi-wss-test.sh x',
    'bash scripts/event-streams-setup.sh rest-produce x',
    'bash scripts/event-streams-setup.sh create-topic x',
    'bash scripts/boomi-brand-new.sh x',
  ]) {
    expect(environmentGate(command, 'enforce', PROD)?.short).toContain('Production is PROD')
    expect(environmentGate(command, 'enforce', TEST_ENV)).toBeUndefined()
  }
})

test('enforce leaves reads, a run being cancelled, and changes to the account\'s components alone', () => {
  for (const command of [
    PUSH,
    'bash scripts/boomi-extensions.sh get',
    'bash scripts/event-streams-setup.sh list-topics',
    'bash scripts/boomi-execution-query.sh --process-id p',
    'bash scripts/boomi-branch.sh list',
    'bash scripts/boomi-branch.sh merge --source a --dest b',
    'bash scripts/boomi-folder-rename.sh a b',
    'bash scripts/bdi-flow.sh cancel x',
  ]) {
    expect(environmentGate(command, 'enforce', PROD)).toBeUndefined()
  }
})

test('enforce finds a script of the command\'s own however it is started', () => {
  for (const command of [
    './deploy-all.sh',
    'time ./deploy-all.sh',
    'nohup ./deploy-all.sh',
    'env ./deploy-all.sh',
    'exec ./deploy-all.sh',
    'sudo ./deploy-all.sh',
    'timeout 60 ./deploy-all.sh',
    'FOO=1 ./deploy-all.sh',
    'bash "./deploy-all.sh"',
    'bash ~/deploy-all.sh',
    'bash $HOME/deploy-all.sh',
    'bash deploy-all',
    './deploy-all',
    "bash -c './deploy-all.sh'",
    "bash -c 'cd x && ./deploy-all.sh'",
    'eval ./deploy-all.sh',
    'find . -name x -exec ./deploy-all.sh {} ;',
    'S=boomi; bash deploy-$S.sh',
  ]) {
    expect(environmentGate(command, 'enforce', TEST_ENV)?.short).toContain("a script the check can't see into")
  }
})

test('a script only named, a system tool, sourcing the .env and a Companion script are not scripts of the command\'s own', () => {
  for (const command of ['cat ./deploy-all.sh', 'grep x run.sh', '/usr/bin/git status', 'source .env', 'git status', 'bash scripts/boomi-env-check.sh', 'python3 scripts/boomi-profile-inspect.py x', './scripts/boomi-profile-inspect.py x', 'echo "./deploy-all.sh"', 'bash -c true']) {
    expect(wrapperRuns(command)).toEqual([])
  }
})

test('enforce refuses a raw Platform API write through a variable, and leaves its reads alone', () => {
  for (const command of [
    'curl -X POST "$BOOMI_API_URL/api/rest/v1/$BOOMI_ACCOUNT_ID/DeployedPackage" -d @x',
    'U=https://api.boomi.com/api/rest/v1/a/DeployedPackage; curl -X POST $U -d @x',
    'export U="https://api.boomi.com/x" && curl -X DELETE "$U"',
    'curl -X POST https://example.com/api/rest/v1/a/DeployedPackage -d @x',
  ]) {
    expect(environmentGate(command, 'enforce', PROD)).toBeDefined()
  }
  expect(environmentGate('curl "$BOOMI_API_URL/api/rest/v1/a/Environment/e"', 'enforce', PROD)).toBeUndefined()
  expect(environmentGate('curl -X POST "$BOOMI_API_URL/api/rest/v1/a/Process/query" -d @q.json', 'enforce', PROD)).toBeUndefined()
  expect(environmentGate('curl -X POST https://example.com/hook -d x', 'enforce', PROD)).toBeUndefined()
})

test('the folders a change runs from are where Companion finds its .env', () => {
  expect(changeFolders(DEPLOY)).toEqual([''])
  expect(changeFolders('cd ../prod-workspace && bash ../scripts/boomi-deploy.sh a.xml')).toEqual(['../prod-workspace'])
  expect(changeFolders('cd /work/prod; bash scripts/boomi-deploy.sh a.xml; cd /work/dev; bash scripts/boomi-undeploy.sh d')).toEqual(['/work/prod', '/work/dev'])
  expect(changeFolders('cd /work/prod && bash scripts/boomi-component-push.sh a.xml')).toEqual([])
})
