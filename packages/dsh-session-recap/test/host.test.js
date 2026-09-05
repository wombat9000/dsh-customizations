import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedHistory, LIMITS, normalizeSettings, parseRecap, RecapRuntime } from '../src/runtime.js'

const answer = { goal: 'Ship recap', outcome: 'Implemented host', nextStep: 'Test UI' }
const message = (text, role = 'user', kind = 'user') => ({ role, source: { kind }, content: [{ type: 'text', text }] })
function fixture({ chunks, prepareError, delay = 0, timeoutMs } = {}) {
  const session = { seq: 2, deriveMessages: () => [message('Please build recap'), message('Done', 'assistant', 'model')] }
  const config = { autoRecap: true, inactivityMinutes: 30, provider: 'existing', model: 'exact' }
  const calls = []
  const llm = { async prepareCall(options) {
    if (prepareError) throw prepareError
    return { config: options, inputModalities: ['text'], async *stream(request) {
      calls.push(request)
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      yield* chunks ?? [{ type: 'text-delta', text: JSON.stringify(answer) }, { type: 'finish', reason: { kind: 'stop' } }]
    } }
  } }
  return { session, config, calls, llm, runtime: new RecapRuntime({ sessions: { get: id => id === 's' ? session : undefined }, llm, settings: () => config, timeoutMs }) }
}

test('activity uses restored conversation event times, excludes metadata and injected messages', () => {
  const { runtime, session } = fixture()
  session.snapshotEvents = () => [
    { type: 'user/message', time: 100, data: { source: { kind: 'user' } } },
    { type: 'turn/start', time: 101 },
    { type: 'assistant/message', time: 200 },
    { type: 'turn/end', time: 201 },
    { type: 'session/title', time: 900 },
    { type: 'user/message', time: 999, data: { source: { kind: 'plugin' } } },
  ]
  assert.deepEqual(runtime.activity({ sessionId: 's' }), { ready: true, running: false, latestActivity: 201 })
  assert.equal(runtime.activity({ sessionId: 'missing' }).ready, false)
  session.snapshotEvents = () => []
  assert.equal(runtime.activity({ sessionId: 's' }).latestActivity, null)
})
test('open persisted turn prevents even manual generation before provider access', async () => {
  const { runtime, session, calls } = fixture()
  session.snapshotEvents = () => [{ type: 'turn/start', time: 100 }]
  assert.equal(runtime.activity({ sessionId: 's' }).running, true)
  await assert.rejects(runtime.recap({ sessionId: 's' }), { code: 'session-running' })
  assert.equal(calls.length, 0)
})
test('settings defaults and strict validation', () => {
  assert.deepEqual(normalizeSettings(), { autoRecap: true, inactivityMinutes: 30, provider: '', model: '' })
  for (const value of [0, -1, 1.1, Infinity, 10081, '30']) assert.throws(() => normalizeSettings({ inactivityMinutes: value }))
  assert.throws(() => normalizeSettings({ autoRecap: 'true' }))
  assert.throws(() => normalizeSettings({ provider: 'bad\nroute' }))
})
test('history excludes tools, reasoning, attachments and injected instructions', () => {
  const messages = [message('secret', 'system', 'plugin'), message('tool secret', 'user', 'tool'), message('injected', 'user', 'plugin'), { ...message('visible'), content: [{ type: 'reasoning', text: 'private' }, { type: 'image', attachment: 'secret' }, { type: 'tool-call', arguments: 'secret' }, { type: 'text', text: 'visible' }] }]
  assert.deepEqual(boundedHistory(messages), [{ role: 'user', text: 'visible' }])
})
test('history bounds source text bytes and scanned messages', () => {
  const rows = boundedHistory(Array.from({ length: 1000 }, (_, i) => message(`${i} ${'😀'.repeat(30000)}`)))
  assert.ok(rows.length <= LIMITS.messages)
  assert.ok(rows.reduce((n, row) => n + Buffer.byteLength(row.text), 0) <= LIMITS.inputBytes)
  assert.ok(rows.at(-1).text.startsWith('999 '))
})
test('strict recap shape and bounded fields', () => {
  assert.deepEqual(parseRecap(JSON.stringify(answer)), answer)
  for (const value of ['```json\n{}\n```', '{}', 'null', JSON.stringify({ ...answer, extra: true }), JSON.stringify({ ...answer, goal: '' }), JSON.stringify({ ...answer, nextStep: 'x'.repeat(1201) })]) assert.throws(() => parseRecap(value))
})
test('one-shot uses exact route, no tools, no historical metadata', async () => {
  const { runtime, calls } = fixture()
  const result = await runtime.recap({ sessionId: 's' })
  assert.deepEqual(result.recap, answer)
  assert.equal(result.revision, 2)
  assert.equal(calls[0].provider, 'existing')
  assert.equal(calls[0].model, 'exact')
  assert.deepEqual(calls[0].tools, [])
  assert.equal(calls[0].messages.length, 1)
  assert.equal(calls[0].sessionId, undefined)
})
test('deduplicates concurrent calls and caches exact revision/settings', async () => {
  const { runtime, calls, session, config } = fixture({ delay: 10 })
  const [a, b] = await Promise.all([runtime.recap({ sessionId: 's' }), runtime.recap({ sessionId: 's' })])
  assert.deepEqual(a, b)
  assert.equal(calls.length, 1)
  assert.equal((await runtime.recap({ sessionId: 's' })).cached, true)
  session.seq++
  await runtime.recap({ sessionId: 's' })
  config.inactivityMinutes++
  await runtime.recap({ sessionId: 's' })
  assert.equal(calls.length, 3)
})
test('no fallback; automatic disabled; unavailable and empty sessions', async () => {
  const { runtime, config, session, calls } = fixture()
  config.model = ''
  await assert.rejects(runtime.recap({ sessionId: 's' }), { code: 'not-configured' })
  config.model = 'exact'; config.autoRecap = false
  await assert.rejects(runtime.recap({ sessionId: 's', automatic: true }), { code: 'auto-disabled' })
  await assert.rejects(runtime.recap({ sessionId: 'missing' }), { code: 'session-unavailable' })
  await assert.rejects(runtime.recap({ sessionId: 's', automatic: 'yes' }), { code: 'invalid-request' })
  session.deriveMessages = () => []
  await assert.rejects(runtime.recap({ sessionId: 's' }), { code: 'empty-session' })
  assert.equal(calls.length, 0)
})
test('provider errors are sanitized and not cached', async () => {
  const { runtime } = fixture({ prepareError: new Error('Bearer SECRET') })
  await assert.rejects(runtime.recap({ sessionId: 's' }), error => error.code === 'generation-failed' && !error.message.includes('SECRET'))
  assert.equal(runtime.cache.size, 0)
  assert.equal(runtime.pending.size, 0)
})
test('rejects tools, truncated responses, malformed JSON, missing finish', async () => {
  for (const chunks of [[{ type: 'tool-call-delta' }], [{ type: 'finish', reason: { kind: 'max-tokens' } }], [{ type: 'text-delta', text: '{}' }, { type: 'finish', reason: { kind: 'stop' } }], [{ type: 'text-delta', text: JSON.stringify(answer) }]]) {
    const { runtime } = fixture({ chunks })
    await assert.rejects(runtime.recap({ sessionId: 's' }))
    assert.equal(runtime.cache.size, 0)
  }
})
test('timeout clears pending and disposal aborts requests', async () => {
  const { runtime } = fixture({ delay: 40, timeoutMs: 5 })
  await assert.rejects(runtime.recap({ sessionId: 's' }), { code: 'cancelled' })
  assert.equal(runtime.pending.size, 0)
  runtime.dispose()
  await assert.rejects(runtime.recap({ sessionId: 's' }), { code: 'unavailable' })
})
test('in-flight stale results never enter cache', async () => {
  const { runtime, session } = fixture({ delay: 10 })
  const promise = runtime.recap({ sessionId: 's' })
  session.seq++
  await assert.rejects(promise, { code: 'stale' })
  assert.equal(runtime.cache.size, 0)
})
test('JSON escaping cannot exceed transmitted input bound', () => {
  const rows = boundedHistory([message('\u0000'.repeat(100000))])
  assert.ok(Buffer.byteLength(JSON.stringify(rows)) <= LIMITS.inputBytes)
})
test('settings changes invalidate an in-flight response', async () => {
  const { runtime, config } = fixture({ delay: 10 })
  const promise = runtime.recap({ sessionId: 's' })
  config.model = 'changed'
  await assert.rejects(promise, { code: 'stale' })
  assert.equal(runtime.cache.size, 0)
})
test('cache size stays bounded across revisions', async () => {
  const { runtime, session } = fixture()
  for (let i = 0; i < LIMITS.cacheEntries + 3; i++) {
    session.seq++
    await runtime.recap({ sessionId: 's' })
  }
  assert.equal(runtime.cache.size, LIMITS.cacheEntries)
})
test('concurrent distinct revisions respect admission limit', async () => {
  const { runtime, session } = fixture({ delay: 10 })
  const pending = []
  for (let i = 0; i < LIMITS.concurrent; i++) {
    session.seq++
    pending.push(runtime.recap({ sessionId: 's' }).catch(error => error))
  }
  session.seq++
  await assert.rejects(runtime.recap({ sessionId: 's' }), { code: 'busy' })
  await Promise.all(pending)
  assert.equal(runtime.pending.size, 0)
})
test('oversized model output is never cached', async () => {
  const { runtime } = fixture({ chunks: [{ type: 'text-delta', text: 'x'.repeat(LIMITS.outputChars + 1) }] })
  await assert.rejects(runtime.recap({ sessionId: 's' }))
  assert.equal(runtime.cache.size, 0)
})
test('rejects redirected and non-text model routes', async () => {
  for (const prepared of [{ config: { provider: 'other', model: 'exact' } }, { config: { provider: 'existing', model: 'exact' }, inputModalities: ['image'] }]) {
    const { runtime, llm } = fixture()
    llm.prepareCall = async () => prepared
    await assert.rejects(runtime.recap({ sessionId: 's' }), { code: 'invalid-model' })
  }
})
