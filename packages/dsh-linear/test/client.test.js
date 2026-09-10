import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))
const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url))

async function loadClient(react = {}) {
  let record
  const browserWindow = {
    confirm: () => true,
    __ModuleLoader__: { load(value) { record = value } },
  }
  vm.runInNewContext(await readFile(CLIENT_PATH, 'utf8'), { window: browserWindow })
  return {
    browserWindow,
    record,
    exports: record.factory((specifier) => {
      assert.equal(specifier, 'react')
      return react
    }),
  }
}

function fakeReact(stateValues, runEffects = false) {
  let stateIndex = 0
  const updates = []
  return {
    updates,
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity) } },
    useState(initial) {
      const index = stateIndex++
      updates[index] = []
      return [index < stateValues.length ? stateValues[index] : initial, (value) => updates[index].push(value)]
    },
    useEffect(effect) { if (runEffects) effect() },
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

test('package exposes a Web Settings client bundle', async () => {
  const pkg = JSON.parse(await readFile(PACKAGE_PATH, 'utf8'))
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.files.includes('client.js'))
})

test('client registers only a Linear plugin configuration card', async () => {
  const { record, exports } = await loadClient()
  assert.equal(record.id, '@local/dsh-linear')
  assert.deepEqual(Array.from(exports.inject), ['slots', 'connection', 'remote'])
  const registrations = []
  const rpc = { call: async () => ({ ok: true, value: {} }) }
  const ctx = {
    remote: { $on: () => () => {} },
    get(name) { assert.equal(name, 'connection'); return { rpc } },
    on: () => () => {},
    slots: {
      inject(name, callback) { assert.equal(name, 'settings.plugin.item'); callback() },
      register(options, component) { registrations.push({ options, component }); return () => {} },
    },
  }
  exports.apply(ctx)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'settings.plugin.item')
  assert.equal(registrations[0].options.key, 'linear')
  assert.equal(registrations[0].options.id, undefined)
  assert.equal(registrations[0].options.order, 35)
  assert.equal(registrations[0].options.inject().rpc, rpc)
  assert.equal(registrations[0].component, exports.LinearSettingsSection)
})

test('Linear card starts collapsed with its connection controls inside', async () => {
  const react = fakeReact([{
    credential: { configured: true, writable: true, source: 'file' },
    workspace: { id: 'org', name: 'Acme', urlKey: 'acme' },
    viewer: null, live: true,
  }, '', false, undefined, undefined, 0])
  const { exports } = await loadClient(react)
  const tree = exports.LinearSettingsSection({ rpc: {}, subscribe: () => () => {} })
  assert.equal(tree.type, 'details')
  assert.equal(tree.props.open, undefined)
  assert.equal(tree.children[0].type, 'summary')
  assert.match(textOf(tree.children[0]), /^LinearWorkspace connection/)
  assert.equal(findElements(tree, (element) => element.type === 'h2').length, 0)
  const [group] = findElements(tree, (element) => element.props.role === 'group')
  assert.equal(group.props['aria-labelledby'], 'linear-connection-title')
  assert.match(textOf(group), /Workspace connectionConnectedWorkspaceAcme/)
  assert.deepEqual(findElements(group, (element) => element.type === 'button').map(textOf), [
    'Replace and connect', 'Test connection', 'Disconnect',
  ])
})

test('settings card never renders or retains an existing secret', async () => {
  const react = fakeReact([{
    credential: { configured: true, writable: true, source: 'file' },
    workspace: { id: 'org', name: 'Acme', urlKey: 'acme' },
    viewer: null,
    live: false,
  }, '', false, undefined, undefined, 0])
  const { exports } = await loadClient(react)
  const tree = exports.LinearSettingsSection({ rpc: {}, subscribe: () => () => {} })
  const [input] = findElements(tree, (element) => element.type === 'input')
  assert.equal(input.props.type, 'password')
  assert.equal(input.props.value, '')
  assert.match(textOf(tree), /Configured via DSH credential store/)
  assert.equal(JSON.stringify(tree).includes('lin_api_'), false)
})

test('connect sends the draft write-only and clears it after success', async () => {
  const react = fakeReact([
    { credential: { configured: false, writable: true }, workspace: null, viewer: null, live: false },
    '  lin_api_secret  ', false, undefined, undefined, 0,
  ])
  const calls = []
  const { exports } = await loadClient(react)
  const tree = exports.LinearSettingsSection({
    rpc: {
      async call(channel, endpoint, payload) {
        calls.push([channel, endpoint, payload])
        return {
          ok: true,
          value: {
            credential: { configured: true, writable: true, source: 'file' },
            workspace: { id: 'org', name: 'Acme', urlKey: 'acme' },
            viewer: null, live: true,
          },
        }
      },
    },
    subscribe: () => () => {},
  })
  const [connect] = findElements(tree, (element) => element.type === 'button')
  connect.props.onClick()
  await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[
    '/linear-integration', 'connect', { apiKey: 'lin_api_secret' },
  ]])
  assert.ok(react.updates[1].includes(''))
  assert.equal(JSON.stringify(react.updates).includes('lin_api_secret'), false)
})

test('client-side key validation rejects blank and shell-style pastes', async () => {
  const { exports } = await loadClient()
  assert.equal(exports.apiKeyFailure('lin_api_valid'), undefined)
  assert.match(exports.apiKeyFailure(' '), /Enter a Linear API key/)
  assert.match(exports.apiKeyFailure('LINEAR_API_KEY=secret'), /Paste only the API key/)
  assert.match(exports.apiKeyFailure('"secret"'), /Paste only the API key/)
})
