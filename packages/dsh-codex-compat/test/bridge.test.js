import test from 'node:test'
import assert from 'node:assert/strict'
import { CodexFastBridge } from '../dist/src/fast/bridge.js'
import { inferenceFixture, request, consume, gate } from './inference-fixture.js'

function install(t, f, target = (options) => options.sessionId === 'fast-session') {
  const bridge = new CodexFastBridge(f.ctx.llm)
  bridge.enable()
  let live = true
  let reports = 0
  f.ctx.on('llm/stream', (options, next) =>
    bridge.stream(
      options,
      next,
      target(options)
        ? {
            live: () => live,
            report() {
              reports++
            },
          }
        : null,
    ),
  )
  t.after(() => bridge.disable())
  return {
    bridge,
    revoke() {
      live = false
    },
    reports: () => reports,
  }
}

test('real prepared adapter dispatch sets final priority only for the target session and preserves Standard', async (t) => {
  const f = await inferenceFixture(t)
  const originalDispatch = f.adapter.streamWithSnapshot
  const originalSimple = f.adapter.current().models.streamSimple
  const state = install(t, f)
  // A stream-only patch would fail this negative control: both routes use prepareCall.
  f.adapter.stream = () => {
    throw new Error('must not call adapter.stream')
  }
  const prepared = await f.ctx.llm.prepareCall({ provider: 'openai-codex', model: 'gpt-6-sol' })
  await consume(prepared.stream({ ...request(), ...prepared.config }))
  await consume(f.ctx.llm.stream(request('standard-session')))
  assert.equal(f.captures[0].body.service_tier, 'priority')
  assert.equal(f.captures[0].originalBody.service_tier, undefined)
  assert.equal(f.captures[0].options.sessionId, 'fast-session:dsh-codex-fast-v1')
  assert.equal(f.captures[0].options.maxRetries, 0)
  assert.equal(f.captures[0].options.apiKey, 'fixture-key-never-sent')
  assert.equal(f.captures[0].options.headers['x-fixture'], 'preserved')
  assert.ok(f.captures[0].options.signal instanceof AbortSignal)
  assert.equal(f.captures[1].body.service_tier, undefined)
  assert.equal(f.captures[1].options.sessionId, 'standard-session')
  assert.equal(state.reports(), 1)
  state.bridge.disable()
  assert.equal(f.adapter.streamWithSnapshot, originalDispatch)
  assert.equal(f.adapter.current().models.streamSimple, originalSimple)
  await consume(f.ctx.llm.stream(request()))
  assert.equal(f.captures.at(-1).body.service_tier, undefined)
})

test('captured snapshots and retired prepared adapters retain their original configuration', async (t) => {
  const f = await inferenceFixture(t)
  const state = install(t, f)
  const prepared = await f.ctx.llm.prepareCall({ provider: 'openai-codex', model: 'gpt-6-sol' })
  const old = f.adapter.current()
  f.replaceProfiles()
  const current = f.provider()
  assert.notEqual(current, old)
  await consume(prepared.stream({ ...request(), ...prepared.config }))
  assert.equal(f.captures.at(-1).body.service_tier, 'priority')
  const retired = await f.ctx.llm.prepareCall({ provider: 'openai-codex', model: 'gpt-6-sol' })
  f.registration()
  const replacement = f.makeAdapter()
  f.ctx.llm.registerAdapter(['openai-codex'], replacement)
  f.provider(replacement.current())
  state.bridge.enable()
  await consume(retired.stream({ ...request(), ...retired.config }))
  await consume(f.ctx.llm.stream(request()))
  assert.equal(f.captures.at(-2).body.service_tier, 'priority')
  assert.equal(f.captures.at(-1).body.service_tier, 'priority')
})

test('interleaved requests and nested excluded calls cannot inherit another session Fast scope', async (t) => {
  const f = await inferenceFixture(t)
  const hold = gate()
  const entered = gate()
  let nested = false
  f.provider(undefined, {
    async beforePayload() {
      if (!nested) {
        nested = true
        entered.resolve()
        await consume(f.ctx.llm.stream(request('standard-session')))
        await hold.promise
      }
    },
  })
  install(t, f)
  const fast = consume(f.ctx.llm.stream(request()))
  await entered.promise
  await consume(f.ctx.llm.stream(request('parallel-standard')))
  hold.resolve()
  await fast
  assert.equal(f.captures.filter((c) => c.body.service_tier === 'priority').length, 1)
  assert.equal(f.captures.filter((c) => c.body.service_tier === undefined).length, 2)
})

test('integration disable and re-enable revoke unsent callbacks from the old epoch', async (t) => {
  const f = await inferenceFixture(t)
  const hold = gate()
  const entered = gate()
  f.provider(undefined, {
    async beforePayload() {
      entered.resolve()
      await hold.promise
    },
  })
  const state = install(t, f)
  const running = consume(f.ctx.llm.stream(request()))
  await entered.promise
  state.bridge.disable()
  state.bridge.enable()
  hold.resolve()
  await running
  assert.equal(f.captures[0].body.service_tier, undefined)
  assert.equal(state.reports(), 0)
  await consume(f.ctx.llm.stream(request()))
  assert.equal(f.captures[1].body.service_tier, 'priority')
})

test('disable during credential resolution restores normal dispatch and cancellation preserves cleanup', async (t) => {
  const f = await inferenceFixture(t)
  const hold = gate()
  const entered = gate()
  f.credential(async () => {
    entered.resolve()
    await hold.promise
    return 'fixture-key-never-sent'
  })
  const state = install(t, f)
  const pending = consume(f.ctx.llm.stream(request()))
  await entered.promise
  state.bridge.disable()
  hold.resolve()
  await pending
  assert.equal(f.captures[0].body.service_tier, undefined)
  const controller = new AbortController()
  controller.abort()
  state.bridge.enable()
  const cancelled = await consume(
    f.ctx.llm.stream(request('fast-session', { signal: controller.signal })),
  )
  assert.equal(cancelled.find((chunk) => chunk.type === 'finish').reason.kind, 'aborted')
  assert.equal(state.reports(), 0)
})

test('disposal never clobbers a later wrapper; inactive retained wrappers are transparent', async (t) => {
  const f = await inferenceFixture(t)
  const state = install(t, f)
  const owned = f.adapter.streamWithSnapshot
  const foreign = function (...args) {
    return owned.apply(this, args)
  }
  f.adapter.streamWithSnapshot = foreign
  state.bridge.disable()
  assert.equal(f.adapter.streamWithSnapshot, foreign)
  await consume(f.ctx.llm.stream(request()))
  assert.equal(f.captures[0].body.service_tier, undefined)
})

test('adapters observed while off remain eligible after replacement and first enable', async (t) => {
  const f = await inferenceFixture(t)
  const bridge = new CodexFastBridge(f.ctx.llm)
  bridge.observe()
  const prepared = await f.ctx.llm.prepareCall({ provider: 'openai-codex', model: 'gpt-6-sol' })
  f.registration()
  const replacement = f.makeAdapter()
  f.ctx.llm.registerAdapter(['openai-codex'], replacement)
  f.provider(replacement.current())
  bridge.observe()
  bridge.enable()
  t.after(() => bridge.disable())
  f.ctx.on('llm/stream', (options, next) =>
    bridge.stream(options, next, { live: () => true, report() {} }),
  )
  await consume(prepared.stream({ ...request(), ...prepared.config }))
  assert.equal(f.captures[0].body.service_tier, 'priority')
})

test('manually configured GPT-6.1 Sol qualifies without modifying the native catalog', async (t) => {
  const f = await inferenceFixture(t, {
    models: [{ id: 'gpt-6.1-sol', contextWindow: 262144, maxTokens: 32768, input: ['text'] }],
  })
  const state = install(t, f)
  assert.equal(state.bridge.supports('openai-codex', 'gpt-6.1-sol'), true)
  await consume(f.ctx.llm.stream(request('fast-session', { model: 'gpt-6.1-sol' })))
  assert.equal(f.captures[0].body.service_tier, 'priority')
})
