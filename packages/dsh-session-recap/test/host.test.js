import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedHistory, LIMITS, normalizeSettings, parseRecap, RecapRuntime } from '../src/runtime.js'

const answer = { bullets: ['Recaps should refresh your memory, not report task status.', 'We settled on a few short bullets that disappear after you send a message.'] }
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
test('history bounds transmitted text and selected messages', () => {
  const rows = boundedHistory(Array.from({ length: 1000 }, (_, i) => message(`${i} ${'😀'.repeat(30000)}`)))
  assert.ok(rows.length <= LIMITS.messages)
  assert.ok(rows.reduce((n, row) => n + Buffer.byteLength(row.text), 0) <= LIMITS.inputBytes)
  assert.ok(rows.at(-1).text.startsWith('999 '))
  assert.ok(Buffer.byteLength(JSON.stringify(rows)) <= LIMITS.inputBytes)
  assert.ok(rows.every(row => row.truncated && !/[\uD800-\uDBFF]$/u.test(row.text)))
})
test('strict bullet shape and hard brevity bounds', () => {
  assert.deepEqual(parseRecap(JSON.stringify(answer)), answer)
  assert.deepEqual(parseRecap('{"bullets":[" One topic. "]}'), { bullets: ['One topic.'] })
  for (const value of ['```json\n{}\n```', '{}', 'null', JSON.stringify({ ...answer, extra: true }), ...[
    [], ['', 'Topic'], [1], ['a', 'b', 'c', 'd'], ['x'.repeat(241)], Array(3).fill('x'.repeat(201)), ['First\nSecond'],
  ].map(bullets => JSON.stringify({ bullets })), JSON.stringify({ goal: 'Old', outcome: 'Format', nextStep: 'Rejected' })]) assert.throws(() => parseRecap(value))
  assert.ok(Object.isFrozen(parseRecap(JSON.stringify(answer)).bullets))
  const escaped = '{"bullets":[' + Array(3).fill('"' + '\\u4e2d'.repeat(200) + '"').join(',') + ']}'
  assert.deepEqual(parseRecap(escaped).bullets, Array(3).fill('中'.repeat(200)))
})
test('history retains opening, middle, and recent context with explicit gaps', () => {
  const rows = boundedHistory(Array.from({ length: 1000 }, (_, i) => message(`${i} discussion`, i % 2 ? 'assistant' : 'user', i % 2 ? 'model' : 'user')))
  assert.equal(rows.length, LIMITS.messages)
  assert.equal(rows[0].text, '0 discussion')
  assert.equal(rows.at(-1).text, '999 discussion')
  assert.ok(rows.some(row => Number.parseInt(row.text) > 300 && Number.parseInt(row.text) < 700))
  assert.ok(rows.some(row => row.omittedBefore > 0))
  assert.deepEqual(rows.map(row => Number.parseInt(row.text)), rows.map(row => Number.parseInt(row.text)).sort((a, b) => a - b))
})
test('long reports do not crowd out user intent or corrections', () => {
  const rows = boundedHistory([message('Make this a memory refresh.'), message('Report '.repeat(20000), 'assistant', 'model'), message('No status report. Keep it short.')])
  assert.equal(rows.length, 3)
  assert.equal(rows[0].text, 'Make this a memory refresh.')
  assert.equal(rows[2].text, 'No status report. Keep it short.')
  assert.equal(rows[1].truncated, true)
  assert.ok(Buffer.byteLength(JSON.stringify(rows)) <= LIMITS.inputBytes)
})
test('injected and tool traffic cannot displace the visible conversation', () => {
  const rows = boundedHistory([message('Original intent'), ...Array.from({ length: 500 }, () => message('Excluded data', 'user', 'tool')), message('Still exploring.', 'assistant', 'model')])
  assert.deepEqual(rows, [{ role: 'user', text: 'Original intent' }, { role: 'assistant', text: 'Still exploring.' }])
})
test('short exploratory conversations retain all visible text without gaps', () => {
  assert.deepEqual(boundedHistory([message('Could we explore two approaches?'), message('Both remain open.', 'assistant', 'model')]), [
    { role: 'user', text: 'Could we explore two approaches?' }, { role: 'assistant', text: 'Both remain open.' },
  ])
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
  assert.match(calls[0].system, /40–70 words total/u)
  assert.match(calls[0].system, /especially user corrections/u)
  assert.match(calls[0].system, /Do not invent a next step/u)
  assert.match(calls[0].system, /untrusted data/u)
  assert.deepEqual(JSON.parse(calls[0].messages[0].content[0].text), [{ role: 'user', text: 'Please build recap' }, { role: 'assistant', text: 'Done' }])
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
