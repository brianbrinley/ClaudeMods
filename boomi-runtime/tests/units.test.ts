import { describe, expect, test } from 'claude-code/testing'

import { credentialsFrom, parseEnv, setEnvValue } from '../hooks/envfile'
import { isNamedRuntimeHome, isRuntimeDir, linux, pickRuntimeHome, runtimeName } from '../hooks/linux'
import { attribute, basicAuth, platformClient } from '../hooks/platform'
import type { Fetch } from '../hooks/platform'
import { helloWorldProcess } from '../hooks/smoke'

const CREDENTIALS = {
  apiUrl: 'https://api.boomi.com',
  username: 'me@example.com',
  apiToken: 'secret',
  accountId: 'acct-123',
}

describe('the Companion .env', () => {
  test('parses quotes, exports and comments', () => {
    const values = parseEnv(
      '# comment\nexport BOOMI_API_URL="https://api.boomi.com"\nBOOMI_USERNAME=me # note\nEMPTY=\n',
    )
    expect(values.BOOMI_API_URL).toBe('https://api.boomi.com')
    expect(values.BOOMI_USERNAME).toBe('me')
    expect(values.EMPTY).toBe('')
  })

  test('sets, replaces and removes a value, keeping CRLF and the rest', () => {
    const text = 'A=1\r\nBOOMI_TEST_ATOM_ID=old\r\nB=2\r\n'
    expect(setEnvValue(text, 'BOOMI_TEST_ATOM_ID', 'new')).toBe(
      'A=1\r\nBOOMI_TEST_ATOM_ID=new\r\nB=2\r\n',
    )
    expect(setEnvValue(text, 'BOOMI_TEST_ATOM_ID', undefined)).toBe('A=1\r\nB=2\r\n')
    expect(setEnvValue('A=1', 'C', '3')).toBe('A=1\nC=3')
    expect(setEnvValue('', 'C', '3')).toBe('C=3\n')
  })

  test('names the credentials that are missing', () => {
    expect(credentialsFrom({ BOOMI_API_URL: 'x' })).toEqual({
      missing: ['BOOMI_USERNAME', 'BOOMI_API_TOKEN', 'BOOMI_ACCOUNT_ID'],
    })
    const found = credentialsFrom({
      BOOMI_API_URL: 'https://api.boomi.com/',
      BOOMI_USERNAME: 'u',
      BOOMI_API_TOKEN: 't',
      BOOMI_ACCOUNT_ID: 'a',
    })
    expect('credentials' in found && found.credentials.apiUrl).toBe('https://api.boomi.com')
  })
})

describe('the Linux runtime', () => {
  test('names runtimes from prefix, date and session', () => {
    const name = runtimeName('cc', 'session_017E1Ug18pGT1QjTdwMArAYS', new Date('2026-10-02T12:00:00Z'))
    expect(name).toBe('cc-20261002-dwmarays')
  })

  test('removes only folders it made', () => {
    expect(isRuntimeDir('/root/.boomi-runtimes/cc-1', '/root/.boomi-runtimes', 'cc')).toBe(true)
    expect(isRuntimeDir('/root/.boomi-runtimes', '/root/.boomi-runtimes', 'cc')).toBe(false)
    expect(isRuntimeDir('/root/.boomi-runtimes/other', '/root/.boomi-runtimes', 'cc')).toBe(false)
    expect(isRuntimeDir('/root/.boomi-runtimes/cc-1/x', '/root/.boomi-runtimes', 'cc')).toBe(false)
    expect(isRuntimeDir('/etc/cc-1', '/root/.boomi-runtimes', 'cc')).toBe(false)
    expect(isRuntimeDir('/cc-1', '', 'cc')).toBe(false)
  })

  test('sends a daemon-starting command\'s output to a file, not the pipe', () => {
    const argv = linux.toLogFile(['/r/cc-1/bin/atom', 'start'], '/r/cc-1-start.log')
    expect(argv.slice(0, 2)).toEqual(['sh', '-c'])
    expect(argv[2]).toContain('>"$log" 2>&1 </dev/null')
    expect(argv.slice(3)).toEqual(['sh', '/r/cc-1-start.log', '/r/cc-1/bin/atom', 'start'])
    expect(isRuntimeDir(linux.startLog('/r', 'cc-1'), '/r', 'cc')).toBe(true)
  })

  test('finds the runtime folder wherever the installer put it', () => {
    const dir = '/root/.boomi-runtimes/cc-1'
    expect(pickRuntimeHome([`${dir}/Atom - cc-1/bin/atom`], dir, 'cc-1')).toBe(`${dir}/Atom - cc-1`)
    // The layout the Linux quiet installer really produces: Atom_<name>, dashes as underscores.
    const live = '/root/.boomi-runtimes/cc-20261002-25e7b32a'
    expect(
      pickRuntimeHome([`${live}/Atom_cc_20261002_25e7b32a/bin/atom`], live, 'cc-20261002-25e7b32a'),
    ).toBe(`${live}/Atom_cc_20261002_25e7b32a`)
    expect(pickRuntimeHome(['/root/Boomi AtomSphere/other/bin/atom', '/root/Boomi AtomSphere/cc-1/bin/atom'], dir, 'cc-1'))
      .toBe('/root/Boomi AtomSphere/cc-1')
    expect(pickRuntimeHome(['/root/Boomi AtomSphere/other/bin/atom'], dir, 'cc-1')).toBeUndefined()
    expect(isNamedRuntimeHome('/root/Boomi AtomSphere/Atom - cc-1', 'cc-1')).toBe(true)
    expect(isNamedRuntimeHome('/root/Boomi AtomSphere', 'cc-1')).toBe(false)
  })

  test('installs quietly with the token and name', () => {
    const argv = linux.install({
      installer: '/r/atom_install64.sh',
      dir: '/r/cc-1',
      name: 'cc-1',
      accountId: 'acct',
      token: 'tok',
      extraArgs: ['-VproxyHost=p'],
    })
    expect(argv).toEqual([
      '/r/atom_install64.sh', '-q', '-console', '-dir', '/r/cc-1',
      '-VatomName=cc-1', '-VaccountId=acct', '-VinstallToken=tok', '-VproxyHost=p',
    ])
  })
})

describe('the Platform API client', () => {
  const recorder = (answers: Record<string, { status: number; text: string }>) => {
    const calls: { url: string; method: string; body?: string; headers: Record<string, string> }[] = []
    const fetch: Fetch = async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body, headers: init?.headers ?? {} })
      const path = url.split('/acct-123/')[1] ?? ''
      const answer = answers[path] ?? { status: 404, text: '{"message":"not here"}' }
      return { ...answer, ok: answer.status < 300, headers: {} }
    }
    return { calls, fetch }
  }

  test('authenticates the way Companion does', () => {
    expect(basicAuth(CREDENTIALS)).toBe(`Basic ${btoa('BOOMI_TOKEN.me@example.com:secret')}`)
  })

  test('creates an installer token and an environment', async () => {
    const { calls, fetch } = recorder({
      InstallerToken: { status: 200, text: '{"token":"tok-1"}' },
      Environment: { status: 200, text: '{"id":"env-1","name":"cc-1"}' },
    })
    const platform = platformClient(fetch, CREDENTIALS)
    expect(await platform.createInstallerToken(30)).toBe('tok-1')
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ installType: 'ATOM', durationMinutes: 30 })
    expect(await platform.createEnvironment('cc-1')).toBe('env-1')
    expect(JSON.parse(calls[1]?.body ?? '')).toEqual({ name: 'cc-1', classification: 'TEST' })
    expect(calls[1]?.url).toBe('https://api.boomi.com/api/rest/v1/acct-123/Environment')
  })

  test('reports a refusal with its status and message', async () => {
    const platform = platformClient(recorder({}).fetch, CREDENTIALS)
    await expect(platform.findAtom('x')).rejects.toThrow('Find runtime failed (HTTP 404): not here')
  })

  test('executes over XML and waits through 202', async () => {
    const { calls, fetch } = recorder({
      ExecutionRequest: { status: 200, text: '<bns:ExecutionRequest requestId="req-1" xmlns:bns="x"/>' },
      'ExecutionRecord/async/req-1': { status: 202, text: '' },
    })
    const platform = platformClient(fetch, CREDENTIALS)
    expect(await platform.execute('proc-1', 'atom-1')).toBe('req-1')
    expect(calls[0]?.headers['Content-Type']).toBe('application/xml')
    expect(calls[0]?.body).toContain('processId="proc-1" atomId="atom-1"')
    expect(await platform.executionOutcome('req-1')).toBeUndefined()
  })

  test('reads the finished execution', async () => {
    const { calls, fetch } = recorder({
      'ExecutionRecord/async/req-1': {
        status: 200,
        text: '<bns:AsyncOperationResult xmlns:bns="http://api.platform.boomi.com/"><bns:result><bns:executionId>execution-1</bns:executionId><bns:status>COMPLETE</bns:status></bns:result></bns:AsyncOperationResult>',
      },
    })
    const platform = platformClient(fetch, CREDENTIALS)
    expect(await platform.executionOutcome('req-1')).toEqual({
      executionId: 'execution-1',
      status: 'COMPLETE',
    })
    expect(calls[0]?.headers.Accept).toBe('application/xml')
  })

  test('accepts a successful delete whose answer is not JSON', async () => {
    const { calls, fetch } = recorder({
      'Atom/atom-1': { status: 200, text: '<bns:deleteResponse/>' },
      'Environment/env-1': { status: 200, text: '{' },
    })
    const platform = platformClient(fetch, CREDENTIALS)
    await platform.deleteAtom('atom-1')
    await platform.deleteEnvironment('env-1')
    expect(calls.map(call => call.method)).toEqual(['DELETE', 'DELETE'])
  })

  test('resolves a target folder by name, path or ID', async () => {
    const folders = (results: object[]) => ({ status: 200, text: JSON.stringify({ result: results }) })
    const claudeMods = { id: 'Rjo4ODc3Mzc2', name: 'ClaudeMods', fullPath: 'Acct/ClaudeMods' }
    const { calls, fetch } = recorder({ 'Folder/query': folders([claudeMods, { ...claudeMods, id: 'old', deleted: true }]) })
    const platform = platformClient(fetch, CREDENTIALS)
    expect(await platform.resolveFolder('ClaudeMods')).toEqual({ id: 'Rjo4ODc3Mzc2', fullPath: 'Acct/ClaudeMods' })
    expect(JSON.parse(calls[0]?.body ?? '').QueryFilter.expression).toEqual({
      operator: 'EQUALS', property: 'name', argument: ['ClaudeMods'],
    })
    expect((await platform.resolveFolder('Acct/ClaudeMods/')).id).toBe('Rjo4ODc3Mzc2')

    const byId = platformClient(
      recorder({ 'Folder/query': folders([]), 'Folder/Rjo4ODc3Mzc2': { status: 200, text: JSON.stringify(claudeMods) } }).fetch,
      CREDENTIALS,
    )
    expect((await byId.resolveFolder('Rjo4ODc3Mzc2')).fullPath).toBe('Acct/ClaudeMods')
  })

  test('refuses an ambiguous or unknown folder', async () => {
    const twins = [
      { id: 'a', name: 'Shared', fullPath: 'Acct/One/Shared' },
      { id: 'b', name: 'Shared', fullPath: 'Acct/Two/Shared' },
    ]
    const platform = platformClient(
      recorder({ 'Folder/query': { status: 200, text: JSON.stringify({ result: twins }) } }).fetch,
      CREDENTIALS,
    )
    await expect(platform.resolveFolder('Shared')).rejects.toThrow('Acct/One/Shared, Acct/Two/Shared')
    expect((await platform.resolveFolder('Acct/Two/Shared')).id).toBe('b')
    await expect(platform.resolveFolder('Nope')).rejects.toThrow('no folder has the name, path or ID Nope')
  })

  test('creates components over XML, which is all that API speaks', async () => {
    const { calls, fetch } = recorder({
      Component: {
        status: 200,
        text: '<?xml version="1.0"?><bns:Component xmlns:bns="http://api.platform.boomi.com/" folderFullPath="Acct/ClaudeMods" componentId="9690294f-8d01-4c57-bc86-f66a84a2420e" version="1"/>',
      },
    })
    const platform = platformClient(fetch, CREDENTIALS)
    expect(await platform.createComponent('<bns:Component/>')).toBe('9690294f-8d01-4c57-bc86-f66a84a2420e')
    expect(calls[0]?.headers.Accept).toBe('application/xml')
    expect(calls[0]?.headers['Content-Type']).toBe('application/xml')
  })

  test('finds the reusable smoke process, never a deleted or old version', async () => {
    const meta = (extra: object) => ({
      componentId: 'c-1', name: 'boomi-runtime hello world', folderId: 'f-1',
      currentVersion: true, deleted: false, ...extra,
    })
    const answer = (results: object[]) =>
      recorder({ 'ComponentMetadata/query': { status: 200, text: JSON.stringify({ result: results }) } }).fetch
    const find = (results: object[], folder?: string) =>
      platformClient(answer(results), CREDENTIALS).findComponent('boomi-runtime hello world', folder)
    expect(await find([meta({})], 'f-1')).toBe('c-1')
    expect(await find([meta({})])).toBe('c-1')
    expect(await find([meta({})], 'f-2')).toBeUndefined()
    expect(await find([meta({ deleted: true })])).toBeUndefined()
    expect(await find([meta({ currentVersion: false })])).toBeUndefined()
  })

  test('reads attributes from JSON and XML answers', () => {
    expect(attribute('{"componentId" : "c-1"}', 'componentId')).toBe('c-1')
    expect(attribute('<bns:Component componentId="c-2" name="n">', 'componentId')).toBe('c-2')
  })
})

describe('the smoke test process', () => {
  test('is a No Data start, a message, a notify and a stop', () => {
    const xml = helloWorldProcess('cc-1 <hello>', 'folder-1')
    expect(xml).toContain('<noaction/>')
    expect(xml).toContain('folderId="folder-1"')
    expect(xml).toContain('name="cc-1 &#60;hello&#62;"')
    expect(xml).toContain('shapetype="stop"')
    expect(helloWorldProcess('x')).not.toContain('folderId')
  })
})
