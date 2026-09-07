import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply, CLIENT_KEY, CREDENTIAL_KEY, GoogleDriveService, credentialAdapter, parseClientJson } from '../src/index.js'
import { allowedRequest, settingsHandler } from '../src/routes.js'
import { createListTool } from '../src/tools.js'

const clientId = 'test-desktop.apps.googleusercontent.com'
const clientJson = JSON.stringify({ installed: { client_id: clientId, client_secret: 'test-only-secret', token_uri: 'https://attacker.invalid/token' } })
function store() {
  const records = new Map()
  return {
    records,
    async readRecord(key) { return records.get(key) },
    async modifyRecord(key, fn) { const next = await fn(records.get(key)); if (next) records.set(key, next); return records.get(key) },
    async deleteRecord(key) { records.delete(key) },
  }
}
function fakeClient(options) {
  return {
    options, disposed: false,
    async status() { return { configured: true, connected: Boolean(await options.credentials.get()), pending: false } },
    async begin() { return { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test', expiresAt: 123 } },
    cancel() {},
    dispose() { this.disposed = true },
    async listFiles(args) { return { files: [], args } },
    async getAccessToken() { return 'test-access-token' },
  }
}

test('Desktop JSON normalization discards endpoints and rejects Web clients without echoing input', () => {
  assert.deepEqual(parseClientJson(clientJson), { clientId, clientSecret: 'test-only-secret' })
  assert.deepEqual(parseClientJson(JSON.stringify({ installed: { client_id: clientId } })), { clientId })
  for (const bad of ['secret-token{', '{}', 'null', JSON.stringify({ web: { client_id: clientId } }), 'x'.repeat(32769), JSON.stringify({ installed: { client_id: clientId, client_secret: 12 } })]) {
    assert.throws(() => parseClientJson(bad), error => !error.message.includes('secret-token') && /Desktop/.test(error.message))
  }
})

test('configuration and tokens stay in separate credential records; status stays write-only', async () => {
  const credentials = store()
  const service = new GoogleDriveService({ credentials, createClient: fakeClient })
  assert.equal((await service.status()).configured, false)
  assert.deepEqual(await service.configure(clientJson), {})
  assert.deepEqual(credentials.records.get(CLIENT_KEY), { kind: 'grant', payload: { version: 1, clientId, clientSecret: 'test-only-secret' } })
  assert.deepEqual(await service.status(), { configured: true, connected: false, pending: false })
  const client = await service.load()
  await client.options.credentials.set({ accessToken: 'test-access', refreshToken: 'test-refresh', expiresAt: 999 })
  assert.equal((await service.status()).connected, true)
  assert.equal(credentials.records.get(CREDENTIAL_KEY).payload.clientId, clientId)
  assert.doesNotMatch(JSON.stringify(await service.status()), /test-only-secret|test-access|test-refresh/)
  assert.equal(await service.getAccessToken(), 'test-access-token')
  service.dispose()
})

test('replacing and removing configuration invalidate old clients and tokens', async () => {
  const credentials = store()
  const service = new GoogleDriveService({ credentials, createClient: fakeClient })
  await service.configure(clientJson)
  const first = await service.load()
  await first.options.credentials.set({ refreshToken: 'old' })
  await service.configure(JSON.stringify({ installed: { client_id: 'replacement.apps.googleusercontent.com' } }))
  assert.equal(first.disposed, true)
  assert.equal(credentials.records.has(CREDENTIAL_KEY), false)
  await assert.rejects(first.options.credentials.set({ refreshToken: 'late' }), /Could not save/)
  assert.equal(credentials.records.has(CREDENTIAL_KEY), false)
  await service.clearConfig()
  assert.equal(credentials.records.size, 0)
  assert.equal((await service.status()).configured, false)
  service.dispose()
})

test('disconnect clears tokens but retains client configuration; invalid config leaves connection alone', async () => {
  const credentials = store()
  const service = new GoogleDriveService({ credentials, createClient: fakeClient })
  await service.configure(clientJson)
  const client = await service.load()
  await client.options.credentials.set({ refreshToken: 'test-refresh' })
  await assert.rejects(service.configure('{bad'), /Desktop/)
  assert.equal(client.disposed, false)
  assert.equal(credentials.records.has(CREDENTIAL_KEY), true)
  await service.disconnect()
  assert.equal(client.disposed, true)
  assert.equal(credentials.records.has(CREDENTIAL_KEY), false)
  assert.equal(credentials.records.has(CLIENT_KEY), true)
  assert.equal((await service.status()).connected, false)
  service.dispose()
})

test('credential adapter binds grants to the client and sanitizes provider failures', async () => {
  const credentials = store()
  const adapter = credentialAdapter(credentials, clientId)
  credentials.records.set(CREDENTIAL_KEY, { kind: 'grant', payload: { version: 1, clientId: 'different', tokens: { refreshToken: 'old' } } })
  assert.equal(await adapter.get(), undefined)
  const bad = credentialAdapter({ readRecord() { throw new Error('SECRET') }, modifyRecord() { throw new Error('SECRET') }, deleteRecord() { throw new Error('SECRET') } }, clientId)
  for (const action of [() => bad.get(), () => bad.set({}), () => bad.delete()]) {
    await assert.rejects(action(), error => !error.message.includes('SECRET'))
  }
})

test('replacement prevents an in-flight old store mutation from resurrecting a token', async () => {
  const credentials = store()
  const service = new GoogleDriveService({ credentials, createClient: fakeClient })
  await service.configure(clientJson)
  const old = await service.load()
  let mutate
  const original = credentials.modifyRecord
  credentials.modifyRecord = (key, fn) => key === CREDENTIAL_KEY ? new Promise((resolve, reject) => {
    mutate = () => original(key, fn).then(resolve, reject)
  }) : original(key, fn)
  const writing = old.options.credentials.set({ refreshToken: 'late' })
  const failed = assert.rejects(writing, /Could not save/)
  await service.configure(clientJson)
  await mutate()
  await failed
  assert.equal(credentials.records.has(CREDENTIAL_KEY), false)
  service.dispose()
})

function request(body = {}, overrides = {}) {
  const req = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))])
  req.method = overrides.method ?? 'POST'
  req.socket = { remoteAddress: overrides.address ?? '127.0.0.1' }
  req.headers = { host: '127.0.0.1:3082', origin: 'http://127.0.0.1:3082', 'x-dsh-google-drive': '1', 'content-type': 'application/json', ...overrides.headers }
  return req
}
async function invoke(action, body, service, overrides) {
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers }, end(text) { this.body = JSON.parse(text) } }
  await settingsHandler(service, action, 3082)(request(body, overrides), res)
  return res
}

test('settings boundary rejects cross-origin, remote, rebinding and missing-header requests', async () => {
  for (const overrides of [
    { address: '192.0.2.1' }, { headers: { origin: 'https://attacker.invalid' } },
    { headers: { host: 'attacker.invalid:3082', origin: 'http://attacker.invalid:3082' } },
    { headers: { origin: undefined } }, { headers: { 'x-dsh-google-drive': undefined } },
    { headers: { 'content-type': 'text/plain' } }, { headers: { 'sec-fetch-site': 'cross-site' } },
  ]) {
    const res = await invoke('configure', { clientJson }, { configure() { assert.fail('must not run') } }, overrides)
    assert.equal(res.status, 403)
  }
  assert.equal(allowedRequest(request({}, { headers: { host: 'localhost:3082', origin: 'http://localhost:3082' } }), 3082), true)
})

test('settings requires POST, strict bounded body and allowlisted actions', async () => {
  const service = { status() { assert.fail('must not run') } }
  assert.equal((await invoke('status', {}, service, { method: 'GET' })).status, 405)
  for (const body of ['bad-json', 'x'.repeat(1025), { token: 'test' }, [], null]) {
    assert.equal((await invoke('status', body, service)).status, 400)
  }
  assert.equal((await invoke('getAccessToken', {}, service)).status, 400)
  assert.equal((await invoke('configure', { clientJson, extra: 1 }, service)).status, 400)
  assert.equal((await invoke('configure', { clientJson: 'x'.repeat(32769) }, service)).status, 400)
})

test('configuration is write-only and status projects safe fields; failures redact input', async () => {
  let saved
  const service = {
    configure(value) { saved = value; return { clientSecret: 'NEVER-RETURN' } },
    status() { return { configured: true, connected: false, pending: false, accessToken: 'NEVER-RETURN', clientSecret: 'NEVER-RETURN' } },
    clearConfig() { return { token: 'NEVER-RETURN' } },
  }
  const response = await invoke('configure', { clientJson }, service)
  assert.equal(saved, clientJson)
  assert.deepEqual(response.body, { ok: true, value: {} })
  assert.equal(response.headers['Cache-Control'], 'no-store')
  assert.deepEqual((await invoke('status', {}, service)).body.value, { configured: true, connected: false, pending: false })
  assert.deepEqual((await invoke('clear-config', {}, service)).body.value, {})
  const failed = await invoke('configure', { clientJson }, { configure() { throw new Error(clientJson) } })
  assert.doesNotMatch(JSON.stringify(failed.body), /test-only-secret|test-desktop/)
})

test('only metadata list is exposed to the model and it validates before calling service', async () => {
  const calls = []
  const tool = createListTool({ listFiles(args) { calls.push(args); return { files: [] } }, getAccessToken() { assert.fail('never expose tokens') } })
  assert.equal(tool.name, 'google_drive_list_files')
  assert.equal(tool.parameters.additionalProperties, false)
  const exec = { agent: {}, signal: new AbortController().signal }
  await assert.rejects(tool.execute({}, {}), /calling agent/)
  for (const args of [{ pageSize: 101 }, { pageSize: 0 }, { pageSize: 1.2 }, { query: 3 }, { token: 'test' }]) {
    await assert.rejects(tool.execute(args, exec), /pageSize/)
  }
  assert.equal(calls.length, 0)
  assert.deepEqual(JSON.parse(await tool.execute({ pageSize: 10 }, exec)), { files: [] })
  assert.equal(calls[0].signal, exec.signal)
})

test('host provides OAuth service and six lifecycle-owned routes, never tools', () => {
  const credentials = store()
  const routes = []
  const cleanups = []
  let service
  apply({ credentials, webServer: { port: 3082, register(route) {
    routes.push(route)
    return () => routes.splice(routes.indexOf(route), 1)
  } },
    settings: { installSection(_owner, namespace, schema, entry) {
      assert.equal(namespace, 'google-drive')
      assert.deepEqual(schema.dict, {})
      assert.deepEqual(entry, {})
    } },
    effect(fn) { cleanups.push(fn()) }, provide(name, value) { assert.equal(name, 'googleDrive'); service = value } })
  assert.equal(routes.length, 6)
  assert.equal(cleanups.length, 7)
  assert.ok(routes.every(route => route.kind === 'exact'))
  assert.equal(typeof service.getAccessToken, 'function')
  for (const cleanup of cleanups.reverse()) cleanup()
  assert.equal(routes.length, 0)
  assert.equal(service.closed, true)
})
