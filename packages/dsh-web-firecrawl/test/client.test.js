import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))
const REF = 'FIRECRAWL_API_KEY'
const ok = (value) => ({ ok: true, value })
const description = (value = { configured: false, writable: true }) => ok({ [REF]: value })

async function loadClient(React = {}, confirm = () => true) {
  let record
  const source = await readFile(CLIENT_PATH, 'utf8')
  vm.runInNewContext(source, {
    // Share Error's realm so injected remote rejections behave like browser errors.
    Error,
    window: { confirm, __ModuleLoader__: { load(value) { record = value } } },
  })
  assert.ok(record)
  return {
    record,
    exports: record.factory((specifier) => {
      assert.equal(specifier, 'react')
      return React
    }),
  }
}

// Only the hooks used by this component: persistent state, dependency-aware
// post-render effects, functional updates, and cleanup. No DOM or React package.
function createHarness() {
  const hooks = []
  let cursor = 0
  let effects = []
  let dirty = false
  let mounted = false
  let component
  let props
  let tree
  const React = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { value: initial }
      return [hooks[index].value, (next) => {
        if (!mounted) return
        const value = typeof next === 'function' ? next(hooks[index].value) : next
        if (!Object.is(value, hooks[index].value)) {
          hooks[index].value = value
          dirty = true
        }
      }]
    },
    useEffect(effect, deps) {
      const index = cursor++
      const previous = hooks[index]
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        effects.push(() => {
          previous?.cleanup?.()
          hooks[index] = { deps, cleanup: effect() }
        })
      }
    },
  }
  function render() {
    do {
      dirty = false
      cursor = 0
      effects = []
      tree = component(props)
      for (const effect of effects) effect()
    } while (dirty)
  }
  function nodes(predicate, node = tree) {
    if (!node || typeof node !== 'object') return []
    return [...(predicate(node) ? [node] : []), ...node.children.flatMap((child) => nodes(predicate, child))]
  }
  return {
    React,
    mount(fn, value) { component = fn; props = value; mounted = true; render() },
    async settle() {
      // Drain promise continuations before rendering their queued state updates.
      for (let turn = 0; turn < 20; turn++) {
        await setImmediate()
        if (!dirty) return
        render()
      }
      assert.fail('Component did not settle')
    },
    unmount() {
      if (!mounted) return
      mounted = false
      for (const hook of hooks) hook.cleanup?.()
    },
    one(predicate) {
      const matches = nodes(predicate)
      assert.equal(matches.length, 1, 'Expected exactly one matching rendered element')
      return matches[0]
    },
    nodes,
    text() { return text(tree) },
  }
}

function text(node) {
  if (node == null || node === false) return ''
  return typeof node === 'object' ? node.children.map(text).join(' ') : String(node)
}
function input(h) { return h.one((node) => node.type === 'input') }
function button(h, label) { return h.one((node) => node.type === 'button' && text(node) === label) }
function alert(h) { return text(h.one((node) => node.props.role === 'alert')) }
function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function setup(t, overrides = {}, confirm) {
  const h = createHarness()
  t.after(() => h.unmount())
  const calls = { describe: [], set: [], unset: [] }
  const credentials = Object.fromEntries(Object.entries({
    describe: () => description(), set: () => ok(undefined), unset: () => ok(undefined), ...overrides,
  }).map(([method, implementation]) => [method, (...args) => {
    // Normalize the VM's arrays without normalizing or losing the call shape.
    calls[method].push(args.map((arg) => Array.isArray(arg) ? Array.from(arg) : arg))
    return implementation(...args)
  }]))
  const events = new Map()
  const disposed = []
  const on = (event, listener) => {
    assert.equal(events.has(event), false, 'Subscription must not accumulate across renders')
    events.set(event, listener)
    return () => { disposed.push(event); events.delete(event) }
  }
  let registration
  const { record, exports } = await loadClient(h.React, confirm)
  const remote = {
    get credentials() {
      assert.ok(exports.inject.includes('remote.credentials'), 'Credential namespace must be explicitly injected')
      return credentials
    },
    $on: on,
  }
  exports.apply({
    remote,
    on,
    // Deliberately no connection or get(): the remote is the credentials API.
    slots: {
      inject(name, callback) { assert.equal(name, 'settings.plugin.item'); return callback() },
      register(options, component) { registration = { options, component }; return () => {} },
    },
  })
  h.mount(registration.component, registration.options.inject())
  return { h, calls, events, disposed, registration, remote, record, exports }
}

test('client registers a collapsed Firecrawl plugin card, not an additional tab', async (t) => {
  const { h, record, exports, registration, remote } = await setup(t)
  assert.equal(record.id, '@local/dsh-web-firecrawl')
  assert.deepEqual(Array.from(exports.inject), ['slots', 'remote', 'remote.credentials'])
  assert.equal(registration.options.name, 'settings.plugin.item')
  assert.equal(registration.options.key, 'web-firecrawl')
  assert.equal(registration.options.order, 20)
  assert.equal(Object.hasOwn(registration.options, 'id'), false)
  assert.equal(Object.hasOwn(registration.options, 'label'), false)
  const details = h.one((node) => node.type === 'details')
  assert.equal(details.props.open, undefined)
  assert.equal(details.children[0].type, 'summary')
  assert.match(text(details.children[0]), /^Firecrawl /)
  assert.equal(h.nodes((node) => node.type === 'h2' && text(node) === 'Web').length, 0)
  assert.equal(registration.options.inject().api, remote)
  assert.equal(typeof registration.options.inject().subscribe, 'function')
  assert.equal(registration.component, exports.FirecrawlSettingsSection)
})

for (const [name, response, status, writable] of [
  ['writable missing key', description(), 'Not configured', true],
  ['stored key', description({ configured: true, writable: true, source: 'file' }), 'Configured via DSH credential store', true],
  ['read-only environment key', description({ configured: true, writable: false, source: 'env' }), 'Configured via launch environment', false],
  ['absent reference', ok({}), 'Not configured', false],
]) {
  test(`describe renders ${name}`, async (t) => {
    const { h, calls } = await setup(t, { describe: () => response })
    assert.match(h.text(), /Checking…/)
    assert.equal(input(h).props.disabled, true)
    await h.settle()
    assert.deepEqual(calls.describe, [[[REF]]])
    assert.match(h.text(), new RegExp(status))
    assert.equal(input(h).props.type, 'password')
    assert.equal(input(h).props.value, '')
    assert.equal(input(h).props.disabled, !writable)
    if (!writable) assert.equal(h.nodes((node) => node.type === 'button' && text(node) === 'Remove key').length, 0)
  })
}

for (const [name, implementation, message] of [
  ['error result', () => ({ ok: false, error: { message: 'Credential access denied' } }), 'Credential access denied'],
  ['rejection', () => Promise.reject(new Error('Transport disconnected')), 'Transport disconnected'],
  ['synchronous throw', () => { throw new Error('Remote unavailable') }, 'Remote unavailable'],
]) {
  test(`describe handles ${name}`, async (t) => {
    const { h } = await setup(t, { describe: implementation })
    await h.settle()
    assert.match(h.text(), /Unavailable/)
    assert.equal(alert(h), message)
    assert.match(h.text(), /Could not check credential access/)
    assert.doesNotMatch(h.text(), /Open DSH on its loopback URL/)
    assert.equal(input(h).props.disabled, true)
    assert.equal(button(h, 'Save key').props.disabled, true)
  })
}

test('save trims the key, disables controls while pending, clears draft and refreshes', async (t) => {
  const pending = deferred()
  let stored = false
  const { h, calls } = await setup(t, {
    describe: () => description({ configured: stored, writable: true, source: stored ? 'file' : undefined }),
    set: () => pending.promise,
  })
  await h.settle()
  input(h).props.onChange({ target: { value: '  fc-new-key  ' } })
  await h.settle()
  button(h, 'Save key').props.onClick()
  await h.settle()
  assert.deepEqual(calls.set, [[REF, 'fc-new-key']])
  assert.equal(input(h).props.disabled, true)
  assert.equal(button(h, 'Saving…').props.disabled, true)
  stored = true
  pending.resolve(ok(undefined))
  await h.settle()
  assert.equal(input(h).props.value, '')
  assert.equal(input(h).props.disabled, false)
  assert.match(h.text(), /Firecrawl API key saved/)
  assert.match(h.text(), /Configured via DSH credential store/)
  assert.equal(calls.describe.length, 2)
})

test('remove confirms, disables controls while pending, clears draft and refreshes', async (t) => {
  const pending = deferred()
  const prompts = []
  let stored = true
  const { h, calls } = await setup(t, {
    describe: () => description({ configured: stored, writable: true }),
    unset: () => pending.promise,
  }, (message) => { prompts.push(message); return true })
  await h.settle()
  input(h).props.onChange({ target: { value: 'fc-unsaved' } })
  await h.settle()
  button(h, 'Remove key').props.onClick()
  await h.settle()
  assert.deepEqual(prompts, ['Remove the stored Firecrawl API key?'])
  assert.deepEqual(calls.unset, [[REF]])
  assert.equal(button(h, 'Remove key').props.disabled, true)
  assert.equal(input(h).props.disabled, true)
  stored = false
  pending.resolve(ok(undefined))
  await h.settle()
  assert.equal(input(h).props.value, '')
  assert.equal(input(h).props.disabled, false)
  assert.match(h.text(), /Stored Firecrawl API key removed/)
  assert.match(h.text(), /Not configured/)
  assert.equal(calls.describe.length, 2)
})

for (const method of ['set', 'unset']) {
  for (const kind of ['error result', 'rejection']) {
    test(`${method} handles ${kind} without clearing the draft or refreshing`, async (t) => {
      const message = `${method} failed`
      const { h, calls } = await setup(t, {
        describe: () => description({ configured: true, writable: true }),
        [method]: () => kind === 'rejection'
          ? Promise.reject(new Error(message))
          : { ok: false, error: { message } },
      })
      await h.settle()
      input(h).props.onChange({ target: { value: 'fc-retry' } })
      await h.settle()
      button(h, method === 'set' ? 'Replace key' : 'Remove key').props.onClick()
      await h.settle()
      assert.deepEqual(calls[method], [method === 'set' ? [REF, 'fc-retry'] : [REF]])
      assert.equal(alert(h), message)
      assert.equal(input(h).props.value, 'fc-retry')
      assert.equal(input(h).props.disabled, false)
      assert.equal(button(h, 'Replace key').props.disabled, false)
      assert.equal(button(h, 'Remove key').props.disabled, false)
      assert.equal(calls.describe.length, 1)
      assert.doesNotMatch(h.text(), /API key saved|API key removed/)
    })
  }
}

test('cancelled removal never calls unset', async (t) => {
  const { h, calls } = await setup(t, {
    describe: () => description({ configured: true, writable: true }),
  }, () => false)
  await h.settle()
  button(h, 'Remove key').props.onClick()
  await h.settle()
  assert.deepEqual(calls.unset, [])
  assert.equal(calls.describe.length, 1)
  assert.equal(input(h).props.disabled, false)
})

test('invalid draft is rejected locally and Enter saves a valid draft', async (t) => {
  const { h, calls } = await setup(t)
  await h.settle()
  input(h).props.onChange({ target: { value: 'FIRECRAWL_API_KEY=fc-key' } })
  await h.settle()
  button(h, 'Save key').props.onClick()
  await h.settle()
  assert.match(alert(h), /Paste only the API key/)
  assert.deepEqual(calls.set, [])
  input(h).props.onChange({ target: { value: 'fc-valid' } })
  await h.settle()
  input(h).props.onKeyDown({ key: 'Escape' })
  assert.deepEqual(calls.set, [])
  input(h).props.onKeyDown({ key: 'Enter' })
  await h.settle()
  assert.deepEqual(calls.set, [[REF, 'fc-valid']])
  assert.equal(h.nodes((node) => node.props.role === 'alert').length, 0)
})

test('credential events and connection reset refresh; unmount unsubscribes both', async (t) => {
  const { h, calls, events, disposed } = await setup(t)
  await h.settle()
  assert.equal(events.size, 2)
  events.get('credentials/reference-updated')('OTHER_KEY')
  await h.settle()
  assert.equal(calls.describe.length, 1)
  events.get('credentials/reference-updated')(REF)
  await h.settle()
  assert.equal(calls.describe.length, 2)
  events.get('connection/reset')()
  await h.settle()
  assert.equal(calls.describe.length, 3)
  h.unmount()
  assert.equal(events.size, 0)
  assert.deepEqual(disposed, ['credentials/reference-updated', 'connection/reset'])
})

test('a stale describe response cannot overwrite the latest refreshed status', async (t) => {
  const pending = deferred()
  let count = 0
  const { h, events } = await setup(t, {
    describe: () => ++count === 1 ? pending.promise : description({ configured: true, writable: true, source: 'file' }),
  })
  await h.settle()
  events.get('connection/reset')()
  await h.settle()
  assert.match(h.text(), /Configured via DSH credential store/)
  pending.resolve({ ok: false, error: { message: 'Stale failure' } })
  await h.settle()
  assert.match(h.text(), /Configured via DSH credential store/)
  assert.equal(h.nodes((node) => node.props.role === 'alert').length, 0)
})

test('client-side key validation rejects blank and shell-style pastes', async () => {
  const { exports } = await loadClient()
  assert.equal(exports.apiKeyFailure('fc-valid-key'), undefined)
  assert.match(exports.apiKeyFailure('   '), /Enter a Firecrawl API key/)
  assert.match(exports.apiKeyFailure('FIRECRAWL_API_KEY=fc-key'), /Paste only the API key/)
  assert.match(exports.apiKeyFailure('"fc-key"'), /Paste only the API key/)
  assert.match(exports.apiKeyFailure("'fc-key'"), /Paste only the API key/)
  assert.match(exports.apiKeyFailure('fc-\nkey'), /printable characters only/)
})
