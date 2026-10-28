import { expect, test } from 'claude-code/testing'
import type { BudgetLine } from '../hooks/activity'
import { blockedDetail, companionChanges, denyMessage, enforcementNote, platformWrites, spentBudgets, spentText, wrapperScripts } from '../hooks/budget-gate'

const S = 'bash /home/me/.claude/plugins/cache/boomi-companion/bc-integration/1.4.0/skills/boomi-integration/scripts'

test('gated: the bc-integration scripts that change something in Boomi', () => {
  expect(companionChanges(`${S}/boomi-component-create.sh active-development/processes/Orders.xml`)).toEqual(['create a component in Boomi (active-development/processes/Orders.xml)'])
  expect(companionChanges(`${S}/boomi-component-push.sh active-development/processes/Orders.xml`)).toHaveLength(1)
  expect(companionChanges(`${S}/boomi-deploy.sh active-development/processes/Orders.xml`)).toEqual(['deploy (active-development/processes/Orders.xml)'])
  expect(companionChanges(`${S}/boomi-undeploy.sh dep-1`)).toEqual(['undeploy (dep-1)'])
  expect(companionChanges(`${S}/boomi-test-execute.sh --process-id p-1`)).toEqual(['run a test execution (p-1)'])
  expect(companionChanges(`${S}/boomi-folder-create.sh Orders`)).toEqual(['create a folder in Boomi'])
  expect(companionChanges(`${S}/boomi-branch.sh create --name dev --parent main`)).toEqual(['create or delete a branch'])
  expect(companionChanges(`${S}/boomi-extensions.sh set --file ext.json`)).toEqual(["set the environment's extensions"])
  expect(companionChanges(`${S}/boomi-wss-test.sh --path /ws/simple/createOrder`)).toHaveLength(1)
  // Several in one command, as Claude often chains them.
  expect(companionChanges(`cd /work && ${S}/boomi-component-push.sh a.xml && ${S}/boomi-deploy.sh a.xml && ${S}/boomi-test-execute.sh --process-id p`)).toHaveLength(3)
})

test("gated: the other plugins' subcommands that change something", () => {
  expect(companionChanges('bash scripts/bdi-flow.sh run orders-flow')).toHaveLength(1)
  expect(companionChanges('bash scripts/datahub-deployment.sh deploy u-1 m-1')).toHaveLength(1)
  expect(companionChanges('bash scripts/agentstudio-agent.sh create --body agent.json')).toHaveLength(1)
})

test('never gated: reads, help, connection checks, and scripts only looked at', () => {
  for (const read of [
    `${S}/boomi-component-pull.sh --component-id c-1`,
    `${S}/boomi-execution-query.sh --execution-id e-1 --logs`,
    `${S}/boomi-folder-list.sh`,
    `${S}/boomi-component-search.sh --name Orders`,
    `${S}/boomi-env-check.sh`,
    `${S}/boomi-branch.sh list`,
    `${S}/boomi-extensions.sh get`,
    `${S}/boomi-deploy.sh --help`,
    `${S}/boomi-component-create.sh x.xml --test-connection`,
    'bash scripts/bdi-flow.sh status orders-flow r-1',
    'bash scripts/bdi-flow.sh logs orders-flow r-1',
    'bash scripts/bdi-flow.sh list',
    'bash scripts/datahub-deployment.sh status u-1 d-1',
    `cat ${S}/boomi-deploy.sh`,
    `grep -n usage ${S}/boomi-deploy.sh`,
  ]) expect(companionChanges(read)).toEqual([])
})

test('the Platform API called directly: changes are gated, reads (GET and the query POSTs) are not', () => {
  const API = 'https://api.boomi.com/api/rest/v1/acct-1'
  expect(platformWrites(`curl -s -X POST ${API}/ExecutionRequest -d @req.json`)).toEqual(['POST /api/rest/v1/acct-1/ExecutionRequest'])
  expect(platformWrites(`curl -s ${API}/DeployedPackage -H 'Content-Type: application/json' --data '{"x":1}'`)).toEqual(['POST /api/rest/v1/acct-1/DeployedPackage'])
  expect(platformWrites(`curl -X DELETE "${API}/DeployedPackage/p-1"`)).toEqual(['DELETE /api/rest/v1/acct-1/DeployedPackage/p-1'])
  expect(platformWrites(`curl --request PUT ${API}/Component/c-1 -T comp.xml`)).toEqual(['PUT /api/rest/v1/acct-1/Component/c-1'])
  expect(platformWrites(`http POST ${API}/Folder name=x`)).toEqual(['POST /api/rest/v1/acct-1/Folder'])
  // Reads.
  expect(platformWrites(`curl -s ${API}/Account/acct-1`)).toEqual([])
  expect(platformWrites(`curl -XPOST ${API}/Folder -d'{}'`)).toEqual(['POST /api/rest/v1/acct-1/Folder'])
  expect(platformWrites(`curl ${API}/DeployedPackage -d@req.json`)).toEqual(['POST /api/rest/v1/acct-1/DeployedPackage'])
  expect(platformWrites(`curl -X "$METHOD" ${API}/Component/c-1`)).toEqual(['UNKNOWN /api/rest/v1/acct-1/Component/c-1'])
  expect(platformWrites(`curl -X GET ${API}/Account/acct-1`)).toEqual([])
  expect(platformWrites(`curl -s ${API}/Component/Orders-XML`)).toEqual([])
  expect(platformWrites(`curl -s -X POST ${API}/ComponentMetadata/query -d @q.json`)).toEqual([])
  expect(platformWrites(`curl -s -X POST ${API}/ExecutionRecord/queryMore -d token`)).toEqual([])
  // Not Boomi's API.
  expect(platformWrites('curl -X POST https://example.com/hook -d x')).toEqual([])
})

test('local scripts a command runs are read in case they wrap a Companion change; Companion\'s own are not', () => {
  expect(wrapperScripts('bash run-all.sh && ./deploy/again.sh; source env.sh')).toEqual(['run-all.sh', './deploy/again.sh', 'env.sh'])
  expect(wrapperScripts(`${S}/boomi-deploy.sh x.xml`)).toEqual([])
  expect(wrapperScripts('ls *.sh')).toEqual([])
})

const LINES: BudgetLine[] = [
  { label: 'session', level: 'critical', percent: 104, detail: '$5.20 of $5.00' },
  { label: 'month', level: 'warning', percent: 86, detail: '$43.10 of $50.00' },
  { label: 'share, 7 days', level: 'critical', percent: 112, detail: '34% of 30%' },
]

test('which budgets are spent: any one past 100% plus the grace, fullest first', () => {
  expect(spentBudgets(LINES, 0).map(l => l.label)).toEqual(['share, 7 days', 'session'])
  expect(spentBudgets(LINES, 5).map(l => l.label)).toEqual(['share, 7 days'])
  expect(spentBudgets(LINES, 20)).toEqual([])
  expect(spentText(spentBudgets(LINES, 0))).toBe("Companion's share of your usage limit (7 days) (34% of 30%, 112%) and the session budget ($5.20 of $5.00, 104%)")
  expect(blockedDetail(spentBudgets(LINES, 5))).toBe("blocked by budget: Companion's share of your usage limit (7 days) (34% of 30%, 112%)")
})

test('the refusal tells Claude what is spent, to stop and report, and not to go around it', () => {
  const deny = denyMessage([LINES[0]!], ['deploy (Orders.xml)'], 'block')
  expect(deny).toMatch(/^boomi-dashboard: refused: Boomi Companion's budget is spent: the session budget \(\$5\.20 of \$5\.00, 104%\)\./)
  expect(deny).toContain('Not run: deploy (Orders.xml).')
  expect(deny).toContain('Stop the Boomi work now and tell the user')
  expect(deny).toContain('Do not work around this: no curl or other calls to api.boomi.com, no running the script another way, no wrapper script.')
  expect(denyMessage([LINES[0]!], ['x'], 'confirm', true)).toMatch(/^boomi-dashboard: the user chose to stop this:/)
})

test('the note Claude gets once enforcement starts, or changes', () => {
  expect(enforcementNote([LINES[0]!], 'block', false)).toContain('Companion changes (creates, pushes, deploys, tests, and changing calls to the Platform API) are refused.')
  expect(enforcementNote([LINES[0]!], 'confirm', false)).toContain('paused: each one asks the user first')
  expect(enforcementNote([LINES[0]!], 'confirm', true)).toContain('the user allowed Companion changes for the rest of this session')
  expect(enforcementNote([], 'block', false)).toContain('no longer spent')
})

test('a spent monthly Claude budget is named as that, not as a Companion share', () => {
  const spent = [{ label: 'Claude budget', level: 'critical', percent: 101, detail: '$1111 of $1100 this month' }] as BudgetLine[]
  expect(spentText(spent)).toBe('your monthly Claude budget ($1111 of $1100 this month, 101%)')
})
