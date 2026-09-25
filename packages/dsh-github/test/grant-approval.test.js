import assert from 'node:assert/strict'
import test from 'node:test'
import { approvalHost } from './approval-fixture.js'
import { fakeSubprocess, json, connection } from './fixtures.js'
import {
  actor,
  owner,
  project,
  issue,
  blocker,
  item,
  args,
  snapshot,
  mutationResult,
} from './write-payloads.js'
import { createGitHubWriteRuntime } from '../src/write-runtime.js'
import { createGitHubGrantRuntime } from '../src/grants.js'
import { createGrantCaller, registerGitHubGrantTools, GRANT_TOOL_NAME } from '../src/grant-tools.js'
import { registerGitHubWriteTools } from '../src/write-tools.js'
import { GRANT_READS, WRITE_READS } from '../src/write-queries.js'

const scope = {
  operations: ['setProjectItemField', 'addIssueDependency'],
  issues: [
    { owner: 'source', repo: 'example', issueNumber: 33 },
    { owner: 'blockers', repo: 'other', issueNumber: 34 },
  ],
  projects: [{ owner: 'destination', projectNumber: 7 }],
}
const fieldTool = 'github_set_project_item_field'
const fieldArgs = args.setProjectItemField
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function content(result) {
  return result.value
    ? JSON.parse(result.value)
    : JSON.parse(result.content.find((part) => part.type === 'text').text)
}

async function fixture(t, options = {}) {
  const host = await approvalHost(t, options)
  let live = host.agent
  let roots = [host.agent]
  const registry = { get: (id) => (live?.session.id === id ? live : undefined), roots: () => roots }
  host.ctx.provide('agents', registry)
  const caller = createGrantCaller(host.ctx)
  const events = []
  const presentation = Object.fromEntries(
    ['request', 'phase', 'prepared', 'settled'].map((name) => [
      name,
      (...args) => events.push({ name, args }),
    ]),
  )
  let mutations = 0
  const subprocess = fakeSubprocess((spec) => {
    const request = JSON.parse(spec.stdio.stdin.data)
    const { query, variables } = request
    if (query.startsWith('mutation')) {
      mutations++
      const operation = query.includes('AddBlockedByInput')
        ? 'addIssueDependency'
        : query.includes('CreateIssueInput')
          ? 'createIssue'
          : 'setProjectItemField'
      return options.mutation?.(request) ?? json({ data: mutationResult(operation) })
    }
    let data
    if (query === GRANT_READS.issue) {
      const target = variables.issueNumber === 33 ? issue : blocker
      const repo = {
        ...target.repository,
        owner: {
          id: variables.owner === 'source' ? 'O_SOURCE' : 'O_BLOCKERS',
          login: variables.owner,
        },
      }
      data = {
        viewer: actor,
        repository: {
          ...repo,
          issue: {
            ...target,
            projectItems: connection(
              target.id === issue.id
                ? [
                    {
                      id: item.id,
                      isArchived: false,
                      project: { id: project.id, number: project.number, owner: project.owner },
                    },
                  ]
                : [],
            ),
          },
        },
      }
    } else if (query === GRANT_READS.project)
      data = { viewer: actor, repositoryOwner: { ...owner, projectV2: project } }
    else {
      const operation = Object.keys(WRITE_READS).find((key) => WRITE_READS[key] === query)
      assert.ok(operation)
      data = snapshot(operation)
      if (operation === 'setProjectItemField') data.node.content.repository = issue.repository
    }
    data = structuredClone(data)
    return options.read?.(data, query, variables) ?? json({ data })
  })
  const runtime = createGitHubWriteRuntime(subprocess)
  const grants = createGitHubGrantRuntime(runtime)
  t.after(() => grants.dispose())
  const grantRegistration = registerGitHubGrantTools(host.ctx, grants, caller, presentation)
  const writeRegistration = registerGitHubWriteTools(host.ctx, runtime, {
    grants,
    grantCaller: caller,
    presentation,
  })
  return {
    ...host,
    runtime,
    grants,
    caller,
    events,
    subprocess,
    grantRegistration,
    writeRegistration,
    mutations: () => mutations,
    owner: () => caller({ agent: host.agent }),
    registry: {
      replace(agent) {
        live = agent
        roots = [agent]
      },
      removeRoot() {
        roots = []
      },
      removeOwner() {
        live = undefined
      },
    },
  }
}
async function allow(host) {
  const result = await host.execute(GRANT_TOOL_NAME, scope)
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(content(result).outcome, 'granted', JSON.stringify(result))
  return content(result).grant
}

test('trusted approval creates finite authority once; matching field/dependency writes omit only the second prompt', async (t) => {
  const host = await fixture(t, { answer: 'allowed-once' })
  await allow(host)
  assert.equal(host.requests.length, 1)
  assert.equal(host.requests[0].toolName, GRANT_TOOL_NAME)
  assert.match(host.requests[0].reason, /source\/example #33/)
  assert.match(host.requests[0].reason, /repository owner ID O_SOURCE/)
  assert.match(host.requests[0].reason, /Original project/)
  assert.match(host.requests[0].reason, /No deletion/)
  assert.match(host.requests[0].reason, /not implemented and are not authorized/)
  assert.equal(host.mutations(), 0, 'request grants authority but starts no work')
  assert.equal(content(await host.execute(fieldTool, fieldArgs)).outcome, 'confirmed')
  assert.equal(
    content(await host.execute('github_add_issue_dependency', args.addIssueDependency)).outcome,
    'confirmed',
  )
  assert.equal(host.requests.length, 1)
  assert.equal(host.mutations(), 2)
  assert.deepEqual(
    host.audit().map((event) => event.type),
    ['approval/asked', 'approval/decided'],
  )
  assert.deepEqual(
    host.grants.history(host.owner()).map((row) => row.outcome),
    ['confirmed', 'confirmed'],
  )
  assert.ok(
    host.events.some(
      (event) => event.name === 'prepared' && event.args[2] === 'authorized-by-grant',
    ),
  )
  await host.execute('github_create_issue', args.createIssue)
  assert.equal(host.requests.length, 2, 'unsupported write keeps individual approval')
})

test('history marks dispatched writes running before a final confirmed outcome', async (t) => {
  const host = await fixture(t, {
    answer: 'allowed-once',
    mutation: () => {
      assert.equal(host.grants.history(host.owner()).at(-1).outcome, 'running')
      return json({ data: mutationResult('setProjectItemField') })
    },
  })
  await allow(host)
  assert.equal(content(await host.execute(fieldTool, fieldArgs)).outcome, 'confirmed')
  assert.equal(host.grants.history(host.owner()).at(-1).outcome, 'confirmed')
})

test('failed preflights remain visible without unverified targets or raw arguments in history', async (t) => {
  const host = await fixture(t, { answer: 'allowed-once' })
  const result = await host.execute(fieldTool, { ...fieldArgs, value: { date: '2024-02-30' } })
  assert.equal(result.isError, true)
  assert.equal(host.requests.length, 0)
  assert.equal(host.mutations(), 0)
  const history = host.grants.history(host.owner())
  assert.equal(history.length, 1)
  assert.equal(history[0].outcome, 'failed')
  assert.deepEqual(history[0].targets, {})
  assert.ok(!JSON.stringify(history).includes('2024-02-30'))
})

test('late cancellation after grant acceptance revokes authority before final tool output', async (t) => {
  const controller = new AbortController()
  const host = await fixture(t, { answer: 'allowed-once' })
  host.ctx.on('tools/execute', async (exec, next) => {
    const result = await next()
    if (exec.name === GRANT_TOOL_NAME) controller.abort()
    return result
  })
  const result = await host.execute(GRANT_TOOL_NAME, scope, { signal: controller.signal })
  assert.equal(result.isError, true)
  const final = JSON.parse(result.content.find((part) => part.type === 'text').text)
  assert.equal(final.outcome, 'revoked')
  assert.deepEqual(
    host.grants.list(host.owner()).map((grant) => grant.state),
    ['revoked'],
  )
  assert.equal(host.mutations(), 0)
})

test('rejected, unavailable, missing, malformed and policy-never approval grant no authority', async (t) => {
  for (const options of [
    { label: 'rejected', answer: 'rejected' },
    { label: 'unavailable', answer: 'unavailable' },
    { label: 'missing answerer' },
    { label: 'bad answer', answer: 'yes' },
    {
      label: 'throwing answerer',
      answer() {
        throw new Error('synthetic')
      },
    },
    { label: 'never', policy: 'never', answer: 'allowed-once' },
    { label: 'missing service', approval: false },
    { label: 'no open turn', openTurn: false, answer: 'allowed-once' },
  ])
    await t.test(options.label, async (t) => {
      const host = await fixture(t, options)
      let captured
      host.ctx.on('tools/pre-execute', async (exec, next) => {
        captured = exec
        return next()
      })
      const result = await host.execute(GRANT_TOOL_NAME, scope)
      assert.equal(result.isError, true)
      assert.deepEqual(host.grants.list(host.owner()), [])
      assert.equal(host.mutations(), 0)
      if (captured) {
        const replay = JSON.parse(await host.tools.get(GRANT_TOOL_NAME).execute(scope, captured))
        assert.equal(replay.error.code, 'APPROVAL_REQUIRED')
      }
      assert.deepEqual(host.grants.list(host.owner()), [])
    })
})

test('direct grant execution and replay never create a grant or dispatch mutations', async (t) => {
  const host = await fixture(t, { answer: 'allowed-once' })
  const tool = host.tools.get(GRANT_TOOL_NAME)
  const direct = JSON.parse(
    await tool.execute(scope, {
      name: GRANT_TOOL_NAME,
      arguments: scope,
      token: {},
      agent: host.agent,
    }),
  )
  assert.equal(direct.error.code, 'APPROVAL_REQUIRED')
  assert.equal(host.subprocess.specs.length, 0)
  let captured
  host.ctx.on('tools/execute', async (exec, next) => {
    captured = exec
    return next()
  })
  await allow(host)
  const count = host.subprocess.specs.length
  const replay = JSON.parse(await tool.execute(scope, captured))
  assert.equal(replay.error.code, 'APPROVAL_REQUIRED')
  assert.equal(host.grants.list(host.owner()).length, 1)
  assert.equal(host.subprocess.specs.length, count)
})

test('changed scope or live agent after approval cannot replace a prepared grant', async (t) => {
  for (const mode of ['arguments', 'agent', 'root'])
    await t.test(mode, async (t) => {
      const host = await fixture(t, { answer: 'allowed-once' })
      host.ctx.on('tools/execute', async (exec, next) => {
        if (mode === 'arguments') exec.arguments = { ...scope, operations: ['createIssue'] }
        if (mode === 'agent') exec.agent = { ...host.agent }
        if (mode === 'root') host.registry.removeRoot()
        return next()
      })
      const result = await host.execute(GRANT_TOOL_NAME, scope)
      assert.notEqual(content(result).outcome, 'granted')
      assert.equal(host.grants.list({ ...host.owner(), isSubagent: false }).length, 0)
      assert.equal(host.mutations(), 0)
    })
})

test('registry root ownership denies child and stale agents; same-id restoration receives no authority', async (t) => {
  for (const mode of ['child', 'not-owner'])
    await t.test(mode, async (t) => {
      const host = await fixture(t, { answer: 'allowed-once' })
      if (mode === 'child') host.registry.removeRoot()
      else host.registry.removeOwner()
      const result = await host.execute(GRANT_TOOL_NAME, scope)
      assert.equal(result.isError, true)
      assert.equal(host.requests.length, 0)
      assert.equal(host.subprocess.specs.length, 0)
    })
  await t.test('restored same id', async (t) => {
    const host = await fixture(t, { answer: 'allowed-once' })
    await allow(host)
    const other = await approvalHost(t)
    assert.equal(other.session.id, host.session.id)
    host.registry.replace(other.agent)
    const result = await host.execute(fieldTool, fieldArgs, { agent: other.agent })
    assert.equal(content(result).outcome, 'confirmed')
    assert.equal(host.requests.length, 2, 'restored session must request a new per-write approval')
    assert.equal(host.grants.list(host.caller({ agent: other.agent })).length, 0)
  })
})

test('registry ownership is rechecked after executable resolution immediately before dispatch', async (t) => {
  const host = await fixture(t, { answer: 'allowed-once' })
  await allow(host)
  const original = host.subprocess.resolveExecutable
  let calls = 0
  host.subprocess.resolveExecutable = async (...args) => {
    const value = await original(...args)
    if (++calls === 3) host.registry.removeRoot()
    return value
  }
  const result = await host.execute(fieldTool, fieldArgs)
  assert.equal(content(result).error.code, 'GRANT_REQUIRED')
  assert.equal(host.mutations(), 0)
  assert.equal(host.requests.length, 1)
  assert.equal(host.grants.history({ ...host.owner(), isSubagent: false })[0].outcome, 'failed')
})

test('cancelling a trusted pending grant request consumes preparation without creating authority', async (t) => {
  const controller = new AbortController()
  const host = await fixture(t, {
    answer() {
      controller.abort()
      return new Promise(() => {})
    },
  })
  const result = await host.execute(GRANT_TOOL_NAME, scope, { signal: controller.signal })
  assert.equal(result.isError, true)
  assert.equal(host.audit().at(-1).data.outcome, 'cancelled')
  assert.deepEqual(host.grants.list(host.owner()), [])
  assert.equal(host.mutations(), 0)
})

test('another guard deny or ask remains authoritative with a matching grant', async (t) => {
  for (const kind of ['deny', 'ask'])
    await t.test(kind, async (t) => {
      const host = await fixture(t, { answer: 'allowed-once' })
      await allow(host)
      host.ctx.on('tools/pre-execute', async () => ({
        kind,
        reason: 'Independent policy requires review',
      }))
      const result = await host.execute(fieldTool, fieldArgs)
      if (kind === 'deny') {
        assert.equal(result.isError, true)
        assert.equal(host.requests.length, 1)
        assert.equal(host.mutations(), 0)
        assert.equal(host.grants.history(host.owner())[0].outcome, 'unattempted')
      } else {
        assert.equal(content(result).outcome, 'confirmed')
        assert.equal(host.requests.length, 2)
        assert.match(host.requests[1].reason, /Independent policy requires review/)
        assert.match(host.requests[1].reason, /OPT_READY/)
      }
    })
})

test('grant-request downstream denial and pending disposal never create authority', async (t) => {
  for (const mode of ['policy', 'dispose'])
    await t.test(mode, async (t) => {
      let host
      host = await fixture(t, {
        answer: () => {
          if (mode === 'dispose') host.grantRegistration.dispose()
          return 'allowed-once'
        },
      })
      if (mode === 'policy')
        host.ctx.on('tools/pre-execute', async () => ({ kind: 'deny', reason: 'Independent deny' }))
      const result = await host.execute(GRANT_TOOL_NAME, scope)
      assert.ok(result.isError || content(result).outcome === 'failed')
      assert.equal(host.grants.list(host.owner()).length, 0)
      assert.equal(host.mutations(), 0)
    })
})

test(
  'queued revoke and cancellation prevent dispatch and retain accurate session history',
  { timeout: 10000 },
  async (t) => {
    for (const mode of ['revoke', 'cancel'])
      await t.test(mode, async (t) => {
        const gate = deferred()
        const rechecking = deferred()
        const queued = deferred()
        let reads = 0
        let executions = 0
        const host = await fixture(t, {
          answer: 'allowed-once',
          read(data, query) {
            if (query === WRITE_READS.setProjectItemField && ++reads === 2) {
              rechecking.resolve()
              return {
                ...json({ data }),
                waitForExit: async () => {
                  await gate.promise
                  return true
                },
              }
            }
          },
        })
        const grant = await allow(host)
        host.ctx.on('tools/execute', async (exec, next) => {
          const result = next()
          if (exec.name === fieldTool && ++executions === 2) queued.resolve()
          return result
        })
        const first = host.execute(fieldTool, fieldArgs)
        await rechecking.promise
        const controller = new AbortController()
        const second = host.execute(fieldTool, fieldArgs, { signal: controller.signal })
        await queued.promise
        if (mode === 'revoke') host.grants.revoke(grant.id, host.owner())
        else controller.abort()
        gate.resolve()
        await Promise.all([first, second])
        assert.equal(host.requests.length, 1)
        assert.equal(host.mutations(), mode === 'cancel' ? 1 : 0)
        assert.deepEqual(
          host.grants.history(host.owner()).map((row) => row.outcome),
          mode === 'cancel' ? ['confirmed', 'failed'] : ['failed', 'failed'],
        )
      })
  },
)

test('post-dispatch cancellation remains uncertain in real Tools content/history and quarantines grants', async (t) => {
  for (const late of [false, true])
    await t.test(late ? 'after response' : 'during mutation', async (t) => {
      const controller = new AbortController()
      const host = await fixture(t, {
        answer: 'allowed-once',
        mutation() {
          if (!late) controller.abort()
          return json({ data: mutationResult('setProjectItemField') })
        },
      })
      await allow(host)
      if (late)
        host.ctx.on('tools/execute', async (exec, next) => {
          const result = await next()
          if (exec.name === fieldTool) controller.abort()
          return result
        })
      const result = await host.execute(fieldTool, fieldArgs, { signal: controller.signal })
      assert.equal(result.isError, true)
      const rendered = JSON.parse(result.content.find((part) => part.type === 'text').text)
      assert.equal(rendered.outcome, 'uncertain')
      assert.equal(host.grants.history(host.owner())[0].outcome, 'uncertain')
      assert.equal(host.grants.list(host.owner())[0].state, 'renewal-required')
      assert.equal(host.mutations(), 1)
    })
})
