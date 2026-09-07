import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import * as plugin from '../src/index.js'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = name => import(pathToFileURL(cli.resolve(name)).href)
const { Context } = await installed('@deepseek-ai/cordis')
const { default: WebServer } = await installed('@deepseek-ai/dsh-host-webserver')

test('real host HTTP config is write-only and plugin stop/re-enable removes and replaces every route', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'drive-host-test-'))
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  for (const name of ['@deepseek-ai/cordis-plugin-loader', '@deepseek-ai/dsh-session-projection']) {
    const module = await installed(name)
    await ctx.plugin(module.default, {}).await()
  }
  const { default: Settings } = await installed('@deepseek-ai/dsh-settings-file')
  await ctx.plugin(Settings, { path: join(directory, 'settings.yaml'), watch: false }).await()
  const records = new Map()
  await ctx.plugin({ name: 'test-drive-credentials', apply(ctx) {
    ctx.provide('credentials', {
      async readRecord(key) { return records.get(key) },
      async modifyRecord(key, fn) { const next = await fn(records.get(key)); if (next) records.set(key, next); return records.get(key) },
      async deleteRecord(key) { records.delete(key) },
    })
  } }).await()
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }).await()
  const base = `http://127.0.0.1:${ctx.get('webServer').port}`
  const post = (action, body = {}, headers = {}) => fetch(`${base}/api/plugins/google-drive/${action}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { Origin: base, 'Content-Type': 'application/json', 'X-DSH-Google-Drive': '1', ...headers },
  })
  const first = ctx.plugin(plugin)
  await first.await()
  assert.ok(ctx.get('settings').describe().some(item => item.ns === 'google-drive'), 'Settings card namespace must be served')
  assert.equal((await (await post('status')).json()).value.configured, false)
  const json = JSON.stringify({ installed: { client_id: 'fixture.apps.googleusercontent.com', client_secret: 'FIXTURE-ONLY' } })
  const save = await post('configure', { clientJson: json })
  assert.equal(save.status, 200)
  assert.deepEqual(await save.json(), { ok: true, value: {} })
  const status = await post('status')
  assert.equal(status.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await status.json(), { ok: true, value: { configured: true, connected: false, pending: false } })
  assert.equal(records.get(plugin.CLIENT_KEY).payload.clientSecret, 'FIXTURE-ONLY')
  const denied = await post('clear-config', {}, { Origin: 'https://attacker.invalid' })
  assert.equal(denied.status, 403)
  assert.equal(records.size, 1)
  assert.equal((await post('getAccessToken')).status, 404)
  await first.dispose()
  assert.equal(ctx.get('googleDrive'), undefined)
  for (const action of ['status', 'configure', 'clear-config', 'connect', 'cancel', 'disconnect']) {
    assert.equal((await post(action)).status, 404, action)
  }
  const second = ctx.plugin(plugin)
  await second.await()
  assert.equal((await (await post('status')).json()).value.configured, true)
  assert.equal((await post('clear-config')).status, 200)
  assert.equal(records.size, 0)
  await second.dispose()
})
