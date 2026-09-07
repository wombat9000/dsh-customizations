import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import * as plugin from '../src/index.js'
import * as drive from '../../dsh-google-drive/src/index.js'
import { allowedRequest, settingsHandler } from '../src/routes.js'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = name => import(pathToFileURL(cli.resolve(name)).href)
const { Context } = await installed('@deepseek-ai/cordis')
const { default: WebServer } = await installed('@deepseek-ai/dsh-host-webserver')
const scope = 'https://www.googleapis.com/auth/drive.readonly'
const actions = ['status', 'connect', 'cancel', 'disconnect', 'configure', 'clear-config', 'callback-mode']
const clientJson = JSON.stringify({ installed: { client_id: 'fixture.apps.googleusercontent.com', client_secret: 'FIXTURE-ONLY' } })

function requester(base) {
  return (action, body = {}, headers = {}, method = 'POST') => fetch(`${base}/api/plugins/google-auth/${action}`, {
    method, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    headers: { Origin: base, 'Content-Type': 'application/json', 'X-DSH-Google-Auth': '1', ...headers },
  })
}

test('local request guard requires exact loopback host, origin, JSON and CSRF headers', () => {
  const valid = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:1234', origin: 'http://127.0.0.1:1234', 'content-type': 'application/json', 'x-dsh-google-auth': '1' } }
  assert.equal(allowedRequest(valid, 1234), true)
  for (const remoteAddress of ['::1', '::ffff:127.0.0.1']) assert.equal(allowedRequest({ ...valid, socket: { remoteAddress } }, 1234), true)
  for (const host of ['localhost:1234', '[::1]:1234']) assert.equal(allowedRequest({ ...valid, headers: { ...valid.headers, host, origin: `http://${host}` } }, 1234), true)
  for (const headers of [
    { origin: undefined }, { origin: 'null' }, { origin: 'https://127.0.0.1:1234' }, { origin: 'http://localhost:1234' },
    { host: 'attacker.invalid:1234', origin: 'http://attacker.invalid:1234' }, { host: '127.0.0.1:9999', origin: 'http://127.0.0.1:9999' },
    { 'x-dsh-google-auth': undefined }, { 'x-dsh-google-auth': '0' }, { 'content-type': 'text/plain' }, { 'content-type': 'application/json; charset=utf-8' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
  ]) assert.equal(allowedRequest({ ...valid, headers: { ...valid.headers, ...headers } }, 1234), false, JSON.stringify(headers))
  assert.equal(allowedRequest({ ...valid, socket: { remoteAddress: '192.0.2.1' } }, 1234), false)
})

test('HTTP bodies are strict, account consent accepts only an empty object and projections never expose tokens', async t => {
  const calls = []
  let failConnect = false
  const service = {
    async status() { return { configured: true, connected: true, pending: true, requiredScopes: [scope], missingScopes: [], expiresAt: 42,
      account: { id: 'account-1', email: 'fixture@example.invalid', accessToken: 'PRIVATE' }, accessToken: 'PRIVATE', refreshToken: 'PRIVATE', clientSecret: 'PRIVATE', grantedScopes: [scope],
      integrations: [{ id: 'drive', label: 'Drive', scopes: [scope], authorized: true, missingScopes: [], tokens: 'PRIVATE' }] } },
    async begin(...args) { calls.push(['begin', ...args]); if (failConnect) throw Error('PRIVATE invalid_grant'); return { authorizationUrl: 'https://accounts.google.com/fixture', expiresAt: 42, accessToken: 'PRIVATE' } },
    async configure(...args) { calls.push(['configure', ...args]); return { clientSecret: 'PRIVATE' } },
    async cancel() { throw Error('PRIVATE commit in progress') },
    async disconnect() { calls.push(['disconnect']); return { refreshToken: 'PRIVATE' } },
    async clearConfig() { calls.push(['clear']); return {} },
    async setCallbackMode(value) { calls.push(['mode', value]); if (!value) throw Error('PRIVATE https://callback.invalid/token'); return { secret: 'PRIVATE' } },
  }
  const server = createServer((req, res) => settingsHandler(service, req.url.split('/').at(-1), server.address().port)(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const base = `http://127.0.0.1:${server.address().port}`, post = requester(base)
  for (const body of [{ integrationId: 'drive' }, null, [], { integrationId: 'drive', scopes: [scope] }, { scopes: [scope] }, { integrationId: 'drive', scope }, { integrationId: 'drive', clientId: 'x' }, { integrationId: 'drive', __extra: true }, { integrationId: '../drive' }, { integrationId: 1 }, '{', 'x'.repeat(1025)]) {
    assert.equal((await post('connect', body)).status, 400, JSON.stringify(body))
  }
  assert.equal(calls.length, 0)
  const connect = await post('connect', {})
  assert.deepEqual(await connect.json(), { ok: true, value: { authorizationUrl: 'https://accounts.google.com/fixture', expiresAt: 42 } })
  assert.deepEqual(calls, [['begin']])
  for (const action of ['status', 'cancel', 'disconnect', 'clear-config']) assert.equal((await post(action, { scopes: [scope] })).status, 400)
  for (const body of [{}, { clientJson: 1 }, { clientJson, scopes: [scope] }, { clientJson: 'x'.repeat(32769) }]) assert.equal((await post('configure', body)).status, 400)
  assert.deepEqual(await (await post('configure', { clientJson })).json(), { ok: true, value: {} })
  assert.deepEqual(calls.at(-1), ['configure', clientJson])
  const status = await post('status')
  assert.equal(status.headers.get('cache-control'), 'no-store')
  assert.equal(status.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(status.headers.get('referrer-policy'), 'no-referrer')
  assert.deepEqual(await status.json(), { ok: true, value: { configured: true, connected: true, pending: true, useSandbox: false, sandboxAvailable: false, expiresAt: 42,
    requiredScopes: [scope], missingScopes: [], account: { id: 'account-1', email: 'fixture@example.invalid' },
    integrations: [{ id: 'drive', label: 'Drive', scopes: [scope], authorized: true, missingScopes: [] }] } })
  failConnect = true
  for (const [action, body] of [['connect', {}], ['cancel', {}]]) {
    const response = await post(action, body)
    assert.equal(response.status, 400)
    assert.equal((await response.text()).includes('PRIVATE'), false)
  }
  const beforeMode = calls.length
  for (const body of [{}, null, [], { useSandbox: 'true' }, { useSandbox: 1 }, { useSandbox: null }, { useSandbox: true, scope }, { useSandbox: true, scopes: [scope] }, { useSandbox: true, callbackUrl: 'https://attacker.invalid' }, { useSandbox: true, redirectUri: 'http://localhost:42' }, { useSandbox: true, integrationId: 'drive' }]) {
    assert.equal((await post('callback-mode', body)).status, 400, JSON.stringify(body))
  }
  assert.equal(calls.length, beforeMode)
  assert.deepEqual(await (await post('callback-mode', { useSandbox: true })).json(), { ok: true, value: {} })
  assert.deepEqual(calls.at(-1), ['mode', true])
  const modeError = await post('callback-mode', { useSandbox: false })
  assert.equal(modeError.status, 400)
  assert.deepEqual(await modeError.json(), { ok: false, error: { message: 'Could not change callback mode. Sign-in may be finishing or settings may be read-only; retry after completion.' } })
  assert.deepEqual(await (await post('disconnect')).json(), { ok: true, value: {} })
  assert.equal((await post('status', {}, {}, 'GET')).status, 405)
  const count = calls.length
  for (const headers of [{ Origin: 'https://attacker.invalid' }, { 'X-DSH-Google-Auth': '' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Content-Type': 'text/plain' }]) assert.equal((await post('disconnect', {}, headers)).status, 403)
  assert.equal(calls.length, count)
})

test('real Cordis SettingsFile/WebServer lifecycle serves Google namespace; Drive consumes shared auth only', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'google-auth-host-test-'))
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  for (const name of ['@deepseek-ai/cordis-plugin-loader', '@deepseek-ai/dsh-session-projection']) {
    const module = await installed(name)
    await ctx.plugin(module.default, {}).await()
  }
  const { default: Settings } = await installed('@deepseek-ai/dsh-settings-file')
  const settingsFiber = ctx.plugin(Settings, { path: join(directory, 'settings.yaml'), watch: false })
  await settingsFiber.await()
  const records = new Map(), reads = []
  await ctx.plugin({ name: 'test-google-credentials', apply(ctx) {
    ctx.provide('agents', { get() {}, roots() { return [] } })
    ctx.provide('approval', { overrideOf() { return 'ask' } })
    ctx.provide('credentials', {
      async readRecord(key) { reads.push(key); return records.get(key) },
      async modifyRecord(key, fn) { const next = await fn(records.get(key)); if (next) records.set(key, next); return records.get(key) },
      async deleteRecord(key) { records.delete(key) },
    })
  } }).await()
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }).await()
  const base = `http://127.0.0.1:${ctx.get('webServer').port}`, post = requester(base)
  const first = ctx.plugin(plugin)
  await first.await()
  assert.ok(ctx.get('settings').describe().some(item => item.ns === 'google-auth'))
  assert.equal(reads.length, 0, 'Auth mount must not read credentials')
  const driveFiber = ctx.plugin(drive)
  await driveFiber.await()
  assert.equal(reads.length, 0, 'Drive registration must not read credentials')
  assert.equal(ctx.get('settings').describe().some(item => item.ns === 'google-drive'), false)
  assert.equal(typeof ctx.get('googleDrive').request, 'function')
  assert.equal(typeof ctx.get('googleDrive').readText, 'function')
  const auth = ctx.get('googleAuth')
  assert.equal(auth.integration('google-drive').scopes[0], scope)
  // Exercise the actual injected Drive service without network or Google login.
  const ids = []
  auth.getAccessToken = async (...args) => { ids.push(args); throw Error('fixture authentication unavailable') }
  await assert.rejects(ctx.get('googleDrive').listFiles())
  assert.deepEqual(ids, [], 'unscoped calls fail before authentication')
  const initial = await (await post('status')).json()
  assert.equal(initial.value.configured, false)
  assert.equal(initial.value.useSandbox, false)
  assert.equal(initial.value.sandboxAvailable, false)
  assert.deepEqual(await (await post('callback-mode', { useSandbox: true })).json(), { ok: true, value: {} })
  assert.equal((await (await post('status')).json()).value.useSandbox, true)
  assert.deepEqual(initial.value.integrations[0].missingScopes, [scope])
  assert.deepEqual(await (await post('configure', { clientJson })).json(), { ok: true, value: {} })
  const configured = await (await post('status')).json()
  assert.equal(configured.value.configured, true)
  assert.equal(configured.value.connected, false)
  assert.equal(JSON.stringify(configured).includes('FIXTURE-ONLY'), false)
  assert.equal(records.get(plugin.CLIENT_KEY).payload.clientSecret, 'FIXTURE-ONLY')
  const persisted = await readFile(join(directory, 'settings.yaml'), 'utf8')
  assert.match(persisted, /useSandbox: true/)
  assert.equal(persisted.includes('FIXTURE-ONLY'), false)
  assert.equal(persisted.includes('clientSecret'), false)
  assert.equal((await post('clear-config', {}, { Origin: 'https://attacker.invalid' })).status, 403)
  assert.equal(records.size, 1)
  for (const action of ['getAccessToken', 'token', 'refresh']) assert.equal((await post(action)).status, 404)
  assert.equal((await fetch(`${base}/api/plugins/google-drive/status`)).status, 403)
  assert.equal((await fetch(`${base}/api/plugins/google-drive/token`)).status, 404)
  await driveFiber.dispose()
  assert.equal(auth.integrations.size, 0)
  await first.dispose()
  assert.equal(ctx.get('googleAuth'), undefined)
  for (const action of actions) assert.equal((await post(action)).status, 404, action)
  await settingsFiber.dispose()
  await ctx.plugin(Settings, { path: join(directory, 'settings.yaml'), watch: false }).await()
  const second = ctx.plugin(plugin)
  await second.await()
  assert.equal((await (await post('status')).json()).value.configured, true)
  assert.equal((await (await post('status')).json()).value.useSandbox, true, 'mode survives a fresh SettingsFile service')
  await ctx.get('settings').update('google-auth', { useSandbox: false })
  assert.equal(ctx.get('googleAuth').useSandbox, false, 'external settings update invokes the source hook')
  const secondDrive = ctx.plugin(drive)
  await secondDrive.await()
  assert.equal(ctx.get('googleAuth').integration('google-drive').id, 'google-drive')
  assert.equal((await post('disconnect')).status, 200)
  assert.equal(records.has(plugin.CLIENT_KEY), true)
  assert.equal((await post('clear-config')).status, 200)
  assert.equal(records.size, 0)
  await secondDrive.dispose(); await second.dispose()
})
