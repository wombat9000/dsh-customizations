import assert from 'node:assert/strict'
import test from 'node:test'
import { GoogleAuthService, CLIENT_KEY, CREDENTIAL_KEY, Config } from '../src/index.js'

const scope = 'https://www.googleapis.com/auth/drive.metadata.readonly'
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function fixture({ mode = false, publisher, save } = {}) {
  const records = new Map([
    [CLIENT_KEY, { kind: 'grant', payload: { version: 1, clientId: 'fixture.apps.googleusercontent.com' } }],
    [CREDENTIAL_KEY, { kind: 'grant', payload: { version: 1, clientId: 'fixture.apps.googleusercontent.com', tokens: { accessToken: 'FIXTURE', refreshToken: 'FIXTURE-REFRESH', expiresAt: Date.now() + 3600000, scopes: [scope], account: { id: 'fixture-account' } } } }],
  ])
  const saved = []
  const service = new GoogleAuthService({
    credentials: {
      async readRecord(key) { return records.get(key) },
      async modifyRecord(key, fn) { const value = await fn(records.get(key)); records.set(key, value); return value },
      async deleteRecord(key) { records.delete(key) },
    },
    getCallbackMode: () => mode,
    async saveCallbackMode(value) { if (save) await save(value); saved.push(value); mode = value },
    getPublisher: () => publisher,
  })
  service.registerIntegration({ id: 'drive', label: 'Drive', scopes: [scope] })
  return { service, records, saved, external(value) { mode = value; service.syncCallbackMode() } }
}

test('cancel during configuration load invalidates begin before a listener can start', async t => {
  const entered = deferred(), release = deferred()
  let starts = 0, pending = false
  const service = new GoogleAuthService({
    credentials: { async readRecord() {
      entered.resolve(); await release.promise
      return { kind: 'grant', payload: { version: 1, clientId: 'fixture.apps.googleusercontent.com' } }
    } },
    createClient: () => ({
      async begin() { starts++; pending = true; return {} },
      cancel() { pending = false; return true },
      async cleanup() {}, async dispose() { pending = false },
    }),
  })
  t.after(async () => { release.resolve(); await service.dispose() })
  service.registerIntegration({ id: 'drive', label: 'Drive', scopes: [scope] })
  const starting = assert.rejects(service.begin('drive'), /changed|cancel/i)
  await entered.promise
  const cancelling = service.cancel()
  release.resolve()
  await starting
  await cancelling
  assert.equal(starts, 0)
  assert.equal(pending, false)
})

test('configuration defaults to direct callbacks with a boolean non-secret preference', () => {
  assert.deepEqual(Config({}), { useSandbox: false })
  assert.throws(() => Config({ useSandbox: 'true' }))
  const schema = Config.toJSON()
  const preference = Object.values(schema.refs).find(item => item.type === 'boolean')
  assert.equal(preference.meta.default, false)
  assert.notEqual(preference.meta.secret, true)
})

test('direct mode never consults publication and disabling prevents future forwarded links', async t => {
  let publishes = 0
  const f = fixture({ publisher: { available: () => true, publish() { publishes++; throw Error('must not publish') } } })
  t.after(() => f.service.dispose())
  assert.equal((await f.service.status()).useSandbox, false)
  assert.equal((await f.service.status()).sandboxAvailable, true)
  const first = await f.service.begin('drive')
  assert.equal(new URL(new URL(first.authorizationUrl).searchParams.get('redirect_uri')).hostname, '127.0.0.1')
  await f.service.cancel()
  await f.service.setCallbackMode(true)
  await f.service.setCallbackMode(false)
  await f.service.begin('drive')
  assert.equal(publishes, 0)
  assert.deepEqual(f.saved, [true, false])
})

for (const publisher of [undefined, { available: () => false, publish() { assert.fail('unavailable publisher invoked') } }]) {
  test(`enabled forwarding blocks without ${publisher ? 'available bridge' : 'publisher service'}`, async t => {
    const f = fixture({ mode: true, publisher })
    t.after(() => f.service.dispose())
    await assert.rejects(f.service.begin('drive'), /unavailable/)
    assert.equal(f.service.client, undefined, 'must not start a direct callback listener')
    assert.equal((await f.service.status()).sandboxAvailable, false)
  })
}

for (const phase of ['startup', 'waiting']) for (const external of [false, true]) {
  test(`${external ? 'external settings' : 'mode write'} cancels publication during ${phase} and retains account`, async t => {
    const entered = deferred(), release = deferred()
    let signal, port, disposed = 0
    const f = fixture({ mode: true, publisher: {
      available: () => true,
      async publish(args) {
        ;({ signal, port } = args)
        entered.resolve()
        if (phase === 'startup') await release.promise
        return { origin: 'http://127.0.0.1:45678', dispose: async () => { disposed++ } }
      },
    } })
    t.after(async () => { release.resolve(); await f.service.dispose() })
    const grant = f.records.get(CREDENTIAL_KEY)
    const pending = f.service.begin('drive')
    const outcome = phase === 'startup' ? assert.rejects(pending, /cancel|changed|could not start/i) : pending
    await entered.promise
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535)
    assert.ok(signal instanceof AbortSignal)
    if (phase === 'waiting') {
      await outcome
      assert.equal((await f.service.status()).pending, true)
    }
    const changing = external ? f.external(false) : f.service.setCallbackMode(false)
    assert.equal(signal.aborted, true, 'interrupt before waiting for serialized begin')
    release.resolve()
    await outcome
    await changing
    await f.service.client.cleanup()
    assert.equal(disposed, 1)
    assert.equal(f.records.get(CREDENTIAL_KEY), grant)
    const status = await f.service.status()
    assert.equal(status.connected, true)
    assert.equal(status.pending, false)
    assert.equal(status.useSandbox, false)
    assert.deepEqual(status.account, { id: 'fixture-account' })
  })
}

test('failed mode persistence preserves enabled mode without a direct fallback', async t => {
  const f = fixture({ mode: true, save: async () => { throw Error('PRIVATE storage details') } })
  t.after(() => f.service.dispose())
  await assert.rejects(f.service.setCallbackMode(false), { message: 'Could not save Google callback settings.' })
  assert.equal((await f.service.status()).useSandbox, true)
  await assert.rejects(f.service.begin('drive'), /unavailable/)
  assert.deepEqual(f.saved, [])
})

test('commit refusal preserves mode and does not persist a change', async t => {
  const f = fixture({ mode: true })
  t.after(() => f.service.dispose())
  await f.service.load()
  f.service.client.cancel = () => false
  await assert.rejects(f.service.setCallbackMode(false), /finishing/)
  assert.equal(f.service.useSandbox, true)
  assert.deepEqual(f.saved, [])
})
