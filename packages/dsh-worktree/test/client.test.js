import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createSnapshotHandler } from '../src/snapshot.js'
import { markIntegrationTool } from '../src/capability.js'
import { apply as applyTools } from '../src/tools.js'
let plugin
vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => ({})) } } },
})
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

test('reader shows loading, rejects stale responses, preserves selection and cleans up', async () => {
  const requests = [], states = []
  const reader = plugin.createReader({ call: (_channel, _method, args) => new Promise(resolve => requests.push({ args, resolve })) }, 'a', state => states.push(state))
  const first = reader.refresh({ path: '/repo/a', runId: 'old' })
  assert.equal(states.at(-1).loading, true)
  const second = reader.refresh({ path: '/repo/b' })
  requests[1].resolve({ sessionId: 'a', state: 'ready', marker: 'new', selected: { path: '/repo/b', run: { id: 'b-run' } } })
  await second
  requests[0].resolve({ sessionId: 'a', state: 'ready', marker: 'stale', selected: { path: '/repo/a', run: { id: 'old' } } })
  await first
  assert.equal(states.at(-1).value.marker, 'new')
  const third = reader.refresh()
  assert.equal(requests[2].args.path, '/repo/b')
  assert.equal(requests[2].args.runId, 'b-run')
  reader.dispose()
  const count = states.length
  requests[2].resolve({ sessionId: 'a' })
  await third
  assert.equal(states.length, count)
})

// Exercise the real server selection projection, not a response that ignores args.
function readerFixture({ empty = false } = {}) {
  const agent = { session: { id: 'a' } }, tool = markIntegrationTool({})
  const history = new Map()
  const addRun = (id, path = '/repo/a') => history.set(id, { jobId: id, path, task: id, status: 'completed', mode: 'write' })
  if (!empty) addRun('initial')
  let paths = ['/repo/a', '/repo/b'], state
  const handler = createSnapshotHandler({ agents: { get: () => agent }, tools: { get: () => tool } }, {
    history: new WeakMap([[agent, history]]), cwd: () => '/repo', activeWorktrees: () => new Map(),
    git: { inspectWorktrees: async () => ({ repository: '/repo', worktrees: paths.map(path => ({ path, changes: { count: 0, files: [] } })) }) },
  })
  const requests = []
  const reader = plugin.createReader({ call: (_channel, method, args) => { requests.push(args); return handler(method, args) } }, 'a', next => { state = next })
  return { reader, requests, history, addRun, setPaths: next => { paths = next }, get value() { return state.value } }
}

test('implicit checkout and run stay selected after new runs and checkout disappearance', async () => {
  const f = readerFixture()
  await f.reader.refresh()
  assert.equal(f.value.selected.run.id, 'initial')
  f.addRun('new')
  await f.reader.refresh()
  assert.equal(f.value.selected.run.id, 'initial')
  f.setPaths(['/repo/b'])
  await f.reader.refresh()
  assert.equal(f.value.selected, null)
  await f.reader.refresh()
  assert.equal(f.requests.at(-1).path, '/repo/a')
  assert.equal(f.value.selected, null)
})

test('explicit checkout pins its default run; explicit unavailable selections never fall back', async () => {
  const f = readerFixture()
  f.addRun('b-first', '/repo/b')
  await f.reader.refresh({ path: '/repo/b' })
  f.addRun('b-new', '/repo/b')
  await f.reader.refresh()
  assert.equal(f.value.selected.run.id, 'b-first')
  await f.reader.refresh({ path: '/repo/b', runId: 'b-new' })
  f.history.delete('b-new')
  await f.reader.refresh()
  assert.equal(f.value.selected.run, null)
  await f.reader.refresh()
  assert.equal(f.requests.at(-1).runId, 'b-new')
  assert.equal(f.value.selected.run, null)
  await f.reader.refresh({ path: '/missing', runId: 'missing' })
  await f.reader.refresh()
  assert.equal(f.requests.at(-1).path, '/missing')
  assert.equal(f.value.selected, null)
})

test('empty history selects the first arriving run, then pins it', async () => {
  const f = readerFixture({ empty: true })
  await f.reader.refresh()
  assert.equal(f.value.selected.run, null)
  f.addRun('first')
  await f.reader.refresh()
  assert.equal(f.value.selected.run.id, 'first')
  f.addRun('second')
  await f.reader.refresh()
  assert.equal(f.value.selected.run.id, 'first')
})

test('reader reports transport and mismatched-session errors without stale data', async () => {
  let state
  const reader = plugin.createReader({ call: async () => ({ sessionId: 'other' }) }, 'a', next => { state = next })
  await reader.refresh()
  assert.ok(state.error)
  assert.equal(state.value, undefined)
})

test('copied-preset tab follows real integration definitions and same-session capability changes', async () => {
  const tools = new Map()
  const install = () => applyTools({ tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } }, worktreeWorkers: {} })
  const copy = { session: { id: 'copy', header: { agentPreset: 'my-copy' } } }
  const standard = { session: { id: 'standard', header: { agentPreset: 'worktree-coordinator' } } }
  const agents = new Map([['copy', copy], ['standard', standard]])
  const handler = createSnapshotHandler({ agents: { get: id => agents.get(id) }, tools: { get: (name, owner) => owner === copy ? tools.get(name) : undefined } }, {})
  let current = 'copy', notify, tick, registered
  const stop = plugin.watchCapability({
    sessions: { list: { getSnapshot: () => ({ current }), subscribe: cb => { notify = cb; return () => {} } } },
    rpc: { call: (_channel, method, args) => handler(method, args) },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    interval: cb => { tick = cb }, clear() {},
    register: id => { registered = id; return () => { registered = undefined } },
  })
  try {
    await flush(); assert.equal(registered, undefined)
    install(); tick(); await flush(); assert.equal(registered, 'copy')
    tools.delete('worktree_list'); notify(); await flush(); assert.equal(registered, undefined)
    tools.set('worktree_list', { name: 'worktree_list' }); tick(); await flush(); assert.equal(registered, undefined)
    install(); tick(); await flush(); assert.equal(registered, 'copy')
    current = 'standard'; notify(); assert.equal(registered, undefined)
    await flush(); assert.equal(registered, undefined)
    current = 'copy'; notify(); await flush(); assert.equal(registered, 'copy')
    agents.delete('copy'); tick(); await flush(); assert.equal(registered, undefined)
  } finally { stop() }
})

test('tab registration follows current capability; subscription, timers and pending checks clean up', async () => {
  let current = 'a', callback, tick, removed = 0, off = 0, cleared = 0
  const events = new Map(), pending = [], registered = []
  const document = { visibilityState: 'visible', addEventListener: (name, cb) => events.set(name, cb), removeEventListener: name => events.delete(name) }
  const stop = plugin.watchCapability({ document,
    sessions: { list: { getSnapshot: () => ({ current }), subscribe: cb => { callback = cb; return () => off++ } } },
    rpc: { call: (_channel, _method, args) => new Promise(resolve => pending.push({ args, resolve })) },
    register: id => { registered.push(id); return () => removed++ },
    interval: cb => { tick = cb; return 1 }, clear: () => cleared++,
  })
  await flush()
  current = 'b'; callback(); await flush()
  pending[0].resolve({ sessionId: 'a', state: 'ready' }); await flush()
  assert.equal(registered.length, 0)
  pending[1].resolve({ sessionId: 'b', state: 'ready' }); await flush()
  assert.deepEqual(registered, ['b'])
  current = 'c'; callback()
  assert.equal(removed, 1)
  await flush()
  pending[2].resolve({ sessionId: 'c', state: 'disabled' }); await flush()
  assert.equal(registered.length, 1)
  document.visibilityState = 'hidden'; tick(); await flush()
  assert.equal(pending.length, 3)
  document.visibilityState = 'visible'; events.get('visibilitychange')(); await flush()
  stop()
  pending[3].resolve({ sessionId: 'c', state: 'ready' }); await flush()
  assert.equal(registered.length, 1)
  assert.equal(off, 1); assert.equal(cleared, 1); assert.equal(events.size, 0)
})
