import assert from 'node:assert/strict'
import test from 'node:test'
import { LinearProjectWrites } from '../src/project-writes.js'
import { registerProjectWriteTools } from '../src/tools/project-writes.js'

function page(nodes) {
  return { nodes, pageInfo: { hasNextPage: false, hasPreviousPage: false } }
}

const organization = { id: 'org-id', name: 'Acme', urlKey: 'acme' }
const team = { id: 'team-id', key: 'ENG', name: 'Engineering', private: false }
const lead = {
  id: 'user-id', name: 'Ada Lovelace', displayName: 'Ada', email: 'ada@example.com',
  active: true, isMe: true, url: 'https://linear.app/acme/member/ada',
}
const planned = { id: 'planned-id', name: 'Planned', type: 'planned' }
const completed = { id: 'completed-id', name: 'Completed', type: 'completed' }

function project(overrides = {}) {
  const value = {
    id: 'project-id', slugId: 'platform', name: 'Platform', description: 'Short summary',
    content: 'Project content', url: 'https://linear.app/acme/project/platform',
    priority: 2, priorityLabel: 'High', progress: 0.5, state: 'planned',
    leadId: 'user-id', statusId: 'planned-id', startDate: '2026-04-01', targetDate: '2026-06-30',
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-03-20T15:00:00Z'),
    get lead() { return Promise.resolve(lead) },
    get status() { return Promise.resolve(planned) },
    async teams() { return page([team]) },
    ...overrides,
  }
  return value
}

function runtime(client) {
  return {
    maxDescriptionChars: 12_000,
    async client() { return { client, organization, config: {} } },
    async request(_operation, task) { return task() },
  }
}

function selectors(overrides = {}) {
  return {
    organization: Promise.resolve(organization),
    viewer: Promise.resolve(lead),
    async teams() { return page([team]) },
    async users() { return page([lead]) },
    async projectStatuses() { return page([planned, completed]) },
    ...overrides,
  }
}

test('project creation preparation resolves selectors and warns about duplicates', async () => {
  const duplicate = project({ id: 'duplicate-id', name: 'Platform', archivedAt: null })
  const client = selectors({ async projects() { return page([duplicate]) } })
  const writes = new LinearProjectWrites(runtime(client))
  const prepared = await writes.prepareCreate({
    name: ' Platform ', teams: ['ENG'], description: 'Summary', content: 'Details',
    status: 'Planned', lead: 'me', priority: 2, startDate: '2026-04-01', targetDate: '2026-06-30',
  })
  assert.equal(Object.isFrozen(prepared), true)
  assert.deepEqual(prepared.input, {
    name: 'Platform', teamIds: ['team-id'], description: 'Summary', content: 'Details',
    statusId: 'planned-id', leadId: 'user-id', priority: 2,
    startDate: '2026-04-01', targetDate: '2026-06-30',
  })
  assert.deepEqual(prepared.approvedDuplicateIds, ['duplicate-id'])
  assert.match(prepared.reason, /Possible duplicate projects/)
  assert.match(prepared.reason, /ENG — Engineering/)
})

test('project creation rejects an inverted date range before approval', async () => {
  const client = selectors({ async projects() { return page([]) } })
  const writes = new LinearProjectWrites(runtime(client))
  await assert.rejects(writes.prepareCreate({
    name: 'New Platform', teams: ['ENG'], startDate: '2026-07-01', targetDate: '2026-06-01',
  }), /startDate must not be after targetDate/)
})

test('project creation rechecks duplicates and returns the created project', async () => {
  let createInput
  const created = project({ id: 'created-id', name: 'New Platform' })
  const client = selectors({
    async projects() { return page([]) },
    async createProject(input) { createInput = input; return { success: true, projectId: 'created-id' } },
    async project(id) { assert.equal(id, 'created-id'); return created },
  })
  const writes = new LinearProjectWrites(runtime(client))
  const prepared = await writes.prepareCreate({ name: 'New Platform', teams: ['ENG'] })
  const result = await writes.executeCreate(prepared)
  assert.deepEqual(createInput, { name: 'New Platform', teamIds: ['team-id'] })
  assert.equal(result.id, 'created-id')
  assert.equal(result.teams[0].key, 'ENG')
})

test('project creation fails if a new duplicate appears after approval', async () => {
  let reads = 0
  let created = false
  const client = selectors({
    async projects() {
      reads += 1
      return page(reads === 1 ? [] : [project({ id: 'late-id', name: 'New Platform' })])
    },
    async createProject() { created = true; return { success: true, projectId: 'created-id' } },
  })
  const writes = new LinearProjectWrites(runtime(client))
  const prepared = await writes.prepareCreate({ name: 'New Platform', teams: ['ENG'] })
  await assert.rejects(writes.executeCreate(prepared), /appeared after approval/)
  assert.equal(created, false)
})

test('project update preparation builds a concrete diff and immutable patch', async () => {
  const existing = project()
  const client = selectors({ async projects() { return page([existing]) } })
  const writes = new LinearProjectWrites(runtime(client))
  const prepared = await writes.prepareUpdate({
    project: 'Platform', expectedUpdatedAt: '2026-03-20T15:00:00Z',
    status: 'Completed', targetDate: '2026-07-15', clearFields: ['lead'],
  })
  assert.deepEqual(prepared.input, {
    statusId: 'completed-id', targetDate: '2026-07-15', leadId: null,
  })
  assert.match(prepared.reason, /Status: Planned → Completed/)
  assert.match(prepared.reason, /Lead: Ada Lovelace → cleared/)
  assert.match(prepared.reason, /moves the project to completed/)
  assert.equal(Object.isFrozen(prepared.input), true)
})

test('project update executes only when updatedAt remains unchanged', async () => {
  let updateInput
  let projectReads = 0
  const current = project({
    async update(input) { updateInput = input; return { success: true, projectId: 'project-id' } },
  })
  const updated = project({ priority: 1, priorityLabel: 'Urgent', updatedAt: new Date('2026-03-20T15:01:00Z') })
  const client = selectors({
    async projects() { return page([current]) },
    async project() { projectReads += 1; return projectReads === 1 ? current : updated },
  })
  const writes = new LinearProjectWrites(runtime(client))
  const prepared = await writes.prepareUpdate({ project: 'Platform', priority: 1 })
  const result = await writes.executeUpdate(prepared)
  assert.deepEqual(updateInput, { priority: 1 })
  assert.equal(result.priority, 1)
})

test('project rename rejects a duplicate that appears after approval', async () => {
  let duplicateChecks = 0
  let mutated = false
  const existing = project({
    async update() { mutated = true; return { success: true, projectId: 'project-id' } },
  })
  const client = selectors({
    async projects(variables) {
      if (variables.filter?.or !== undefined) return page([existing])
      duplicateChecks += 1
      return page(duplicateChecks === 1 ? [] : [project({ id: 'late-id', name: 'Renamed' })])
    },
    async project() { return existing },
  })
  const writes = new LinearProjectWrites(runtime(client))
  const prepared = await writes.prepareUpdate({ project: 'Platform', name: 'Renamed' })
  await assert.rejects(writes.executeUpdate(prepared), /appeared after approval/)
  assert.equal(mutated, false)
})

test('project update rejects stale approval before mutation', async () => {
  let mutated = false
  const existing = project()
  const changed = project({
    updatedAt: new Date('2026-03-20T16:00:00Z'),
    async update() { mutated = true; return { success: true, projectId: 'project-id' } },
  })
  const client = selectors({
    async projects() { return page([existing]) },
    async project() { return changed },
  })
  const writes = new LinearProjectWrites(runtime(client))
  const prepared = await writes.prepareUpdate({ project: 'Platform', priority: 1 })
  await assert.rejects(writes.executeUpdate(prepared), /changed while approval was pending/)
  assert.equal(mutated, false)
})

test('project status report is concurrency-checked and returns its author', async () => {
  const existing = project()
  const update = {
    id: 'update-id', projectId: 'project-id', userId: 'user-id', body: 'Migration is on schedule.',
    health: 'onTrack', url: 'https://linear.app/acme/project/platform/updates/update-id',
    createdAt: new Date('2026-03-21T00:00:00Z'), updatedAt: new Date('2026-03-21T00:00:00Z'),
    get user() { return Promise.resolve(lead) },
  }
  let updateInput
  const client = selectors({
    async projects() { return page([existing]) },
    async project() { return existing },
    async createProjectUpdate(input) { updateInput = input; return { success: true, projectUpdateId: 'update-id' } },
    async projectUpdate() { return update },
  })
  const writes = new LinearProjectWrites(runtime(client))
  const prepared = await writes.prepareProjectUpdate({
    project: 'Platform', health: 'onTrack', body: 'Migration is on schedule.',
  })
  assert.match(prepared.reason, /Health: onTrack/)
  const result = await writes.executeProjectUpdate(prepared)
  assert.deepEqual(updateInput, {
    projectId: 'project-id', health: 'onTrack', body: 'Migration is on schedule.',
  })
  assert.equal(result.author.name, 'Ada Lovelace')
})

test('write tools ask once with prepared preview and cannot execute after rejection', async () => {
  const definitions = []
  const events = {}
  let executions = 0
  const writes = {
    async prepareCreate() {
      return Object.freeze({ kind: 'create-project', reason: 'Resolved create preview', input: Object.freeze({}) })
    },
    async executeCreate(prepared) { executions += 1; return { prepared } },
  }
  const ctx = {
    tools: { register(definition) { definitions.push(definition); return () => {} } },
    on(name, listener) { events[name] = listener; return () => {} },
  }
  registerProjectWriteTools(ctx, writes, { timeoutMs: 30_000 })
  const create = definitions.find((definition) => definition.name === 'linear_create_project')
  const token = Symbol('call')
  const exec = {
    name: 'linear_create_project', arguments: { name: 'Platform', teams: ['ENG'] },
    token, callId: 'call-1', rootCallId: 'call-1', signal: new AbortController().signal,
  }
  const decision = await events['tools/pre-execute'](exec, async () => ({ kind: 'allow' }))
  assert.deepEqual(decision, { kind: 'ask', reason: 'Resolved create preview' })

  events['tools/result'](exec)
  await assert.rejects(create.execute(exec.arguments, exec), /approval was not prepared/)
  assert.equal(executions, 0)
})

test('an approved write consumes its exact prepared action once', async () => {
  const definitions = []
  const events = {}
  const received = []
  const writes = {
    async prepareCreate(args) {
      return Object.freeze({ kind: 'create-project', reason: `Create ${args.name}`, input: Object.freeze({ name: args.name }) })
    },
    async executeCreate(prepared) { received.push(prepared); return project() },
  }
  const ctx = {
    tools: { register(definition) { definitions.push(definition); return () => {} } },
    on(name, listener) { events[name] = listener; return () => {} },
  }
  registerProjectWriteTools(ctx, writes, { timeoutMs: 30_000 })
  const create = definitions.find((definition) => definition.name === 'linear_create_project')
  const token = Symbol('call')
  const exec = {
    name: 'linear_create_project', arguments: { name: 'Platform', teams: ['ENG'] },
    token, callId: 'call-2', rootCallId: 'call-2', signal: new AbortController().signal,
  }
  await events['tools/pre-execute'](exec, async () => ({ kind: 'allow' }))
  await create.execute({ name: 'Tampered', teams: ['OTHER'] }, exec)
  assert.equal(received[0].input.name, 'Platform')
  await assert.rejects(create.execute(exec.arguments, exec), /approval was not prepared/)
})
