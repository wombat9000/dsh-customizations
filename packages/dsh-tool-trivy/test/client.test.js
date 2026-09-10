import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))
const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url))

function fakeReact(stateValues = [], runEffects = false) {
  let stateIndex = 0
  const updates = []
  const cleanups = []
  return {
    Fragment: Symbol('Fragment'),
    updates,
    cleanups,
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity).filter((value) => value !== null) }
    },
    useState(initial) {
      const index = stateIndex++
      updates[index] = []
      return [index < stateValues.length ? stateValues[index] : initial, (value) => updates[index].push(value)]
    },
    useEffect(effect) {
      if (!runEffects) return
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }
}

async function loadClient(react = fakeReact()) {
  let record
  const source = await readFile(CLIENT_PATH, 'utf8')
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { record = value } } },
  })
  assert.ok(record)
  return {
    record,
    exports: record.factory((specifier) => {
      assert.equal(specifier, 'react')
      return react
    }),
  }
}

function findElements(root, predicate, found = []) {
  if (root === null || root === undefined || typeof root !== 'object') return found
  if (predicate(root)) found.push(root)
  for (const child of root.children ?? []) findElements(child, predicate, found)
  return found
}

function textOf(root) {
  if (typeof root === 'string') return root
  if (root === null || root === undefined || typeof root !== 'object') return ''
  return (root.children ?? []).map(textOf).join('')
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('package exposes the Trivy Web Settings client', async () => {
  const pkg = JSON.parse(await readFile(PACKAGE_PATH, 'utf8'))
  assert.equal(pkg.exports['./client'], './client.js')
  assert.ok(pkg.files.includes('client.js'))
  assert.ok(pkg.files.includes('assets'))
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-ui-settings',
  ])
})

test('client registers the Trivy settings section', async () => {
  const { record, exports } = await loadClient()
  assert.equal(record.id, '@local/dsh-tool-trivy')
  assert.deepEqual(Array.from(exports.inject), ['slots', 'connection'])
  const registrations = []
  const rpc = { call: async () => ({ ok: true, value: null }) }
  const context = {
    get(name) {
      assert.equal(name, 'connection')
      return { rpc }
    },
    on: () => () => {},
    slots: {
      inject(name, callback) {
        assert.equal(name, 'settings.section')
        callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  exports.apply(context)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.id, 'trivy')
  assert.equal(registrations[0].options.order, 40)
  assert.equal(registrations[0].options.label, 'Trivy')
  assert.equal(registrations[0].options.inject().rpc, rpc)
  assert.equal(registrations[0].component, exports.TrivySettingsSection)
})

test('settings renders ready status without editable controls', async () => {
  const react = fakeReact([{
    state: 'ready',
    version: '0.69.2',
    minimumVersion: '0.50.0',
    checkedAt: '2026-01-01T00:00:00.000Z',
    message: 'Trivy 0.69.2 is ready.',
  }, false, undefined, 0])
  const { exports } = await loadClient(react)
  const tree = exports.TrivySettingsSection({ rpc: {}, subscribe: () => () => {} })
  assert.match(textOf(tree), /Ready/)
  assert.match(textOf(tree), /0\.69\.2/)
  assert.doesNotMatch(textOf(tree), /Executable/)
  assert.equal(findElements(tree, (node) => node.type === 'input').length, 0)
  const links = findElements(tree, (node) => node.type === 'a')
  assert.equal(links.length, 1)
  assert.equal(links[0].props.href, exports.INSTALL_URL)
  assert.equal(findElements(tree, (node) => node.type === 'button').length, 1)
})

test('settings renders not-found and unsupported guidance', async () => {
  for (const status of [{
    state: 'not-found',
    minimumVersion: '0.50.0',
    checkedAt: '2026-01-01T00:00:00.000Z',
    message: 'DSH could not find `trivy` on its effective PATH.',
  }, {
    state: 'unsupported-version',
    version: '0.49.0',
    minimumVersion: '0.50.0',
    checkedAt: '2026-01-01T00:00:00.000Z',
    message: 'Trivy 0.49.0 is installed, but this plugin requires 0.50.0 or newer.',
  }]) {
    const react = fakeReact([status, false, undefined, 0])
    const { exports } = await loadClient(react)
    const tree = exports.TrivySettingsSection({ rpc: {}, subscribe: () => () => {} })
    assert.match(textOf(tree), status.state === 'not-found' ? /effective PATH/ : /Unsupported version/)
    assert.match(textOf(tree), /never installs or updates/)
  }
})

test('settings renders an unavailable badge after an RPC failure', async () => {
  const react = fakeReact([undefined, false, 'Status request failed', 0])
  const { exports } = await loadClient(react)
  const tree = exports.TrivySettingsSection({ rpc: {}, subscribe: () => () => {} })
  assert.match(textOf(tree), /Unavailable/)
  assert.match(textOf(tree), /Status request failed/)
  assert.doesNotMatch(textOf(tree), /Checking…/)
})

test('initial effect requests status and connection reset subscription disposes', async () => {
  const react = fakeReact([], true)
  const calls = []
  let resetHandler
  let disposed = false
  const { exports } = await loadClient(react)
  const registrations = []
  exports.apply({
    get: () => ({ rpc: { call: async (...args) => { calls.push(args); return { ok: true, value: { state: 'ready' } } } } }),
    on(name, handler) {
      assert.equal(name, 'connection/reset')
      resetHandler = handler
      return () => { disposed = true }
    },
    slots: {
      inject: (_name, callback) => callback(),
      register(options) { registrations.push(options); return () => {} },
    },
  })
  const props = registrations[0].inject()
  exports.TrivySettingsSection(props)
  await Promise.resolve()
  assert.deepEqual(plain(calls[0]), [exports.STATUS_CHANNEL, exports.STATUS_GET, {}])
  assert.equal(typeof resetHandler, 'function')
  for (const cleanup of react.cleanups) cleanup()
  assert.equal(disposed, true)
})

test('Recheck calls the force endpoint and disables while busy', async () => {
  const react = fakeReact([{ state: 'not-found', minimumVersion: '0.50.0' }, false, undefined, 0])
  const calls = []
  const { exports } = await loadClient(react)
  const tree = exports.TrivySettingsSection({
    rpc: { call: async (...args) => { calls.push(args); return { ok: true, value: { state: 'ready' } } } },
    subscribe: () => () => {},
  })
  const [button] = findElements(tree, (node) => node.type === 'button')
  await button.props.onClick()
  assert.deepEqual(plain(calls[0]), [exports.STATUS_CHANNEL, exports.STATUS_RECHECK, {}])

  const busyReact = fakeReact([undefined, true, undefined, 0])
  const loaded = await loadClient(busyReact)
  const busyTree = loaded.exports.TrivySettingsSection({ rpc: {}, subscribe: () => () => {} })
  const [busyButton] = findElements(busyTree, (node) => node.type === 'button')
  assert.equal(busyButton.props.disabled, true)
  assert.equal(textOf(busyButton), 'Checking…')
})
