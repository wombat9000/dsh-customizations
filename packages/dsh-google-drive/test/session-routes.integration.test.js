import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { allowedRequest, createHandler } from '../src/routes.js'
import { SessionDriveTools } from '../src/session-tools.js'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
async function fixture(t) {
  const live = new Map(), roots = new Set(), revoked = [], cleanups = new Set()
  const agents = { get: id => live.get(id), roots: () => [...roots] }
  const add = (id, root = true) => {
    const tools = new Map(), skills = new Map()
    const registry = map => ({ register(value) {
      if (map.has(value.name)) throw new Error('Duplicate fixture registration')
      map.set(value.name, value)
      return () => map.delete(value.name)
    } })
    const registries = { tools: registry(tools), skills: registry(skills) }
    const agent = { session: { id }, ctx: { get: key => registries[key], effect(factory) {
      const dispose = factory(); cleanups.add(dispose)
      return () => { if (cleanups.delete(dispose)) dispose() }
    } } }
    live.set(id, agent); if (root) roots.add(agent)
    return { agent, tools, skills }
  }
  const a = add('a'), b = add('b'), child = add('child', false)
  const service = {
    assertOwner(agent) { if (!agent || live.get(agent.session.id) !== agent || !roots.has(agent)) throw new Error('Not a live root') },
    hasAccess: () => false, hasEditAccess: () => false, observe: () => () => {},
    revokeSession: agent => revoked.push(agent), release: () => {},
  }
  const manager = new SessionDriveTools({ service, agents })
  const handlers = { 'session-status': input => manager.status(input), 'session-set': (input, signal) => manager.set(input, signal) }
  let port
  const server = createServer((req, res) => {
    const action = req.url.split('/').at(-1)
    if (!Object.hasOwn(handlers, action)) { res.writeHead(404); res.end(); return }
    void createHandler(handlers, action, port)(req, res)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); port = server.address().port
  const origin = `http://127.0.0.1:${port}`
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-DSH-Google-Drive': '1', 'Sec-Fetch-Site': 'same-origin' }
  async function post(action, body, options = {}) {
    const response = await fetch(`${origin}/api/plugins/google-drive/${action}`, { method: 'POST', ...options,
      headers: { ...headers, ...options.headers }, ...(options.method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) })
    return { status: response.status, headers: response.headers, result: await response.json() }
  }
  let record
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { record = value } },
    fetch: (url, options) => fetch(origin + url, { ...options, headers: { ...headers, ...options.headers } }) } })
  const plugin = record.factory(() => ({ createElement() {} }))
  t.after(async () => {
    manager.dispose()
    for (const dispose of [...cleanups]) { cleanups.delete(dispose); dispose() }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  })
  return { manager, handlers, post, plugin, a, b, child, live, roots, add, revoked }
}
const mutation = (status, enabled) => ({ sessionId: 'a', ownerId: status.ownerId, revision: status.revision, enabled })

test('real session HTTP routes and client transport expose only exact root-scoped request tools', async t => {
  const f = await fixture(t)
  const initial = await f.plugin.api('session-status', { sessionId: 'a' })
  assert.equal(f.plugin.validSessionStatus(initial), true)
  assert.equal(initial.enabled, false)
  assert.equal(f.a.tools.size, 0)
  const enabled = await f.plugin.api('session-set', mutation(initial, true))
  assert.equal(enabled.enabled, true)
  assert.ok(enabled.revision > initial.revision)
  assert.deepEqual([...f.a.tools.keys()].sort(), ['request_drive_access', 'request_sheets_edit_access'])
  assert.equal(f.a.skills.size, 0, 'enabling alone does not expose read skills or grant file access')
  assert.equal(f.b.tools.size, 0); assert.equal(f.child.tools.size, 0)
  assert.equal((await f.plugin.api('session-status', { sessionId: 'b' })).enabled, false)
  const stale = await postWith(f, initial, true)
  assert.equal(stale.status, 409)
  const disabled = await f.plugin.api('session-set', mutation(enabled, false))
  assert.equal(disabled.enabled, false)
  assert.equal(f.a.tools.size, 0)
  assert.deepEqual(f.revoked, [f.a.agent])
})
function postWith(f, status, enabled) { return f.post('session-set', mutation(status, enabled)) }

test('session routes reject caller authority, malformed types and missing fields before dispatch', async t => {
  const f = await fixture(t)
  const initial = (await f.post('session-status', { sessionId: 'a' })).result.value
  const valid = mutation(initial, true)
  const invalidStatus = [null, [], {}, { sessionId: '' }, { sessionId: 'a'.repeat(201) }, { sessionId: 1 },
    { sessionId: 'a', callId: 'call' }, { sessionId: 'a', enabled: true }, { sessionId: 'a', ownerId: initial.ownerId }]
  for (const body of invalidStatus) assert.equal((await f.post('session-status', body)).status, 400)
  const invalidSet = [null, [], {}, { ...valid, sessionId: '' }, { ...valid, sessionId: 'x'.repeat(201) },
    { ...valid, ownerId: '' }, { ...valid, ownerId: 'x'.repeat(201) }, { ...valid, ownerId: {} },
    { ...valid, revision: -1 }, { ...valid, revision: 0.5 }, { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, revision: '0' }, { ...valid, revision: null }, { ...valid, enabled: 'true' }, { ...valid, enabled: 1 },
    { ...valid, callId: 'call' }, { ...valid, grants: [] }, { ...valid, agent: {} }, { ...valid, tools: [] }]
  for (const key of Object.keys(valid)) invalidSet.push(Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key)))
  for (const body of invalidSet) assert.equal((await f.post('session-set', body)).status, 400)
  assert.equal((await f.post('session-set', '{')).status, 400)
  assert.equal((await f.post('session-set', JSON.stringify({ ...valid, extra: 'x'.repeat(33000) }))).status, 400)
  assert.equal(f.a.tools.size, 0)
  assert.equal((await f.post('session-status', { sessionId: 'a' })).result.value.revision, initial.revision)
})

test('toolbar HTTP boundary keeps origin/header checks and sanitizes failures', async t => {
  const f = await fixture(t)
  const initial = (await f.post('session-status', { sessionId: 'a' })).result.value
  for (const headers of [{ Origin: 'https://evil.example' }, { 'X-DSH-Google-Drive': '' },
    { 'Sec-Fetch-Site': 'cross-site' }, { 'Content-Type': 'text/plain' }]) {
    for (const action of ['session-status', 'session-set']) {
      assert.equal((await f.post(action, action === 'session-status' ? { sessionId: 'a' } : mutation(initial, true), { headers })).status, 403, `${action}: ${JSON.stringify(headers)}`)
    }
  }
  // Node fetch normalizes Host, so probe the shared connection guard directly.
  const headers = { host: '127.0.0.1:3082', origin: 'http://127.0.0.1:3082', 'content-type': 'application/json', 'x-dsh-google-drive': '1' }
  assert.equal(allowedRequest({ socket: { remoteAddress: '127.0.0.1' }, headers }, 3082), true)
  assert.equal(allowedRequest({ socket: { remoteAddress: '192.0.2.1' }, headers }, 3082), false)
  assert.equal(allowedRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { ...headers, host: 'evil.example', origin: 'http://evil.example' } }, 3082), false)
  assert.equal((await f.post('session-status', {}, { method: 'GET' })).status, 405)
  f.handlers['session-set'] = () => { throw new Error('PRIVATE_FIXTURE_TOKEN_AND_PROVIDER_DETAILS') }
  const failure = await postWith(f, initial, true)
  assert.equal(failure.status, 409)
  assert.equal(JSON.stringify(failure.result).includes('PRIVATE_FIXTURE'), false)
  assert.equal(failure.headers.get('cache-control'), 'no-store')
  assert.equal(f.a.tools.size, 0)
})

test('absent/child sessions stay unavailable; old incarnation cannot enable a replacement owner', async t => {
  const f = await fixture(t)
  for (const sessionId of ['archived', 'child']) {
    const result = await f.post('session-status', { sessionId })
    assert.equal(result.status, 200)
    assert.deepEqual(result.result.value, { available: false, enabled: false })
    assert.equal((await f.post('session-set', { sessionId, ownerId: 'unknown', revision: 0, enabled: true })).status, 409)
  }
  const old = (await f.post('session-status', { sessionId: 'a' })).result.value
  f.manager.release(f.a.agent); f.roots.delete(f.a.agent)
  const replacement = f.add('a')
  const current = (await f.post('session-status', { sessionId: 'a' })).result.value
  assert.notEqual(current.ownerId, old.ownerId)
  assert.equal(current.enabled, false)
  assert.equal((await postWith(f, old, true)).status, 409)
  assert.equal(replacement.tools.size, 0)
  assert.equal((await postWith(f, current, true)).status, 200)
  assert.equal(replacement.tools.size, 2)
  assert.equal(f.a.tools.size, 0)
})
