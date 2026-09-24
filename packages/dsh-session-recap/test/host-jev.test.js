import test from 'node:test'
import assert from 'node:assert/strict'
import { RecapRuntime } from '../src/runtime.js'
import { boundedHistory } from '../src/history.js'
import { CARD_LABELS } from '../src/cards.js'
const answers = (labels = ['direction']) => ({ answers: Object.fromEntries(CARD_LABELS.flatMap(label => [
  [`support_${label}`, { type: 'noul', noul: labels.includes(label) ? .9 : .1 }],
  [`usefulness_${label}`, { type: 'score', score: 2, confidence: .3 }],
])) })
const draft = { headline: 'Current direction', cards: { direction: 'Explore the available options.' } }
function fixture() {
  const session = { seq: 1, snapshotEvents: () => [], deriveMessages: () => Array.from({ length: 80 }, (_, i) => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `${i} ${'context '.repeat(300)}` }] })) }
  const settings = { provider: 'p', model: 'm', useJev: true }
  const calls = [], evaluations = [], order = []
  let model = 'typesafe/jev-1.13'
  const service = { settings: () => ({ model }), async evaluate(input) { evaluations.push(input); order.push('jev'); return answers() } }
  const state = { service, output: () => draft }
  const llm = { async prepareCall(config) { order.push('prepare'); return { config, async *stream(request) {
    order.push('write'); calls.push(request)
    const value = state.output(calls.length)
    yield { type: 'text-delta', text: typeof value === 'string' ? value : JSON.stringify(value) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } } }
  const runtime = new RecapRuntime({ sessions: { get: () => session }, llm, settings: () => settings, getJev: () => state.service, timeoutMs: 1000 })
  return { runtime, session, settings, calls, evaluations, order, service, state, setModel: value => { model = value } }
}
test('Jev runs first on the identical bounded excerpt; cards cache and in-flight requests deduplicate', async () => {
  const f = fixture()
  const [a, b] = await Promise.all([f.runtime.recap({ sessionId: 's' }), f.runtime.recap({ sessionId: 's' })])
  assert.deepEqual(a, b)
  assert.equal(a.selection.mode, 'jev')
  assert.equal(a.selection.diagnostics.status, 'evaluated')
  assert.deepEqual(a.recap, { headline: draft.headline, cards: [{ label: 'direction', text: draft.cards.direction }] })
  assert.deepEqual(f.order, ['jev', 'prepare', 'write'])
  assert.deepEqual(f.evaluations[0].state, { conversation: boundedHistory(f.session.deriveMessages()) })
  assert.deepEqual(JSON.parse(f.calls[0].messages[0].content[0].text), f.evaluations[0].state.conversation)
  assert.equal(f.calls[0].signal, f.evaluations[0].signal)
  assert.deepEqual(f.calls[0].tools, [])
  assert.equal(f.calls[0].responseFormat, undefined)
  assert.equal((await f.runtime.recap({ sessionId: 's' })).cached, true)
  assert.equal(f.evaluations.length, 1)
})
test('card length repair uses selected schema once; malformed shape never repairs', async () => {
  for (const value of [{ ...draft, headline: 'x'.repeat(121) }, { ...draft, cards: { direction: 'x'.repeat(181) } }]) {
    const f = fixture(); f.state.output = n => n === 1 ? value : draft
    await f.runtime.recap({ sessionId: 's' })
    assert.equal(f.calls.length, 2)
    assert.match(f.calls[1].system, /exactly these keys: \["direction"\]/)
    assert.equal(f.calls[1].signal, f.calls[0].signal)
  }
  const f = fixture(); f.state.output = () => ({ ...draft, cards: { direction: 'x'.repeat(181), unknown: 1 } })
  await assert.rejects(f.runtime.recap({ sessionId: 's' }), { reason: 'shape' })
  assert.equal(f.calls.length, 1)
  const g = fixture(); g.state.output = () => ({ ...draft, cards: { direction: 'x'.repeat(181) } })
  await assert.rejects(g.runtime.recap({ sessionId: 's' }), { reason: 'card-length' })
  assert.equal(g.calls.length, 2)
})
test('disabled, absent, getter errors, failed and no-label Jev fall back; enabled fallback never caches and recovers', async () => {
  for (const mode of ['disabled', 'absent', 'getter', 'failure', 'no-labels']) {
    const f = fixture(); f.state.output = () => ({ bullets: ['Legacy recap.'] })
    if (mode === 'disabled') f.settings.useJev = false
    if (mode === 'absent') f.state.service = undefined
    if (mode === 'getter') f.runtime.getJev = () => { throw Error('SECRET') }
    if (mode === 'failure') f.service.evaluate = async () => { throw Error('SECRET') }
    if (mode === 'no-labels') f.service.evaluate = async () => answers([])
    const result = await f.runtime.recap({ sessionId: 's' })
    const { diagnostics, ...selection } = result.selection
    assert.deepEqual(selection, { mode: 'standard', ...(mode === 'disabled' ? {} : { reason: mode === 'no-labels' ? mode : 'unavailable' }) })
    assert.equal(diagnostics?.status, mode === 'disabled' ? undefined : mode === 'no-labels' ? 'evaluated' : 'unavailable')
    assert.equal(f.calls.length, 1)
    assert.equal(f.runtime.cache.size, mode === 'disabled' ? 1 : 0)
    if (mode !== 'disabled') {
      f.runtime.getJev = () => f.service
      f.service.evaluate = async () => answers()
      f.state.output = () => draft
      assert.equal((await f.runtime.recap({ sessionId: 's' })).selection.mode, 'jev')
      assert.equal(f.calls.length, 2)
    } else assert.equal(f.evaluations.length, 0)
  }
})
test('cache keys include Jev model, provider instance, integration availability, and toggle', async () => {
  const f = fixture()
  await f.runtime.recap({ sessionId: 's' })
  f.setModel('typesafe/jev-2')
  assert.equal((await f.runtime.recap({ sessionId: 's' })).cached, false)
  f.state.service = { ...f.service }
  assert.equal((await f.runtime.recap({ sessionId: 's' })).cached, false)
  f.state.service = undefined; f.state.output = () => ({ bullets: ['Legacy'] })
  assert.equal((await f.runtime.recap({ sessionId: 's' })).selection.reason, 'unavailable')
  f.settings.useJev = false
  assert.deepEqual((await f.runtime.recap({ sessionId: 's' })).selection, { mode: 'standard' })
  assert.equal(f.calls.length, 5)
})
test('changes during Jev prevent fallback and all writer calls, including evaluator failure', async () => {
  for (const change of ['session', 'settings', 'model', 'instance', 'running', 'dispose', 'changed-error']) {
    for (const fail of [false, true]) {
      const f = fixture()
      f.service.evaluate = async () => {
        if (change === 'session') f.session.seq++
        if (change === 'settings') f.settings.model = 'new'
        if (change === 'model') f.setModel('typesafe/jev-2')
        if (change === 'instance') f.state.service = { ...f.service }
        if (change === 'running') f.session.snapshotEvents = () => [{ type: 'turn/start' }]
        if (change === 'dispose') f.runtime.dispose()
        if (change === 'changed-error') throw Object.assign(Error(), { code: 'changed' })
        if (fail) throw Error('SECRET')
        return answers()
      }
      await assert.rejects(f.runtime.recap({ sessionId: 's' }))
      assert.equal(f.calls.length, 0)
      assert.equal(f.runtime.cache.size, 0)
    }
  }
})
test('Jev shares overall timeout; late resolution cannot start a writer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture(); f.runtime.timeoutMs = 5
  let release, signal, evaluationStarted
  const started = new Promise(resolve => { evaluationStarted = resolve })
  f.service.evaluate = input => {
    signal = input.signal
    evaluationStarted()
    return new Promise(resolve => { release = resolve })
  }
  const rejected = assert.rejects(f.runtime.recap({ sessionId: 's' }), { code: 'cancelled' })
  await started
  t.mock.timers.tick(5)
  await rejected
  assert.equal(signal.aborted, true)
  release(answers())
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.order, [])
  assert.equal(f.runtime.pending.size, 0)
})
test('changes after draft prevent repair and final publication', async () => {
  for (const repair of [false, true]) {
    const f = fixture()
    f.state.output = () => { f.setModel('typesafe/jev-2'); return repair ? { ...draft, headline: 'x'.repeat(121) } : draft }
    await assert.rejects(f.runtime.recap({ sessionId: 's' }), { code: 'stale' })
    assert.equal(f.calls.length, 1)
    assert.equal(f.runtime.cache.size, 0)
  }
})
