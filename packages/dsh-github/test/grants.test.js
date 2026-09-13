import assert from 'node:assert/strict'
import test from 'node:test'
import { createGitHubGrantRuntime, validateGrantArguments } from '../src/grants.js'
import { createGitHubWriteRuntime } from '../src/write-runtime.js'
import { createGitHubRuntime } from '../src/runtime.js'
import { GRANT_READS, WRITE_READS } from '../src/write-queries.js'
import { fakeSubprocess, json, connection } from './fixtures.js'
import { actor, owner, project, issue, blocker, item, args, snapshot, mutationResult } from './write-payloads.js'

const input = { operations: ['setProjectItemField', 'addIssueDependency'], issues: [{ owner: 'source', repo: 'example', issueNumber: 33 }, { owner: 'blockers', repo: 'other', issueNumber: 34 }], projects: [{ owner: 'destination', projectNumber: 7 }] }
const execution = () => ({ session: {}, isSubagent: false, agentId: 'session', cwd: '/fixture/workspace' })
function fixture(options = {}) {
  const exec = execution()
  let mutations = 0
  const subprocess = fakeSubprocess(spec => {
    const request = JSON.parse(spec.stdio.stdin.data)
    const { query, variables } = request
    if (query.startsWith('mutation')) { mutations++; return options.mutation?.(request) ?? json({ data: mutationResult('setProjectItemField') }) }
    let data
    if (query === GRANT_READS.issue) {
      const target = variables.issueNumber === 33 ? issue : blocker
      const repo = { ...target.repository, owner: { id: variables.owner === 'source' ? 'O_SOURCE' : 'O_BLOCKERS', login: variables.owner } }
      data = { viewer: actor, repository: { ...repo, issue: { ...target, projectItems: connection(target.id === issue.id ? [{ id: item.id, isArchived: false, project: { id: project.id, number: project.number, owner: project.owner } }] : []) } } }
    } else if (query === GRANT_READS.project) data = { viewer: actor, repositoryOwner: { ...owner, projectV2: project } }
    else {
      const operation = Object.keys(WRITE_READS).find(key => WRITE_READS[key] === query)
      assert.ok(operation)
      data = snapshot(operation)
      if (operation === 'setProjectItemField') data.node.content.repository = issue.repository
    }
    data = structuredClone(data)
    options.read?.(data, query, variables)
    return json({ data })
  })
  const runtime = createGitHubWriteRuntime(subprocess)
  const grants = createGitHubGrantRuntime(runtime)
  return { exec, subprocess, runtime, grants, mutations: () => mutations }
}
async function grant(f, value = input) { return f.grants.accept(await f.grants.prepare(value, f.exec), f.exec) }
async function write(f, operation = 'setProjectItemField') { return f.runtime.prepare(operation, args[operation], f.exec) }
function execute(f, prepared, permit) { return f.runtime.execute(prepared, f.exec, { onPreflight: fresh => f.grants.observe(fresh.actor, f.exec), beforeDispatch: () => f.grants.assert(permit, prepared, f.exec) }) }

// All remote interaction below uses the existing subprocess GraphQL path with synthetic responses.
test('explicit bounded issue/project/operation arguments reject wildcard, unknown, duplicate and unbounded targets', () => {
  assert.deepEqual(validateGrantArguments(input).operations, ['addIssueDependency', 'setProjectItemField'])
  for (const change of [{ operations: [] }, { operations: ['createIssue'] }, { operations: ['setProjectItemField', 'setProjectItemField'] }, { issues: [] }, { issues: [...input.issues, input.issues[0]] }, { issues: Array(51).fill(input.issues[0]) }, { projects: [] }, { projects: Array(21).fill(input.projects[0]) }, { issues: [{ owner: '*', repo: 'example', issueNumber: 1 }] }, { projects: [{ owner: 'destination', projectNumber: 7, any: true }] }, { repositories: ['all'] }]) assert.throws(() => validateGrantArguments({ ...input, ...change }))
})

test('scope resolution binds immutable account, owner, repository, issue, project and membership identities', async () => {
  const f = fixture(); const token = await f.grants.prepare(input, f.exec)
  assert.equal(f.subprocess.specs.length, 3)
  assert.ok(Object.isFrozen(token.scope.issues[0]))
  assert.deepEqual(token.scope.account, actor)
  assert.deepEqual(token.scope.memberships, [{ id: item.id, issueId: issue.id, projectId: project.id }])
  assert.equal(token.scope.projects[0].ownerId, owner.id)
  assert.equal(token.scope.issues.find(value => value.id === issue.id).repositoryOwnerId, 'O_SOURCE')
  assert.equal(f.mutations(), 0)
  const summary = await f.grants.accept(token, f.exec)
  assert.equal(summary.state, 'active')
  assert.equal(f.subprocess.specs.length, 6, 'accept resolves the complete scope again')
  assert.equal(f.grants.list(f.exec)[0].id, summary.id)
  await assert.rejects(f.grants.accept(token, f.exec))
})

test('accept rejects fabricated, serialized, replaced-session, child and changed-scope requests', async t => {
  for (const mode of ['fabricated', 'serialized', 'session', 'child', 'repo', 'issue', 'owner', 'project', 'membership']) await t.test(mode, async () => {
    let changed = false
    const f = fixture({ read(data, query) {
      if (!changed) return
      if (query === GRANT_READS.issue && data.repository.issue.id === issue.id) {
        if (mode === 'repo') data.repository.id = 'R_REPLACED'
        if (mode === 'issue') data.repository.issue.id = 'I_REPLACED'
        if (mode === 'owner') data.repository.owner.id = 'O_REPLACED'
        if (mode === 'membership') data.repository.issue.projectItems.nodes[0].id = 'PI_REPLACED'
      }
      if (query === GRANT_READS.project && mode === 'project') data.repositoryOwner.projectV2.id = 'P_REPLACED'
    } })
    let token = await f.grants.prepare(input, f.exec); changed = true
    if (mode === 'fabricated') token = { scope: token.scope }
    if (mode === 'serialized') token = JSON.parse(JSON.stringify(token))
    const exec = mode === 'session' ? { ...f.exec, session: {} } : mode === 'child' ? { ...f.exec, isSubagent: true } : f.exec
    await assert.rejects(f.grants.accept(token, exec))
    assert.equal(f.mutations(), 0)
  })
})

test('truncated memberships, inaccessible projects, unknown repository and account inconsistency fail closed', async t => {
  for (const mode of ['truncated', 'inaccessible', 'repo', 'account']) await t.test(mode, async () => {
    const f = fixture({ read(data, query) {
      if (query === GRANT_READS.issue) {
        if (mode === 'truncated') data.repository.issue.projectItems.pageInfo.hasNextPage = true
        if (mode === 'repo') data.repository.nameWithOwner = 'other/repo'
      }
      if (query === GRANT_READS.project) {
        if (mode === 'account') data.viewer.id = 'U_OTHER'
        if (mode === 'inaccessible') data.repositoryOwner.projectV2 = null
      }
    } })
    await assert.rejects(f.grants.prepare(input, f.exec))
  })
})

test('only selected field memberships and both selected dependency endpoints receive permits', async () => {
  const f = fixture(); await grant(f)
  const prepared = await write(f)
  const permit = f.grants.check(prepared, f.exec)
  assert.ok(permit); f.grants.assert(permit, prepared, f.exec)
  assert.equal((await execute(f, prepared, permit)).outcome, 'confirmed')
  const dependency = await write(f, 'addIssueDependency')
  assert.ok(f.grants.check(dependency, f.exec))
  for (const mutate of [p => { p.targets.item.id = 'OTHER' }, p => { p.targets.item.content.id = 'OTHER' }, p => { p.targets.item.content.repository.id = 'OTHER' }, p => { p.targets.item.content.__typename = 'PullRequest' }, p => { p.targets.project.id = 'OTHER' }, p => { p.targets.project.owner.id = 'OTHER' }]) {
    const substituted = structuredClone(prepared); mutate(substituted)
    assert.equal(f.grants.check(substituted, f.exec), null)
  }
  const outside = structuredClone(dependency); outside.targets.blockingIssue.id = 'OTHER'
  assert.equal(f.grants.check(outside, f.exec), null)
  assert.equal(f.grants.check(await write(f, 'createIssue'), f.exec), null)
  assert.throws(() => f.grants.assert(permit, structuredClone(prepared), f.exec))
})

test('reused repository owner login cannot substitute immutable owner identity in field or dependency permits', async () => {
  const f = fixture(); await grant(f)
  const field = await write(f); const dependency = await write(f, 'addIssueDependency')
  assert.ok(f.grants.check(field, f.exec)); assert.ok(f.grants.check(dependency, f.exec))
  for (const original of [field, dependency]) {
    const changed = structuredClone(original)
    const repository = original.operation === 'setProjectItemField' ? changed.targets.item.content.repository : changed.targets.blockingIssue.repository
    repository.owner.id = 'O_REPLACEMENT'
    assert.equal(f.grants.check(changed, f.exec), null, 'same repo ID and name cannot replace repository owner ID')
  }
})

test('native dependency add dispatches exactly once with both approved issue identities', async () => {
  const f = fixture({ mutation: () => json({ data: mutationResult('addIssueDependency') }) })
  await grant(f, { ...input, operations: ['addIssueDependency'], projects: [] })
  const prepared = await write(f, 'addIssueDependency'); const permit = f.grants.check(prepared, f.exec)
  assert.equal((await execute(f, prepared, permit)).outcome, 'confirmed')
  assert.equal(f.mutations(), 1)
  const request = JSON.parse(f.subprocess.specs.at(-1).stdio.stdin.data)
  assert.deepEqual(request.variables.input, { issueId: issue.id, blockingIssueId: blocker.id })
})

test('operations are independently selected and unsupported writes preserve one-shot execution', async () => {
  const f = fixture({ mutation: () => json({ data: mutationResult('createIssue') }) })
  await grant(f, { ...input, operations: ['addIssueDependency'], projects: [] })
  assert.equal(f.grants.check(await write(f), f.exec), null)
  const prepared = await write(f, 'createIssue')
  assert.equal(f.grants.check(prepared, f.exec), null)
  assert.equal((await f.runtime.execute(prepared, f.exec)).outcome, 'confirmed')
})

test('exact live session, agent, cwd, no child authority and lifecycle disposal are enforced', async () => {
  const f = fixture(); await grant(f); const prepared = await write(f); const permit = f.grants.check(prepared, f.exec)
  assert.equal(f.grants.check(prepared, { ...f.exec, session: {} }), null, 'restored same textual identity never inherits')
  for (const change of [{ agentId: 'other' }, { cwd: '/other' }, { isSubagent: true }, { isSubagent: undefined }]) assert.throws(() => f.grants.assert(permit, prepared, { ...f.exec, ...change }))
  f.grants.disposeSession(f.exec.session)
  assert.throws(() => f.grants.assert(permit, prepared, f.exec))
  await assert.rejects(f.grants.prepare(input, f.exec))
  const g = fixture(); await grant(g); const p = await write(g); const q = g.grants.check(p, g.exec); g.grants.dispose()
  assert.throws(() => g.grants.assert(q, p, g.exec))
})

test('observed account change revokes permanently even when the account switches back', async () => {
  const f = fixture(); await grant(f); const prepared = await write(f); const permit = f.grants.check(prepared, f.exec)
  f.grants.observe({ id: 'U_OTHER', login: 'other' }, f.exec)
  f.grants.observe(actor, f.exec)
  assert.equal(f.grants.check(prepared, f.exec), null)
  assert.throws(() => f.grants.assert(permit, prepared, f.exec))
  assert.equal(f.grants.list(f.exec)[0].state, 'account-changed')
})

test('account changes observed in another live session invalidate all previous account authority', async () => {
  const f = fixture(); await grant(f); const prepared = await write(f); const permit = f.grants.check(prepared, f.exec)
  const other = execution()
  f.grants.observe({ id: 'U_OTHER', login: 'other' }, other)
  f.grants.observe(actor, f.exec)
  assert.equal(f.grants.check(prepared, f.exec), null)
  assert.throws(() => f.grants.assert(permit, prepared, f.exec))
})

test('connection status and child preflight observations invalidate grants without granting child authority', async t => {
  for (const mode of ['connectionStatus', 'childPreflight']) await t.test(mode, async () => {
    let changed = false
    const f = fixture({ read(data, query) { if (changed && query === WRITE_READS.setProjectItemField) data.viewer = { id: 'U_OTHER', login: 'other' } } })
    await grant(f); const prepared = await write(f); const permit = f.grants.check(prepared, f.exec)
    const child = { ...f.exec, session: {}, agentId: 'child', isSubagent: true }
    if (mode === 'connectionStatus') {
      const reads = createGitHubRuntime(fakeSubprocess([json({ data: { viewer: { id: 'U_OTHER', login: 'other' } } })]), { onAccount: actor => f.grants.observeAccount(actor) })
      assert.equal((await reads.connectionStatus({}, child)).data.account, 'other')
    } else {
      changed = true
      await f.runtime.prepare('setProjectItemField', args.setProjectItemField, child, { onAccount: actor => f.grants.observeAccount(actor) })
    }
    f.grants.observeAccount(actor)
    assert.equal(f.grants.list(f.exec)[0].state, 'account-changed')
    assert.equal(f.grants.check(prepared, f.exec), null)
    assert.throws(() => f.grants.assert(permit, prepared, f.exec))
    assert.throws(() => f.grants.check(prepared, child))
    f.grants.dispose()
    assert.throws(() => f.grants.observeAccount(actor))
  })
})

test('account change during dispatch recheck invalidates the grant before conflict rejection', async () => {
  let changed = false
  const f = fixture({ read(data, query) { if (changed && query === WRITE_READS.setProjectItemField) data.viewer.id = 'U_OTHER' } })
  await grant(f); const prepared = await write(f); const permit = f.grants.check(prepared, f.exec); changed = true
  await assert.rejects(execute(f, prepared, permit), { code: 'CONFLICT' })
  assert.equal(f.grants.list(f.exec)[0].state, 'account-changed')
  assert.equal(f.mutations(), 0)
})

test('account observations invalidate grants even when scope resolution or write permissions fail', async () => {
  let changed = false
  const f = fixture({ read(data, query) {
    if (!changed) return
    if (query === GRANT_READS.project) data.viewer.id = 'U_OTHER'
    if (query === WRITE_READS.setProjectItemField) { data.viewer.id = 'U_OTHER'; data.repositoryOwner.projectV2.viewerCanUpdate = false }
  } })
  await grant(f); changed = true
  await assert.rejects(f.grants.prepare(input, f.exec), { code: 'ACCOUNT_CHANGED' })
  assert.equal(f.grants.list(f.exec)[0].state, 'account-changed')
  changed = false; await grant(f); changed = true
  await assert.rejects(f.runtime.prepare('setProjectItemField', args.setProjectItemField, f.exec, { onAccount: actor => f.grants.observe(actor, f.exec) }), { code: 'PERMISSION_DENIED' })
  assert.ok(f.grants.list(f.exec).every(value => value.state === 'account-changed'))
})

test('revocation after executable resolution but before spawn prevents actual mutation and dispatch notification', async () => {
  const f = fixture(); const g = await grant(f); const prepared = await write(f); const permit = f.grants.check(prepared, f.exec)
  let calls = 0; let dispatched = false
  const original = f.subprocess.resolveExecutable
  f.subprocess.resolveExecutable = async (...args) => {
    const value = await original(...args)
    if (++calls === 2) f.grants.revoke(g.id, f.exec)
    return value
  }
  await assert.rejects(f.runtime.execute(prepared, f.exec, { beforeDispatch: () => f.grants.assert(permit, prepared, f.exec), onDispatch: () => { dispatched = true } }), { code: 'GRANT_REQUIRED' })
  assert.equal(f.mutations(), 0); assert.equal(dispatched, false)
})

test('queued writes recheck revocation and disposal at the real predispatch boundary', async t => {
  for (const mode of ['revoke', 'dispose']) await t.test(mode, async () => {
    const f = fixture(); const g = await grant(f)
    const first = await write(f); const second = await write(f)
    const a = f.grants.check(first, f.exec); const b = f.grants.check(second, f.exec)
    let release; let entered
    const gate = new Promise(resolve => { release = resolve }); const ready = new Promise(resolve => { entered = resolve })
    const original = f.subprocess.resolveExecutable; let calls = 0
    f.subprocess.resolveExecutable = async (...args) => { if (++calls === 1) { entered(); await gate } return original(...args) }
    const running = execute(f, first, a); const queued = execute(f, second, b)
    await ready
    if (mode === 'revoke') f.grants.revoke(g.id, f.exec); else f.grants.dispose()
    release()
    const results = await Promise.allSettled([running, queued])
    assert.ok(results.every(result => result.status === 'rejected'))
    assert.equal(f.mutations(), 0)
  })
})

test('per-session grants and history stay bounded and expose history truncation', async () => {
  const f = fixture()
  for (let i = 0; i < 50; i++) await grant(f)
  await assert.rejects(grant(f), { code: 'BOUND_EXCEEDED' })
  assert.equal(f.grants.list(f.exec).length, 50)
  const oldest = f.grants.list(f.exec)[0]
  f.grants.revoke(oldest.id, f.exec)
  await grant(f)
  assert.equal(f.grants.list(f.exec).length, 50)
  assert.ok(!f.grants.list(f.exec).some(value => value.id === oldest.id))
  const prepared = await write(f)
  assert.equal(f.grants.historyTruncated(f.exec), false)
  for (let i = 0; i < 201; i++) f.grants.attempt(prepared, f.exec)
  assert.equal(f.grants.history(f.exec).length, 200)
  assert.equal(f.grants.historyTruncated(f.exec), true)
  assert.equal(f.grants.historyTruncated({ ...f.exec, session: {} }), false)
  assert.equal(f.grants.list(f.exec)[0].scope.projects[0].title, project.title)
})

test('history distinguishes unattempted, failed, confirmed and uncertain without retry', async () => {
  const f = fixture({ mutation: () => ({ stdout: 'lost response' }) }); await grant(f)
  const prepared = await write(f); const permit = f.grants.check(prepared, f.exec)
  const record = f.grants.attempt(prepared, f.exec)
  assert.equal(f.grants.history(f.exec)[0].outcome, 'unattempted')
  const result = await execute(f, prepared, permit)
  assert.equal(result.outcome, 'uncertain'); f.grants.outcome(record, result.outcome)
  f.grants.outcome(record, 'confirmed')
  assert.equal(f.grants.history(f.exec)[0].outcome, 'uncertain', 'uncertainty cannot be silently erased')
  assert.equal(f.mutations(), 1)
  assert.equal(f.grants.list(f.exec)[0].state, 'renewal-required')
  assert.equal(f.grants.check(await write(f), f.exec), null, 'a fresh preparation cannot silently repeat an uncertain write')
  assert.throws(() => f.grants.assert(permit, prepared, f.exec))
  await assert.rejects(execute(f, prepared, permit))
  await grant(f)
  assert.ok(f.grants.check(await write(f), f.exec), 'fresh explicit grant acceptance renews authority')
  for (const state of ['failed', 'confirmed']) { const token = f.grants.attempt(prepared, f.exec); f.grants.outcome(token, state) }
  assert.deepEqual(f.grants.history(f.exec).map(value => value.outcome), ['uncertain', 'failed', 'confirmed'])
  assert.deepEqual(f.grants.history({ ...f.exec, session: {} }), [])
  assert.throws(() => f.grants.outcome({}, 'confirmed'))
})
