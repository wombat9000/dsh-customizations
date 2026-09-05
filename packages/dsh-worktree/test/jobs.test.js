import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import WorktreeService, { WorktreeManager } from '../src/index.js'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

async function fixture(t) {
  const ctx = new Context()
  const owners = new Map()
  ctx.provide('agents', { get: id => owners.get(id), list: () => [...owners.values()] })
  ctx.provide('sessions', {})
  ctx.provide('tools', {})
  ctx.provide('subagents', {})
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'danger-full-access', workspaceRoot: '/repo' }) })
  await ctx.plugin(LocalJobRegistry, { maxConcurrentJobsPerOwner: 2 }).await()
  const jobs = ctx.get('jobs')
  jobs.attachController('worktree-test-controller')
  let parent
  const ownerFiber = ctx.plugin({ name: 'test-owner', apply(ownerCtx) {
    parent = { id: 'parent', session: { id: 'parent', header: { cwd: '/repo' } }, ctx: ownerCtx }
    owners.set(parent.id, parent)
  } })
  await ownerFiber.await()
  const rows = [{ path: '/repo/.dsh/worktrees/a', branch: 'worktree/a' }, { path: '/repo/.dsh/worktrees/b', branch: 'worktree/b' }]
  const git = {
    listWorktrees: async () => ({ repository: '/repo', commonDir: '/repo/.git', worktrees: rows }),
    resolveWorktree: async (_cwd, path) => ({ worktree: rows.find(row => row.path === path) }),
  }
  const workers = []
  const dependencies = {
    git,
    async startWorker(_ctx, request) {
      const completion = deferred()
      let disposed = false
      const worker = { request, completion, get disposed() { return disposed } }
      workers.push(worker)
      request.signal.addEventListener('abort', () => completion.resolve({ output: [], stopReason: 'aborted' }), { once: true })
      return {
        id: `child-${workers.length}`, localAgent: undefined, result: completion.promise,
        async dispose() { disposed = true },
      }
    },
  }
  const serviceFiber = ctx.plugin(WorktreeService)
  await serviceFiber.await()
  const service = ctx.get('worktreeWorkers')
  service.manager = new WorktreeManager(service.ctx, dependencies)
  t.after(async () => { await ctx.fiber.dispose() })
  return { ctx, jobs, parent, ownerFiber, serviceFiber, service, dependencies, workers, rows }
}
const args = path => ({ worktree: path, task: 'Implement and report', mode: 'write' })

test('real job registry stores final report after disposal and emits owner completion once', async t => {
  const f = await fixture(t)
  const notice = deferred()
  const notices = []
  f.jobs.onJobDone((snapshot, owner) => { notices.push({ snapshot, owner }); notice.resolve() })
  const result = await f.service.dispatch(f.parent, args(f.rows[0].path))
  assert.equal(f.jobs.read(result.jobId, f.parent).text, '')
  f.workers[0].completion.resolve({ output: [{ type: 'text', text: 'Implemented; tests pass' }], stopReason: 'completed' })
  await notice.promise
  assert.equal(f.workers[0].disposed, true)
  assert.equal(notices.length, 1)
  assert.equal(notices[0].owner, f.parent)
  assert.equal(notices[0].snapshot.status, 'completed')
  assert.equal(f.jobs.read(result.jobId, f.parent).text, 'Implemented; tests pass')
  assert.equal(f.jobs.read(result.jobId, f.parent).text, 'Implemented; tests pass')
  assert.equal((await f.service.list(f.parent)).worktrees[0].busy, false)
})

test('service unload/reload recovers surviving job fences through public snapshots', async t => {
  const f = await fixture(t)
  const first = await f.service.dispatch(f.parent, args(f.rows[0].path))
  await f.serviceFiber.dispose()
  const replacementFiber = f.ctx.plugin(WorktreeService)
  await replacementFiber.await()
  const replacement = f.ctx.get('worktreeWorkers')
  replacement.manager = new WorktreeManager(replacement.ctx, f.dependencies)
  await assert.rejects(replacement.dispatch(f.parent, args(f.rows[0].path)), /active assignment/)
  assert.equal((await replacement.list(f.parent)).worktrees[0].activeJobId, first.jobId)
  assert.equal(f.jobs.kill(first.jobId, f.parent, 'cancel for test'), 'requested')
  const outcome = await f.jobs.wait(first.jobId, 2000, f.parent)
  assert.equal(outcome.status, 'killed')
  assert.equal(f.workers[0].disposed, true)
  const second = await replacement.dispatch(f.parent, args(f.rows[0].path))
  f.jobs.kill(second.jobId, f.parent)
  await f.jobs.wait(second.jobId, 2000, f.parent)
})

test('disposing the exact parent cancels workers and removes their job records', async t => {
  const f = await fixture(t)
  await f.service.dispatch(f.parent, args(f.rows[0].path))
  await f.service.dispatch(f.parent, args(f.rows[1].path))
  assert.equal(f.jobs.list(f.parent).length, 2)
  await f.ownerFiber.dispose()
  assert.ok(f.workers.every(worker => worker.request.signal.aborted && worker.disposed))
  assert.equal(f.jobs.list(f.parent).length, 0)
})
