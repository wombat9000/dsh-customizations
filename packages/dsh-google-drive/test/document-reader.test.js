import test from 'node:test'
import assert from 'node:assert/strict'
import { DriveDocumentReader } from '../src/document-reader.js'
import { GoogleDriveClient } from '../src/google.js'

const file = { id: 'id', name: 'Notes', mimeType: 'text/plain', parents: [], trashed: false }

test('document reader keeps text MIME policy, byte limit and caller signal', async () => {
  for (const mimeType of ['text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values', 'application/json', 'application/vnd.google-apps.document']) {
    const signal = new AbortController().signal
    const metadata = { ...file, mimeType }
    const reader = new DriveDocumentReader({
      getMetadata: async options => { assert.deepEqual(options, { fileId: 'id', signal }); return metadata },
      transport: { async request(options) {
        assert.equal(options.signal, signal)
        const prepared = options.prepare()
        assert.equal(prepared.maxBytes, 262_144)
        const url = new URL(prepared.url)
        const docs = mimeType === 'application/vnd.google-apps.document'
        assert.equal(url.pathname, docs ? '/drive/v3/files/id/export' : '/drive/v3/files/id')
        assert.equal(url.search, docs ? '?mimeType=text%2Fplain' : '?alt=media')
        assert.throws(() => prepared.decode(Buffer.from([255])), TypeError)
        return prepared.decode(Buffer.from('hello'))
      } },
    })
    assert.deepEqual(await reader.readText({ fileId: 'id', signal }), {
      file: metadata, text: 'hello', mimeType: mimeType === 'application/vnd.google-apps.document' ? 'text/plain' : mimeType,
    })
  }
})

test('read limits fail before metadata and unsupported documents never download', async () => {
  let metadataCalls = 0
  const reader = new DriveDocumentReader({ getMetadata: async () => { metadataCalls++; return { ...file, mimeType: 'image/png' } },
    transport: { request() { assert.fail('Unsupported image must not download') } } })
  for (const maxBytes of [0, -1, 1.5, 1_048_577, Infinity, '5', null]) {
    await assert.rejects(reader.readText({ fileId: 'id', maxBytes }), /Invalid Google Drive read limit/)
  }
  assert.equal(metadataCalls, 0)
  await assert.rejects(reader.readText({ fileId: 'id' }), /Unsupported Google Drive MIME type/)
  assert.equal(metadataCalls, 1)
})

test('public reader decodes multibyte UTF-8 split across chunks at the exact byte bound', async t => {
  let calls = 0
  const client = new GoogleDriveClient({ withAccessToken: operation => operation('token'), fetch: () => ++calls === 1
    ? Response.json(file) : new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([0xe2])); controller.enqueue(new Uint8Array([0x82, 0xac])); controller.close()
    } })) })
  t.after(() => client.dispose())
  assert.equal((await client.readText({ fileId: 'id', maxBytes: 3 })).text, '€')
})

test('public reader cancels a stalled content body on account change, caller abort or disposal', async t => {
  for (const mode of ['account', 'caller', 'dispose']) {
    const account = new AbortController()
    const caller = new AbortController()
    let entered
    const contentStarted = new Promise(resolve => { entered = resolve })
    let calls = 0
    let contentSignal
    let cancelled = false
    const client = new GoogleDriveClient({ withAccessToken: operation => operation('token', account.signal),
      fetch: (_url, { signal }) => {
        if (++calls === 1) return Response.json(file)
        contentSignal = signal
        return new Response(new ReadableStream({ pull() { entered() }, cancel() { cancelled = true } }))
      } })
    t.after(() => client.dispose())
    const pending = client.readText({ fileId: 'id', signal: caller.signal })
    const rejected = assert.rejects(pending, { message: 'Google operation was cancelled.' })
    await contentStarted
    if (mode === 'account') account.abort()
    else if (mode === 'caller') caller.abort()
    else client.dispose()
    await rejected
    assert.equal(contentSignal.aborted, true)
    assert.equal(cancelled, true)
  }
})
