import test from 'node:test'
import assert from 'node:assert/strict'
import { DriveDocumentReader } from '../src/document-reader.js'
import { GoogleTransport } from '../src/transport.js'

const file = { id: 'pdf', name: 'Document', mimeType: 'application/pdf', parents: [], trashed: false }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { resolve, promise } }
const result = { text: '[Page 1]\nExtracted', pages: [{ pageNumber: 1, method: 'embedded' }], totalPages: 1, actualRange: { startPage: 1, endPage: 1 }, warnings: [], format: 'pdf', mimeType: 'text/plain' }

function fixture(t, { metadata = file, process, fetch } = {}) {
  const calls = []
  const transport = new GoogleTransport({
    withAccessToken: async operation => {
      const lifetime = new AbortController()
      try { return await operation('private-token', lifetime.signal) }
      finally { lifetime.abort() }
    },
    fetch: fetch ?? ((_url, init) => { calls.push(init); return new Response(new Uint8Array([37, 80, 68, 70, 45, 255])) }),
  })
  const reader = new DriveDocumentReader({ transport, getMetadata: async () => metadata,
    pdfProcessor: { read: process ?? (async () => result), dispose() {} } })
  t.after(() => { reader.dispose(); transport.dispose() })
  return { reader, calls }
}

test('PDF receives raw bounded bytes and operation signal survives successful authentication', async t => {
  const { reader, calls } = fixture(t, { process: async (bytes, options) => {
    assert.deepEqual([...bytes], [37, 80, 68, 70, 45, 255])
    assert.equal(options.signal.aborted, false)
    assert.equal(options.startPage, 1)
    assert.equal(options.ocr, 'off')
    assert.equal(options.maxBytes, 100)
    return result
  } })
  assert.deepEqual(await reader.readText({ fileId: 'pdf', maxBytes: 100, startPage: 1, ocr: 'off' }), { ...result, file })
  assert.equal(calls.length, 1)
})

test('invalid PDF options, oversized metadata, and non-PDF range options never download', async t => {
  for (const args of [{ startPage: 0 }, { startPage: 1, endPage: 6 }, { ocr: 'bad' }, { languages: ['../eng'] }, { maxBytes: 262145 }, { unexpected: true }]) {
    const { reader, calls } = fixture(t)
    await assert.rejects(reader.readText({ fileId: 'pdf', ...args }))
    assert.equal(calls.length, 0)
  }
  const large = fixture(t, { metadata: { ...file, size: '20971521' } })
  await assert.rejects(large.reader.readText({ fileId: 'pdf' }), /20 MiB/)
  assert.equal(large.calls.length, 0)
  const text = fixture(t, { metadata: { ...file, mimeType: 'text/plain' } })
  await assert.rejects(text.reader.readText({ fileId: 'pdf', startPage: 1 }), /require a PDF/)
  assert.equal(text.calls.length, 0)
})

test('PDF streaming cap rejects understated metadata without invoking processor', async t => {
  let processed = false
  const { reader } = fixture(t, { metadata: { ...file, size: '1' }, process: () => { processed = true },
    fetch: () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(20 * 1024 * 1024))
      controller.enqueue(new Uint8Array(1))
      controller.close()
    } })) })
  await assert.rejects(reader.readText({ fileId: 'pdf' }), /20 MiB download limit/)
  assert.equal(processed, false)
})

test('caller abort and reader disposal propagate into processing and suppress late output', async t => {
  for (const mode of ['caller', 'dispose']) {
    const entered = deferred()
    const release = deferred()
    const caller = new AbortController()
    let processSignal
    const { reader } = fixture(t, { process: async (_bytes, { signal }) => {
      processSignal = signal; entered.resolve(); await release.promise; return result
    } })
    const pending = reader.readText({ fileId: 'pdf', signal: caller.signal })
    const rejected = assert.rejects(pending, /cancelled/)
    await entered.promise
    if (mode === 'caller') caller.abort()
    else reader.dispose()
    assert.equal(processSignal.aborted, true)
    release.resolve()
    await rejected
  }
})

test('PDF admission bounds downloads and processing together', async t => {
  const entered = deferred()
  const release = deferred()
  let count = 0
  const { reader, calls } = fixture(t, { process: async () => {
    if (++count === 2) entered.resolve()
    await release.promise
    return result
  } })
  const first = reader.readText({ fileId: 'pdf' })
  const second = reader.readText({ fileId: 'pdf' })
  await entered.promise
  await assert.rejects(reader.readText({ fileId: 'pdf' }), /busy/)
  assert.equal(calls.length, 2)
  release.resolve()
  await Promise.all([first, second])
  await reader.readText({ fileId: 'pdf' })
})
