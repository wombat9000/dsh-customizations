import test from 'node:test'
import assert from 'node:assert/strict'
import { GoogleDriveClient } from '../src/google.js'

const secret = 'https://private.invalid/?access_token=private-token'
const failure = (status, reason) => `Google request failed (HTTP ${status})${reason ? `: ${reason}` : ''}. Try again or reconnect.`
function fixture(t, fetch, options = {}) {
  const client = new GoogleDriveClient({ withAccessToken: operation => operation('private-token'), fetch, ...options })
  t.after(() => client.dispose())
  return client
}

test('Drive HTTP diagnostics expose only status and exact allowlisted identifiers', async t => {
  for (const [body, reason] of [
    [{ error: { errors: [{ reason: 'accessNotConfigured', message: secret }], status: 'PERMISSION_DENIED', message: secret } }, 'accessNotConfigured'],
    [{ error: { errors: [{ reason: 'domainPolicy' }] } }, 'domainPolicy'],
    [{ error: { details: [{ reason: 'SERVICE_DISABLED', metadata: { url: secret } }] } }, 'SERVICE_DISABLED'],
    [{ error: { status: 'PERMISSION_DENIED', message: secret } }, 'PERMISSION_DENIED'],
    [{ error: { errors: [{ reason: secret }], status: secret, message: secret } }, undefined],
    [{ error: { errors: [{ reason: `accessNotConfigured ${secret}` }] } }, undefined],
    [{ error: { reason: 'accessNotConfigured', code: secret } }, undefined],
    [{ error: secret }, undefined], [null, undefined],
  ]) {
    const client = fixture(t, () => Response.json(body, { status: 403 }))
    await assert.rejects(client.listFiles(), { message: failure(403, reason) })
  }
})

test('Drive bounds error reads and hides malformed, stream, and network errors', async t => {
  for (const body of ['not json ' + secret, 'x'.repeat(16_385)]) {
    const client = fixture(t, () => new Response(body, { status: 502 }))
    await assert.rejects(client.listFiles(), { message: failure(502) })
  }
  let cancelled = false
  const client = fixture(t, () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(16_385)) },
    cancel() { cancelled = true },
  }), { status: 429 }))
  await assert.rejects(client.listFiles(), { message: failure(429) })
  assert.equal(cancelled, true)
  const broken = fixture(t, () => new Response(new ReadableStream({ start(c) { c.error(new Error(secret)) } }), { status: 503 }))
  await assert.rejects(broken.listFiles(), { message: failure(503) })
  const network = fixture(t, () => { throw new Error(secret) })
  await assert.rejects(network.listFiles(), { message: 'Google network request failed. Try again.' })
})

test('Drive abort and disposal interrupt stalled error bodies', async t => {
  for (const mode of ['abort', 'dispose', 'timeout']) {
    let entered
    const reading = new Promise(resolve => { entered = resolve })
    let cancelled = false
    const client = fixture(t, () => new Response(new ReadableStream({
      pull() { entered() }, cancel() { cancelled = true },
    }), { status: 403 }), { requestTimeoutMs: mode === 'timeout' ? 10 : 1000 })
    const controller = new AbortController()
    const pending = client.listFiles({ signal: controller.signal })
    const rejected = assert.rejects(pending, { message: 'Google operation was cancelled.' })
    await reading
    if (mode === 'abort') controller.abort()
    if (mode === 'dispose') client.dispose()
    await rejected
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(cancelled, true)
  }
})

test('Drive reconstructs only closed auth diagnostics and drops causes', async t => {
  for (const message of [failure(400, 'invalid_grant'), failure(503), 'Google network request failed. Try again.']) {
    const client = fixture(t, () => assert.fail('must not fetch'), {
      withAccessToken() { throw new Error(message, { cause: new Error(secret) }) },
    })
    await assert.rejects(client.listFiles(), error => { assert.equal(error.message, message); assert.equal(error.cause, undefined); return true })
  }
  for (const message of [failure(400, secret), failure(400, 'invalid_grant') + '\n' + secret, failure(400, 'unknown'), secret]) {
    const client = fixture(t, () => assert.fail('must not fetch'), { withAccessToken() { throw new Error(message) } })
    await assert.rejects(client.listFiles(), { message: 'Connect Google Drive in Settings → Plugins → Google accounts, then retry.' })
  }
})
