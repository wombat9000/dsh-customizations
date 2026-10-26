import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { Session } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import {
  WorktreePreferences,
  mountWorktreePreferences,
  WORKTREE_AVAILABILITY_COMMAND,
} from '../lib/types/worktree-preference.js'
import { readSessionEnvironment, resolveConfig } from '../lib/index.js'
import { probeCheckout } from '../lib/types/ci-host.js'

const require = createRequire(import.meta.url)
const launcherRequire = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const { default: SystemPrompt } = await import(
  pathToFileURL(launcherRequire.resolve('@deepseek-ai/dsh-system-prompt')).href
)
const signal = () => new AbortController().signal
function gate() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture(t) {
  let state = { lastChoice: false, sessions: {} }
  let failure = false
  let initiator
  let native = true
  let probe = async () => 'ready'
  const sessions = new Map()
  const directories = new Map()
  const ctx = {
    sessions: { get: (id) => sessions.get(id) },
    get: (key) =>
      key === 'agents'
        ? { currentInitiator: () => initiator }
        : key === 'workingDirectory'
          ? { get: (session) => directories.get(session.id) ?? session.header.cwd }
          : key === 'worktrees' && native
            ? { create() {} }
            : undefined,
  }
  const store = {
    get: () => state,
    async set(value) {
      if (failure) throw new Error('storage failed')
      state = structuredClone(value)
    },
  }
  const create = (id, meta = {}) => {
    const session = Session.create(id, [], {
      id,
      version: 4,
      createdAt: 1,
      isSeeded: false,
      cwd: '/repo',
      ...meta,
    })
    sessions.set(id, session)
    return session
  }
  const make = () => new WorktreePreferences(ctx, store, (...args) => probe(...args))
  const prefs = make()
  t.after(() => prefs.dispose())
  const read = (id = 'first') => prefs.read({ sessionId: id }, signal())
  const set = async (enabled, id = 'first') => {
    const before = await read(id)
    return prefs.set(
      { sessionId: id, cwd: before.cwd, revision: before.revision, enabled },
      signal(),
    )
  }
  return {
    prefs,
    create,
    read,
    set,
    make,
    ctx,
    sessions,
    directories,
    fail: (value) => {
      failure = value
    },
    initiate: (value) => {
      initiator = value
    },
    probe: (value) => {
      probe = value
    },
    native: (value) => {
      native = value
    },
    state: () => state,
  }
}

test('session choices, remembered defaults and resume stay independent without changing directories', async (t) => {
  const f = fixture(t)
  const first = f.create('first')
  await f.prefs.initialize(first, true)
  assert.equal((await f.read()).enabled, false)
  assert.equal(f.prefs.guidance('first'), '')
  await f.set(true)
  assert.match(f.prefs.guidance('first'), /create_worktree/)
  assert.match(f.prefs.guidance('first'), /uncommitted/)
  const fresh = f.create('fresh')
  await f.prefs.initialize(fresh, true)
  assert.equal((await f.read('fresh')).enabled, true)
  const restored = f.create('restored')
  await f.prefs.initialize(restored, false)
  assert.equal(
    (await f.read('restored')).enabled,
    false,
    'missing historical choice does not adopt the new default',
  )
  const reopened = f.make()
  t.after(() => reopened.dispose())
  await reopened.initialize(first, false)
  assert.match(reopened.guidance('first'), /Worktree mode is on/)
  f.directories.set('first', '/task-worktree')
  const off = await f.set(false)
  assert.equal(off.cwd, '/task-worktree')
  assert.equal(f.prefs.guidance('first'), '')
  assert.equal(f.state().lastChoice, false)
  assert.equal((await f.read('fresh')).enabled, true, 'changing one session never rewrites another')
  assert.equal(f.directories.get('first'), '/task-worktree', 'Off never switches cwd')
  const child = f.create('child', {
    origin: 'subagent',
    delegationDepth: 1,
    parentSession: 'first',
  })
  await f.prefs.initialize(child, true)
  assert.equal(f.prefs.guidance('child'), '')
  await assert.rejects(f.read('child'), /top-level/)
})

test('eligibility, stale requests, storage errors and agent calls never silently save a preference', async (t) => {
  const f = fixture(t)
  await f.prefs.initialize(f.create('first'), true)
  for (const [result, message] of [
    ['not-repo', /not a Git/],
    ['no-head', /first Git commit/],
    [null, /unavailable/],
  ]) {
    f.probe(async () => result)
    const status = await f.read()
    assert.equal(status.available, false)
    assert.match(status.reason, message)
    await assert.rejects(f.set(true), message)
  }
  f.probe(async () => 'ready')
  f.native(false)
  await assert.rejects(f.set(true), /Git Worktrees bundle/)
  assert.equal((await f.read()).available, false)
  f.native(true)
  const stale = await f.read()
  await f.set(true)
  await assert.rejects(f.prefs.set({ ...stale, enabled: false }, signal()), /changed/)
  f.fail(true)
  await assert.rejects(f.set(false), /storage failed/)
  assert.equal((await f.read()).enabled, true)
  assert.equal(f.state().lastChoice, true)
  f.fail(false)
  f.initiate({})
  await assert.rejects(f.set(false), /Only you/)
  f.initiate(undefined)
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(
    f.prefs.set({ ...(await f.read()), enabled: false }, aborted.signal),
    /abort/i,
  )
  assert.equal((await f.read()).enabled, true)
  f.probe(async () => 'not-repo')
  assert.equal(
    (await f.set(false)).enabled,
    false,
    'Off remains available if a saved On becomes ineligible',
  )
})

test('late probes cannot save against another cwd or a replaced session', async (t) => {
  const f = fixture(t)
  await f.prefs.initialize(f.create('first'), true)
  for (const change of [() => f.directories.set('first', '/other'), () => f.create('first')]) {
    f.directories.clear()
    const started = gate()
    const finish = gate()
    f.probe(async () => {
      started.resolve()
      await finish.promise
      return 'ready'
    })
    const pending = f.prefs.set(
      { sessionId: 'first', cwd: '/repo', revision: 0, enabled: true },
      signal(),
    )
    await started.promise
    change()
    finish.resolve()
    await assert.rejects(pending, /changed/)
    assert.equal(f.state().sessions.first.enabled, false)
  }
})

test('availability probe observes real Git, including unborn and linked checkouts, without inherited Git selectors', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-worktree-preference-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repo = join(directory, 'repo')
  const ordinary = join(directory, 'ordinary')
  await mkdir(repo)
  await mkdir(ordinary)
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  const git = (...args) =>
    execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: 'pipe' })
  git('init', '-b', 'main')
  const probe = (cwd) =>
    execFileSync('bash', ['-c', WORKTREE_AVAILABILITY_COMMAND], {
      cwd,
      encoding: 'utf8',
      env: { ...env, GIT_DIR: join(repo, '.git'), GIT_WORK_TREE: repo },
    })
  assert.equal(probe(ordinary), 'not-repo')
  assert.equal(probe(repo), 'no-head')
  await writeFile(join(repo, 'tracked.txt'), 'base\n')
  git('add', '.')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'base')
  await writeFile(join(repo, 'tracked.txt'), 'user changes\n')
  const linked = join(directory, 'linked')
  git('worktree', 'add', '-b', 'task', linked)
  assert.equal(probe(repo), 'ready')
  assert.equal(probe(linked), 'ready')
  assert.equal(git('status', '--porcelain'), ' M tracked.txt\n')
})

test('Environment and CI sample the effective native cwd, not the immutable original header', async () => {
  const session = { header: { cwd: '/original' } }
  let cwd = '/linked'
  const sampled = []
  const ctx = {
    sessions: { get: () => session },
    get: () => ({ get: () => cwd }),
    shell: {
      resolve: (spec) => spec,
      async execute(spec) {
        sampled.push(spec.workdir)
        return {
          result: async () => ({
            exitCode: 0,
            timedOut: false,
            aborted: false,
            stdout: { text: '__DSH_NOT_REPO__\n', truncated: false },
          }),
        }
      },
    },
  }
  const environment = await readSessionEnvironment(
    ctx,
    { sessionId: 'first' },
    resolveConfig(),
    signal(),
  )
  assert.deepEqual(sampled, ['/linked'])
  assert.equal(environment.cwd, '/linked')
  const text =
    '/linked\n__DSH_CI_HEAD__\n' +
    'a'.repeat(40) +
    '\n__DSH_CI_BRANCH__\ntask\n__DSH_CI_REMOTES__\n'
  const host = {
    sessions: ctx.sessions,
    directory: () => cwd,
    probe: async (path) => {
      assert.equal(path, '/linked')
      return text
    },
  }
  assert.equal((await probeCheckout(host, 'first', signal())).checkout.cwd, '/linked')
  host.probe = async () => {
    cwd = '/another'
    return text
  }
  assert.equal(
    await probeCheckout(host, 'first', signal()),
    null,
    'cwd change invalidates a late checkout probe',
  )
})

// Real Cordis event lifetime and native prompt registry; controlled storage is
// the failure-injection boundary. No provider or process runs in these tests.
async function mounted(t, failure = false) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt, {}).await()
  const sessions = new Map()
  const make = (id, meta = {}) => {
    const session = Session.create(
      id,
      [],
      {
        version: 4,
        id,
        createdAt: 1,
        cwd: '/repo',
        isSeeded: false,
        ...meta,
      },
      0,
    )
    sessions.set(id, session)
    return session
  }
  const existing = make('existing')
  let state = { lastChoice: true, sessions: {} }
  let closed = false
  ctx.provide('sessions', { get: (id) => sessions.get(id), list: () => [...sessions.values()] })
  ctx.provide('storageDomain', {
    async open(spec) {
      assert.doesNotThrow(() => spec.global.schema.parse(state))
      return {
        global: {
          get() {
            if (closed) throw new Error('closed store')
            return state
          },
          async set(value) {
            if (failure) throw new Error('disk failure')
            state = structuredClone(value)
          },
        },
        async close() {
          closed = true
        },
      }
    },
  })
  return { ctx, make, existing, state: () => state, closed: () => closed }
}

test('failed optional storage initialization leaves real prompt assembly usable', async (t) => {
  const f = await mounted(t, true)
  await assert.rejects(mountWorktreePreferences(f.ctx), /disk failure/)
  assert.equal(f.closed(), true)
  const assembly = await f.ctx.systemPrompt.assemble({
    agent: { id: f.existing.id, session: f.existing },
  })
  assert.equal(
    assembly.sections.some((section) => section.name === 'session-environment:worktree-preference'),
    false,
  )
})

test('real serial creation initializes fresh sessions and forks but not resumed histories', async (t) => {
  const f = await mounted(t)
  const prefs = await mountWorktreePreferences(f.ctx)
  assert.equal(f.state().sessions.existing.enabled, false)
  for (const [id, source, seeded, expected] of [
    ['fresh', 'startup', false, true],
    ['fork', 'startup', true, true],
    ['history', 'resume', true, false],
  ]) {
    const session = f.make(id, { isSeeded: seeded })
    await f.ctx.serial('agent/created', { agent: { id, session }, source })
    assert.equal(f.state().sessions[id].enabled, expected)
    const assembly = await f.ctx.systemPrompt.assemble({ agent: { id, session } })
    const text =
      assembly.sections.find(
        (section) => section.name === 'session-environment:worktree-preference',
      )?.text ?? ''
    assert.equal(text.includes('create_worktree'), expected)
  }
  await prefs.dispose()
  const after = await f.ctx.systemPrompt.assemble({ agent: { id: 'fresh' } })
  assert.ok(after.sections.every((section) => !section.text.includes('create_worktree')))
})
