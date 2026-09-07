import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { EventEmitter, once } from 'node:events'
import test from 'node:test'
import { createHandler } from '../src/routes.js'
import { GoogleDriveService } from '../src/index.js'
import { SHEETS_MIME } from '../src/sheets.js'

const actions = ['edit-status', 'edit-manage', 'edit-revoke', 'edit-browse', 'edit-grant', 'edit-deny', 'preview-status', 'preview-apply', 'preview-deny']
async function fixture(t) {
  const events = new EventEmitter(), audit = [], calls = []
  const tools = new Map(), skills = new Map()
  const registry = values => ({ register(value) {
    if (values.has(value.name)) throw new Error('Duplicate fixture registration')
    values.set(value.name, value); return () => values.delete(value.name)
  } })
  const registries = { tools: registry(tools), skills: registry(skills) }
  const agent = { session: { id: 'root', append: (...args) => audit.push(args) }, ctx: {
    get: key => registries[key], effect(factory) {
      let cleanup = factory()
      return () => { const fn = cleanup; cleanup = undefined; fn?.() }
    },
  } }
  let entered = { stringValue: 'before' }, stallWrite = false, stallRead = false, port
  const service = new GoogleDriveService({
    agents: { get: id => id === 'root' ? agent : undefined, roots: () => [agent] }, approval: { overrideOf: () => 'ask' },
    googleAuth: { getAccessGeneration: () => 1, onAccessChange: () => () => {},
      status: async () => ({ connected: true, integrations: [{ id: 'google-drive', authorized: true }, { id: 'google-sheets-edit', authorized: true }] }),
      withAccessToken: (_id, fn) => fn('PRIVATE_TOKEN'),
    },
    fetch: async (url, opts) => {
      calls.push({ url, ...opts })
      const u = new URL(url)
      const waitForAbort = () => new Promise((_, reject) => {
        const abort = () => { events.emit('upstream-aborted'); reject(new Error('PRIVATE_PROVIDER_FAILURE')) }
        if (opts.signal.aborted) abort(); else opts.signal.addEventListener('abort', abort, { once: true })
      })
      if (u.hostname === 'sheets.googleapis.com') {
        if (opts.method === 'POST') {
          const body = JSON.parse(opts.body)
          assert.equal(body.requests.length, 1)
          entered = body.requests[0].updateCells.rows[0].values[0].userEnteredValue ?? null
          const pending = stallWrite ? waitForAbort() : Response.json({ spreadsheetId: 'book' })
          events.emit('write-dispatched')
          return pending
        }
        if (stallRead) { const pending = waitForAbort(); events.emit('read-stalled'); return pending }
        events.emit('sheet-read')
        return Response.json({ sheets: [{ properties: { sheetId: 0, title: 'Tab', gridProperties: { rowCount: 100, columnCount: 20 } }, data: [{ rowData: [{ values: [{ ...(entered ? { userEnteredValue: entered, effectiveValue: entered } : {}), formattedValue: entered?.stringValue ?? '' }] }] }] }] })
      }
      const file = { id: 'book', name: 'Budget', mimeType: SHEETS_MIME, parents: [], trashed: false }
      return Response.json(u.pathname.endsWith('/files') ? { files: [file] } : file)
    },
  })
  const allActions = [...actions, 'session-status', 'session-set']
  const runtime = Object.fromEntries(allActions.map(action => [action, (args, signal) => service.browser(action, args, signal)]))
  const server = createServer((req, res) => {
    const action = req.url.split('/').at(-1)
    if (!allActions.includes(action)) { res.writeHead(404); res.end(); return }
    void createHandler(runtime, action, port)(req, res)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); port = server.address().port
  const origin = `http://127.0.0.1:${port}`
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-DSH-Google-Drive': '1', 'Sec-Fetch-Site': 'same-origin' }
  t.after(async () => { service.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  async function post(action, input, options = {}) {
    const response = await fetch(`${origin}/api/plugins/google-drive/${action}`, { method: 'POST', ...options,
      headers: { ...headers, ...options.headers }, ...(options.method === 'GET' ? {} : { body: JSON.stringify(input) }) })
    return { status: response.status, headers: response.headers, result: await response.json() }
  }
  async function toggle(enabled) {
    const status = await post('session-status', { sessionId: 'root' })
    assert.equal(status.status, 200)
    const { ownerId, revision } = status.result.value
    const result = await post('session-set', { sessionId: 'root', ownerId, revision, enabled })
    assert.equal(result.status, 200)
    assert.equal(result.result.value.enabled, enabled)
    return result.result.value
  }
  await toggle(true)
  const identity = { sessionId: 'root', callId: 'access' }
  const access = service.requestEdit(agent, { callId: identity.callId, reason: 'Edit synthetic budget' })
  async function grant() {
    const status = await post('edit-status', identity)
    assert.equal(status.result.value.state, 'pending')
    const input = { ...identity, requestId: status.result.value.requestId }
    assert.equal((await post('edit-grant', { ...input, selected: [{ id: 'book', recursive: false }] })).status, 200)
    assert.equal((await access).state, 'granted')
    return input
  }
  async function prepare({ stalled = false, signal } = {}) {
    stallRead = stalled
    const observed = once(events, stalled ? 'read-stalled' : 'sheet-read')
    const done = service.proposeSheetEdit(agent, { callId: 'preview', fileId: 'book', range: 'Tab!A1', changes: [{ cell: 'A1', value: 'after' }], signal })
    await observed
    const input = { sessionId: 'root', callId: 'preview' }
    const status = await post('preview-status', input)
    return { done, input: { ...input, requestId: status.result.value.requestId }, status }
  }
  return { service, agent, events, audit, calls, post, identity, access, grant, prepare, toggle, tools, skills, stallWrites: () => { stallWrite = true } }
}

test('edit browse routes carry both views through to Google without granting edit access', async t => {
  const f = await fixture(t)
  const status = await f.post('edit-status', f.identity)
  const input = { ...f.identity, requestId: status.result.value.requestId }
  for (const view of ['my-drive', 'shared-with-me']) {
    assert.equal((await f.post('edit-browse', { ...input, view })).status, 200)
    assert.equal(new URL(f.calls.at(-1).url).searchParams.get('q'), view === 'my-drive'
      ? "trashed = false and ('root' in parents)" : 'trashed = false and (sharedWithMe = true)')
    assert.equal((await f.post('edit-browse', { ...input, view, parentId: 'folder', search: 'Budget' })).status, 200)
    assert.equal(new URL(f.calls.at(-1).url).searchParams.get('q'), "trashed = false and (name contains 'Budget')")
  }
  const before = f.calls.length
  for (const view of ['', 'unknown', null, 1, {}, []]) {
    assert.equal((await f.post('edit-browse', { ...input, view })).status, 400)
  }
  assert.equal(f.calls.length, before)
  assert.deepEqual((await f.post('edit-status', f.identity)).result.value.grants, [])
  await f.post('edit-deny', input)
  assert.equal((await f.access).state, 'denied')
})

test('real HTTP edit grant and preview apply sends one exact batch then reads back without custom history', { timeout: 5000 }, async t => {
  const f = await fixture(t); await f.grant()
  const p = await f.prepare()
  assert.equal(p.status.result.value.state, 'pending')
  assert.equal(p.status.result.value.preview.before.cells[0].userEnteredValue.stringValue, 'before')
  assert.equal(p.status.result.value.preview.after.cells[0].userEnteredValue.stringValue, 'after')
  assert.ok(!Object.hasOwn(p.status.result.value.preview, 'requests'))
  const result = await f.post('preview-apply', p.input)
  assert.equal(result.status, 200); assert.equal(result.result.value.state, 'applied')
  const outcome = await p.done
  assert.equal(outcome.state, 'applied'); assert.equal(outcome.snapshot.cells[0].userEnteredValue.stringValue, 'after')
  const writes = f.calls.filter(c => c.method === 'POST')
  assert.equal(writes.length, 1)
  const index = f.calls.indexOf(writes[0]); assert.ok(f.calls.slice(index + 1).some(c => new URL(c.url).hostname === 'sheets.googleapis.com'))
  assert.equal((await f.post('preview-apply', p.input)).status, 409)
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
  assert.deepEqual(f.audit, [])
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.ok(!JSON.stringify(result.result).includes('PRIVATE_TOKEN'))
})

test('every new route rejects cross-origin, missing header, wrong method and replacement payloads', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  for (const action of actions) {
    for (const headers of [{ Origin: 'https://evil.example' }, { 'X-DSH-Google-Drive': '' }, { 'Content-Type': 'text/plain' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      const result = await f.post(action, f.identity, { headers }); assert.equal(result.status, 403, action)
      assert.ok(!JSON.stringify(result).includes('PRIVATE_'))
    }
    assert.equal((await f.post(action, f.identity, { method: 'GET' })).status, 405, action)
    for (const field of ['proposal', 'requests', 'accessToken']) assert.equal((await f.post(action, { ...f.identity, [field]: {} })).status, 400, action)
    assert.equal((await f.post(action, { ...f.identity, sessionId: 'other' })).status, 409, action)
  }
  f.service.release(f.agent); await f.access
  assert.equal(f.calls.length, 0); assert.deepEqual(f.audit, [])
})

test('action-specific IDs reject mismatched access and preview identities without writes', { timeout: 5000 }, async t => {
  const f = await fixture(t)
  const pending = await f.post('edit-status', f.identity)
  for (const action of ['edit-browse', 'edit-grant', 'edit-deny']) {
    const result = await f.post(action, { ...f.identity, requestId: 'wrong', ...(action === 'edit-grant' ? { selected: [{ id: 'book', recursive: false }] } : {}) })
    assert.equal(result.status, 409)
  }
  assert.equal(pending.result.value.state, 'pending')
  await f.grant(); const p = await f.prepare()
  for (const action of ['preview-apply', 'preview-deny']) {
    assert.equal((await f.post(action, { ...p.input, requestId: 'wrong' })).status, 409)
    assert.equal((await f.post(action, { ...p.input, callId: 'other' })).status, 409)
    assert.equal((await f.post(action, { ...p.input, sessionId: 'other' })).status, 409)
  }
  assert.equal((await f.post('preview-status', p.input)).status, 400, 'status accepts no requestId replacement')
  assert.equal((await f.post('preview-deny', p.input)).result.value.state, 'denied')
  assert.equal((await p.done).state, 'denied')
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0)
})

test('browser denial while preparation stalls aborts upstream read and settles without a write', { timeout: 5000 }, async t => {
  const f = await fixture(t); await f.grant()
  const p = await f.prepare({ stalled: true }); assert.equal(p.status.result.value.state, 'preparing')
  const aborted = once(f.events, 'upstream-aborted')
  assert.equal((await f.post('preview-deny', p.input)).result.value.state, 'denied')
  await aborted; assert.equal((await p.done).state, 'denied')
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0)
})

test('toolbar OFF cancels pending picker; ON cannot revive old access cards', { timeout: 5000 }, async t => {
  const f = await fixture(t)
  assert.equal(f.tools.size, 2)
  await f.toggle(false)
  assert.equal((await f.access).state, 'cancelled')
  assert.equal(f.tools.size, 0); assert.equal(f.skills.size, 0)
  assert.equal((await f.post('edit-status', f.identity)).result.value.state, 'cancelled')
  await f.toggle(true)
  assert.equal(f.tools.size, 2)
  assert.equal((await f.post('edit-manage', f.identity)).status, 409)
  assert.equal(f.calls.length, 0)
})

test('toolbar OFF during preview preparation aborts reads and retains sanitized status', { timeout: 5000 }, async t => {
  const f = await fixture(t); await f.grant()
  const p = await f.prepare({ stalled: true })
  const aborted = once(f.events, 'upstream-aborted')
  await f.toggle(false); await aborted
  assert.equal((await p.done).state, 'cancelled')
  const identity = { sessionId: p.input.sessionId, callId: p.input.callId }
  const result = await f.post('preview-status', identity)
  assert.equal(result.status, 200)
  assert.equal(result.result.value.state, 'cancelled')
  assert.equal(result.result.value.preview, undefined)
  assert.equal(f.tools.size, 0); assert.equal(f.skills.size, 0)
  await f.toggle(true)
  assert.equal((await f.post('preview-apply', p.input)).status, 409)
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0)
})

test('toolbar OFF after write dispatch preserves uncertain tool and HTTP outcome without retry', { timeout: 5000 }, async t => {
  const f = await fixture(t); await f.grant(); const p = await f.prepare(); f.stallWrites()
  const dispatched = once(f.events, 'write-dispatched'), aborted = once(f.events, 'upstream-aborted')
  const browser = f.post('preview-apply', p.input)
  await dispatched; await f.toggle(false); await aborted
  const result = await browser
  assert.equal(result.status, 200)
  assert.equal(result.result.value.state, 'uncertain')
  const outcome = await p.done
  assert.equal(outcome.state, 'uncertain')
  assert.equal(outcome.snapshot, undefined)
  const status = await f.post('preview-status', { sessionId: p.input.sessionId, callId: p.input.callId })
  assert.equal(status.status, 200)
  assert.equal(status.result.value.state, 'uncertain')
  assert.equal(status.result.value.preview, undefined)
  assert.equal(JSON.stringify(status.result).includes('PRIVATE_'), false)
  assert.equal(f.tools.size, 0); assert.equal(f.skills.size, 0)
  await f.toggle(true)
  assert.equal((await f.post('preview-apply', p.input)).status, 409)
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
  assert.deepEqual(f.audit, [])
})

test('browser disconnect after dispatched POST settles tool as uncertain without leaking provider content', { timeout: 5000 }, async t => {
  const f = await fixture(t); await f.grant(); const p = await f.prepare(); f.stallWrites()
  const dispatched = once(f.events, 'write-dispatched'), aborted = once(f.events, 'upstream-aborted'), controller = new AbortController()
  const browser = f.post('preview-apply', p.input, { signal: controller.signal })
  const rejected = assert.rejects(browser)
  await dispatched; controller.abort(); await rejected; await aborted
  const outcome = await p.done
  assert.equal(outcome.state, 'uncertain'); assert.ok(!JSON.stringify(outcome).includes('PRIVATE_'))
  assert.equal(outcome.snapshot, undefined)
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
  assert.equal((await f.post('preview-apply', p.input)).status, 409)
  assert.deepEqual(f.audit, [])
})
