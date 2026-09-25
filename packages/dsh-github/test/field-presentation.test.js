import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createGitHubPresentation,
  fieldPresentation,
  FIELD_TOOL_NAME,
} from '../src/presentation.js'
import { createGitHubWriteRuntime } from '../src/write-runtime.js'
import { registerGitHubWriteTools } from '../src/write-tools.js'
import { fakeSubprocess, json } from './fixtures.js'
import { args, snapshot, mutationResult } from './write-payloads.js'
import { approvalHost } from './approval-fixture.js'

const operation = 'setProjectItemField'
const noGrants = { list: () => [], history: () => [] }
function presentationFor(agent, root = true) {
  return createGitHubPresentation({
    agents: {
      get: (id) => (id === agent.session.id ? agent : undefined),
      roots: () => (root ? [agent] : []),
    },
    grants: noGrants,
    caller: () => ({ session: agent.session, isSubagent: !root }),
  })
}
test('field projection copies only verified prepared leaves for all supported field types', async () => {
  const cases = [
    ['F_TEXT', { text: 'A  multiline\nvalue' }],
    ['F_NUMBER', { number: 0 }],
    ['F_DATE', { date: '2024-02-29' }],
    ['F_STATUS', { singleSelectOptionId: 'OPT_READY' }],
    ['F_ITERATION', { iterationId: 'ITER_ACTIVE' }],
    ['F_ITERATION', { iterationId: 'ITER_OLD' }],
  ]
  for (const [fieldId, value] of cases) {
    const subprocess = fakeSubprocess([json({ data: snapshot(operation) })])
    const prepared = await createGitHubWriteRuntime(subprocess).prepare(
      operation,
      { ...args[operation], fieldId, value },
      { agentId: 'session', cwd: '/fixture' },
    )
    const view = fieldPresentation(prepared)
    assert.equal(view.exactPreview, prepared.preview)
    assert.deepEqual(view.change.after, value)
    assert.equal(view.change.field.id, fieldId)
    assert.equal(view.targets.project.id, prepared.targets.project.id)
    assert.equal(view.targets.item.content.id, prepared.targets.item.content.id)
    assert.equal(view.snapshot, undefined)
    assert.equal(view.change.field.options, undefined)
    if (fieldId === 'F_STATUS') {
      assert.equal(view.change.before.optionId, 'OPT_TODO')
      assert.equal(view.change.selectedOption.name, 'Ready')
    } else assert.equal(view.change.before, null)
    assert.equal(subprocess.specs.length, 1)
    view.change.after[Object.keys(value)[0]] = 'changed presentation'
    assert.deepEqual(prepared.change.after, value, 'presentation cannot mutate the prepared write')
  }
})
test('missing previous value is not converted into an explicit unset value', () => {
  const prepared = {
    preview: 'complete',
    targets: { project: { id: 'P' }, item: { id: 'I', project: { id: 'P' }, content: null } },
    change: { field: { id: 'F', dataType: 'TEXT' }, after: { text: 'after' } },
  }
  assert.equal(fieldPresentation(prepared).change.before, undefined)
  assert.equal(
    fieldPresentation({ ...prepared, change: { ...prepared.change, before: null } }).change.before,
    null,
  )
})
test('native approval retains the exact payload and status reads never query GitHub', async (t) => {
  let presentation
  let subprocess
  const host = await approvalHost(t, {
    answer: (request) => {
      const before = subprocess.specs.length
      const view = presentation.status({ sessionId: host.session.id, callId: request.callId })
      assert.equal(view.phase, 'awaiting-approval')
      assert.equal(view.exactPreview, request.reason)
      assert.equal(view.change.before.name, 'Todo')
      assert.equal(view.change.selectedOption.name, 'Ready')
      assert.equal(subprocess.specs.length, before)
      return 'allowed-once'
    },
  })
  presentation = presentationFor(host.agent)
  subprocess = fakeSubprocess((spec) =>
    json({
      data: JSON.parse(spec.stdio.stdin.data).query.startsWith('mutation')
        ? mutationResult(operation)
        : snapshot(operation),
    }),
  )
  registerGitHubWriteTools(host.ctx, createGitHubWriteRuntime(subprocess), { presentation })
  const result = await host.execute(FIELD_TOOL_NAME, args[operation])
  const view = presentation.status({ sessionId: host.session.id, callId: 'write-call-1' })
  assert.equal(view.phase, 'confirmed')
  assert.equal(view.result.outcome, 'confirmed')
  assert.equal(view.change.before.name, 'Todo')
  assert.equal(JSON.parse(result.value).outcome, 'confirmed')
  assert.equal(JSON.parse(result.value).change, undefined, 'model-facing result remains unchanged')
  assert.equal(subprocess.specs.length, 3, 'only original preparation, recheck and mutation')
})
test('no-change bridge retains structured evidence and verified metadata without authority', async (t) => {
  const host = await approvalHost(t)
  const presentation = presentationFor(host.agent)
  const subprocess = fakeSubprocess([json({ data: snapshot(operation) })])
  registerGitHubWriteTools(host.ctx, createGitHubWriteRuntime(subprocess), { presentation })
  await host.execute(FIELD_TOOL_NAME, {
    ...args[operation],
    value: { singleSelectOptionId: 'OPT_TODO' },
  })
  const view = presentation.status({ sessionId: host.session.id, callId: 'write-call-1' })
  assert.equal(view.phase, 'no-change')
  assert.equal(view.result.outcome, 'no-change')
  assert.equal(view.result.dispatched, false)
  assert.equal(view.result.reason, 'FIELD_VALUE_ALREADY_SET')
  assert.equal(view.change.before.name, 'Todo')
  assert.equal(view.targets.project.id, 'P_TARGET')
  assert.equal(subprocess.specs.length, 1)
  assert.equal(host.requests.length, 0)
})
test('trusted denial, preflight failure and uncertain dispatch have distinct bridge evidence', async (t) => {
  for (const variant of ['denied', 'failed', 'uncertain'])
    await t.test(variant, async (t) => {
      const host = await approvalHost(t, {
        answer: variant === 'denied' ? 'rejected' : 'allowed-once',
      })
      const presentation = presentationFor(host.agent)
      const subprocess = fakeSubprocess((spec) =>
        JSON.parse(spec.stdio.stdin.data).query.startsWith('mutation')
          ? { stdout: 'unusable result', exitCode: 1 }
          : json({ data: snapshot(operation) }),
      )
      registerGitHubWriteTools(host.ctx, createGitHubWriteRuntime(subprocess), { presentation })
      await host.execute(
        FIELD_TOOL_NAME,
        variant === 'failed'
          ? { ...args[operation], value: { date: 'invalid date' } }
          : args[operation],
      )
      const view = presentation.status({ sessionId: host.session.id, callId: 'write-call-1' })
      assert.equal(view.phase, variant)
      if (variant === 'uncertain') {
        assert.match(view.result.message, /may have succeeded/)
        presentation.settled(
          { agent: host.agent, name: FIELD_TOOL_NAME, callId: 'write-call-1' },
          { outcome: 'confirmed', host: 'github.com' },
        )
        assert.equal(
          presentation.status({ sessionId: host.session.id, callId: 'write-call-1' }).phase,
          'uncertain',
        )
      }
      if (variant === 'failed') assert.equal(view.change, undefined)
    })
})
test('field status supports a live child without exposing or authorizing any root grant', () => {
  const agent = { session: { id: 'child', seq: 0 } }
  const presentation = presentationFor(agent, false)
  presentation.settled(
    { agent, name: FIELD_TOOL_NAME, callId: 'child-call' },
    { outcome: 'failed', host: 'github.com' },
  )
  const status = presentation.status({ sessionId: 'child', callId: 'child-call' })
  assert.equal(status.phase, 'failed')
  assert.deepEqual(status.grants, [])
  assert.deepEqual(status.history, [])
  assert.equal(presentation.status({ sessionId: 'other', callId: 'child-call' }).phase, 'expired')
})
test('uncovered write tools do not gain presentation records', () => {
  const agent = { session: { id: 'root', seq: 0 } }
  const presentation = presentationFor(agent)
  const exec = { agent, callId: 'other', name: 'github_create_issue' }
  presentation.prepared(exec, {}, 'prepared')
  presentation.settled(exec, { outcome: 'confirmed' })
  assert.equal(presentation.status({ sessionId: 'root', callId: 'other' }).phase, 'expired')
})
