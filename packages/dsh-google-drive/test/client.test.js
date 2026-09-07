import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
function load(fetch) {
  let record
  vm.runInNewContext(source, { window: { fetch, __ModuleLoader__: { load(value) { record = value } } } })
  return { record, plugin: record.factory(() => ({ createElement() {} })) }
}
test('registers verified keyed tool and additive root overlay seats with one owned store', () => {
  const { record, plugin } = load()
  const rows = [], effects = []
  plugin.apply({ effect: fn => effects.push(fn()), slots: { inject: (name, fn) => fn(), register: (options, component) => rows.push({ options, component }) } })
  assert.equal(record.id, '@local/dsh-google-drive')
  assert.deepEqual(Array.from(plugin.inject), ['slots'])
  assert.equal(rows[0].options.name, 'tool.call.toolview')
  assert.equal(rows[0].options.key, 'request_drive_access')
  assert.equal(rows[1].options.name, 'shell.overlay')
  assert.equal(rows[1].options.id, 'google-drive-access')
  const picker = rows[0].options.inject().picker
  assert.equal(picker, rows[1].options.inject().picker)
  picker.open({ owner: {} }); effects[0](); assert.equal(picker.getSnapshot(), null)
})
test('all browser routes use same-origin JSON POST and abort signal', async () => {
  const calls = []
  const { plugin } = load(async (...args) => { calls.push(args); return { ok: true, json: async () => ({ ok: true, value: {} }) } })
  const signal = {}, body = { sessionId: 's', callId: 'c', requestId: 'opaque' }
  for (const method of ['status', 'browse', 'manage', 'grant', 'deny', 'revoke']) {
    await plugin.api(method, body, signal)
    const [url, options] = calls.at(-1)
    assert.equal(url, `/api/plugins/google-drive/${method}`)
    assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'same-origin'); assert.equal(options.signal, signal)
    assert.equal(options.headers['X-DSH-Google-Drive'], '1'); assert.equal(options.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(options.body), body)
  }
})
test('transport never exposes raw server or network details', async () => {
  for (const fetch of [async () => { throw new Error('SECRET') }, async () => ({ ok: false, json: async () => ({ ok: false, error: { message: 'SECRET' } }) }), async () => ({ json: async () => { throw new Error('SECRET') } })]) {
    await assert.rejects(load(fetch).plugin.api('status', {}), error => !error.message.includes('SECRET'))
  }
  const abort = Object.assign(new Error(), { name: 'AbortError' })
  await assert.rejects(load(async () => { throw abort }).plugin.api('status', {}), error => error === abort)
})
test('pending status requires opaque identity and picker cleanup is owner scoped', () => {
  const { plugin } = load()
  assert.equal(plugin.validStatus({ state: 'pending', grants: [] }), false)
  assert.equal(plugin.validStatus({ state: 'pending', requestId: 'r', grants: [] }), true)
  const store = plugin.createPickerStore(), owner = {}, other = {}; let changes = 0
  const off = store.subscribe(() => changes++)
  store.open({ owner }); store.closeOwner(other); assert.equal(store.getSnapshot().owner, owner)
  store.closeOwner(owner); assert.equal(store.getSnapshot(), null); assert.equal(changes, 2)
  off(); store.close(); assert.equal(changes, 2)
})
