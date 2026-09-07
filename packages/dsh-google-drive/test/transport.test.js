import test from 'node:test'
import assert from 'node:assert/strict'
import { GoogleTransport } from '../src/transport.js'

const url = 'https://www.googleapis.com/drive/v3/files/id?alt=media'
function fixture(t, fetch, options = {}) {
  const transport = new GoogleTransport({ withAccessToken: operation => operation('token'), fetch, ...options })
  t.after(() => transport.dispose())
  return transport
}
const request = (transport, options = {}) => transport.request({ prepare: () => ({
  url, maxBytes: 4, decode: bytes => bytes, ...options,
}) })

test('transport preserves bounded bytes without imposing a document format', async t => {
  const transport = fixture(t, (actual, init) => {
    assert.equal(actual, url)
    assert.equal(init.redirect, 'error')
    assert.equal(init.headers.Authorization, 'Bearer token')
    return new Response(new Uint8Array([0, 255, 128, 10]))
  })
  assert.deepEqual(await request(transport), Buffer.from([0, 255, 128, 10]))
})

test('transport bounds streaming bytes before decoding and cancels the reader', async t => {
  let cancelled = false
  let decoded = false
  const transport = fixture(t, () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(2)) },
    cancel() { cancelled = true },
  })))
  await assert.rejects(request(transport, { decode() { decoded = true } }), { message: 'Google request failed (HTTP 200). Try again or reconnect.' })
  assert.equal(decoded, false)
  assert.equal(cancelled, true)
})

test('HTTP failures never run content decoders and retain the independent error body bound', async t => {
  for (const body of [JSON.stringify({ error: { message: 'private' } }), 'x'.repeat(16_385)]) {
    const transport = fixture(t, () => new Response(body, { status: 403 }))
    let decoded = false
    await assert.rejects(request(transport, { maxBytes: 1, decode() { decoded = true } }), /Google/)
    assert.equal(decoded, false)
  }
})

test('decoding failures are sanitized while local projection errors retain their diagnostic', async t => {
  const transport = fixture(t, () => new Response('ok'))
  await assert.rejects(request(transport, { decode() { throw new Error('private bytes') } }),
    { message: 'Google request failed (HTTP 200). Try again or reconnect.' })
  await assert.rejects(request(transport, { transform() { throw new Error('Invalid Google Drive response.') } }),
    { message: 'Invalid Google Drive response.' })
})

test('cancellation precedes preparation and preparation precedes authentication', async t => {
  let authenticated = false
  const transport = fixture(t, () => new Response(''), { withAccessToken() { authenticated = true } })
  const prepare = () => { throw new Error('invalid options') }
  await assert.rejects(transport.request({ signal: AbortSignal.abort(), prepare }), /cancelled/)
  await assert.rejects(transport.request({ prepare }), /invalid options/)
  assert.equal(authenticated, false)
  transport.dispose()
  await assert.rejects(transport.request({ signal: {}, prepare }), /cancelled/)
})
