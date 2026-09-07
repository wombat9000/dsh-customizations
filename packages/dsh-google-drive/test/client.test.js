import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const status = (extra = {}) => ({ configured: true, connected: false, pending: false, ...extra })
const ok = (value) => ({ ok: true, value })
const text = (node) => node == null || node === false ? '' : typeof node === 'object' ? node.children.map(text).join(' ') : String(node)

// Minimal dependency-aware hook renderer, following the Firecrawl unit tests.
function harness() {
  const hooks = []
  let cursor, tree, component, props, dirty, effects
  let mounted = false
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useRef(value) { const i = cursor++; return hooks[i] ??= { current: value } },
    useState(value) {
      const i = cursor++
      hooks[i] ??= { value }
      return [hooks[i].value, (next) => {
        if (!mounted) return
        const value = typeof next === 'function' ? next(hooks[i].value) : next
        if (!Object.is(value, hooks[i].value)) { hooks[i].value = value; dirty = true }
      }]
    },
    useEffect(effect, deps) {
      const i = cursor++, previous = hooks[i]
      if (!previous || deps.some((value, j) => !Object.is(value, previous.deps[j]))) {
        effects.push(() => { previous?.cleanup?.(); hooks[i] = { deps, cleanup: effect() } })
      }
    },
  }
  function render() {
    do { dirty = false; cursor = 0; effects = []; tree = component(props); effects.forEach((effect) => effect()) } while (dirty)
  }
  function nodes(predicate, node = tree) {
    return !node || typeof node !== 'object' ? [] : [...(predicate(node) ? [node] : []), ...node.children.flatMap((child) => nodes(predicate, child))]
  }
  return {
    React, nodes,
    mount(fn, value) { component = fn; props = value; mounted = true; render() },
    async settle() { for (let i = 0; i < 20; i++) { await setImmediate(); if (!dirty) return; render() } assert.fail('Render did not settle') },
    unmount() { mounted = false; hooks.forEach((hook) => hook.cleanup?.()) },
    text: () => text(tree),
    button(label) { const matches = nodes((node) => node.type === 'button' && text(node) === label); assert.equal(matches.length, 1); return matches[0] },
  }
}
async function setup(t, handlers = {}, confirm = () => true) {
  const h = harness(), timers = new Map(), events = new Map(), calls = []
  let record, registration, timerId = 0
  vm.runInNewContext(source, {
    Error, URL,
    window: {
      confirm,
      fetch: async (url, options) => {
        const method = url.split('/').at(-1)
        calls.push({ method, url, options })
        const result = await (handlers[method] ?? (() => ok(status())))()
        return { ok: result.ok, json: async () => result }
      },
      setTimeout(callback, delay) { assert.equal(delay, 1000); timers.set(++timerId, callback); return timerId },
      clearTimeout(id) { timers.delete(id) },
      __ModuleLoader__: { load(value) { record = value } },
    },
  })
  const exports = record.factory((name) => { assert.equal(name, 'react'); return h.React })
  exports.apply({
    on(name, listener) { events.set(name, listener); return () => events.delete(name) },
    slots: {
      inject(name, callback) { assert.equal(name, 'settings.plugin.item'); callback() },
      register(options, component) { registration = { options, component }; return () => {} },
    },
  })
  h.mount(registration.component, registration.options.inject())
  t.after(() => h.unmount())
  return { h, timers, events, calls, record, exports, registration,
    async tick() { const entries = [...timers]; timers.clear(); entries.forEach(([, callback]) => callback()); await h.settle() },
  }
}

test('ModuleLoader registers a slots-only collapsed settings card and fixed POST contract', async (t) => {
  const { h, calls, exports, record, registration, timers } = await setup(t)
  await h.settle()
  assert.equal(record.id, '@local/dsh-google-drive')
  assert.deepEqual(Array.from(exports.inject), ['slots'])
  assert.equal(registration.options.key, 'google-drive')
  assert.equal(registration.component, exports.GoogleDriveSettingsSection)
  assert.equal(h.nodes((node) => node.type === 'details')[0].props.open, undefined)
  assert.equal(h.nodes((node) => node.type === 'input').length, 0)
  assert.match(h.text(), /drive.metadata.readonly/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/plugins/google-drive/status')
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options)), {
    method: 'POST', credentials: 'same-origin', body: '{}',
    headers: { 'Content-Type': 'application/json', 'X-DSH-Google-Drive': '1' },
  })
  assert.equal(timers.size, 0)
})

test('unconfigured status shows Desktop OAuth paste instructions and an empty draft', async (t) => {
  const { h } = await setup(t, { status: () => ok(status({ configured: false })) })
  await h.settle()
  assert.equal(h.button('Connect').props.disabled, true)
  assert.match(h.text(), /OAuth client of type Desktop app/)
  assert.doesNotMatch(h.text(), /clientJsonPath|DSH_HOME|google-drive-client.json/)
  assert.equal(h.nodes((node) => node.type === 'textarea')[0].props.value, '')
  assert.ok(h.nodes((node) => node.type === 'a' && /documentation/.test(text(node))).length)
})

test('connect exposes a safe explicit link and polls only until authorization finishes', async (t) => {
  let pending = false, connected = false
  const state = await setup(t, {
    status: () => ok(status({ pending, connected })),
    connect: () => { pending = true; return ok({ authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test', expiresAt: Date.now() + 60000 }) },
  })
  const { h, timers, calls } = state
  await h.settle()
  h.button('Connect').props.onClick(); await h.settle()
  const link = h.nodes((node) => node.type === 'a' && text(node) === 'Continue with Google')[0]
  assert.equal(link.props.target, '_blank')
  assert.equal(link.props.rel, 'noopener noreferrer')
  assert.equal(timers.size, 1)
  await state.tick(); assert.equal(timers.size, 1)
  pending = false; connected = true
  await state.tick()
  assert.equal(timers.size, 0)
  assert.match(h.text(), /Connected/)
  assert.equal(h.nodes((node) => node.type === 'a' && text(node) === 'Continue with Google').length, 0)
  assert.ok(calls.some((call) => call.method === 'connect'))
})

for (const method of ['cancel', 'disconnect']) {
  for (const confirmed of [false, true]) {
    test(`${method} requires confirmation (${confirmed})`, async (t) => {
      let active = true
      const prompts = []
      const { h, calls, timers } = await setup(t, {
        status: () => ok(status({ pending: method === 'cancel' && active, connected: method === 'disconnect' && active })),
        [method]: () => { active = false; return ok(undefined) },
      }, (message) => { prompts.push(message); return confirmed })
      await h.settle()
      h.button(method === 'cancel' ? 'Cancel' : 'Disconnect').props.onClick(); await h.settle()
      assert.equal(prompts.length, 1)
      assert.equal(calls.filter((call) => call.method === method).length, confirmed ? 1 : 0)
      if (confirmed) assert.equal(timers.size, 0)
      if (method === 'disconnect') assert.match(prompts[0], /does not revoke/)
      assert.match(h.text(), /Disconnect removes only local DSH credentials/)
    })
  }
}

test('API errors remain visible and include helpful host rejection messages', async (t) => {
  const { h } = await setup(t, { connect: () => ({ ok: false, error: { message: 'Use the local loopback GUI to connect Google Drive.' } }) })
  await h.settle(); h.button('Connect').props.onClick(); await h.settle()
  assert.match(h.text(), /Use the local loopback GUI/)
  assert.equal(h.button('Connect').props.disabled, false)
})

test('transport failures do not expose raw exception contents', async (t) => {
  const { h } = await setup(t, { status: () => { throw new Error('SECRET payload') } })
  await h.settle()
  assert.match(h.text(), /Cannot reach DSH/)
  assert.doesNotMatch(h.text(), /SECRET/)
})

test('invalid authorization links are rejected and failure stays visible', async (t) => {
  const { h, exports } = await setup(t, { connect: () => ok({ authorizationUrl: 'https://evil.example/' }) })
  await h.settle(); h.button('Connect').props.onClick(); await h.settle()
  assert.match(h.text(), /invalid authorization link/)
  for (const value of ['javascript:alert(1)', 'http://accounts.google.com/o/oauth2/v2/auth', 'https://accounts.google.com.evil.test/o/oauth2/v2/auth', 'https://user@accounts.google.com/o/oauth2/v2/auth', 'https://accounts.google.com:444/o/oauth2/v2/auth', 'https://accounts.google.com/other', undefined]) {
    assert.throws(() => exports.authorizationUrl(value), /invalid authorization link/)
  }
})

test('reset clears pending timers, ignores stale responses, and unmount unsubscribes', async (t) => {
  let resolve, count = 0
  const old = new Promise((yes) => { resolve = yes })
  const { h, timers, events, tick } = await setup(t, {
    status: () => ++count === 2 ? old : ok(status({ pending: count === 1 })),
  })
  await h.settle(); assert.equal(timers.size, 1)
  await tick()
  events.get('connection/reset')(); await h.settle()
  assert.match(h.text(), /Not connected/)
  resolve(ok(status({ pending: true }))); await h.settle()
  assert.equal(timers.size, 0)
  assert.match(h.text(), /Not connected/)
  h.unmount(); assert.equal(events.size, 0); assert.equal(timers.size, 0)
})

test('unmount removes an active pending timer', async (t) => {
  const { h, timers } = await setup(t, { status: () => ok(status({ pending: true, error: 'Authorization is pending.' })) })
  await h.settle(); assert.equal(timers.size, 1)
  assert.match(h.text(), /Authorization is pending/)
  h.unmount(); assert.equal(timers.size, 0)
})

const clientJson = JSON.stringify({ installed: { client_id: 'example.apps.googleusercontent.com', client_secret: 'secret-never-echo' } })
const textarea = (h) => h.nodes((node) => node.type === 'textarea')[0]

test('configuration is write-only and successful save clears the draft', async (t) => {
  let configured = false
  const { h, calls } = await setup(t, {
    status: () => ok(status({ configured })),
    configure: () => { configured = true; return ok({}) },
  })
  await h.settle()
  textarea(h).props.onChange({ target: { value: clientJson } }); await h.settle()
  h.button('Save client configuration').props.onClick(); await h.settle()
  const call = calls.find((call) => call.method === 'configure')
  assert.equal(call.url, '/api/plugins/google-drive/configure')
  assert.deepEqual(JSON.parse(call.options.body), { clientJson })
  assert.equal(call.options.credentials, 'same-origin')
  assert.equal(call.options.headers['X-DSH-Google-Drive'], '1')
  assert.equal(textarea(h).props.value, '')
  assert.equal(h.button('Connect').props.disabled, false)
  h.button('Refresh status').props.onClick(); await h.settle()
  assert.equal(textarea(h).props.value, '')
})

test('configuration failure preserves the draft without echoing a malicious error', async (t) => {
  const { h } = await setup(t, {
    configure: () => ({ ok: false, error: { message: `Invalid JSON: ${clientJson}` } }),
  })
  await h.settle()
  textarea(h).props.onChange({ target: { value: clientJson } }); await h.settle()
  h.button('Save client configuration').props.onClick(); await h.settle()
  assert.equal(textarea(h).props.value, clientJson)
  assert.match(h.text(), /Could not save or remove/)
  assert.doesNotMatch(h.text(), /secret-never-echo|example.apps/)
})

for (const method of ['configure', 'clear-config']) {
  for (const confirmed of [false, true]) {
    test(`${method} confirms destructive configuration change (${confirmed})`, async (t) => {
      const prompts = []
      const { h, calls } = await setup(t, { [method]: () => ok({}) }, (message) => { prompts.push(message); return confirmed })
      await h.settle()
      textarea(h).props.onChange({ target: { value: clientJson } }); await h.settle()
      h.button(method === 'configure' ? 'Save client configuration' : 'Remove client configuration').props.onClick(); await h.settle()
      assert.equal(prompts.length, 1)
      assert.match(prompts[0], /local tokens.*pending connection/)
      assert.equal(calls.filter((call) => call.method === method).length, confirmed ? 1 : 0)
      assert.equal(textarea(h).props.value, confirmed ? '' : clientJson)
      if (confirmed && method === 'clear-config') assert.equal(calls.find((call) => call.method === method).options.body, '{}')
    })
  }
}

test('invalid or oversized JSON is rejected locally without exposing its content', async (t) => {
  const { h, calls } = await setup(t)
  await h.settle()
  assert.equal(textarea(h).props.maxLength, 32768)
  for (const value of ['not JSON secret-never-echo', '{"web":{}}', 'x'.repeat(32769)]) {
    textarea(h).props.onChange({ target: { value } }); await h.settle()
    h.button('Save client configuration').props.onClick(); await h.settle()
    assert.equal(calls.filter((call) => call.method === 'configure').length, 0)
    assert.equal(textarea(h).props.value, value)
    assert.doesNotMatch(h.text(), /secret-never-echo/)
  }
})
