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

test('movement during content fetch suppresses the returned content', async t => {
  const { core, owner, client, approve, nodes } = fixture(t)
  await approve()
  client.readText = async () => { nodes.set('child', file('child', [])); return { text: 'secret' } }
  await assert.rejects(core.readText(owner, { fileId: 'child' }), /permission/)
})
