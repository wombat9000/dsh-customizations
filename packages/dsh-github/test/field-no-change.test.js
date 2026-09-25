import assert from 'node:assert/strict'
import test from 'node:test'
import { createGitHubWriteRuntime } from '../src/write-runtime.js'
import { registerGitHubWriteTools } from '../src/write-tools.js'
import { fakeSubprocess, json } from './fixtures.js'
import { approvalHost } from './approval-fixture.js'
import { args, snapshot } from './write-payloads.js'
const operation = 'setProjectItemField'
const input = { ...args[operation], value: { singleSelectOptionId: 'OPT_TODO' } }
const exec = { cwd: '/fixture/session-a', agentId: 'fixture-agent' }
function fixture() {
  const subprocess = fakeSubprocess([json({ data: snapshot(operation) })])
  return { subprocess, runtime: createGitHubWriteRuntime(subprocess) }
}
test('verified equality returns a structured no-change without mutation or extra reads; token is consumed', async () => {
  const { runtime, subprocess } = fixture()
  const prepared = await runtime.prepare(operation, input, exec)
  assert.equal(prepared.change.noChange, true)
  let dispatched = false
  const result = await runtime.execute(prepared, exec, {
    onDispatch() {
      dispatched = true
    },
  })
  assert.equal(result.outcome, 'no-change')
  assert.equal(result.dispatched, false)
  assert.equal(result.reason, 'FIELD_VALUE_ALREADY_SET')
  assert.equal(dispatched, false)
  assert.equal(subprocess.specs.length, 1)
  await assert.rejects(runtime.execute(prepared, exec), { code: 'APPROVAL_REQUIRED' })
})
test('no-change retains caller binding and cancellation', async () => {
  for (const context of [
    { ...exec, agentId: 'other' },
    { ...exec, signal: AbortSignal.abort() },
  ]) {
    const { runtime, subprocess } = fixture()
    const prepared = await runtime.prepare(operation, input, exec)
    await assert.rejects(runtime.execute(prepared, context), {
      code: context.signal ? 'CANCELLED' : 'CONTEXT_CHANGED',
    })
    assert.equal(subprocess.specs.length, 1)
  }
})
test('no-change needs no own approval or grant authority in the real tools pipeline', async (t) => {
  const host = await approvalHost(t)
  const { runtime, subprocess } = fixture()
  registerGitHubWriteTools(host.ctx, runtime, {
    grants: {
      observeAccount() {},
      observe() {},
      check() {
        assert.fail('no grant check')
      },
      attempt() {
        assert.fail('no grant history')
      },
    },
    grantCaller: () => ({ isSubagent: false }),
  })
  const result = await host.execute('github_set_project_item_field', input)
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(JSON.parse(result.value).outcome, 'no-change')
  assert.equal(host.requests.length, 0)
  assert.equal(subprocess.specs.length, 1)
})
test('another guard can still require exact approval or deny the no-change call', async (t) => {
  for (const kind of ['ask', 'deny'])
    await t.test(kind, async (t) => {
      const host = await approvalHost(t, { answer: 'allowed-once' })
      const { runtime, subprocess } = fixture()
      registerGitHubWriteTools(host.ctx, runtime)
      host.ctx.on('tools/pre-execute', () => ({ kind, reason: 'Independent guard' }))
      const result = await host.execute('github_set_project_item_field', input)
      assert.equal(subprocess.specs.length, 1)
      if (kind === 'ask') {
        assert.equal(host.requests.length, 1)
        assert.match(host.requests[0].reason, /OPT_TODO/)
        assert.equal(JSON.parse(result.value).outcome, 'no-change')
      } else assert.equal(result.isError, true)
    })
})
