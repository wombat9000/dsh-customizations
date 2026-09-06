import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Readable, Writable } from 'node:stream'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import WorktreeService from '../src/index.js'
import { CHANNEL, createSnapshotHandler, createSnapshotRpcHandler } from '../src/snapshot.js'
import { markIntegrationTool } from '../src/capability.js'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const hostEntry = pathToFileURL(cli.resolve('@deepseek-ai/dsh-client-connection'))
const { HostConnectionService } = await import(hostEntry)
const browserSource = await readFile(new URL('./client.js', hostEntry), 'utf8')
const pluginSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')

// Execute the entire installed browser bundle, unmodified, through its public
// ModuleLoader/apply interface. No copied parser or fabricated rpc.call result.
function load(source, globals = {}) {
  let plugin
  vm.runInNewContext(source, {
    URL, URLSearchParams, crypto: webcrypto, ...globals,
    window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => ({})) } } },
  })
  return plugin
}
const plugin = load(pluginSource)

function transport(handler) {
  let route
  const owner = { effect: fn => fn(), webServer: { register: value => { route = value; return () => {} } } }
  // Only the socket/auth boundary is simulated. The installed host's channel
  // registration, HTTP bridge, request parser and response serializer all run.
  HostConnectionService.prototype.register.call({ requestRejection: () => undefined }, owner, CHANNEL, handler)
  let mutate = response => response
  const send = async (url, init) => {
    const req = Readable.from([Buffer.from(init.body)])
    Object.assign(req, { url: new URL(url).pathname, method: init.method, headers: init.headers })
    const chunks = []
    let status, headers
    const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done() } })
    res.writeHead = (code, value) => { status = code; headers = value }
    await route.handler(req, res)
    return mutate(new Response(Buffer.concat(chunks), { status, headers }))
  }
  let connection
  load(browserSource, { __DSH_TRANSPORT__: { fetch: send } }).apply({ provide: (name, value) => {
    assert.equal(name, 'connection'); connection = value
  } })
  return { rpc: connection.rpc, setMutation: fn => { mutate = fn } }
}

function fixture({ raw = false } = {}) {
  const agent = { session: { id: 'a' } }
  const tool = markIntegrationTool({})
  let enabled = true, live = true, fail = false, lookupFail = false
  const ctx = {
    agents: { get: id => { if (lookupFail) throw new Error('PRIVATE lookup details'); return live && id === 'a' ? agent : undefined } },
    tools: { get: () => enabled ? tool : undefined },
  }
  const manager = {
    cwd: () => '/repo', activeWorktrees: () => new Map(), history: new WeakMap(),
    git: { inspectWorktrees: async () => {
      if (fail) throw new Error('PRIVATE Git details')
      return { repository: '/repo', worktrees: [{ path: '/repo/a', branch: 'feature', changes: { count: 0, files: [] } }] }
    } },
  }
  return { ...transport((raw ? createSnapshotHandler : createSnapshotRpcHandler)(ctx, manager)),
    disable: () => { enabled = false }, unload: () => { live = false },
    failGit: () => { fail = true }, failLookup: () => { lookupFail = true } }
}

// Poll completion is event-driven via the RPC promise, not sleeps or timers.
async function capability(f) {
  let registered, finish
  const done = new Promise(resolve => { finish = resolve })
  let stop
  load(pluginSource, {
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    setInterval() {}, clearInterval() {},
  }).apply({
    connection: { rpc: { call: async (...args) => { try { return await f.rpc.call(...args) } finally { queueMicrotask(() => queueMicrotask(finish)) } } } },
    sessions: { list: { getSnapshot: () => ({ current: 'a' }), subscribe: () => () => {} } },
    slots: {
      inject: (name, callback) => { assert.equal(name, 'conversation.view'); stop = callback() },
      register: options => {
        assert.equal(options.name, 'conversation.view')
        assert.equal(options.id, 'worktrees')
        assert.equal(options.label, 'Worktrees')
        registered = options.inject('a').sessionId
        return () => { registered = undefined }
      },
    },
  })
  await done
  // Allow the capability consumer's rejection/finally chain to settle as well.
  for (let i = 0; i < 5; i++) await Promise.resolve()
  const result = registered
  stop()
  return result
}
async function read(f) {
  let state
  const reader = plugin.createReader(f.rpc, 'a', next => { state = next })
  await reader.refresh()
  reader.dispose()
  return state
}
function assertError(state) {
  assert.equal(state.loading, false)
  assert.equal(state.error, 'Worktrees could not refresh. Try again.')
  assert.equal(state.value, undefined)
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE|No worktrees found/)
}

test('mounted service and installed host/browser RPC register the tab and load the snapshot', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const agent = { session: { id: 'a', header: { cwd: '/repo' } } }
  const tool = markIntegrationTool({})
  ctx.provide('agents', { get: id => id === 'a' ? agent : undefined, list: () => [agent] })
  ctx.provide('tools', { get: () => tool })
  ctx.provide('jobs', { list: () => [] })
  for (const service of ['sessions', 'sandboxPolicy', 'subagents']) ctx.provide(service, {})
  let f
  ctx.provide('connection', { rpc: { handle: (channel, handler) => {
    assert.equal(channel, CHANNEL)
    f = transport(handler)
    return () => {}
  } } })
  await ctx.plugin(WorktreeService).await()
  ctx.get('worktreeWorkers').manager.git = { inspectWorktrees: async () => ({
    repository: '/repo', worktrees: [{ path: '/repo/a', branch: 'feature', changes: { count: 0, files: [] } }],
  }) }
  assert.ok(f, 'service registers its RPC adapter')
  assert.equal(await capability(f), 'a')
  const state = await read(f)
  assert.equal(state.value.state, 'ready')
  assert.equal(state.value.worktrees[0].branch, 'feature')
  assert.equal(state.value.selected.path, '/repo/a')
  assert.equal(state.error, undefined)
})

test('negative control: original raw host result fails the installed browser parser', async () => {
  const f = fixture({ raw: true })
  await assert.rejects(f.rpc.call(CHANNEL, 'capability', { sessionId: 'a' }), /invalid server-response result/)
  assert.equal(await capability(f), undefined)
  assertError(await read(f))
})

test('disabled and unloaded sessions stay hidden and retain explicit snapshot states', async () => {
  for (const [change, state] of [['disable', 'disabled'], ['unload', 'unavailable']]) {
    const f = fixture(); f[change]()
    assert.equal(await capability(f), undefined)
    assert.equal((await read(f)).value.state, state)
  }
})

test('Git, capability lookup and invalid request failures use safe RPC errors', async () => {
  const f = fixture(); f.failGit()
  const failure = await f.rpc.call(CHANNEL, 'snapshot', { sessionId: 'a' })
  assert.equal(failure.ok, false)
  assert.equal(failure.error.code, 'worktrees/read-failed')
  assert.doesNotMatch(JSON.stringify(failure), /PRIVATE/)
  assertError(await read(f))
  f.failLookup()
  assert.equal(await capability(f), undefined)
  assertError(await read(f))
  const invalid = await fixture().rpc.call(CHANNEL, 'snapshot', { sessionId: 'a', cwd: '/PRIVATE' })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error.message, 'Invalid Worktrees request.')
  assert.doesNotMatch(JSON.stringify(invalid), /PRIVATE/)
})

test('malformed envelopes, payloads, server failures and transport failures fail honestly', async () => {
  const mutations = [
    async response => { const body = await response.json(); return Response.json({ ...body, result: { state: 'ready' } }) },
    async response => { const body = await response.json(); return Response.json({ ...body, rpcId: 'wrong' }) },
    async response => { const body = await response.json(); return Response.json({ ...body, result: { ok: true, value: null } }) },
    async response => { const body = await response.json(); return Response.json({ ...body, result: { ok: false, error: { code: 'internal', message: 'PRIVATE', details: {} } } }) },
    () => new Response('PRIVATE', { status: 500 }),
    () => { throw new Error('PRIVATE network failure') },
  ]
  for (const mutate of mutations) {
    const f = fixture(); f.setMutation(mutate)
    assert.equal(await capability(f), undefined)
    assertError(await read(f))
  }
})
