import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createGitHubWriteRuntime, renderWritePreview } from '../src/write-runtime.js'
import { args, snapshot } from './write-payloads.js'
import { fakeSubprocess, json } from './fixtures.js'
import { approvalNames, approvalValue, approvalReason, approvalTool } from './approval-preview-fixtures.js'
let record
vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: value => { record = value } } }, URL })
const plugin = record.factory(() => React)
const markup = (value, reason = approvalReason(value)) => renderToStaticMarkup(React.createElement(plugin.ApprovalPreview, { model: plugin.approvalModel(approvalTool(value.operation), reason) }))
test('all seven previews derive exactly from actual immutable runtime preparations; template copies too', async () => {
  for (const name of Object.keys(args)) {
    const operation = name === 'copyProject' ? 'createProject' : name
    const runtime = createGitHubWriteRuntime(fakeSubprocess([json({ data: snapshot(name) })]))
    const prepared = await runtime.prepare(operation, args[name], { agentId: 'fixture', cwd: '/fixture' })
    assert.ok(Object.isFrozen(prepared))
    const model = plugin.approvalModel(approvalTool(operation), prepared.preview)
    assert.ok(model, name)
    assert.equal(model.reason, prepared.preview)
    assert.deepEqual(JSON.parse(JSON.stringify(model.value.exactPayload)), prepared.payload)
    const html = renderToStaticMarkup(React.createElement(plugin.ApprovalPreview, { model }))
    assert.match(html, /GitHub approval preview/)
    assert.doesNotMatch(html, /<button/)
  }
})
test('malformed, missing, foreign, inconsistent and future payloads retain native fallback', () => {
  for (const reason of [undefined, '', 'unexpected', 'Approve exactly one GitHub mutation on github.com.\n```json\n{}\n```']) assert.equal(plugin.approvalModel('github_create_issue', reason), null)
  for (const operation of approvalNames) {
    const value = approvalValue(operation)
    assert.ok(plugin.approvalModel(approvalTool(operation), approvalReason(value)))
    value.exactPayload.surprise = 'must not hide unknown semantics'
    assert.equal(plugin.approvalModel(approvalTool(operation), approvalReason(value)), null)
  }
  const value = approvalValue('createProject')
  for (const change of [{ targets: { ...value.targets, template: {} } }, { change: { ...value.change, creationPermission: {} } }]) assert.equal(plugin.approvalModel('github_create_project', approvalReason({ ...value, ...change })), null)
  assert.equal(plugin.selectApproval({ callId: 'other', pendingInteraction: { kind: 'approval', callId: 'call', toolName: 'github_create_issue', reason: approvalReason(approvalValue()) } }), null)
})
test('membership keeps unrelated README only in collapsed complete details; direction includes repository identity', () => {
  const html = markup(approvalValue('addProjectItem')), primary = html.split('Technical details')[0]
  assert.doesNotMatch(primary, /UNRELATED PROJECT README SENTINEL/)
  assert.match(html, /UNRELATED PROJECT README SENTINEL/)
  const value = approvalValue('addIssueDependency')
  value.targets.blockedIssue.repository = { nameWithOwner: 'one/repo' }
  value.targets.blockingIssue.repository = { nameWithOwner: 'two/repo' }
  value.targets.blockingIssue.number = value.targets.blockedIssue.number
  value.targets.blockingIssue.title = value.targets.blockedIssue.title
  const result = markup(value)
  assert.match(result, /Blocked issue:.*one\/repo/)
  assert.match(result, /Blocking issue:.*two\/repo/)
})
test('safe Markdown and exact source preserve all long text, whitespace and unsafe syntax without execution', () => {
  const html = markup(approvalValue())
  assert.match(html, /<strong>Important<\/strong>/)
  assert.match(html, /END OF COMPLETE BODY/)
  assert.match(html, /JSON string/)
  assert.doesNotMatch(html, /<img|<script|href="javascript:/)
  assert.match(html, /&lt;img/)
  const value = approvalValue(); value.change.body = value.exactPayload.body = ''
  assert.match(markup(value), /Empty string/)
  value.change.body = value.exactPayload.body = 'bad\u0001control'
  assert.throws(() => renderWritePreview(value), /unsafe/i)
})
test('template copy behavior is exact for both draft options, and malformed copied text falls back', async () => {
  for (const includeDraftIssues of [false, true]) {
    const runtime = createGitHubWriteRuntime(fakeSubprocess([json({ data: snapshot('copyProject') })]))
    const prepared = await runtime.prepare('createProject', { ...args.copyProject, includeDraftIssues }, { agentId: 'fixture', cwd: '/fixture' })
    const model = plugin.approvalModel('github_create_project', prepared.preview)
    assert.equal(model.value.exactPayload.includeDraftIssues, includeDraftIssues)
    const html = renderToStaticMarkup(React.createElement(plugin.ApprovalPreview, { model }))
    assert.match(html, /Source template/); assert.match(html, /Not copied \/ visibility/)
    const malformed = JSON.parse(JSON.stringify(model.value)); malformed.change.copyBehavior.copied = {}
    assert.equal(plugin.approvalModel('github_create_project', approvalReason(malformed)), null)
  }
})
test('missing descriptive metadata and literal Markdown markers remain reviewable', () => {
  const value = approvalValue(); value.targets.repository = { id: 'R' }
  value.change.body = value.exactPayload.body = '*\n`\n**\n  \t\n[bad](https://github.com.evil.test/a)'
  const html = markup(value)
  assert.match(html, /Name unavailable/)
  assert.doesNotMatch(html, /<em><\/em>|<code><\/code>|href="https:\/\/github.com.evil/)
  assert.match(html, /exact source and whitespace/)
})
test('native registration selects exact call only and disposes independently', () => {
  const registrations = [], disposed = []
  plugin.apply({ slots: { inject(name, callback) { const dispose = callback(); if (name === 'conversation.approval.detail') dispose() }, register(options) { registrations.push(options); return () => disposed.push(options.name) } } })
  const registration = registrations.find(x => x.name === 'conversation.approval.detail')
  assert.ok(registration)
  assert.deepEqual(disposed, ['conversation.approval.detail'])
  assert.equal(registration.priority, -10)
  assert.equal(registration.select, undefined, 'single seats do not support chain selectors')
  assert.equal(plugin.selectApproval({ callId: 'call', pendingInteraction: { kind: 'approval', callId: 'call', toolName: 'bash', reason: approvalReason(approvalValue()) } }), null)
})
