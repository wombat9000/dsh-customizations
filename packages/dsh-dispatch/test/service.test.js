import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { DispatchService } from '../dist/src/service.js'
import { Repositories } from '../dist/src/repositories.js'
import { Sessions } from '../dist/src/sessions.js'
import { memoryStore } from '../dist/src/store.js'
import { createRpcHandler } from '../dist/src/routes.js'

// Owner boundary: real DispatchService, store, Git (temporary repositories and a
// bare fixture remote), and the Connection RPC handler. Git runs through a
// GitWorld backed by the test process; the real DSH subprocess/fs/sandbox world
// is exercised in world.test.js. The session controller, Agents, and native
// worktree service are in-process fakes that record calls; the real-target
// composition lives in preset.test.js.

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

/** GitWorld over the test process; `gate` can pause a chosen command. */
function testWorld(gate = async () => {}) {
  return {
    provider: () => 'test-fs',
    async canonical(path, cwd) {
      const absolute = resolve(cwd ?? '/', path)
      let real
      try {
        real = await realpath(absolute)
      } catch {
        real = absolute
      }
      return { path: real, key: real }
    },
    async git(session, cwd, args, signal, allowed = [0]) {
      await gate(session, cwd, args)
      return new Promise((done, fail) =>
        execFile('git', args, { cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
          const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0
          if (!allowed.includes(exitCode)) fail(new Error(`git ${args[0]}: ${stderr}`))
          else done({ stdout, exitCode })
        }),
      )
    },
  }
}

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
  {
    presets = ['standard', 'dispatch', 'dispatch-worker'],
    failWorktree = false,
    retain = true,
    gate,
  } = {},
) {
  const agents = new Map()
  const directories = new Map()
  const delivered = []
  const defaultSaves = []
  let created = 0
  const makeAgent = (id, { cwd, preset = 'dispatch-worker', status = 'idle', origin } = {}) => {
    let selection
    const events = []
    const agent = {
      id,
      status,
      events,
      inbox: { nextTurn: [], nextStep: [] },
      model: {
        current: () => selection,
        select: (value) => {
          selection = { ...value }
        },
      },
      session: {
        id,
        header: { cwd, agentPreset: preset, ...(origin ? { origin } : {}) },
        snapshotEvents: () => events,
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
  }
  const llm = {
    listProviders: () => [{ id: 'fixture' }],
    listModels: async () => [{ id: 'm1' }, { id: 'm2' }],
    resolveCallConfig: async () => ({}),
  }
  const worktreeCalls = []
  const worktrees = {
    config: { retainOnArchive: { get: () => retain } },
    async create(agent, { name, from }) {
      worktreeCalls.push({ agent: agent.id, name, from, model: agent.model.current() })
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
    () => llm,
  )
  const service = new DispatchService({
    store: memoryStore(),
    sessions,
    repositories: new Repositories(testWorld(gate)),
    worktrees: () => worktrees,
    defaultModel: () => ({
      currentSelection: () => ({ provider: 'fixture', model: 'm1' }),
      saveSelection: async (value) => defaultSaves.push(value),
    }),
    presets: async () => presets,
    hostEpoch: 'epoch-1',
  })
  t.after(() => service.dispose())
  return {
    service,
    agents,
    directories,
    delivered,
    makeAgent,
    worktreeCalls,
    defaultSaves,
    sessions,
    worktrees,
  }
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
    h.service.report(standalone, { assignmentId: 'x', kind: 'done', summary: 'x' }),
    /no approved Dispatch assignment/,
  )

  const { assignmentId } = await h.service.status(coordinator, workerSessionId)
  const result = await h.service.report(worker, {
    assignmentId,
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

  // The status card reads the coordinator's own workers through owner-only RPC
  // and never sends, claims, or changes state.
  const sent = h.delivered.length
  const listed = await rpc('workers', { sessionId: 'coord-1' }, new AbortController().signal, owner)
  assert.deepEqual(listed, { ok: true, value: [status] })
  assert.deepEqual(
    (await rpc('workers', { sessionId: 'coord-2' }, new AbortController().signal, owner)).value,
    [],
  )
  const agentPeer = await rpc('workers', { sessionId: 'coord-1' }, new AbortController().signal, {
    principal: { kind: 'agent' },
  })
  assert.equal(agentPeer.ok, false)
  assert.equal(agentPeer.error.code, 'forbidden')
  assert.equal(h.delivered.length, sent)
  assert.deepEqual(await h.service.status(coordinator, workerSessionId), status)

  // Leaving the assigned checkout stops Dispatch admission with remediation.
  const assigned = h.directories.get(workerSessionId)
  h.directories.set(workerSessionId, main)
  await assert.rejects(
    h.service.read(coordinator, { workerId: workerSessionId }),
    /left its assigned checkout/,
  )
  await assert.rejects(
    h.service.report(worker, { assignmentId, kind: 'progress', summary: 'x' }),
    /left its assigned checkout/,
  )
  h.directories.set(workerSessionId, assigned)

  // Coordinator administrative status is attributed, not a forged report.
  const admin = await h.service.update(coordinator, {
    workerId: workerSessionId,
    workState: 'done',
    summary: 'merged by user',
  })
  assert.equal(admin.stateSource, 'coordinator')
  assert.match(admin.summary, /^\[coordinator\]/)
  assert.equal(admin.assignmentOpen, false, 'a terminal administrative state closes the assignment')
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
    repositories: new Repositories(testWorld()),
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

test('a delegated agent cannot coordinate and only dispatch-worker sessions are created', async (t) => {
  const { main } = await repository(t)
  const h = harness(t)
  const delegated = h.makeAgent('child', { cwd: main, preset: 'dispatch', origin: 'subagent' })
  await assert.rejects(h.service.list(delegated), /Delegated agents/)
  const coordinator = h.makeAgent('coord', { cwd: main, preset: 'dispatch' })
  const base = await h.service.refreshBase(coordinator, { directory: main })
  await assert.rejects(
    h.service.prepareCreate(coordinator, 'p', {
      intent: 'i',
      prompt: 'p',
      base,
      preset: 'standard',
    }),
    /only dispatch-worker/,
  )
  assert.deepEqual((await h.service.presets()).presets, ['dispatch-worker'])
  await assert.rejects(
    h.service.prepareCreate(coordinator, 'q', {
      intent: 'i',
      prompt: 'p',
      base,
      preset: 'dispatch',
    }),
    /only dispatch-worker/,
  )
  await assert.rejects(
    h.service.refreshBase(coordinator, { directory: main, remote: 'https://evil' }),
    /configured remotes/,
  )
  const view = await h.service.prepareCreate(coordinator, 'r', { intent: 'i', prompt: 'p', base })
  assert.equal(view.model, 'fixture/m1', 'the resolved default model is shown before approval')
})

// ---- review regressions -------------------------------------------------

async function approve(service, coordinatorId, callId, decision = 'approve') {
  const rpc = createRpcHandler(service)
  const card = (
    await rpc('status', { sessionId: coordinatorId, callId }, new AbortController().signal, owner)
  ).value
  const result = await rpc(
    'decide',
    {
      sessionId: coordinatorId,
      callId,
      proposalId: card.proposalId,
      digest: card.digest,
      decision,
    },
    new AbortController().signal,
    owner,
  )
  assert.equal(result.ok, true, result.error?.message)
  return settled(service, coordinatorId, callId)
}

async function managedWorker(t, options = {}) {
  const repo = await repository(t)
  const h = harness(t, options)
  const coordinator = h.makeAgent('coord-a', { cwd: repo.main, preset: 'dispatch' })
  const base = await h.service.refreshBase(coordinator, { directory: repo.main })
  await h.service.prepareCreate(coordinator, 'create', { intent: 'W', prompt: 'go', base })
  const done = await approve(h.service, 'coord-a', 'create')
  assert.equal(done.state, 'succeeded', done.message)
  const workerId = done.workerSessionId
  return { ...repo, h, coordinator, base, workerId, worker: h.agents.get(workerId) }
}

test('an in-flight targeted operation cannot deliver after an ownership handoff', async (t) => {
  let pause
  let paused
  const gate = async (_session, _cwd, args) => {
    if (pause && args[0] === 'rev-parse' && args.includes('--git-common-dir')) {
      const hold = pause
      pause = undefined
      paused()
      await hold
    }
  }
  const { h, coordinator, workerId, main } = await managedWorker(t, { gate })
  const b = h.makeAgent('coord-b', { cwd: main, preset: 'dispatch' })
  const { assignmentId } = await h.service.status(coordinator, workerId)
  let resume
  pause = new Promise((done) => (resume = done))
  const reached = new Promise((done) => (paused = done))
  const order = []
  const sending = h.service
    .send(coordinator, { workerId, assignmentId, message: 'from A' })
    .then((value) => (order.push('send'), value))
  await reached // A's admission is inspecting the checkout
  const releasing = h.service
    .release(coordinator, { workerId })
    .then((value) => (order.push('release'), value))
  await new Promise((done) => setTimeout(done, 50))
  assert.deepEqual(order, [], 'release cannot complete while A is admitted')
  resume()
  const sent = await sending
  await releasing
  assert.deepEqual(order, ['send', 'release'], 'A delivered while it still owned the worker')
  assert.equal(sent.accepted, true)
  const before = h.delivered.length
  // B adopts the released worker; A's next send, already started, is refused at admission.
  await h.service.prepareAdopt(b, 'adopt-b', { sessionId: workerId, intent: 'i', prompt: 'p' })
  const late = h.service.send(coordinator, { workerId, assignmentId, message: 'late A' }).then(
    () => assert.fail('a send started before the handoff must not deliver after it'),
    (error) => error,
  )
  const adopted = await approve(h.service, 'coord-b', 'adopt-b')
  assert.equal(adopted.state, 'succeeded', adopted.message)
  assert.match((await late).message, /not managed by Dispatch|Another Dispatch coordinator/)
  await assert.rejects(
    h.service.send(coordinator, { workerId, assignmentId, message: 'later A' }),
    /Another Dispatch coordinator/,
  )
  const fromA = h.delivered
    .slice(before)
    .filter((entry) => entry.to === workerId && entry.message.source.senderSessionId === 'coord-a')
  assert.deepEqual(fromA, [], 'no coordinator-A message reaches the worker after the handoff')
})

test('a closed assignment stays closed: status edits never reopen send authority', async (t) => {
  const { h, coordinator, workerId, worker } = await managedWorker(t)
  const { assignmentId } = await h.service.status(coordinator, workerId)
  await h.service.report(worker, { assignmentId, kind: 'done', summary: 'finished' })
  await assert.rejects(
    h.service.send(coordinator, { workerId, assignmentId, message: 'more' }),
    /assignment is closed/,
  )
  await assert.rejects(
    h.service.update(coordinator, { workerId, workState: 'working' }),
    /assignment is closed/,
  )
  const status = await h.service.status(coordinator, workerId)
  assert.equal(status.workState, 'done')
  assert.equal(status.assignmentOpen, false)
  await assert.rejects(
    h.service.send(coordinator, { workerId, assignmentId, message: 'more' }),
    /assignment is closed/,
  )
  await assert.rejects(
    h.service.report(worker, { assignmentId, kind: 'progress', summary: 'again' }),
    /assignment is closed/,
  )
  // Reopening needs the new-assignment approval path.
  await h.service.prepareAssign(coordinator, 'next', { workerId, intent: 'n', prompt: 'next' })
  const next = await approve(h.service, 'coord-a', 'next')
  assert.equal(next.state, 'succeeded', next.message)
  const renewed = await h.service.status(coordinator, workerId)
  assert.equal(renewed.assignmentOpen, true)
  assert.notEqual(renewed.assignmentId, assignmentId)
})

test('reports bind to the named assignment and a busy worker cannot be reassigned', async (t) => {
  const { h, coordinator, workerId, worker } = await managedWorker(t)
  const first = (await h.service.status(coordinator, workerId)).assignmentId
  // While the first task runs, a new assignment cannot be prepared or applied.
  worker.status = 'running'
  await assert.rejects(
    h.service.prepareAssign(coordinator, 'busy', { workerId, intent: 'n', prompt: 'p' }),
    /idle worker with nothing queued/,
  )
  worker.status = 'idle'
  worker.inbox.nextTurn = [{ id: 'queued' }]
  await assert.rejects(
    h.service.prepareAssign(coordinator, 'queued', { workerId, intent: 'n', prompt: 'p' }),
    /idle worker with nothing queued/,
  )
  worker.inbox.nextTurn = []
  await h.service.prepareAssign(coordinator, 'second', { workerId, intent: 'n', prompt: 'p' })
  // The worker becomes busy again before approval: execution refuses and changes nothing.
  worker.status = 'running'
  const refused = await approve(h.service, 'coord-a', 'second')
  assert.equal(refused.state, 'failed')
  assert.equal((await h.service.status(coordinator, workerId)).assignmentId, first)
  worker.status = 'idle'
  await h.service.prepareAssign(coordinator, 'third', { workerId, intent: 'n', prompt: 'p' })
  const applied = await approve(h.service, 'coord-a', 'third')
  assert.equal(applied.state, 'succeeded', applied.message)
  const second = (await h.service.status(coordinator, workerId)).assignmentId
  // A late report from the first task cannot complete the new assignment.
  await assert.rejects(
    h.service.report(worker, { assignmentId: first, kind: 'done', summary: 'old task done' }),
    /not this session's current Dispatch assignment/,
  )
  const status = await h.service.status(coordinator, workerId)
  assert.equal(status.workState, 'working')
  assert.equal(status.assignmentOpen, true)
  await h.service.report(worker, { assignmentId: second, kind: 'done', summary: 'new task done' })
  assert.equal((await h.service.status(coordinator, workerId)).workState, 'done')
})

test('adoption and new assignments are bound to the reviewed repository and checkout', async (t) => {
  const repoA = await repository(t)
  const repoB = await repository(t)
  const h = harness(t)
  const a = h.makeAgent('coord-a', { cwd: repoA.main, preset: 'dispatch' })
  const wtA = join(repoA.main, '..', 'feature-a')
  const wtB = join(repoB.main, '..', 'feature-b')
  git(repoA.main, 'worktree', 'add', '-b', 'feature', wtA)
  git(repoB.main, 'worktree', 'add', '-b', 'feature', wtB)
  h.makeAgent('candidate', { cwd: await realpath(wtA) })
  const view = await h.service.prepareAdopt(a, 'adopt', {
    sessionId: 'candidate',
    intent: 'i',
    prompt: 'p',
  })
  assert.equal(view.target.worktreePath, await realpath(wtA))
  assert.equal(view.target.repositoryRoot, repoA.main)
  assert.equal(view.target.head, git(wtA, 'rev-parse', 'HEAD'))
  // Same branch name, different repository: the unchanged card must not apply there.
  h.directories.set('candidate', await realpath(wtB))
  const drifted = await approve(h.service, 'coord-a', 'adopt')
  assert.equal(drifted.state, 'failed')
  assert.match(drifted.message, /reviewed repository, checkout, branch, and commit/)
  assert.equal(h.delivered.length, 0, 'nothing is delivered to the drifted checkout')
  await assert.rejects(h.service.status(a, 'candidate'), /not managed/)

  // The same holds for a new assignment: a moved HEAD after review is refused.
  h.directories.set('candidate', await realpath(wtA))
  await h.service.prepareAdopt(a, 'adopt-2', { sessionId: 'candidate', intent: 'i', prompt: 'p' })
  assert.equal((await approve(h.service, 'coord-a', 'adopt-2')).state, 'succeeded')
  await h.service.prepareAssign(a, 'assign', { workerId: 'candidate', intent: 'n', prompt: 'p' })
  await writeFile(join(wtA, 'moved.md'), 'x\n')
  git(wtA, 'add', '.')
  git(wtA, 'commit', '-m', 'moved')
  const moved = await approve(h.service, 'coord-a', 'assign')
  assert.equal(moved.state, 'failed')
  assert.match(moved.message, /reviewed repository/)
})

test('report recovery recognizes a copy already admitted to the coordinator inbox', async (t) => {
  const { h, coordinator, workerId, worker } = await managedWorker(t)
  const { assignmentId } = await h.service.status(coordinator, workerId)
  // The busy coordinator admits the queued report (a durable inbox splice), then the Host
  // stops before the delivered checkpoint.
  coordinator.followup = (message) => {
    coordinator.events.push({
      seq: coordinator.events.length + 1,
      type: 'agent/inbox/spliced',
      data: { target: 'next-turn', start: 0, inserted: [message] },
    })
    throw new Error('Host stopped')
  }
  await assert.rejects(
    h.service.report(worker, { assignmentId, kind: 'progress', summary: 'halfway' }),
    /Host stopped/,
  )
  const [pending] = h.service.store.tables.reports.values()
  assert.equal(pending.delivery, 'pending')
  assert.ok(pending.messageId && pending.messageText, 'identity is fixed before delivery')
  let copies = 0
  coordinator.followup = () => copies++
  const restarted = new DispatchService({
    store: h.service.store,
    sessions: h.sessions,
    repositories: new Repositories(testWorld()),
    worktrees: () => h.worktrees,
    defaultModel: () => undefined,
    presets: async () => [],
    hostEpoch: 'epoch-2',
  })
  await restarted.recover()
  assert.equal(copies, 0, 'the admitted copy is not queued again')
  assert.equal(h.service.store.tables.reports.get(pending.id).delivery, 'delivered')

  // A report still waiting in the live inbox is recognized the same way.
  coordinator.followup = (message) => {
    coordinator.inbox.nextTurn = [...coordinator.inbox.nextTurn, message]
    throw new Error('Host stopped')
  }
  await assert.rejects(
    h.service.report(worker, { assignmentId, kind: 'progress', summary: 'more' }),
    /Host stopped/,
  )
  coordinator.followup = () => copies++
  await restarted.recover()
  assert.equal(copies, 0)
  assert.ok(h.service.store.tables.reports.values().every((r) => r.delivery === 'delivered'))
})

test('the approved worker model is pinned on the worker only; the default is never saved', async (t) => {
  const repo = await repository(t)
  const h = harness(t)
  const coordinator = h.makeAgent('coord-a', { cwd: repo.main, preset: 'dispatch' })
  const base = await h.service.refreshBase(coordinator, { directory: repo.main })
  await h.service.prepareCreate(coordinator, 'm2', {
    intent: 'W',
    prompt: 'go',
    base,
    model: 'fixture/m2',
  })
  const done = await approve(h.service, 'coord-a', 'm2')
  assert.equal(done.state, 'succeeded', done.message)
  assert.deepEqual(h.agents.get(done.workerSessionId).model.current(), {
    provider: 'fixture',
    model: 'm2',
  })
  assert.deepEqual(h.worktreeCalls[0].model, { provider: 'fixture', model: 'm2' })
  assert.deepEqual(h.defaultSaves, [], 'the Host default model is unchanged')
  await h.service.prepareCreate(coordinator, 'missing', {
    intent: 'W',
    prompt: 'go',
    base,
    model: 'fixture/absent',
  })
  const missing = await approve(h.service, 'coord-a', 'missing')
  assert.equal(missing.state, 'uncertain')
  assert.match(missing.message, /not available/)
  assert.equal(h.worktreeCalls.length, 1, 'no worktree is created for an unavailable model')
})

test('workers are admitted only when Git Worktrees retains checkouts on archive', async (t) => {
  const repo = await repository(t)
  const h = harness(t, { retain: false })
  const coordinator = h.makeAgent('coord-a', { cwd: repo.main, preset: 'dispatch' })
  const base = await h.service.refreshBase(coordinator, { directory: repo.main })
  await assert.rejects(
    h.service.prepareCreate(coordinator, 'c', { intent: 'W', prompt: 'go', base }),
    /retainOnArchive/,
  )
  assert.equal(h.agents.size, 1)
})
