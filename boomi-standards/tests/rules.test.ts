import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULT_STANDARDS,
  checkComponent,
  companionCalls,
  formatReports,
  parseStandards,
  statusLine,
} from '../hooks/rules'
import type { Standards } from '../hooks/rules'

const component = (attrs: string, body = '') =>
  `<?xml version="1.0" encoding="UTF-8"?>
<bns:Component xmlns:bns="http://api.platform.boomi.com/" ${attrs}>
  <bns:encryptedValues/>
  <bns:object>${body}</bns:object>
</bns:Component>`

const process = (name: string, body = '') =>
  component(`componentId="" name="${name}" type="process" folderId="Rjo3OTk2NjEx"`, body)

const rulesOf = (xml: string, mode: Parameters<typeof checkComponent>[1] = 'push', standards: Standards = DEFAULT_STANDARDS) =>
  checkComponent(xml, mode, standards).map(f => f.rule)

const TOKEN = 'ab'.repeat(64)

describe('the component rules', () => {
  test('a clean component passes', () => {
    expect(rulesOf(process('Orders Sync'), 'create')).toEqual([])
  })

  test('a new component must leave componentId empty and name a real folder', () => {
    expect(rulesOf(component('componentId="abc-123" name="A" type="process" folderId="F1"'), 'create')).toContain(
      'component-id-on-create',
    )
    expect(rulesOf(component('componentId="" name="A" type="process" folderId=""'), 'create')).toContain('folder-missing')
    expect(rulesOf(component('componentId="" name="A" type="process"'), 'create')).toContain('folder-missing')
    expect(rulesOf(component('name="A" type="process" folderId="{FOLDER_GUID}"'), 'push')).toContain('folder-missing')
  })

  test('an update may carry its componentId', () => {
    expect(rulesOf(component('componentId="abc-123" name="A" type="process" folderId="F1"'), 'push')).toEqual([])
  })

  test('folders are limited to the listed ones when the standards list some', () => {
    const standards = { ...DEFAULT_STANDARDS, folders: ['F1'] }
    expect(rulesOf(component('name="A" type="process" folderId="F1"'), 'push', standards)).toEqual([])
    expect(rulesOf(component('name="A" type="process" folderId="F2"'), 'push', standards)).toContain('folder-not-allowed')
  })

  test('names need a value, no placeholder, and the pattern for their type', () => {
    expect(rulesOf(process(''))).toContain('name-placeholder')
    expect(rulesOf(process('{ComponentName}'))).toContain('name-placeholder')
    const standards = { ...DEFAULT_STANDARDS, naming: { process: '^PRC_', '*': '^[A-Z]' } }
    expect(rulesOf(process('PRC_Orders'), 'push', standards)).toEqual([])
    expect(rulesOf(process('Orders'), 'push', standards)).toContain('name-pattern')
    const map = component('name="orders map" type="transform.map" folderId="F1"')
    expect(rulesOf(map, 'push', standards)).toContain('name-pattern')
  })

  test('a password written into a password field is refused', () => {
    const xml = component(
      'name="REST" type="connector-settings" folderId="F1"',
      '<field id="password" type="password" value="hunter2!"/>',
    )
    const findings = checkComponent(xml, 'push', DEFAULT_STANDARDS)
    expect(findings.map(f => f.rule)).toEqual(['password-in-xml'])
    expect(JSON.stringify(findings)).not.toContain('hunter2')
  })

  test('a pulled password token pushed back is refused', () => {
    const xml = component('name="REST" type="connector-settings" folderId="F1"', `<field value="${TOKEN}" type="password" id="password"/>`)
    expect(rulesOf(xml)).toEqual(['password-token'])
  })

  test('empty password fields pass', () => {
    const xml = component('name="REST" type="connector-settings" folderId="F1"', '<field id="password" type="password" value=""/>')
    expect(rulesOf(xml)).toEqual([])
  })

  test('a password process property may not have a default', () => {
    const property = (fallback: string) =>
      component(
        'name="Props" type="processproperty" folderId="F1"',
        `<DefinedProcessProperties><definedProcessProperty key="prop-api-key"><type>password</type>${fallback}</definedProcessProperty>
         <definedProcessProperty key="prop-url"><type>string</type><defaultValue>https://x</defaultValue></definedProcessProperty></DefinedProcessProperties>`,
      )
    expect(rulesOf(property('<defaultValue/>'))).toEqual([])
    expect(rulesOf(property('<defaultValue>s3cret</defaultValue>'))).toEqual(['password-property-default'])
  })

  test('secrets are caught anywhere in the XML', () => {
    for (const secret of [
      'AKIAIOSFODNN7EXAMPLE',
      '-----BEGIN RSA PRIVATE KEY-----',
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0',
      'Basic dXNlcjpwYXNzd29yZDEyMw==',
      'https://api.example.com/v1?api_key=abcdef123456',
      'ghp_' + 'a'.repeat(36),
    ]) {
      const xml = process('Orders', `<message><msgTxt>${secret}</msgTxt></message>`)
      expect(rulesOf(xml)).toContain('secret-pattern')
    }
  })

  test('ordinary text is not mistaken for a secret', () => {
    const xml = process('Orders', '<message><msgTxt>Basic Authentication with a Bearer {token} header</msgTxt></message>')
    expect(rulesOf(xml)).toEqual([])
  })

  test('forbidden text and the Try/Catch rule follow the standards', () => {
    const standards = parseStandards(
      JSON.stringify({ forbiddenText: [{ pattern: 'prod\\.acme\\.com', message: 'production host' }], severity: { 'try-catch': 'warning' } }),
    )
    const findings = checkComponent(process('Orders', '<url>https://prod.acme.com/x</url>'), 'push', standards)
    expect(findings.map(f => [f.rule, f.severity])).toEqual([
      ['forbidden-text', 'error'],
      ['try-catch', 'warning'],
    ])
    expect(rulesOf(process('Orders', '<shape shapetype="catcherrors"/>'), 'push', standards)).toEqual([])
  })

  test('a file that is not a component throws', () => {
    expect(() => checkComponent('{"not":"xml"}', 'push', DEFAULT_STANDARDS)).toThrow()
  })
})

describe('the standards file', () => {
  test('fills in the defaults', () => {
    const standards = parseStandards('{"naming": {"process": "^PRC_"}}')
    expect(standards.naming).toEqual({ process: '^PRC_' })
    expect(standards.severity['password-in-xml']).toBe('error')
    expect(standards.severity['try-catch']).toBe('off')
  })

  test('refuses mistakes instead of quietly turning a rule off', () => {
    for (const text of [
      '[]',
      '{"naming": {"process": "("}}',
      '{"folders": "F1"}',
      '{"severity": {"no-such-rule": "off"}}',
      '{"severity": {"try-catch": "loud"}}',
      '{"forbiddenText": [{"message": "no pattern"}]}',
      'not json',
    ]) {
      expect(() => parseStandards(text)).toThrow()
    }
  })
})

describe('reading Companion commands', () => {
  test('finds the scripts that send components and the files they name', () => {
    expect(
      companionCalls(
        'bash ~/.claude/plugins/bc/skills/boomi-integration/scripts/boomi-component-create.sh "active-development/process/My Process.xml"',
      ),
    ).toEqual([{ script: 'create', mode: 'create', files: ['active-development/process/My Process.xml'] }])
    expect(
      companionCalls('bash scripts/boomi-deploy.sh active-development/process/a.xml --deployment-notes "first.xml try"'),
    ).toEqual([{ script: 'deploy', mode: 'deploy', files: ['active-development/process/a.xml'] }])
  })

  test('follows a cd and separates chained commands', () => {
    expect(
      companionCalls(
        "cd /work && bash s/boomi-component-push.sh a/p.xml && bash s/boomi-component-push.sh /abs/q.xml; echo done.xml",
      ),
    ).toEqual([
      { script: 'push', mode: 'push', files: ['/work/a/p.xml'] },
      { script: 'push', mode: 'push', files: ['/abs/q.xml'] },
    ])
  })

  test('ignores everything else', () => {
    expect(companionCalls('bash scripts/boomi-component-pull.sh --component-id 123')).toEqual([])
    expect(companionCalls('cat active-development/process/a.xml')).toEqual([])
    expect(companionCalls('bash scripts/boomi-deploy.sh --list-environments')).toEqual([
      { script: 'deploy', mode: 'deploy', files: [] },
    ])
  })
})

describe('reporting', () => {
  test('shows an icon and a label, never color alone', () => {
    const clean = { path: 'a.xml', findings: [] }
    const warned = { path: 'b.xml', findings: [{ rule: 'try-catch' as const, severity: 'warning' as const, message: 'm' }] }
    const failed = { path: 'c.xml', findings: [{ rule: 'password-in-xml' as const, severity: 'error' as const, message: 'm' }] }
    expect(statusLine([clean])).toBe('✓ standards: 1 component pass')
    expect(statusLine([clean, warned])).toBe('⚠ standards: 1 warning')
    expect(statusLine([warned, failed])).toBe('✗ standards: 1 error')
    expect(formatReports([failed, { path: 'd.xml', findings: [], unreadable: 'ENOENT' }])).toContain('? d.xml')
  })
})
