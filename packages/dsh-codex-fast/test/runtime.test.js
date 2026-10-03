import test from 'node:test'
import assert from 'node:assert/strict'
import { markAgentLoopRequest, LlmError } from '@deepseek-ai/dsh-llm'
import { CodexFastRuntime } from '../dist/src/runtime.js'
import { inferenceFixture, request, consume, gate } from './inference-fixture.js'

async function fixture(t, stored) {
  const f = await inferenceFixture(t)
  const records = stored?.records ?? new Map()
  let global = stored?.global ?? { enabled: true, revision: 0 }
  const state = { globalBarrier: null, sessionBarrier: null, failure: false }
  const domain = {
    global: {
      get: () => global,
      async set(value) {
        await state.globalBarrier?.()
        if (state.failure) throw new Error('fixture storage failure with private detail')
        global = value
      },
    },
    table() {
      return {
        get: (id) => records.get(id),
        async put(id, value) {
          await state.sessionBarrier?.()
          if (state.failure) throw new Error('fixture storage failure with private detail')
          records.set(id, Object.freeze(value))
        },
      }
    },
    async close() {},
  }
  const agents = new Map(
    ['fast-session', 'other', 'child'].map((id) => [
      id,
      { id, session: { header: id === 'child' ? { origin: 'subagent', delegationDepth: 1 } : {} } },
    ]),
  )
  let selection = { provider: 'openai-codex', model: 'gpt-6-sol' }
  f.ctx.provide('agents', { get: (id) => agents.get(id) })
  f.ctx.provide('agentDefaultModel', { currentSelection: () => selection })
  f.ctx.provide('sessionProjections', { stateOf: () => ({ pending: selection, lastUsed: null }) })
  const runtime = new CodexFastRuntime(f.ctx, domain)
  f.ctx.on('llm/stream', (options, next) => runtime.stream(options, next))
  t.after(() => runtime.dispose())
  const rpc = (endpoint, input = {}) => runtime.rpc(endpoint, input, new AbortController().signal)
  const setSession = (enabled, id = 'fast-session', rev = records.get(id)?.revision ?? 0) =>
    rpc('session-set', { sessionId: id, ...selection, enabled, revision: rev })
  const loop = (id = 'fast-session', extra = {}) => {
    const options = request(id, extra)
    markAgentLoopRequest(options)
    return f.ctx.llm.stream(options)
  }
  return {
    ...f,
    runtime,
    rpc,
    setSession,
    loop,
    records,
    state,
    global: () => global,
    select(value) {
      selection = value
    },
  }
}

test('session choice persists independently; fresh/fork sessions and non-conversation calls remain Standard', async (t) => {
  const f = await fixture(t)
  assert.equal(f.runtime.sessionStatus('fast-session').requested, false)
  assert.equal((await f.setSession(true)).ok, true)
  await consume(f.loop())
  await consume(f.loop('other'))
  await consume(f.loop('fast-session', { purpose: 'compaction' }))
  await consume(f.loop('fast-session', { purpose: 'session-title' }))
  await consume(f.ctx.llm.stream(request())) // no LOOP identity: summary/manual calls
  await consume(f.loop('child'))
  assert.deepEqual(
    f.captures.map((c) => c.body.service_tier),
    ['priority', undefined, undefined, undefined, undefined, undefined],
  )
  assert.equal((await f.setSession(true, 'child')).ok, false)
  const resumed = await fixture(t, { records: f.records, global: f.global() })
  assert.equal(resumed.runtime.sessionStatus('fast-session').requested, true)
  assert.equal(resumed.runtime.sessionStatus('other').requested, false)
  f.select({ provider: 'openai-codex', model: 'gpt-5.5' })
  assert.equal(
    f.runtime.sessionStatus('fast-session').requested,
    false,
    'choice is bound to the exact model',
  )
  assert.equal(
    (
      await f.rpc('session-set', {
        sessionId: 'fast-session',
        provider: 'openai-codex',
        model: 'gpt-6-sol',
        enabled: true,
        revision: 1,
      })
    ).ok,
    false,
  )
})

test('integration Off is a durable recovery switch, even with a stale UI revision', async (t) => {
  const f = await fixture(t)
  const original = f.adapter.streamWithSnapshot
  await f.setSession(true)
  await consume(f.loop())
  assert.equal((await f.rpc('integration-set', { enabled: false, revision: 999 })).ok, true)
  assert.equal(f.global().enabled, false)
  assert.equal(f.adapter.streamWithSnapshot, original)
  await consume(f.loop())
  assert.equal(f.captures.at(-1).body.service_tier, undefined)
  assert.equal(f.runtime.sessionStatus('fast-session').enabled, false)
  const resumed = await fixture(t, { records: f.records, global: f.global() })
  await consume(resumed.loop())
  assert.equal(resumed.captures[0].body.service_tier, undefined)
})

test('a late Enable write cannot undo emergency Off or reject its durable recovery', async (t) => {
  const f = await fixture(t)
  await f.rpc('integration-set', { enabled: false, revision: 0 })
  const hold = gate(),
    entered = gate()
  let first = true
  f.state.globalBarrier = async () => {
    if (first) {
      first = false
      entered.resolve()
      await hold.promise
    }
  }
  const enable = f.rpc('integration-set', { enabled: true, revision: 1 })
  await entered.promise
  const off = f.rpc('integration-set', { enabled: false, revision: 1 })
  assert.equal(f.runtime.integrationStatus().enabled, false)
  hold.resolve()
  const enabledResult = await enable
  assert.equal(
    enabledResult.value.enabled,
    false,
    'older completion cannot clear the newer revocation fence',
  )
  assert.equal((await off).ok, true)
  assert.equal(f.global().enabled, false)
  assert.equal(f.runtime.integrationStatus().enabled, false)
})

test('session Off revokes an unsent payload before persistence and stale enables cannot restore it', async (t) => {
  const f = await fixture(t)
  await f.setSession(true)
  const payload = gate(),
    entered = gate(),
    stored = gate(),
    storeEntered = gate()
  f.provider(undefined, {
    async beforePayload() {
      entered.resolve()
      await payload.promise
    },
  })
  const pending = consume(f.loop())
  await entered.promise
  f.state.sessionBarrier = async () => {
    storeEntered.resolve()
    await stored.promise
  }
  const off = f.setSession(false)
  await storeEntered.promise
  assert.equal(f.runtime.sessionStatus('fast-session').requested, false)
  payload.resolve()
  await pending
  assert.equal(f.captures.at(-1).body.service_tier, undefined)
  stored.resolve()
  assert.equal((await off).ok, true)
  assert.equal((await f.setSession(true, 'fast-session', 1)).ok, false)
})

test('failed storage keeps emergency Off effective and never exposes private failure details', async (t) => {
  const f = await fixture(t)
  await f.setSession(true)
  f.state.failure = true
  const result = await f.rpc('integration-set', { enabled: false, revision: 0 })
  assert.equal(result.ok, false)
  assert.doesNotMatch(result.error.message, /private detail/)
  assert.equal(f.runtime.integrationStatus().enabled, false)
  await consume(f.loop())
  assert.equal(f.captures[0].body.service_tier, undefined)
})

test('invalid RPC, unsupported model, cancellation and stale enables do not authorize Fast', async (t) => {
  const f = await fixture(t)
  for (const [endpoint, input] of [
    ['session-status', { sessionId: '../../secrets' }],
    ['integration-set', { enabled: true, revision: 0, extra: 'x' }],
    [
      'session-set',
      {
        sessionId: 'fast-session',
        provider: 'openai-codex',
        model: 'gpt-6-sol',
        enabled: 'yes',
        revision: 0,
      },
    ],
  ])
    assert.equal((await f.rpc(endpoint, input)).ok, false)
  const controller = new AbortController()
  controller.abort()
  assert.equal(
    (await f.runtime.rpc('integration-set', { enabled: true, revision: 0 }, controller.signal)).ok,
    false,
  )
  f.select({ provider: 'openai-codex', model: 'unknown-model' })
  assert.equal((await f.setSession(true)).ok, false)
  assert.equal(f.records.size, 0)
})

test('native pre-payload credential errors remain native errors rather than bridge incompatibility', async (t) => {
  const f = await fixture(t)
  await f.setSession(true)
  f.credential(async () => {
    throw new LlmError('fixture missing key', 'MISSING_CREDENTIAL')
  })
  const chunks = await consume(f.loop())
  const end = chunks.find((c) => c.type === 'finish')
  assert.equal(end.reason.kind, 'error')
  assert.equal(end.reason.failure.code, 'MISSING_CREDENTIAL')
  assert.equal(f.captures.length, 0)
})
