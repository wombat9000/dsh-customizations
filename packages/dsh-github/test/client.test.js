import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
function load(react = {}, fetch = () => { throw new Error('Unexpected fetch') }) {
  let record
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { record = value } } }, URL, fetch, AbortController, setTimeout, clearTimeout })
  return { record, plugin: record.factory(name => { assert.equal(name, 'react'); return react }) }
}
const scope = { account: { id: 'U_1', login: 'fixture' }, operations: ['setProjectItemField', 'addIssueDependency'],
  issues: [{ id: 'I_1', repositoryId: 'R_1', repositoryOwnerId: 'U_1', nameWithOwner: 'fixture/repo', issueNumber: 1, url: 'https://github.com/fixture/repo/issues/1' }],
  projects: [{ id: 'P_1', ownerId: 'U_1', owner: 'fixture', projectNumber: 2 }], memberships: [{ id: 'ITEM_1', issueId: 'I_1', projectId: 'P_1' }] }
const status = { version: 1, toolName: 'github_request_issue_management', callId: 'call', phase: 'active', scope, grants: [{ id: 'grant', scope, state: 'active' }], history: [] }

test('client owns only the grant tool key and returns the slot disposer', () => {
  const { record, plugin } = load(), entries = [], disposer = () => {}
  assert.equal(record.id, '@local/dsh-github')
  plugin.apply({ slots: { inject(name, callback) { assert.equal(name, 'tool.call.toolview'); assert.equal(callback(), disposer) }, register(options, component) { entries.push(options); assert.equal(component, plugin.GrantCard); return disposer } } })
  assert.deepEqual(JSON.parse(JSON.stringify(entries)), [{ name: 'tool.call.toolview', key: 'github_request_issue_management' }])
})
test('scope/status validation fails closed on malformed and mismatched data', () => {
  const { plugin } = load()
  assert.equal(plugin.validScope(scope), true)
  assert.equal(plugin.validStatus(status, 'call'), true)
  for (const value of [null, {}, { ...status, version: 2 }, { ...status, callId: 'other' }, { ...status, toolName: 'github_create_issue' }, { ...status, history: null }, { ...status, scope: { ...scope, operations: ['deleteIssue'] } }, { ...status, grants: [{ id: 'g', state: 'active' }] }]) assert.equal(plugin.validStatus(value, 'call'), false)
  assert.equal(plugin.validScope({ ...scope, issues: [{ ...scope.issues[0], repositoryId: '' }] }), false)
  assert.equal(plugin.validStatus({ version: 1, phase: 'expired', grants: [], history: [] }, 'call'), true)
})
test('links require exact public HTTPS github.com authority', () => {
  const { plugin } = load()
  assert.equal(plugin.safeUrl('https://github.com/fixture/repo'), 'https://github.com/fixture/repo')
  for (const url of ['javascript:alert(1)', 'http://github.com/a', 'https://github.com.evil.test/a', 'https://u:p@github.com/a', 'https://github.com:9000/a', '//github.com/a', undefined]) assert.equal(plugin.safeUrl(url), undefined)
})
test('raw details retain original args, result and structured error without inferring state', () => {
  const { plugin } = load()
  assert.equal(plugin.rawDetails({ argsRaw: '{"issues":[]}' }), 'Arguments\n{"issues":[]}')
  assert.equal(plugin.rawDetails({ call: { argsRaw: '{}' }, content: [{ type: 'text', text: 'uncertain' }], error: { name: 'Denied', code: 'DENIED' } }), 'Arguments\n{}\n\nResult\nuncertain\n\nError\nDenied: DENIED')
  assert.match(plugin.phaseLabel('surprise'), /unknown/)
  assert.doesNotMatch(plugin.phaseLabel('running'), /success|granted/i)
})
test('browser API uses the same-origin strict identity body and never accepts an approval action', async () => {
  const calls = [], { plugin } = load({}, async (...args) => { calls.push(args); return { ok: true, json: async () => ({ ok: true, value: status }) } })
  const controller = new AbortController()
  assert.equal(await plugin.api('status', { sessionId: 's', callId: 'call' }, controller.signal), status)
  const [url, options] = calls[0]
  assert.equal(url, '/api/plugins/github/status')
  assert.equal(options.credentials, 'same-origin')
  assert.equal(options.headers['x-dsh-github'], '1')
  assert.equal(options.body, '{"sessionId":"s","callId":"call"}')
  assert.equal(options.signal, controller.signal)
  await assert.rejects(plugin.api('approve', {}), /Unsupported/)
  assert.equal(calls.length, 1)
})
