import test from 'node:test'
import assert from 'node:assert/strict'
import { RecapRuntime } from '../src/runtime.js'
import { LIMITS } from '../src/settings.js'

const answer = {
  bullets: [
    'Recaps should refresh your memory, not report task status.',
    'We settled on a few short bullets that disappear after you send a message.',
  ],
}
const message = (text, role = 'user', kind = 'user') => ({
  role,
  source: { kind },
  content: [{ type: 'text', text }],
})
function fixture({ chunks, prepareError, beforeStream, timeoutMs } = {}) {
  const session = {
    seq: 2,
    deriveMessages: () => [message('Please build recap'), message('Done', 'assistant', 'model')],
  }
  const config = { autoRecap: true, inactivityMinutes: 30, provider: 'existing', model: 'exact' }
  const calls = []
  const llm = {
    async prepareCall(options) {
      if (prepareError) throw prepareError
      return {
        config: options,
        inputModalities: ['text'],
        async *stream(request) {
          calls.push(request)
          if (beforeStream) await beforeStream(calls.length, request)
          yield* (typeof chunks === 'function' ? chunks(calls.length, request) : chunks) ?? [
            { type: 'text-delta', text: JSON.stringify(answer) },
            { type: 'finish', reason: { kind: 'stop' } },
          ]
        },
      }
    },
  }
  return {
    session,
    config,
    calls,
    llm,
    runtime: new RecapRuntime({
      sessions: { get: (id) => (id === 's' ? session : undefined) },
      llm,
      settings: () => config,
      timeoutMs,
    }),
  }
}
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const response = (bullets) => [
  { type: 'text-delta', text: JSON.stringify({ bullets }) },
  { type: 'finish', reason: { kind: 'stop' } },
]
test('generated headline survives cache and bounded shortening without losing bullets', async () => {
  const headline = 'Google Drive: shared-file picker and invoice export'
  const recap = { headline, ...answer }
  const { runtime, calls } = fixture({
    chunks: (n) => [
      {
        type: 'text-delta',
        text: JSON.stringify({ ...answer, headline: n === 1 ? 'x'.repeat(121) : headline }),
      },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  })
  assert.deepEqual((await runtime.recap({ sessionId: 's' })).recap, recap)
  assert.equal(calls.length, 2)
  assert.match(calls[1].system, /Keep an existing headline/)
  assert.deepEqual((await runtime.recap({ sessionId: 's' })).recap, recap)
  assert.equal(calls.length, 2)
})
test('accepts modest overruns without truncation or a repair call', async () => {
  const bullets = ['x'.repeat(320), 'y'.repeat(280)]
  const { runtime, calls } = fixture({ chunks: response(bullets) })
  assert.deepEqual((await runtime.recap({ sessionId: 's' })).recap.bullets, bullets)
  assert.equal(calls.length, 1)
})
test('oversized valid drafts get exactly one shortening call on the same route and signal', async () => {
  for (const draft of [['x'.repeat(321)], Array(3).fill('x'.repeat(201))]) {
    const { runtime, calls } = fixture({
      chunks: (n) => response(n === 1 ? draft : answer.bullets),
    })
    assert.deepEqual((await runtime.recap({ sessionId: 's' })).recap, answer)
    assert.equal(calls.length, 2)
    assert.equal(calls[1].provider, 'existing')
    assert.equal(calls[1].model, 'exact')
    assert.equal(calls[1].signal, calls[0].signal)
    assert.deepEqual(calls[1].tools, [])
    assert.match(calls[1].system, /untrusted recap draft/)
    assert.deepEqual(JSON.parse(calls[1].messages[0].content[0].text), { bullets: draft })
    assert.equal((await runtime.recap({ sessionId: 's' })).cached, true)
  }
})
test('failed repair is bounded, sanitized, and never cached', async () => {
  for (const second of [
    response(['SECRET'.repeat(100)]),
    response([null]),
    [{ type: 'tool-call-delta' }],
    [{ type: 'finish', reason: { kind: 'max-tokens' } }],
  ]) {
    const { runtime, calls } = fixture({
      chunks: (n) => (n === 1 ? response(['x'.repeat(321)]) : second),
    })
    await assert.rejects(
      runtime.recap({ sessionId: 's' }),
      (error) => !error.message.includes('SECRET'),
    )
    assert.equal(calls.length, 2)
    assert.equal(runtime.cache.size, 0)
    assert.equal(runtime.pending.size, 0)
  }
})
test('malformed drafts never trigger shortening and diagnostics reveal only metadata', async () => {
  for (const bullets of [['SECRET'.repeat(100), null], [], ['a', 'b', 'c', 'd'], ['\n ']]) {
    const { runtime, calls } = fixture({ chunks: response(bullets) })
    await assert.rejects(
      runtime.recap({ sessionId: 's' }),
      (error) => /reason=.*index=.*count=/.test(error.message) && !error.message.includes('SECRET'),
    )
    assert.equal(calls.length, 1)
  }
})
test('provider failure during repair is not retried or exposed', async () => {
  const { runtime, calls } = fixture({
    chunks: (n) => {
      if (n === 2) throw new Error('SECRET provider request')
      return response(['x'.repeat(321)])
    },
  })
  await assert.rejects(
    runtime.recap({ sessionId: 's' }),
    (error) => error.code === 'generation-failed' && !error.message.includes('SECRET'),
  )
  assert.equal(calls.length, 2)
})
test('repair shares the original timeout and rejects stale results', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const draftStarted = deferred(),
    repairStarted = deferred(),
    releaseDraft = deferred()
  const timed = fixture({
    timeoutMs: 50,
    beforeStream: (n, request) => {
      if (n === 1) {
        draftStarted.resolve()
        return releaseDraft.promise
      }
      repairStarted.resolve()
      return new Promise((resolve) =>
        request.signal.addEventListener('abort', resolve, { once: true }),
      )
    },
    chunks: (n) => response(n === 1 ? ['x'.repeat(321)] : answer.bullets),
  })
  const rejected = assert.rejects(timed.runtime.recap({ sessionId: 's' }), { code: 'cancelled' })
  await draftStarted.promise
  t.mock.timers.tick(30)
  releaseDraft.resolve()
  await repairStarted.promise
  assert.equal(timed.calls[1].signal.aborted, false)
  // The repair gets only the remaining 20ms, not a fresh timeout.
  t.mock.timers.tick(20)
  await rejected
  assert.equal(timed.calls.length, 2)
  assert.equal(timed.calls[1].signal.aborted, true)
  assert.equal(timed.runtime.cache.size, 0)
  const stale = fixture({
    chunks: (n) => {
      if (n === 2) stale.session.seq++
      return response(n === 1 ? ['x'.repeat(321)] : answer.bullets)
    },
  })
  await assert.rejects(stale.runtime.recap({ sessionId: 's' }), { code: 'stale' })
  assert.equal(stale.runtime.cache.size, 0)
})

test('output limit aborts promptly even when iterator cleanup waits for cancellation', async () => {
  let cleaned = false
  const { runtime, calls } = fixture({
    timeoutMs: 10_000,
    chunks: async function* (_, request) {
      const aborted = new Promise((resolve) =>
        request.signal.addEventListener('abort', resolve, { once: true }),
      )
      try {
        yield { type: 'text-delta', text: 'x'.repeat(LIMITS.outputChars + 1) }
      } finally {
        await aborted
        cleaned = true
      }
    },
  })
  // Immediate abort can let the cancellation side of Promise.race win.
  const rejected = assert.rejects(
    runtime.recap({ sessionId: 's' }),
    (error) => error.code === 'cancelled' || error.reason === 'output-limit',
  )
  try {
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls[0].signal.aborted, true)
    assert.equal(cleaned, true)
    assert.equal(runtime.pending.size, 0)
    assert.equal(runtime.controllers.size, 0)
    assert.equal(runtime.cache.size, 0)
    assert.equal(calls.length, 1)
  } finally {
    runtime.dispose()
    await rejected
  }
})

test('dispose during repair cancels its stream and clears pending work without caching', async () => {
  let repairStarted
  const started = new Promise((resolve) => {
    repairStarted = resolve
  })
  let cleaned = false
  const { runtime, calls } = fixture({
    chunks: async function* (n, request) {
      if (n === 1) {
        yield* response(['x'.repeat(321)])
        return
      }
      const aborted = new Promise((resolve) =>
        request.signal.addEventListener('abort', resolve, { once: true }),
      )
      repairStarted()
      try {
        await aborted
      } finally {
        cleaned = true
      }
    },
  })
  const rejected = assert.rejects(runtime.recap({ sessionId: 's' }), { code: 'cancelled' })
  await started
  runtime.dispose()
  await rejected
  assert.equal(calls.length, 2)
  assert.equal(calls[1].signal.aborted, true)
  assert.equal(cleaned, true)
  assert.equal(runtime.pending.size, 0)
  assert.equal(runtime.controllers.size, 0)
  assert.equal(runtime.cache.size, 0)
})

test('session becoming running after the draft prevents the repair call', async () => {
  const { runtime, session, calls } = fixture({
    chunks: function* () {
      yield* response(['x'.repeat(321)])
      session.snapshotEvents = () => [{ type: 'turn/start', time: 100 }]
    },
  })
  session.snapshotEvents = () => []
  await assert.rejects(runtime.recap({ sessionId: 's' }), { code: 'session-running' })
  assert.equal(calls.length, 1)
  assert.equal(runtime.pending.size, 0)
  assert.equal(runtime.cache.size, 0)
})

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
  assert.deepEqual(runtime.activity({ sessionId: 's' }), {
    ready: true,
    running: false,
    latestActivity: 201,
  })
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
  assert.match(calls[0].system, /40–70 words across the bullets/u)
  assert.match(calls[0].system, /6–12 words/u)
  assert.match(calls[0].system, /topic \+ outcome or direction phrase, not a full sentence/u)
  assert.match(calls[0].system, /especially user corrections/u)
  assert.match(calls[0].system, /Do not invent a next step/u)
  assert.match(calls[0].system, /untrusted data/u)
  assert.deepEqual(JSON.parse(calls[0].messages[0].content[0].text), [
    { role: 'user', text: 'Please build recap' },
    { role: 'assistant', text: 'Done' },
  ])
})
test('deduplicates concurrent calls and caches exact revision/settings', async () => {
  const started = deferred(),
    release = deferred()
  const { runtime, calls, session, config } = fixture({
    beforeStream: () => {
      started.resolve()
      return release.promise
    },
  })
  const first = runtime.recap({ sessionId: 's' })
  await started.promise
  const second = runtime.recap({ sessionId: 's' })
  assert.equal(calls.length, 1)
  release.resolve()
  const [a, b] = await Promise.all([first, second])
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
  config.model = 'exact'
  config.autoRecap = false
  await assert.rejects(runtime.recap({ sessionId: 's', automatic: true }), {
    code: 'auto-disabled',
  })
  await assert.rejects(runtime.recap({ sessionId: 'missing' }), { code: 'session-unavailable' })
  await assert.rejects(runtime.recap({ sessionId: 's', automatic: 'yes' }), {
    code: 'invalid-request',
  })
  session.deriveMessages = () => []
  await assert.rejects(runtime.recap({ sessionId: 's' }), { code: 'empty-session' })
  assert.equal(calls.length, 0)
})
test('provider errors are sanitized and not cached', async () => {
  const { runtime } = fixture({ prepareError: new Error('Bearer SECRET') })
  await assert.rejects(
    runtime.recap({ sessionId: 's' }),
    (error) => error.code === 'generation-failed' && !error.message.includes('SECRET'),
  )
  assert.equal(runtime.cache.size, 0)
  assert.equal(runtime.pending.size, 0)
})
test('rejects tools, truncated responses, malformed JSON, missing finish', async () => {
  for (const chunks of [
    [{ type: 'tool-call-delta' }],
    [{ type: 'finish', reason: { kind: 'max-tokens' } }],
    [
      { type: 'text-delta', text: '{}' },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
    [{ type: 'text-delta', text: JSON.stringify(answer) }],
  ]) {
    const { runtime } = fixture({ chunks })
    await assert.rejects(runtime.recap({ sessionId: 's' }))
    assert.equal(runtime.cache.size, 0)
  }
})
test('timeout clears pending and disposal aborts requests', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const started = deferred()
  const { runtime, calls } = fixture({
    timeoutMs: 5,
    beforeStream: (_, request) => {
      started.resolve()
      return new Promise((resolve) =>
        request.signal.addEventListener('abort', resolve, { once: true }),
      )
    },
  })
  const rejected = assert.rejects(runtime.recap({ sessionId: 's' }), { code: 'cancelled' })
  await started.promise
  t.mock.timers.tick(5)
  await rejected
  assert.equal(calls[0].signal.aborted, true)
  assert.equal(runtime.pending.size, 0)
  runtime.dispose()
  await assert.rejects(runtime.recap({ sessionId: 's' }), { code: 'unavailable' })
})
test('in-flight stale results never enter cache', async () => {
  const started = deferred(),
    release = deferred()
  const { runtime, session } = fixture({
    beforeStream: () => {
      started.resolve()
      return release.promise
    },
  })
  const promise = runtime.recap({ sessionId: 's' })
  await started.promise
  session.seq++
  release.resolve()
  await assert.rejects(promise, { code: 'stale' })
  assert.equal(runtime.cache.size, 0)
})
test('settings changes invalidate an in-flight response', async () => {
  const started = deferred(),
    release = deferred()
  const { runtime, config } = fixture({
    beforeStream: () => {
      started.resolve()
      return release.promise
    },
  })
  const promise = runtime.recap({ sessionId: 's' })
  await started.promise
  config.model = 'changed'
  release.resolve()
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
  const release = deferred()
  const { runtime, session } = fixture({ beforeStream: () => release.promise })
  const pending = []
  for (let i = 0; i < LIMITS.concurrent; i++) {
    session.seq++
    pending.push(runtime.recap({ sessionId: 's' }).catch((error) => error))
  }
  session.seq++
  await assert.rejects(runtime.recap({ sessionId: 's' }), { code: 'busy' })
  release.resolve()
  await Promise.all(pending)
  assert.equal(runtime.pending.size, 0)
})
test('oversized model output is never cached', async () => {
  const { runtime } = fixture({
    chunks: [{ type: 'text-delta', text: 'x'.repeat(LIMITS.outputChars + 1) }],
  })
  await assert.rejects(runtime.recap({ sessionId: 's' }))
  assert.equal(runtime.cache.size, 0)
})
test('rejects redirected and non-text model routes', async () => {
  for (const prepared of [
    { config: { provider: 'other', model: 'exact' } },
    { config: { provider: 'existing', model: 'exact' }, inputModalities: ['image'] },
  ]) {
    const { runtime, llm } = fixture()
    llm.prepareCall = async () => prepared
    await assert.rejects(runtime.recap({ sessionId: 's' }), { code: 'invalid-model' })
  }
})
