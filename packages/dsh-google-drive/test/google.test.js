import test from 'node:test'
import assert from 'node:assert/strict'
import * as metadata from '../src/google.js'
const { GoogleDriveClient } = metadata
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { resolve, promise } }
const file = { id: 'id', name: 'Notes', mimeType: 'text/plain' }
function fixture(t, options = {}) {
  const calls = []
  const tokens = []
  const client = new GoogleDriveClient({ ...options,
    withAccessToken: async operation => {
      tokens.push(true)
      const token = await (options.getAccessToken?.() ?? 'access-private')
      return operation(token, options.authSignal ?? new AbortController().signal)
    },
    fetch: (url, init) => { calls.push({ url, init }); return (options.fetch ?? (() => Response.json({ files: [file] })))(url, init) },
  })
  t.after(() => client.dispose())
  return { client, calls, tokens }
}

test('metadata module exports no OAuth or configuration API', () => {
  assert.deepEqual(Object.keys(metadata).sort(), ['DRIVE_SCOPE', 'GoogleDriveClient'])
  assert.deepEqual(Object.getOwnPropertyNames(GoogleDriveClient.prototype).sort(), ['constructor', 'dispose', 'listFiles'])
})

test('fixed endpoint, fields, default ten and mandatory nontrash filter', async t => {
  const { client, calls, tokens } = fixture(t)
  assert.deepEqual(await client.listFiles(), { files: [file] })
  const url = new URL(calls[0].url)
  assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/drive/v3/files')
  assert.equal(url.searchParams.get('pageSize'), '10')
  assert.equal(url.searchParams.get('q'), 'trashed = false')
  assert.equal(url.searchParams.get('fields'), 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed)')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer access-private')
  assert.equal(calls[0].init.redirect, 'error')
  await client.listFiles({ pageSize: 1, pageToken: 'a&key=b', query: "name contains 'Notes'" })
  const next = new URL(calls[1].url)
  assert.equal(next.searchParams.get('pageToken'), 'a&key=b')
  assert.equal(next.searchParams.get('q'), "trashed = false and (name contains 'Notes')")
  assert.equal(tokens.length, 2)
})

test('invalid bounded inputs never request authentication', async t => {
  const { client, tokens } = fixture(t)
  for (const args of [{ pageSize: 0 }, { pageSize: 101 }, { pageSize: 1.5 }, { query: 3 },
    { query: 'x'.repeat(4097) }, { pageToken: '' }, { pageToken: 'x'.repeat(4097) }, { signal: {} }]) {
    await assert.rejects(client.listFiles(args), /Invalid/)
  }
  await assert.rejects(client.listFiles({ signal: AbortSignal.abort() }), /cancelled/)
  assert.equal(tokens.length, 0)
})

test('projects bounded metadata, excludes trash and unsafe links', async t => {
  const links = ['https://drive.google.com/file/d/id/view', 'https://docs.google.com/document/d/id/edit',
    'javascript:alert(1)', 'http://drive.google.com/file', 'https://drive.google.com.attacker.invalid/file',
    'https://attacker.invalid/', 'https://user:password@drive.google.com/file', 'https://drive.google.com:8443/file', 'not a URL']
  const { client } = fixture(t, { fetch: () => Response.json({ nextPageToken: 'next', secret: 'omit', files: [
    ...links.map(webViewLink => ({ ...file, webViewLink, arbitrary: 'omit' })), { ...file, trashed: true },
  ] }) })
  const result = await client.listFiles()
  assert.equal(result.files.length, 9)
  assert.equal(result.nextPageToken, 'next')
  assert.equal(result.secret, undefined)
  assert.equal(result.files[0].webViewLink, links[0])
  assert.equal(result.files[1].webViewLink, links[1])
  assert.ok(result.files.slice(2).every(value => !Object.hasOwn(value, 'webViewLink')))
  assert.ok(result.files.every(value => !Object.hasOwn(value, 'arbitrary')))
})

test('bounds response shape and sanitizes transport, body, timeout and auth errors', async t => {
  for (const fetch of [
    () => Response.json({ error: 'private' }, { status: 400 }),
    () => new Response('x'.repeat(1_048_577)), () => new Response('invalid private'),
    () => { throw new Error('https://private/?token=secret') },
    () => new Promise(() => {}),
    () => new Response(new ReadableStream({ start() {} })),
  ]) {
    const { client } = fixture(t, { fetch, requestTimeoutMs: 10 })
    await assert.rejects(client.listFiles(), error => {
      assert.ok(['Google request failed. Try again or reconnect.', 'Google operation was cancelled.'].includes(error.message))
      return true
    })
  }
  for (const result of [null, {}, { files: [null] }, { files: Array(11).fill(file) }, { files: [], nextPageToken: 'x'.repeat(4097) }]) {
    const { client } = fixture(t, { fetch: () => Response.json(result) })
    await assert.rejects(client.listFiles(), /Invalid Google Drive response/)
  }
  const { client, calls } = fixture(t, { getAccessToken() { throw new Error('secret') } })
  await assert.rejects(client.listFiles(), { message: 'Connect Google Drive in Settings → Plugins → Google accounts, then retry.' })
  assert.equal(calls.length, 0)
})

test('caller abort and disposal cancel token waits without cancelling shared authentication', async t => {
  for (const mode of ['abort', 'dispose']) {
    const gate = deferred()
    const { client, calls } = fixture(t, { getAccessToken: () => gate.promise })
    const controller = new AbortController()
    const pending = client.listFiles({ signal: controller.signal })
    const rejected = assert.rejects(pending, /cancelled/)
    await Promise.resolve()
    if (mode === 'abort') controller.abort()
    else client.dispose()
    await rejected
    gate.resolve('still-valid')
    assert.equal(await gate.promise, 'still-valid')
    assert.equal(calls.length, 0)
  }
})

test('account lifetime cancellation rejects delayed old-account metadata and aborts transport', async t => {
  const auth = new AbortController()
  const entered = deferred()
  const response = deferred()
  let transportSignal
  const { client } = fixture(t, { authSignal: auth.signal, fetch: (_url, { signal }) => {
    transportSignal = signal
    entered.resolve()
    return response.promise
  } })
  const listing = client.listFiles()
  const rejected = assert.rejects(listing, /cancelled/)
  await entered.promise
  auth.abort()
  await rejected
  assert.equal(transportSignal.aborted, true)
  response.resolve(Response.json({ files: [{ ...file, name: 'old-account-private' }] }))
  await assert.rejects(client.listFiles(), /cancelled/)
})

test('caller abort and disposal cancel metadata requests even if transport ignores abort', async t => {
  for (const mode of ['abort', 'dispose']) {
    const entered = deferred()
    let fetchSignal
    const { client } = fixture(t, { fetch: (_url, { signal }) => {
      fetchSignal = signal; entered.resolve(); return new Promise(() => {})
    } })
    const controller = new AbortController()
    const pending = client.listFiles({ signal: controller.signal })
    const rejected = assert.rejects(pending, /cancelled/)
    await entered.promise
    if (mode === 'abort') controller.abort()
    else client.dispose()
    await rejected
    assert.equal(fetchSignal.aborted, true)
  }
})
