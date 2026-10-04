import test from 'node:test'
import assert from 'node:assert/strict'
import { markAgentLoopRequest, LlmError } from '@deepseek-ai/dsh-llm'
import { CodexFastRuntime } from '../dist/src/fast/runtime.js'
import { inferenceFixture, request, consume, gate } from './inference-fixture.js'

async function fixture(t, stored, profile) {
  const f = await inferenceFixture(t, profile)
  const records = stored?.records ?? new Map()
  const subagents = stored?.subagents ?? new Map()
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
    table(name) {
      const table = name === 'subagents' ? subagents : records
      return {
        get: (id) => table.get(id),
        async put(id, value) {
          await state.sessionBarrier?.()
          if (state.failure) throw new Error('fixture storage failure with private detail')
          table.set(id, Object.freeze(value))
        },
      }
    },
    async close() {},
  }
  const agents = new Map(
    ['fast-session', 'other', 'child'].map((id) => [
      id,
      {
        id,
        session: {
          header:
            id === 'child'
              ? { origin: 'subagent', delegationDepth: 1, parentSession: 'fast-session' }
              : {},
        },
      },
    ]),
  )
  let selection = { provider: 'openai-codex', model: 'gpt-6-sol' }
  const owners = new Map([['child', agents.get('fast-session')]])
  f.ctx.provide('agents', {
    get: (id) => agents.get(id),
    isOwnedBy: (id, owner) => agents.has(id) && owners.get(id) === owner,
  })
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
    setSubagents: (enabled, id = 'fast-session', rev = subagents.get(id)?.revision ?? 0) =>
      rpc('subagents-set', { sessionId: id, enabled, revision: rev }),
    loop,
    records,
    subagents,
    agents,
    owners,
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

// Policy is observed at the real LLM/adapter boundary; the live registry and storage effects
// are controlled. This catches accidental main-toggle inheritance and cross-root leakage.
test('Subagents Fast is independent, root-scoped and model-eligible across nested delegations', async (t) => {
  const f = await fixture(t, undefined, {
    models: [
      { id: 'gpt-6-sol' },
      { id: 'gpt-5.5' },
      { id: 'unreviewed-fixture-model', contextWindow: 32768, maxTokens: 2048, input: ['text'] },
    ],
  })
  const child = f.agents.get('child')
  f.agents.set('nested', {
    id: 'nested',
    session: {
      header: {
        origin: 'subagent',
        delegationDepth: 2,
        parentSession: 'child',
        isSeeded: true,
      },
    },
  })
  f.owners.set('nested', child)
  f.agents.set('other-child', {
    id: 'other-child',
    session: {
      header: {
        origin: 'subagent',
        delegationDepth: 1,
        parentSession: 'other',
      },
    },
  })
  f.owners.set('other-child', f.agents.get('other'))
  // A normal conversation fork must not follow its seed parent's subagent policy.
  f.agents.get('other').session.header = { parentSession: 'fast-session', isSeeded: true }
  assert.equal(f.runtime.sessionStatus('fast-session').subagentsRequested, false)
  assert.equal((await f.setSubagents(true)).ok, true)
  assert.equal(f.runtime.sessionStatus('fast-session').requested, false)
  await consume(f.loop())
  await consume(f.loop('child'))
  await consume(f.loop('nested', { model: 'gpt-5.5' }))
  await consume(f.loop('other-child'))
  await consume(f.loop('child', { model: 'unreviewed-fixture-model' }))
  await consume(f.loop('child', { purpose: 'compaction' }))
  await consume(f.ctx.llm.stream(request('child')))
  assert.deepEqual(
    f.captures.map((c) => c.body.service_tier),
    [undefined, 'priority', 'priority', undefined, undefined, undefined, undefined],
  )
  assert.equal(f.captures[1].options.sessionId, 'child:dsh-codex-fast-v1')
  assert.equal((await f.setSubagents(true, 'child')).ok, false)
  assert.equal((await f.setSubagents(true, 'fast-session', 0)).ok, false, 'stale enable rejects')
  await f.setSession(true)
  await f.setSubagents(false)
  await consume(f.loop())
  await consume(f.loop('child'))
  assert.deepEqual(
    f.captures.slice(-2).map((c) => c.body.service_tier),
    ['priority', undefined],
  )
  // Root policy is independent even of the parent's model/provider support.
  f.select({ provider: 'another-provider', model: 'another-model' })
  assert.equal(f.runtime.sessionStatus('fast-session').supported, false)
  assert.equal((await f.setSubagents(true)).ok, true)
  await consume(f.loop('child'))
  assert.equal(f.captures.at(-1).body.service_tier, 'priority')
  const resumed = await fixture(t, {
    records: f.records,
    subagents: f.subagents,
    global: f.global(),
  })
  await consume(resumed.loop('child'))
  assert.equal(resumed.captures[0].body.service_tier, 'priority')
})

test('Subagents Fast leaves a gateway endpoint Standard even for an allowlisted child model', async (t) => {
  const f = await fixture(t, undefined, { baseURL: 'https://gateway.fixture.invalid' })
  assert.equal((await f.setSubagents(true)).ok, true)
  await consume(f.loop('child'))
  assert.equal(f.captures.length, 1)
  assert.equal(f.captures[0].model.baseUrl, 'https://gateway.fixture.invalid')
  assert.equal(f.captures[0].body.service_tier, undefined)
  assert.equal(f.captures[0].options.sessionId, 'child')
})

test('Subagents Fast fails closed on orphaned, inconsistent or unowned ancestry', async (t) => {
  const f = await fixture(t)
  await f.setSubagents(true)
  const child = f.agents.get('child')
  for (const header of [
    { origin: 'subagent', delegationDepth: 1 },
    { origin: 'subagent', delegationDepth: 1, parentSession: 'missing' },
    { origin: 'subagent', delegationDepth: 2, parentSession: 'fast-session' },
    { origin: 'subagent', delegationDepth: 0, parentSession: 'fast-session' },
    { origin: 'subagent', delegationDepth: 1, parentSession: 'child' },
  ]) {
    child.session.header = header
    await consume(f.loop('child'))
  }
  child.session.header = { origin: 'subagent', delegationDepth: 1, parentSession: 'fast-session' }
  f.owners.delete('child')
  await consume(f.loop('child'))
  assert.equal(f.captures.length, 6)
  assert.ok(f.captures.every((c) => c.body.service_tier === undefined))
})

for (const revoke of [
  'subagents-off',
  'integration-off',
  'root-replaced',
  'child-replaced',
  'ownership-lost',
]) {
  test(`pending child payload loses Fast after ${revoke}`, async (t) => {
    const f = await fixture(t)
    await f.setSubagents(true)
    const entered = gate(),
      hold = gate()
    f.provider(undefined, {
      async beforePayload() {
        entered.resolve()
        await hold.promise
      },
    })
    const pending = consume(f.loop('child'))
    await entered.promise
    if (revoke === 'subagents-off') {
      f.state.failure = true
      assert.equal((await f.setSubagents(false, 'fast-session', 999)).ok, false)
      assert.equal(f.runtime.sessionStatus('fast-session').subagentsRequested, false)
      assert.equal(f.runtime.sessionStatus('fast-session').subagentsOffPending, true)
      assert.equal(f.subagents.get('fast-session').enabled, true)
    } else if (revoke === 'integration-off') {
      await f.rpc('integration-set', { enabled: false, revision: 999 })
    } else if (revoke === 'ownership-lost') {
      f.owners.delete('child')
    } else {
      const id = revoke === 'root-replaced' ? 'fast-session' : 'child'
      f.agents.set(id, { ...f.agents.get(id) })
      if (id === 'fast-session') f.owners.set('child', f.agents.get(id))
    }
    hold.resolve()
    await pending
    assert.equal(f.captures[0].body.service_tier, undefined)
    if (revoke === 'subagents-off') {
      f.state.failure = false
      assert.equal((await f.setSubagents(false, 'fast-session', 999)).ok, true)
      assert.equal(f.runtime.sessionStatus('fast-session').subagentsOffPending, false)
      assert.equal(f.subagents.get('fast-session').enabled, false)
      const resumed = await fixture(t, { subagents: f.subagents, global: f.global() })
      await consume(resumed.loop('child'))
      assert.equal(resumed.captures[0].body.service_tier, undefined)
    }
  })
}

test('a late subagent Enable cannot undo a newer Off while storage is pending', async (t) => {
  const f = await fixture(t)
  const entered = gate(),
    hold = gate()
  let first = true
  f.state.sessionBarrier = async () => {
    if (first) {
      first = false
      entered.resolve()
      await hold.promise
    }
  }
  const enable = f.setSubagents(true)
  await entered.promise
  const off = f.setSubagents(false, 'fast-session', 999)
  assert.equal(f.runtime.sessionStatus('fast-session').subagentsRequested, false)
  hold.resolve()
  assert.equal((await enable).value.subagentsRequested, false)
  assert.equal((await off).ok, true)
  assert.equal(f.subagents.get('fast-session').enabled, false)
  assert.equal((await f.setSubagents(true, 'fast-session', 0)).ok, false)
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
  assert.equal(f.runtime.sessionStatus('fast-session').sessionOffPending, true)
  payload.resolve()
  await pending
  assert.equal(f.captures.at(-1).body.service_tier, undefined)
  stored.resolve()
  assert.equal((await off).ok, true)
  assert.equal(f.runtime.sessionStatus('fast-session').sessionOffPending, false)
  assert.equal((await f.setSession(true, 'fast-session', 1)).ok, false)
})

test('failed storage keeps emergency Off effective and never exposes private failure details', async (t) => {
  const f = await fixture(t)
  await f.setSession(true)
  f.state.failure = true
  assert.equal((await f.setSession(false)).ok, false)
  assert.equal(f.runtime.sessionStatus('fast-session').sessionOffPending, true)
  const result = await f.rpc('integration-set', { enabled: false, revision: 0 })
  assert.equal(result.ok, false)
  assert.doesNotMatch(result.error.message, /private detail/)
  assert.equal(f.runtime.integrationStatus().enabled, false)
  await consume(f.loop())
  assert.equal(f.captures[0].body.service_tier, undefined)
  // Retry must remain possible after choosing a non-Codex route with a slash-qualified model.
  f.state.failure = false
  f.select({ provider: 'another-provider', model: 'another/model' })
  assert.equal(
    (
      await f.rpc('session-set', {
        sessionId: 'fast-session',
        provider: 'openai-codex',
        model: 'another/model',
        enabled: false,
        revision: 999,
      })
    ).ok,
    true,
  )
  assert.equal(f.runtime.sessionStatus('fast-session').sessionOffPending, false)
  assert.equal(f.records.get('fast-session').enabled, false)
  assert.equal(f.records.get('fast-session').model, 'gpt-6-sol')
})

test('invalid RPC, unsupported model, cancellation and stale enables do not authorize Fast', async (t) => {
  const f = await fixture(t)
  for (const [endpoint, input] of [
    ['session-status', { sessionId: '../../secrets' }],
    ['integration-set', { enabled: true, revision: 0, extra: 'x' }],
    ['subagents-set', { sessionId: 'fast-session', enabled: true }],
    ['subagents-set', { sessionId: 'fast-session', enabled: 'yes', revision: 0 }],
    ['subagents-set', { sessionId: 'fast-session', enabled: true, revision: 0, extra: true }],
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
  assert.equal(
    (
      await f.runtime.rpc(
        'subagents-set',
        {
          sessionId: 'fast-session',
          enabled: true,
          revision: 0,
        },
        controller.signal,
      )
    ).ok,
    false,
  )
  assert.equal(f.subagents.size, 0)
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
