import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { executeOne } from '../../dsh-github/test/approval-fixture.js'
import { installed } from '../../dsh-product-mode/test/fixtures.js'
import { RECORD_VERSION } from '../dist/src/contracts.js'
import { domainStore } from '../dist/src/store.js'
import {
  cli,
  declarations,
  fixture,
  flatten,
  host,
  json,
  patch,
  standardPatch,
} from './fixtures.js'

// Real Loader, preset registry, tool registry/executor, Standard preset, and
// Host-wide GitHub tools. Agents are minted as real scopes under each preset
// and announced through `agent/created` exactly as the registry dispatches it;
// no agent loop, model, subprocess, or network runs.

// Real DSH storage hub, JSON backend, and domain facility: Dispatch records are
// validated by the facility exactly as in a deployed Host.
async function durableStorage(t, ctx) {
  const root = await mkdtemp(join(tmpdir(), 'dispatch-storage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await ctx.plugin((await installed('@deepseek-ai/dsh-storage')).default).await()
  await ctx.plugin(await installed('@deepseek-ai/dsh-storage-json'), { root }).await()
  await ctx.plugin(await installed('@deepseek-ai/dsh-storage-domain'), { backend: 'json' }).await()
  return root
}

async function mountedHost(t) {
  const f = await fixture(t)
  const rows = declarations([standardPatch, patch])
  const mounted = await host(t, f, rows, { before: (ctx) => durableStorage(t, ctx) })
  const roster = mounted.ctx.get('agentPresets')
  const { createScope, scopeTarget } = await installed('@deepseek-ai/dsh-scope')
  const { Session } = await installed('@deepseek-ai/dsh-session')
  let count = 0
  const lease = async (id) => {
    const scope = await roster.acquireScope(id)
    t.after(() => scope[Symbol.asyncDispose]())
    return scope
  }
  const agentIn = async (lease) => {
    const id = `agent-${++count}`
    const session = Session.create(id, undefined, {
      version: 4,
      id,
      createdAt: 0,
      isSeeded: false,
      cwd: f.directory,
    })
    const agent = { id, session, followup() {}, steer() {} }
    const scope = createScope(mounted.ctx, agent, { parent: lease.key })
    t.after(() => scope.dispose())
    agent.ctx = scope.ctx
    await mounted.ctx.serial(scopeTarget(agent, agent), 'agent/created', { agent })
    return agent
  }
  const tools = mounted.ctx.get('tools')
  const names = (key) => [...tools.view(key).visible.keys()].sort()
  return { ...mounted, f, rows, lease, agentIn, tools, names }
}

// Complete durable authority fixture, shared by reopen and native preset-guard
// tests. The guard and storage implementation, not this fixture, enforce it.
function workerRecord(workerId = 'w', admission = 'admitted') {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    version: RECORD_VERSION,
    workerId,
    coordinatorId: 'c',
    generation: 1,
    originalWorkspace: '/fixture/main',
    provider: 'fixture-fs',
    worktreeKey: '/fixture/linked',
    repositoryRoot: '/fixture/main',
    worktreePath: '/fixture/linked',
    branch: 'feature',
    baseCommit: '1'.repeat(40),
    preset: 'dispatch-worker',
    verifiedAt: now,
    assignment: {
      version: RECORD_VERSION,
      id: 'assignment-1',
      workerId,
      coordinatorId: 'c',
      proposalId: 'proposal-1',
      intent: 'fixture task',
      prompt: 'fixture prompt',
      preset: 'dispatch-worker',
      model: 'fixture/m1',
      base: null,
      admission,
      workState: 'working',
      summary: 'fixture progress',
      stateSource: 'worker',
      evidence: ['fixture evidence'],
      updatedAt: now,
    },
  }
}

const definition = (name) => ({
  name,
  description: name,
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: { schema: { type: 'string' }, render: () => [] },
  execute: async () => 'ran',
})

test('publication: one host row, two additive presets, and the Standard notice', async (t) => {
  const f = await fixture(t)
  const manifest = await json(join(f.packaged, 'package.json'))
  assert.equal(manifest.name, '@local/dsh-dispatch')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh'], '0.2.2-rc.3')
  assert.equal((await json(cli.resolve('@deepseek-ai/dsh/package.json'))).version, '0.2.2-rc.3')
  assert.equal(manifest.dependencies, undefined)
  assert.equal(manifest.devDependencies, undefined)
  const own = declarations([join(f.packaged, 'cordis.patch.yml')])
  assert.deepEqual(
    own.map((row) => [row.id, row.name, row.config?.id]),
    [
      ['local-dispatch', '@local/dsh-dispatch', undefined],
      ['local-preset-dispatch', '@deepseek-ai/dsh-agent-preset', 'dispatch'],
      ['local-preset-dispatch-worker', '@deepseek-ai/dsh-agent-preset', 'dispatch-worker'],
    ],
  )
  const webRoot = dirname(cli.resolve('@deepseek-ai/dsh-web-app/package.json'))
  assert.equal(
    await readFile(join(f.packaged, 'presets/dispatch-worker/LICENSE.standard'), 'utf8'),
    await readFile(join(webRoot, 'LICENSE'), 'utf8'),
  )
  // Dispatch Worker = pinned Standard minus delegation and plugin-manager routes, plus guidance and reporting.
  const standard = declarations([standardPatch])[0].config.plugins
  const worker = own[2].config.plugins
  const removed = new Set(['delegation', 'tool-plugin-manager', 'tool-plugin-market'])
  assert.deepEqual(
    worker.filter((row) => !['persona', 'local-dispatch-worker'].includes(row.id)),
    standard.filter((row) => !removed.has(row.id) && row.id !== 'persona'),
  )
  // rc.3 persona templates register only {{provider}} and {{model}}; any other
  // variable throws when the first turn renders the system prompt.
  for (const row of own.slice(1)) {
    const persona = row.config.plugins.find((plugin) => plugin.id === 'persona').config
    const used = `${persona.prefix}\n${persona.suffix}`.match(/\{\{\s*[^}]*\}\}/gu) ?? []
    for (const variable of used) assert.match(variable, /^\{\{\s*(provider|model)\s*\}\}$/u)
  }
  assert.equal(worker.at(-1).name, '@local/dsh-dispatch/worker')
  for (const row of flatten(worker)) assert.notEqual(row.name, '@deepseek-ai/dsh-tool-ralph')
  assert.ok(await readFile(join(f.packaged, 'client.js'), 'utf8'))
})

test(
  'coordinator tools stay restricted with Host-wide and later tools loaded',
  { timeout: 30000 },
  async (t) => {
    const h = await mountedHost(t)
    const coordinator = await h.agentIn(await h.lease('dispatch'))
    const standard = await h.agentIn(await h.lease('standard'))
    const allowed = [
      'ask_user_question',
      'dispatch_add_session',
      'dispatch_create_session',
      'dispatch_find_sessions',
      'dispatch_get_session_status',
      'dispatch_interrupt_session',
      'dispatch_list_presets',
      'dispatch_list_sessions',
      'dispatch_list_workspaces',
      'dispatch_read_session',
      'dispatch_refresh_base',
      'dispatch_remove_session',
      'dispatch_send_message',
      'dispatch_update_session',
      'dispatch_wait_session',
      'skill',
      'todo_write',
    ]
    assert.deepEqual(h.names(coordinator), allowed)
    assert.ok(
      h.names().some((name) => name.startsWith('github_')),
      'GitHub tools are loaded Host-wide',
    )
    assert.ok(h.names(standard).includes('bash'))
    assert.ok(
      !h.names(standard).some((name) => name.startsWith('dispatch_')),
      'Standard is unchanged',
    )

    // A global registered later stays hidden; a tool another plugin adds to the
    // coordinator's own scope is visible (rc.3 limitation) but cannot execute.
    const disposeGlobal = h.tools.register(definition('late_global_tool'))
    t.after(disposeGlobal)
    coordinator.ctx.get('tools').register(definition('late_agent_tool'))
    assert.ok(!h.names(coordinator).includes('late_global_tool'))
    assert.ok(h.names(standard).includes('late_global_tool'))
    const denied = await executeOne(h.tools, 'late_agent_tool', {}, { agent: coordinator })
    assert.match(JSON.stringify(denied), /cannot run late_agent_tool/)
    const github = await executeOne(h.tools, 'github_list_issues', {}, { agent: coordinator })
    assert.equal(github.isError, true, 'a hidden Host-wide tool is not executable')
    assert.equal(
      (await executeOne(h.tools, 'late_global_tool', {}, { agent: standard })).value,
      'ran',
    )
    const presets = await executeOne(h.tools, 'dispatch_list_presets', {}, { agent: coordinator })
    assert.match(JSON.stringify(presets), /dispatch-worker/)
  },
)

test(
  'worker preset keeps coding tools, adds dispatch_report, and blocks orchestration',
  { timeout: 30000 },
  async (t) => {
    const h = await mountedHost(t)
    const worker = await h.agentIn(await h.lease('dispatch-worker'))
    const standard = await h.agentIn(await h.lease('standard'))
    const added = h.names(worker).filter((name) => !h.names(standard).includes(name))
    const missing = h.names(standard).filter((name) => !h.names(worker).includes(name))
    assert.deepEqual(added, ['dispatch_report'])
    for (const name of ['subagent', 'subagent_fork', 'workflow', 'send_message'])
      assert.ok(missing.includes(name))
    for (const name of ['bash', 'edit', 'todo_write']) assert.ok(h.names(worker).includes(name))
    const disposeTeam = h.tools.register(definition('team_task_create'))
    t.after(disposeTeam)
    const team = await executeOne(h.tools, 'team_task_create', {}, { agent: worker })
    assert.match(JSON.stringify(team), /Dispatch workers cannot use team_task_create/)
    const report = await executeOne(
      h.tools,
      'dispatch_report',
      { assignmentId: 'a', kind: 'done', summary: 'x' },
      { agent: worker },
    )
    assert.match(JSON.stringify(report), /no approved Dispatch assignment/)
    // An uncertain post-enqueue save leaves a pending authoritative record.
    // Exercise the installed preset guard through the real tool executor, not
    // only the service's isProvisioning predicate. Neither tool may run.
    const dispatch = h.ctx.get('localDispatch')
    await dispatch.store.transaction((tables) =>
      tables.workers.put(worker.id, workerRecord(worker.id, 'pending')),
    )
    for (const [name, args] of [
      ['bash', { command: 'must-not-execute' }],
      ['dispatch_report', { assignmentId: 'assignment-1', kind: 'done', summary: 'unsafe' }],
    ]) {
      const denied = await executeOne(h.tools, name, args, { agent: worker })
      assert.equal(denied.isError, true)
      assert.match(JSON.stringify(denied), /pending admission/)
    }
    assert.deepEqual(h.calls, [], 'pending admission never reaches a coding subprocess')
    assert.equal(
      (await executeOne(h.tools, 'team_task_create', {}, { agent: standard })).value,
      'ran',
    )
  },
)

test('Dispatch fails closed without durable storage and keeps records across reopen', async (t) => {
  const { apply } = await import('../dist/src/index.js')
  const ctx = (storageDomain) => ({
    storageDomain,
    get: () => undefined,
    provide() {},
    effect() {},
    inject() {},
  })
  await assert.rejects(apply(ctx(undefined)), /requires the DSH storage domain/)
  await assert.rejects(
    apply(
      ctx({
        open: async () => {
          throw new Error('invalid-record')
        },
      }),
    ),
    /invalid-record/,
  )
  const { Context } = await installed('@deepseek-ai/cordis')
  const host = new Context()
  t.after(() => host.fiber.dispose())
  await durableStorage(t, host)
  const first = await domainStore(host.get('storageDomain'))
  const worker = workerRecord()
  const proposal = {
    version: RECORD_VERSION,
    id: 'proposal-1',
    coordinatorId: 'c',
    callId: 'call-1',
    generation: 0,
    payload: {
      kind: 'adopt',
      intent: 'fixture task',
      prompt: 'fixture prompt',
      preset: 'dispatch-worker',
      model: 'unchanged',
      base: null,
      branch: worker.branch,
      target: {
        provider: worker.provider,
        worktreeKey: worker.worktreeKey,
        worktreePath: worker.worktreePath,
        repositoryRoot: worker.repositoryRoot,
        branch: worker.branch,
        head: worker.baseCommit,
      },
      workerSessionId: worker.workerId,
      assignmentId: worker.assignment.id,
    },
    digest: '0'.repeat(64),
    createdAt: worker.verifiedAt,
    hostEpoch: 'fixture-epoch',
    state: 'succeeded',
    checkpoints: ['approved', 'verified', 'claimed', 'delivered'],
  }
  const report = {
    version: RECORD_VERSION,
    id: 'report-1',
    workerId: worker.workerId,
    coordinatorId: worker.coordinatorId,
    assignmentId: worker.assignment.id,
    generation: 1,
    kind: 'progress',
    summary: 'fixture progress',
    evidence: ['fixture evidence'],
    createdAt: worker.verifiedAt,
    delivery: 'delivered',
    messageId: 'report-message-1',
    messageText: 'stable attributed report text',
    deliveredAt: worker.verifiedAt,
  }
  await first.transaction(async (tables) => {
    await tables.workers.put(worker.workerId, worker)
    await tables.proposals.put(proposal.id, proposal)
    await tables.reports.put(report.id, report)
  })
  await first.close()
  const second = await domainStore(host.get('storageDomain'))
  assert.deepEqual(
    second.tables.workers.get(worker.workerId),
    worker,
    'current task and authority survive reopen',
  )
  assert.deepEqual(
    second.tables.proposals.get(proposal.id),
    proposal,
    'approval history survives reopen',
  )
  assert.deepEqual(
    second.tables.reports.get(report.id),
    report,
    'outbox identity and provenance survive reopen',
  )
  await second.close()
})

test('retained v2 authority fails closed without resetting or renaming its storage domain', async (t) => {
  const { Context } = await installed('@deepseek-ai/cordis')
  const host = new Context()
  t.after(() => host.fiber.dispose())
  const root = await durableStorage(t, host)
  const storage = host.get('storageDomain')
  const legacySpec = {
    name: 'local_dispatch',
    version: 2,
    tables: Object.fromEntries(
      ['workers', 'assignments', 'proposals', 'reports'].map((name) => [
        name,
        { valueSchema: { parse: (value) => value } },
      ]),
    ),
  }
  const legacy = await storage.open(legacySpec)
  const current = workerRecord()
  const { assignment, ...authority } = current
  const { admission: _admission, ...task } = assignment
  const oldWorker = { ...authority, version: 2, assignmentId: assignment.id }
  const oldTask = { ...task, version: 2 }
  await legacy.table('workers').put(oldWorker.workerId, oldWorker)
  await legacy.table('assignments').put(oldTask.id, oldTask)
  await legacy.close()
  const path = join(root, 'local_dispatch.json')
  const before = await readFile(path, 'utf8')
  await assert.rejects(domainStore(storage), (error) => error.code === 'version-mismatch')
  assert.equal(
    await readFile(path, 'utf8'),
    before,
    'rejected retained state remains byte-for-byte intact',
  )
  const reopened = await storage.open(legacySpec)
  assert.deepEqual(reopened.table('workers').get(oldWorker.workerId), oldWorker)
  assert.deepEqual(reopened.table('assignments').get(oldTask.id), oldTask)
  await reopened.close()
})

test('generated host and client artifacts are fresh', async () => {
  const { buildHost } = await import('../scripts/build-host.mjs')
  const { checkHost } = await import('../../../scripts/build-host.mjs')
  checkHost(buildHost())
  const { buildClient, clientPath } = await import('../scripts/build-client.mjs')
  assert.equal(await readFile(clientPath, 'utf8'), await buildClient())
})
