import assert from 'node:assert/strict'
import test from 'node:test'
import { createGitHubWriteRuntime } from '../src/write-runtime.js'
import { registerGitHubWriteTools } from '../src/write-tools.js'
import { fakeSubprocess, json } from './fixtures.js'
import { approvalHost } from './approval-fixture.js'
import { args, snapshot, mutationResult } from './write-payloads.js'

const toolName = operation => `github_${operation.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`)}`
async function fixture(t, name = 'createIssue', options = {}) {
  const host = await approvalHost(t, options)
  const subprocess = fakeSubprocess([json({ data: snapshot(name) }), json({ data: snapshot(name) }), json({ data: mutationResult(name) })])
  const runtime = createGitHubWriteRuntime(subprocess)
  const registration = registerGitHubWriteTools(host.ctx, runtime)
  return { ...host, subprocess, runtime, registration }
}
function mutations(subprocess) {
  return subprocess.specs.filter(spec => spec.stdio.stdin?.data && JSON.parse(spec.stdio.stdin.data).query.startsWith('mutation'))
}

test('real DSH approval pipeline asks once for each exact write and records matching durable decisions', async t => {
  for (const operation of Object.keys(args).filter(name => name !== 'copyProject')) await t.test(operation, async t => {
    const host = await fixture(t, operation, { answer: 'allowed-once' })
    const result = await host.execute(toolName(operation), args[operation])
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.equal(JSON.parse(result.value).outcome, 'confirmed')
    assert.equal(host.requests.length, 1)
    assert.equal(host.requests[0].toolName, toolName(operation))
    assert.equal(host.requests[0].agent, host.agent)
    const audit = host.audit()
    assert.deepEqual(audit.map(event => event.type), ['approval/asked', 'approval/decided'])
    assert.equal(audit[0].data.reason, host.requests[0].reason)
    assert.equal(audit[0].data.id, audit[1].data.id)
    assert.equal(audit[1].data.outcome, 'allowed-once')
    assert.equal(mutations(host.subprocess).length, 1)
    assert.ok(host.subprocess.specs.every(spec => spec.cwd === '/fixture/session-a'))
  })
})

test('rejected, unavailable, invalid, throwing, missing and policy-never answerers fail closed', async t => {
  const cases = [
    { label: 'rejected', answer: 'rejected', outcome: 'rejected' },
    { label: 'unavailable', answer: 'unavailable', outcome: 'unavailable' },
    { label: 'missing answerer', outcome: 'unavailable' },
    { label: 'invalid answer', answer: 'yes please', outcome: 'unavailable' },
    { label: 'throwing answer', answer() { throw new Error('synthetic answerer failure') }, outcome: 'unavailable' },
    { label: 'policy never', policy: 'never', answer: 'allowed-once', outcome: 'rejected' },
    { label: 'missing approval service', approval: false },
    { label: 'outside open turn', openTurn: false, answer: 'allowed-once' },
  ]
  for (const options of cases) await t.test(options.label, async t => {
    const host = await fixture(t, 'createIssue', options)
    const result = await host.execute('github_create_issue', args.createIssue)
    assert.equal(result.isError, true, JSON.stringify(result))
    assert.equal(mutations(host.subprocess).length, 0)
    assert.equal(host.subprocess.specs.length, 1, 'only pre-approval read runs')
    if (options.outcome) assert.equal(host.audit().at(-1).data.outcome, options.outcome)
    if (options.policy === 'never' || options.approval === false || options.openTurn === false) assert.equal(host.requests.length, 0)
  })
})

test('approval cancellation prevents dispatch and is audited as cancelled', async t => {
  const controller = new AbortController()
  const host = await fixture(t, 'createIssue', { answer: () => { controller.abort(); return new Promise(() => {}) } })
  const result = await host.execute('github_create_issue', args.createIssue, { signal: controller.signal })
  assert.equal(result.isError, true)
  assert.equal(host.audit().at(-1).data.outcome, 'cancelled')
  assert.equal(mutations(host.subprocess).length, 0)
})

test('direct execution without a prepared approval and replay after a successful call never dispatch', async t => {
  const host = await fixture(t, 'createIssue', { answer: 'allowed-once' })
  const tool = host.tools.get('github_create_issue')
  const directExec = { name: 'github_create_issue', token: {}, callId: 'direct', agent: host.agent, signal: new AbortController().signal }
  const direct = await tool.execute(args.createIssue, directExec)
  assert.ok(JSON.stringify(direct).match(/APPROVAL|approval/))
  assert.equal(host.subprocess.specs.length, 0)
  let captured
  host.ctx.on('tools/execute', async (exec, next) => { captured = exec; return next() })
  const result = await host.execute('github_create_issue', args.createIssue)
  assert.equal(result.isError, false)
  const count = host.subprocess.specs.length
  const replay = await tool.execute(args.createIssue, captured)
  assert.ok(JSON.stringify(replay).match(/APPROVAL|approval/))
  assert.equal(host.subprocess.specs.length, count)
})

test('rejection consumes the execution preparation so a captured token cannot be replayed', async t => {
  const host = await fixture(t, 'createIssue', { answer: 'rejected' })
  let captured
  host.ctx.on('tools/pre-execute', async (exec, next) => { captured = exec; return next() })
  const result = await host.execute('github_create_issue', args.createIssue)
  assert.equal(result.isError, true)
  const replay = JSON.parse(await host.tools.get('github_create_issue').execute(args.createIssue, captured))
  assert.equal(replay.error.code, 'APPROVAL_REQUIRED')
  assert.equal(host.subprocess.specs.length, 1)
})

test('plugin disposal during pending approval invalidates the preparation before dispatch', async t => {
  let host
  host = await fixture(t, 'createIssue', { answer: () => { host.registration.dispose(); return 'allowed-once' } })
  const result = await host.execute('github_create_issue', args.createIssue)
  assert.equal(JSON.parse(result.value).error.code, 'APPROVAL_REQUIRED')
  assert.equal(mutations(host.subprocess).length, 0)
})

test('downstream policy denial skips approval and downstream asks retain the exact write preview', async t => {
  for (const kind of ['deny', 'ask']) await t.test(kind, async t => {
    const host = await fixture(t, 'createIssue', { answer: 'allowed-once' })
    host.ctx.on('tools/pre-execute', async () => ({ kind, reason: 'Additional synthetic policy reason' }))
    const result = await host.execute('github_create_issue', args.createIssue)
    if (kind === 'deny') {
      assert.equal(result.isError, true)
      assert.equal(host.requests.length, 0)
      assert.equal(mutations(host.subprocess).length, 0)
    } else {
      assert.equal(result.isError, false)
      assert.equal(host.requests.length, 1)
      assert.match(host.requests[0].reason, /Additional synthetic policy reason/)
      const preview = JSON.parse(host.requests[0].reason.match(/```json\n([\s\S]*?)\n```/)[1])
      assert.equal(preview.exactPayload.body, args.createIssue.body)
      assert.equal(preview.targets.repository.id, 'R_TARGET')
    }
  })
})

test('the real Tools cancellation pipeline preserves an uncertain post-dispatch outcome', async t => {
  for (const late of [false, true]) await t.test(late ? 'after confirmed response' : 'during mutation', async t => {
    const controller = new AbortController()
    const host = await approvalHost(t, { answer: 'allowed-once' })
    const subprocess = fakeSubprocess(spec => {
      const mutation = JSON.parse(spec.stdio.stdin.data).query.startsWith('mutation')
      if (mutation && !late) controller.abort()
      return json({ data: mutation ? mutationResult('createIssue') : snapshot('createIssue') })
    })
    registerGitHubWriteTools(host.ctx, createGitHubWriteRuntime(subprocess))
    if (late) host.ctx.on('tools/execute', async (_exec, next) => { const result = await next(); controller.abort(); return result })
    const result = await host.execute('github_create_issue', args.createIssue, { signal: controller.signal })
    assert.equal(result.isError, true)
    const content = JSON.parse(result.content.find(part => part.type === 'text').text)
    assert.equal(content.outcome, 'uncertain')
    assert.match(content.message, /Do not retry automatically/)
    if (late) assert.equal(content.observedConfirmedResource.id, 'I_CREATED')
    assert.equal(mutations(subprocess).length, 1)
  })
})

test('each subsequent call requires fresh approval and later failure never rolls back earlier success', async t => {
  const host = await approvalHost(t, { answer: 'allowed-once' })
  let writes = 0
  const subprocess = fakeSubprocess(spec => {
    const mutation = JSON.parse(spec.stdio.stdin.data).query.startsWith('mutation')
    if (!mutation) return json({ data: snapshot('createIssue') })
    writes++
    return writes === 1 ? json({ data: mutationResult('createIssue') }) : { exitCode: 1, stderr: 'HTTP 503 uncertain mutation' }
  })
  registerGitHubWriteTools(host.ctx, createGitHubWriteRuntime(subprocess))
  const first = await host.execute('github_create_issue', args.createIssue)
  const second = await host.execute('github_create_issue', args.createIssue)
  assert.equal(JSON.parse(first.value).outcome, 'confirmed')
  assert.equal(JSON.parse(first.value).resource.id, 'I_CREATED')
  assert.equal(JSON.parse(second.value).outcome, 'uncertain')
  assert.equal(host.requests.length, 2)
  assert.equal(host.audit().filter(event => event.type === 'approval/decided').length, 2)
  assert.equal(writes, 2, 'no retry or rollback mutation runs')
  assert.equal(subprocess.specs.length, 6)
})

test('changed arguments or caller after approval cannot replace the approved destination or payload', async t => {
  for (const change of ['arguments', 'agent']) await t.test(change, async t => {
    const host = await fixture(t, 'createIssue', { answer: 'allowed-once' })
    host.ctx.on('tools/execute', async (exec, next) => {
      if (change === 'arguments') exec.arguments = { ...exec.arguments, repo: 'different', body: 'not approved' }
      else exec.agent = { ...host.agent, id: 'different-agent' }
      return next()
    })
    const result = await host.execute('github_create_issue', args.createIssue)
    const value = result.value === undefined ? result : JSON.parse(result.value)
    assert.ok(JSON.stringify(value).match(/APPROVAL|approval|CONFLICT|caller/), JSON.stringify(value))
    assert.equal(mutations(host.subprocess).length, 0)
  })
})
