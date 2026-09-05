import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, CHANNEL, name } from '../src/index.js'

function host() {
  let handler, current, installed, preparations = 0
  const disposers = []
  const ctx = {
    sessions: { get() {} },
    llm: {
      listProviders: () => [{ id: 'configured', name: 'Configured', secret: 'NEVER' }],
      listModels: async () => [{ id: 'model', name: 'Model', secret: 'NEVER' }],
      prepareCall: async config => { preparations++; return { config, inputModalities: ['text'] } },
    },
    settings: {
      installSection(owner, ns, schema, entry, hooks) {
        installed = { owner, ns, schema, entry }
        current = entry
        hooks.setSource(() => current)
      },
      async update(ns, value) { assert.equal(ns, name); current = value },
    },
    connection: { rpc: { handle(channel, fn) { assert.equal(channel, CHANNEL); handler = fn; return () => {} } } },
    effect(fn) { disposers.push(fn()) },
  }
  apply(ctx)
  return { ctx, rpc: (...args) => handler(...args), installed, disposers, preparations: () => preparations }
}

test('registers schema-backed settings defaults and opaque storage scope', async () => {
  const { rpc, installed } = host()
  assert.equal(installed.ns, 'wombat9000-session-recap')
  assert.equal(installed.entry.autoRecap, true)
  assert.equal(installed.entry.inactivityMinutes, 30)
  const result = await rpc('settings')
  assert.equal(result.ok, true)
  assert.equal(result.value.provider, '')
  assert.match(result.value.storageScope, /^[a-f0-9]{24}$/)
})
test('provider catalog returns only public display metadata', async () => {
  const { rpc } = host()
  assert.deepEqual(await rpc('models'), { ok: true, value: { providers: [{ id: 'configured', name: 'Configured', models: [{ id: 'model', name: 'Model' }] }] } })
})
test('configure validates exact custom route without catalog allowlist', async () => {
  const { rpc, preparations } = host()
  const result = await rpc('configure', { provider: 'configured', model: 'custom-unlisted', autoRecap: false })
  assert.equal(result.ok, true)
  assert.equal(result.value.model, 'custom-unlisted')
  assert.equal(result.value.autoRecap, false)
  assert.equal(preparations(), 1)
  assert.equal((await rpc('configure', { provider: '', model: '' })).ok, true)
  assert.equal(preparations(), 1)
})
test('configure rejects unknown fields and invalid values without writing', async () => {
  const { rpc } = host()
  for (const payload of [null, [], { apiKey: 'SECRET' }, { inactivityMinutes: 0 }, { provider: 'alone' }, { autoRecap: 0 }]) assert.equal((await rpc('configure', payload)).ok, false)
  assert.equal((await rpc('settings')).value.provider, '')
})
test('unconfigured recap returns a complete DSH RPC failure envelope', async () => {
  const { rpc } = host()
  const result = await rpc('recap', { sessionId: 'fixture-session' })
  assert.equal(result.ok, false)
  assert.equal(typeof result.error.code, 'string')
  assert.equal(result.error.message, 'Choose a provider and model in Settings → Plugins → Session Recap.')
  assert.deepEqual(result.error.details, {})
})
test('RPC sanitizes provider exceptions and unknown endpoints', async () => {
  const { rpc, ctx } = host()
  ctx.llm.prepareCall = async () => { throw new Error('credential SECRET') }
  const result = await rpc('configure', { provider: 'configured', model: 'model' })
  assert.equal(result.ok, false)
  assert.ok(!JSON.stringify(result).includes('SECRET'))
  assert.deepEqual(result.error.details, {})
  const unknown = await rpc('unknown')
  assert.equal(unknown.error.code, 'unknown-endpoint')
  assert.deepEqual(unknown.error.details, {})
})
