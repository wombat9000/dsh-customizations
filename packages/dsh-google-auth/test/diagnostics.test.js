import test from 'node:test'
import assert from 'node:assert/strict'
import { GoogleOAuthClient } from '../src/oauth.js'

const secret = 'https://private.invalid/?access_token=private-token'
const endpoint = 'https://oauth2.googleapis.com/token'
const failure = (status, code) => `Google request failed (HTTP ${status})${code ? `: ${code}` : ''}. Try again or reconnect.`
function fixture(t, fetch, options = {}) {
  const client = new GoogleOAuthClient({ clientId: 'synthetic-client',
    credentials: { async get() { return null }, async set() {}, async delete() {} }, fetch, ...options })
  t.after(() => client.dispose())
  return client
}

test('auth HTTP diagnostics expose only status and exact allowlisted codes', async t => {
  for (const [body, code] of [
    [{ error: 'invalid_grant', error_description: secret, error_uri: secret }, 'invalid_grant'],
    [{ error: 'invalid_client', error_description: secret }, 'invalid_client'],
    [{ error: { status: 'UNAUTHENTICATED', message: secret } }, 'UNAUTHENTICATED'],
    [{ error: { details: [{ reason: 'PERMISSION_DENIED', metadata: { url: secret } }] } }, 'PERMISSION_DENIED'],
    [{ error: `invalid_grant ${secret}`, error_description: secret }, undefined],
    [{ error: secret }, undefined],
    [{ error: { status: secret, errors: [{ reason: secret }], message: secret } }, undefined],
    [null, undefined],
  ]) {
    const client = fixture(t, () => Response.json(body, { status: 400 }))
    await assert.rejects(client.request(endpoint), { message: failure(400, code) })
  }
  const client = fixture(t, () => Response.json({ error: 'invalid_token', error_description: secret }, { status: 400 }))
  await assert.rejects(client.request('https://oauth2.googleapis.com/revoke', {}, undefined, true), { message: failure(400) })
})

test('auth bounds error reads and sanitizes malformed, stream, and network failures', async t => {
  for (const body of ['not json ' + secret, 'x'.repeat(16_385)]) {
    const client = fixture(t, () => new Response(body, { status: 502 }))
    await assert.rejects(client.request(endpoint), { message: failure(502) })
  }
  let cancelled = false
  const client = fixture(t, () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(16_385)) },
    cancel() { cancelled = true },
  }), { status: 429 }))
  await assert.rejects(client.request(endpoint), { message: failure(429) })
  assert.equal(cancelled, true)
  const broken = fixture(t, () => new Response(new ReadableStream({ start(c) { c.error(new Error(secret)) } }), { status: 503 }))
  await assert.rejects(broken.request(endpoint), { message: failure(503) })
  const network = fixture(t, () => { throw new Error(secret) })
  await assert.rejects(network.request(endpoint), { message: 'Google network request failed. Try again.' })
})

test('auth preserves cancellation semantics while reading stalled error bodies', async t => {
  for (const mode of ['abort', 'dispose', 'timeout']) {
    let entered
    const reading = new Promise(resolve => { entered = resolve })
    let cancelled = false
    const client = fixture(t, () => new Response(new ReadableStream({
      pull() { entered() }, cancel() { cancelled = true },
    }), { status: 403 }), { requestTimeoutMs: mode === 'timeout' ? 10 : 1000 })
    const controller = new AbortController()
    const pending = client.request(endpoint, {}, controller.signal)
    const rejected = assert.rejects(pending, { message: 'Google request failed. Try again or reconnect.' })
    await reading
    if (mode === 'abort') controller.abort()
    if (mode === 'dispose') await client.dispose()
    await rejected
    assert.equal(cancelled, true)
  }
})
