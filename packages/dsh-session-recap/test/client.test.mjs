import test from 'node:test'
import assert from 'node:assert/strict'
import { createController } from '../client/controller.js'

class Target {
  handlers = new Map()
  addEventListener(event, handler) { if (!this.handlers.has(event)) this.handlers.set(event, new Set()); this.handlers.get(event).add(handler) }
  removeEventListener(event, handler) { this.handlers.get(event)?.delete(handler) }
  emit(event) { for (const handler of this.handlers.get(event) || []) handler() }
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
function setup(overrides = {}) {
  let time = 10000000
  const data = new Map()
  const storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) }
  const calls = []
  let failure = false
  const activity = { ready: true, running: false, latestActivity: null }
  const config = { autoRecap: true, provider: 'p', model: 'm', inactivityMinutes: 30, storageScope: 'profile-a', ...overrides }
  const rpc = { async call(channel, method, payload) {
    assert.equal(channel, '/session-recap'); calls.push({ method, payload })
    if (method === 'settings') return { ok: true, value: config }
    if (method === 'activity') return { ok: true, value: activity }
    if (failure) return { ok: false, error: { message: 'Provider failed' } }
    return { ok: true, value: { sessionId: payload.sessionId, recap: { bullets: ['Thread topic', 'Key direction', 'Where we paused'] } } }
  } }
  const document = new Target(); document.visibilityState = 'visible'; document.hasFocus = () => true
  const window = new Target()
  const controller = createController({ rpc, storage, now: () => time })
  let value
  return { controller, data, calls, config, activity, document, window, storage, rpc,
    mount: (id = 'a') => controller.mount(id, { document, window }, (next) => { value = next }),
    advance: (minutes) => { time += minutes * 60000 },
    hide: () => { document.visibilityState = 'hidden'; document.emit('visibilitychange') },
    show: () => { document.visibilityState = 'visible'; document.emit('visibilitychange') },
    fail: () => { failure = true }, get value() { return value },
  }
}
const recaps = (f) => f.calls.filter((call) => call.method === 'recap')
test('automatic recap stays hidden and unread until clicked, then toggles without another request', async () => {
  const f = setup({ autoRecap: false })
  await f.controller.recap('a', true)
  assert.equal(f.controller.getSnapshot('a').open, false)
  assert.equal(f.controller.getSnapshot('a').unread, true)
  await f.controller.click('a')
  assert.equal(f.controller.getSnapshot('a').open, true)
  assert.equal(f.controller.getSnapshot('a').unread, false)
  await f.controller.click('a')
  assert.equal(f.controller.getSnapshot('a').open, false)
  await f.controller.click('a')
  assert.equal(f.controller.getSnapshot('a').open, true)
  assert.equal(recaps(f).length, 1)
})
test('manual and busy clicks open only on readiness and never duplicate generation', async () => {
  for (const automatic of [false, true]) {
    const f = setup({ autoRecap: false }); const original = f.rpc.call
    let resolve
    f.rpc.call = (channel, method, payload) => method === 'recap'
      ? new Promise(done => { f.calls.push({ method, payload }); resolve = done })
      : original(channel, method, payload)
    const pending = automatic ? f.controller.recap('a', true) : f.controller.click('a')
    await flush()
    assert.equal(f.controller.getSnapshot('a').busy, true)
    assert.equal(f.controller.getSnapshot('a').open, false)
    const again = f.controller.click('a'); const third = f.controller.click('a')
    await flush()
    assert.equal(recaps(f).length, 1)
    assert.equal(f.controller.getSnapshot('a').openOnReady, true)
    resolve({ ok: true, value: { sessionId: 'a', recap: { bullets: ['Ready'] } } })
    await Promise.all([pending, again, third])
    assert.equal(f.controller.getSnapshot('a').open, true)
    assert.equal(f.controller.getSnapshot('a').unread, false)
    assert.equal(f.controller.getSnapshot('a').busy, false)
  }
})
test('first visit to old persisted conversation recaps once across repeated mounts', async () => {
  const f = setup(); f.activity.latestActivity = 1
  const stop = f.mount(); await flush()
  assert.equal(recaps(f).length, 1)
  stop(); f.mount(); f.window.emit('focus'); await flush()
  assert.equal(recaps(f).length, 1)
})
test('recent, empty and future conversation timestamps do not recap', async () => {
  for (const timestamp of [10000000 - 60000, null, 10000001]) {
    const f = setup(); f.activity.latestActivity = timestamp; f.mount(); await flush()
    assert.equal(recaps(f).length, 0)
  }
})
test('browser activity takes precedence over old conversation; missing model and disabled auto make no activity or recap requests', async () => {
  const f = setup(); f.mount(); await flush(); f.hide(); f.activity.latestActivity = 1; f.show(); await flush()
  assert.equal(recaps(f).length, 0)
  for (const overrides of [{ autoRecap: false }, { provider: '' }, { model: '' }]) {
    const g = setup(overrides); g.activity.latestActivity = 1; g.mount(); await flush()
    assert.equal(g.calls.filter(c => c.method !== 'settings').length, 0)
  }
})
test('loading and running defer first visit without claiming activity', async () => {
  const f = setup(); f.activity.ready = false; f.activity.latestActivity = 1
  const stop = f.mount(); await flush()
  assert.equal(recaps(f).length, 0); assert.equal(f.data.size, 0)
  f.activity.ready = true; f.activity.running = true; f.document.emit('pointerdown'); await flush()
  assert.equal(recaps(f).length, 0); assert.equal(f.data.size, 0)
  f.activity.running = false; f.document.emit('pointerdown'); await flush()
  assert.equal(recaps(f).length, 1); stop()
})
test('history loading automatically retries and unmount cancels retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = setup(); f.activity.ready = false; f.activity.latestActivity = 1
  const stop = f.mount(); await flush()
  f.activity.ready = true; t.mock.timers.tick(1000); await flush()
  assert.equal(recaps(f).length, 1); stop()
  const g = setup(); g.activity.ready = false
  const cleanup = g.mount(); await flush(); cleanup()
  const before = g.calls.length; t.mock.timers.tick(1000); await flush()
  assert.equal(g.calls.length, before)
})
test('auto recap occurs on tab return, never while away or on repeated focus', async () => {
  const f = setup(); f.mount(); await flush()
  assert.equal(recaps(f).length, 0)
  f.hide(); f.advance(31); await flush(); assert.equal(recaps(f).length, 0)
  f.show(); await flush(); assert.equal(recaps(f).length, 1)
  assert.equal(recaps(f)[0].payload.automatic, true)
  f.window.emit('focus'); f.document.emit('visibilitychange'); await flush()
  assert.equal(recaps(f).length, 1)
})
test('focused inactivity triggers only on renewed interaction, once', async () => {
  const f = setup(); f.mount(); await flush(); f.advance(31); await flush()
  assert.equal(recaps(f).length, 0)
  f.document.emit('pointerdown'); f.document.emit('keydown'); await flush()
  assert.equal(recaps(f).length, 1)
  f.document.emit('keydown'); await flush(); assert.equal(recaps(f).length, 1)
})
test('profile scopes cannot reuse another profile activity', async () => {
  const f = setup(); f.mount(); await flush(); f.hide(); f.advance(31)
  f.config.storageScope = 'profile-b'; f.show(); await flush()
  assert.equal(recaps(f).length, 0); assert.equal(f.data.size, 2)
})
test('session return persists activity and does not bill on immediate remount', async () => {
  const f = setup(); const stop = f.mount(); await flush(); stop()
  const other = f.mount('b'); await flush(); f.advance(31); other()
  const again = f.mount(); await flush(); assert.equal(recaps(f).length, 1)
  again(); f.mount(); await flush(); assert.equal(recaps(f).length, 1)
  assert.equal(f.data.size, 2)
  for (const value of f.data.values()) assert.match(value, /^\d+$/)
})
test('manual requests deduplicate, errors render, successful send clears feedback', async () => {
  const f = setup(); f.mount(); await flush(); f.fail()
  await Promise.all([f.controller.recap('a'), f.controller.recap('a')])
  assert.equal(recaps(f).length, 1); assert.equal(f.value.error, 'Provider failed')
  f.controller.humanMessageSent('a'); assert.equal(f.value.error, undefined)
  assert.equal(recaps(f).length, 1)
})
test('successful sends invalidate late success and failure without affecting other sessions', async () => {
  for (const failure of [false, true]) {
    const f = setup({ autoRecap: false })
    const original = f.rpc.call
    const pending = []
    f.rpc.call = (channel, method, payload) => method === 'recap' ? new Promise((resolve, reject) => pending.push({ resolve, reject, payload })) : original(channel, method, payload)
    const first = f.controller.recap('a'); await flush()
    f.controller.humanMessageSent('b')
    assert.equal(f.controller.getSnapshot('a').busy, true)
    f.controller.humanMessageSent('a')
    assert.equal(Object.keys(f.controller.getSnapshot('a')).length, 0)
    const second = f.controller.recap('a'); await flush()
    if (failure) pending[0].reject(new Error('late error'))
    else pending[0].resolve({ ok: true, value: { sessionId: 'a', recap: { bullets: ['Stale'] } } })
    await first
    assert.equal(f.controller.getSnapshot('a').busy, true)
    assert.equal(f.controller.getSnapshot('a').error, undefined)
    pending[1].resolve({ ok: true, value: { sessionId: 'a', recap: { bullets: ['Fresh'] } } })
    await second
    assert.equal(f.controller.getSnapshot('a').recap.bullets[0], 'Fresh')
  }
})
test('late activity and settings failures cannot resurrect a cleared card', async () => {
  for (const method of ['settings', 'activity']) {
    const f = setup()
    const original = f.rpc.call
    let reject
    f.rpc.call = (channel, endpoint, payload) => endpoint === method ? new Promise((resolve, fail) => { reject = fail }) : original(channel, endpoint, payload)
    const stop = f.mount(); await flush()
    assert.equal(typeof reject, 'function')
    f.controller.humanMessageSent('a')
    reject(new Error('Late failure')); await flush()
    assert.equal(Object.keys(f.controller.getSnapshot('a')).length, 0)
    stop()
  }
})
test('new turns invalidate unread and open recaps and suppress late completion', async () => {
  for (const automatic of [false, true]) {
    const f = setup({ autoRecap: false })
    await f.controller.recap('a', automatic)
    f.controller.turnStarted('b')
    assert.ok(f.controller.getSnapshot('a').recap)
    f.controller.turnStarted('a')
    assert.equal(Object.keys(f.controller.getSnapshot('a')).length, 0)
    let resolve
    f.rpc.call = () => new Promise(done => { resolve = done })
    const pending = f.controller.recap('a', automatic); await flush()
    f.controller.turnStarted('a')
    resolve({ ok: true, value: { sessionId: 'a', recap: { bullets: ['Stale'] } } })
    await pending
    assert.equal(Object.keys(f.controller.getSnapshot('a')).length, 0)
  }
})
test('loaded observations survive remounts and ignore loading or older-page changes', async () => {
  const f = setup({ autoRecap: false })
  const observe = (next) => f.controller.observeSession('a', { ready: true, running: false, latestTurn: 2, ...next })
  observe({})
  const stop = f.mount(); await flush()
  await f.controller.recap('a', true)
  const unread = f.controller.getSnapshot('a')
  stop(); const cleanup = f.mount(); await flush()
  observe({ ready: false, latestTurn: undefined })
  observe({})
  assert.equal(f.controller.getSnapshot('a'), unread)
  observe({ latestTurn: 1 })
  assert.equal(f.controller.getSnapshot('a'), unread)
  observe({ ready: false, latestTurn: 3 })
  assert.equal(f.controller.getSnapshot('a'), unread)
  observe({ latestTurn: 3 })
  assert.equal(Object.keys(f.controller.getSnapshot('a')).length, 0)
  await f.controller.recap('a')
  observe({ latestTurn: 3, running: true })
  assert.equal(Object.keys(f.controller.getSnapshot('a')).length, 0)
  cleanup()
})
test('automatic failures stay hidden while a requested retry opens the error', async () => {
  const f = setup({ autoRecap: false }); f.fail()
  await f.controller.recap('a', true)
  assert.equal(f.controller.getSnapshot('a').open, false)
  assert.equal(f.controller.getSnapshot('a').error, 'Provider failed')
  await f.controller.click('a')
  assert.equal(f.controller.getSnapshot('a').open, true)
  assert.equal(recaps(f).length, 2)
})
test('typing does not clear a generated recap', async () => {
  const f = setup({ autoRecap: false }); const stop = f.mount(); await flush()
  await f.controller.recap('a')
  f.document.emit('keydown'); f.document.emit('pointerdown'); await flush()
  assert.equal(f.controller.getSnapshot('a').recap.bullets[0], 'Thread topic')
  stop()
})
test('missing scope disables persisted automatic recap; manual remains available', async () => {
  const f = setup({ storageScope: undefined }); f.mount(); await flush()
  f.hide(); f.advance(31); f.show(); await flush()
  assert.equal(recaps(f).length, 0); assert.equal(f.data.size, 0)
  await f.controller.recap('a'); assert.equal(recaps(f).length, 1)
})
test('disabled auto, short absence and invalid stored timestamps do not bill', async () => {
  const f = setup({ autoRecap: false }); f.mount(); await flush()
  f.hide(); f.advance(31); f.show(); await flush(); assert.equal(recaps(f).length, 0)
  f.config.autoRecap = true; f.hide(); f.advance(2); f.show(); await flush(); assert.equal(recaps(f).length, 0)
  f.hide(); for (const key of f.data.keys()) f.data.set(key, 'Infinity')
  f.show(); await flush(); assert.equal(recaps(f).length, 0)
})
test('storage failures are safe and use profile/session-scoped memory fallback', async () => {
  const f = setup(); f.storage.getItem = () => { throw new Error('blocked') }; f.storage.setItem = () => { throw new Error('blocked') }
  f.mount(); await flush(); f.hide(); f.advance(31); f.show(); await flush()
  assert.equal(recaps(f).length, 1)
})
test('unmount removes all listeners and settings completion cannot trigger a departed session', async () => {
  const f = setup(); const stop = f.mount(); stop(); await flush()
  f.advance(31); f.show(); await flush(); assert.equal(recaps(f).length, 0)
  for (const target of [f.document, f.window]) for (const handlers of target.handlers.values()) assert.equal(handlers.size, 0)
})
test('controller keeps selection with the published result and clears it on a new turn', async () => {
  const f = setup({ autoRecap: false })
  const selection = { mode: 'standard', reason: 'no-labels' }
  f.rpc.call = async () => ({ ok: true, value: { sessionId: 'a', selection, recap: { headline: 'Ready', cards: [{ label: 'paused', text: 'Review' }] } } })
  await f.controller.recap('a')
  assert.equal(f.controller.getSnapshot('a').selection, selection)
  f.controller.click('a'); f.controller.click('a')
  assert.equal(f.controller.getSnapshot('a').selection, selection)
  f.controller.turnStarted('a')
  assert.equal(f.controller.getSnapshot('a').selection, undefined)
})
test('controller snapshots and independent subscriptions isolate sessions', async () => {
  const f = setup({ autoRecap: false }); const a = []; const b = []
  const initial = f.controller.getSnapshot('a')
  assert.equal(f.controller.getSnapshot('a'), initial)
  const stopA = f.controller.subscribe('a', () => a.push(f.controller.getSnapshot('a')))
  const stopB = f.controller.subscribe('b', () => b.push(f.controller.getSnapshot('b')))
  assert.equal(f.calls.length, 0)
  const pending = f.controller.recap('a')
  assert.equal(f.controller.getSnapshot('a').busy, true)
  assert.notEqual(f.controller.getSnapshot('a'), initial)
  assert.deepEqual(b, [])
  await pending
  assert.equal(a.at(-1).recap.bullets[0], 'Thread topic')
  stopA(); const count = a.length; f.controller.humanMessageSent('a')
  assert.equal(a.length, count)
  assert.equal(f.controller.getSnapshot('a').recap, undefined)
  assert.equal(f.controller.getSnapshot('b').recap, undefined)
  stopB()
})
