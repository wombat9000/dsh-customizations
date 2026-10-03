import test from 'node:test'
import assert from 'node:assert/strict'
import { CodexFastBridge } from '../dist/src/bridge.js'
import { inferenceFixture, request, consume, gate } from './inference-fixture.js'

test('payload composition preserves existing callbacks and rechecks the effective adapter signal', async (t) => {
  const f = await inferenceFixture(t)
  const bridge = new CodexFastBridge(f.ctx.llm)
  bridge.enable()
  t.after(() => bridge.disable())
  // Admit one real call to instrument its actual Models collection.
  f.ctx.on('llm/stream', (options, next) =>
    bridge.stream(options, next, { live: () => true, report() {} }),
  )
  await consume(f.ctx.llm.stream(request()))
  const snapshot = f.adapter.current()
  const model = f.adapter.modelOf(snapshot, 'openai-codex', 'gpt-6-sol')
  const hold = gate(),
    entered = gate()
  const effective = new AbortController()
  let reports = 0
  const response = () => {}
  const options = {
    sessionId: 'fast-session',
    signal: effective.signal,
    onResponse: response,
    async onPayload(body) {
      entered.resolve()
      await hold.promise
      return { ...body, priorCallback: true }
    },
  }
  const downstream = async function* () {
    await consume(snapshot.models.streamSimple(model, { messages: [] }, options))
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const pending = consume(
    bridge.stream(request(), downstream, {
      live: () => true,
      report() {
        reports++
      },
    }),
  )
  await entered.promise
  const reason = new Error('synthetic adapter watchdog abort')
  effective.abort(reason)
  hold.resolve()
  await assert.rejects(pending, (error) => error === reason)
  assert.equal(reports, 0)
  assert.equal(options.onResponse, response)
  assert.equal(options.sessionId, 'fast-session', 'the caller-owned options remain unchanged')
  const clean = { ...options, signal: new AbortController().signal }
  await consume(
    bridge.stream(
      request(),
      async function* () {
        await consume(snapshot.models.streamSimple(model, { messages: [] }, clean))
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
      {
        live: () => true,
        report() {
          reports++
        },
      },
    ),
  )
  assert.equal(f.captures.at(-1).body.priorCallback, true)
  assert.equal(f.captures.at(-1).body.service_tier, 'priority')
  assert.equal(f.captures.at(-1).options.onResponse, response)
  assert.equal(reports, 1)
})

test('bridge shadows nested scope and forwards iterator return exactly on early consumption end', async (t) => {
  const f = await inferenceFixture(t)
  const bridge = new CodexFastBridge(f.ctx.llm)
  bridge.enable()
  t.after(() => bridge.disable())
  let closed = 0
  const stream = bridge.stream(
    request(),
    async function* () {
      try {
        yield { type: 'text', text: 'fixture' }
        yield { type: 'text', text: 'not-consumed' }
      } finally {
        closed++
      }
    },
    null,
  )
  for await (const _chunk of stream) break
  assert.equal(closed, 1)
})
