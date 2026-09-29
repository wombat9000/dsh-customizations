import test from 'node:test'
import assert from 'node:assert/strict'
import { createJevRuntime, DEFAULT_MODEL, ENDPOINT, CHANNEL } from '../src/runtime.js'
import * as plugin from '../src/index.js'
import { profileFixture } from '../../dsh-google-auth/test/profile-fixture.js'

const input = () => ({
  state: { ready: true },
  questions: { ready: { type: 'noul', instructions: 'Is it ready?' } },
})
const answer = () => ({
  model: 'typesafe/jev-1.13-20260917',
  answers: { ready: { type: 'noul', noul: 0.8 } },
  usage: { input_tokens: 10, output_tokens: 4, cost: 0.001 },
})
const response = (value) => new Response(JSON.stringify(value))
const never = () => new Promise(() => {})
const deferred = () => {
  let resolve, reject
  const promise = new Promise((r, j) => {
    resolve = r
    reject = j
  })
  return { promise, resolve, reject }
}
const flush = () => new Promise(setImmediate)
function queuedFixture(t, overrides = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const f = fixture({
    fetch: (_, init) => {
      const done = deferred()
      calls.push({ ...done, signal: init.signal, state: JSON.parse(init.body).state })
      return done.promise
    },
    ...overrides,
  })
  t.after(() => f.dispose())
  return { ...f, calls }
}
function fixture(overrides = {}) {
  let config = { model: DEFAULT_MODEL },
    fetches = [],
    resolutions = 0
  const settings = {
    get: () => config,
    update: async (_, next) => {
      config = next
    },
  }
  const openrouter = {
    resolveApiKey: async () => {
      resolutions++
      return 'private-key'
    },
    status: async () => ({
      configured: true,
      writable: true,
      source: 'record',
      secret: 'private-key',
    }),
  }
  const runtime = createJevRuntime({
    getModel: () => settings.get().model,
    saveModel: (model) => settings.update('fixture', { model }),
    openrouter,
    fetch: async (...args) => {
      fetches.push(args)
      return response(answer())
    },
    ...overrides,
  })
  return { ...runtime, fetches, settings, openrouter, resolutions: () => resolutions }
}
const rejects = (promise, code) =>
  assert.rejects(
    promise,
    (e) =>
      e.code === code &&
      e.message &&
      !e.message.includes('private-key') &&
      Object.keys(e.details).length === 0,
  )

test('fixed host endpoint, native fetch request, sanitized canonical response', async () => {
  const f = fixture()
  const result = await f.service.evaluate(input())
  assert.equal(result.model, answer().model)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), answer())
  const [url, init] = f.fetches[0]
  assert.equal(url, ENDPOINT)
  assert.equal(init.method, 'POST')
  assert.equal(init.redirect, 'error')
  assert.equal(init.headers.Authorization, 'Bearer private-key')
  assert.equal(init.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(init.body), { model: DEFAULT_MODEL, ...input() })
  assert.equal(f.resolutions(), 1)
})

test('status and configure do not resolve key or fetch; model settings are dynamic', async () => {
  const f = fixture()
  assert.deepEqual(f.service.settings(), { model: DEFAULT_MODEL })
  const s = await f.service.status()
  assert.equal(s.available, true)
  assert.equal(s.credential.secret, undefined)
  const configured = await f.rpc('configure', { model: '~typesafe/jev-latest' })
  assert.equal(configured.ok, true)
  assert.equal(configured.value.model, '~typesafe/jev-latest')
  assert.equal(configured.value.available, true)
  assert.equal(f.resolutions(), 0)
  assert.equal(f.fetches.length, 0)
  await f.service.evaluate(input())
  assert.equal(JSON.parse(f.fetches[0][1].body).model, '~typesafe/jev-latest')
})

test('RPC accepts only status/configure and always returns complete sanitized errors', async () => {
  const f = fixture()
  for (const [method, payload] of [
    ['evaluate', input()],
    ['settings', {}],
    ['configure', {}],
    ['configure', { model: DEFAULT_MODEL, state: 'oops' }],
    ['configure', { model: 'other/model' }],
    ['configure', { model: 'typesafe/jev-../x' }],
    ['configure', { model: 'typesafe/jev-' + 'x'.repeat(129) }],
  ]) {
    const result = await f.rpc(method, payload)
    assert.equal(result.ok, false)
    assert.deepEqual(Object.keys(result.error).sort(), ['code', 'details', 'message'])
  }
  f.settings.update = async () => {
    throw new Error('private-key')
  }
  assert.deepEqual((await f.rpc('configure', { model: DEFAULT_MODEL })).error, {
    code: 'settings',
    message: 'Jev settings are unavailable.',
    details: {},
  })
})

test('real Loader Config is live and RPC saves the owning row without remounting', async (t) => {
  let registered,
    disposed = false
  const f = fixture()
  const { ctx } = await profileFixture(t, {
    rows: [{ id: 'custom-jev-row', name: 'cordis:jev' }],
    builtins: { jev: plugin },
    setup(ctx) {
      ctx.provide('openrouter', f.openrouter)
      ctx.provide('webServer', {})
      ctx.provide('connection', {
        rpc: {
          handle(...args) {
            registered = args
            return () => {
              disposed = true
            }
          },
        },
      })
    },
  })
  const fiber = ctx.loader.resolve('include:custom-jev-row').fiber
  const service = ctx.get('jev')
  const descriptor = ctx.settings.describe().find((row) => row.ns === 'custom-jev-row')
  assert.equal(descriptor.autoGenerate, false)
  assert.deepEqual(descriptor.value, { model: DEFAULT_MODEL })
  assert.deepEqual(Object.keys(service).sort(), ['evaluate', 'settings', 'status'])
  assert.equal(registered[0], CHANNEL)
  assert.deepEqual(registered[2], { authority: 'trusted-host' })
  assert.equal((await registered[1]('configure', { model: 'typesafe/jev-2' })).ok, true)
  assert.equal(service.settings().model, 'typesafe/jev-2')
  assert.equal(ctx.loader.resolve('include:custom-jev-row').fiber, fiber)
  const credentialRead = deferred()
  f.openrouter.resolveApiKey = () => credentialRead.promise
  const pending = service.evaluate(input())
  const cancelled = rejects(pending, 'changed')
  await ctx.settings.update('custom-jev-row', { model: DEFAULT_MODEL })
  await cancelled
  credentialRead.resolve('private-key')
  assert.equal(service.settings().model, DEFAULT_MODEL)
  assert.equal(ctx.get('jev'), service)
  await assert.rejects(ctx.settings.update('jev', { model: DEFAULT_MODEL }), /No configurable/)
  const settingsEntry = ctx.loader.resolve('include:settings')
  await settingsEntry.update({ disabled: true })
  await ctx.loader.await()
  assert.equal(ctx.get('settings'), undefined)
  assert.equal(ctx.get('jev'), service, 'business service survives absent optional Settings')
  assert.equal(service.settings().model, DEFAULT_MODEL)
  assert.equal((await registered[1]('configure', { model: DEFAULT_MODEL })).error.code, 'settings')
  await settingsEntry.update({ disabled: false })
  await ctx.loader.await()
  assert.equal(
    ctx.settings.describe().find((row) => row.ns === 'custom-jev-row').autoGenerate,
    false,
  )
  assert.equal(ctx.get('jev'), service, 'replacement Settings reattaches the page policy only')
  await fiber.dispose()
  assert.equal(disposed, true)
  assert.equal((await registered[1]('status')).ok, false)
})

test('all documented question kinds validate and unknown response fields are dropped', async () => {
  const data = {
    state: [],
    questions: {
      n: { type: 'noul', instructions: 'n', criteria: { true: 'yes', false: 'no' } },
      c: { type: 'choice', instructions: 'c', criteria: { a: 'one', b: 'two' } },
      s: { type: 'score', instructions: 's', criteria: ['low', 'high'] },
    },
  }
  const raw = {
    model: DEFAULT_MODEL,
    private: 'private-key',
    answers: {
      n: { type: 'noul', noul: 0 },
      c: {
        type: 'choice',
        choice: 'a',
        confidence: 0.5,
        probabilities: { a: 0.5, b: 0.5 },
        secret: 'private-key',
      },
      s: {
        type: 'score',
        score: 0.7,
        confidence: 0.5,
        probabilities: { 0: 0.3, 1: 0.7 },
        legend: { 0: 'low', 1: 'high' },
      },
    },
    usage: { cost: 0, raw: 'private-key' },
  }
  const f = fixture({ fetch: async () => response(raw) })
  const result = await f.service.evaluate(data)
  assert.equal(result.answers.s.score, 0.7)
  assert.ok(!JSON.stringify(result).includes('private-key'))
  for (const change of [
    (v) => {
      v.answers.c.choice = 'z'
    },
    (v) => {
      v.answers.c.confidence = 2
    },
    (v) => {
      v.answers.c.probabilities.a = 0.1
    },
    (v) => {
      delete v.answers.c.probabilities.b
    },
    (v) => {
      v.answers.c.probabilities.b = -0.2
    },
    (v) => {
      v.answers.s.score = 2
    },
    (v) => {
      v.answers.s.legend[0] = 'wrong'
    },
    (v) => {
      v.answers.s.probabilities.extra = 0
    },
  ]) {
    const bad = structuredClone(raw)
    change(bad)
    await rejects(fixture({ fetch: async () => response(bad) }).service.evaluate(data), 'response')
  }
})

test('invalid requests are rejected before credentials or dispatch', async () => {
  const invalid = [
    undefined,
    null,
    NaN,
    Infinity,
    true,
    1,
    () => {},
    new Date(),
    { nested: undefined },
    { nested: 1n },
    new Array(2),
  ]
  const cycle = {}
  cycle.self = cycle
  invalid.push(cycle)
  const accessor = {}
  Object.defineProperty(accessor, 'x', {
    enumerable: true,
    get() {
      throw new Error('private-key')
    },
  })
  invalid.push(accessor)
  const symbol = { [Symbol('x')]: 1 }
  invalid.push(symbol)
  for (const state of invalid) {
    const f = fixture()
    await rejects(f.service.evaluate({ ...input(), state }), 'invalid')
    assert.equal(f.resolutions(), 0)
  }
  const badQuestions = [
    {},
    [],
    Object.fromEntries(Array.from({ length: 33 }, (_, i) => [i, input().questions.ready])),
    { q: { type: 'noul', instructions: '' } },
    { q: { type: 'noul', instructions: 'x'.repeat(8193) } },
    { q: { type: 'noul', instructions: 'x', criteria: { true: 'yes' } } },
    { q: { type: 'choice', instructions: 'x', criteria: {} } },
    { q: { type: 'score', instructions: 'x', criteria: Array(33).fill('x') } },
    { q: { type: 'unknown', instructions: 'x' } },
    { q: { type: 'noul', instructions: 'x', extra: 1 } },
  ]
  for (const questions of badQuestions)
    await rejects(fixture().service.evaluate({ state: '', questions }), 'invalid')
  for (const state of ['x'.repeat(262144), '\u0000'.repeat(44000), '😀'.repeat(65536)]) {
    const f = fixture()
    await rejects(f.service.evaluate({ ...input(), state }), 'invalid')
    assert.equal(f.resolutions(), 0)
    assert.equal(f.fetches.length, 0)
  }
})

test('requests larger than 64 KiB reach mocked fetch', async () => {
  const f = fixture()
  const state = 'x'.repeat(96 * 1024)
  await f.service.evaluate({ ...input(), state })
  assert.ok(Buffer.byteLength(f.fetches[0][1].body) > 65536)
  assert.equal(JSON.parse(f.fetches[0][1].body).state, state)
  assert.equal(f.resolutions(), 1)
})

test('encoded request cap counts escaped and multibyte bytes at the exact boundary', async () => {
  const cap = 262144
  const overhead = Buffer.byteLength(
    JSON.stringify({ model: DEFAULT_MODEL, ...input(), state: '' }),
  )
  for (const prefix of ['', '\u0000'.repeat(40000), '😀'.repeat(60000)]) {
    const encodedPrefixBytes = Buffer.byteLength(JSON.stringify(prefix)) - 2
    const state = prefix + 'x'.repeat(cap - overhead - encodedPrefixBytes)
    const data = { ...input(), state }
    assert.equal(Buffer.byteLength(JSON.stringify({ model: DEFAULT_MODEL, ...data })), cap)
    const accepted = fixture()
    await accepted.service.evaluate(data)
    assert.equal(Buffer.byteLength(accepted.fetches[0][1].body), cap)
    assert.equal(JSON.parse(accepted.fetches[0][1].body).state, state)
    assert.equal(accepted.resolutions(), 1)

    const rejected = fixture()
    const oversized = { ...data, state: state + 'x' }
    assert.equal(Buffer.byteLength(JSON.stringify({ model: DEFAULT_MODEL, ...oversized })), cap + 1)
    await rejects(rejected.service.evaluate(oversized), 'invalid')
    assert.equal(rejected.resolutions(), 0)
    assert.equal(rejected.fetches.length, 0)
  }
})

test('traversal retains its independent 65536-node bound', async (t) => {
  // Isolate traversal: conservative snapshot accounting otherwise hits the byte cap first.
  t.mock.method(Buffer, 'byteLength', () => 0)
  const accepted = fixture()
  // Root, state, questions, ready, type and instructions account for six nodes.
  await accepted.service.evaluate({ ...input(), state: Array(65536 - 6).fill('') })
  assert.equal(accepted.fetches.length, 1)
  const rejected = fixture()
  await rejects(
    rejected.service.evaluate({ ...input(), state: Array(65536 - 5).fill('') }),
    'invalid',
  )
  assert.equal(rejected.resolutions(), 0)
  assert.equal(rejected.fetches.length, 0)
})

test('missing/locked credentials fail closed, status is unavailable without errors leaking', async () => {
  for (const resolveApiKey of [
    async () => undefined,
    async () => {
      throw new Error('private-key')
    },
  ]) {
    const f = fixture({
      openrouter: {
        resolveApiKey,
        status: async () => ({ configured: true, error: 'private-key' }),
      },
    })
    await rejects(f.service.evaluate(input()), 'credential')
    assert.equal(f.fetches.length, 0)
    assert.equal((await f.service.status()).available, false)
    assert.ok(!JSON.stringify(await f.service.status()).includes('private-key'))
  }
  const f = fixture()
  f.dispose()
  assert.equal((await f.service.status()).available, false)
})

test('HTTP, redirect, raw backend errors, empty and malformed bodies are sanitized', async () => {
  for (const fetch of [
    async () => {
      throw new Error('private-key')
    },
    async () => new Response('', { status: 500 }),
    async () => new Response('private-key', { status: 302 }),
    async () => ({ ok: true, redirected: true }),
    async () => ({ ok: true, url: 'https://evil.example' }),
  ])
    await rejects(fixture({ fetch }).service.evaluate(input()), 'network')
  for (const body of ['', 'private-key', '{}', 'null'])
    await rejects(
      fixture({ fetch: async () => new Response(body) }).service.evaluate(input()),
      'response',
    )
})

test('requested answer keys, types, bounds and returned model are mandatory', async () => {
  for (const change of [
    (r) => {
      delete r.model
    },
    (r) => {
      r.model = 'other/model'
    },
    (r) => {
      r.model = 'typesafe/jev-2'
    },
    (r) => {
      r.model = '~typesafe/jev-latest'
    },
    (r) => {
      delete r.answers.ready
    },
    (r) => {
      r.answers.extra = { type: 'noul', noul: 1 }
    },
    (r) => {
      r.answers.ready.type = 'choice'
    },
    (r) => {
      r.answers.ready.noul = 2
    },
    (r) => {
      r.answers.ready.noul = null
    },
    (r) => {
      r.usage.cost = -1
    },
  ]) {
    const raw = answer()
    change(raw)
    await rejects(
      fixture({ fetch: async () => response(raw) }).service.evaluate(input()),
      'response',
    )
  }
})

test('response cap counts stream bytes without calling json, and cancels oversized reads', async () => {
  let cancelled = false
  const body = new ReadableStream({
    pull(c) {
      c.enqueue(new Uint8Array(32769))
    },
    cancel() {
      cancelled = true
    },
  })
  await rejects(
    fixture({
      fetch: async () => ({
        ok: true,
        body,
        json() {
          throw new Error('must not call')
        },
      }),
    }).service.evaluate(input()),
    'response',
  )
  assert.equal(cancelled, true)
  await rejects(
    fixture({
      fetch: async () => new Response('', { headers: { 'content-length': '65537' } }),
    }).service.evaluate(input()),
    'response',
  )
})

test('valid JSON responses remain bounded at 64 KiB rather than the request cap', async () => {
  const base = { ...answer(), padding: '' }
  const overhead = Buffer.byteLength(JSON.stringify(base))
  for (const bytes of [65536, 65537]) {
    const raw = { ...base, padding: 'x'.repeat(bytes - overhead) }
    assert.equal(Buffer.byteLength(JSON.stringify(raw)), bytes)
    const f = fixture({ fetch: async () => response(raw) })
    if (bytes === 65536) {
      const result = await f.service.evaluate(input())
      assert.deepEqual(JSON.parse(JSON.stringify(result)), answer())
    } else await rejects(f.service.evaluate(input()), 'response')
  }
})

test('total deadline covers credentials, fetch and stalled stream adapters ignoring signals', async () => {
  const cases = [
    { openrouter: { resolveApiKey: never } },
    { fetch: never },
    {
      fetch: async () => ({ ok: true, body: { getReader: () => ({ read: never, cancel() {} }) } }),
    },
  ]
  for (const options of cases)
    await rejects(fixture({ timeoutMs: 15, ...options }).service.evaluate(input()), 'timeout')
})

test('caller cancellation before dispatch and during body, plus plugin disposal', async () => {
  const pre = new AbortController()
  pre.abort(new Error('private-key'))
  const f = fixture()
  await rejects(f.service.evaluate({ ...input(), signal: pre.signal }), 'cancelled')
  assert.equal(f.resolutions(), 0)
  for (const disposal of [false, true]) {
    const entered = deferred()
    let cancelled = false
    const f = fixture({
      fetch: async () => ({
        ok: true,
        body: {
          getReader: () => ({
            read() {
              entered.resolve()
              return never()
            },
            cancel() {
              cancelled = true
            },
          }),
        },
      }),
    })
    const controller = new AbortController()
    const pending = f.service.evaluate({ ...input(), signal: controller.signal })
    await entered.promise
    if (disposal) f.dispose()
    else controller.abort(new Error('private-key'))
    await rejects(pending, disposal ? 'stopped' : 'cancelled')
    assert.equal(cancelled, true)
  }
})

test('eight active evaluations and FIFO handoff before credentials for the ninth', async (t) => {
  const f = queuedFixture(t)
  const pending = Array.from({ length: 11 }, (_, state) =>
    f.service.evaluate({ ...input(), state: String(state) }),
  )
  await flush()
  assert.equal(f.resolutions(), 8)
  assert.deepEqual(
    f.calls.map((c) => c.state),
    Array.from({ length: 8 }, (_, i) => String(i)),
  )
  for (let i = 0; i < 3; i++) {
    f.calls[i].resolve(response(answer()))
    await pending[i]
    await flush()
    assert.equal(f.resolutions(), 9 + i)
    assert.equal(f.calls[8 + i].state, String(8 + i))
  }
  for (const call of f.calls.slice(3)) call.resolve(response(answer()))
  await Promise.all(pending)
  assert.equal(f.calls.length, 11, 'each request dispatches exactly once')
})

test('32 waiting evaluations bound the queue; queued cancellation frees capacity', async (t) => {
  const f = queuedFixture(t)
  const controllers = Array.from({ length: 40 }, () => new AbortController())
  const pending = controllers.map((c) =>
    rejects(f.service.evaluate({ ...input(), signal: c.signal }), 'cancelled'),
  )
  await flush()
  assert.equal(f.resolutions(), 8)
  await rejects(f.service.evaluate(input()), 'busy')
  controllers[8].abort()
  await pending[8]
  const replacement = new AbortController()
  const replaced = rejects(
    f.service.evaluate({ ...input(), signal: replacement.signal }),
    'cancelled',
  )
  await rejects(f.service.evaluate(input()), 'busy')
  assert.equal(f.resolutions(), 8)
  // Cancel all queued entries before releasing active slots.
  for (const c of controllers.slice(8)) c.abort()
  replacement.abort()
  for (const c of controllers.slice(0, 8)) c.abort()
  await Promise.all([...pending, replaced])
  assert.equal(f.resolutions(), 8)
  const next = f.service.evaluate(input())
  await flush()
  f.calls[8].resolve(response(answer()))
  await next
})

test('queue timeout never resolves credentials and releases all slots without retries', async (t) => {
  const f = queuedFixture(t)
  const pending = Array.from({ length: 40 }, () => rejects(f.service.evaluate(input()), 'timeout'))
  await flush()
  t.mock.timers.tick(15000)
  await Promise.all(pending)
  assert.equal(f.resolutions(), 8)
  assert.equal(f.calls.length, 8)
  assert.ok(f.calls.every((c) => c.signal.aborted))
  const next = Array.from({ length: 8 }, () => f.service.evaluate(input()))
  await flush()
  assert.equal(f.calls.length, 16)
  for (const call of f.calls.slice(8)) call.resolve(response(answer()))
  await Promise.all(next)
})

test('handoff retains the original deadline including queue wait', async (t) => {
  const f = queuedFixture(t)
  const controllers = Array.from({ length: 8 }, () => new AbortController())
  const active = controllers.map((c) =>
    rejects(f.service.evaluate({ ...input(), signal: c.signal }), 'cancelled'),
  )
  const queued = rejects(f.service.evaluate(input()), 'timeout')
  await flush()
  t.mock.timers.tick(14999)
  controllers[0].abort()
  await active[0]
  await flush()
  assert.equal(f.calls.length, 9)
  for (const c of controllers.slice(1)) c.abort()
  await Promise.all(active)
  assert.equal(f.calls[8].signal.aborted, false)
  t.mock.timers.tick(1)
  await queued
  assert.equal(f.calls[8].signal.aborted, true)
})

test('settings change and disposal reject the whole queue without draining stale work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const mode of ['changed', 'configure', 'dispose']) {
    const key = deferred()
    let resolutions = 0
    const f = fixture({
      openrouter: {
        resolveApiKey: () => {
          resolutions++
          return key.promise
        },
      },
    })
    const pending = Array.from({ length: 40 }, () =>
      rejects(f.service.evaluate(input()), mode === 'dispose' ? 'stopped' : 'changed'),
    )
    await flush()
    assert.equal(resolutions, 8)
    if (mode === 'configure') await f.rpc('configure', { model: '~typesafe/jev-latest' })
    else if (mode === 'changed') f.changed()
    else f.dispose()
    await Promise.all(pending)
    key.resolve('private-key')
    await flush()
    assert.equal(resolutions, 8)
    assert.equal(f.fetches.length, 0)
    if (mode !== 'dispose') {
      const next = Array.from({ length: 8 }, () => f.service.evaluate(input()))
      await Promise.all(next)
      assert.equal(resolutions, 16)
      assert.equal(f.fetches.length, 8)
    } else await rejects(f.service.evaluate(input()), 'stopped')
    f.dispose()
  }
})

test('active failures hand off once and late abort-ignoring fetches cannot release twice', async (t) => {
  const f = queuedFixture(t)
  const controller = new AbortController()
  const cancelled = rejects(
    f.service.evaluate({ ...input(), signal: controller.signal }),
    'cancelled',
  )
  const failed = rejects(f.service.evaluate(input()), 'network')
  const active = Array.from({ length: 6 }, () => f.service.evaluate(input()))
  const queued = Array.from({ length: 3 }, () => f.service.evaluate(input()))
  await flush()
  controller.abort()
  f.calls[1].reject(new Error('private-key'))
  await Promise.all([cancelled, failed])
  await flush()
  assert.equal(f.calls.length, 10)
  let lateCancelled = 0
  f.calls[0].resolve({
    ok: true,
    body: {
      cancel() {
        lateCancelled++
      },
    },
  })
  await flush()
  assert.equal(lateCancelled, 1)
  assert.equal(f.calls.length, 10, 'late completion must not release a second slot')
  f.calls[2].resolve(response(answer()))
  await active[0]
  await flush()
  assert.equal(f.calls.length, 11)
  for (const call of f.calls.slice(3)) call.resolve(response(answer()))
  await Promise.all([...active, ...queued])
})

test('credential failure and cancellation hand off without late-key dispatch or leaked slots', async (t) => {
  const keys = []
  const f = queuedFixture(t, {
    openrouter: {
      resolveApiKey() {
        const key = deferred()
        keys.push(key)
        return key.promise
      },
    },
  })
  const controller = new AbortController()
  const cancelled = rejects(
    f.service.evaluate({ ...input(), signal: controller.signal }),
    'cancelled',
  )
  const failed = rejects(f.service.evaluate(input()), 'credential')
  const remaining = Array.from({ length: 9 }, () => f.service.evaluate(input()))
  await flush()
  assert.equal(keys.length, 8)
  controller.abort()
  keys[1].reject(new Error('private-key'))
  await Promise.all([cancelled, failed])
  await flush()
  assert.equal(keys.length, 10)
  keys[0].resolve('private-key')
  await flush()
  assert.equal(f.calls.length, 0)
  assert.equal(keys.length, 10)
  for (const key of keys.slice(2)) key.resolve('private-key')
  await flush()
  assert.equal(f.calls.length, 8)
  f.calls[0].resolve(response(answer()))
  await remaining[0]
  await flush()
  assert.equal(keys.length, 11)
  keys[10].resolve('private-key')
  await flush()
  for (const call of f.calls.slice(1)) call.resolve(response(answer()))
  await Promise.all(remaining)
})

test('response failure and queued cancellation racing handoff preserve capacity', async (t) => {
  const f = queuedFixture(t)
  const failed = rejects(f.service.evaluate(input()), 'response')
  const active = Array.from({ length: 7 }, () => f.service.evaluate(input()))
  const controller = new AbortController()
  const cancelled = rejects(
    f.service.evaluate({ ...input(), signal: controller.signal }),
    'cancelled',
  )
  const next = f.service.evaluate({ ...input(), state: 'next' })
  const last = f.service.evaluate({ ...input(), state: 'last' })
  await flush()
  f.calls[0].resolve(response({}))
  controller.abort()
  await Promise.all([failed, cancelled])
  await flush()
  assert.equal(f.resolutions(), 9)
  assert.equal(f.calls[8].state, 'next')
  f.calls[1].resolve(response(answer()))
  await active[0]
  await flush()
  assert.equal(f.resolutions(), 10)
  assert.equal(f.calls[9].state, 'last')
  for (const call of f.calls.slice(2)) call.resolve(response(answer()))
  await Promise.all([...active, next, last])
})

test('snapshots state/questions before asynchronous key resolution', async () => {
  const key = deferred()
  let sent
  const f = fixture({
    openrouter: { resolveApiKey: () => key.promise },
    fetch: async (_, init) => {
      sent = JSON.parse(init.body)
      return response(answer())
    },
  })
  const data = input()
  const pending = f.service.evaluate(data)
  data.state.ready = false
  data.questions.ready.instructions = 'mutated'
  data.questions.bad = { type: 'choice' }
  key.resolve('private-key')
  await pending
  assert.deepEqual(sent, { model: DEFAULT_MODEL, ...input() })
})

test('prototype-named JSON keys remain inert dictionaries', async () => {
  const data = JSON.parse(
    '{"state":{"__proto__":{"polluted":true}},"questions":{"__proto__":{"type":"choice","instructions":"Choose","criteria":{"constructor":"A","prototype":"B"}}}}',
  )
  const raw = JSON.parse(
    '{"model":"typesafe/jev-1.13","answers":{"__proto__":{"type":"choice","choice":"constructor","confidence":0.5,"probabilities":{"constructor":0.5,"prototype":0.5}}}}',
  )
  let sent
  const f = fixture({
    fetch: async (_, init) => {
      sent = JSON.parse(init.body)
      return response(raw)
    },
  })
  const result = await f.service.evaluate(data)
  assert.equal(Object.getPrototypeOf(result.answers), null)
  assert.equal(result.answers.__proto__.choice, 'constructor')
  assert.equal(Object.hasOwn(sent.state, '__proto__'), true)
  assert.equal({}.polluted, undefined)
})

test('rounded probability distributions are accepted', async () => {
  const data = {
    state: '',
    questions: {
      q: { type: 'choice', instructions: 'Choose', criteria: { a: 'A', b: 'B', c: 'C' } },
    },
  }
  const raw = {
    model: DEFAULT_MODEL,
    answers: {
      q: {
        type: 'choice',
        choice: 'a',
        confidence: 0.333,
        probabilities: { a: 0.333, b: 0.333, c: 0.333 },
      },
    },
  }
  assert.equal(
    (await fixture({ fetch: async () => response(raw) }).service.evaluate(data)).answers.q.choice,
    'a',
  )
})

test('late adapters cannot dispatch after cancellation and late responses are cancelled', async () => {
  const key = deferred()
  const controller = new AbortController()
  const f = fixture({ openrouter: { resolveApiKey: () => key.promise } })
  const pending = f.service.evaluate({ ...input(), signal: controller.signal })
  controller.abort()
  await rejects(pending, 'cancelled')
  key.resolve('private-key')
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(f.fetches.length, 0)
  const fetching = deferred()
  let cancelled = false
  const g = fixture({ timeoutMs: 10, fetch: () => fetching.promise })
  await rejects(g.service.evaluate(input()), 'timeout')
  fetching.resolve({
    ok: true,
    body: {
      cancel() {
        cancelled = true
      },
    },
  })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(cancelled, true)
})

test('pending work is invalidated by configure, settings changes and disposal', async () => {
  for (const mode of ['configure', 'direct', 'dispose']) {
    const key = deferred()
    const f = fixture({ openrouter: { resolveApiKey: () => key.promise } })
    const pending = f.service.evaluate(input())
    if (mode === 'configure') await f.rpc('configure', { model: '~typesafe/jev-latest' })
    else if (mode === 'direct') await f.settings.update('jev', { model: 'typesafe/jev-2' })
    else f.dispose()
    key.resolve('private-key')
    await rejects(pending, mode === 'dispose' ? 'stopped' : 'changed')
    assert.equal(f.fetches.length, 0)
  }
})
