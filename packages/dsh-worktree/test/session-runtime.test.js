import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile, access } from 'node:fs/promises'
import { devNull, tmpdir } from 'node:os'
import * as sessionGit from '../dist/src/session-git.js'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { sessionWorktreeDomain } from '../dist/src/session-store.js'
import { SessionWorktreeRuntime } from '../dist/src/session-runtime.js'
import { WorktreeManager } from '../dist/src/index.js'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const native = async (name) => import(pathToFileURL(cli.resolve(`@deepseek-ai/${name}`)))
const Storage = await native('dsh-storage')
const StorageJson = await native('dsh-storage-json')
const StorageDomain = await native('dsh-storage-domain')
const git = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', '-C', cwd, ...args],
    {
      encoding: 'utf8',
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
        ),
        GIT_CONFIG_GLOBAL: devNull,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
    },
  ).trim()

// Real Git and native JSON/domain persistence. Agent execution and the Web
// controller boundaries are controlled; the real-shell journey owns mounting,
// native Workspace accounting, navigation and browser transport.
async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-session-lifecycle-')))
  let ctx, runtime
  t.after(async () => {
    try {
      await runtime?.dispose()
    } finally {
      try {
        await ctx?.fiber.dispose()
      } finally {
        assert.equal(await realpath(directory), directory)
        await rm(directory, { recursive: true, force: true })
      }
    }
  })
  const repository = join(directory, 'repo')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(repository)
  git(repository, 'init', '-b', 'main')
  git(repository, 'config', 'user.name', 'Fixture')
  git(repository, 'config', 'user.email', 'fixture@example.invalid')
  await writeFile(join(repository, '.gitignore'), '')
  await writeFile(join(repository, 'file.txt'), 'original\n')
  git(repository, 'add', '.')
  git(repository, 'commit', '-m', 'fixture')
  ctx = new Context()
  await ctx.plugin(Storage.default, {}).await()
  await ctx.plugin(StorageJson, { root: join(directory, 'state') }).await()
  await ctx.plugin(StorageDomain, { backend: 'json' }).await()
  const agents = new Map(),
    workspaces = new Map(),
    archived = new Set(),
    jobs = new Map()
  const calls = []
  const plan = {
    get: (agent) => ({ active: agent.plan === true }),
    set: (agent, active) => {
      agent.plan = active
    },
  }
  const approval = {
    config: { policy: 'ask' },
    overrideOf: (session) => session.approval,
    setPolicy: (agent, policy) => {
      agent.session.approval = policy
    },
  }
  const addAgent = (id, cwd, blank = true) => {
    const session = {
      id,
      header: { id, cwd },
      mode: 'danger-full-access',
      append(type, data) {
        if (type === 'sandbox/mode') this.mode = data.mode
      },
    }
    const agent = {
      session,
      status: 'idle',
      blank,
      options: {},
      plan: true,
      ctx: {
        approval,
        get: (name) => (name === 'planMode' ? plan : name === 'approval' ? approval : undefined),
      },
      runMaintenance: (task) => task(new AbortController().signal),
    }
    agents.set(id, agent)
    return agent
  }
  const addWorkspace = (id, path) => {
    const ids = []
    const workspace = {
      id,
      path,
      title: id,
      get sessionIds() {
        return [...ids]
      },
      async setTitle(title) {
        this.title = title
      },
      async detachSession(id) {
        const at = ids.indexOf(id)
        if (at >= 0) ids.splice(at, 1)
      },
      async attachSession(id) {
        if (!ids.includes(id)) ids.push(id)
      },
    }
    workspaces.set(id, workspace)
    return workspace
  }
  const parent = addAgent('source-session', repository)
  const source = addWorkspace('source-workspace', repository)
  await source.attachSession(parent.session.id)
  ctx.provide('agents', { get: (id) => agents.get(id), list: () => [...agents.values()] })
  ctx.provide('jobs', { list: (id) => jobs.get(id) ?? [] })
  ctx.provide('sandboxPolicy', {
    resolve: ({ session }) => ({ mode: session.mode, workspaceRoot: session.header.cwd }),
  })
  ctx.provide('workspaceRegistry', {
    get: (id) => workspaces.get(id),
    list: () => [...workspaces.values()],
    get archivedSessionIds() {
      return [...archived]
    },
    async create(path) {
      return (
        [...workspaces.values()].find((w) => w.path === path) ??
        addWorkspace(`workspace-${workspaces.size}`, path)
      )
    },
    async unarchiveSession(id) {
      archived.delete(id)
    },
  })
  ctx.provide('sessionController', {
    async list() {
      return {
        items: [...agents.values()].map((a) => ({
          sessionId: a.session.id,
          blank: a.blank,
          running: a.status === 'running',
          cwd: a.session.header.cwd,
        })),
      }
    },
    async projections() {
      return {
        values: {
          agentPreset: 'standard',
          modelSelection: {
            next: { provider: 'fixture', model: 'fixture-model', reasoningEffort: 'high' },
          },
        },
      }
    },
    async create(args) {
      calls.push(args)
      const child = addAgent(args.sessionId, workspaces.get(args.workspaceId).path)
      child.session.mode = 'workspace-write'
      child.plan = false
      await workspaces.get(args.workspaceId).attachSession(args.sessionId)
      return { sessionId: args.sessionId }
    },
    async selectModel(args) {
      agents.get(args.sessionId).options = args
    },
    async resolveAgent(id) {
      return agents.has(id) ? { agent: agents.get(id) } : { error: new Error('not found') }
    },
  })
  const manager = new WorktreeManager(ctx)
  const open = async (gitOperations) => {
    runtime = new SessionWorktreeRuntime(
      ctx,
      manager,
      await ctx.storageDomain.open(sessionWorktreeDomain),
      gitOperations,
    )
    return runtime
  }
  await open()
  return {
    ctx,
    manager,
    repository,
    parent,
    agents,
    workspaces,
    archived,
    jobs,
    calls,
    get runtime() {
      return runtime
    },
    async reload(gitOperations) {
      await runtime.dispose()
      return open(gitOperations)
    },
    create: () => runtime.create(parent.session.id, randomUUID()),
  }
}

test('create preserves effective setup, remembers its source workspace and survives storage reload', async (t) => {
  const f = await fixture(t)
  assert.equal((await f.runtime.status('source-session')).defaultEnabled, false)
  const requestId = randomUUID()
  const owned = await f.runtime.create('source-session', requestId)
  assert.notEqual(owned.path, f.repository)
  assert.equal(f.calls[0].agentPreset, 'standard')
  const child = f.agents.get(owned.sessionId)
  assert.equal(child.session.mode, 'danger-full-access')
  assert.equal(child.session.approval, 'ask')
  assert.equal(child.plan, true)
  assert.equal(child.options.model, 'fixture-model')
  assert.equal((await f.runtime.create('source-session', requestId)).sessionId, owned.sessionId)
  assert.equal(f.calls.length, 1, 'a retried creation request does not create another session')
  await f.reload()
  const current = await f.runtime.status(owned.sessionId)
  assert.equal(current.current.path, owned.path)
  assert.equal(current.defaultEnabled, true)
  assert.equal((await f.runtime.status('source-session')).defaultEnabled, true)
  await f.runtime.preference('source-workspace', false)
  await f.reload()
  assert.equal((await f.runtime.status('source-session')).defaultEnabled, false)
})

test('archive removes clean checkout and merged branch; restore repairs membership before unarchiving', async (t) => {
  const f = await fixture(t)
  const owned = await f.create()
  await assert.rejects(f.runtime.cleanup('not-owned'), /no plugin-owned/)
  assert.equal(
    (await f.runtime.cleanup(owned.sessionId)).state,
    'pending',
    'unarchived checkout is retained',
  )
  await access(owned.path)
  f.archived.add(owned.sessionId)
  await f.runtime.reconcile()
  const removed = (await f.runtime.status()).records[0]
  assert.equal(removed.state, 'removed')
  assert.equal(removed.branchDeleted, true)
  await assert.rejects(access(owned.path), { code: 'ENOENT' })
  assert.equal(await f.runtime.beforeStep(f.agents.get(owned.sessionId)), false)
  await f.reload()
  // Reproduce native membership pruning after a missing-directory restart.
  await f.workspaces.get(owned.workspaceId).detachSession(owned.sessionId)
  const restored = await f.runtime.restore(owned.sessionId)
  assert.equal(restored.state, 'active')
  assert.equal(f.archived.has(owned.sessionId), false)
  assert.ok(f.workspaces.get(owned.workspaceId).sessionIds.includes(owned.sessionId))
  assert.equal(git(owned.path, 'rev-parse', 'HEAD'), owned.head)
})

test('dirty archive requires an exact one-shot confirmation; stale files and re-archival invalidate it', async (t) => {
  const f = await fixture(t)
  const owned = await f.create()
  await writeFile(join(owned.path, 'scratch.txt'), 'unsaved')
  f.archived.add(owned.sessionId)
  await f.runtime.reconcile()
  await access(join(owned.path, 'scratch.txt'))
  const preview = await f.runtime.cleanup(owned.sessionId)
  assert.equal(preview.state, 'confirm')
  assert.ok(preview.confirmation.files.includes('scratch.txt'))
  await writeFile(join(owned.path, 'scratch.txt'), 'changed after preview')
  await assert.rejects(f.runtime.cleanup(owned.sessionId, preview.confirmation.id), /Files changed/)
  await access(join(owned.path, 'scratch.txt'))
  await assert.rejects(f.runtime.cleanup(owned.sessionId, preview.confirmation.id), /expired|stale/)
  const next = await f.runtime.cleanup(owned.sessionId)
  f.runtime.archiveChanged([owned.sessionId], [])
  f.runtime.archiveChanged([], [owned.sessionId])
  await assert.rejects(f.runtime.cleanup(owned.sessionId, next.confirmation.id), /expired|stale/)
  const approved = await f.runtime.cleanup(owned.sessionId)
  assert.equal(
    (await f.runtime.cleanup(owned.sessionId, approved.confirmation.id)).state,
    'removed',
  )
  await assert.rejects(access(owned.path), { code: 'ENOENT' })
})

test('worker fences, peer sessions, jobs and permission changes defer cleanup without discarding', async (t) => {
  const f = await fixture(t)
  const owned = await f.create()
  f.archived.add(owned.sessionId)
  f.manager.active.set(owned.path, { owner: f.parent, jobId: 'worker' })
  assert.match((await f.runtime.cleanup(owned.sessionId)).record.message, /worker/)
  f.manager.active.clear()
  const other = {
    ...f.parent,
    session: { ...f.parent.session, id: 'peer', header: { cwd: owned.path } },
  }
  f.agents.set('peer', other)
  assert.match((await f.runtime.cleanup(owned.sessionId)).record.message, /Another unarchived/)
  f.archived.add('peer')
  f.jobs.set('peer', [{ status: 'stopping', label: 'some job' }])
  assert.match((await f.runtime.cleanup(owned.sessionId)).record.message, /background job/)
  f.jobs.clear()
  f.agents.get(owned.sessionId).session.mode = 'workspace-write'
  assert.match((await f.runtime.cleanup(owned.sessionId)).record.message, /Full access/)
  await access(owned.path)
})

test('creation refuses a started session or reduced permissions before Git mutation', async (t) => {
  const f = await fixture(t)
  f.parent.blank = false
  await assert.rejects(f.create(), /first prompt/)
  f.parent.blank = true
  f.parent.session.mode = 'workspace-write'
  await assert.rejects(f.create(), /Full access/)
  assert.equal((await f.runtime.status()).records.length, 0)
  assert.equal(git(f.repository, 'worktree', 'list', '--porcelain').split('worktree ').length, 2)
})

test('large retained outputs do not block execution or nondestructive recovery', async (t) => {
  const f = await fixture(t)
  const owned = await f.create()
  assert.equal(
    git(f.repository, 'status', '--porcelain'),
    '',
    'managed nested checkouts stay out of the source index',
  )
  await writeFile(join(owned.path, 'file.txt'), 'new committed work\n')
  git(owned.path, 'add', '.')
  git(owned.path, 'commit', '-m', 'session commit')
  const head = git(owned.path, 'rev-parse', 'HEAD')
  const { truncate } = await import('node:fs/promises')
  await writeFile(join(owned.path, 'large-output'), '')
  await truncate(join(owned.path, 'large-output'), 65 * 1024 * 1024)
  assert.equal(await f.runtime.beforeStep(f.agents.get(owned.sessionId)), true)
  f.archived.add(owned.sessionId)
  assert.equal((await f.runtime.cleanup(owned.sessionId)).state, 'pending')
  assert.equal((await f.runtime.restore(owned.sessionId)).head, head)
  await access(join(owned.path, 'large-output'))
  assert.equal(f.archived.has(owned.sessionId), false)
})

test('lost removal responses recover from durable ownership and reachable checkpoint refs', async (t) => {
  const f = await fixture(t)
  const owned = await f.create()
  f.archived.add(owned.sessionId)
  await f.reload({
    ...sessionGit,
    async removeOwned(...args) {
      await sessionGit.removeOwned(...args)
      throw new Error('fixture lost response after the Git mutation')
    },
  })
  assert.equal((await f.runtime.cleanup(owned.sessionId)).state, 'removed')
  await f.reload()
  assert.equal((await f.runtime.status()).records[0].state, 'removed')
  await f.runtime.restore(owned.sessionId)
  assert.equal(git(owned.path, 'rev-parse', 'HEAD'), owned.head)
})

test('an unarchived nested session retains its parent checkout and cannot start inside a cleanup fence', async (t) => {
  const f = await fixture(t)
  const owned = await f.create()
  const nested = join(owned.path, 'package')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(nested)
  await writeFile(join(nested, 'nested.txt'), 'nested committed file\n')
  git(owned.path, 'add', '.')
  git(owned.path, 'commit', '-m', 'nested package')
  const peer = {
    ...f.parent,
    session: { ...f.parent.session, id: 'nested-peer', header: { cwd: nested } },
  }
  f.agents.set('nested-peer', peer)
  f.archived.add(owned.sessionId)
  assert.match((await f.runtime.cleanup(owned.sessionId)).record.message, /Another unarchived/)
  await access(join(nested, 'nested.txt'))
  f.manager.checkoutOperations.add(owned.path)
  assert.equal(await f.runtime.beforeStep(peer), false)
  f.manager.checkoutOperations.clear()
})

test('permission revocation at the Git effect boundary keeps the checkout', async (t) => {
  const f = await fixture(t)
  const owned = await f.create()
  f.archived.add(owned.sessionId)
  await f.reload({
    ...sessionGit,
    async removeOwned(...args) {
      f.agents.get(owned.sessionId).session.mode = 'workspace-write'
      return sessionGit.removeOwned(...args)
    },
  })
  const result = await f.runtime.cleanup(owned.sessionId)
  assert.equal(result.state, 'pending')
  assert.match(result.record.message, /authority changed/)
  await access(owned.path)
  assert.notEqual(git(f.repository, 'branch', '--list', owned.branch), '')
})
