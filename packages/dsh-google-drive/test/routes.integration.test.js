import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { createHandler } from '../src/routes.js'
import { DriveAccessRuntime } from '../src/runtime.js'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const folder = { id: 'folder', name: 'Reports', mimeType: 'application/vnd.google-apps.folder', trashed: false }
const file = { id: 'file', name: 'Budget', mimeType: 'text/plain', trashed: false }
async function fixture(t) {
  const audit = [], browseCalls = []
  const agent = { session: { id: 'session', append: (...args) => audit.push(args) } }
  const agents = { get: id => id === 'session' ? agent : undefined, roots: () => [agent] }
  const client = {
    async pickerList(args) { browseCalls.push(args); return { files: [folder, file], ...(args.pageToken ? {} : { nextPageToken: 'google-private-cursor' }) } },
    async getMetadata({ fileId }) { return fileId === 'folder' ? folder : fileId === 'file' ? file : (() => { throw new Error('PRIVATE_GOOGLE_ERROR') })() },
  }
  const googleAuth = { getAccessGeneration: () => 1, onAccessChange: () => () => {}, status: async () => ({ connected: true, integrations: [{ id: 'google-drive', authorized: true }] }) }
  const runtime = new DriveAccessRuntime({ client, googleAuth, agents, approval: { overrideOf: () => 'ask' } })
  let port
  const server = createServer((req, res) => {
    const action = req.url.split('/').at(-1)
    if (!['status', 'browse', 'grant', 'deny', 'manage', 'revoke'].includes(action)) { res.writeHead(404); res.end(); return }
    void createHandler(runtime, action, port)(req, res)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); port = server.address().port
  const origin = `http://127.0.0.1:${port}`
  t.after(async () => { runtime.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-DSH-Google-Drive': '1', 'Sec-Fetch-Site': 'same-origin' }
  async function post(action, body, options = {}) {
    const response = await fetch(`${origin}/api/plugins/google-drive/${action}`, { method: 'POST', ...options, headers: { ...headers, ...options.headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
    return { status: response.status, headers: response.headers, result: await response.json() }
  }
  let record
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { record = value } }, fetch: (url, options) => fetch(origin + url, { ...options, headers: { ...headers, ...options.headers } }) } })
  const plugin = record.factory(() => ({ createElement() {} }))
  const identity = { sessionId: 'session', callId: 'call' }
  const outcome = runtime.request(agent, { callId: 'call', reason: 'Read selected reports' })
  // Yield past connected() before the first HTTP request reaches the handler.
  await Promise.resolve(); await Promise.resolve()
  return { runtime, identity, plugin, post, audit, browseCalls, outcome }
}

test('actual HTTP routes match client transport from pending through browse, grant, manage and revoke', async t => {
  const { identity, plugin, post, audit, browseCalls, outcome } = await fixture(t)
  const pending = await plugin.api('status', identity)
  assert.equal(plugin.validStatus(pending), true)
  assert.equal(pending.state, 'pending'); assert.equal(typeof pending.requestId, 'string')
  const request = { ...identity, requestId: pending.requestId }
  const first = await plugin.api('browse', request)
  assert.deepEqual(first.files.map(item => item.name), ['Reports', 'Budget'])
  assert.notEqual(first.nextPageToken, 'google-private-cursor')
  await plugin.api('browse', { ...request, pageToken: first.nextPageToken })
  assert.equal(browseCalls.at(-1).pageToken, 'google-private-cursor')
  const filtered = await plugin.api('browse', { ...request, parentId: 'folder', search: 'Budget' })
  assert.equal(filtered.files.length, 2)
  assert.equal(browseCalls.at(-1).parentId, 'folder'); assert.equal(browseCalls.at(-1).search, 'Budget')
  assert.deepEqual(audit, [], 'requests and local browse/search must not append custom session events')
  const granted = await plugin.api('grant', { ...request, selected: [{ id: 'folder', recursive: true }] })
  assert.equal(plugin.validStatus(granted), true)
  assert.equal(granted.state, 'granted')
  assert.deepEqual(granted.grants, [{ id: folder.id, name: folder.name, mimeType: folder.mimeType, recursive: true }])
  assert.equal((await outcome).state, 'granted')
  const stale = await post('grant', { ...request, selected: [{ id: 'file', recursive: false }] })
  assert.equal(stale.status, 409)
  const managed = await plugin.api('manage', identity)
  assert.equal(managed.state, 'pending'); assert.notEqual(managed.requestId, pending.requestId)
  assert.equal(managed.grants.length, 1)
  const revoked = await plugin.api('revoke', identity)
  assert.equal(plugin.validStatus(revoked), true); assert.deepEqual(revoked.grants, [])
  assert.equal((await post('browse', { ...identity, requestId: managed.requestId })).status, 409)
  assert.deepEqual(audit, [], 'grant, manage and revoke must not append custom session events')
})

test('HTTP boundary rejects cross-origin and malformed requests without leaking provider details', async t => {
  const { identity, post, plugin, outcome } = await fixture(t)
  const pending = await plugin.api('status', identity)
  const request = { ...identity, requestId: pending.requestId }
  for (const headers of [{ Origin: 'https://evil.example' }, { 'X-DSH-Google-Drive': '' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Content-Type': 'text/plain' }]) {
    assert.equal((await post('status', identity, { headers })).status, 403)
  }
  assert.equal((await post('status', { ...identity, selected: [] })).status, 400)
  assert.equal((await post('status', '{')).status, 400)
  assert.equal((await post('status', { ...identity, callId: 'x'.repeat(40000) })).status, 400)
  assert.equal((await post('status', { ...identity, sessionId: 'other' })).status, 409)
  assert.equal((await post('grant', { ...request, selected: [{ id: 'file', recursive: false, permission: 'write' }] })).status, 409)
  const denied = await post('deny', request)
  assert.equal(denied.status, 200); assert.equal(denied.result.value.state, 'denied')
  assert.equal(denied.headers.get('cache-control'), 'no-store')
  assert.equal((await outcome).state, 'denied')
})

test('browse HTTP validates views and binds paginated search to its original view', async t => {
  const { identity, post, plugin, browseCalls } = await fixture(t)
  const { requestId } = await plugin.api('status', identity)
  const request = { ...identity, requestId }
  for (const view of ['my-drive', 'shared-with-me']) {
    const options = { ...request, view, search: 'global', parentId: 'folder' }
    const first = await post('browse', options)
    assert.equal(first.status, 200)
    assert.equal(browseCalls.at(-1).view, view)
    const pageToken = first.result.value.nextPageToken
    assert.equal((await post('browse', { ...options, pageToken })).status, 200)
    assert.equal(browseCalls.at(-1).pageToken, 'google-private-cursor')
    assert.equal((await post('browse', { ...options, pageToken, view: view === 'my-drive' ? 'shared-with-me' : 'my-drive' })).status, 409)
  }
  const before = browseCalls.length
  for (const view of ['', 'unknown', 'MY-DRIVE', null, 0, {}, []]) {
    assert.equal((await post('browse', { ...request, view })).status, 400)
  }
  assert.equal(browseCalls.length, before)
})

test('failed grant settles dead pending request so Manage can mint a usable identity', async t => {
  const { identity, plugin, post, outcome } = await fixture(t)
  const pending = await plugin.api('status', identity)
  const failed = await post('grant', { ...identity, requestId: pending.requestId, selected: [{ id: 'missing', recursive: false }] })
  assert.equal(failed.status, 409)
  assert.equal(JSON.stringify(failed.result).includes('PRIVATE_GOOGLE_ERROR'), false)
  const status = await plugin.api('status', identity)
  assert.equal(status.state, 'cancelled')
  assert.equal((await outcome).state, 'cancelled')
  const managed = await plugin.api('manage', identity)
  assert.notEqual(managed.requestId, pending.requestId)
  assert.equal((await plugin.api('browse', { ...identity, requestId: managed.requestId })).files.length, 2)
})
