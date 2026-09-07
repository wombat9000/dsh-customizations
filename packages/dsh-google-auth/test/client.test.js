import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
function load(fetch) {
  let record, registration
  vm.runInNewContext(source, { URL, Error, window: { fetch, __ModuleLoader__: { load(value) { record = value } } } })
  const plugin = record.factory((name) => { assert.equal(name, 'react'); return { createElement() {} } })
  plugin.apply({ slots: {
    inject(name, fn) { assert.equal(name, 'settings.plugin.item'); fn() },
    register(options, component) { registration = { options, component } },
  } })
  return { record, plugin, registration, api: registration.options.inject().api }
}
test('ModuleLoader registers the shared slots-only settings card', () => {
  const { record, plugin, registration } = load()
  assert.equal(record.id, '@local/dsh-google-auth')
  assert.deepEqual(Array.from(plugin.inject), ['slots'])
  assert.equal(registration.options.key, 'google-auth')
  assert.equal(registration.component, plugin.GoogleAuthSettingsSection)
})
test('all requests use the shared same-origin POST contract', async () => {
  const calls = []
  const { api } = load(async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ ok: true, value: {} }) } })
  for (const method of ['status', 'configure', 'clear-config', 'connect', 'cancel', 'disconnect']) {
    const body = method === 'configure' ? { clientJson: 'fixture' } : {}
    await api(method, body)
    const { url, options } = calls.at(-1)
    assert.equal(url, `/api/plugins/google-auth/${method}`)
    assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'same-origin')
    assert.equal(options.headers['X-DSH-Google-Auth'], '1')
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(options.body), body)
  }
})
test('callback mode saves exact boolean bodies through the same-origin transport', async () => {
  const calls = []
  const { api } = load(async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ ok: true, value: {} }) } })
  for (const useSandbox of [true, false]) {
    await api('callback-mode', { useSandbox })
    const { url, options } = calls.at(-1)
    assert.equal(url, '/api/plugins/google-auth/callback-mode')
    assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'same-origin')
    assert.equal(options.headers['X-DSH-Google-Auth'], '1')
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(options.body), { useSandbox })
  }
})
test('authorization links reject untrusted origins, credentials, paths, fragments and protocols', () => {
  const { plugin } = load()
  assert.equal(plugin.authorizationUrl('https://accounts.google.com/o/oauth2/v2/auth?state=fixture'), 'https://accounts.google.com/o/oauth2/v2/auth?state=fixture')
  for (const value of [undefined, {}, 'javascript:alert(1)', 'http://accounts.google.com/o/oauth2/v2/auth', 'https://accounts.google.com.evil.test/o/oauth2/v2/auth', 'https://user@accounts.google.com/o/oauth2/v2/auth', 'https://accounts.google.com:444/o/oauth2/v2/auth', 'https://accounts.google.com/other', 'https://accounts.google.com/o/oauth2/v2/auth#fragment']) assert.throws(() => plugin.authorizationUrl(value), /invalid authorization link/)
})
test('transport errors hide raw exception contents', async () => {
  const { api } = load(async () => { throw new Error('SECRET') })
  await assert.rejects(api('status'), (error) => /Cannot reach DSH/.test(error.message) && !error.message.includes('SECRET'))
})
test('unreadable and rejected replies produce actionable errors', async () => {
  await assert.rejects(load(async () => ({ json: async () => { throw new Error('SECRET') } })).api('status'), /unreadable response/)
  await assert.rejects(load(async () => ({ ok: false, json: async () => ({ ok: false, error: { message: 'Use the local loopback GUI.' } }) })).api('connect'), /local loopback GUI/)
})
