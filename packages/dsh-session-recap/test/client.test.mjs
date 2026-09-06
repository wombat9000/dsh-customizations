import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
function load(react = {}) {
  let exports
  const window = { __ModuleLoader__: { load({ factory }) { exports = factory((id) => { assert.equal(id, 'react'); return react }) } } }
  vm.runInNewContext(source, { window, setTimeout, clearTimeout })
  return { exports, window }
}
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
  const controller = load().exports.createController({ rpc, storage, now: () => time })
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
test('registers dock, header utility, and Plugins slots with one controller', () => {
  const { exports } = load()
  const entries = []
  const events = new Map()
  exports.apply({ get: (name) => name === 'remote' ? { $on: (event, handler) => events.set(event, handler) } : { rpc: {} }, slots: { inject: (_name, register) => register(), register: (entry, component) => entries.push({ entry, component }) } })
  assert.deepEqual(entries.map(({ entry }) => entry.name), ['conversation.input.dock', 'conversation.session.header.utilities', 'settings.plugin.item'])
  assert.equal(entries[2].entry.key, 'wombat9000-session-recap')
  const dock = entries[0].entry.inject('session-1')
  const header = entries[1].entry.inject('session-1')
  assert.equal(dock.sessionId, 'session-1')
  assert.equal(header.sessionId, 'session-1')
  assert.equal(header.controller, dock.controller)
  assert.equal(entries[2].entry.inject().controller, dock.controller)
  assert.equal(entries[0].component, exports.RecapCard)
  assert.equal(entries[1].component, exports.RecapAction)
  assert.equal(events.size, 1)
  let sent
  dock.controller.humanMessageSent = (id) => { sent = id }
  events.get('api-session/activity')('session-1', 123)
  assert.equal(sent, 'session-1')
  assert.doesNotMatch(source, /setInterval|dangerouslySetInnerHTML|conversation\.submit|session\.append/)
})
test('Plugins card loads advisory models and saves an exact route without recap', async () => {
  const values = []; let cursor = 0; let mounted = false; let effect
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], (value) => { values[index] = typeof value === 'function' ? value(values[index]) : value }] },
    useEffect(fn) { if (!mounted) effect = fn },
  }
  const calls = []; let invalidations = 0
  const config = { autoRecap: true, inactivityMinutes: 30, provider: 'p', model: 'm' }
  const rpc = { async call(_channel, method, payload) {
    calls.push({ method, payload })
    if (method === 'models') return { ok: true, value: { providers: [{ id: 'p', name: 'Provider', models: [{ id: 'm', name: 'Model' }] }] } }
    return { ok: true, value: method === 'configure' ? payload : config }
  } }
  const { SettingsCard } = load(react).exports
  const render = () => { cursor = 0; return SettingsCard({ rpc, controller: { invalidateSettings() { invalidations++ } } }) }
  const collapsed = render()
  const header = collapsed.children[0]
  assert.equal(header.props['aria-expanded'], false)
  assert.equal(collapsed.children[1], null)
  mounted = true; effect(); await flush()
  header.props.onClick()
  const tree = render()
  assert.equal(tree.children[0].props['aria-expanded'], true)
  const nodes = []; const walk = (node) => { if (!node || typeof node !== 'object') return; nodes.push(node); for (const child of node.children || []) walk(child) }; walk(tree)
  const select = nodes.find((node) => node.type === 'select')
  select.props.onChange({ target: { value: '["custom","uncataloged"]' } })
  const updated = render(); const flat = []; const visit = (node) => { if (!node || typeof node !== 'object') return; flat.push(node); for (const child of node.children || []) visit(child) }; visit(updated)
  flat.find((node) => node.type === 'button' && node.children.includes('Save')).props.onClick(); await flush()
  assert.equal(invalidations, 1)
  const saved = calls.find((call) => call.method === 'configure')
  assert.equal(saved.payload.provider, 'custom'); assert.equal(saved.payload.model, 'uncataloged')
  assert.equal(calls.some((call) => call.method === 'recap'), false)
  render().children[0].props.onClick()
  const closed = render()
  assert.equal(closed.children[0].props['aria-expanded'], false)
  assert.equal(closed.children[1], null)
})
function componentFixture(state = {}) {
  const effects = []; const subscriptions = []; const calls = []
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useEffect: (effect) => effects.push(effect),
    useCallback: (callback) => callback,
    useSyncExternalStore(subscribe, getSnapshot) {
      const listener = () => {}; subscriptions.push(subscribe(listener))
      return getSnapshot()
    },
  }
  const controller = {
    getSnapshot(id) { assert.equal(id, 'a'); return state },
    subscribe(id, listener) { assert.equal(id, 'a'); assert.equal(typeof listener, 'function'); return () => {} },
    mount(...args) { calls.push(['mount', ...args]); return () => {} },
    recap(id) { calls.push(['recap', id]) },

  }
  return { ...load(react).exports, controller, effects, subscriptions, calls }
}
const nodes = (tree) => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flatMap(nodes)]
test('blank or unavailable sessions hide both surfaces without activity mounts', () => {
  const f = componentFixture()
  for (const session of [undefined, { blank: true }]) {
    assert.equal(f.RecapCard({ sessionId: 'a', session, controller: f.controller }), null)
    assert.equal(f.RecapAction({ sessionId: 'a', useSession: (select) => select(session || { blank: true }), controller: f.controller }), null)
  }
  for (const effect of f.effects) effect()
  assert.deepEqual(f.calls, [])
})
test('empty cards leave no panel', () => {
  for (const state of [{}]) {
    const f = componentFixture(state)
    assert.equal(f.RecapCard({ sessionId: 'a', session: { blank: false }, controller: f.controller }), null)
  }
})
test('card renders only escaped bullets without header, metadata or controls', () => {
  const f = componentFixture({ recap: { bullets: ['<script>bad()</script>', 'Direction', 'Paused'] }, generatedAt: '2026-01-01' })
  const tree = f.RecapCard({ sessionId: 'a', session: { blank: false }, controller: f.controller })
  assert.equal(tree.type, 'aside'); assert.equal(tree.props['aria-label'], 'Session recap')
  assert.ok(nodes(tree).some(node => node.props?.role === 'status'))
  assert.match(JSON.stringify(tree), /<script>bad\(\)<\/script>/)
  assert.doesNotMatch(JSON.stringify(tree), /dangerouslySetInnerHTML/)
  const buttons = nodes(tree).filter(node => node.type === 'button')
  assert.equal(buttons.length, 0)
  assert.equal(nodes(tree).filter(node => node.type === 'li').length, 3)
  assert.equal(nodes(tree).filter(node => ['svg', 'small', 'strong'].includes(node.type)).length, 0)
  assert.doesNotMatch(JSON.stringify(tree), /Earlier recap|2026-01-01|Latest outcome|Next step/)
})
test('busy and error cards expose accessible feedback', () => {
  for (const [state, role, text] of [[{ busy: true }, 'status', 'Generating recap…'], [{ error: 'Provider failed' }, 'alert', 'Provider failed']]) {
    const f = componentFixture(state)
    const tree = f.RecapCard({ sessionId: 'a', session: { blank: false }, controller: f.controller })
    const feedback = nodes(tree).find(node => node.props?.role === role)
    assert.ok(feedback); assert.ok(JSON.stringify(feedback).includes(text))
    assert.equal(nodes(tree).filter(node => node.type === 'button').length, 0)
  }
})
test('header selects blank state, subscribes without activity mounting, and generates', () => {
  for (const busy of [false, true]) {
    const f = componentFixture({ busy })
    const tree = f.RecapAction({ sessionId: 'a', controller: f.controller, useSession(select) { assert.equal(select({ blank: true }), true); return select({ blank: false }) } })
    const button = nodes(tree).find(node => node.type === 'button')
    assert.equal(button.props.disabled, busy)
    assert.ok(button.children.includes(busy ? 'Recapping…' : 'Recap'))
    assert.equal(f.subscriptions.length, 1)
    for (const effect of f.effects) effect()
    assert.deepEqual(f.calls, [])
    if (!busy) { button.props.onClick(); assert.deepEqual(f.calls, [['recap', 'a']]) }
  }
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
