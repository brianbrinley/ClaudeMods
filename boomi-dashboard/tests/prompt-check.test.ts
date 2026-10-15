import { expect, test } from 'claude-code/testing'
import { NO_COUNTS, REWRITE_SYSTEM, checkPrompt, countsAfter, findSecrets, isCheckable, maskPrompt, reportLines, rewriteFrom, rewriteRequest, statusPart, tipsText, upgradePrompt, wrapLines } from '../hooks/prompt-check'
import type { PromptFacts } from '../hooks/prompt-check'
import { contextLines, folderComponentOf, keywords, relevantComponents, relevantSections, sectionsOf } from '../hooks/retrieve'

const ID = '1a2b3c4d-1111-2222-3333-444455556666'
const ENV = '9f8e7d6c-1111-2222-3333-444455556666'
const FACTS: PromptFacts = {
  component: { name: 'Orders Sync', type: 'process', id: ID },
  names: ['Orders Sync'],
  environmentId: ENV,
  failed: { name: 'the test of Orders Sync', executionId: 'execution-aaaa1111', detail: 'Execution completed: status=ERROR' },
}
const NONE: PromptFacts = { names: [] }
const codes = (text: string, facts = FACTS) => checkPrompt(text, facts).map(t => t.code)

test('short replies, one word and prompts that are not Boomi work are not checked', () => {
  for (const text of ['yes', 'keep going', 'Go ahead.', 'deploy', 'what time is it', 'rename this variable']) expect(isCheckable(text)).toBe(false)
  for (const text of ['deploy it', 'test the process', 'fix the map']) expect(isCheckable(text)).toBe(true)
  expect(checkPrompt('keep going', FACTS)).toEqual([])
})

test('a vague Boomi prompt gets a tip for each thing it leaves out, with the session’s likely answer', () => {
  const tips = checkPrompt('deploy it and test it, still failing', FACTS)
  expect(tips.map(t => t.code)).toEqual(['subject', 'environment', 'error', 'test'])
  expect(tips[0]!.text).toBe('"it": the process Orders Sync, the last one this session?')
  expect(tips[1]!.text).toBe('deploy: no environment named; the session points at 9f8e7d6c…')
  expect(tips[2]!.text).toBe('fix: no error given; the last failure was the test of Orders Sync (execution-aaaa1111)')
  expect(tips.every(t => t.level === 'warning')).toBe(true)
})

test('without the facts, the tips say what to add instead of guessing', () => {
  const tips = checkPrompt('deploy it and fix it', NONE)
  expect(tips.map(t => t.text)).toEqual(['"it": no component named; say which process or component', 'deploy: no environment named', 'fix: no error, log or execution ID given'])
})

test('a prompt that says it all gets no tips', () => {
  expect(codes('Deploy Orders Sync to dev and test it with tests/orders.json')).toEqual([])
  expect(codes(`deploy ${ID} to the QA environment`)).toEqual([])
  expect(codes('the test failed with "Map: field OrderId not found", fix the Orders Sync map field')).toEqual([])
})

test('production wording, a new process with details missing, a map with no profiles and several big steps', () => {
  const prod = checkPrompt('run the Orders Sync process against production orders', FACTS)
  expect(prod.map(t => [t.code, t.level])).toEqual([['production', 'serious']])
  expect(checkPrompt('build a process that syncs orders', FACTS).map(t => t.text)).toEqual(["new process: doesn't say the source and target, what starts it or the data format"])
  expect(codes('build a process from Salesforce to NetSuite every hour with JSON')).toEqual([])
  expect(codes('add a map for Orders Sync')).toEqual(['map'])
  expect(checkPrompt('create the Orders Sync map from the Order profile to the Invoice profile, deploy to dev and test with orders.json', FACTS).map(t => t.code)).toEqual(['steps'])
})

test('a check named in promptSkip is left out', () => {
  expect(checkPrompt('deploy it', FACTS, new Set(['environment'])).map(t => t.code)).toEqual(['subject'])
})

test('secrets are found in any prompt and masked', () => {
  expect(findSecrets('connect with password=hunter2!')).toEqual(['a password or token'])
  expect(findSecrets('Authorization: Bearer abcdef123456')).toEqual(['an auth header'])
  expect(findSecrets('the password is in .env')).toEqual([])
  expect(maskPrompt('use BOOMI_API_TOKEN=abc123def456 and password: "hunter22"')).toBe('use BOOMI_API_TOKEN=**** and password: "****"')
  expect(maskPrompt('key AKIAABCDEFGHIJKLMNOP and sk-live123456789')).toBe('key AKIA**** and sk-****')
  const tips = checkPrompt('hi, password=hunter22', FACTS)
  expect(tips.map(t => [t.code, t.level])).toEqual([['secret', 'serious']])
})

test('the upgrade fills in what the session knows, leaves a [placeholder] for the rest, and never carries a secret', () => {
  const text = 'deploy it and test it, still failing'
  const upgrade = upgradePrompt(text, FACTS, checkPrompt(text, FACTS))
  expect(upgrade).toBe(
    'deploy it and test it, still failing. By "it" I mean the process Orders Sync (1a2b3c4d-1111-2222-3333-444455556666). ' +
      `Deploy to environment ${ENV}. ` +
      'The last failure was the test of Orders Sync (execution execution-aaaa1111): Execution completed: status=ERROR. Read its process log and tell me the cause before you change anything.\n\n' +
      'Details:\n- Test data: [what to test with]; a pass means [the expected result]',
  )
  const bare = upgradePrompt('deploy it', NONE, checkPrompt('deploy it', NONE))
  expect(bare).toBe('deploy it.\n\nDetails:\n- The process or component: [which one]\n- Environment: [which environment]')
  const build = 'build a process that syncs orders'
  expect(upgradePrompt(build, NONE, checkPrompt(build, NONE))).toBe(
    'build a process that syncs orders.\n\nDetails:\n- Source and target: [source system] to [target system]\n- What starts it: [a schedule or a listener]\n- Data format: [JSON, XML, CSV, flat file or EDI]',
  )
  const secret = 'deploy it with password=hunter22'
  expect(upgradePrompt(secret, FACTS, checkPrompt(secret, FACTS))).not.toContain('hunter22')
})

test('the model reads the masked prompt, the tips and the facts; its reply is trimmed and masked again', () => {
  const request = rewriteRequest('deploy it', FACTS, checkPrompt('deploy it', FACTS), 'deploy it. By "it" I mean ...')
  expect(request).toContain('<prompt>\ndeploy it\n</prompt>')
  expect(request).toContain('- Component worked on last: the process Orders Sync (1a2b3c4d-1111-2222-3333-444455556666)')
  expect(request).toContain(`- Environment the session points at: ${ENV}`)
  expect(rewriteFrom('```\n"Deploy Orders Sync to dev. token=abcd1234"\n```')).toBe('Deploy Orders Sync to dev. token=****')
  expect(rewriteFrom('  ')).toBeUndefined()
})

test('a tip the next prompt no longer needs counts as followed', () => {
  const first = checkPrompt('deploy it', FACTS)
  const once = countsAfter(NO_COUNTS, undefined, first)
  expect(once).toEqual({ checked: 1, tipped: 1, followed: 0, byCode: { subject: { seen: 1, followed: 0 }, environment: { seen: 1, followed: 0 } } })
  const twice = countsAfter(once, first, checkPrompt('deploy it to dev', FACTS))
  expect(twice.followed).toBe(1)
  expect(twice.byCode.environment).toEqual({ seen: 1, followed: 1 })
  expect(twice.byCode.subject).toEqual({ seen: 2, followed: 0 })
  expect(reportLines(twice)).toEqual(['', '## Prompt tips', '', '- 2 prompts checked · 2 with tips · 1 tip followed', '- Most often: no component named (2)'])
  expect(reportLines(NO_COUNTS)).toEqual([])
})

test('the status line and /bc-dashboard prompt say it with an icon and a label', () => {
  const tips = checkPrompt('deploy it', FACTS)
  const state = { at: 0, masked: 'deploy it', tips, upgrade: upgradePrompt('deploy it', FACTS, tips) }
  expect(statusPart(state)).toBe('◐ 2 prompt tips: /bc-dashboard prompt')
  expect(statusPart({ ...state, tips: checkPrompt('password=hunter22 deploy Orders Sync to dev', FACTS) })).toBe('⚠ 1 prompt tip: /bc-dashboard prompt')
  expect(statusPart(null)).toBeUndefined()
  expect(statusPart(state, true)).toBe('⏸ prompt held: Boomi Dashboard Prompt tips')
  const text = tipsText(state, countsAfter(NO_COUNTS, undefined, tips), 'suggest')
  expect(text).toContain('Your last prompt: deploy it')
  expect(text).toContain('  ◐ deploy: no environment named; the session points at 9f8e7d6c…')
  expect(text).toContain('/bc-dashboard prompt use puts it in the prompt box.')
  expect(tipsText(null, NO_COUNTS, 'off')).toContain('Prompts are not checked.')
})

test('retrieval: the folder’s components and Companion’s guidance that match the prompt, nothing that doesn’t', () => {
  const sf = folderComponentOf('<bns:Component xmlns:bns="x" componentId="1" name="Salesforce Connection" type="connector-settings" folderFullPath="QTC/Connections">')
  expect(sf).toEqual({ name: 'Salesforce Connection', type: 'connector-settings', folder: 'QTC/Connections' })
  expect(folderComponentOf('<root/>')).toBeUndefined()
  const all = [sf!, { name: 'NetSuite Connection', type: 'connector-settings' }, { name: 'Magic8Ball', type: 'process' }]
  const prompt = 'lets make an integration for QTC from salesforce to netsuite with generic connections'
  expect(keywords('Lets make the Connections for SALESFORCE')).toEqual(['connection', 'salesforce'])
  expect(relevantComponents(all, prompt).map(c => c.name)).toEqual(['NetSuite Connection', 'Salesforce Connection'])
  expect(relevantComponents(all, 'deploy the weather agent')).toEqual([])
  const doc = '# Boomi thinking\nIntro.\n## Connections\nA connection holds the endpoint and credentials; build it once and reuse it.\n## Listeners\nA web service listener starts a process on a call.'
  const sections = sectionsOf('BOOMI_THINKING.md', doc)
  expect(sections.map(x => x.heading)).toEqual(['Boomi thinking', 'Connections', 'Listeners'])
  expect(relevantSections(sections, prompt).map(x => x.heading)).toEqual(['Connections'])
  const lines = contextLines([sf!], relevantSections(sections, prompt)).join('\n')
  expect(lines).toContain('- Salesforce Connection (connector-settings), in QTC/Connections')
  expect(lines).toContain('[BOOMI_THINKING.md: Connections]')
  expect(contextLines([], [])).toEqual([])
})

test('a rewrite reads the extras: the folder, the guidance, the try before and the person’s note, masked', () => {
  const request = rewriteRequest('deploy it', FACTS, checkPrompt('deploy it', FACTS), 'draft', {
    context: ['', 'Components in this folder that may be meant:', '- Orders Sync (process)'],
    previous: 'the first try',
    note: 'shorter, and token=abcd1234',
  })
  expect(request).toContain('- Orders Sync (process)')
  expect(request).toContain('The try before (write a different one):\nthe first try')
  expect(request).toContain("The person's note for this try:\nshorter, and token=****")
})

test('a rewrite gets only the facts a tip needs, and is told never to add work', () => {
  const build = 'build a process that syncs orders'
  const request = rewriteRequest(build, FACTS, checkPrompt(build, FACTS), 'draft')
  expect(request).not.toContain('Last failure')
  expect(request).not.toContain('Environment the session points at')
  expect(request).not.toContain('Component worked on last')
  expect(request).toContain('- none')
  const fix = 'fix the process, still failing'
  expect(rewriteRequest(fix, FACTS, checkPrompt(fix, FACTS), 'draft')).toContain('- Last failure: the test of Orders Sync (execution execution-aaaa1111)')
  expect(REWRITE_SYSTEM).toContain('Never add features, steps, systems, logic or requirements the person did not ask for')
  const guidance = contextLines([], [{ source: 'BOOMI_THINKING.md', heading: 'Upserts', text: 'Prefer an upsert and write the target ID back.' }]).join('\n')
  expect(guidance).toContain("only to decide what to ask the person about, never work to add")
})

test('wrapLines breaks at spaces, cuts a word longer than a line, and keeps blank lines', () => {
  expect(wrapLines('one two three four', 9)).toEqual(['one two', 'three', 'four'])
  expect(wrapLines('abcdefghijkl', 8)).toEqual(['abcdefgh', 'ijkl'])
  expect(wrapLines('a\n\nb', 20)).toEqual(['a', '', 'b'])
})

test('a look around with nothing named to find gets a nudge; one that names what to find gets none', () => {
  expect(checkPrompt('use boomi companion to check out my account.', NONE).map(t => t.code)).toEqual(['aim'])
  expect(checkPrompt('explore the environment', NONE).map(t => t.code)).toEqual(['aim'])
  expect(checkPrompt('check out the failed executions in my account', NONE)).toEqual([])
  expect(checkPrompt('look at the deployed processes in my account', NONE)).toEqual([])
})
