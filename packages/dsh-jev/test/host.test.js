import test from 'node:test'
import assert from 'node:assert/strict'
import { createJevRuntime, mountJev, DEFAULT_MODEL, ENDPOINT, CHANNEL } from '../src/runtime.js'

const input = () => ({ state: { ready: true }, questions: { ready: { type: 'noul', instructions: 'Is it ready?' } } })
const answer = () => ({ model: 'typesafe/jev-1.13-20260917', answers: { ready: { type: 'noul', noul: 0.8 } }, usage: { input_tokens: 10, output_tokens: 4, cost: 0.001 } })
const response = value => new Response(JSON.stringify(value))
const never = () => new Promise(() => {})
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function fixture(overrides = {}) {
  let config = { model: DEFAULT_MODEL }, fetches = [], resolutions = 0
  const settings = { get: () => config, update: async (_, next) => { config = next } }
  const openrouter = { resolveApiKey: async () => { resolutions++; return 'private-key' }, status: async () => ({ configured: true, writable: true, source: 'record', secret: 'private-key' }) }
  const runtime = createJevRuntime({ settings, openrouter, fetch: async (...args) => { fetches.push(args); return response(answer()) }, ...overrides })
  return { ...runtime, fetches, settings, openrouter, resolutions: () => resolutions }
}
const rejects = (promise, code) => assert.rejects(promise, e => e.code === code && e.message && !e.message.includes('private-key') && Object.keys(e.details).length === 0)

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
  for (const [method, payload] of [['evaluate', input()], ['settings', {}], ['configure', {}], ['configure', { model: DEFAULT_MODEL, state: 'oops' }], ['configure', { model: 'other/model' }], ['configure', { model: 'typesafe/jev-../x' }], ['configure', { model: 'typesafe/jev-' + 'x'.repeat(129) }]]) {
    const result = await f.rpc(method, payload)
    assert.equal(result.ok, false)
    assert.deepEqual(Object.keys(result.error).sort(), ['code', 'details', 'message'])
  }
  f.settings.update = async () => { throw new Error('private-key') }
  assert.deepEqual((await f.rpc('configure', { model: DEFAULT_MODEL })).error, { code: 'settings', message: 'Jev settings are unavailable.', details: {} })
})

test('host mount installs only trusted-host RPC and jev settings/service', () => {
  let registered, provided, section, disposal
  const ctx = { settings: { get: () => ({}), installSection: (...args) => { section = args } }, openrouter: {},
    provide: (...args) => { provided = args }, effect: cb => { const result = cb(); if (typeof result === 'function') disposal = result },
    connection: { rpc: { handle: (...args) => { registered = args } } } }
  mountJev(ctx, 'schema')
  assert.equal(section[1], 'jev'); assert.deepEqual(section[3], { model: DEFAULT_MODEL })
  assert.equal(provided[0], 'jev'); assert.deepEqual(Object.keys(provided[1]).sort(), ['evaluate', 'settings', 'status'])
  assert.equal(registered[0], CHANNEL); assert.deepEqual(registered[2], { authority: 'trusted-host' })
  disposal()
})

test('all documented question kinds validate and unknown response fields are dropped', async () => {
  const data = { state: [], questions: {
    n: { type: 'noul', instructions: 'n', criteria: { true: 'yes', false: 'no' } },
    c: { type: 'choice', instructions: 'c', criteria: { a: 'one', b: 'two' } },
    s: { type: 'score', instructions: 's', criteria: ['low', 'high'] },
  } }
  const raw = { model: DEFAULT_MODEL, private: 'private-key', answers: {
    n: { type: 'noul', noul: 0 },
    c: { type: 'choice', choice: 'a', confidence: 0.5, probabilities: { a: 0.5, b: 0.5 }, secret: 'private-key' },
    s: { type: 'score', score: 0.7, confidence: 0.5, probabilities: { 0: 0.3, 1: 0.7 }, legend: { 0: 'low', 1: 'high' } },
  }, usage: { cost: 0, raw: 'private-key' } }
  const f = fixture({ fetch: async () => response(raw) })
  const result = await f.service.evaluate(data)
  assert.equal(result.answers.s.score, 0.7)
  assert.ok(!JSON.stringify(result).includes('private-key'))
  for (const change of [
    v => { v.answers.c.choice = 'z' }, v => { v.answers.c.confidence = 2 },
    v => { v.answers.c.probabilities.a = 0.1 }, v => { delete v.answers.c.probabilities.b },
    v => { v.answers.c.probabilities.b = -0.2 }, v => { v.answers.s.score = 2 },
    v => { v.answers.s.legend[0] = 'wrong' }, v => { v.answers.s.probabilities.extra = 0 },
  ]) {
    const bad = structuredClone(raw); change(bad)
    await rejects(fixture({ fetch: async () => response(bad) }).service.evaluate(data), 'response')
  }
})

test('invalid requests are rejected before credentials or dispatch', async () => {
  const invalid = [undefined, null, NaN, Infinity, true, 1, () => {}, new Date(), { nested: undefined }, { nested: 1n }, new Array(2)]
  const cycle = {}; cycle.self = cycle; invalid.push(cycle)
  const accessor = {}; Object.defineProperty(accessor, 'x', { enumerable: true, get() { throw new Error('private-key') } }); invalid.push(accessor)
  const symbol = { [Symbol('x')]: 1 }; invalid.push(symbol)
  for (const state of invalid) {
    const f = fixture(); await rejects(f.service.evaluate({ ...input(), state }), 'invalid'); assert.equal(f.resolutions(), 0)
  }
  const badQuestions = [{}, [], Object.fromEntries(Array.from({ length: 33 }, (_, i) => [i, input().questions.ready])),
    { q: { type: 'noul', instructions: '' } }, { q: { type: 'noul', instructions: 'x'.repeat(8193) } },
    { q: { type: 'noul', instructions: 'x', criteria: { true: 'yes' } } },
    { q: { type: 'choice', instructions: 'x', criteria: {} } },
    { q: { type: 'score', instructions: 'x', criteria: Array(33).fill('x') } },
    { q: { type: 'unknown', instructions: 'x' } }, { q: { type: 'noul', instructions: 'x', extra: 1 } }]
  for (const questions of badQuestions) await rejects(fixture().service.evaluate({ state: '', questions }), 'invalid')
  await rejects(fixture().service.evaluate({ ...input(), state: 'x'.repeat(65536) }), 'invalid')
  await rejects(fixture().service.evaluate({ ...input(), state: '\u0000'.repeat(12000) }), 'invalid')
})

test('missing/locked credentials fail closed, status is unavailable without errors leaking', async () => {
  for (const resolveApiKey of [async () => undefined, async () => { throw new Error('private-key') }]) {
    const f = fixture({ openrouter: { resolveApiKey, status: async () => ({ configured: true, error: 'private-key' }) } })
    await rejects(f.service.evaluate(input()), 'credential'); assert.equal(f.fetches.length, 0)
    assert.equal((await f.service.status()).available, false)
    assert.ok(!JSON.stringify(await f.service.status()).includes('private-key'))
  }
  const f = fixture(); f.dispose(); assert.equal((await f.service.status()).available, false)
})

test('HTTP, redirect, raw backend errors, empty and malformed bodies are sanitized', async () => {
  for (const fetch of [async () => { throw new Error('private-key') }, async () => new Response('', { status: 500 }),
    async () => new Response('private-key', { status: 302 }), async () => ({ ok: true, redirected: true }),
    async () => ({ ok: true, url: 'https://evil.example' })]) await rejects(fixture({ fetch }).service.evaluate(input()), 'network')
  for (const body of ['', 'private-key', '{}', 'null']) await rejects(fixture({ fetch: async () => new Response(body) }).service.evaluate(input()), 'response')
})

test('requested answer keys, types, bounds and returned model are mandatory', async () => {
  for (const change of [r => { delete r.model }, r => { r.model = 'other/model' }, r => { r.model = 'typesafe/jev-2' }, r => { r.model = '~typesafe/jev-latest' }, r => { delete r.answers.ready },
    r => { r.answers.extra = { type: 'noul', noul: 1 } }, r => { r.answers.ready.type = 'choice' },
    r => { r.answers.ready.noul = 2 }, r => { r.answers.ready.noul = null }, r => { r.usage.cost = -1 }]) {
    const raw = answer(); change(raw)
    await rejects(fixture({ fetch: async () => response(raw) }).service.evaluate(input()), 'response')
  }
})

test('response cap counts stream bytes without calling json, and cancels oversized reads', async () => {
  let cancelled = false
  const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(32769)) }, cancel() { cancelled = true } })
  await rejects(fixture({ fetch: async () => ({ ok: true, body, json() { throw new Error('must not call') } }) }).service.evaluate(input()), 'response')
  assert.equal(cancelled, true)
  await rejects(fixture({ fetch: async () => new Response('', { headers: { 'content-length': '65537' } }) }).service.evaluate(input()), 'response')
})

test('total deadline covers credentials, fetch and stalled stream adapters ignoring signals', async () => {
  const cases = [
    { openrouter: { resolveApiKey: never } }, { fetch: never },
    { fetch: async () => ({ ok: true, body: { getReader: () => ({ read: never, cancel() {} }) } }) },
  ]
  for (const options of cases) await rejects(fixture({ timeoutMs: 15, ...options }).service.evaluate(input()), 'timeout')
})

test('caller cancellation before dispatch and during body, plus plugin disposal', async () => {
  const pre = new AbortController(); pre.abort(new Error('private-key'))
  const f = fixture(); await rejects(f.service.evaluate({ ...input(), signal: pre.signal }), 'cancelled'); assert.equal(f.resolutions(), 0)
  for (const disposal of [false, true]) {
    const entered = deferred(); let cancelled = false
    const f = fixture({ fetch: async () => ({ ok: true, body: { getReader: () => ({ read() { entered.resolve(); return never() }, cancel() { cancelled = true } }) } }) })
    const controller = new AbortController()
    const pending = f.service.evaluate({ ...input(), signal: controller.signal })
    await entered.promise
    if (disposal) f.dispose(); else controller.abort(new Error('private-key'))
    await rejects(pending, disposal ? 'stopped' : 'cancelled')
    assert.equal(cancelled, true)
  }
})

test('max four concurrent requests, no retries, released slots after timeout', async () => {
  let count = 0
  const f = fixture({ timeoutMs: 15, fetch: () => { count++; return never() } })
  const pending = Array.from({ length: 4 }, () => rejects(f.service.evaluate(input()), 'timeout'))
  await rejects(f.service.evaluate(input()), 'busy')
  await Promise.all(pending)
  assert.equal(count, 4)
  await rejects(f.service.evaluate(input()), 'timeout'); assert.equal(count, 5)
})

test('snapshots state/questions before asynchronous key resolution', async () => {
  const key = deferred(); let sent
  const f = fixture({ openrouter: { resolveApiKey: () => key.promise }, fetch: async (_, init) => { sent = JSON.parse(init.body); return response(answer()) } })
  const data = input(); const pending = f.service.evaluate(data)
  data.state.ready = false; data.questions.ready.instructions = 'mutated'; data.questions.bad = { type: 'choice' }
  key.resolve('private-key'); await pending
  assert.deepEqual(sent, { model: DEFAULT_MODEL, ...input() })
})

test('prototype-named JSON keys remain inert dictionaries', async () => {
  const data = JSON.parse('{"state":{"__proto__":{"polluted":true}},"questions":{"__proto__":{"type":"choice","instructions":"Choose","criteria":{"constructor":"A","prototype":"B"}}}}')
  const raw = JSON.parse('{"model":"typesafe/jev-1.13","answers":{"__proto__":{"type":"choice","choice":"constructor","confidence":0.5,"probabilities":{"constructor":0.5,"prototype":0.5}}}}')
  let sent
  const f = fixture({ fetch: async (_, init) => { sent = JSON.parse(init.body); return response(raw) } })
  const result = await f.service.evaluate(data)
  assert.equal(Object.getPrototypeOf(result.answers), null)
  assert.equal(result.answers.__proto__.choice, 'constructor')
  assert.equal(Object.hasOwn(sent.state, '__proto__'), true)
  assert.equal({}.polluted, undefined)
})

test('rounded probability distributions are accepted', async () => {
  const data = { state: '', questions: { q: { type: 'choice', instructions: 'Choose', criteria: { a: 'A', b: 'B', c: 'C' } } } }
  const raw = { model: DEFAULT_MODEL, answers: { q: { type: 'choice', choice: 'a', confidence: 0.333, probabilities: { a: 0.333, b: 0.333, c: 0.333 } } } }
  assert.equal((await fixture({ fetch: async () => response(raw) }).service.evaluate(data)).answers.q.choice, 'a')
})

test('late adapters cannot dispatch after cancellation and late responses are cancelled', async () => {
  const key = deferred(); const controller = new AbortController()
  const f = fixture({ openrouter: { resolveApiKey: () => key.promise } })
  const pending = f.service.evaluate({ ...input(), signal: controller.signal })
  controller.abort(); await rejects(pending, 'cancelled')
  key.resolve('private-key'); await Promise.resolve(); await Promise.resolve()
  assert.equal(f.fetches.length, 0)
  const fetching = deferred(); let cancelled = false
  const g = fixture({ timeoutMs: 10, fetch: () => fetching.promise })
  await rejects(g.service.evaluate(input()), 'timeout')
  fetching.resolve({ ok: true, body: { cancel() { cancelled = true } } })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(cancelled, true)
})

test('pending work is invalidated by configure, settings changes and disposal', async () => {
  for (const mode of ['configure', 'direct', 'dispose']) {
    const key = deferred(); const f = fixture({ openrouter: { resolveApiKey: () => key.promise } })
    const pending = f.service.evaluate(input())
    if (mode === 'configure') await f.rpc('configure', { model: '~typesafe/jev-latest' })
    else if (mode === 'direct') await f.settings.update('jev', { model: 'typesafe/jev-2' })
    else f.dispose()
    key.resolve('private-key')
    await rejects(pending, mode === 'dispose' ? 'stopped' : 'changed')
    assert.equal(f.fetches.length, 0)
  }
})
