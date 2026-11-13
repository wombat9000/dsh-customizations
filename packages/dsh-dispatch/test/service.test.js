import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DispatchService } from '../dist/src/service.js'
import { Repositories, createGitRunner } from '../dist/src/repositories.js'
import { Sessions } from '../dist/src/sessions.js'
import { memoryStore } from '../dist/src/store.js'
import { createRpcHandler } from '../dist/src/routes.js'

// Owner boundary: real DispatchService, store, Git (temporary repositories and a
// bare fixture remote), and the Connection RPC handler. The session controller,
// Agents, and native worktree service are in-process fakes that record calls;
// the real-target composition lives in preset.test.js.

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@e',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@e',
    },
  }).trim()

async function repository(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dispatch-git-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const remote = join(root, 'remote.git')
  const main = join(root, 'main')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['init', '-q', '-b', 'main', main])
  await writeFile(join(main, 'README.md'), 'one\n')
  git(main, 'add', '.')
  git(main, 'commit', '-m', 'one')
  git(main, 'remote', 'add', 'origin', remote)
  git(main, 'push', '-u', 'origin', 'main')
  git(main, 'remote', 'set-head', 'origin', 'main')
  return { root, remote, main }
}

function harness(
  t,
  { presets = ['standard', 'dispatch', 'dispatch-worker'], failWorktree = false } = {},
) {
  const agents = new Map()
  const directories = new Map()
  const delivered = []
  let created = 0
  const makeAgent = (id, { cwd, preset = 'dispatch-worker', status = 'idle', origin } = {}) => {
    const agent = {
      id,
      status,
      session: {
        id,
        header: { cwd, agentPreset: preset, ...(origin ? { origin } : {}) },
        snapshotEvents: () => [],
      },
      followup: (message) => delivered.push({ to: id, mode: 'queue', message }),
      steer: (message) => delivered.push({ to: id, mode: 'steer', message }),
      cancel: () => {},
    }
    agents.set(id, agent)
    directories.set(id, cwd)
    return agent
  }
  const controller = {
    async create({ cwd, agentPreset }) {
      const sessionId = `worker-${++created}`
      makeAgent(sessionId, { cwd, preset: agentPreset })
      return { sessionId, agentPreset }
    },
    async resolveAgent(id) {
      const agent = agents.get(id)
      return agent ? { agent } : { error: { message: 'Unknown session.' } }
    },
    async selectModel({ provider, model }) {
      return { selected: { provider, model } }
    },
  }
  const worktreeCalls = []
  const worktrees = {
    async create(agent, { name, from }) {
      worktreeCalls.push({ agent: agent.id, name, from })
      if (failWorktree) throw new Error('disk full')
      const source = directories.get(agent.id)
      const path = join(source, '..', `wt-${name.replaceAll('/', '-')}`)
      git(source, 'worktree', 'add', '-b', name, path, from)
      directories.set(agent.id, await realpath(path))
      return { path: await realpath(path), branch: name, baseCommit: from, repositoryRoot: source }
    },
  }
  const sessions = new Sessions(
    () => controller,
    () => ({ get: (session) => directories.get(session.id) }),
  )
  const service = new DispatchService({
    store: memoryStore(),
    sessions,
    repositories: new Repositories(createGitRunner()),
    worktrees: () => worktrees,
    defaultModel: () => ({ currentSelection: () => ({ provider: 'fixture', model: 'm1' }) }),
    presets: async () => presets,
    hostEpoch: 'epoch-1',
  })
  t.after(() => service.dispose())
  return { service, agents, directories, delivered, makeAgent, worktreeCalls }
}

async function settled(service, coordinatorId, callId) {
  // Execution runs real Git subprocesses after the decision reply; poll its durable state.
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const status = await service.proposalStatus(coordinatorId, callId)
    if (status.state !== 'executing') return status
    await new Promise((done) => setTimeout(done, 10))
  }
  throw new Error('proposal did not settle')
}

const owner = { principal: { kind: 'owner' } }

test('refresh, prepare, reject, and approve once: one worker on its own linked worktree', async (t) => {
  const { main, remote } = await repository(t)
  const h = harness(t)
  const coordinator = h.makeAgent('coord-1', { cwd: main, preset: 'dispatch' })
  const base = await h.service.refreshBase(coordinator, { directory: main })
  assert.equal(base.remote, 'origin')
  assert.equal(base.branch, 'main')
  assert.equal(base.commit, git(remote, 'rev-parse', 'main'))
  // A moving remote: a later refresh pins the new commit without touching the main checkout.
  const other = join(main, '..', 'other')
  execFileSync('git', ['clone', '-q', remote, other])
  await writeFile(join(other, 'two.md'), 'two\n')
  git(other, 'add', '.')
  git(other, 'commit', '-m', 'two')
  git(other, 'push', '-q', 'origin', 'main')
  const before = git(main, 'rev-parse', 'HEAD')
  const moved = await h.service.refreshBase(coordinator, { directory: main })
  assert.notEqual(moved.commit, base.commit)
  assert.equal(moved.commit, git(remote, 'rev-parse', 'main'))
  assert.equal(git(main, 'rev-parse', 'HEAD'), before)
  assert.equal(git(main, 'status', '--porcelain'), '')

  const prompt = 'Implement the thing.\n'.repeat(200)
  const rejected = await h.service.prepareCreate(coordinator, 'call-a', {
    intent: 'A',
    prompt,
    base,
  })
  assert.equal(rejected.state, 'pending')
  assert.equal(h.agents.size, 1, 'preparing creates no session')
  assert.equal(h.worktreeCalls.length, 0)
  const rpc = createRpcHandler(h.service)
  const card = await rpc(
    'status',
    { sessionId: 'coord-1', callId: 'call-a' },
    new AbortController().signal,
    owner,
  )
  assert.equal(card.ok, true)
  assert.equal(card.value.prompt, prompt, 'the complete prompt is on the card')
  const decision = (callId, value, extra = {}) =>
    rpc(
      'decide',
      {
        sessionId: 'coord-1',
        callId,
        proposalId: value.proposalId,
        digest: value.digest,
        decision: 'approve',
        ...extra,
      },
      new AbortController().signal,
      owner,
    )
  const reject = await decision('call-a', card.value, { decision: 'reject' })
  assert.equal(reject.value.state, 'rejected')
  assert.equal(
    (await decision('call-a', card.value)).ok,
    false,
    'a decided card cannot approve later',
  )
  assert.equal(h.agents.size, 1)

  await h.service.prepareCreate(coordinator, 'call-b', {
    intent: 'B',
    prompt,
    base,
    branch: 'feature/b',
  })
  const pending = (
    await rpc(
      'status',
      { sessionId: 'coord-1', callId: 'call-b' },
      new AbortController().signal,
      owner,
    )
  ).value
  // Agent-originated paths and wrong identities never decide.
  const agentPeer = { principal: { kind: 'agent' } }
  assert.equal(
    (
      await rpc(
        'decide',
        {
          sessionId: 'coord-1',
          callId: 'call-b',
          proposalId: pending.proposalId,
          digest: pending.digest,
          decision: 'approve',
        },
        new AbortController().signal,
        agentPeer,
      )
    ).error.code,
    'forbidden',
  )
  assert.equal(
    (await decision('call-b', { ...pending, digest: '0'.repeat(64) })).error.code,
    'expired',
  )
  assert.equal((await decision('other-call', pending)).error.code, 'expired')
  const approvals = await Promise.all([decision('call-b', pending), decision('call-b', pending)])
  assert.equal(approvals.filter((r) => r.ok).length, 1, 'approval is consumed once')
  const done = await settled(h.service, 'coord-1', 'call-b')
  assert.equal(done.state, 'succeeded', done.message)
  assert.deepEqual(done.checkpoints, [
    'approved',
    'session-created',
    'worktree-created',
    'verified',
    'claimed',
    'delivered',
  ])
  assert.equal(h.worktreeCalls.length, 1)
  assert.equal(
    h.worktreeCalls[0].agent,
    done.workerSessionId,
    'the worker Agent creates its own worktree',
  )
  assert.equal(h.directories.get('coord-1'), main, 'coordinator directory is unchanged')

  const workerDir = h.directories.get(done.workerSessionId)
  assert.notEqual(workerDir, main)
  assert.equal(git(workerDir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/b')
  assert.equal(git(workerDir, 'rev-parse', 'HEAD'), base.commit)

  const [first] = h.delivered
  assert.equal(first.to, done.workerSessionId)
  assert.deepEqual(first.message.source, {
    kind: 'agent-message',
    form: 'relay',
    senderSessionId: 'coord-1',
  })
  assert.ok(first.message.content[0].text.endsWith(prompt), 'the exact approved prompt is sent')
  assert.ok(Object.isFrozen(first.message))
})

test('reports bind to the executing worker and its association', async (t) => {
  const { main } = await repository(t)
  const h = harness(t)
  const coordinator = h.makeAgent('coord-1', { cwd: main, preset: 'dispatch' })
  const base = await h.service.refreshBase(coordinator, { directory: main })
  const rpc = createRpcHandler(h.service)
  await h.service.prepareCreate(coordinator, 'c1', { intent: 'W', prompt: 'go', base })
  const card = (
    await rpc('status', { sessionId: 'coord-1', callId: 'c1' }, new AbortController().signal, owner)
  ).value
  await rpc(
    'decide',
    {
      sessionId: 'coord-1',
      callId: 'c1',
      proposalId: card.proposalId,
      digest: card.digest,
      decision: 'approve',
    },
    new AbortController().signal,
    owner,
  )
  const { workerSessionId } = await settled(h.service, 'coord-1', 'c1')
  const worker = h.agents.get(workerSessionId)

  const standalone = h.makeAgent('lonely', { cwd: main })
  await assert.rejects(
    h.service.report(standalone, { kind: 'done', summary: 'x' }),
    /no approved Dispatch assignment/,
  )

  const result = await h.service.report(worker, {
    kind: 'ready-for-review',
    summary: 'Draft PR ready',
    evidence: ['PR #1'],
  })
  assert.equal(result.delivered, true)
  const message = h.delivered.at(-1)
  assert.equal(message.to, 'coord-1', 'recipient comes from the association, not the caller')
  assert.deepEqual(message.message.source, {
    kind: 'agent-message',
    form: 'relay',
    senderSessionId: workerSessionId,
  })
  const status = await h.service.status(coordinator, workerSessionId)
  assert.equal(status.workState, 'ready-for-review')
  assert.equal(status.stateSource, 'worker')
  assert.equal(status.eligible, true)

  // Coordinator administrative status is attributed, not a forged report.
  const admin = await h.service.update(coordinator, {
    workerId: workerSessionId,
    workState: 'done',
    summary: 'merged by user',
  })
  assert.equal(admin.stateSource, 'coordinator')
  assert.match(admin.summary, /^\[coordinator\]/)

  // Leaving the assigned checkout stops Dispatch admission with remediation.
  h.directories.set(workerSessionId, main)
  await assert.rejects(
    h.service.read(coordinator, { workerId: workerSessionId }),
    /left its assigned checkout/,
  )
  await assert.rejects(
    h.service.report(worker, { kind: 'progress', summary: 'x' }),
    /left its assigned checkout/,
  )
})

test('ownership is exclusive across coordinators and survives racing adoption', async (t) => {
  const { main } = await repository(t)
  const h = harness(t)
  const a = h.makeAgent('coord-a', { cwd: main, preset: 'dispatch' })
  const b = h.makeAgent('coord-b', { cwd: main, preset: 'dispatch' })
  const wtPath = join(main, '..', 'adopt-wt')
  git(main, 'worktree', 'add', '-b', 'adopt', wtPath)
  h.makeAgent('existing', { cwd: await realpath(wtPath) })
  h.makeAgent('on-main', { cwd: main })
  await assert.rejects(
    h.service.prepareAdopt(a, 'x', { sessionId: 'on-main', intent: 'i', prompt: 'p' }),
    /main checkout does not qualify/,
  )
  await assert.rejects(
    h.service.prepareAdopt(a, 'self', { sessionId: 'coord-a', intent: 'i', prompt: 'p' }),
    /cannot manage itself/,
  )

  const rpc = createRpcHandler(h.service)
  await h.service.prepareAdopt(a, 'pa', { sessionId: 'existing', intent: 'i', prompt: 'p' })
  await h.service.prepareAdopt(b, 'pb', { sessionId: 'existing', intent: 'i', prompt: 'p' })
  const ca = (
    await rpc('status', { sessionId: 'coord-a', callId: 'pa' }, new AbortController().signal, owner)
  ).value
  const cb = (
    await rpc('status', { sessionId: 'coord-b', callId: 'pb' }, new AbortController().signal, owner)
  ).value
  await Promise.all([
    rpc(
      'decide',
      {
        sessionId: 'coord-a',
        callId: 'pa',
        proposalId: ca.proposalId,
        digest: ca.digest,
        decision: 'approve',
      },
      new AbortController().signal,
      owner,
    ),
    rpc(
      'decide',
      {
        sessionId: 'coord-b',
        callId: 'pb',
        proposalId: cb.proposalId,
        digest: cb.digest,
        decision: 'approve',
      },
      new AbortController().signal,
      owner,
    ),
  ])
  const outcomes = [
    await settled(h.service, 'coord-a', 'pa'),
    await settled(h.service, 'coord-b', 'pb'),
  ]
  assert.equal(
    outcomes.filter((o) => o.state === 'succeeded').length,
    1,
    'only one coordinator acquires the session',
  )
  const winner = outcomes[0].state === 'succeeded' ? a : b
  const loser = winner === a ? b : a
  await assert.rejects(h.service.status(loser, 'existing'), /Another Dispatch coordinator/)
  await assert.rejects(
    h.service.send(loser, { workerId: 'existing', assignmentId: 'x', message: 'hi' }),
    /Another Dispatch coordinator/,
  )
  // Release keeps everything and invalidates the old generation.
  const released = await h.service.release(winner, { workerId: 'existing' })
  assert.deepEqual(released.retained, ['session', 'history', 'branch', 'checkout'])
  assert.equal(git(main, 'rev-parse', '--verify', 'refs/heads/adopt').length > 0, true)
})

test('failures retain artifacts, never retry, and restarts never replay approvals', async (t) => {
  const { main } = await repository(t)
  const h = harness(t, { failWorktree: true })
  const coordinator = h.makeAgent('coord-1', { cwd: main, preset: 'dispatch' })
  const base = await h.service.refreshBase(coordinator, { directory: main })
  await assert.rejects(
    h.service.prepareCreate(coordinator, 'bad', { intent: 'i', prompt: 'p', base, branch: 'main' }),
    /already exists/,
  )
  await assert.rejects(
    h.service.prepareCreate(coordinator, 'big', { intent: 'i', prompt: 'x'.repeat(40_000), base }),
    /exceeds/,
  )
  await assert.rejects(
    h.service.prepareCreate(coordinator, 'np', {
      intent: 'i',
      prompt: 'p',
      base: { commit: 'abc' },
    }),
    /dispatch_refresh_base/,
  )
  const rpc = createRpcHandler(h.service)
  await h.service.prepareCreate(coordinator, 'f', { intent: 'i', prompt: 'p', base })
  const card = (
    await rpc('status', { sessionId: 'coord-1', callId: 'f' }, new AbortController().signal, owner)
  ).value
  await rpc(
    'decide',
    {
      sessionId: 'coord-1',
      callId: 'f',
      proposalId: card.proposalId,
      digest: card.digest,
      decision: 'approve',
    },
    new AbortController().signal,
    owner,
  )
  const failed = await settled(h.service, 'coord-1', 'f')
  assert.equal(failed.state, 'uncertain')
  assert.match(failed.message, /Last confirmed step: session-created/)
  assert.equal(h.worktreeCalls.length, 1, 'no automatic retry')
  assert.ok(h.agents.has(failed.workerSessionId), 'the partial session is retained')
  assert.equal(h.service.isProvisioning(failed.workerSessionId), false)

  // A proposal prepared in an earlier Host lifetime is expired on recovery and cannot be approved.
  await h.service.prepareCreate(coordinator, 'old', { intent: 'i', prompt: 'p', base })
  const old = (
    await rpc(
      'status',
      { sessionId: 'coord-1', callId: 'old' },
      new AbortController().signal,
      owner,
    )
  ).value
  const restarted = new DispatchService({
    store: h.service.store,
    sessions: new Sessions(
      () => undefined,
      () => undefined,
    ),
    repositories: new Repositories(createGitRunner()),
    worktrees: () => undefined,
    defaultModel: () => undefined,
    presets: async () => [],
    hostEpoch: 'epoch-2',
  })
  await restarted.recover()
  const after = await restarted.proposalStatus('coord-1', 'old')
  assert.equal(after.state, 'expired')
  const replay = await createRpcHandler(restarted)(
    'decide',
    {
      sessionId: 'coord-1',
      callId: 'old',
      proposalId: old.proposalId,
      digest: old.digest,
      decision: 'approve',
    },
    new AbortController().signal,
    owner,
  )
  assert.equal(replay.ok, false)
})

test('a delegated agent cannot coordinate and unknown presets are refused', async (t) => {
  const { main } = await repository(t)
  const h = harness(t)
  const delegated = h.makeAgent('child', { cwd: main, preset: 'dispatch', origin: 'subagent' })
  await assert.rejects(h.service.list(delegated), /Delegated agents/)
  const coordinator = h.makeAgent('coord', { cwd: main, preset: 'dispatch' })
  const base = await h.service.refreshBase(coordinator, { directory: main })
  await assert.rejects(
    h.service.prepareCreate(coordinator, 'p', { intent: 'i', prompt: 'p', base, preset: 'nope' }),
    /Unknown preset/,
  )
  await assert.rejects(
    h.service.prepareCreate(coordinator, 'q', {
      intent: 'i',
      prompt: 'p',
      base,
      preset: 'dispatch',
    }),
    /cannot be workers/,
  )
  await assert.rejects(
    h.service.refreshBase(coordinator, { directory: main, remote: 'https://evil' }),
    /configured remotes/,
  )
  const view = await h.service.prepareCreate(coordinator, 'r', { intent: 'i', prompt: 'p', base })
  assert.equal(view.model, 'fixture/m1', 'the resolved default model is shown before approval')
})
