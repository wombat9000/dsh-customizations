import test from 'node:test'
import assert from 'node:assert/strict'
import { DrivePermissions } from '../src/permissions.js'

const folder = (id, parents = []) => ({ id, name: id, mimeType: 'application/vnd.google-apps.folder', parents, trashed: false })
const file = (id, parents = []) => ({ id, name: id, mimeType: 'text/plain', parents, trashed: false })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function fixture(t) {
  const owner = {}
  const other = {}
  let generation = 1
  const dead = new Set()
  const nodes = new Map([folder('root'), folder('nested', ['root']), file('child', ['nested']), file('explicit'), file('outside')].map(value => [value.id, value]))
  const calls = []
  const changes = []
  const client = {
    async getMetadata({ fileId }) { calls.push(['metadata', fileId]); if (!nodes.has(fileId)) throw Error('not found'); return { ...nodes.get(fileId) } },
    async listFolder({ folderId }) { calls.push(['folder', folderId]); return { files: [...nodes.values()].filter(file => file.parents.includes(folderId)) } },
    async pickerList(args) { calls.push(['picker', args]); return { files: [...nodes.values()], nextPageToken: 'private-google-token' } },
    async readText() { return { text: 'content', mimeType: 'text/plain' } },
  }
  const core = new DrivePermissions({ client, getAccountGeneration: () => generation, isOwnerLive: value => !dead.has(value), onChange: value => changes.push(value) })
  t.after(() => core.dispose())
  const approve = async (selection = { folderIds: ['root'], fileIds: ['explicit'] }) => core.approve(owner, core.request(owner).requestId, selection)
  return { core, client, owner, other, nodes, calls, changes, approve, dead, reconnect: () => generation++ }
}

test('selection is one-shot, owned, private picker separate from agent root', async t => {
  const { core, owner, other, approve } = fixture(t)
  const request = core.request(owner)
  await assert.rejects(core.pickerList(other, request.requestId), /permission/)
  assert.deepEqual(await core.listFiles(owner), { files: [] })
  const picker = await core.pickerList(owner, request.requestId)
  assert.equal(picker.files.length, 5)
  assert.notEqual(picker.nextPageToken, 'private-google-token')
  await assert.rejects(core.listFiles(owner, { pageToken: picker.nextPageToken }), /permission/)
  const granted = await approve()
  assert.equal(granted.resources[0].recursive, false)
  assert.deepEqual((await core.listFiles(owner)).files.map(file => file.id), ['explicit', 'root'])
  assert.deepEqual(core.grants(other), [])
  assert.equal((await core.getMetadata(owner, { fileId: 'child' })).parents, undefined)
  await assert.rejects(core.getMetadata(owner, { fileId: 'outside' }), /permission/)
  assert.equal((await core.readText(owner, { fileId: 'child' })).text, 'content')
})

test('future descendants are allowed and moved-out descendants denied', async t => {
  const { core, owner, approve, nodes } = fixture(t)
  await approve()
  nodes.set('future', file('future', ['nested']))
  assert.equal((await core.getMetadata(owner, { fileId: 'future' })).id, 'future')
  assert.deepEqual((await core.listFiles(owner, { folderId: 'nested' })).files.map(file => file.id), ['child', 'future'])
  nodes.set('nested', folder('nested', []))
  await assert.rejects(core.readText(owner, { fileId: 'child' }), /permission/)
  await assert.rejects(core.listFiles(owner, { folderId: 'nested' }), /permission/)
})

test('account generation and exact live ownership invalidate requests and grants', async t => {
  const { core, owner, approve, reconnect, dead, changes } = fixture(t)
  await approve()
  const { requestId } = core.request(owner)
  reconnect()
  await assert.rejects(core.approve(owner, requestId, { fileIds: ['explicit'] }), /permission/)
  assert.deepEqual(core.grants(owner), [])
  await approve()
  dead.add(owner)
  await assert.rejects(core.getMetadata(owner, { fileId: 'explicit' }), /permission/)
  assert.ok(changes.length >= 4)
})

test('selection rejects shortcuts, folder mismatch, duplicate and malicious IDs', async t => {
  const { core, owner, nodes } = fixture(t)
  nodes.set('shortcut', { ...file('shortcut'), mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'outside' } })
  for (const selection of [{ fileIds: ['root'] }, { folderIds: ['explicit'] }, { fileIds: ['shortcut'] }, { fileIds: ['explicit', 'explicit'] }, { fileIds: ["x' or true"] }, {}]) {
    await assert.rejects(core.approve(owner, core.request(owner).requestId, selection), /selection/)
  }
  const request = core.request(owner)
  await core.approve(owner, request.requestId, { fileIds: ['explicit'] })
  await assert.rejects(core.approve(owner, request.requestId, { fileIds: ['explicit'] }), /permission/)
})

test('revoke and caller abort reject even when client ignores cancellation', async t => {
  for (const mode of ['revoke', 'abort', 'invalidate']) {
    const { core, owner, client, approve } = fixture(t)
    const grant = await approve()
    const entered = deferred()
    const stalled = deferred()
    client.readText = () => { entered.resolve(); return stalled.promise }
    const controller = new AbortController()
    const reading = core.readText(owner, { fileId: 'explicit', signal: controller.signal })
    const rejected = assert.rejects(reading, /permission/)
    await entered.promise
    if (mode === 'revoke') core.revoke(owner, grant.grantId)
    else if (mode === 'invalidate') core.invalidate()
    else controller.abort()
    await rejected
    stalled.resolve({ text: 'late secret' })
  }
})

test('denial interrupts approval and duplicate concurrent approval fails', async t => {
  const { core, owner, client } = fixture(t)
  const entered = deferred()
  const stalled = deferred()
  client.getMetadata = () => { entered.resolve(); return stalled.promise }
  const { requestId } = core.request(owner)
  const pending = core.approve(owner, requestId, { fileIds: ['explicit'] })
  const rejected = assert.rejects(pending, /permission/)
  await entered.promise
  await assert.rejects(core.approve(owner, requestId, { fileIds: ['explicit'] }), /permission/)
  core.deny(owner, requestId)
  await rejected
  stalled.resolve(file('explicit'))
  assert.deepEqual(core.grants(owner), [])
})

test('opaque cursors are bound to owner, request, parent, search and revision', async t => {
  const { core, owner, other, approve } = fixture(t)
  const a = core.request(owner).requestId
  const b = core.request(owner).requestId
  const page = await core.pickerList(owner, a, { search: 'note' })
  await assert.rejects(core.pickerList(owner, b, { search: 'note', pageToken: page.nextPageToken }), /permission/)
  await assert.rejects(core.pickerList(owner, a, { search: 'other', pageToken: page.nextPageToken }), /permission/)
  await assert.rejects(core.pickerList(other, a, { search: 'note', pageToken: page.nextPageToken }), /permission/)
  await core.pickerList(owner, a, { search: 'note', pageToken: page.nextPageToken })
  await approve()
  await assert.rejects(core.pickerList(owner, a, { search: 'note', pageToken: page.nextPageToken }), /permission/)
  await assert.rejects(core.listFiles(owner, { query: 'true' }), /Invalid/)
})

test('replace atomically removes deselected files, empty replacement revokes all', async t => {
  const { core, owner, approve } = fixture(t)
  await approve()
  const failed = core.request(owner).requestId
  await assert.rejects(core.approve(owner, failed, { fileIds: ['root'], replace: true }), /selection/)
  assert.equal((await core.getMetadata(owner, { fileId: 'explicit' })).id, 'explicit')
  await core.approve(owner, core.request(owner).requestId, { folderIds: ['root'], replace: true })
  await assert.rejects(core.getMetadata(owner, { fileId: 'explicit' }), /permission/)
  await core.approve(owner, core.request(owner).requestId, { replace: true })
  assert.deepEqual(core.grants(owner), [])
})

test('read permission forwards only supplied PDF options and retains structured pages', async t => {
  const { core, owner, client, approve } = fixture(t)
  await approve()
  const calls = []
  const result = { text: '[Page 4]\nOCR text', format: 'pdf', mimeType: 'text/plain',
    pages: [{ pageNumber: 4, text: 'OCR text', method: 'ocr' }], totalPages: 9,
    actualRange: { startPage: 4, endPage: 4 }, nextStartPage: 5, warnings: [] }
  client.readText = async args => { calls.push(args); return result }
  const options = { fileId: 'explicit', maxBytes: 300, startPage: 4, endPage: 4, ocr: 'force', languages: ['eng'] }
  const read = await core.readText(owner, options)
  assert.deepEqual(calls[0], { ...options, signal: calls[0].signal })
  assert.ok(calls[0].signal instanceof AbortSignal)
  assert.deepEqual(read, { ...result, file: { id: 'explicit', name: 'explicit', mimeType: 'text/plain' } })
  await core.readText(owner, { fileId: 'explicit' })
  for (const key of ['startPage', 'endPage', 'ocr', 'languages']) assert.equal(Object.hasOwn(calls[1], key), false)
  await assert.rejects(core.readText(owner, { fileId: 'explicit', processor: 'arbitrary' }), /Invalid/)
  assert.equal(calls.length, 2)
})

test('deferred PDF processing receives abort on revocation, replacement and owner lifetime end', async t => {
  for (const mode of ['caller', 'revoke', 'replace', 'account', 'release', 'dispose']) {
    await t.test(mode, async t => {
      const { core, owner, client, approve, reconnect } = fixture(t)
      const grant = await approve()
      const entered = deferred(), stalled = deferred()
      let processingSignal, aborted = 0
      client.readText = ({ signal }) => {
        processingSignal = signal
        signal.addEventListener('abort', () => { aborted++ }, { once: true })
        entered.resolve()
        return stalled.promise
      }
      const controller = new AbortController()
      const reading = core.readText(owner, { fileId: 'explicit', startPage: 1, ocr: 'force', signal: controller.signal })
      const rejected = assert.rejects(reading, /permission/)
      await entered.promise
      if (mode === 'caller') controller.abort()
      else if (mode === 'revoke') core.revoke(owner, grant.grantId)
      else if (mode === 'replace') await core.approve(owner, core.request(owner).requestId, { fileIds: ['explicit'], replace: true })
      else if (mode === 'account') { reconnect(); core.invalidate() }
      else if (mode === 'release') core.invalidate(owner)
      else core.dispose()
      await rejected
      assert.equal(processingSignal.aborted, true)
      assert.equal(aborted, 1)
      stalled.resolve({ text: 'late OCR secret', pages: [{ pageNumber: 1, text: 'late OCR secret', method: 'ocr' }] })
      await assert.rejects(reading, /permission/)
    })
  }
})

test('lazy account generation and dead-owner checks suppress late OCR without notifications', async t => {
  for (const mode of ['generation', 'owner']) {
    const { core, owner, client, approve, reconnect, dead } = fixture(t)
    await approve()
    const entered = deferred(), stalled = deferred()
    let processingSignal
    client.readText = ({ signal }) => { processingSignal = signal; entered.resolve(); return stalled.promise }
    const reading = core.readText(owner, { fileId: 'explicit', ocr: 'force' })
    const rejected = assert.rejects(reading, /permission/)
    await entered.promise
    if (mode === 'generation') reconnect()
    else dead.add(owner)
    stalled.resolve({ text: 'late OCR secret' })
    await rejected
    assert.equal(processingSignal.aborted, true)
  }
})

test('fresh ancestry after deferred OCR rejects moved, trashed and shortcut resources', async t => {
  for (const mode of ['moved', 'trashed', 'shortcut', 'parent']) {
    const { core, owner, client, approve, nodes } = fixture(t)
    await approve()
    const entered = deferred(), stalled = deferred()
    client.readText = () => { entered.resolve(); return stalled.promise }
    const reading = core.readText(owner, { fileId: 'child', startPage: 1, endPage: 2 })
    const rejected = assert.rejects(reading, /permission/)
    await entered.promise
    if (mode === 'moved') nodes.set('child', file('child', []))
    else if (mode === 'trashed') nodes.set('child', { ...nodes.get('child'), trashed: true })
    else if (mode === 'shortcut') nodes.set('child', { ...nodes.get('child'), mimeType: 'application/vnd.google-apps.shortcut' })
    else nodes.set('nested', folder('nested', []))
    stalled.resolve({ text: 'OCR secret', pages: [{ pageNumber: 1, text: 'OCR secret', method: 'ocr' }] })
    await rejected
  }
})

test('revocation while post-OCR metadata is pending suppresses the completed extraction', async t => {
  const { core, owner, client, approve } = fixture(t)
  await approve()
  const entered = deferred(), stalled = deferred()
  client.readText = async () => {
    client.getMetadata = () => { entered.resolve(); return stalled.promise }
    return { text: 'completed OCR secret' }
  }
  const reading = core.readText(owner, { fileId: 'explicit', ocr: 'force' })
  const rejected = assert.rejects(reading, /permission/)
  await entered.promise
  core.revoke(owner)
  await rejected
  stalled.resolve(file('explicit'))
  await assert.rejects(reading, /permission/)
})

test('movement during content fetch suppresses the returned content', async t => {
  const { core, owner, client, approve, nodes } = fixture(t)
  await approve()
  client.readText = async () => { nodes.set('child', file('child', [])); return { text: 'secret' } }
  await assert.rejects(core.readText(owner, { fileId: 'child' }), /permission/)
})
