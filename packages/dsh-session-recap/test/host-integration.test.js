import test from 'node:test'
import assert from 'node:assert/strict'
import { CHANNEL, inject } from '../dist/src/index.js'
import { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'

// Exercise the Loader paired with the installed Cordis peer graph.
const require = createRequire(import.meta.url)
const cordisRequire = createRequire(require.resolve('@deepseek-ai/cordis'))
const { default: Loader } = await import(cordisRequire.resolve('@deepseek-ai/cordis-plugin-loader'))

async function host(t) {
  const root = new Context()
  t.after(() => root.fiber.dispose())
  let handler,
    installed,
    preparations = 0,
    registrations = 0
  const ctx = {
    sessions: { get() {} },
    llm: {
      listProviders: () => [{ id: 'configured', name: 'Configured', secret: 'NEVER' }],
      listModels: async () => [{ id: 'model', name: 'Model', secret: 'NEVER' }],
      prepareCall: async (config) => {
        preparations++
        return { config, inputModalities: ['text'] }
      },
    },
    settings: {
      configure(policy, owner) {
        installed = { policy, owner }
        return () => {
          installed = undefined
        }
      },
      async update(ns, value) {
        assert.equal(ns, 'recap-test-entry')
        await root.loader.update(ns, { config: value })
        await root.loader.await()
      },
    },
    connection: {
      rpc: {
        handle(channel, fn) {
          assert.equal(channel, CHANNEL)
          registrations++
          handler = fn
          return () => {}
        },
      },
    },
  }
  for (const [key, service] of Object.entries(ctx)) {
    root.provide(key, service)
  }
  root.provide('webServer', {})
  await root.plugin(Loader, { baseUrl: import.meta.url }).await()
  await root.loader.create({ id: 'recap-test-entry', name: '../dist/src/index.js' })
  await root.loader.await()
  return {
    ctx,
    root,
    rpc: (...args) => handler(...args),
    installed,
    registrations: () => registrations,
    policy: () => installed,
    preparations: () => preparations,
  }
}

test('registers schema-backed settings defaults and opaque storage scope', async (t) => {
  const { rpc, installed } = await host(t)
  assert.deepEqual(installed.policy, { auto: false })
  assert.equal(installed.owner.config.autoRecap.get(), true)
  assert.equal(installed.owner.config.useJev.get(), false)
  assert.equal(installed.owner.config.inactivityMinutes.get(), 30)
  const result = await rpc('settings')
  assert.equal(result.ok, true)
  assert.equal(result.value.provider, '')
  assert.match(result.value.storageScope, /^[a-f0-9]{24}$/)
})
test('optional Jev lookup wires the service without required injection or settings-time evaluation', async (t) => {
  assert.ok(!inject.includes('jev'))
  const { rpc, ctx, root } = await host(t)
  let evaluations = 0
  const service = {
    settings: () => ({ model: 'typesafe/jev-1.13' }),
    async evaluate() {
      evaluations++
      throw Error('No credential')
    },
  }
  root.provide('jev', service)
  await rpc('configure', { provider: 'configured', model: 'model', useJev: true })
  await rpc('settings')
  assert.equal(evaluations, 0)
  ctx.sessions.get = () => session
  const session = {
    seq: 1,
    deriveMessages: () => [
      {
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Visible conversation' }],
      },
    ],
  }
  ctx.llm.prepareCall = async (config) => ({
    config,
    async *stream() {
      yield { type: 'text-delta', text: '{"bullets":["Legacy recap"]}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
  const result = await rpc('recap', { sessionId: 's' })
  assert.equal(result.ok, true)
  assert.equal(result.value.selection.mode, 'standard')
  assert.equal(result.value.selection.reason, 'unavailable')
  assert.equal(result.value.selection.diagnostics.status, 'unavailable')
  assert.equal(evaluations, 1)
})
test('Loader changes preserve live references and RPC lifetime; policy follows disposal', async (t) => {
  const { root, rpc, installed, registrations, policy } = await host(t)
  const reference = installed.owner.config.autoRecap
  await root.loader.update('recap-test-entry', { config: { autoRecap: false } })
  await root.loader.await()
  assert.equal(reference, installed.owner.config.autoRecap)
  assert.equal(reference.get(), false)
  assert.equal((await rpc('settings')).value.autoRecap, false)
  assert.equal(registrations(), 1, 'a volatile edit does not remount the RPC owner')
  await root.loader.remove('recap-test-entry')
  await root.loader.await()
  assert.equal(policy(), undefined)
})

test('provider catalog returns only public display metadata', async (t) => {
  const { rpc } = await host(t)
  assert.deepEqual(await rpc('models'), {
    ok: true,
    value: {
      providers: [
        { id: 'configured', name: 'Configured', models: [{ id: 'model', name: 'Model' }] },
      ],
    },
  })
})
test('configure validates exact custom route without catalog allowlist', async (t) => {
  const { rpc, preparations } = await host(t)
  const result = await rpc('configure', {
    provider: 'configured',
    model: 'custom-unlisted',
    autoRecap: false,
  })
  assert.equal(result.ok, true)
  assert.equal(result.value.model, 'custom-unlisted')
  assert.equal(result.value.autoRecap, false)
  assert.equal(preparations(), 1)
  assert.equal((await rpc('configure', { provider: '', model: '' })).ok, true)
  assert.equal(preparations(), 1)
})
test('configure rejects unknown fields and invalid values without writing', async (t) => {
  const { rpc } = await host(t)
  for (const payload of [
    null,
    [],
    { apiKey: 'SECRET' },
    { inactivityMinutes: 0 },
    { provider: 'alone' },
    { autoRecap: 0 },
    { useJev: 'true' },
  ])
    assert.equal((await rpc('configure', payload)).ok, false)
  assert.equal((await rpc('settings')).value.provider, '')
})
test('unconfigured recap returns a complete DSH RPC failure envelope', async (t) => {
  const { rpc } = await host(t)
  const result = await rpc('recap', { sessionId: 'fixture-session' })
  assert.equal(result.ok, false)
  assert.equal(typeof result.error.code, 'string')
  assert.equal(
    result.error.message,
    'Choose a provider and model in Plugins → Session Recap → Configure.',
  )
  assert.deepEqual(result.error.details, {})
})
test('RPC sanitizes provider exceptions and unknown endpoints', async (t) => {
  const { rpc, ctx } = await host(t)
  ctx.llm.prepareCall = async () => {
    throw new Error('credential SECRET')
  }
  const result = await rpc('configure', { provider: 'configured', model: 'model' })
  assert.equal(result.ok, false)
  assert.ok(!JSON.stringify(result).includes('SECRET'))
  assert.deepEqual(result.error.details, {})
  for (const endpoint of ['unknown', '__proto__', 'constructor', ['settings'], null]) {
    const unknown = await rpc(endpoint)
    assert.equal(unknown.error.code, 'unknown-endpoint')
    assert.deepEqual(unknown.error.details, {})
  }
})
