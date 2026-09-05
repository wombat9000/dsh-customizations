import assert from 'node:assert/strict'
import test from 'node:test'
import { WorktreeManager } from '../src/index.js'

const defer = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function fixture() {
  const parent = { session: { id: 'parent', header: { cwd: '/repo' } } }
  const sibling = { session: { id: 'other', header: { cwd: '/repo' } } }
  const agents = new Map([['parent', parent], ['other', sibling]])
  const jobs = new Map()
  const starts = []
  let mode = 'danger-full-access'
  let admissionError
  let creates = 0
  const ctx = {
    agents: { get: id => agents.get(id), list: () => [...agents.values()] },
    sandboxPolicy: { resolve: () => ({ mode, workspaceRoot: '/repo' }) },
    jobs: { start(spec) {
      if (admissionError) throw admissionError
      const id = `job-${jobs.size + 1}`
      const hooks = spec.run()
      const record = { ...hooks, id, owner: spec.owner, kind: spec.kind, label: spec.label, status: 'running' }
      record.done = hooks.done.then(outcome => { Object.assign(record, outcome); return outcome })
      jobs.set(id, record)
      return id
    }, list(owner) { return [...jobs.values()].filter(job => job.owner === owner) } },
  }
  const rows = ['/repo', '/repo/.dsh/worktrees/a', '/repo/.dsh/worktrees/b'].map(path => ({ path, branch: path.split('/').at(-1) }))
  const git = {
    listWorktrees: async () => ({ repository: '/repo', commonDir: '/repo/.git', worktrees: rows }),
    createWorktree: async () => { creates++; return { worktree: rows[1] } },
    resolveWorktree: async (_cwd, path) => {
      const worktree = rows.find(row => row.path === path)
      if (!worktree || path === '/repo') throw new Error('Not a linked worktree')
      return { worktree }
    },
  }
  const manager = new WorktreeManager(ctx, {
    git,
    async startWorker(_ctx, request) {
      const done = defer()
      const cleaned = defer()
      const item = { request, done, cleaned, disposed: false }
      starts.push(item)
      request.signal.addEventListener('abort', () => done.resolve({ status: 'killed' }), { once: true })
      return { result: done.promise, async dispose() { await cleaned.promise; item.disposed = true } }
    },
    async settleRun(run) { const outcome = await run.result; await run.dispose(); return outcome },
  })
  return { ctx, manager, parent, sibling, jobs, starts, git, setMode(v) { mode = v }, deny(v) { admissionError = v }, get creates() { return creates } }
}
const task = (name = 'a') => ({ worktree: `/repo/.dsh/worktrees/${name}`, task: 'Implement feature', mode: 'write' })
async function finish(f, id, index, output = 'Tests passed') {
  f.starts[index].done.resolve({ status: 'completed', output })
  f.starts[index].cleaned.resolve()
  return f.jobs.get(id).done
}

test('create requires exact live parent and Full access, without automatic escalation', async () => {
  const f = fixture()
  f.setMode('workspace-write')
  await assert.rejects(f.manager.create(f.parent, 'a'), /Full access/)
  assert.equal(f.creates, 0)
  await assert.rejects(f.manager.create({ session: f.parent.session }, 'a'), /exact live/)
  f.setMode('danger-full-access')
  await f.manager.create(f.parent, 'a')
  assert.equal(f.creates, 1)
})

test('background dispatch permits different worktrees, locks same worktree across parents until cleanup', async () => {
  const f = fixture()
  const a = await f.manager.dispatch(f.parent, task())
  const b = await f.manager.dispatch(f.parent, task('b'))
  assert.notEqual(a.jobId, b.jobId)
  assert.equal(f.jobs.get(a.jobId).owner, f.parent)
  await assert.rejects(f.manager.dispatch(f.sibling, task()), /active assignment/)
  f.starts[0].done.resolve({ status: 'completed', output: 'done' })
  await Promise.resolve()
  await assert.rejects(f.manager.dispatch(f.parent, task()), /active assignment/)
  f.starts[0].cleaned.resolve()
  await f.jobs.get(a.jobId).done
  assert.equal(f.starts[0].disposed, true)
  const c = await f.manager.dispatch(f.parent, task())
  await finish(f, b.jobId, 1)
  await finish(f, c.jobId, 2)
})

test('replacement manager recovers active worktree fences from the public job registry', async () => {
  const f = fixture()
  const a = await f.manager.dispatch(f.parent, task())
  const replacement = new WorktreeManager(f.ctx, { git: f.git, startWorker: f.manager.startWorker, settleRun: f.manager.settleRun })
  await assert.rejects(replacement.dispatch(f.sibling, task()), /active assignment/)
  assert.equal((await replacement.list(f.parent)).worktrees[1].activeJobId, a.jobId)
  await finish(f, a.jobId, 0)
  const b = await replacement.dispatch(f.parent, task())
  await finish(f, b.jobId, 1)
})

test('list exposes busy state but no other owner job identifiers or reports', async () => {
  const f = fixture()
  const a = await f.manager.dispatch(f.parent, task())
  const own = await f.manager.list(f.parent)
  assert.equal(own.worktrees[1].activeJobId, a.jobId)
  const other = await f.manager.list(f.sibling)
  assert.equal(other.worktrees[1].busy, true)
  assert.equal(other.worktrees[1].activeJobId, undefined)
  assert.equal(other.worktrees[1].latestRun, undefined)
  await finish(f, a.jobId, 0)
})

test('optional handoff is bounded, explicit, same-owner and same-worktree only', async () => {
  const f = fixture()
  const a = await f.manager.dispatch(f.parent, task())
  await finish(f, a.jobId, 0, 'Review: missing validation')
  await assert.rejects(f.manager.dispatch(f.sibling, { ...task(), context_from: a.jobId }), /owned by this agent/)
  await assert.rejects(f.manager.dispatch(f.parent, { ...task('b'), context_from: a.jobId }), /this worktree/)
  const b = await f.manager.dispatch(f.parent, { ...task(), context_from: a.jobId })
  assert.match(f.starts[1].request.handoff, /missing validation/)
  assert.equal(f.starts[1].request.parent, f.parent)
  await finish(f, b.jobId, 1)
})

test('long previous assignments cannot crowd the report out of a bounded handoff', async () => {
  const f = fixture()
  const a = await f.manager.dispatch(f.parent, { ...task(), task: 'x'.repeat(32000) })
  await finish(f, a.jobId, 0, 'Distinctive review finding')
  const b = await f.manager.dispatch(f.parent, { ...task(), context_from: a.jobId })
  assert.match(f.starts[1].request.handoff, /Distinctive review finding/)
  assert.match(f.starts[1].request.handoff, /\[truncated\]/)
  assert.ok(f.starts[1].request.handoff.length <= 32000)
  await finish(f, b.jobId, 1)
})

test('admission failure releases lease without starting worker', async () => {
  const f = fixture()
  f.deny(new Error('capacity exhausted'))
  await assert.rejects(f.manager.dispatch(f.parent, task()), /capacity/)
  assert.equal(f.starts.length, 0)
  f.deny(undefined)
  const a = await f.manager.dispatch(f.parent, task())
  await finish(f, a.jobId, 0)
})

test('tool signal ends at admission; job cancellation reaches worker and awaits disposal', async () => {
  const f = fixture()
  const controller = new AbortController()
  const a = await f.manager.dispatch(f.parent, task(), controller.signal)
  controller.abort()
  assert.equal(f.starts[0].request.signal.aborted, false)
  f.jobs.get(a.jobId).cancel('Stop now')
  assert.equal(f.starts[0].request.signal.aborted, true)
  assert.equal(f.starts[0].disposed, false)
  assert.equal((await f.manager.list(f.parent)).worktrees[1].busy, true)
  f.starts[0].cleaned.resolve()
  assert.equal((await f.jobs.get(a.jobId).done).status, 'killed')
  assert.equal((await f.manager.list(f.parent)).worktrees[1].busy, false)
})

test('startup errors settle as failed and release the checkout lease', async () => {
  const f = fixture()
  f.manager.startWorker = async () => { throw new Error('Cannot enforce sandbox') }
  const a = await f.manager.dispatch(f.parent, task())
  const result = await f.jobs.get(a.jobId).done
  assert.equal(result.status, 'failed')
  assert.match(result.detail, /sandbox/)
  assert.equal((await f.manager.list(f.parent)).worktrees[1].busy, false)
})

test('failed resource cleanup keeps the worktree fenced instead of permitting overlapping work', async () => {
  const f = fixture()
  f.manager.startWorker = async () => ({
    result: Promise.resolve({ status: 'completed', output: 'done' }),
    async dispose() { throw new Error('cleanup failed') },
  })
  const a = await f.manager.dispatch(f.parent, task())
  assert.equal((await f.jobs.get(a.jobId).done).status, 'failed')
  const rows = await f.manager.list(f.parent)
  assert.equal(rows.worktrees[1].busy, true)
  assert.equal(rows.worktrees[1].cleanupUncertain, true)
  const replacement = new WorktreeManager(f.ctx, { git: f.git })
  assert.equal((await replacement.list(f.parent)).worktrees[1].cleanupUncertain, true)
  await assert.rejects(replacement.dispatch(f.parent, task()), /active assignment/)
  await assert.rejects(f.manager.dispatch(f.parent, task()), /active assignment/)
})

test('pre-admission abort and invalid arguments never start a job', async () => {
  const f = fixture()
  await assert.rejects(f.manager.dispatch(f.parent, task(), AbortSignal.abort()), { name: 'AbortError' })
  await assert.rejects(f.manager.dispatch(f.parent, { ...task(), mode: 'full' }), /mode/)
  await assert.rejects(f.manager.dispatch(f.parent, { ...task(), task: 'x'.repeat(32001) }), /32000/)
  assert.equal(f.jobs.size, 0)
})
