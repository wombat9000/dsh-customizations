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
import { nativeAgents } from './native-agents.js'

// Owner boundary: real DispatchService, store, Git (temporary repositories and a
// bare fixture remote), and the Connection RPC handler. Git runs through a
// GitWorld backed by the test process; the real DSH subprocess/fs/sandbox world
// is exercised in world.test.js. Agents, activity reservations, cancellation,
// inboxes, and turns use the exact native rc.3 implementation, with a pre-step
// hook that completes each turn without inference. The session controller and
// worktree service are controlled boundaries; preset.test.js owns composition.

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

async function harness(
  t,
  {
    presets = ['standard', 'dispatch', 'dispatch-worker'],
    failWorktree = false,
    retain = true,
    gate,
    createGate = async () => {},
    worktreeGate = async () => {},
    nativeDirectory = false,
    automaticDispose = true,
  } = {},
) {
  const native = await nativeAgents(t, { workingDirectory: nativeDirectory })
  const agents = new Map()
  const directories = new Map()
  const delivered = []
  const defaultSaves = []
  let created = 0
  const makeAgent = async (id, { cwd, preset = 'dispatch-worker', origin } = {}) => {
    const agent = await native.create(id, {
      cwd,
      agentPreset: preset,
      ...(origin ? { origin } : {}),
    })
    for (const [method, mode] of [
      ['followup', 'queue'],
      ['steer', 'steer'],
    ]) {
      const send = agent[method].bind(agent)
      agent[method] = (message) => {
        delivered.push({ to: id, mode, message })
        send(message)
      }
    }
    agents.set(id, agent)
    directories.set(id, cwd)
    return agent
  }
  const controller = {
    async create({ cwd, agentPreset }) {
      await createGate()
      const sessionId = `worker-${++created}`
      await makeAgent(sessionId, { cwd, preset: agentPreset })
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
    async create(agent, { name, from }, signal) {
      worktreeCalls.push({ agent: agent.id, name, from, model: agent.model.current() })
      if (failWorktree) throw new Error('disk full')
      const source = directories.get(agent.id)
      const path = join(source, '..', `wt-${name.replaceAll('/', '-')}`)
      git(source, 'worktree', 'add', '-b', name, path, from)
      directories.set(agent.id, await realpath(path))
      if (native.directoryService) await native.directoryService.set(agent, path, signal)
      await worktreeGate(agent)
      return { path: await realpath(path), branch: name, baseCommit: from, repositoryRoot: source }
    },
  }
  const sessions = new Sessions(
    () => controller,
    () => native.directoryService ?? { get: (session) => directories.get(session.id) },
    () => llm,
    () => native.presetRegistry,
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
  if (automaticDispose) t.after(() => service.dispose())
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
    ...native,
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
  const h = await harness(t)
  const coordinator = await h.makeAgent('coord-1', { cwd: main, preset: 'dispatch' })
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
  const h = await harness(t)
  const coordinator = await h.makeAgent('coord-1', { cwd: main, preset: 'dispatch' })
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

  const standalone = await h.makeAgent('lonely', { cwd: main })
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

test('active follow-ups and reports reject cwd drift during inspection without changing authority', async (t) => {
  let pause
  let paused
  const gate = async (_session, _cwd, args) => {
    if (pause && args[0] === 'rev-parse' && args.includes('--git-common-dir')) {
      const held = pause
      pause = undefined
      paused()
      await held
    }
  }
  const { h, coordinator, workerId, worker, main } = await managedWorker(t, { gate })
  const assigned = h.directories.get(workerId)
  const previous = await h.service.status(coordinator, workerId)
  const active = await h.holdTurn(worker)
  const driftDuring = async (operation) => {
    let resume
    pause = new Promise((done) => (resume = done))
    const reached = new Promise((done) => (paused = done))
    const outcome = operation().then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await reached
    h.directories.set(workerId, main)
    resume()
    const result = await outcome
    assert.ok(result.error, 'the effect must not use an inspection of the previous cwd')
    assert.match(result.error.message, /directory|checkout/i)
    h.directories.set(workerId, assigned)
  }
  const before = h.delivered.length
  await driftDuring(() =>
    h.service.send(coordinator, {
      workerId,
      assignmentId: previous.assignmentId,
      message: 'must not reach main',
    }),
  )
  await driftDuring(() =>
    h.service.report(worker, {
      assignmentId: previous.assignmentId,
      kind: 'done',
      summary: 'must not close the task',
    }),
  )
  assert.equal(h.delivered.length, before, 'neither a follow-up nor coordinator report is enqueued')
  const after = await h.service.status(coordinator, workerId)
  assert.equal(after.assignmentId, previous.assignmentId)
  assert.equal(after.assignmentOpen, true)
  assert.equal(after.workState, previous.workState)
  assert.equal(after.lastReport, undefined)
  // Active workers still accept both operations once their directory is stable.
  assert.equal(
    (
      await h.service.send(coordinator, {
        workerId,
        assignmentId: previous.assignmentId,
        message: 'stable active follow-up',
      })
    ).accepted,
    true,
  )
  assert.equal(
    (
      await h.service.report(worker, {
        assignmentId: previous.assignmentId,
        kind: 'progress',
        summary: 'stable active report',
      })
    ).delivered,
    true,
  )
  await active.release()
})

test('ownership is exclusive across coordinators and survives racing adoption', async (t) => {
  const { main } = await repository(t)
  const h = await harness(t)
  const a = await h.makeAgent('coord-a', { cwd: main, preset: 'dispatch' })
  const b = await h.makeAgent('coord-b', { cwd: main, preset: 'dispatch' })
  const wtPath = join(main, '..', 'adopt-wt')
  git(main, 'worktree', 'add', '-b', 'adopt', wtPath)
  await h.makeAgent('existing', { cwd: await realpath(wtPath) })
  await h.makeAgent('on-main', { cwd: main })
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
  const h = await harness(t, { failWorktree: true })
  const coordinator = await h.makeAgent('coord-1', { cwd: main, preset: 'dispatch' })
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
  assert.equal(
    h.service.isProvisioning(failed.workerSessionId),
    true,
    'an unclaimed partial worker stays guarded',
  )

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
  const h = await harness(t)
  const delegated = await h.makeAgent('child', {
    cwd: main,
    preset: 'dispatch',
    origin: 'subagent',
  })
  await assert.rejects(h.service.list(delegated), /Delegated agents/)
  const coordinator = await h.makeAgent('coord', { cwd: main, preset: 'dispatch' })
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
  const h = await harness(t, options)
  const coordinator = await h.makeAgent('coord-a', { cwd: repo.main, preset: 'dispatch' })
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
  const { h, coordinator, workerId, worker, main } = await managedWorker(t, { gate })
  const b = await h.makeAgent('coord-b', { cwd: main, preset: 'dispatch' })
  const finishFollowup = Promise.withResolvers()
  h.nextSteps.set(
    workerId,
    ({ signal }) =>
      new Promise((done) => {
        finishFollowup.promise.then(done)
        signal.addEventListener('abort', done, { once: true })
      }),
  )
  const { assignmentId } = await h.service.status(coordinator, workerId)
  let resume
  pause = new Promise((done) => (resume = done))
  const reached = new Promise((done) => (paused = done))
  const order = []
  const sending = h.service
    .send(coordinator, { workerId, assignmentId, message: 'from A' })
    .then((value) => (order.push('send'), value))
  await reached // A's admission is inspecting the checkout
  const releasing = h.service.release(coordinator, { workerId }).then(
    () => assert.fail('release must not hand off the native turn started by this follow-up'),
    (error) => (order.push('release-refused'), error),
  )
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(order, [], 'release cannot complete while A is admitted')
  resume()
  const sent = await sending
  assert.match((await releasing).message, /active or has queued input/)
  assert.deepEqual(
    order,
    ['send', 'release-refused'],
    'A delivered while it still owned the worker',
  )
  assert.equal(sent.accepted, true)
  finishFollowup.resolve()
  await worker.whenIdle()
  await h.service.release(coordinator, { workerId })
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
  const busy = await h.holdTurn(worker)
  await assert.rejects(
    h.service.prepareAssign(coordinator, 'busy', { workerId, intent: 'n', prompt: 'p' }),
    /idle worker with nothing queued/,
  )
  await busy.release()
  worker.inbox.append('next-turn', h.human('queued'))
  await assert.rejects(
    h.service.prepareAssign(coordinator, 'queued', { workerId, intent: 'n', prompt: 'p' }),
    /idle worker with nothing queued/,
  )
  worker.inbox.clear()
  await h.service.prepareAssign(coordinator, 'second', { workerId, intent: 'n', prompt: 'p' })
  // The worker becomes busy again before approval: execution refuses and changes nothing.
  const active = await h.holdTurn(worker)
  const refused = await approve(h.service, 'coord-a', 'second')
  assert.equal(refused.state, 'failed')
  assert.equal((await h.service.status(coordinator, workerId)).assignmentId, first)
  await active.release()
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

test('adoption follows native preset selections before approval and during the pending save', async (t) => {
  const { main } = await repository(t)
  const h = await harness(t)
  const coordinator = await h.makeAgent('coord-a', { cwd: main, preset: 'dispatch' })
  const directory = join(main, '..', 'blank-candidate')
  git(main, 'worktree', 'add', '-b', 'blank-candidate', directory)
  const candidate = await h.makeAgent('blank-candidate', { cwd: await realpath(directory) })
  const prepare = (callId) =>
    h.service.prepareAdopt(coordinator, callId, {
      sessionId: candidate.id,
      intent: 'adopt blank session',
      prompt: 'must not be delivered',
    })
  await prepare('before-approval')
  await h.presetRegistry.select(candidate, 'standard')
  assert.equal(
    candidate.session.header.agentPreset,
    'dispatch-worker',
    'creation metadata stays unchanged',
  )
  assert.equal(h.presetRegistry.presetForSession(candidate.session), 'standard')
  const refused = await approve(h.service, coordinator.id, 'before-approval')
  assert.equal(refused.state, 'failed')
  assert.match(refused.message, /preset/i)
  assert.equal(h.service.isManaged(candidate.id), false)
  assert.deepEqual(h.delivered, [])
  await assert.rejects(prepare('already-switched'), /dispatch-worker/)
  const described = await h.service.describeCandidate(coordinator, candidate.id)
  assert.equal(described.preset, 'standard')
  assert.equal(described.eligible, false)

  // The same live blank Agent may switch again while a pending claim saves.
  // Native selection, not a fixture map, creates this interference. Reuse the
  // genuine table boundary and require one whole-record restore, not a retry.
  await h.presetRegistry.select(candidate, 'dispatch-worker')
  await prepare('during-save')
  const table = h.service.store.tables.workers
  const put = table.put.bind(table)
  let writes = 0
  table.put = async (key, value) => {
    writes++
    await put(key, value)
    if (writes === 1) await h.presetRegistry.select(candidate, 'standard')
  }
  t.after(() => (table.put = put))
  const restored = await approve(h.service, coordinator.id, 'during-save')
  assert.equal(restored.state, 'failed')
  assert.match(restored.message, /preset/i)
  assert.equal(writes, 2, 'the pending record is restored once')
  assert.equal(candidate.session.header.agentPreset, 'dispatch-worker')
  assert.equal(h.presetRegistry.presetForSession(candidate.session), 'standard')
  assert.equal(h.service.isManaged(candidate.id), false)
  await assert.rejects(h.service.status(coordinator, candidate.id), /not managed/)
  assert.deepEqual(h.delivered, [], 'neither switched session receives an assignment')
  assert.ok(!candidate.session.snapshotEvents().some((event) => event.type === 'turn/start'))
})

test('adoption and new assignments are bound to the reviewed repository and checkout', async (t) => {
  const repoA = await repository(t)
  const repoB = await repository(t)
  const h = await harness(t)
  const a = await h.makeAgent('coord-a', { cwd: repoA.main, preset: 'dispatch' })
  const wtA = join(repoA.main, '..', 'feature-a')
  const wtB = join(repoB.main, '..', 'feature-b')
  git(repoA.main, 'worktree', 'add', '-b', 'feature', wtA)
  git(repoB.main, 'worktree', 'add', '-b', 'feature', wtB)
  await h.makeAgent('candidate', { cwd: await realpath(wtA) })
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
    coordinator.session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [message],
    })
    throw new Error('Host stopped')
  }
  await assert.rejects(
    h.service.report(worker, { assignmentId, kind: 'progress', summary: 'halfway' }),
    /Host stopped/,
  )
  coordinator.inbox.clear() // discard the queued copy; its durable insertion still deduplicates
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
    coordinator.inbox.append('next-turn', message)
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
  const h = await harness(t)
  const coordinator = await h.makeAgent('coord-a', { cwd: repo.main, preset: 'dispatch' })
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
  const h = await harness(t, { retain: false })
  const coordinator = await h.makeAgent('coord-a', { cwd: repo.main, preset: 'dispatch' })
  const base = await h.service.refreshBase(coordinator, { directory: repo.main })
  await assert.rejects(
    h.service.prepareCreate(coordinator, 'c', { intent: 'W', prompt: 'go', base }),
    /retainOnArchive/,
  )
  assert.equal(h.agents.size, 1)
})

test('report delivery is one admission: recovery and release cannot interleave with it', async (t) => {
  const { h, coordinator, workerId, worker } = await managedWorker(t)
  const { assignmentId } = await h.service.status(coordinator, workerId)
  const copies = () =>
    h.delivered.filter(
      (entry) => entry.to === 'coord-a' && entry.message.source?.senderSessionId === workerId,
    )
  // A report and Host-start recovery race for the same pending record: one copy, one identity.
  const reporting = h.service.report(worker, { assignmentId, kind: 'progress', summary: 'a' })
  const recovering = h.service.recover()
  const [result] = await Promise.all([reporting, recovering])
  assert.equal(result.delivered, true)
  assert.equal(copies().length, 1, 'the report is queued exactly once')
  const first = h.service.store.tables.reports.get(result.reportId)
  assert.equal(first.delivery, 'delivered')
  assert.equal(copies()[0].message.id, first.messageId)

  // A pending report whose delivery races a release: the release wins and nothing is
  // queued to the former coordinator, and the dropped record is never overwritten.
  const followup = coordinator.followup
  coordinator.followup = () => {
    throw new Error('coordinator unavailable')
  }
  await assert.rejects(
    h.service.report(worker, { assignmentId, kind: 'progress', summary: 'b' }),
    /coordinator unavailable/,
  )
  coordinator.followup = followup
  const pending = h.service.store.tables.reports.values().find((r) => r.delivery === 'pending')
  const before = copies().length
  const delivering = h.service.deliverReport(pending.id)
  const releasing = h.service.release(coordinator, { workerId })
  assert.equal(await delivering, false)
  await releasing
  assert.equal(copies().length, before, 'nothing reaches the former coordinator')
  const dropped = h.service.store.tables.reports.get(pending.id)
  assert.equal(dropped.delivery, 'dropped')
  assert.equal(dropped.dropReason, 'Worker released.')
})

test('native worktree directory notices survive create admission without allowing competing input or cwd drift', async (t) => {
  for (const interference of ['notice only', 'next-turn', 'steer', 'abort', 'late cwd change']) {
    await t.test(interference, async (t) => {
      const { main } = await repository(t)
      let notice
      let firstMessages
      const h = await harness(t, {
        nativeDirectory: true,
        worktreeGate: async (worker) => {
          // This producer is the actual native workingDirectory.set service,
          // called by the controlled worktree adapter just like native Worktrees.
          assert.equal(worker.status, 'idle')
          assert.equal(worker.inbox.nextTurn.length, 0)
          assert.equal(worker.inbox.nextStep.length, 1)
          notice = worker.inbox.nextStep[0]
          assert.equal(notice.source.kind, 'working-directory')
          assert.ok(!worker.session.snapshotEvents().some((event) => event.type === 'turn/start'))
          h.nextSteps.set(worker.id, ({ messages }) => (firstMessages = messages))
          if (interference === 'next-turn') worker.followup(h.human('competing human input'))
          if (interference === 'steer') worker.steer(h.human('competing human steering'))
          if (interference === 'abort') worker.cancel({ kind: 'user' }, { keepInbox: true })
        },
      })
      const coordinator = await h.makeAgent('coord-a', { cwd: main, preset: 'dispatch' })
      const base = await h.service.refreshBase(coordinator, { directory: main })
      await h.service.prepareCreate(coordinator, 'native-notice', {
        intent: 'W',
        prompt: 'approved task',
        base,
      })
      let writes = 0
      if (interference === 'late cwd change') {
        const table = h.service.store.tables.workers
        const put = table.put.bind(table)
        table.put = async (key, value) => {
          writes++
          await put(key, value)
          if (writes === 1) await h.directoryService.set(h.agents.get(key), main)
        }
        t.after(() => (table.put = put))
      }
      const result = await approve(h.service, coordinator.id, 'native-notice')
      const worker = h.agents.get(result.workerSessionId)
      await worker.whenIdle()
      const assignments = h.delivered.filter(
        (entry) => entry.message.source.kind === 'agent-message',
      )
      if (interference === 'notice only') {
        assert.equal(result.state, 'succeeded', result.message)
        assert.equal(assignments.length, 1)
        assert.equal(firstMessages.length, 2)
        assert.deepEqual(
          firstMessages[0],
          notice,
          'the native notice is retained unchanged for the first turn',
        )
        assert.equal(firstMessages[1].id, assignments[0].message.id)
        assert.equal(worker.inbox.nextStep.length, 0, 'only the native turn consumes the notice')
        assert.equal(h.directoryService.get(worker.session), result.worktree.path)
        // This is a create-only allowance, not a general quiescence exception.
        await h.directoryService.set(worker, main)
        await assert.rejects(
          h.service.prepareAssign(coordinator, 'strict-initial-gate', {
            workerId: worker.id,
            intent: 'n',
            prompt: 'next',
          }),
          /idle worker with nothing queued/,
        )
      } else {
        assert.equal(result.state, 'uncertain', result.message)
        assert.equal(
          assignments.length,
          0,
          'competing activity never receives the approved assignment',
        )
        assert.equal(h.service.isManaged(worker.id), false)
        if (interference === 'late cwd change') {
          assert.match(result.message, /left its created worktree/)
          assert.equal(writes, 2, 'the pending claim is restored once after native cwd drift')
          assert.equal(h.directoryService.get(worker.session), main)
          assert.equal(
            worker.inbox.nextStep.length,
            2,
            'both native directory notices remain pending',
          )
        } else {
          assert.match(result.message, /active or received input|interrupted/)
          if (interference === 'abort') assert.deepEqual(worker.inbox.nextStep, [notice])
          else assert.deepEqual(firstMessages[0], notice)
        }
      }
    })
  }
})

test('native admission excludes a completed turn and cwd change during checkout inspection', async (t) => {
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
  const { h, coordinator, workerId, worker, main } = await managedWorker(t, { gate })
  const { assignmentId } = await h.service.status(coordinator, workerId)
  const assignedDirectory = h.directories.get(workerId)
  const hold = async (callId, action) => {
    let resume
    pause = new Promise((done) => (resume = done))
    const reached = new Promise((done) => (paused = done))
    const result = approve(h.service, 'coord-a', callId)
    await reached
    try {
      await action()
    } finally {
      resume()
    }
    return result
  }
  const endings = () => worker.session.snapshotEvents().filter((event) => event.type === 'turn/end')
  await worker.whenIdle()
  await h.service.prepareAssign(coordinator, 'assign', { workerId, intent: 'n', prompt: 'next' })
  const before = h.delivered.length
  const turnsBefore = endings().length
  let during
  h.nextSteps.set(workerId, () => h.directories.set(workerId, main))
  const refused = await hold('assign', async () => {
    worker.followup(h.human('change working directory'))
    // Baseline: this native turn starts AND completes while the old checkout
    // inspection waits. Candidate: maintenance keeps it queued, not running.
    if (worker.status === 'running') await worker.whenIdle()
    during = { endings: endings(), cwd: h.directories.get(workerId) }
  })
  await worker.whenIdle()
  assert.equal(
    during.endings.length,
    turnsBefore,
    `native turn completed during inspection: ${JSON.stringify(during.endings.at(-1)?.data.reason)}`,
  )
  assert.equal(during.cwd, assignedDirectory, 'a native turn cannot move cwd inside admission')
  assert.equal(refused.state, 'failed')
  assert.match(refused.message, /became active or received input/)
  assert.equal(h.delivered.length, before + 1, 'only the human input is sent, not the replacement')
  assert.equal(endings().at(-1).data.reason.kind, 'completed')
  assert.equal(h.directories.get(workerId), main, 'the human turn runs after maintenance releases')
  h.directories.set(workerId, assignedDirectory)
  const status = await h.service.status(coordinator, workerId)
  assert.equal(status.assignmentId, assignmentId)
  assert.equal(status.assignmentOpen, true)
  assert.ok(!refused.checkpoints.includes('claimed'))

  // Adoption has the same boundary; next-step input also prevents admission.
  const wt = join(main, '..', 'adoptee')
  git(main, 'worktree', 'add', '-b', 'adoptee', wt)
  const candidate = await h.makeAgent('candidate', { cwd: await realpath(wt) })
  await h.service.prepareAdopt(coordinator, 'adopt', {
    sessionId: 'candidate',
    intent: 'i',
    prompt: 'p',
  })
  const adopted = await hold('adopt', () => candidate.steer(h.human('human steering input')))
  await candidate.whenIdle()
  assert.equal(adopted.state, 'failed')
  assert.match(adopted.message, /became active or received input/)
  await assert.rejects(h.service.status(coordinator, 'candidate'), /not managed/)
  assert.equal(h.service.isManaged('candidate'), false)

  // A native cancel aborts maintenance even though its public status is idle.
  await h.service.prepareAssign(coordinator, 'aborted', { workerId, intent: 'n', prompt: 'next' })
  const canceled = await hold('aborted', () => worker.cancel({ kind: 'user' }, { keepInbox: true }))
  assert.equal(canceled.state, 'failed')
  assert.match(canceled.message, /interrupted/)
  assert.equal((await h.service.status(coordinator, workerId)).assignmentId, assignmentId)

  // Maintenance reports idle publicly, but another owner still holds activity.
  await h.service.prepareAssign(coordinator, 'reserved', { workerId, intent: 'n', prompt: 'next' })
  const maintenance = Promise.withResolvers()
  const occupied = worker.runMaintenance(() => maintenance.promise)
  try {
    assert.equal(worker.status, 'idle')
    const reserved = await approve(h.service, 'coord-a', 'reserved')
    assert.equal(reserved.state, 'failed')
    assert.match(reserved.message, /active native work/)
    await assert.rejects(h.service.release(coordinator, { workerId }), /active native work/)
  } finally {
    maintenance.resolve()
    await occupied
  }
})

test('interrupt aborts the active turn and keeps queued and steering input', async (t) => {
  const { h, coordinator, workerId, worker } = await managedWorker(t)
  const active = await h.holdTurn(worker)
  const queued = h.human('queued')
  const steering = h.human('steer')
  worker.inbox.append('next-turn', queued)
  worker.inbox.append('next-step', steering)
  const result = await h.service.interrupt(coordinator, { workerId })
  assert.equal(result.acknowledged, true)
  assert.equal(active.signal.aborted, true, 'the native active turn is actually aborted')
  await active.release()
  assert.deepEqual(worker.inbox.nextTurn, [queued])
  assert.deepEqual(worker.inbox.nextStep, [steering])
  const ended = worker.session
    .snapshotEvents()
    .filter((event) => event.type === 'turn/end')
    .at(-1)
  assert.equal(ended.data.reason.kind, 'aborted')
  worker.inbox.clear()
})

// Rejected writes leave the table unchanged, matching the rc.3 storage-domain
// durability-before-memory contract. Faults belong at this dependency boundary,
// not in Dispatch's assignment logic.
function rejectNextPut(t, table, matches, message) {
  const put = table.put.bind(table)
  let failures = 0
  table.put = async (key, value) => {
    if (failures === 0 && matches(value)) {
      failures++
      throw new Error(message)
    }
    return put(key, value)
  }
  t.after(() => (table.put = put))
  return () => failures
}

test('one rejected claim save leaves the previous assignment current, open, and usable', async (t) => {
  const { h, coordinator, workerId, worker } = await managedWorker(t)
  const previous = await h.service.status(coordinator, workerId)
  const next = await h.service.prepareAssign(coordinator, 'save-failure', {
    workerId,
    intent: 'replacement',
    prompt: 'must not be delivered',
  })
  const failures = rejectNextPut(t, h.service.store.tables.workers, () => true, 'claim save failed')
  const before = h.delivered.length
  const refused = await approve(h.service, coordinator.id, 'save-failure')
  assert.equal(failures(), 1, 'only one transient write fails')
  assert.equal(refused.state, 'failed')
  assert.match(refused.message, /claim save failed/)
  assert.equal(h.delivered.length, before, 'a rejected claim never delivers the replacement')
  const status = await h.service.status(coordinator, workerId)
  assert.equal(status.assignmentId, previous.assignmentId)
  assert.equal(status.assignmentOpen, true, 'the failed replacement does not close the old task')
  assert.equal(status.workState, previous.workState)
  await assert.rejects(
    h.service.report(worker, {
      assignmentId: next.assignmentId,
      kind: 'done',
      summary: 'not mine',
    }),
    /not this session's current Dispatch assignment/,
  )
  assert.equal(
    (
      await h.service.send(coordinator, {
        workerId,
        assignmentId: previous.assignmentId,
        message: 'continue the original task',
      })
    ).accepted,
    true,
  )
  await h.service.report(worker, {
    assignmentId: previous.assignmentId,
    kind: 'progress',
    summary: 'original task still works',
  })
  assert.equal((await h.service.status(coordinator, workerId)).stateSource, 'worker')
})

test('input during the pending claim save restores old authority or leaves a guarded uncertainty', async (t) => {
  for (const failRestore of [false, true]) {
    await t.test(failRestore ? 'restore fails' : 'restore succeeds', async (t) => {
      const { h, coordinator, workerId, worker } = await managedWorker(t)
      const previous = await h.service.status(coordinator, workerId)
      const next = await h.service.prepareAssign(coordinator, 'late-input', {
        workerId,
        intent: 'next',
        prompt: 'must not be delivered',
      })
      const table = h.service.store.tables.workers
      const put = table.put.bind(table)
      let writes = 0
      table.put = async (key, value) => {
        writes++
        if (writes === 2 && failRestore) throw new Error('restore failed')
        await put(key, value)
        if (writes === 1) worker.followup(h.human('human input during claim persistence'))
      }
      t.after(() => (table.put = put))
      const before = h.delivered.length
      const result = await approve(h.service, coordinator.id, 'late-input')
      await worker.whenIdle()
      assert.equal(writes, 2, 'one pending claim and one restore, with no write retry')
      assert.equal(result.state, failRestore ? 'uncertain' : 'failed')
      assert.equal(
        h.delivered.length,
        before + 1,
        'only the competing human input reaches the worker',
      )
      const status = await h.service.status(coordinator, workerId)
      assert.equal(status.assignmentId, failRestore ? next.assignmentId : previous.assignmentId)
      assert.equal(status.assignmentOpen, !failRestore)
      if (failRestore) {
        assert.match(status.eligibility, /pending/i)
        await assert.rejects(
          h.service.send(coordinator, {
            workerId,
            assignmentId: next.assignmentId,
            message: 'unsafe',
          }),
          /pending/i,
        )
        await assert.rejects(
          h.service.report(worker, {
            assignmentId: next.assignmentId,
            kind: 'done',
            summary: 'unsafe',
          }),
          /pending/i,
        )
      }
    })
  }
})

test('delivery confirmation failure leaves pending authority and recovery never replays the assignment', async (t) => {
  const { h, coordinator, workerId, worker } = await managedWorker(t)
  const next = await h.service.prepareAssign(coordinator, 'confirmation-failure', {
    workerId,
    intent: 'next',
    prompt: 'delivered exactly once despite uncertainty',
  })
  const table = h.service.store.tables.workers
  const put = table.put.bind(table)
  let writes = 0
  table.put = async (key, value) => {
    if (++writes === 2) throw new Error('confirmation save failed')
    return put(key, value)
  }
  t.after(() => (table.put = put))
  const before = h.delivered.length
  const result = await approve(h.service, coordinator.id, 'confirmation-failure')
  await worker.whenIdle()
  assert.equal(result.state, 'uncertain')
  assert.match(result.message, /confirmation save failed/)
  assert.equal(h.delivered.length, before + 1, 'the assignment was already enqueued once')
  const status = await h.service.status(coordinator, workerId)
  assert.equal(status.assignmentId, next.assignmentId)
  assert.equal(status.assignmentOpen, false)
  assert.match(status.eligibility, /pending/i)
  await assert.rejects(
    h.service.send(coordinator, { workerId, assignmentId: next.assignmentId, message: 'unsafe' }),
    /pending/i,
  )
  await assert.rejects(
    h.service.report(worker, { assignmentId: next.assignmentId, kind: 'done', summary: 'unsafe' }),
    /pending/i,
  )
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
  assert.equal(h.delivered.length, before + 1, 'recovery never replays an uncertain assignment')
  assert.equal((await restarted.status(coordinator, workerId)).assignmentOpen, false)
})

test('a failed session-created checkpoint retains the known native session ID and uncertainty', async (t) => {
  const { main } = await repository(t)
  const h = await harness(t)
  const coordinator = await h.makeAgent('coord-a', { cwd: main, preset: 'dispatch' })
  const base = await h.service.refreshBase(coordinator, { directory: main })
  await h.service.prepareCreate(coordinator, 'checkpoint-failure', {
    intent: 'W',
    prompt: 'go',
    base,
  })
  const failures = rejectNextPut(
    t,
    h.service.store.tables.proposals,
    (proposal) =>
      proposal.state === 'executing' && proposal.checkpoints.at(-1) === 'session-created',
    'session-created checkpoint failed',
  )
  const failed = await approve(h.service, coordinator.id, 'checkpoint-failure')
  assert.equal(failures(), 1)
  assert.equal(
    failed.workerSessionId,
    'worker-1',
    'the known created ID survives checkpoint failure',
  )
  assert.equal(failed.state, 'uncertain', 'a native effect already succeeded')
  assert.ok(h.agents.has(failed.workerSessionId), 'the exact retained session is discoverable')
  assert.match(failed.message, /session-created checkpoint failed/)
  assert.deepEqual(h.worktreeCalls, [], 'there is no automatic retry or later provisioning effect')
  assert.deepEqual(h.delivered, [])
  assert.equal(
    h.service.isProvisioning(failed.workerSessionId),
    true,
    'unclaimed work stays guarded',
  )
})

test('shutdown closes storage even when expiring a pending proposal fails', async (t) => {
  const { main } = await repository(t)
  const h = await harness(t, { automaticDispose: false })
  const coordinator = await h.makeAgent('coord-a', { cwd: main, preset: 'dispatch' })
  const base = await h.service.refreshBase(coordinator, { directory: main })
  await h.service.prepareCreate(coordinator, 'pending', { intent: 'W', prompt: 'go', base })
  const failures = rejectNextPut(
    t,
    h.service.store.tables.proposals,
    (proposal) => proposal.state === 'expired',
    'expiry save failed',
  )
  let closes = 0
  const close = h.service.store.close.bind(h.service.store)
  h.service.store.close = async () => {
    closes++
    await close()
  }
  const disposing = h.service.dispose()
  assert.equal(h.service.dispose(), disposing, 'shutdown has one shared lifetime')
  await assert.rejects(disposing, /expiry save failed/)
  assert.equal(failures(), 1)
  assert.equal(closes, 1, 'expiry errors do not leak the domain handle')
  await assert.rejects(
    h.service.store.transaction(() => undefined),
    /storage is closed/,
  )
})

test('shutdown waits for in-flight provisioning to record its worker before closing storage', async (t) => {
  let release
  let entered
  const held = new Promise((done) => (release = done))
  const reached = new Promise((done) => (entered = done))
  let holdNext = false
  const repo = await repository(t)
  const h = await harness(t, {
    createGate: async () => {
      if (!holdNext) return
      holdNext = false
      entered()
      await held // native session creation takes no abort signal
    },
  })
  const coordinator = await h.makeAgent('coord-a', { cwd: repo.main, preset: 'dispatch' })
  const base = await h.service.refreshBase(coordinator, { directory: repo.main })
  await h.service.prepareCreate(coordinator, 'create', { intent: 'W', prompt: 'go', base })
  await h.service.prepareCreate(coordinator, 'late', { intent: 'L', prompt: 'go', base })
  holdNext = true
  const rpc = createRpcHandler(h.service)
  const card = async (callId) =>
    (await rpc('status', { sessionId: 'coord-a', callId }, new AbortController().signal, owner))
      .value
  const decide = async (callId) => {
    const view = await card(callId)
    return rpc(
      'decide',
      {
        sessionId: 'coord-a',
        callId,
        proposalId: view.proposalId,
        digest: view.digest,
        decision: 'approve',
      },
      new AbortController().signal,
      owner,
    )
  }
  assert.equal((await decide('create')).ok, true)
  await reached
  let closed = false
  const disposing = h.service.dispose().then(() => (closed = true))
  await new Promise((done) => setTimeout(done, 50))
  assert.equal(closed, false, 'storage stays open while provisioning is in flight')
  const late = await decide('late')
  assert.equal(late.ok, false, 'no new effect is admitted during shutdown')
  release()
  await disposing
  const proposal = h.service.store.tables.proposals.values().find((p) => p.callId === 'create')
  assert.equal(proposal.state, 'uncertain')
  assert.ok(proposal.workerSessionId, 'the partial worker is discoverable from its proposal')
  assert.deepEqual(proposal.checkpoints, ['approved', 'session-created'])
  assert.match(proposal.message, /no worktree was created/)
  assert.deepEqual(h.worktreeCalls, [])
})
