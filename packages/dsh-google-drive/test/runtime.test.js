import test from 'node:test'
import assert from 'node:assert/strict'
import { DriveAccessRuntime } from '../src/runtime.js'
import { GoogleDriveService } from '../src/index.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const file = id => ({ id, name: id, mimeType: 'text/plain', parents: [], trashed: false })
function fixture(t, mode = 'read') {
  const events = []
  const agent = { session: { id: 'session', append() { assert.fail('Drive must not append custom session events') } } }
  const agentsById = new Map([[agent.session.id, agent]])
  let roots = [agent]
  const agents = { get: id => agentsById.get(id), roots: () => roots }
  let generation = 1
  let policy = 'ask'
  const listeners = new Set()
  const googleAuth = {
    getAccessGeneration: () => generation,
    onAccessChange: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    status: async () => ({ connected: true, integrations: [{ id: 'google-drive', authorized: true }, { id: 'google-sheets-edit', authorized: true }] }),
  }
  const client = {
    getMetadata: async ({ fileId }) => file(fileId),
    pickerList: async () => ({ files: [file('notes')] }),
    readText: async () => ({ text: 'secret', mimeType: 'text/plain' }),
  }
  const runtime = new DriveAccessRuntime({ client, googleAuth, agents, approval: { overrideOf: () => policy }, onChange: () => {}, mode })
  const audit = runtime.audit.bind(runtime)
  runtime.audit = (record, action, resources) => {
    audit(record, action, resources)
    events.push(record.audit.at(-1))
  }
  t.after(() => runtime.dispose())
  let serial = 0
  async function request(signal) {
    const callId = `call-${++serial}`
    const done = runtime.request(agent, { callId, reason: 'Read notes', signal })
    // Connected status and the request continuation are both asynchronous.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    const status = runtime.status({ sessionId: agent.session.id, callId })
    return { input: { sessionId: agent.session.id, callId, requestId: status.requestId }, done }
  }
  return { runtime, agent, agentsById, client, googleAuth, events, request,
    reconnect: () => { generation++; for (const listener of listeners) listener() },
    policy: value => { policy = value },
    roots: value => { roots = value },
  }
}

test('pending requests expire and late browser confirmations remain inert', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { runtime, agent, request } = fixture(t)
  const { input, done } = await request()
  t.mock.timers.tick(10 * 60 * 1000)
  assert.equal((await done).state, 'cancelled')
  assert.equal(runtime.status(input).state, 'cancelled')
  await assert.rejects(runtime.grant({ ...input, selected: [{ id: 'notes', recursive: false }] }), /active/)
  assert.deepEqual(runtime.resources(agent), [])
})

test('runtime pending picker is private; grant audit precedes returned permission result', async t => {
  const { runtime, agent, request, events } = fixture(t)
  const { input, done } = await request()
  assert.deepEqual(runtime.resources(agent), [])
  assert.deepEqual(await runtime.permissions.listFiles(agent), { files: [] })
  assert.equal((await runtime.browse(input)).files[0].id, 'notes')
  await runtime.grant({ ...input, selected: [{ id: 'notes', recursive: false }] })
  assert.equal((await done).state, 'granted')
  assert.equal(events.at(-1).action, 'granted')
  assert.deepEqual(runtime.resources(agent).map(value => value.id), ['notes'])
  await assert.rejects(runtime.grant({ ...input, selected: [{ id: 'notes', recursive: false }] }), /active/)
})

test('transition audit stays bounded in memory and expires with its owner', async t => {
  const { runtime, agent, request } = fixture(t)
  const { input, done } = await request()
  runtime.deny(input)
  await done
  const record = runtime.records.get(runtime.key(agent, input.callId))
  for (let i = 0; i < 30; i++) runtime.audit(record, 'revoked')
  assert.equal(record.audit.length, 20)
  assert.deepEqual(Object.keys(record.audit[0]).sort(), ['action', 'callId'])
  runtime.release(agent)
  assert.equal(runtime.records.size, 0)
  assert.deepEqual(runtime.resources(agent), [])
})

test('runtime rejects copied agent identities, child sessions and replaced root', async t => {
  const { runtime, agent, agentsById, roots, request } = fixture(t)
  const { input, done } = await request()
  await assert.rejects(runtime.request({ session: agent.session }, { callId: 'copy', reason: 'read' }), /exact live/)
  const child = { session: { id: 'child', append() {} } }
  agentsById.set('child', child)
  await assert.rejects(runtime.request(child, { callId: 'child-call', reason: 'read' }), /exact live/)
  const replacement = { session: agent.session }
  agentsById.set(agent.session.id, replacement)
  roots([replacement])
  await assert.rejects(runtime.browse(input), /active/)
  runtime.release(agent)
  assert.equal((await done).state, 'cancelled')
  assert.deepEqual(runtime.resources(replacement), [])
})

test('runtime reconnect cancels pending UI and revokes prior grants', async t => {
  const { runtime, agent, request, reconnect } = fixture(t)
  const first = await request()
  await runtime.grant({ ...first.input, selected: [{ id: 'notes', recursive: false }] })
  await first.done
  const second = await request()
  reconnect()
  assert.equal((await second.done).state, 'cancelled')
  assert.deepEqual(runtime.resources(agent), [])
  await assert.rejects(runtime.grant({ ...second.input, selected: [{ id: 'notes', recursive: false }] }), /active/)
  await assert.rejects(runtime.permissions.readText(agent, { fileId: 'notes' }), /permission/)
})

test('runtime cancellation and policy changes block in-flight approval', async t => {
  for (const mode of ['abort', 'policy', 'reconnect']) {
    const { runtime, agent, request, client, policy, reconnect } = fixture(t)
    const controller = new AbortController()
    const { input, done } = await request(controller.signal)
    const entered = deferred()
    const gate = deferred()
    client.getMetadata = () => { entered.resolve(); return gate.promise }
    const granting = runtime.grant({ ...input, selected: [{ id: 'notes', recursive: false }] })
    const rejected = assert.rejects(granting)
    await entered.promise
    if (mode === 'abort') controller.abort()
    if (mode === 'policy') policy('deny')
    if (mode === 'reconnect') reconnect()
    gate.resolve(file('notes'))
    await rejected
    assert.deepEqual(runtime.resources(agent), [])
    // A policy failure must eventually settle the originating tool too.
    runtime.release(agent)
    assert.equal((await done).state, 'cancelled')
  }
})

test('duplicate grant does not cancel or release the original commit gate', async t => {
  const { runtime, agent, request, client } = fixture(t)
  const { input, done } = await request()
  const entered = deferred()
  const gate = deferred()
  client.getMetadata = () => { entered.resolve(); return gate.promise }
  const selected = [{ id: 'notes', recursive: false }]
  const original = runtime.grant({ ...input, selected })
  await entered.promise
  await assert.rejects(runtime.grant({ ...input, selected }))
  assert.equal(runtime.committing.has(agent), true)
  assert.equal(runtime.status(input).state, 'pending')
  gate.resolve(file('notes'))
  await original
  assert.equal((await done).state, 'granted')
  assert.equal(runtime.committing.has(agent), false)
})

test('reconnect during status rejects stale request rather than creating a picker', async t => {
  const { runtime, agent, googleAuth, reconnect } = fixture(t)
  const entered = deferred()
  const gate = deferred()
  googleAuth.status = () => { entered.resolve(); return gate.promise }
  const requesting = runtime.request(agent, { callId: 'stale', reason: 'read' })
  const rejected = assert.rejects(requesting)
  await entered.promise
  reconnect()
  gate.resolve({ connected: true, integrations: [{ id: 'google-drive', authorized: true }] })
  await rejected
  assert.equal(runtime.records.size, 0)
})

test('runtime grant audit failure cancels result and removes access', async t => {
  const { runtime, agent, request } = fixture(t)
  const { input, done } = await request()
  const audit = runtime.audit.bind(runtime)
  runtime.audit = (record, action, resources) => {
    if (action === 'granted') throw new Error('audit unavailable')
    audit(record, action, resources)
  }
  await runtime.grant({ ...input, selected: [{ id: 'notes', recursive: false }] })
  assert.equal((await done).state, 'cancelled')
  assert.deepEqual(runtime.resources(agent), [])
})

test('runtime revoke cancels ignored-abort reads and managed pending requests', async t => {
  const { runtime, agent, request, client } = fixture(t)
  const { input, done } = await request()
  await runtime.grant({ ...input, selected: [{ id: 'notes', recursive: false }] })
  await done
  const entered = deferred()
  const gate = deferred()
  client.readText = () => { entered.resolve(); return gate.promise }
  const reading = runtime.permissions.readText(agent, { fileId: 'notes' })
  const rejected = assert.rejects(reading, /permission/)
  await entered.promise
  const managed = await runtime.manage(input)
  assert.equal(managed.state, 'pending')
  runtime.revoke(input)
  await rejected
  gate.resolve({ text: 'late private' })
  assert.deepEqual(runtime.resources(agent), [])
  assert.equal(runtime.status(input).state, 'cancelled')
})

test('public service gates reads and observer exposure until grant transition commits', async t => {
  let service
  const blocked = []
  const scoped = { tools: { register: () => () => {} }, skills: { register: () => () => {} } }
  const agent = { session: { id: 'service-session', append() { assert.fail('Drive must not append custom session events') } },
    ctx: { get: name => scoped[name], effect: fn => fn() } }
  const googleAuth = {
    withAccessToken: async (_id, operation) => operation('synthetic-token', new AbortController().signal),
    getAccessGeneration: () => 1,
    onAccessChange: () => () => {},
    status: async () => ({ connected: true, integrations: [{ id: 'google-drive', authorized: true }, { id: 'google-sheets-edit', authorized: true }] }),
  }
  const entered = deferred()
  const gate = deferred()
  let first = true
  service = new GoogleDriveService({ googleAuth, agents: { get: id => id === agent.session.id ? agent : undefined, roots: () => [agent] }, approval: { overrideOf: () => 'ask' },
    fetch: async url => {
      if (first) { first = false; entered.resolve(); await gate.promise }
      return new URL(url).searchParams.get('alt') === 'media' ? new Response('safe text') : Response.json(file('notes'))
    },
  })
  t.after(() => { observing = false; service.dispose() })
  const sessionStatus = service.browser('session-status', { sessionId: agent.session.id })
  service.browser('session-set', { sessionId: agent.session.id, ownerId: sessionStatus.ownerId, revision: sessionStatus.revision, enabled: true })
  let observing = false
  service.observe(agent, () => {
    if (!observing) return
    const status = service.browser('status', { sessionId: agent.session.id, callId: 'call' })
    if (service.hasAccess(agent)) assert.equal(status.state, 'granted')
    else if (status.grants.length) blocked.push(assert.rejects(service.readText(agent, { fileId: 'notes' }), /committed/))
  })
  const done = service.request(agent, { callId: 'call', reason: 'Read notes' })
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  const input = { sessionId: agent.session.id, callId: 'call', requestId: service.browser('status', { sessionId: agent.session.id, callId: 'call' }).requestId }
  observing = true
  const granted = service.browser('grant', { ...input, selected: [{ id: 'notes', recursive: false }] })
  await entered.promise
  await assert.rejects(service.listFiles(agent, {}), /committed/)
  await assert.rejects(service.readText(agent, { fileId: 'notes' }), /committed/)
  gate.resolve()
  await granted
  assert.equal((await done).state, 'granted')
  await Promise.all(blocked)
  assert.equal(service.hasAccess(agent), true)
  assert.equal((await service.readText(agent, { fileId: 'notes' })).text, 'safe text')
  service.browser('revoke', input)
  assert.equal(service.hasAccess(agent), false)
  await assert.rejects(service.readText(agent, { fileId: 'notes' }), /committed/)
})

for (const mode of ['read', 'edit']) {
  test(`${mode} request and manage reject a toolbar epoch changed during auth lookup`, async t => {
    const f = fixture(t, mode)
    let revision = 1
    f.runtime.enableRevision = () => revision
    const { input, done } = await f.request()
    f.runtime.deny(input); await done
    const status = await f.googleAuth.status()
    const gate = deferred(), entered = deferred()
    f.googleAuth.status = async () => { entered.resolve(); return gate.promise }
    const request = f.runtime.request(f.agent, { callId: 'waiting', reason: 'Read notes' })
    const rejected = assert.rejects(request, /toolbar/)
    const manage = f.runtime.manage(input)
    const manageRejected = assert.rejects(manage, /toolbar/)
    await entered.promise
    revision += 2 // OFF then ON, even if no request record existed at OFF.
    f.runtime.revokeOwner(f.agent)
    gate.resolve(status)
    await rejected; await manageRejected
    assert.equal(f.runtime.records.has('session:waiting'), false)
    assert.equal(f.runtime.status(input).state, 'denied')
  })

  test(`${mode} old access cards cannot mutate a later toolbar epoch`, async t => {
    const f = fixture(t, mode)
    let revision = 1
    f.runtime.enableRevision = () => revision
    const { input, done } = await f.request()
    revision++
    f.runtime.revokeOwner(f.agent)
    assert.equal((await done).state, 'cancelled')
    revision++
    assert.equal(f.runtime.status(input).state, 'cancelled', 'history remains readable')
    await assert.rejects(f.runtime.manage(input), /toolbar/)
    await assert.rejects(f.runtime.grant({ ...input, selected: [{ id: 'notes', recursive: false }] }), /toolbar/)
    assert.throws(() => f.runtime.deny(input), /toolbar/)
    assert.throws(() => f.runtime.revoke(input), /active/)
  })
}

test('an old access card never displays a later toolbar epoch grant', async t => {
  const f = fixture(t)
  let revision = 1
  f.runtime.enableRevision = () => revision
  const old = await f.request()
  await f.runtime.grant({ ...old.input, selected: [{ id: 'old-notes', recursive: false }] })
  await old.done
  revision++; f.runtime.revokeOwner(f.agent); revision++
  const current = await f.request()
  await f.runtime.grant({ ...current.input, selected: [{ id: 'new-notes', recursive: false }] })
  await current.done
  assert.equal(f.runtime.status(old.input).state, 'none')
  assert.deepEqual(f.runtime.status(old.input).grants, [])
  assert.equal(f.runtime.status(current.input).grants[0].id, 'new-notes')
})

test('runtime request rejects disabled prompting and unauthenticated Drive', async t => {
  const { runtime, agent, policy, googleAuth } = fixture(t)
  policy('allow')
  await assert.rejects(runtime.request(agent, { callId: 'a', reason: 'read' }), /disabled/)
  policy('deny')
  await assert.rejects(runtime.request(agent, { callId: 'b', reason: 'read' }), /disabled/)
  policy('ask')
  googleAuth.status = async () => ({ connected: true, integrations: [{ id: 'google-drive', authorized: false }] })
  await assert.rejects(runtime.request(agent, { callId: 'c', reason: 'read' }), /Connect/)
})
