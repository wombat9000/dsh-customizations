import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import { createGitHubWriteRuntime, renderWritePreview } from '../src/write-runtime.js'
import { args, snapshot } from './write-payloads.js'
import { fakeSubprocess, json } from './fixtures.js'
import {
  approvalNames,
  approvalValue,
  approvalReason,
  approvalTool,
} from './approval-preview-fixtures.js'
let record
vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
  window: {
    __ModuleLoader__: {
      load: (value) => {
        record = value
      },
    },
  },
  URL,
})
import { registerTypeScript } from './source-loader.mjs'
registerTypeScript()
const plugin = await import('../client/approval-model.ts')
const bundledPlugin = record.factory(() => React)
test('all seven previews derive exactly from actual immutable runtime preparations; template copies too', async () => {
  for (const name of Object.keys(args)) {
    const operation = name === 'copyProject' ? 'createProject' : name
    const runtime = createGitHubWriteRuntime(fakeSubprocess([json({ data: snapshot(name) })]))
    const prepared = await runtime.prepare(operation, args[name], {
      agentId: 'fixture',
      cwd: '/fixture',
    })
    assert.ok(Object.isFrozen(prepared))
    const model = plugin.approvalModel(approvalTool(operation), prepared.preview)
    assert.ok(model, name)
    assert.equal(model.reason, prepared.preview)
    assert.deepEqual(JSON.parse(JSON.stringify(model.value.exactPayload)), prepared.payload)
  }
})
test('malformed, missing, foreign, inconsistent and future payloads retain native fallback', () => {
  for (const reason of [
    undefined,
    '',
    'unexpected',
    'Approve exactly one GitHub mutation on github.com.\n```json\n{}\n```',
  ])
    assert.equal(plugin.approvalModel('github_create_issue', reason), null)
  for (const operation of approvalNames) {
    const value = approvalValue(operation)
    assert.ok(plugin.approvalModel(approvalTool(operation), approvalReason(value)))
    value.exactPayload.surprise = 'must not hide unknown semantics'
    assert.equal(plugin.approvalModel(approvalTool(operation), approvalReason(value)), null)
  }
  const value = approvalValue('createProject')
  for (const change of [
    { targets: { ...value.targets, template: {} } },
    { change: { ...value.change, creationPermission: {} } },
  ])
    assert.equal(
      plugin.approvalModel('github_create_project', approvalReason({ ...value, ...change })),
      null,
    )
  assert.equal(
    plugin.selectApproval({
      callId: 'other',
      pendingInteraction: {
        kind: 'approval',
        callId: 'call',
        toolName: 'github_create_issue',
        reason: approvalReason(approvalValue()),
      },
    }),
    null,
  )
})
// Change one JSON leaf at a time: each mismatch must independently retain the
// complete native fallback rather than displaying an unrelated approval preview.
const bindingPaths = {
  createProject: [
    ['targets', 'destination', 'id'],
    ['change', 'title'],
  ],
  createIssue: [
    ['targets', 'repository', 'id'],
    ['change', 'title'],
    ['change', 'body'],
  ],
  updateProject: [
    ['targets', 'project', 'id'],
    ['change', 'title', 'after'],
    ['change', 'shortDescription', 'after'],
    ['change', 'readme', 'after'],
  ],
  linkProjectRepository: [
    ['targets', 'project', 'id'],
    ['targets', 'repository', 'id'],
    ['change', 'link', 'id'],
  ],
  addProjectItem: [
    ['targets', 'project', 'id'],
    ['targets', 'issue', 'id'],
    ['change', 'addIssue', 'id'],
  ],
  setProjectItemField: [
    ['targets', 'project', 'id'],
    ['targets', 'item', 'id'],
    ['change', 'field', 'id'],
    ['change', 'after', 'singleSelectOptionId'],
  ],
  addIssueDependency: [
    ['targets', 'blockedIssue', 'id'],
    ['targets', 'blockingIssue', 'id'],
    ['change', 'addBlockedBy', 'id'],
  ],
}
function replaceLeaf(value, path, replacement) {
  let parent = value
  for (const key of path.slice(0, -1)) parent = parent[key]
  parent[path.at(-1)] = replacement
}
for (const operation of approvalNames) {
  test(`${operation} binds each target and proposed change to its exact payload`, () => {
    const original = approvalValue(operation)
    assert.ok(plugin.approvalModel(approvalTool(operation), approvalReason(original)))
    for (const path of bindingPaths[operation]) {
      const value = JSON.parse(JSON.stringify(original))
      replaceLeaf(value, path, 'UNRELATED_VALUE')
      assert.equal(
        plugin.approvalModel(approvalTool(operation), approvalReason(value)),
        null,
        path.join('.'),
      )
    }
    for (const key of Object.keys(original.exactPayload)) {
      const value = JSON.parse(JSON.stringify(original))
      value.exactPayload[key] =
        key === 'value' ? { singleSelectOptionId: 'UNRELATED' } : 'UNRELATED'
      assert.equal(
        plugin.approvalModel(approvalTool(operation), approvalReason(value)),
        null,
        `exactPayload.${key}`,
      )
    }
  })
}
test('host write preview rejects unsafe control characters before client rendering', () => {
  const value = approvalValue()
  value.change.body = value.exactPayload.body = 'bad\u0001control'
  assert.throws(() => renderWritePreview(value), /unsafe/i)
})
test('template copy behavior is exact for both draft options, and malformed copied text falls back', async () => {
  for (const includeDraftIssues of [false, true]) {
    const runtime = createGitHubWriteRuntime(
      fakeSubprocess([json({ data: snapshot('copyProject') })]),
    )
    const prepared = await runtime.prepare(
      'createProject',
      { ...args.copyProject, includeDraftIssues },
      { agentId: 'fixture', cwd: '/fixture' },
    )
    const model = plugin.approvalModel('github_create_project', prepared.preview)
    assert.equal(model.value.exactPayload.includeDraftIssues, includeDraftIssues)
    for (const [path, replacement] of [
      [['targets', 'destination', 'id'], 'OTHER_OWNER'],
      [['targets', 'template', 'id'], 'OTHER_TEMPLATE'],
      [['change', 'title'], 'Other title'],
      [['change', 'copyBehavior', 'sourceTemplate'], 'OTHER_TEMPLATE'],
      [['change', 'copyBehavior', 'includeDraftIssues'], !includeDraftIssues],
      [['change', 'copyBehavior', 'ordinaryNewProject'], false],
      [['exactPayload', 'ownerId'], 'OTHER_OWNER'],
      [['exactPayload', 'projectId'], 'OTHER_TEMPLATE'],
      [['exactPayload', 'title'], 'Other title'],
      [['exactPayload', 'includeDraftIssues'], !includeDraftIssues],
    ]) {
      const mismatched = JSON.parse(JSON.stringify(model.value))
      replaceLeaf(mismatched, path, replacement)
      assert.equal(
        plugin.approvalModel('github_create_project', approvalReason(mismatched)),
        null,
        path.join('.'),
      )
    }
    const malformed = JSON.parse(JSON.stringify(model.value))
    malformed.change.copyBehavior.copied = {}
    assert.equal(plugin.approvalModel('github_create_project', approvalReason(malformed)), null)
  }
})
test('native registration selects exact call only and disposes independently', () => {
  const registrations = [],
    disposed = []
  bundledPlugin.apply({
    slots: {
      inject(name, callback) {
        const dispose = callback()
        if (name === 'conversation.approval.detail') dispose()
      },
      register(options) {
        registrations.push(options)
        return () => disposed.push(options.name)
      },
    },
  })
  const registration = registrations.find((x) => x.name === 'conversation.approval.detail')
  assert.ok(registration)
  assert.deepEqual(disposed, ['conversation.approval.detail'])
  assert.equal(registration.priority, -10)
  assert.equal(registration.select, undefined, 'single seats do not support chain selectors')
  assert.equal(
    plugin.selectApproval({
      callId: 'call',
      pendingInteraction: {
        kind: 'approval',
        callId: 'call',
        toolName: 'bash',
        reason: approvalReason(approvalValue()),
      },
    }),
    null,
  )
})
