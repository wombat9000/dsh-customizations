import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DriveAccessRuntime } from '../src/runtime.js'

// Real pinned Session and compressed JSONL persistence; dormant Cordis only.
// All logs are newly generated fixtures. No GUI, provider, credentials, or private history.
const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = name => import(pathToFileURL(cli.resolve(name)).href)
const { Context } = await installed('@deepseek-ai/cordis')
const { default: SessionStore, Session } = await installed('@deepseek-ai/dsh-session')
const { default: JsonlPersistence } = await installed('@deepseek-ai/dsh-session-persistence-jsonl')
const time = Date.UTC(2026, 0, 2, 3, 4, 5)
const user = { id: 'synthetic-user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Read the selected synthetic notes.' }] }
const assistant = { id: 'synthetic-assistant', role: 'assistant', source: { kind: 'model', provider: 'synthetic', model: 'fixture' }, content: [{ type: 'text', text: 'The synthetic access interaction is complete.' }] }

async function store(t, root) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore).await()
  await ctx.plugin(JsonlPersistence, { root, compression: 'zstd', packChunks: false }).await()
  return { ctx, sessions: ctx.get('sessions'), persistence: ctx.get('sessionPersistence') }
}
async function fixture(t, id) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-drive-history-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const writer = await store(t, root)
  const session = writer.sessions.create(id, { meta: { cwd: root, createdAt: time } })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', user, { surfaceOp: 'append' })
  return { root, writer, session }
}
function finish(session) {
  session.append('assistant/message', { message: assistant }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}
async function persisted(writer, session) {
  assert.equal(await writer.sessions.flush(session), true)
  const path = writer.persistence.locate(session.header).path
  assert.match(path, /session\.jsonl\.zstd$/u)
  const bytes = await readFile(path)
  assert.equal(bytes.readUInt32LE(0), 0xfd2fb528)
  // The backend writes concatenated Zstandard frames; use its actual raw-storage
  // reader rather than a one-frame decompressor or a second JSONL implementation.
  const stored = await writer.persistence.loadStored(session.id)
  return { path, bytes, records: stored.events }
}
function runtimeFor(t, session) {
  const agent = { session }
  const runtime = new DriveAccessRuntime({
    client: {
      getMetadata: async ({ fileId }) => ({ id: fileId, name: fileId, mimeType: 'text/plain', parents: [], trashed: false }),
      pickerList: async () => ({ files: [] }),
    },
    googleAuth: {
      getAccessGeneration: () => 1,
      onAccessChange: () => () => {},
      status: async () => ({ connected: true, integrations: [{ id: 'google-drive', authorized: true }] }),
    },
    agents: { get: id => id === session.id ? agent : undefined, roots: () => [agent] },
    approval: { overrideOf: () => 'ask' },
    onChange: () => {},
  })
  t.after(() => runtime.dispose())
  async function request(callId) {
    const done = runtime.request(agent, { callId, reason: 'Read synthetic notes' })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    const identity = { sessionId: session.id, callId }
    return { done, input: { ...identity, requestId: runtime.status(identity).requestId } }
  }
  return { agent, runtime, request }
}

test('legacy unmarked Drive audit append survives flush but real compressed history reopen refuses it', async t => {
  const { root, writer, session } = await fixture(t, 'synthetic-legacy-drive-history')
  const audit = { action: 'granted', callId: 'synthetic-call', resources: [{ id: 'synthetic-notes', recursive: false }] }
  session.append('google-drive/access', audit)
  finish(session)
  const artifact = await persisted(writer, session)
  const auditRecord = artifact.records.find(record => record.type === 'google-drive/access')
  assert.equal(auditRecord.seq, 2)
  assert.deepEqual(auditRecord.data, audit)
  assert.equal(Object.hasOwn(auditRecord, 'ignorable'), false)
  await writer.ctx.fiber.dispose()
  const reader = await store(t, root)
  await assert.rejects(reader.persistence.load(session.id), error => {
    assert.ok(error.message.includes(`session "${session.id}" contains event type "google-drive/access" (seq 2) unknown to this harness and not marked ignorable; refusing to interpret the log`))
    assert.ok(error.message.includes(artifact.path))
    return true
  })
  // Failure is non-destructive: this test does not repair or rewrite an existing log.
  assert.deepEqual(await readFile(artifact.path), artifact.bytes)
})

test('real Drive request, denial, grant, management and revocation reopen without custom persisted events or restored grants', async t => {
  const { root, writer, session } = await fixture(t, 'synthetic-current-drive-history')
  const { runtime, agent, request } = runtimeFor(t, session)
  const denied = await request('deny-call')
  runtime.deny(denied.input)
  assert.equal((await denied.done).state, 'denied')
  const granted = await request('grant-call')
  await runtime.grant({ ...granted.input, selected: [{ id: 'notes', recursive: false }] })
  assert.equal((await granted.done).state, 'granted')
  assert.deepEqual(runtime.resources(agent).map(resource => resource.id), ['notes'])
  const managed = await runtime.manage(granted.input)
  await runtime.grant({ ...granted.input, requestId: managed.requestId, selected: [{ id: 'other-notes', recursive: false }] })
  assert.deepEqual(runtime.resources(agent).map(resource => resource.id), ['other-notes'])
  runtime.revoke(granted.input)
  assert.deepEqual(runtime.resources(agent), [])
  // Leave one real grant active before closing. Reopening must not reconstruct it.
  const active = await request('active-before-close')
  await runtime.grant({ ...active.input, selected: [{ id: 'final-notes', recursive: false }] })
  assert.equal((await active.done).state, 'granted')
  assert.deepEqual(runtime.resources(agent).map(resource => resource.id), ['final-notes'])
  finish(session)
  const artifact = await persisted(writer, session)
  assert.equal(artifact.records.some(record => record.type === 'google-drive/access'), false)
  const expectedEvents = artifact.records.filter(record => typeof record.seq === 'number')
  assert.deepEqual(expectedEvents.map(event => event.type), ['turn/start', 'user/message', 'assistant/message', 'turn/end'])
  assert.deepEqual(expectedEvents.map(event => event.seq), [0, 1, 2, 3])
  runtime.dispose()
  await writer.ctx.fiber.dispose()
  const reader = await store(t, root)
  const loaded = await reader.persistence.load(session.id)
  assert.deepEqual(loaded.meta, { version: 0, id: session.id, createdAt: time, cwd: root, isSeeded: false, delegationDepth: 0 })
  assert.deepEqual(loaded.events, expectedEvents)
  const reopened = Session.create(loaded.meta.id, loaded.events, loaded.meta)
  assert.deepEqual(reopened.deriveMessages(), [user, assistant])
  const fresh = runtimeFor(t, reopened)
  assert.deepEqual(fresh.runtime.resources(fresh.agent), [])
  assert.throws(() => fresh.runtime.status({ sessionId: session.id, callId: 'active-before-close' }), /active|expired/u)
  assert.deepEqual(await readFile(artifact.path), artifact.bytes)
})
