import test from 'node:test'
import assert from 'node:assert/strict'
import { GoogleDriveService } from '../src/index.js'
import { createSheetsDescribeTool, createSheetsReadTool, createSheetsProposeTool, createSheetsRequestTool } from '../src/sheets-tools.js'
import { SHEETS_MIME } from '../src/sheets.js'

const sheet = { properties: { title: 'Book' }, sheets: [{ properties: { sheetId: 0, title: 'Tab', gridProperties: { rowCount: 100, columnCount: 20 } } }] }
function fixture(t, { enabled = true, authStatus } = {}) {
  const registrations = new Set()
  const register = value => { registrations.add(value); return () => registrations.delete(value) }
  const ctx = { get: () => ({ register }), effect: fn => fn() }
  const agent = { session: { id: 'root' }, ctx }, child = { session: { id: 'child' } }, calls = [], tokens = [], listeners = new Set()
  const service = new GoogleDriveService({ agents: { get: id => id === 'root' ? agent : id === 'child' ? child : undefined, roots: () => [agent] }, approval: { overrideOf: () => 'ask' }, googleAuth: {
    withAccessToken: (id, fn) => { tokens.push(id); return fn('synthetic-token') }, getAccessGeneration: () => 1,
    onAccessChange: cb => { listeners.add(cb); return () => listeners.delete(cb) },
    status: authStatus ?? (async () => ({ connected: true, integrations: [{ id: 'google-drive', authorized: true }, { id: 'google-sheets-edit', authorized: true }] })),
  }, fetch: async (url, opts) => {
    calls.push({ url, ...opts }); const u = new URL(url)
    if (u.hostname === 'sheets.googleapis.com') return Response.json(sheet)
    const id = u.pathname.split('/').at(-1)
    return Response.json({ id, name: id, mimeType: id === 'folder' ? 'application/vnd.google-apps.folder' : id === 'text' ? 'text/plain' : SHEETS_MIME, parents: [], trashed: false })
  } })
  t.after(() => service.dispose())
  const toggle = enabled => service.browser('session-set', { sessionId: 'root', ...service.browser('session-status', { sessionId: 'root' }), enabled })
  if (enabled) toggle(true)
  let serial = 0
  async function request(edit = false) {
    const callId = `call-${++serial}`, input = { sessionId: 'root', callId }
    const done = service[edit ? 'requestEdit' : 'request'](agent, { callId, reason: 'Synthetic test' })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    const status = service.browser(edit ? 'edit-status' : 'status', input)
    return { done, input: { ...input, requestId: status.requestId } }
  }
  async function grant(edit = false, id = 'book') {
    const r = await request(edit)
    await service.browser(edit ? 'edit-grant' : 'grant', { ...r.input, selected: [{ id, recursive: false }] })
    assert.equal((await r.done).state, 'granted'); return r.input
  }
  return { service, agent, child, calls, tokens, listeners, request, grant, toggle, registrations }
}

test('Sheets tools pass exact caller, call ID and cancellation, rejecting unknown arguments', async () => {
  const calls = [], agent = {}, signal = new AbortController().signal, exec = { agent, callId: 'exact-call', signal }
  const service = Object.fromEntries(['describeSheets', 'readSheet', 'proposeSheetEdit', 'requestEdit'].map(method => [method, (owner, args) => { calls.push({ method, owner, args }); return { state: 'synthetic' } }]))
  const cases = [[createSheetsDescribeTool(service), { fileId: 'book' }], [createSheetsReadTool(service), { fileId: 'book', range: 'Tab!A1' }], [createSheetsProposeTool(service), { fileId: 'book', range: 'Tab!A1', changes: [{ cell: 'A1', value: 2 }] }], [createSheetsRequestTool(service), { reason: 'Edit book' }]]
  for (const [tool, args] of cases) {
    await assert.rejects(tool.execute(args, {}), /calling agent/)
    await assert.rejects(tool.execute({ ...args, accessToken: 'private' }, exec))
    await assert.rejects(tool.execute({}, exec))
    await assert.rejects(tool.execute(Object.create(args), exec))
    await assert.rejects(tool.execute({ ...args, [Symbol('hidden')]: 1 }, exec))
    const accessor = { ...args }; Object.defineProperty(accessor, Object.keys(args)[0], { get() { assert.fail('must not invoke getter') }, enumerable: true })
    await assert.rejects(tool.execute(accessor, exec))
    if ('fileId' in args) for (const fileId of ['', '../secret', 'x'.repeat(201), 4]) await assert.rejects(tool.execute({ ...args, fileId }, exec))
    if ('range' in args) for (const range of ['', 'A1', 'x'.repeat(301), null]) await assert.rejects(tool.execute({ ...args, range }, exec))
    if ('changes' in args) for (const changes of [[], Array(201).fill({}), {}, null]) await assert.rejects(tool.execute({ ...args, changes }, exec))
    const aborted = new AbortController(); aborted.abort(); await assert.rejects(tool.execute(args, { ...exec, signal: aborted.signal }))
    assert.deepEqual(JSON.parse(await tool.execute(args, exec)), { state: 'synthetic' })
    assert.equal(calls.at(-1).owner, agent); assert.equal(calls.at(-1).args.signal, signal)
    assert.equal(tool.parameters.additionalProperties, false)
  }
  assert.equal(calls.length, 4); assert.equal(calls[2].args.callId, exec.callId); assert.equal(calls[3].args.callId, exec.callId)
})
test('assembled service routes read grants to read scope and never authorizes editing', async t => {
  const f = fixture(t); await f.grant()
  assert.equal(f.service.hasAccess(f.agent), true); assert.equal(f.service.hasEditAccess(f.agent), false)
  assert.equal((await f.service.describeSheets(f.agent, { fileId: 'book' })).tabs.length, 1)
  assert.equal((await f.service.readSheet(f.agent, { fileId: 'book', range: 'Tab!A1' })).cells.length, 1)
  assert.throws(() => f.service.proposeSheetEdit(f.agent, { fileId: 'book', range: 'Tab!A1', changes: [{ cell: 'A1', value: 1 }], callId: 'propose' }))
  assert.throws(() => f.service.readSheet(f.child, { fileId: 'book', range: 'Tab!A1' }))
  assert.throws(() => f.service.readSheet({ session: f.agent.session }, { fileId: 'book', range: 'Tab!A1' }))
  assert.ok(f.tokens.every(id => id === 'google-drive')); assert.ok(f.calls.every(call => call.method !== 'POST'))
})
test('assembled edit-only grant permits bounded reads but does not grant arbitrary Drive access', async t => {
  const f = fixture(t); await f.grant(true)
  assert.equal(f.service.hasAccess(f.agent), false); assert.equal(f.service.hasEditAccess(f.agent), true)
  await f.service.readSheet(f.agent, { fileId: 'book', range: 'Tab!A1' })
  assert.ok(f.tokens.every(id => id === 'google-drive'))
  await assert.rejects(f.service.listFiles(f.agent, {})); await assert.rejects(f.service.readText(f.agent, { fileId: 'book' }))
  await assert.rejects(f.service.readSheet(f.agent, { fileId: 'unselected', range: 'Tab!A1' }))
  f.service.release(f.agent); assert.equal(f.service.hasEditAccess(f.agent), false)
  await assert.rejects(async () => f.service.readSheet(f.agent, { fileId: 'book', range: 'Tab!A1' }))
})
for (const id of ['folder', 'text']) test(`assembled edit picker rejects ${id} resources`, async t => {
  const f = fixture(t), r = await f.request(true)
  await assert.rejects(f.service.browser('edit-grant', { ...r.input, selected: [{ id, recursive: false }] }))
  assert.equal(f.service.hasEditAccess(f.agent), false)
  f.service.release(f.agent); await r.done
})
test('opening unrelated read picker preserves pending edit preview; edit revoke cancels it', async t => {
  const f = fixture(t), editInput = await f.grant(true)
  const done = f.service.proposeSheetEdit(f.agent, { fileId: 'book', range: 'Tab!A1', changes: [{ cell: 'A1', value: 2 }], callId: 'preview' })
  const input = { sessionId: 'root', callId: 'preview' }
  // Drain bounded promise continuations, without network or wall-clock polling.
  for (let i = 0; i < 100; i++) { await Promise.resolve(); if (f.service.browser('preview-status', input).state !== 'preparing') break }
  assert.equal(f.service.browser('preview-status', input).state, 'pending')
  const read = await f.request(false)
  assert.equal(f.service.browser('preview-status', input).state, 'pending')
  await f.service.browser('edit-revoke', { sessionId: 'root', callId: editInput.callId })
  assert.equal((await done).state, 'cancelled')
  f.service.release(f.agent); await read.done
  assert.ok(f.calls.every(call => call.method !== 'POST'))
})

for (const edit of [false, true]) test(`OFF during ${edit ? 'edit' : 'read'} auth await prevents a picker even after re-enable`, async t => {
  let resume
  const f = fixture(t, { authStatus: () => new Promise(resolve => { resume = resolve }) })
  const done = f.service[edit ? 'requestEdit' : 'request'](f.agent, { callId: 'waiting', reason: 'Read' })
  f.toggle(false); f.toggle(true)
  resume({ connected: true, integrations: [{ id: 'google-drive', authorized: true }, { id: 'google-sheets-edit', authorized: true }] })
  await assert.rejects(done, /Enable Google Drive/)
  assert.throws(() => f.service.browser(edit ? 'edit-status' : 'status', { sessionId: 'root', callId: 'waiting' }))
  assert.equal(f.calls.length, 0)
})

test('OFF retains inert permission records and cancels a pending preview', async t => {
  const f = fixture(t), access = await f.grant(true)
  const done = f.service.proposeSheetEdit(f.agent, { fileId: 'book', range: 'Tab!A1', changes: [{ cell: 'A1', value: 2 }], callId: 'off-preview' })
  const input = { sessionId: 'root', callId: 'off-preview' }
  for (let i = 0; i < 100; i++) { await Promise.resolve(); if (f.service.browser('preview-status', input).state !== 'preparing') break }
  assert.equal(f.service.browser('preview-status', input).state, 'pending')
  f.toggle(false)
  assert.equal((await done).state, 'cancelled')
  assert.equal(f.service.browser('preview-status', input).state, 'cancelled')
  assert.equal(f.service.browser('edit-status', access).state, 'none')
  assert.equal(f.registrations.size, 0)
  assert.ok(f.calls.every(call => call.method !== 'POST'))
  f.toggle(true)
  assert.equal(f.service.hasEditAccess(f.agent), false)
  await assert.rejects(async () => f.service.browser('edit-grant', { ...access, selected: [{ id: 'book', recursive: false }] }))
})

test('assembled service rejects arbitrary browser dispatch and releases auth listeners', t => {
  const f = fixture(t)
  for (const name of ['apply', 'batchUpdate', 'constructor', '__proto__', 'dispose']) assert.throws(() => f.service.browser(name, {}))
  f.service.dispose(); assert.equal(f.listeners.size, 0); assert.equal(f.calls.length, 0); assert.equal(f.tokens.length, 0)
})
