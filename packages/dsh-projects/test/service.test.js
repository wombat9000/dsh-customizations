import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, config, github, linear, uuid, deferred } from './fixtures.js'

const request = (sourceId = 'repo', extra = {}) => ({ projectId: 'app', sourceId, ...extra })
test('all four source kinds dispatch explicit configured selectors to the same read facades only', async () => {
  const calls = []
  const capture = (method, result) => async (args, options) => {
    calls.push({ method, args, options })
    return result
  }
  const { service, state } = fixture({
    github: {
      listIssues: capture('github.listIssues', github()),
      listProjectItems: capture('github.listProjectItems', github()),
    },
    linear: { listIssues: capture('linear.listIssues', linear()) },
  })
  assert.deepEqual(service.catalog().providers, { github: true, linear: true })
  assert.equal(calls.length, 0)
  for (const source of ['repo', 'board', 'linear-project', 'linear-team'])
    await service.issues(request(source, { limit: 12, cursor: 'next' }))
  assert.deepEqual(
    calls.map(({ method, args }) => ({ method, args })),
    [
      {
        method: 'github.listIssues',
        args: { owner: 'acme', repo: 'app', state: 'all', limit: 12, cursor: 'next' },
      },
      {
        method: 'github.listProjectItems',
        args: { owner: 'acme', projectNumber: 7, limit: 12, cursor: 'next' },
      },
      { method: 'linear.listIssues', args: { project: uuid, limit: 12, cursor: 'next' } },
      { method: 'linear.listIssues', args: { team: uuid, limit: 12, cursor: 'next' } },
    ],
  )
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.options), ['signal'])
    assert.ok(call.options.signal instanceof AbortSignal)
  }
  state.providers = {}
  assert.deepEqual(service.catalog().providers, { github: false, linear: false })
  await assert.rejects(service.issues(request()), { code: 'unavailable' })
  assert.equal(state.saves.length, 0)
})

test('unknown request fields, endpoints-as-parameters, missing sources and invalid page bounds do not dispatch', async () => {
  let calls = 0
  const { service } = fixture({
    github: {
      listIssues: async () => {
        calls++
        return github()
      },
    },
  })
  for (const extra of [
    { owner: 'other' },
    { query: 'mutation {}' },
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { cursor: '' },
    { cursor: 'x'.repeat(4097) },
  ])
    await assert.rejects(service.issues(request('repo', extra)), { code: 'invalid' })
  await assert.rejects(service.issues({ projectId: 'unknown', sourceId: 'repo' }), {
    code: 'missing',
  })
  await assert.rejects(service.issues(request('unknown')), { code: 'missing' })
  assert.throws(() => service.catalog({ sessionId: 'anything' }), { code: 'invalid' })
  assert.throws(() => service.project({ projectId: 'app', sourceId: 'repo' }), { code: 'invalid' })
  assert.throws(() => service.project({ projectId: 'unknown' }), { code: 'missing' })
  assert.equal(calls, 0)
})

test('provider exceptions never expose diagnostic text or attached data', async () => {
  const { service } = fixture({
    github: {
      listIssues: async () => {
        throw Object.assign(new Error('secret ghp_private'), { data: 'Bearer private' })
      },
    },
  })
  await assert.rejects(
    service.issues(request()),
    (error) =>
      error.code === 'failed' && !/private|Bearer/.test(JSON.stringify(error) + error.message),
  )
})

test('configuration saves serialize and stale concurrent editors conflict without overwriting', async () => {
  const { service, state } = fixture()
  const expectedRevision = service.catalog().revision
  const first = config()
  first.projects[0].name = 'First'
  const second = config()
  second.projects[0].name = 'Second'
  const one = service.configure({ configuration: first, expectedRevision })
  const two = service.configure({ configuration: second, expectedRevision })
  assert.equal((await one).projects[0].name, 'First')
  await assert.rejects(two, { code: 'conflict' })
  assert.equal(state.saves.length, 1)
  assert.equal(service.catalog().projects[0].name, 'First')
})

test('failed settings saves are sanitized and do not poison subsequent saves', async () => {
  const { service, state } = fixture()
  const expectedRevision = service.catalog().revision
  state.beforeSave = () => {
    throw new Error('credential private')
  }
  await assert.rejects(
    service.configure({ configuration: config(), expectedRevision }),
    (error) => error.code === 'settings' && !error.message.includes('private'),
  )
  state.beforeSave = undefined
  assert.equal(
    (await service.configure({ configuration: config(), expectedRevision })).projects[0].id,
    'app',
  )
})

test('configuration changes during a read reject stale results and cancellation reaches providers', async () => {
  const gate = deferred()
  let received
  const { service, state } = fixture({
    github: {
      listIssues: (_, options) => {
        received = options.signal
        return gate.promise
      },
    },
  })
  const pending = service.issues(request())
  const next = config()
  next.projects[0].name = 'Changed'
  state.json = JSON.stringify(next)
  gate.resolve(github())
  await assert.rejects(pending, { code: 'conflict' })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(service.issues(request(), controller.signal), { code: 'cancelled' })
  assert.equal(received.aborted, false)
})

test('disposal cancels active reads, rejects queued writes and prevents subsequent access', async () => {
  const gate = deferred()
  let received
  const { service, state } = fixture({
    github: {
      listIssues: (_, options) => {
        received = options.signal
        return gate.promise
      },
    },
  })
  const pending = service.issues(request())
  const write = service.configure({
    configuration: config(),
    expectedRevision: service.catalog().revision,
  })
  service.dispose()
  assert.equal(received.aborted, true)
  gate.resolve(github())
  await assert.rejects(pending, { code: 'cancelled' })
  await assert.rejects(write, { code: 'stopped' })
  assert.equal(state.saves.length, 0)
  assert.throws(() => service.catalog(), { code: 'stopped' })
  await assert.rejects(service.issues(request()), { code: 'stopped' })
})

test('eight active reads are bounded and slots are released after failures', async () => {
  const gate = deferred()
  const { service } = fixture({ github: { listIssues: () => gate.promise } })
  const reads = Array.from({ length: 8 }, () => service.issues(request()))
  await assert.rejects(service.issues(request()), { code: 'failed' })
  gate.resolve(github())
  await Promise.all(reads)
  assert.equal((await service.issues(request())).issues.length, 0)
})
