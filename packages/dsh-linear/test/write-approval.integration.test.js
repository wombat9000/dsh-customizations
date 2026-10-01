import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { LinearProjectWrites } from '../src/project-writes.js'
import { registerProjectWriteTools } from '../src/tools/project-writes.js'
import { approvalHost } from '../../dsh-github/test/approval-fixture.js'

// Reuse the real pinned Tools, UserApproval, Cordis and detached Session fixture.
// Only the Linear prepare/dispatch boundary and approval answerer are synthetic.
// No SDK, credentials, network, AgentLoop, session store or GUI is involved.
const operations = [
  {
    name: 'linear_create_project',
    prepare: 'prepareCreate',
    execute: 'executeCreate',
    kind: 'create-project',
    args: { name: 'Approved project', teams: ['ENG'], content: 'Exact  content\n' },
    input: { name: 'Approved project', teamIds: ['TEAM_ENG'], content: 'Exact  content\n' },
  },
  {
    name: 'linear_update_project',
    prepare: 'prepareUpdate',
    execute: 'executeUpdate',
    kind: 'update-project',
    args: { project: 'PROJECT_1', name: 'Approved rename' },
    input: { id: 'PROJECT_1', name: 'Approved rename' },
  },
  {
    name: 'linear_create_project_update',
    prepare: 'prepareProjectUpdate',
    execute: 'executeProjectUpdate',
    kind: 'create-project-update',
    args: { project: 'PROJECT_1', health: 'atRisk', body: 'Exact  report\n' },
    input: { projectId: 'PROJECT_1', health: 'atRisk', body: 'Exact  report\n' },
  },
]

const project = {
  id: 'PROJECT_1',
  name: 'Approved project',
  url: 'https://linear.app/fixture/project/approved',
  slugId: 'approved',
  priority: 0,
  priorityLabel: 'No priority',
  progress: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

async function fixture(t, operation = operations[0], options = {}) {
  const host = await approvalHost(t, options)
  const preparations = []
  const mutations = []
  const executions = []
  const results = []
  const reason = `Exact Linear action (untrusted JSON): ${JSON.stringify(operation.input)}`
  const writes = {
    async [operation.prepare](_args, signal) {
      // This fixed immutable action represents an already-resolved provider read.
      // It does not implement policy, approval, token ownership or cleanup.
      const input = structuredClone(operation.input)
      if (input.teamIds) Object.freeze(input.teamIds)
      const value = Object.freeze({ kind: operation.kind, reason, input: Object.freeze(input) })
      preparations.push({ value, signal })
      return value
    },
    async [operation.execute](value, signal) {
      mutations.push(value)
      signal.throwIfAborted()
      return operation.kind === 'create-project-update'
        ? {
            id: 'UPDATE_1',
            ...value.input,
            url: 'https://linear.app/fixture/project/approved/updates/1',
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
          }
        : { ...project, name: value.input.name }
    },
  }
  const plugin = host.ctx.plugin({
    name: 'linear-write-integration-fixture',
    inject: ['tools'],
    apply(child) {
      registerProjectWriteTools(child, writes, { timeoutMs: 30000 })
    },
  })
  await plugin.await()
  host.ctx.on('tools/pre-execute', (exec, next) => {
    executions.push(exec)
    return next()
  })
  host.ctx.on('tools/result', (exec, result) => results.push({ exec, result }))
  return { ...host, plugin, operation, preparations, mutations, executions, results, reason }
}

function assertAudit(host, outcome, reason = host.reason) {
  const events = host.audit()
  assert.deepEqual(
    events.map((event) => event.type),
    ['approval/asked', 'approval/decided'],
  )
  assert.equal(events[0].data.toolName, host.operation.name)
  assert.equal(events[0].data.callId, host.executions[0].callId)
  assert.equal(events[0].data.reason, reason)
  assert.equal(events[0].data.id, events[1].data.id)
  assert.equal(events[1].data.outcome, outcome)
}

async function assertRetired(host, tool = host.tools.get(host.operation.name)) {
  if (host.mutations.length === 0)
    assert.equal(
      host.preparations[0].signal.aborted,
      true,
      'native result/disposal aborts preparation',
    )
  await assert.rejects(
    tool.execute(host.operation.args, host.executions[0]),
    /approval was not prepared/,
  )
}

test('real Tools asks allowed-once and dispatches the exact prepared action for each Linear write', async (t) => {
  for (const operation of operations)
    await t.test(operation.name, async (t) => {
      const host = await fixture(t, operation, { answer: 'allowed-once' })
      host.ctx.on('tools/execute', (exec, next) => {
        // Tools deliberately exposes a mutable around-dispatch execution record.
        exec.arguments = { ...operation.args, name: 'Not approved', body: 'Not approved' }
        return next()
      })
      const result = await host.execute(operation.name, operation.args)
      assert.equal(result.isError, false, JSON.stringify(result))
      assert.equal(
        result.value.name ?? result.value.body,
        operation.input.name ?? operation.input.body,
      )
      assert.equal(host.requests.length, 1)
      assert.equal(host.requests[0].agent, host.agent)
      assert.equal(host.requests[0].reason, host.reason)
      assert.equal(host.preparations.length, 1)
      assert.equal(host.mutations.length, 1)
      assert.equal(host.mutations[0], host.preparations[0].value)
      assert.deepEqual(host.mutations[0].input, operation.input)
      assert.equal(host.results.length, 1)
      assert.equal(host.results[0].result.isError, false)
      assertAudit(host, 'allowed-once')
      await assertRetired(host)
      assert.equal(host.mutations.length, 1, 'completed call cannot replay its approved action')

      const second = await host.execute(operation.name, operation.args)
      assert.equal(second.isError, false)
      assert.equal(host.requests.length, 2, 'allowed-once never grants the next call')
      assert.equal(host.mutations.length, 2)
      const audit = host.audit()
      assert.equal(audit.length, 4)
      assert.equal(audit[3].data.outcome, 'allowed-once')
      assert.notEqual(audit[0].data.id, audit[2].data.id)
    })
})

test('real native non-grants and absent approval fail closed and retire Linear preparations', async (t) => {
  const cases = [
    { label: 'rejected', answer: 'rejected', outcome: 'rejected', requests: 1 },
    { label: 'unavailable', answer: 'unavailable', outcome: 'unavailable', requests: 1 },
    { label: 'missing answerer', outcome: 'unavailable', requests: 0 },
    { label: 'never', policy: 'never', answer: 'allowed-once', outcome: 'rejected', requests: 0 },
    { label: 'missing approval service', approval: false, requests: 0 },
    {
      label: 'cancelled during approval',
      outcome: 'cancelled',
      requests: 1,
      cancel: true,
    },
  ]
  for (const options of cases)
    await t.test(options.label, async (t) => {
      const controller = new AbortController()
      const host = await fixture(t, operations[0], {
        ...options,
        ...(options.cancel
          ? {
              answer: () => {
                controller.abort()
                return new Promise(() => {})
              },
            }
          : {}),
      })
      const result = await host.execute(host.operation.name, host.operation.args, {
        signal: controller.signal,
      })
      assert.equal(result.isError, true, JSON.stringify(result))
      assert.equal(host.preparations.length, 1, 'valid call reaches Linear preparation')
      assert.equal(host.mutations.length, 0)
      assert.equal(host.requests.length, options.requests)
      assert.equal(host.results.length, 1, 'Tools emits its final result for a denied call')
      if (options.outcome) assertAudit(host, options.outcome)
      else assert.deepEqual(host.audit(), [])
      await assertRetired(host)
      assert.equal(host.mutations.length, 0, 'native result cleanup prevents direct replay')
    })
})

test('real pre-execute composition keeps denials and appends policy text without replacing Linear preview', async (t) => {
  for (const kind of ['deny', 'cancel', 'ask'])
    await t.test(kind, async (t) => {
      const host = await fixture(t, operations[0], { answer: 'allowed-once' })
      const additional = 'Other policy\n"quoted" untrusted reason'
      host.ctx.on('tools/pre-execute', async () => ({ kind, reason: additional }))
      const result = await host.execute(host.operation.name, host.operation.args)
      assert.equal(host.preparations.length, 1)
      if (kind === 'ask') {
        const expected = `${host.reason}\nAdditional policy reason (untrusted JSON string): ${JSON.stringify(additional)}`
        assert.equal(result.isError, false, JSON.stringify(result))
        assert.equal(host.requests.length, 1)
        assert.equal(host.requests[0].reason, expected)
        assertAudit(host, 'allowed-once', expected)
        assert.equal(host.mutations.length, 1)
        assert.deepEqual(host.mutations[0].input, operations[0].input)
      } else {
        assert.equal(result.isError, true)
        if (kind === 'deny') assert.equal(result.error.message, additional)
        assert.equal(host.requests.length, 0)
        assert.deepEqual(host.audit(), [])
        assert.equal(host.mutations.length, 0)
      }
      await assertRetired(host)
    })
})

test('the real dispatch timeout blocks mutation after uncooperative approval revalidation', async (t) => {
  const host = await approvalHost(t, { answer: 'allowed-once' })
  const require = createRequire(import.meta.url)
  const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
  const timeoutPolicy = await import(
    pathToFileURL(cli.resolve('@deepseek-ai/dsh-tool-call-timeout-policy')).href
  )
  await host.ctx.plugin(timeoutPolicy).await()
  const started = Promise.withResolvers()
  const revalidated = Promise.withResolvers()
  let reads = 0
  let mutations = 0
  const client = {
    teams: async () => ({
      nodes: [{ id: 'TEAM_ENG', key: 'ENG', name: 'Engineering' }],
      pageInfo: { hasNextPage: false },
    }),
    projects: async () => {
      reads += 1
      if (reads === 2) {
        started.resolve()
        await revalidated.promise
      }
      return { nodes: [], pageInfo: { hasNextPage: false } }
    },
    createProject: async () => {
      mutations += 1
      return { success: false }
    },
  }
  const writes = new LinearProjectWrites({
    maxDescriptionChars: 12000,
    client: async (signal) => {
      signal.throwIfAborted()
      return { client, organization: { id: 'WORKSPACE_1', name: 'Fixture', urlKey: 'fixture' } }
    },
    request: async (_operation, task) => task(),
  })
  await host.ctx
    .plugin({
      name: 'linear-timeout-integration-fixture',
      inject: ['tools'],
      apply(child) {
        registerProjectWriteTools(child, writes, { timeoutMs: 30000 })
      },
    })
    .await()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pending = host.execute('linear_create_project', {
    name: 'Approved project',
    teams: ['ENG'],
  })
  await started.promise
  t.mock.timers.tick(30000)
  revalidated.resolve()
  const result = await pending
  assert.equal(mutations, 0, 'timed-out duplicate revalidation cannot dispatch a write')
  assert.equal(reads, 2, 'the deadline fires during post-approval provider work')
  assert.equal(host.requests.length, 1)
  assert.equal(result.isError, true)
  assert.equal(result.error.info.code, 'TOOL_TIMEOUT')
})

test('real Cordis unload during native approval revokes preparation and unregisters Linear tools', async (t) => {
  let host
  host = await fixture(t, operations[0], {
    answer: async () => {
      await host.plugin.dispose()
      return 'allowed-once'
    },
  })
  const retainedTool = host.tools.get(host.operation.name)
  const result = await host.execute(host.operation.name, host.operation.args)
  assert.equal(result.isError, true, JSON.stringify(result))
  assert.equal(host.requests.length, 1)
  assertAudit(host, 'allowed-once')
  assert.equal(host.mutations.length, 0, 'even a native grant cannot dispatch after unload')
  for (const operation of operations) assert.equal(host.tools.get(operation.name), undefined)
  await assertRetired(host, retainedTool)
  assert.equal(host.mutations.length, 0)
})
