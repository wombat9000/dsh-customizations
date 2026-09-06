import assert from 'node:assert/strict'
import test from 'node:test'
import { createSnapshotHandler, createSnapshotRpcHandler } from '../src/snapshot.js'
import { hasWorktreeCapability, markIntegrationTool } from '../src/capability.js'

function fixture() {
  const a = { session: { id: 'a', header: { agentPreset: 'copied-coordinator' } } }
  const b = { session: { id: 'b', header: { agentPreset: 'worktree-coordinator' } } }
  const agents = new Map([['a', a], ['b', b]])
  const tools = new Map([[a, markIntegrationTool({})], [b, {}]])
  const ctx = { agents: { get: id => agents.get(id) }, tools: { get: (_name, owner) => tools.get(owner) } }
  const history = new WeakMap([[a, new Map([
    ['old', { path: '/repo/a', jobId: 'old', mode: 'read-only', status: 'completed', task: 'Old assignment', report: 'Old report' }],
    ['new', { path: '/repo/a', jobId: 'new', mode: 'write', status: 'running', task: 'New assignment', report: '' }],
  ])], [b, new Map([['secret', { path: '/repo/a', jobId: 'secret', task: 'SECRET', report: 'SECRET' }]])]])
  const manager = { history, cwd: owner => { assert.equal(agents.get(owner.session.id), owner); return '/repo' },
    activeWorktrees: () => new Map([['/repo/a', { owner: b, jobId: 'secret' }]]),
    git: { inspectWorktrees: async () => ({ repository: '/repo', truncated: false, worktrees: [{ path: '/repo/a', branch: 'a', changes: { count: 0, files: [], truncated: false } }] }) } }
  return { a, b, agents, tools, ctx, manager, call: createSnapshotHandler(ctx, manager) }
}

test('RPC adapter preserves private projection and wraps domain errors without host details', async () => {
  const f = fixture()
  const call = createSnapshotRpcHandler(f.ctx, f.manager)
  const result = await call('snapshot', { sessionId: 'a' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, await f.call('snapshot', { sessionId: 'a' }))
  assert.doesNotMatch(JSON.stringify(result), /secret|SECRET/)
  for (const args of [null, {}, { sessionId: 'a', path: [] }]) {
    assert.deepEqual(await call('snapshot', args), { ok: false, error: {
      code: 'worktrees/read-failed', message: 'Invalid Worktrees request.', details: {},
    } })
  }
  f.ctx.agents.get = () => { throw new Error('SECRET host lookup') }
  const failure = await call('capability', { sessionId: 'a' })
  assert.equal(failure.ok, false)
  assert.doesNotMatch(JSON.stringify(failure), /SECRET/)
})

test('visibility uses exact integration capability, including copied presets, not preset names', async () => {
  const f = fixture()
  assert.equal(hasWorktreeCapability(f.ctx, f.a), true)
  assert.equal(hasWorktreeCapability(f.ctx, f.b), false)
  assert.equal((await f.call('capability', { sessionId: 'a' })).state, 'ready')
  assert.equal((await f.call('capability', { sessionId: 'b' })).state, 'disabled')
  assert.equal((await f.call('capability', { sessionId: 'unloaded' })).state, 'unavailable')
  assert.equal(hasWorktreeCapability(f.ctx, { session: f.a.session }), false)
})

test('snapshot isolates reports, assignments and ids; busy may be global', async () => {
  const f = fixture()
  const result = await f.call('snapshot', { sessionId: 'a' })
  assert.equal(result.worktrees[0].busy, true)
  assert.equal(result.worktrees[0].latestAssignment, 'New assignment')
  assert.deepEqual(result.selected.runs.map(r => r.id), ['new', 'old'])
  assert.equal(result.selected.run.report, null)
  assert.doesNotMatch(JSON.stringify(result), /secret|SECRET/)
  const old = await f.call('snapshot', { sessionId: 'a', path: '/repo/a', runId: 'old' })
  assert.equal(old.selected.run.report, 'Old report')
  const secret = await f.call('snapshot', { sessionId: 'a', runId: 'secret' })
  assert.equal(secret.selected.run, null)
  f.manager.history.get(f.a).delete('old')
  assert.equal((await f.call('snapshot', { sessionId: 'a', runId: 'old' })).selected.run, null)
})

test('path selection never supplies a host cwd; invalid methods and input fail closed', async () => {
  const f = fixture()
  let cwd
  const read = f.manager.git.inspectWorktrees
  f.manager.git.inspectWorktrees = async value => { cwd = value; return read() }
  assert.equal((await f.call('snapshot', { sessionId: 'a', path: '/etc' })).selected, null)
  assert.equal(cwd, '/repo')
  for (const [method, args] of [['dispatch', { sessionId: 'a' }], ['snapshot', { sessionId: 'a', cwd: '/etc' }], ['snapshot', { sessionId: 'a', path: [] }]]) {
    assert.equal((await f.call(method, args)).state, 'error')
  }
})

test('coalesces bounded reads and discards results after capability removal or agent replacement', async () => {
  const f = fixture()
  let resolve, signal, reads = 0
  f.manager.git.inspectWorktrees = (_cwd, options) => { reads++; signal = options.signal; return new Promise(r => { resolve = r }) }
  const one = f.call('snapshot', { sessionId: 'a' })
  const two = f.call('snapshot', { sessionId: 'a' })
  assert.equal(reads, 1)
  assert.ok(signal instanceof AbortSignal)
  f.agents.set('a', { session: f.a.session })
  resolve({ worktrees: [] })
  assert.equal((await one).state, 'disabled')
  assert.equal((await two).state, 'disabled')
})

test('empty history, bounded history and Git errors have explicit snapshots', async () => {
  const f = fixture()
  f.manager.history.delete(f.a)
  assert.deepEqual((await f.call('snapshot', { sessionId: 'a' })).selected.runs, [])
  f.manager.history.set(f.a, new Map(Array.from({ length: 130 }, (_, i) => [String(i), { path: '/repo/a', jobId: String(i), mode: 'write', status: 'completed', task: 'task', report: 'report' }])))
  const result = await f.call('snapshot', { sessionId: 'a' })
  assert.equal(result.selected.runs.length, 100)
  assert.equal(result.selected.runs[0].id, '129')
  f.manager.git.inspectWorktrees = async () => { throw new Error('secret host details') }
  const error = await f.call('snapshot', { sessionId: 'a' })
  assert.equal(error.state, 'error')
  assert.doesNotMatch(JSON.stringify(error), /secret/)
})
