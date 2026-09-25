import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createOpenRouterRuntime,
  mountOpenRouter,
  RECORD_KEY,
  DEFAULT_REFERENCE,
  CHANNEL,
} from '../src/runtime.js'

function fixture() {
  const state = { profile: {}, record: undefined, refs: new Map(), writable: true, writes: [] }
  const credentials = {
    async readRecord(key) {
      assert.equal(key, RECORD_KEY)
      return state.record
    },
    async describeRecord(key) {
      assert.equal(key, RECORD_KEY)
      return { configured: !!state.record, writable: state.writable }
    },
    async describe(ref) {
      return { configured: !!state.refs.get(ref)?.value, writable: true, ...state.refs.get(ref) }
    },
    async resolve(ref) {
      return state.refs.get(ref)
    },
    async set(ref, value) {
      state.writes.push(['set', ref])
      state.refs.set(ref, { value })
    },
    async unset(ref) {
      state.writes.push(['unset', ref])
      state.refs.delete(ref)
    },
    async modifyRecord(key, mutate) {
      assert.equal(key, RECORD_KEY)
      await state.beforeCommit?.()
      state.record = await mutate(state.record)
      state.writes.push(['modify', key])
    },
  }
  const settings = {
    get(name) {
      assert.equal(name, 'llm-pi-ai')
      return { providers: { openrouter: state.profile } }
    },
  }
  const runtime = createOpenRouterRuntime({ credentials, settings })
  return { state, credentials, settings, runtime }
}
async function save(f, apiKey = 'test-secret') {
  return f.runtime.rpc('save', { apiKey, target: (await f.runtime.service.status()).target })
}
test('absent sources save to canonical record; clear preserves environment metadata', async () => {
  const f = fixture()
  assert.deepEqual(await f.runtime.service.status(), {
    configured: false,
    writable: true,
    source: 'none',
    target: `record:${RECORD_KEY}`,
  })
  assert.equal(await f.runtime.service.resolveApiKey(), undefined)
  assert.equal((await save(f)).ok, true)
  assert.equal(f.state.record.key, 'test-secret')
  f.state.record.env = { PROVIDER_REGION: 'test' }
  const result = await f.runtime.rpc('clear', { target: (await f.runtime.service.status()).target })
  assert.equal(result.ok, true)
  assert.deepEqual(f.state.record, { kind: 'api-key', env: { PROVIDER_REGION: 'test' } })
  assert.equal(await f.runtime.service.resolveApiKey(), undefined)
})
test('explicit reference fails closed when unset and never copies the record or fallback', async () => {
  const f = fixture()
  f.state.profile.apiKeyEnv = 'CUSTOM_OPENROUTER_KEY'
  f.state.record = { kind: 'api-key', key: 'record-secret' }
  f.state.refs.set(DEFAULT_REFERENCE, { value: 'fallback-secret' })
  assert.equal(await f.runtime.service.resolveApiKey(), undefined)
  const status = await f.runtime.service.status()
  assert.equal(status.reference, 'CUSTOM_OPENROUTER_KEY')
  assert.equal(status.configured, false)
  assert.equal((await save(f)).ok, true)
  assert.equal(f.state.record.key, 'record-secret')
  assert.deepEqual(f.state.writes, [['set', 'CUSTOM_OPENROUTER_KEY']])
})
test('record wins; an empty API-key record falls back only to the known reference', async () => {
  const f = fixture()
  f.state.refs.set(DEFAULT_REFERENCE, { value: 'fallback-secret', source: 'env', writable: false })
  f.state.record = { kind: 'api-key', key: 'record-secret' }
  assert.equal(await f.runtime.service.resolveApiKey(), 'record-secret')
  f.state.record = { kind: 'api-key' }
  assert.equal(await f.runtime.service.resolveApiKey(), 'fallback-secret')
  assert.equal((await f.runtime.service.status()).source, 'env')
  assert.equal((await save(f)).ok, false)
  assert.equal(
    (await f.runtime.rpc('clear', { target: (await f.runtime.service.status()).target })).ok,
    false,
  )
  assert.deepEqual(f.state.writes, [])
})
test('per-call reads follow key and settings changes without caching', async () => {
  const f = fixture()
  f.state.record = { kind: 'api-key', key: 'first' }
  assert.equal(await f.runtime.service.resolveApiKey(), 'first')
  f.state.record = { kind: 'api-key', key: 'second' }
  assert.equal(await f.runtime.service.resolveApiKey(), 'second')
  f.state.profile.apiKeyEnv = 'NEW_REF'
  f.state.refs.set('NEW_REF', { value: 'third' })
  assert.equal(await f.runtime.service.resolveApiKey(), 'third')
})
test('unsupported record kinds and custom endpoint fail closed without writes', async () => {
  for (const record of [{ kind: 'grant', payload: 'secret' }, { kind: 'future' }]) {
    const f = fixture()
    f.state.record = record
    f.state.refs.set(DEFAULT_REFERENCE, { value: 'fallback-secret' })
    assert.equal((await f.runtime.service.status()).writable, false)
    await assert.rejects(f.runtime.service.resolveApiKey(), /unsupported/)
    assert.equal((await save(f)).ok, false)
  }
  for (const baseURL of [
    'https://custom.invalid/api/v1',
    'https://openrouter.ai/api/v1?x=1',
    '',
    null,
  ]) {
    const f = fixture()
    f.state.profile.baseURL = baseURL
    assert.match((await f.runtime.service.status()).error, /unsupported/)
    assert.equal((await save(f)).ok, false)
    await assert.rejects(f.runtime.service.resolveApiKey(), /unsupported/)
    assert.deepEqual(f.state.writes, [])
  }
  const f = fixture()
  f.state.profile.baseURL = 'https://openrouter.ai/api/v1/'
  assert.equal((await save(f)).ok, true)
})
test('stale targets and queued writes cannot redirect or overwrite unsupported records', async () => {
  const f = fixture()
  const target = (await f.runtime.service.status()).target
  f.state.profile.apiKeyEnv = 'NEW_REF'
  assert.equal((await f.runtime.rpc('save', { apiKey: 'secret', target })).ok, false)
  f.state.profile = {}
  f.state.beforeCommit = () => {
    f.state.record = { kind: 'grant', payload: 'grant-secret' }
  }
  assert.equal((await save(f)).ok, false)
  assert.deepEqual(f.state.writes, [])
})
test('record writability and malformed requests fail without writes or secret echo', async () => {
  const f = fixture()
  f.state.writable = false
  assert.equal((await save(f)).ok, false)
  f.state.writable = true
  for (const apiKey of ['', 'with space', '\nsecret', 123, 's'.repeat(8193)]) {
    const result = await save(f, apiKey)
    assert.equal(result.ok, false)
    assert.match(result.error.message, /Invalid/)
  }
  assert.equal((await f.runtime.rpc('resolveApiKey')).ok, false)
  assert.equal((await f.runtime.rpc('clear', { target: 'arbitrary', extra: true })).ok, false)
  assert.deepEqual(f.state.writes, [])
})
test('provider exceptions and unexpected metadata never cross RPC', async () => {
  const f = fixture()
  f.state.profile.apiKeyEnv = DEFAULT_REFERENCE
  f.state.refs.set(DEFAULT_REFERENCE, {
    value: 'secret-value',
    source: 'secret-value',
    writable: true,
    suffix: 'secret-value',
  })
  const status = await f.runtime.rpc('status')
  assert.equal(JSON.stringify(status).includes('secret-value'), false)
  f.credentials.resolve = async () => {
    throw new Error('secret-value')
  }
  await assert.rejects(
    f.runtime.service.resolveApiKey(),
    (error) => !error.message.includes('secret-value'),
  )
  f.credentials.set = async () => {
    throw new Error('secret-value')
  }
  assert.equal(JSON.stringify(await save(f)).includes('secret-value'), false)
  f.credentials.describe = async () => {
    throw new Error('secret-value')
  }
  assert.equal(JSON.stringify(await f.runtime.rpc('status')).includes('secret-value'), false)
})
test('mocked host mount uses trusted RPC, empty settings section, host service, and disposal', async () => {
  const f = fixture()
  const disposers = []
  const schema = { empty: true }
  let registration
  let provided
  const ctx = {
    credentials: f.credentials,
    settings: {
      ...f.settings,
      installSection(owner, namespace, received, defaults) {
        assert.equal(owner, ctx)
        assert.equal(namespace, 'openrouter')
        assert.equal(received, schema)
        assert.deepEqual(defaults, {})
      },
    },
    provide(name, service) {
      assert.equal(name, 'openrouter')
      provided = service
    },
    effect(effect) {
      disposers.push(effect())
    },
    connection: {
      rpc: {
        handle(channel, handler, options) {
          registration = { channel, handler, options, disposed: false }
          return () => {
            registration.disposed = true
          }
        },
      },
    },
  }
  mountOpenRouter(ctx, schema)
  assert.equal(registration.channel, CHANNEL)
  assert.deepEqual(registration.options, { authority: 'trusted-host' })
  assert.deepEqual(Object.keys(provided).sort(), ['resolveApiKey', 'status'])
  assert.equal((await registration.handler('status')).ok, true)
  for (const dispose of disposers.reverse()) dispose()
  assert.equal(registration.disposed, true)
  assert.equal((await registration.handler('status')).ok, false)
  await assert.rejects(provided.resolveApiKey(), /stopped/)
  assert.equal((await provided.status()).writable, false)
})
test('route changes during asynchronous reads reject stale operations', async () => {
  const f = fixture()
  f.state.profile.apiKeyEnv = 'ORIGINAL_REF'
  const describe = f.credentials.describe
  f.credentials.describe = async (ref) => {
    const info = await describe(ref)
    f.state.profile.apiKeyEnv = 'CHANGED_REF'
    return info
  }
  assert.match((await f.runtime.service.status()).error, /changed/)
  f.state.profile.apiKeyEnv = 'ORIGINAL_REF'
  const result = await f.runtime.rpc('save', {
    apiKey: 'secret',
    target: 'reference:explicit:ORIGINAL_REF',
  })
  assert.equal(result.ok, false)
  assert.deepEqual(f.state.writes, [])
})
test('disposal rejects queued mutations before commit', async () => {
  const f = fixture()
  f.state.beforeCommit = () => f.runtime.dispose()
  assert.equal((await save(f)).ok, false)
  assert.deepEqual(f.state.writes, [])
})
