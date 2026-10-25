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
          await state.sessionBarrier?.(name, value)
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
    setMode: (mode, overrides = {}) =>
      rpc('mode-set', {
        sessionId: 'fast-session',
        ...selection,
        mode,
        sessionRevision: records.get('fast-session')?.revision ?? 0,
        subagentsRevision: subagents.get('fast-session')?.revision ?? 0,
        ...overrides,
      }),
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

test('Off → All → Main → Off persists without affecting fresh sessions or auxiliary calls', async (t) => {
  const f = await fixture(t)
  assert.equal(f.runtime.sessionStatus('fast-session').requested, false)
  assert.equal(f.runtime.sessionStatus('fast-session').subagentsRequested, false)
  const enabled = await f.setMode('all')
  assert.equal(enabled.ok, true)
  assert.equal(enabled.value.requested, true)
  assert.equal(enabled.value.subagentsRequested, true)
  await consume(f.loop())
  await consume(f.loop('other'))
  await consume(f.loop('fast-session', { purpose: 'compaction' }))
  await consume(f.loop('fast-session', { purpose: 'session-title' }))
  await consume(f.ctx.llm.stream(request())) // no LOOP identity: summary/manual calls
  await consume(f.loop('child'))
  assert.deepEqual(
    f.captures.map((c) => c.body.service_tier),
    ['priority', undefined, undefined, undefined, undefined, 'priority'],
  )
  assert.equal((await f.setSession(true, 'child')).ok, false)
  const resumed = await fixture(t, {
    records: f.records,
    subagents: f.subagents,
    global: f.global(),
  })
  assert.equal(resumed.runtime.sessionStatus('fast-session').requested, true)
  assert.equal(resumed.runtime.sessionStatus('fast-session').subagentsRequested, true)
  assert.equal(resumed.runtime.sessionStatus('other').requested, false)
  assert.equal(resumed.runtime.sessionStatus('other').subagentsRequested, false)
  const main = await f.setMode('main')
  assert.equal(main.ok, true)
  assert.equal(main.value.requested, true)
  assert.equal(main.value.subagentsRequested, false)
  const mainResumed = await fixture(t, { records: f.records, subagents: f.subagents })
  await consume(mainResumed.loop())
  await consume(mainResumed.loop('child'))
  assert.deepEqual(
    mainResumed.captures.map((c) => c.body.service_tier),
    ['priority', undefined],
  )
  const off = await f.setMode('off')
  assert.equal(off.ok, true)
  assert.equal(off.value.requested, false)
  assert.equal(off.value.subagentsRequested, false)
  const offResumed = await fixture(t, { records: f.records, subagents: f.subagents })
  await consume(offResumed.loop())
  await consume(offResumed.loop('child'))
  assert.ok(offResumed.captures.every((c) => c.body.service_tier === undefined))
  assert.equal((await f.setMode('all')).ok, true)
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
        revision: f.records.get('fast-session').revision,
      })
    ).ok,
    false,
  )
})

test('legacy endpoints retain default All and Main overrides but cannot activate child-only policy', async (t) => {
  const f = await fixture(t)
  assert.equal((await f.setSubagents(true)).ok, false)
  assert.equal((await f.setSession(true)).value.subagentsRequested, true)
  await f.setSubagents(false)
  assert.equal((await f.setSession(true)).value.subagentsRequested, false)
  await consume(f.loop())
  await consume(f.loop('child'))
  assert.deepEqual(
    f.captures.map((c) => c.body.service_tier),
    ['priority', undefined],
  )
  await f.setSession(false)
  const enabled = await f.setSession(true)
  assert.equal(enabled.ok, true)
  assert.equal(enabled.value.subagentsRequested, true)
  await f.setSession(false)
  await consume(f.loop())
  await consume(f.loop('child'))
  assert.deepEqual(
    f.captures.slice(-2).map((c) => c.body.service_tier),
    [undefined, undefined],
  )
  assert.equal((await f.setSubagents(true)).ok, false)
})

for (const failedTable of ['subagents', 'sessions']) {
  test(`partial All failure in ${failedTable} leaves child-only intent inactive, including after reload`, async (t) => {
    const f = await fixture(t)
    assert.equal(f.runtime.sessionStatus('fast-session').supported, true)
    f.state.sessionBarrier = async (table) => {
      if (table === failedTable) throw new Error('fixture private storage failure')
    }
    const result = await f.setMode('all')
    assert.equal(result.ok, false)
    assert.doesNotMatch(result.error.message, /private storage failure/)
    const status = f.runtime.sessionStatus('fast-session')
    assert.equal(status.requested, false)
    assert.equal(status.subagentsRequested, false)
    assert.equal(
      f.subagents.get('fast-session')?.enabled,
      failedTable === 'sessions' ? true : undefined,
    )
    const resumed = await fixture(t, { records: f.records, subagents: f.subagents })
    await consume(resumed.loop('child'))
    assert.equal(resumed.captures[0].body.service_tier, undefined)
    f.state.sessionBarrier = null
    assert.equal((await f.setMode('all')).value.subagentsRequested, true)
  })
}

for (const mode of ['main', 'off']) {
  for (const failedTable of ['sessions', 'subagents']) {
    test(`${mode} fences survive a partial ${failedTable} write failure and permit recovery`, async (t) => {
      const f = await fixture(t)
      assert.equal((await f.setMode('all')).ok, true)
      f.state.sessionBarrier = async (table) => {
        if (table === failedTable) throw new Error('fixture persistence failure')
      }
      assert.equal((await f.setMode(mode)).ok, false)
      const status = f.runtime.sessionStatus('fast-session')
      assert.equal(status.requested, mode === 'main')
      assert.equal(status.subagentsRequested, false)
      assert.equal(status.subagentsOffPending, mode === 'off' || failedTable === 'subagents')
      assert.equal(status.sessionOffPending, mode === 'off' && failedTable === 'sessions')
      await consume(f.loop('child'))
      assert.equal(f.captures[0].body.service_tier, undefined)
      f.state.sessionBarrier = null
      assert.equal((await f.setMode(mode)).ok, true)
      assert.equal(f.runtime.sessionStatus('fast-session').subagentsOffPending, false)
      const resumed = await fixture(t, { records: f.records, subagents: f.subagents })
      assert.equal(resumed.runtime.sessionStatus('fast-session').requested, mode === 'main')
      await consume(resumed.loop('child'))
      assert.equal(resumed.captures[0].body.service_tier, undefined)
    })
  }
}

// Policy is observed at the real LLM/adapter boundary; registry and storage effects are controlled.
test('All is parent-gated, root-scoped and child-model-eligible across nested delegations', async (t) => {
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
  assert.equal((await f.setMode('all')).ok, true)
  assert.equal(f.runtime.sessionStatus('fast-session').requested, true)
  await consume(f.loop())
  await consume(f.loop('child'))
  await consume(f.loop('nested', { model: 'gpt-5.5' }))
  await consume(f.loop('other-child'))
  await consume(f.loop('child', { model: 'unreviewed-fixture-model' }))
  await consume(f.loop('child', { purpose: 'compaction' }))
  await consume(f.ctx.llm.stream(request('child')))
  assert.deepEqual(
    f.captures.map((c) => c.body.service_tier),
    ['priority', 'priority', 'priority', undefined, undefined, undefined, undefined],
  )
  assert.equal(f.captures[1].options.sessionId, 'child:dsh-codex-fast-v1')
  assert.equal((await f.setSubagents(true, 'child')).ok, false)
  assert.equal((await f.setSubagents(true, 'fast-session', 0)).ok, false, 'stale enable rejects')
  assert.equal((await f.setSession(true)).ok, true)
  await f.setSubagents(false)
  await consume(f.loop())
  await consume(f.loop('child'))
  assert.deepEqual(
    f.captures.slice(-2).map((c) => c.body.service_tier),
    ['priority', undefined],
  )
  assert.equal((await f.setMode('all')).ok, true)
  // A different supported selection also deactivates the old choice, without a migration.
  f.select({ provider: 'openai-codex', model: 'gpt-5.5' })
  assert.equal(f.runtime.sessionStatus('fast-session').requested, false)
  assert.equal(f.runtime.sessionStatus('fast-session').subagentsRequested, false)
  await consume(f.loop('child'))
  assert.equal(f.captures.at(-1).body.service_tier, undefined)
  f.select({ provider: 'another-provider', model: 'another-model' })
  assert.equal(f.runtime.sessionStatus('fast-session').supported, false)
  assert.equal((await f.setSubagents(true)).ok, false)
  await consume(f.loop('child'))
  assert.equal(f.captures.at(-1).body.service_tier, undefined)
  const resumed = await fixture(t, {
    records: f.records,
    subagents: f.subagents,
    global: f.global(),
  })
  await consume(resumed.loop('child'))
  assert.equal(resumed.captures[0].body.service_tier, 'priority')
})

for (const parentState of ['missing', 'disabled', 'different-selection', 'unsupported']) {
  test(`legacy child-only intent stays inactive with ${parentState} parent, without rewriting storage`, async (t) => {
    const parent = {
      provider: 'openai-codex',
      model: 'gpt-6-sol',
      enabled: parentState !== 'disabled',
      revision: 7,
    }
    if (parentState === 'unsupported') parent.model = 'unknown-model'
    const records = new Map(parentState === 'missing' ? [] : [['fast-session', parent]])
    const subagents = new Map([['fast-session', { enabled: true, revision: 9 }]])
    const f = await fixture(t, { records, subagents })
    if (parentState === 'different-selection')
      f.select({ provider: 'openai-codex', model: 'gpt-5.5' })
    if (parentState === 'unsupported')
      f.select({ provider: 'openai-codex', model: 'unknown-model' })
    assert.equal(f.runtime.sessionStatus('fast-session').subagentsRequested, false)
    await consume(f.loop('child'))
    assert.equal(f.captures[0].body.service_tier, undefined)
    assert.equal(f.captures[0].options.sessionId, 'child')
    assert.equal(subagents.get('fast-session').enabled, true)
    assert.equal(subagents.get('fast-session').revision, 9)
    assert.equal(records.get('fast-session'), parentState === 'missing' ? undefined : parent)
  })
}

for (const mode of ['all', 'main']) {
  for (const staleField of ['sessionRevision', 'subagentsRevision']) {
    test(`${mode} validates ${staleField} before enabling`, async (t) => {
      const f = await fixture(t)
      assert.equal((await f.setMode('main')).ok, true)
      assert.equal((await f.setMode(mode, { [staleField]: 0 })).ok, false)
      assert.equal(f.records.get('fast-session').revision, 1)
      assert.equal(f.subagents.get('fast-session').revision, mode === 'main' ? 2 : 1)
      assert.equal(f.runtime.sessionStatus('fast-session').subagentsRequested, false)
      assert.equal((await f.setMode(mode)).ok, true)
    })
  }
}

for (const parentEnabled of [false, true]) {
  test(`stale Main durably reduces child policy without enabling a ${parentEnabled ? 'requested' : 'disabled'} parent`, async (t) => {
    const parent = {
      provider: 'openai-codex',
      model: 'gpt-6-sol',
      enabled: parentEnabled,
      revision: 7,
    }
    const f = await fixture(t, {
      records: new Map([['fast-session', parent]]),
      subagents: new Map([['fast-session', { enabled: true, revision: 9 }]]),
    })
    const result = await f.setMode('main', { sessionRevision: 0, subagentsRevision: 0 })
    assert.equal(result.ok, false)
    assert.match(result.error.message, /changed/)
    assert.equal(
      f.records.get('fast-session'),
      parent,
      'stale Main never rewrites parent enablement',
    )
    assert.equal(f.subagents.get('fast-session').enabled, false)
    assert.equal(f.subagents.get('fast-session').revision, 10)
    const resumed = await fixture(t, { records: f.records, subagents: f.subagents })
    await consume(resumed.loop('child'))
    assert.equal(resumed.captures[0].body.service_tier, undefined)
  })
}

test('combined stale Off recovers both policies after changing to a slash-qualified non-Codex route', async (t) => {
  const f = await fixture(t)
  assert.equal((await f.setMode('all')).ok, true)
  f.state.failure = true
  assert.equal((await f.setMode('off', { sessionRevision: 999, subagentsRevision: 999 })).ok, false)
  assert.equal(f.runtime.sessionStatus('fast-session').sessionOffPending, true)
  assert.equal(f.runtime.sessionStatus('fast-session').subagentsOffPending, true)
  f.select({ provider: 'another-provider', model: 'another/model' })
  f.state.failure = false
  assert.equal((await f.setMode('off', { sessionRevision: 0, subagentsRevision: 0 })).ok, true)
  assert.equal(f.records.get('fast-session').enabled, false)
  assert.equal(f.records.get('fast-session').model, 'gpt-6-sol')
  assert.equal(f.subagents.get('fast-session').enabled, false)
  const resumed = await fixture(t, { records: f.records, subagents: f.subagents })
  await consume(resumed.loop('child'))
  assert.equal(resumed.captures[0].body.service_tier, undefined)
})

test('persisted All leaves an unreviewed gateway Standard even for an allowlisted child model', async (t) => {
  const f = await fixture(
    t,
    {
      records: new Map([
        [
          'fast-session',
          { provider: 'openai-codex', model: 'gpt-6-sol', enabled: true, revision: 1 },
        ],
      ]),
      subagents: new Map([['fast-session', { enabled: true, revision: 1 }]]),
    },
    { baseURL: 'https://gateway.fixture.invalid' },
  )
  assert.equal(f.runtime.sessionStatus('fast-session').subagentsRequested, false)
  assert.equal((await f.setSubagents(true)).ok, false)
  await consume(f.loop('child'))
  assert.equal(f.captures.length, 1)
  assert.equal(f.captures[0].model.baseUrl, 'https://gateway.fixture.invalid')
  assert.equal(f.captures[0].body.service_tier, undefined)
  assert.equal(f.captures[0].options.sessionId, 'child')
})

test('Subagents Fast fails closed on orphaned, inconsistent or unowned ancestry', async (t) => {
  const f = await fixture(t)
  assert.equal((await f.setMode('all')).ok, true)
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
  'mode-off',
  'mode-main',
  'root-model-changed',
  'root-provider-changed',
  'integration-off',
  'root-replaced',
  'child-replaced',
  'ownership-lost',
]) {
  test(`pending child payload loses Fast after ${revoke}`, async (t) => {
    const f = await fixture(t)
    assert.equal((await f.setMode('all')).ok, true)
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
    } else if (revoke === 'mode-off' || revoke === 'mode-main') {
      f.state.failure = true
      assert.equal((await f.setMode(revoke === 'mode-off' ? 'off' : 'main')).ok, false)
      assert.equal(f.runtime.sessionStatus('fast-session').subagentsRequested, false)
    } else if (revoke === 'root-model-changed') {
      f.select({ provider: 'openai-codex', model: 'gpt-5.5' })
    } else if (revoke === 'root-provider-changed') {
      f.select({ provider: 'another-provider', model: 'another/model' })
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

for (const [scope, blockedWrite, revoke] of [
  ['subagents', 1, 'subagents'],
  ['session', 1, 'subagents'],
  ['session', 2, 'subagents'],
  ['all', 1, 'off'],
  ['all', 2, 'off'],
  ['all', 1, 'main'],
  ['all', 2, 'main'],
  ['main', 1, 'off'],
  ['main', 2, 'off'],
  ['subagents', 1, 'main'],
  ['subagents', 1, 'off'],
]) {
  test(`a late ${scope} Enable cannot undo newer ${revoke} during write ${blockedWrite}`, async (t) => {
    const f = await fixture(t)
    assert.equal(f.runtime.sessionStatus('fast-session').supported, true)
    if (scope === 'subagents') assert.equal((await f.setMode('main')).ok, true)
    const entered = gate(),
      hold = gate()
    let writes = 0
    f.state.sessionBarrier = async () => {
      if (++writes === blockedWrite) {
        entered.resolve()
        await hold.promise
      }
    }
    const enable =
      scope === 'session'
        ? f.setSession(true)
        : scope === 'subagents'
          ? f.setSubagents(true)
          : f.setMode(scope)
    await entered.promise
    const recovery =
      revoke === 'subagents' ? f.setSubagents(false, 'fast-session', 999) : f.setMode(revoke)
    assert.equal(f.runtime.sessionStatus('fast-session').subagentsRequested, false)
    if (revoke === 'off') assert.equal(f.runtime.sessionStatus('fast-session').requested, false)
    hold.resolve()
    const enabled = await enable
    if (enabled.ok) assert.equal(enabled.value.subagentsRequested, false)
    else assert.match(enabled.error.message, /changed/)
    const result = await recovery
    if (revoke === 'main') {
      assert.equal(f.subagents.get('fast-session').enabled, false)
      const resumed = await fixture(t, { records: f.records, subagents: f.subagents })
      await consume(resumed.loop('child'))
      assert.equal(resumed.captures[0].body.service_tier, undefined)
    }
    // Main durably disables children even when stale revisions reject parent enablement.
    if (revoke === 'main' && !result.ok) assert.equal((await f.setMode('main')).ok, true)
    else assert.equal(result.ok, true)
    assert.equal(f.subagents.get('fast-session').enabled, false)
    assert.equal(f.runtime.sessionStatus('fast-session').subagentsRequested, false)
    assert.equal((await f.setSubagents(true, 'fast-session', 0)).ok, false)
  })
}

for (const mode of ['all', 'main']) {
  test(`cancelling ${mode} during its first write never enables the parent`, async (t) => {
    const f = await fixture(t)
    assert.equal(f.runtime.sessionStatus('fast-session').supported, true)
    const entered = gate(),
      hold = gate()
    f.state.sessionBarrier = async () => {
      entered.resolve()
      await hold.promise
    }
    const controller = new AbortController()
    const pending = f.runtime.rpc(
      'mode-set',
      {
        sessionId: 'fast-session',
        provider: 'openai-codex',
        model: 'gpt-6-sol',
        mode,
        sessionRevision: 0,
        subagentsRevision: 0,
      },
      controller.signal,
    )
    await entered.promise
    controller.abort()
    hold.resolve()
    const result = await pending
    assert.equal(result.ok, false)
    assert.match(result.error.message, /cancelled/)
    assert.equal(f.records.size, 0)
    assert.equal(f.subagents.get('fast-session').enabled, mode === 'all')
    assert.equal(f.runtime.sessionStatus('fast-session').subagentsRequested, false)
    const resumed = await fixture(t, { records: f.records, subagents: f.subagents })
    await consume(resumed.loop('child'))
    assert.equal(resumed.captures[0].body.service_tier, undefined)
  })
}

for (const revoke of ['off', 'main']) {
  test(`queued All cannot undo a newer ${revoke} before its writes begin`, async (t) => {
    const f = await fixture(t)
    assert.equal(f.runtime.sessionStatus('fast-session').supported, true)
    const entered = gate(),
      hold = gate()
    f.state.globalBarrier = async () => {
      entered.resolve()
      await hold.promise
    }
    const busy = f.rpc('integration-set', { enabled: true, revision: 0 })
    await entered.promise
    const older = f.setMode('all')
    const newer = f.setMode(revoke)
    hold.resolve()
    assert.equal((await busy).ok, true)
    assert.equal((await older).ok, false)
    assert.equal((await newer).ok, true)
    const status = f.runtime.sessionStatus('fast-session')
    assert.equal(status.requested, revoke === 'main')
    assert.equal(status.subagentsRequested, false)
    assert.equal(f.subagents.get('fast-session').enabled, false)
  })
}

test('integration Off is a durable recovery switch, even with a stale UI revision', async (t) => {
  const f = await fixture(t)
  const original = f.adapter.streamWithSnapshot
  assert.equal((await f.setSession(true)).ok, true)
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
  assert.equal(f.runtime.sessionStatus('fast-session').supported, true)
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
  assert.equal((await f.setSession(true)).ok, true)
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
  assert.equal((await f.setSession(true)).ok, true)
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
  for (const invalid of [
    { mode: 'subagents' },
    { mode: 'on' },
    { mode: { toString: () => 'all' } },
    { subagentsRevision: -1 },
    { sessionRevision: 0.5 },
    { extra: true },
  ])
    assert.equal((await f.setMode('all', invalid)).ok, false)
  assert.equal(
    (
      await f.rpc('mode-set', {
        sessionId: 'fast-session',
        provider: 'openai-codex',
        model: 'gpt-6-sol',
        mode: 'all',
        sessionRevision: 0,
      })
    ).ok,
    false,
  )
  assert.equal((await f.setMode('all', { sessionId: 'child' })).ok, false)
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
  assert.equal(
    (
      await f.runtime.rpc(
        'mode-set',
        {
          sessionId: 'fast-session',
          provider: 'openai-codex',
          model: 'gpt-6-sol',
          mode: 'all',
          sessionRevision: 0,
          subagentsRevision: 0,
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
  assert.equal((await f.setSession(true)).ok, true)
  f.credential(async () => {
    throw new LlmError('fixture missing key', 'MISSING_CREDENTIAL')
  })
  const chunks = await consume(f.loop())
  const end = chunks.find((c) => c.type === 'finish')
  assert.equal(end.reason.kind, 'error')
  assert.equal(end.reason.failure.code, 'MISSING_CREDENTIAL')
  assert.equal(f.captures.length, 0)
})
