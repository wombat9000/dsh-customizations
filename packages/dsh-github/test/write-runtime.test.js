import assert from 'node:assert/strict'
import test from 'node:test'
import { createGitHubWriteRuntime } from '../src/write-runtime.js'
import { WRITE_READS, MUTATIONS } from '../src/write-queries.js'
import { fakeSubprocess, json } from './fixtures.js'
import { args, snapshot, mutationResult, project, repository, issue, blocker, fields } from './write-payloads.js'

const exec = { cwd: '/fixture/session-a', agentId: 'fixture-agent', signal: new AbortController().signal }
const operationOf = name => name === 'copyProject' ? 'createProject' : name
function fixture(name, { before = snapshot(name), after = before, result = mutationResult(name), lastRun, config } = {}) {
  const subprocess = fakeSubprocess([json({ data: before }), json({ data: after }), lastRun ?? json({ data: result })])
  return { subprocess, runtime: createGitHubWriteRuntime(subprocess, config) }
}
function request(spec) {
  assert.deepEqual(spec.argv.slice(0, 7), ['/fixture/bin/gh', 'api', 'graphql', '--hostname', 'github.com', '--method', 'POST'])
  assert.ok(spec.argv.includes('--input'))
  assert.equal(spec.argv[spec.argv.indexOf('--input') + 1], '-')
  return JSON.parse(spec.stdio.stdin.data)
}
function deepFrozen(value) {
  if (!value || typeof value !== 'object') return
  assert.ok(Object.isFrozen(value))
  for (const child of Object.values(value)) deepFrozen(child)
}

const expectedInputs = {
  createProject: { ownerId: 'O_DEST', title: 'New project' },
  copyProject: { ownerId: 'O_DEST', projectId: 'P_TEMPLATE', title: 'Copied project', includeDraftIssues: false },
  updateProject: { projectId: 'P_TARGET', title: 'Updated project', shortDescription: 'Updated description', readme: 'Updated README' },
  linkProjectRepository: { projectId: 'P_TARGET', repositoryId: 'R_TARGET' },
  createIssue: { repositoryId: 'R_TARGET', title: 'New issue', body: 'Complete issue specification' },
  addProjectItem: { projectId: 'P_TARGET', contentId: 'I_TARGET' },
  setProjectItemField: { projectId: 'P_TARGET', itemId: 'PI_TARGET', fieldId: 'F_STATUS', value: { singleSelectOptionId: 'OPT_READY' } },
  addIssueDependency: { issueId: 'I_TARGET', blockingIssueId: 'I_BLOCKER' },
}

test('all seven writes and template copies prepare frozen explicit payloads and dispatch once after recheck', async t => {
  for (const name of Object.keys(args)) await t.test(name, async () => {
    const { runtime, subprocess } = fixture(name)
    const prepared = await runtime.prepare(operationOf(name), args[name], exec)
    deepFrozen(prepared)
    assert.equal(subprocess.specs.length, 1, 'prepare only reads')
    const before = request(subprocess.specs[0])
    assert.equal(before.query, WRITE_READS[name])
    assert.ok(!before.query.startsWith('mutation'))
    const result = await runtime.execute(prepared, exec)
    assert.equal(result.outcome, 'confirmed')
    assert.equal(subprocess.specs.length, 3)
    assert.equal(request(subprocess.specs[1]).query, WRITE_READS[name])
    const dispatched = request(subprocess.specs[2])
    assert.equal(dispatched.query, MUTATIONS[name])
    assert.deepEqual(dispatched.variables.input, expectedInputs[name])
    assert.equal(subprocess.specs[2].cwd, exec.cwd)
    assert.ok(JSON.stringify(result).includes('https://github.com/'))
    await assert.rejects(runtime.execute(prepared, exec))
    assert.equal(subprocess.specs.length, 3, 'prepared token is consumed exactly once')
  })
})

test('complete Markdown content, whitespace, quotes and normal token prose survive preparation and mutation', async () => {
  const body = '# Full specification\n\nReview token scopes and token refresh.\n```json\n{"quoted": "value", "spaces": "a  b"}\n```\n<script>untrusted()</script>\nTrailing  spaces  \n' + 'Complete content. '.repeat(700)
  const input = { ...args.createIssue, title: 'A  title with "quotes"', body }
  const { runtime, subprocess } = fixture('createIssue')
  const prepared = await runtime.prepare('createIssue', input, exec)
  assert.equal(prepared.payload.body, body)
  assert.equal(prepared.payload.title, input.title)
  const preview = JSON.parse(prepared.preview.match(/```json\n([\s\S]*)\n```$/)[1])
  assert.equal(preview.exactPayload.body, body, 'preview includes the complete body, not a truncated sample')
  assert.equal(preview.change.body, body)
  assert.equal(preview.exactPayload.title, input.title)
  assert.doesNotMatch(prepared.preview, /<script>|```json\\n\{"quoted"/)
  await runtime.execute(prepared, exec)
  assert.equal(request(subprocess.specs[2]).variables.input.body, body)
})

test('update preview includes complete before and after content and explicit project identity', async () => {
  const { runtime } = fixture('updateProject')
  const prepared = await runtime.prepare('updateProject', args.updateProject, exec)
  const preview = JSON.parse(prepared.preview.match(/```json\n([\s\S]*)\n```$/)[1])
  assert.deepEqual(preview.change, {
    title: { before: project.title, after: args.updateProject.title },
    shortDescription: { before: project.shortDescription, after: args.updateProject.description },
    readme: { before: project.readme, after: args.updateProject.readme },
  })
  assert.equal(preview.targets.project.id, project.id)
  assert.equal(preview.targets.project.url, project.url)
})

test('template preview distinguishes source and destination and declares draft-copy behavior', async () => {
  const { runtime } = fixture('copyProject')
  const prepared = await runtime.prepare('createProject', args.copyProject, exec)
  for (const value of ['templates', 'destination', 'P_TEMPLATE', 'includeDraftIssues', 'false']) assert.ok(prepared.preview.includes(value), value)
})

test('mutating the original input cannot alter the prepared payload or dispatch', async () => {
  const { runtime, subprocess } = fixture('setProjectItemField')
  const input = structuredClone(args.setProjectItemField)
  const prepared = await runtime.prepare('setProjectItemField', input, exec)
  input.owner = 'other-owner'
  input.value.singleSelectOptionId = 'OPT_TODO'
  assert.equal(prepared.args.owner, 'destination')
  assert.equal(prepared.payload.value.singleSelectOptionId, 'OPT_READY')
  await runtime.execute(prepared, exec)
  assert.deepEqual(request(subprocess.specs[2]).variables.input, expectedInputs.setProjectItemField)
})

test('forged preparations and changed caller workspace or identity never dispatch', async () => {
  for (const patch of [{ cwd: '/fixture/other' }, { agentId: 'other-agent' }]) {
    const { runtime, subprocess } = fixture('createIssue')
    const prepared = await runtime.prepare('createIssue', args.createIssue, exec)
    await assert.rejects(runtime.execute(prepared, { ...exec, ...patch }))
    assert.equal(subprocess.specs.length, 1)
  }
  const { runtime, subprocess } = fixture('createIssue')
  const prepared = await runtime.prepare('createIssue', args.createIssue, exec)
  await assert.rejects(runtime.execute(structuredClone(prepared), exec))
  assert.equal(subprocess.specs.length, 1)
})

test('invalid or missing explicit write targets and unknown mutation inputs fail before subprocess work', async () => {
  const subprocess = fakeSubprocess([])
  const runtime = createGitHubWriteRuntime(subprocess)
  for (const operation of Object.keys(args).filter(name => name !== 'copyProject')) await assert.rejects(runtime.prepare(operation, {}, exec), { code: 'INVALID_ARGUMENT' })
  for (const input of [
    { ...args.createIssue, owner: '../escape' }, { ...args.createIssue, repo: 'a/b' },
    { ...args.createIssue, title: '' }, { ...args.createIssue, title: 'x'.repeat(257) },
    { ...args.createIssue, body: 'x'.repeat(20001) }, { ...args.createIssue, method: 'DELETE' },
    { ...args.createIssue, query: 'mutation { unsafe }' }, { ...args.createIssue, host: 'evil.test' },
  ]) await assert.rejects(runtime.prepare('createIssue', input, exec), { code: 'INVALID_ARGUMENT' })
  for (const input of [
    { ...args.createProject, templateOwner: 'templates' }, { ...args.createProject, templateNumber: 9 },
    { ...args.createProject, includeDraftIssues: true },
  ]) await assert.rejects(runtime.prepare('createProject', input, exec), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(runtime.prepare('updateProject', { owner: 'destination', projectNumber: 7 }, exec), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(runtime.prepare('createIssue', args.createIssue, { cwd: exec.cwd }), { code: 'CONTEXT_CHANGED' })
  assert.equal(subprocess.specs.length, 0)
})

test('actual project definitions accept only matching supported field values, including fractional numbers', async t => {
  for (const [fieldId, value] of [
    ['F_TEXT', { text: 'Exact  multiline\ntext' }], ['F_NUMBER', { number: -1.25 }],
    ['F_DATE', { date: '2024-02-29' }], ['F_STATUS', { singleSelectOptionId: 'OPT_READY' }],
    ['F_ITERATION', { iterationId: 'ITER_ACTIVE' }], ['F_ITERATION', { iterationId: 'ITER_OLD' }],
  ]) await t.test(`${fieldId}:${Object.values(value)[0]}`, async () => {
    const { runtime, subprocess } = fixture('setProjectItemField')
    const prepared = await runtime.prepare('setProjectItemField', { ...args.setProjectItemField, fieldId, value }, exec)
    const preview = JSON.parse(prepared.preview.match(/```json\n([\s\S]*)\n```$/)[1])
    assert.equal(preview.change.field.id, fieldId)
    assert.equal(preview.change.field.name, fields.find(field => field.id === fieldId).name)
    assert.deepEqual(preview.change.after, value)
    const result = await runtime.execute(prepared, exec)
    assert.equal(result.outcome, 'confirmed')
    assert.deepEqual(request(subprocess.specs[2]).variables.input.value, value)
  })
})

test('invalid field dates, shapes and non-finite numbers fail before target reads', async () => {
  const subprocess = fakeSubprocess([])
  const runtime = createGitHubWriteRuntime(subprocess)
  for (const value of [{}, { number: NaN }, { number: Infinity }, { number: '1.5' }, { date: '2023-02-29' }, { date: '2026-02-30' }, { date: '2026-1-01' }, { text: 'x', number: 1 }, { clear: true }, { singleSelectOptionId: '../other' }]) {
    await assert.rejects(runtime.prepare('setProjectItemField', { ...args.setProjectItemField, value }, exec), { code: 'INVALID_ARGUMENT' })
  }
  assert.equal(subprocess.specs.length, 0)
})

test('field ownership, type, option membership, archival state and duplicate values fail closed', async t => {
  const cases = [
    { label: 'foreign field', patchArgs: { fieldId: 'F_FOREIGN' }, code: 'NOT_FOUND' },
    { label: 'wrong type', patchArgs: { value: { text: 'Ready' } }, code: 'INVALID_ARGUMENT' },
    { label: 'foreign option', patchArgs: { value: { singleSelectOptionId: 'OPT_FOREIGN' } }, code: 'INVALID_ARGUMENT' },
    { label: 'foreign iteration', patchArgs: { fieldId: 'F_ITERATION', value: { iterationId: 'ITER_FOREIGN' } }, code: 'INVALID_ARGUMENT' },
    { label: 'foreign item project', alter: data => { data.node.project.id = 'P_OTHER' }, code: 'NOT_FOUND' },
    { label: 'archived item', alter: data => { data.node.isArchived = true }, code: 'PERMISSION_DENIED' },
    { label: 'issue-owned field', alter: data => { data.repositoryOwner.projectV2.fields.nodes[3].isIssueField = true }, code: 'INVALID_ARGUMENT' },
    { label: 'unsupported field', alter: data => { data.repositoryOwner.projectV2.fields.nodes[3].dataType = 'ASSIGNEES' }, code: 'INVALID_ARGUMENT' },
    { label: 'already set', patchArgs: { value: { singleSelectOptionId: 'OPT_TODO' } }, code: 'ALREADY_EXISTS' },
  ]
  for (const row of cases) await t.test(row.label, async () => {
    const before = snapshot('setProjectItemField')
    row.alter?.(before)
    const { runtime, subprocess } = fixture('setProjectItemField', { before })
    await assert.rejects(runtime.prepare('setProjectItemField', { ...args.setProjectItemField, ...row.patchArgs }, exec), { code: row.code })
    assert.equal(subprocess.specs.length, 1)
  })
})

test('duplicate project memberships, repository links and dependencies are rejected without mutation', async t => {
  for (const name of ['linkProjectRepository', 'addProjectItem', 'addIssueDependency']) await t.test(name, async () => {
    const before = snapshot(name)
    if (name === 'linkProjectRepository') before.repositoryOwner.projectV2.repositories.nodes.push(repository)
    if (name === 'addProjectItem') before.repository.issue.projectItems.nodes.push({ id: 'PI_EXISTING', isArchived: true, project: { id: project.id } })
    if (name === 'addIssueDependency') before.repository.issue.blockedBy.nodes.push(blocker)
    const { runtime, subprocess } = fixture(name, { before })
    await assert.rejects(runtime.prepare(name, args[name], exec), { code: 'ALREADY_EXISTS' })
    assert.equal(subprocess.specs.length, 1)
  })
  const before = snapshot('addIssueDependency')
  before.blockingRepository.issue.id = issue.id
  await assert.rejects(fixture('addIssueDependency', { before }).runtime.prepare('addIssueDependency', args.addIssueDependency, exec), { code: 'INVALID_ARGUMENT' })
})

test('incomplete relevant collections fail closed instead of assuming absent duplicates or fields', async t => {
  for (const name of ['linkProjectRepository', 'addProjectItem', 'setProjectItemField', 'addIssueDependency']) await t.test(name, async () => {
    const before = snapshot(name)
    const collection = name === 'linkProjectRepository' ? before.repositoryOwner.projectV2.repositories : name === 'addProjectItem' ? before.repository.issue.projectItems : name === 'setProjectItemField' ? before.repositoryOwner.projectV2.fields : before.repository.issue.blockedBy
    collection.pageInfo = { hasNextPage: true, endCursor: 'more-results' }
    const { runtime, subprocess } = fixture(name, { before })
    await assert.rejects(runtime.prepare(name, args[name], exec), { code: 'BOUND_EXCEEDED' })
    assert.equal(subprocess.specs.length, 1)
  })
})

test('identity, permissions, target metadata and field state changes require a new preview', async t => {
  const cases = [
    { name: 'createIssue', label: 'account switch', change: data => { data.viewer.id = 'U_OTHER'; data.viewer.login = 'other-user' } },
    { name: 'createIssue', label: 'repository access lost', change: data => { data.repository.viewerCanCreateIssues = false } },
    { name: 'createIssue', label: 'repository identity changed', change: data => { data.repository.id = 'R_OTHER' } },
    { name: 'updateProject', label: 'remote update', change: data => { data.repositoryOwner.projectV2.readme = 'Concurrent remote content' } },
    { name: 'updateProject', label: 'project permission lost', change: data => { data.repositoryOwner.projectV2.viewerCanUpdate = false } },
    { name: 'setProjectItemField', label: 'field renamed', change: data => { data.repositoryOwner.projectV2.fields.nodes[3].name = 'Renamed status' } },
    { name: 'setProjectItemField', label: 'field value changed', change: data => { data.node.fieldValues.nodes[0].optionId = 'OPT_READY' } },
    { name: 'addProjectItem', label: 'membership appeared', change: data => { data.repository.issue.projectItems.nodes.push({ id: 'PI_LATE', project: { id: project.id } }) } },
    { name: 'addIssueDependency', label: 'dependency appeared', change: data => { data.repository.issue.blockedBy.nodes.push(blocker) } },
  ]
  for (const row of cases) await t.test(row.label, async () => {
    const before = snapshot(row.name), after = structuredClone(before)
    row.change(after)
    const { runtime, subprocess } = fixture(row.name, { before, after })
    const prepared = await runtime.prepare(row.name, args[row.name], exec)
    await assert.rejects(runtime.execute(prepared, exec), { code: 'CONFLICT' })
    assert.equal(subprocess.specs.length, 2)
    await assert.rejects(runtime.execute(prepared, exec), { code: 'APPROVAL_REQUIRED' })
    assert.equal(subprocess.specs.length, 2)
  })
})

test('unknown permission, invalid authentication and unavailable CLI fail before mutation with sanitized errors', async () => {
  for (const [before, name, code] of [
    [{ ...snapshot('createIssue'), viewer: { id: '', login: '' } }, 'createIssue', 'AUTH_REQUIRED'],
    [{ ...snapshot('createIssue'), repository: { ...repository, viewerCanCreateIssues: null } }, 'createIssue', 'PERMISSION_DENIED'],
    [{ ...snapshot('linkProjectRepository'), repository: { ...repository, viewerPermission: 'READ' } }, 'linkProjectRepository', 'PERMISSION_DENIED'],
  ]) {
    const { runtime, subprocess } = fixture(name, { before })
    await assert.rejects(runtime.prepare(name, args[name], exec), { code })
    assert.equal(subprocess.specs.length, 1)
  }
  for (const [stderr, code] of [['HTTP 401 bad credentials', 'AUTH_REQUIRED'], ['HTTP 403 forbidden', 'PERMISSION_DENIED'], ['HTTP 404 Not Found', 'NOT_FOUND'], ['HTTP 429 rate limit', 'RATE_LIMITED'], ['HTTP 503 network error', 'READ_FAILED']]) {
    const subprocess = fakeSubprocess([{ exitCode: 1, stderr: `${stderr} ghp_SYNTHETIC_SECRET Authorization: Bearer private-value` }])
    await assert.rejects(createGitHubWriteRuntime(subprocess).prepare('createIssue', args.createIssue, exec), error => {
      assert.equal(error.code, code)
      assert.doesNotMatch(error.message, /SYNTHETIC_SECRET|private-value/)
      return true
    })
    assert.equal(subprocess.specs.length, 1, 'preflight does not retry')
  }
  const subprocess = fakeSubprocess([], { missing: 'gh' })
  await assert.rejects(createGitHubWriteRuntime(subprocess).prepare('createIssue', args.createIssue, exec), { code: 'CLI_UNAVAILABLE' })
  assert.equal(subprocess.specs.length, 0)
})

test('credential-looking user or remote content never reaches previews or mutation dispatch', async () => {
  for (const body of ['ghp_SYNTHETIC_SECRET', 'github_pat_SYNTHETIC_SECRET', 'Authorization: Bearer private-value', 'https://user:private-value@github.com/repo', '-----BEGIN PRIVATE KEY-----\nprivate-value', '\u202ehidden text']) {
    const subprocess = fakeSubprocess([])
    await assert.rejects(createGitHubWriteRuntime(subprocess).prepare('createIssue', { ...args.createIssue, body }, exec), error => {
      assert.equal(error.code, 'UNSAFE_CONTENT')
      assert.doesNotMatch(error.message, /SYNTHETIC_SECRET|private-value|hidden text/)
      return true
    })
    assert.equal(subprocess.specs.length, 0)
  }
  const before = snapshot('updateProject')
  before.repositoryOwner.projectV2.readme = 'ghp_SYNTHETIC_SECRET'
  await assert.rejects(fixture('updateProject', { before }).runtime.prepare('updateProject', args.updateProject, exec), { code: 'UNSAFE_CONTENT' })
})

test('post-dispatch errors, invalid responses, loss and timeouts are uncertain and never retried', async t => {
  for (const [label, lastRun] of [
    ['auth failure', { exitCode: 1, stderr: 'HTTP 401 ghp_SYNTHETIC_SECRET' }],
    ['network failure', { exitCode: 1, stderr: 'HTTP 503 Authorization: Bearer private-value' }],
    ['GraphQL errors', json({ data: mutationResult('createIssue'), errors: [{ message: 'may have failed' }] })],
    ['malformed JSON', { stdout: 'not JSON' }], ['wrong identity', json({ data: { createIssue: { issue: { ...issue, repository: { id: 'R_WRONG' } } } } })],
    ['truncated output', { ...json({ data: mutationResult('createIssue') }), lossy: true }],
    ['spawn exception', { spawnError: new Error('ghp_SYNTHETIC_SECRET') }],
    ['timeout after dispatch', { pending: true }],
  ]) await t.test(label, async () => {
    const { runtime, subprocess } = fixture('createIssue', { lastRun, config: { timeoutMs: 30 } })
    const prepared = await runtime.prepare('createIssue', args.createIssue, exec)
    let dispatches = 0
    const result = await runtime.execute(prepared, exec, { onDispatch: () => { dispatches++ } })
    assert.equal(result.outcome, 'uncertain')
    assert.equal(dispatches, 1)
    assert.equal(subprocess.specs.length, 3)
    assert.equal(result.resource, undefined)
    assert.equal(result.knownTargets.repository.id, repository.id)
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SECRET|private-value/)
    assert.match(result.message, /Do not retry automatically/)
    await assert.rejects(runtime.execute(prepared, exec), { code: 'APPROVAL_REQUIRED' })
    assert.equal(subprocess.specs.length, 3)
  })
})

test('failure before mutation dispatch remains a definite error, not an uncertain success', async () => {
  const { runtime, subprocess } = fixture('createIssue')
  const resolve = subprocess.resolveExecutable.bind(subprocess)
  let resolutions = 0
  subprocess.resolveExecutable = (...values) => ++resolutions === 3 ? undefined : resolve(...values)
  const prepared = await runtime.prepare('createIssue', args.createIssue, exec)
  let dispatched = false
  await assert.rejects(runtime.execute(prepared, exec, { onDispatch: () => { dispatched = true } }), { code: 'CLI_UNAVAILABLE' })
  assert.equal(dispatched, false)
  assert.equal(subprocess.specs.length, 2)
  await assert.rejects(runtime.execute(prepared, exec), { code: 'APPROVAL_REQUIRED' })
})

test('cancellation before dispatch fails closed while cancellation after dispatch reports uncertainty', async () => {
  const before = fixture('createIssue')
  const prepared = await before.runtime.prepare('createIssue', args.createIssue, exec)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(before.runtime.execute(prepared, { ...exec, signal: cancelled.signal }), { code: 'CANCELLED' })
  assert.equal(before.subprocess.specs.length, 1)
  const after = fixture('createIssue')
  const second = await after.runtime.prepare('createIssue', args.createIssue, exec)
  const controller = new AbortController()
  const result = await after.runtime.execute(second, { ...exec, signal: controller.signal }, { onDispatch: () => controller.abort() })
  assert.equal(result.outcome, 'uncertain')
  assert.equal(after.subprocess.specs.length, 3)
})
