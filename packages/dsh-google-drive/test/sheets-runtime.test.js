import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as turn } from 'node:timers/promises'
import { DriveAccessRuntime } from '../src/runtime.js'
import { SheetsRuntime } from '../src/sheets-runtime.js'

const SHEET = 'application/vnd.google-apps.spreadsheet'
const FOLDER = 'application/vnd.google-apps.folder'
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function fixture(t, overrides = {}) {
  const owner = { session: { id: 'root' } }
  const child = { session: { id: 'child' } }
  const registry = new Map([['root', owner], ['child', child]])
  const agents = { get: id => registry.get(id), roots: () => [registry.get('root')] }
  let generation = 1
  let policy = 'ask'
  const listeners = new Set()
  const auth = { getAccessGeneration: () => generation, onAccessChange: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
  const files = new Map([
    ['sheet', { id: 'sheet', name: 'Budget', mimeType: SHEET, trashed: false, parents: ['folder'] }],
    ['other', { id: 'other', name: 'Other', mimeType: SHEET, trashed: false, parents: [] }],
    ['folder', { id: 'folder', name: 'Folder', mimeType: FOLDER, trashed: false, parents: [] }],
  ])
  const client = { getMetadata: async ({ fileId }) => ({ ...files.get(fileId) }) }
  let runtime
  const options = { client, googleAuth: auth, agents, approval: { overrideOf: () => policy }, onChange: owner => runtime?.permissionsChanged(owner) }
  const readRuntime = new DriveAccessRuntime(options)
  const editRuntime = new DriveAccessRuntime({ ...options, mode: 'edit' })
  const snapshot = { fileId: 'sheet', range: 'Budget!A1', tab: { sheetId: 0, title: 'Budget' }, cells: [{ cell: 'A1', formattedValue: '10' }] }
  let original
  let writes = 0
  let preparations = 0
  const readClient = {
    describe: async () => ({ fileId: 'sheet', title: 'Budget', tabs: [] }),
    read: async () => structuredClone(snapshot), ...overrides.readClient,
  }
  const writeClient = {
    prepare: async ({ fileId, range }) => {
      preparations++
      original = { version: 1, fileId, range, tab: snapshot.tab, before: structuredClone(snapshot),
        after: { ...structuredClone(snapshot), cells: [{ cell: 'A1', formattedValue: '20' }] }, requests: [{ updateCells: { privateMarker: true } }] }
      return original
    },
    apply: async ({ proposal, signal, beforeDispatch }) => {
      assert.equal(proposal, original)
      signal.throwIfAborted()
      beforeDispatch()
      writes++
      return { status: 'applied', snapshot: proposal.after }
    }, ...overrides.writeClient,
  }
  runtime = new SheetsRuntime({ readRuntime, editRuntime, readClient, writeClient, googleAuth: auth })
  t.after(() => { runtime.dispose(); readRuntime.dispose(); editRuntime.dispose() })
  return { owner, child, registry, auth, files, readRuntime, editRuntime, runtime, readClient, writeClient,
    writes: () => writes, preparations: () => preparations, original: () => original,
    policy: value => { policy = value }, account: () => { generation++; for (const fn of listeners) fn() },
    silentAccount: () => { generation++ },
    grant: async (kind = 'edit', fileIds = ['sheet'], folderIds = []) => {
      const permissions = (kind === 'edit' ? editRuntime : readRuntime).permissions
      const { requestId } = permissions.request(owner)
      return permissions.approve(owner, requestId, { fileIds, folderIds, replace: true })
    },
  }
}
const identity = (callId = 'call') => ({ sessionId: 'root', callId })
async function pending(f, callId = 'call') {
  for (let i = 0; i < 30; i++) {
    const status = f.runtime.status(identity(callId))
    if (status.state !== 'preparing') { assert.equal(status.state, 'pending'); return { ...identity(callId), requestId: status.requestId } }
    await turn()
  }
  assert.fail('preview did not become pending')
}
function prepare(f, callId = 'call', extra = {}) {
  return f.runtime.prepare(f.owner, { callId, fileId: 'sheet', range: 'Budget!A1', changes: [{ cell: 'A1', value: 20 }], ...extra })
}

test('reads require exact root ownership and independent read or explicit edit access', async t => {
  const f = fixture(t)
  await assert.rejects(f.runtime.read(f.owner, { fileId: 'sheet', range: 'Budget!A1' }), /permission/)
  assert.throws(() => f.runtime.read(f.child, { fileId: 'sheet', range: 'Budget!A1' }), /top-level/)
  await f.grant('read', [], ['folder'])
  assert.equal((await f.runtime.read(f.owner, { fileId: 'sheet', range: 'Budget!A1' })).cells[0].formattedValue, '10')
  assert.throws(() => prepare(f), /edit access/)
  f.readRuntime.permissions.revoke(f.owner)
  await f.grant()
  assert.equal((await f.runtime.describe(f.owner, { fileId: 'sheet' })).title, 'Budget')
  assert.throws(() => f.runtime.describe({ session: f.owner.session }, { fileId: 'sheet' }), /top-level/)
})

test('final ancestry check suppresses a read moved out of recursive grant', async t => {
  const f = fixture(t)
  await f.grant('read', [], ['folder'])
  f.readClient.read = async () => { f.files.get('sheet').parents = []; return { secret: 'must not escape' } }
  await assert.rejects(f.runtime.read(f.owner, { fileId: 'sheet', range: 'Budget!A1' }), /permission/)
})

test('revocation cancels read lifetime and suppresses late client data', async t => {
  const f = fixture(t)
  await f.grant('read')
  const gate = deferred(); const started = deferred()
  let observed
  f.readClient.read = async ({ signal }) => { observed = signal; started.resolve(); return gate.promise }
  const read = f.runtime.read(f.owner, { fileId: 'sheet', range: 'Budget!A1' })
  const rejected = assert.rejects(read, /permission/)
  await started.promise
  f.readRuntime.permissions.revoke(f.owner)
  assert.equal(observed.aborted, true)
  await rejected
  gate.resolve({ secret: 'late' })
})

test('prepare remains pending; browser preview is isolated and never includes requests', async t => {
  const f = fixture(t)
  await f.grant()
  let settled = false
  const result = prepare(f).then(value => { settled = true; return value })
  assert.equal(f.runtime.status(identity()).state, 'preparing')
  const id = await pending(f)
  assert.equal(settled, false)
  const status = f.runtime.status(id)
  assert.equal(status.preview.fileName, 'Budget')
  assert.equal(status.preview.before.cells[0].formattedValue, '10')
  assert.equal(status.preview.after.cells[0].formattedValue, '20')
  assert.equal(JSON.stringify(status).includes('privateMarker'), false)
  status.preview.after.cells[0].formattedValue = '999'
  assert.equal(f.runtime.status(id).preview.after.cells[0].formattedValue, '20')
  assert.equal(Object.isFrozen(f.original().requests[0]), true)
  const applied = await f.runtime.approve({ ...id, proposal: { requests: ['malicious'] } })
  assert.equal(applied.state, 'applied')
  assert.equal((await result).state, 'applied')
  assert.equal(f.writes(), 1)
})

test('denial while preparing aborts work and suppresses late proposal publication', async t => {
  const f = fixture(t)
  await f.grant()
  const gate = deferred(); const started = deferred()
  let observed
  f.writeClient.prepare = async ({ signal }) => { observed = signal; started.resolve(); return gate.promise }
  const result = prepare(f)
  await started.promise
  const status = f.runtime.status(identity())
  assert.equal(status.state, 'preparing')
  const id = { ...identity(), requestId: status.requestId }
  assert.equal(f.runtime.deny(id).state, 'denied')
  assert.equal((await result).state, 'denied')
  assert.equal(observed.aborted, true)
  gate.resolve({ fileId: 'sheet', requests: [] })
  await turn()
  assert.equal(f.runtime.status(id).state, 'denied')
  assert.equal(f.runtime.status(id).preview, undefined)
  assert.throws(() => f.runtime.approve(id), /no longer active/)
  assert.equal(f.writes(), 0)
})

test('duplicate apply is rejected synchronously and approvals cannot be replayed', async t => {
  const f = fixture(t)
  await f.grant()
  const result = prepare(f)
  const id = await pending(f)
  const first = f.runtime.approve(id)
  assert.throws(() => f.runtime.approve(id), /no longer active/)
  await first; await result
  assert.throws(() => f.runtime.approve(id), /no longer active/)
  assert.equal(f.writes(), 1)
})

test('wrong request, owner replacement, and missing approval identity fail closed', async t => {
  const f = fixture(t)
  await f.grant()
  const result = prepare(f)
  const id = await pending(f)
  assert.throws(() => f.runtime.approve({ ...id, requestId: 'wrong' }), /no longer active/)
  assert.throws(() => f.runtime.approve(identity()), /no longer active/)
  f.registry.set('root', { session: { id: 'root' } })
  assert.throws(() => f.runtime.approve(id), /no longer active/)
  f.runtime.release(f.owner)
  assert.equal((await result).state, 'cancelled')
  assert.equal(f.writes(), 0)
})

test('deny is one-shot and produces no write', async t => {
  const f = fixture(t)
  await f.grant()
  const result = prepare(f)
  const id = await pending(f)
  assert.equal(f.runtime.deny(id).state, 'denied')
  assert.equal((await result).state, 'denied')
  assert.throws(() => f.runtime.approve(id), /no longer active/)
  assert.equal(f.writes(), 0)
})

for (const cause of ['revoke', 'account', 'silent-account', 'policy', 'expiry']) {
  test(`${cause} prevents pending preview writes`, async t => {
    if (cause === 'expiry') t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const f = fixture(t)
    await f.grant()
    const result = prepare(f)
    const id = await pending(f)
    if (cause === 'revoke') f.editRuntime.permissions.revoke(f.owner)
    if (cause === 'account') f.account()
    if (cause === 'silent-account') f.silentAccount()
    if (cause === 'policy') f.policy('never')
    if (cause === 'expiry') t.mock.timers.tick(600_000)
    assert.throws(() => f.runtime.approve(id))
    assert.equal((await result).state, 'cancelled')
    assert.equal(f.writes(), 0)
    assert.equal(f.runtime.status(id).preview, undefined)
  })
}

test('policy is checked again immediately before dispatch after client preflight', async t => {
  const f = fixture(t)
  await f.grant()
  f.writeClient.apply = async ({ beforeDispatch }) => { f.policy('never'); beforeDispatch(); assert.fail('must not dispatch') }
  const result = prepare(f)
  const id = await pending(f)
  assert.equal((await f.runtime.approve(id)).state, 'failed')
  assert.equal((await result).state, 'failed')
})

test('revocation during write aborts but does not race away uncertain outcome', async t => {
  const f = fixture(t)
  await f.grant()
  const gate = deferred(); const started = deferred()
  let observed
  f.writeClient.apply = async ({ signal, beforeDispatch }) => {
    beforeDispatch(); observed = signal; started.resolve(); await gate.promise
    return { status: 'uncertain', message: 'untrusted diagnostic secret' }
  }
  let settled = false
  const result = prepare(f).then(value => { settled = true; return value })
  const id = await pending(f)
  const apply = f.runtime.approve(id)
  await started.promise
  f.editRuntime.permissions.revoke(f.owner)
  assert.equal(observed.aborted, true)
  await turn()
  assert.equal(settled, false)
  assert.equal(f.runtime.status(id).state, 'applying')
  gate.resolve()
  assert.equal((await apply).state, 'uncertain')
  const outcome = await result
  assert.equal(outcome.state, 'uncertain')
  assert.equal(JSON.stringify(outcome).includes('secret'), false)
  assert.throws(() => f.runtime.approve(id))
})

test('late applied snapshot is suppressed after revocation even if client ignores abort', async t => {
  const f = fixture(t)
  await f.grant()
  f.writeClient.apply = async ({ beforeDispatch }) => {
    beforeDispatch(); f.editRuntime.permissions.revoke(f.owner)
    return { status: 'applied', snapshot: { secret: 'late data' } }
  }
  const result = prepare(f); const id = await pending(f)
  await f.runtime.approve(id)
  const outcome = await result
  assert.equal(outcome.state, 'uncertain')
  assert.equal(JSON.stringify(outcome).includes('late data'), false)
})

test('predispatch errors and postdispatch throws are sanitized and one-shot', async t => {
  for (const dispatch of [false, true]) {
    const f = fixture(t)
    await f.grant()
    f.writeClient.apply = async ({ beforeDispatch }) => { if (dispatch) beforeDispatch(); throw new Error('private URL token') }
    const result = prepare(f); const id = await pending(f)
    await f.runtime.approve(id)
    const outcome = await result
    assert.equal(outcome.state, dispatch ? 'uncertain' : 'failed')
    assert.equal(JSON.stringify(outcome).includes('private URL'), false)
    assert.throws(() => f.runtime.approve(id))
  }
})

test('prepare errors expose only fixed messages for recognized codes', async t => {
  const messages = {
    unsupported: 'This range contains unsupported cell features, such as merged cells, rich text, smart chips, or calculated outputs. Select a supported range and prepare again.',
    invalid: 'The requested range or changes are invalid or exceed the Sheets preview limits. Check the input and use a smaller range if needed.',
    noop: 'The requested values and supported formatting already match the spreadsheet. No write was prepared.',
    unknown: 'Could not prepare the Sheets preview. Check access and the requested changes, then prepare again.',
  }
  for (const [code, message] of Object.entries(messages)) {
    const f = fixture(t)
    await f.grant()
    f.writeClient.prepare = async () => { throw Object.assign(new Error('malicious secret URL'), { code }) }
    const result = await prepare(f)
    assert.deepEqual(result, { state: 'failed', message })
    assert.equal(JSON.stringify(f.runtime.status(identity())).includes('malicious'), false)
  }
})

test('stale predispatch failure has fixed guidance but postdispatch remains uncertain', async t => {
  for (const dispatch of [false, true]) {
    const f = fixture(t)
    await f.grant()
    f.writeClient.apply = async ({ beforeDispatch }) => {
      if (dispatch) beforeDispatch()
      throw Object.assign(new Error('malicious secret URL'), { code: 'stale' })
    }
    const result = prepare(f); const id = await pending(f)
    await f.runtime.approve(id)
    const outcome = await result
    assert.equal(outcome.state, dispatch ? 'uncertain' : 'failed')
    if (!dispatch) assert.equal(outcome.message, 'No write was dispatched. The spreadsheet changed after this preview was prepared. Read the affected cells and prepare a new preview.')
    assert.equal(JSON.stringify(outcome).includes('malicious'), false)
  }
})

test('tool cancellation during prepare suppresses late proposal', async t => {
  const f = fixture(t)
  await f.grant()
  const gate = deferred(); const started = deferred()
  f.writeClient.prepare = async () => { started.resolve(); return gate.promise }
  const controller = new AbortController()
  const result = prepare(f, 'call', { signal: controller.signal })
  await started.promise
  controller.abort()
  assert.equal((await result).state, 'cancelled')
  gate.resolve({ fileId: 'sheet', requests: [] })
  await turn()
  assert.equal(f.runtime.status(identity()).state, 'cancelled')
  assert.equal(f.runtime.status(identity()).preview, undefined)
})

test('records are bounded at twenty without evicting live approvals', async t => {
  const f = fixture(t)
  await f.grant()
  const results = []
  for (let i = 0; i < 20; i++) { results.push(prepare(f, `call${i}`)); await pending(f, `call${i}`) }
  assert.throws(() => prepare(f, 'overflow'), /Too many/)
  f.runtime.deny(await pending(f, 'call0'))
  results.push(prepare(f, 'replacement'))
  await pending(f, 'replacement')
  assert.throws(() => f.runtime.status(identity('call0')), /no longer active/)
  f.runtime.release(f.owner)
  await Promise.all(results)
  assert.equal(f.writes(), 0)
})

test('commit gates prevent premature read and edit access', async t => {
  const f = fixture(t)
  await f.grant('read')
  f.readRuntime.committing.add(f.owner)
  assert.throws(() => f.runtime.read(f.owner, { fileId: 'sheet', range: 'Budget!A1' }), /confirmation/)
  f.readRuntime.committing.delete(f.owner)
  f.readRuntime.permissions.revoke(f.owner)
  await f.grant()
  f.editRuntime.committing.add(f.owner)
  assert.throws(() => prepare(f), /edit access/)
  await assert.rejects(f.runtime.read(f.owner, { fileId: 'sheet', range: 'Budget!A1' }), /permission/)
})

test('recursive edit resources cannot authorize spreadsheet edits or reads', async t => {
  const f = fixture(t)
  await assert.rejects(f.grant('edit', [], ['folder']), /individual Google Sheets/)
  assert.throws(() => prepare(f), /edit access/)
  await assert.rejects(f.runtime.read(f.owner, { fileId: 'sheet', range: 'Budget!A1' }), /permission/)
})

test('browser disconnect after dispatch preserves uncertain tool result', async t => {
  const f = fixture(t)
  await f.grant()
  const controller = new AbortController()
  let observed
  f.writeClient.apply = async ({ signal, beforeDispatch }) => {
    beforeDispatch(); controller.abort(); observed = signal.aborted
    return { status: 'uncertain' }
  }
  const result = prepare(f); const id = await pending(f)
  await f.runtime.approve(id, controller.signal)
  assert.equal(observed, true)
  assert.equal((await result).state, 'uncertain')
})

for (const cause of ['account', 'expiry']) {
  test(`${cause} between approval and dispatch prevents the write`, async t => {
    if (cause === 'expiry') t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const f = fixture(t)
    await f.grant()
    f.writeClient.apply = async ({ beforeDispatch }) => {
      if (cause === 'account') f.silentAccount()
      else t.mock.timers.tick(600_000)
      beforeDispatch()
      assert.fail('must not dispatch')
    }
    const result = prepare(f); const id = await pending(f)
    await f.runtime.approve(id)
    assert.equal((await result).state, 'failed')
  })
}

test('dispose settles pending tools and makes browser records inert', async t => {
  const f = fixture(t)
  await f.grant()
  const result = prepare(f); const id = await pending(f)
  f.runtime.dispose()
  assert.equal((await result).state, 'cancelled')
  assert.throws(() => f.runtime.status(id), /no longer active/)
})
