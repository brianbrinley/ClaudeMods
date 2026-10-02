import type { CommandRunInput, On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const standards = (args: string) => ({ command: 'standards', args }) as CommandRunInput

const component = (name: string, body = '') =>
  `<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="" name="${name}" type="connector-settings" folderId="F1">
  <bns:encryptedValues/>
  <bns:object>${body}</bns:object>
</bns:Component>`

const CLEAN = component('Orders API')
const LEAKY = component('Orders API', '<field id="password" type="password" value="hunter2!"/>')

/** A workspace of files under the session's folder, answered from memory. */
const workspace = (on: On, files: Record<string, string>) => {
  // The engine hands file hooks absolute paths; the workspace is keyed by relative ones.
  const tops = new Set(Object.keys(files).map(f => f.split('/')[0]!))
  const local = (path: string): string => {
    for (const top of tops) {
      const at = path.lastIndexOf(`/${top}`)
      const after = path[at + top.length + 1]
      if (at >= 0 && (after === undefined || after === '/')) return path.slice(at + 1)
    }
    return path
  }
  on('fs.exists', async (_$, e) => {
    const path = local(e.path)
    return { value: path in files || Object.keys(files).some(f => f.startsWith(`${path}/`)) }
  })
  on('fs.read', async (_$, e) => {
    const text = files[local(e.path)]
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.list', async (_$, e) => {
    const prefix = `${local(e.path)}/`
    const names = new Set(
      Object.keys(files)
        .filter(f => f.startsWith(prefix))
        .map(f => f.slice(prefix.length).split('/')[0]!),
    )
    return {
      value: [...names].map(name => ({
        name,
        kind: `${prefix}${name}` in files ? ('file' as const) : ('dir' as const),
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
    }
  })
  on('ui.status', async () => ({ value: undefined }))
}

/** The shell beneath the plugins; records whether the command ran. */
const shell = (on: On) => {
  const ran: string[] = []
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    ran.push(String(e.command))
    return { result: { stdout: 'pushed', stderr: '', interrupted: false } }
  })
  return ran
}

const PUSH = 'bash scripts/boomi-component-push.sh active-development/connector-settings/Orders.xml'

test('a push of a component with a password in it is refused, with the reason', async ($, on) => {
  workspace(on, { 'active-development/connector-settings/Orders.xml': LEAKY })
  const ran = shell(on)
  const answer = await $.tool.call({ tool: 'Bash', command: PUSH })
  expect(answer.deny).toContain('boomi-standards')
  expect(answer.deny).toContain('password-in-xml')
  expect(answer.deny).not.toContain('hunter2')
  expect(ran).toEqual([])
})

test('a clean push goes through untouched', async ($, on) => {
  workspace(on, { 'active-development/connector-settings/Orders.xml': CLEAN })
  const ran = shell(on)
  const answer = await $.tool.call({ tool: 'Bash', command: PUSH })
  expect(answer.deny).toBeUndefined()
  expect(ran).toEqual([PUSH])
})

test('commands that are not Companion pushes are left alone', async ($, on) => {
  const ran = shell(on)
  const answer = await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(answer.deny).toBeUndefined()
  expect(ran).toEqual(['git status'])
})

test("the team's standards file adds naming rules", async ($, on) => {
  workspace(on, {
    'boomi-standards.json': JSON.stringify({ naming: { 'connector-settings': '^CON_' } }),
    'active-development/connector-settings/Orders.xml': CLEAN,
  })
  const ran = shell(on)
  const answer = await $.tool.call({ tool: 'Bash', command: PUSH })
  expect(answer.deny).toContain('name-pattern')
  expect(ran).toEqual([])
})

test('with enforcement off, findings are reported to Claude and the push runs', { options: { enforce: false } }, async ($, on) => {
  workspace(on, { 'active-development/connector-settings/Orders.xml': LEAKY })
  const ran = shell(on)
  const answer = await $.tool.call({ tool: 'Bash', command: PUSH })
  expect(answer.deny).toBeUndefined()
  expect(ran).toEqual([PUSH])
})

test('/standards check reports every component in the components folder', async ($, on) => {
  workspace(on, {
    'active-development/connector-settings/Orders.xml': LEAKY,
    'active-development/connector-settings/Clean.xml': CLEAN,
    'active-development/inventories/search.xml': 'not a component',
  })
  const answer = await $.command.run(standards('check'))
  expect(answer.text).toContain('✓ active-development/connector-settings/Clean.xml')
  expect(answer.text).toContain('✗ active-development/connector-settings/Orders.xml')
  expect(answer.text).not.toContain('inventories')
  expect(answer.text).toContain('✗ standards: 1 error')
})

test('/standards rules shows the rules in force and a broken standards file', async ($, on) => {
  workspace(on, { 'boomi-standards.json': '{"severity": {"no-such-rule": "off"}}' })
  const answer = await $.command.run(standards('rules'))
  expect(answer.text).toContain("couldn't be used")
  expect(answer.text).toContain('password-in-xml')
})
