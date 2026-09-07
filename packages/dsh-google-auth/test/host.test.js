import assert from 'node:assert/strict'
import test from 'node:test'
import { GoogleDriveClient } from '../../dsh-google-drive/src/google.js'
import { GoogleAuthService, CLIENT_KEY, CREDENTIAL_KEY, credentialAdapter, parseClientJson } from '../src/index.js'

const scope = 'https://www.googleapis.com/auth/drive.metadata.readonly'
const otherScope = 'https://www.googleapis.com/auth/calendar.readonly'
const clientId = 'fixture.apps.googleusercontent.com'
const clientJson = JSON.stringify({ installed: { client_id: clientId, client_secret: 'FIXTURE-SECRET', auth_uri: 'https://attacker.invalid' } })
const tokens = { accessToken: 'FIXTURE-ACCESS', refreshToken: 'FIXTURE-REFRESH', expiresAt: 9999999999999, scopes: [scope], account: { id: 'account-1', email: 'fixture@example.invalid' } }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function fixture(overrides = {}) {
  const records = new Map([[CLIENT_KEY, { kind: 'grant', payload: { version: 1, clientId, clientSecret: 'FIXTURE-SECRET' } }]])
  const reads = [], calls = [], clients = []
  const credentials = {
    async readRecord(key) { reads.push(key); return records.get(key) },
    async modifyRecord(key, fn) { const value = await fn(records.get(key)); if (value === undefined) records.delete(key); else records.set(key, value); return value },
    async deleteRecord(key) { records.delete(key) },
  }
  const service = new GoogleAuthService({ credentials, createClient(options) {
    const client = {
      options,
      async status() { return { configured: true, connected: true, pending: false, grantedScopes: [scope], account: { ...tokens.account, secret: 'HIDDEN' }, accessToken: 'HIDDEN', ...overrides.status } },
      async getAccessToken(args) { calls.push(['token', args]); return overrides.token ? overrides.token(args) : 'FIXTURE-ACCESS' },
      async begin(args) { calls.push(['begin', args]); return overrides.begin ? overrides.begin(args) : { authorizationUrl: 'https://accounts.google.com/fixture', expiresAt: 42 } },
      cancel() { calls.push(['cancel']); return overrides.cancel ?? true },
      dispose() { calls.push(['dispose']) },
    }
    clients.push(client); return client
  } })
  return { service, records, credentials, reads, calls, clients }
}
const register = (service, id = 'drive', scopes = [scope]) => service.registerIntegration({ id, label: id, scopes })

test('non-secret access generation invalidates observers on reconnect, reset and disposal', async () => {
  const f = fixture()
  register(f.service, 'drive')
  const seen = []
  const removeThrowing = f.service.onAccessChange(() => { throw new Error('observer failure') })
  const remove = f.service.onAccessChange(() => seen.push(f.service.getAccessGeneration()))
  assert.equal(f.service.getAccessGeneration(), 0)
  await f.service.begin('drive')
  await f.service.disconnect()
  assert.deepEqual(seen, [1, 2])
  remove(); removeThrowing()
  f.service.dispose()
  assert.equal(f.service.getAccessGeneration(), 3)
  assert.deepEqual(seen, [1, 2])
  assert.throws(() => f.service.onAccessChange(() => {}), /unavailable/)
})

test('registry canonicalizes email aliases for missing permission comparisons and rejects sparse scopes', async () => {
  const email = 'https://www.googleapis.com/auth/userinfo.email'
  const f = fixture({ status: { grantedScopes: [email] } })
  register(f.service, 'identity', ['email', email])
  assert.deepEqual(f.service.integration('identity').scopes, [email])
  const integration = (await f.service.status()).integrations[0]
  assert.equal(integration.authorized, true)
  assert.deepEqual(integration.missingScopes, [])
  for (const scopes of [new Array(1), [scope, , scope]]) assert.throws(() => register(f.service, 'sparse', scopes), /explicit Google permission scopes/)
})

test('actual Drive fetch aborts on shared auth disconnect and cannot return old account metadata', async t => {
  const f = fixture(), started = deferred(), release = deferred()
  register(f.service, 'google-drive')
  let fetchSignal
  const drive = new GoogleDriveClient({ withAccessToken: operation => f.service.withAccessToken('google-drive', operation), fetch: async (_url, init) => {
    fetchSignal = init.signal
    assert.equal(init.headers.Authorization, 'Bearer FIXTURE-ACCESS')
    started.resolve()
    await release.promise // Deliberately ignore abort to test late-result suppression.
    return Response.json({ files: [{ id: 'old-account', name: 'PRIVATE OLD METADATA', mimeType: 'text/plain' }] })
  } })
  t.after(() => { release.resolve(); drive.dispose(); f.service.dispose() })
  const result = drive.listFiles()
  const rejected = assert.rejects(result, /cancelled/)
  await started.promise
  await f.service.disconnect()
  assert.equal(fetchSignal.aborted, true)
  await rejected // Rejects even before the uncooperative fetch returns.
  release.resolve()
  assert.equal(f.service.accessOperations.size, 0)
})

test('unregister aborts only matching operations while other integrations remain active', async () => {
  const f = fixture(), driveStarted = deferred(), calendarStarted = deferred(), release = deferred()
  const remove = register(f.service)
  register(f.service, 'calendar', [otherScope])
  let driveSignal, calendarSignal
  const drive = f.service.withAccessToken('drive', async (_token, signal) => { driveSignal = signal; driveStarted.resolve(); await release.promise; return 'old drive' })
  const rejected = assert.rejects(drive, /cancelled/)
  const calendar = f.service.withAccessToken('calendar', async (_token, signal) => { calendarSignal = signal; calendarStarted.resolve(); await release.promise; return 'calendar metadata' })
  await Promise.all([driveStarted.promise, calendarStarted.promise])
  remove()
  assert.equal(driveSignal.aborted, true)
  assert.equal(calendarSignal.aborted, false)
  await rejected
  assert.equal(f.service.accessOperations.size, 1)
  release.resolve()
  assert.equal(await calendar, 'calendar metadata')
  assert.equal(calendarSignal.aborted, true, 'completed signal is revoked')
  assert.equal(f.service.accessOperations.size, 0)
})

test('host operation completion and callback errors revoke signals and clean tracking', async () => {
  const f = fixture()
  register(f.service)
  let failedSignal, completedSignal
  const failure = Error('fixture callback failure')
  await assert.rejects(f.service.withAccessToken('drive', (_token, signal) => { failedSignal = signal; throw failure }), error => error === failure)
  assert.equal(failedSignal.aborted, true)
  assert.equal(f.service.accessOperations.size, 0)
  assert.deepEqual(await f.service.withAccessToken('drive', (token, signal) => { assert.equal(token, 'FIXTURE-ACCESS'); completedSignal = signal; return { metadata: true } }), { metadata: true })
  assert.equal(completedSignal.aborted, true)
  assert.equal(f.service.accessOperations.size, 0)
  await assert.rejects(f.service.withAccessToken('drive', null), /host operation/)
  await assert.rejects(f.service.withAccessToken('unknown', () => assert.fail('unknown operation ran')), /not registered/)
  assert.equal(f.service.accessOperations.size, 0)
})

for (const action of ['configure', 'clearConfig', 'begin', 'dispose']) test(`${action} cancels account-bound operations and suppresses late results`, async () => {
  const f = fixture(), started = deferred(), release = deferred()
  register(f.service)
  let signal
  const result = f.service.withAccessToken('drive', async (_token, authSignal) => { signal = authSignal; started.resolve(); await release.promise; return 'STALE' })
  const rejected = assert.rejects(result, /cancelled/)
  await started.promise
  if (action === 'configure') await f.service.configure(clientJson)
  else if (action === 'begin') await f.service.begin('drive')
  else await f.service[action]()
  assert.equal(signal.aborted, true)
  await rejected
  release.resolve()
  assert.equal(f.service.accessOperations.size, 0)
})

test('integration registration is pure, validated, bounded, immutable and uniquely owned', () => {
  const f = fixture()
  const scopes = [scope, scope]
  const remove = register(f.service, 'drive', scopes)
  scopes.push(otherScope)
  assert.deepEqual(f.reads, [])
  assert.deepEqual(f.clients, [])
  assert.deepEqual(f.service.integration('drive').scopes, [scope])
  assert.throws(() => register(f.service), /already registered/)
  for (const value of [null, {}, { id: '../drive', label: 'x', scopes: [scope] }, { id: 'x', label: '', scopes: [scope] }, { id: 'x', label: 'x', scopes: [] }, { id: 'x', label: 'x', scopes: ['https://attacker.invalid'] }]) assert.throws(() => f.service.registerIntegration(value))
  remove(); remove()
  register(f.service)
  remove() // Old disposer cannot unregister a new registration with the same ID.
  assert.equal(f.service.integration('drive').id, 'drive')
  for (let i = 0; i < 31; i++) register(f.service, `integration-${i}`)
  assert.throws(() => register(f.service, 'overflow'), /limit/)
  f.service.dispose()
  assert.throws(() => register(f.service), /stopped/)
})

test('status derives per-integration missing permissions and projects only account leaves', async () => {
  const f = fixture()
  register(f.service)
  register(f.service, 'calendar', [otherScope, scope])
  assert.deepEqual(await f.service.status(), {
    configured: true, connected: true, pending: false, useSandbox: false, sandboxAvailable: false, account: tokens.account,
    integrations: [
      { id: 'drive', label: 'drive', scopes: [scope], authorized: true, missingScopes: [] },
      { id: 'calendar', label: 'calendar', scopes: [otherScope, scope].sort(), authorized: false, missingScopes: [otherScope] },
    ],
  })
  const disconnected = fixture({ status: { connected: false, grantedScopes: [scope] } })
  register(disconnected.service)
  assert.deepEqual((await disconnected.service.status()).integrations[0].missingScopes, [scope])
  disconnected.records.clear()
})

test('scoped tokens and consent accept exact registered IDs only, never caller scopes', async () => {
  const f = fixture()
  const remove = register(f.service)
  for (const id of [undefined, null, 'unknown', { integrationId: 'drive', scopes: [otherScope] }, [scope]]) await assert.rejects(f.service.getAccessToken(id), /not registered/)
  assert.equal(f.reads.length, 0)
  assert.equal(await f.service.getAccessToken('drive'), 'FIXTURE-ACCESS')
  await f.service.begin('drive')
  assert.deepEqual(f.calls, [['token', { scopes: [scope] }], ['begin', { scopes: [scope] }]])
  remove()
  await assert.rejects(f.service.getAccessToken('drive'), /not registered/)
  await assert.rejects(f.service.begin('drive'), /not registered/)
  assert.deepEqual(f.calls.at(-1), ['cancel'])
})

test('inflight token cannot escape after unregistration or replacement', async () => {
  const gate = deferred(), started = deferred()
  const f = fixture({ token: () => { started.resolve(); return gate.promise } })
  const remove = register(f.service)
  const request = f.service.getAccessToken('drive')
  await started.promise
  remove(); register(f.service)
  gate.resolve('STALE-TOKEN')
  await assert.rejects(request, /changed/)
})

test('inflight consent rejects removal and cancels pending OAuth', async () => {
  const gate = deferred(), started = deferred()
  const f = fixture({ begin: () => { started.resolve(); return gate.promise } })
  const remove = register(f.service)
  const request = f.service.begin('drive')
  await started.promise; remove(); gate.resolve({ authorizationUrl: 'https://accounts.google.com/fixture' })
  await assert.rejects(request, /changed/)
  assert.deepEqual(f.calls.at(-1), ['cancel'])
})

test('configuration is write-only, separates client and grant keys, and invalidates generations', async () => {
  const f = fixture()
  register(f.service)
  await f.service.getAccessToken('drive')
  const old = f.clients[0].options.credentials
  await old.set(tokens)
  assert.notEqual(CLIENT_KEY, CREDENTIAL_KEY)
  assert.deepEqual(await old.get(), tokens)
  assert.deepEqual(await f.service.configure(clientJson), {})
  assert.equal(f.records.has(CREDENTIAL_KEY), false)
  assert.deepEqual(f.records.get(CLIENT_KEY), { kind: 'grant', payload: { version: 1, clientId, clientSecret: 'FIXTURE-SECRET' } })
  await assert.rejects(old.set(tokens), /Could not save/)
  await assert.rejects(old.get(), /Could not read/)
  assert.equal(f.records.has(CREDENTIAL_KEY), false)
  assert.deepEqual(parseClientJson(clientJson), { clientId, clientSecret: 'FIXTURE-SECRET' })
  for (const value of ['bad', '{}', JSON.stringify({ web: { client_id: clientId } }), 'x'.repeat(32769)]) await assert.rejects(f.service.configure(value), /Desktop OAuth/)
  assert.equal(JSON.stringify(await f.service.status()).includes('FIXTURE-SECRET'), false)
})

test('a client configuration read already in flight cannot publish an obsolete client', async () => {
  const f = fixture(), entered = deferred(), release = deferred()
  register(f.service)
  const oldRecord = f.records.get(CLIENT_KEY)
  f.credentials.readRecord = async () => { entered.resolve(); await release.promise; return oldRecord }
  const loading = f.service.getAccessToken('drive')
  const rejection = assert.rejects(loading, /configuration changed/)
  await entered.promise
  const configuring = f.service.configure(clientJson)
  // configure is queued through the service mutation barrier.
  await Promise.resolve()
  release.resolve()
  await rejection; await configuring
  assert.equal(f.clients.length, 0)
  assert.equal(f.records.get(CLIENT_KEY).payload.clientId, clientId)
})

test('pending status names the integration and successful cancel clears it', async () => {
  const f = fixture({ status: { pending: true } })
  register(f.service)
  await f.service.begin('drive')
  assert.equal((await f.service.status()).pendingIntegrationId, 'drive')
  assert.deepEqual(await f.service.cancel(), {})
  assert.equal((await f.service.status()).pendingIntegrationId, undefined)
})

test('disconnect removes the whole grant for all integrations but preserves client configuration', async () => {
  const f = fixture()
  register(f.service); register(f.service, 'calendar', [otherScope])
  await f.service.getAccessToken('drive')
  await f.clients[0].options.credentials.set({ ...tokens, scopes: [scope, otherScope] })
  assert.deepEqual(await f.service.disconnect(), {})
  assert.deepEqual([...f.records.keys()], [CLIENT_KEY])
  assert.equal(f.service.integrations.size, 2)
  assert.deepEqual(await f.service.clearConfig(), {})
  assert.equal(f.records.size, 0)
})

test('cancel refused during commit is an error and preserves pending integration', async () => {
  const f = fixture({ cancel: false })
  register(f.service); await f.service.begin('drive')
  await assert.rejects(f.service.cancel(), /finishing/)
  assert.equal(f.service.pendingIntegrationId, 'drive')
})

test('credential adapter rejects wrong clients and malformed grant envelopes', async () => {
  const f = fixture(), adapter = credentialAdapter(f.credentials, clientId)
  for (const record of [undefined, { kind: 'secret', payload: { version: 1, clientId, tokens } }, { kind: 'grant', payload: { version: 2, clientId, tokens } }, { kind: 'grant', payload: { version: 1, clientId: 'other.apps.googleusercontent.com', tokens } }]) {
    f.records.set(CREDENTIAL_KEY, record)
    assert.equal(await adapter.get(), undefined)
  }
  f.records.delete(CREDENTIAL_KEY)
  let valid = true
  const entered = deferred(), release = deferred()
  f.credentials.modifyRecord = async (key, fn) => { entered.resolve(); await release.promise; const record = await fn(); f.records.set(key, record) }
  const saving = adapter.set(tokens, () => valid)
  await entered.promise; valid = false; release.resolve()
  await assert.rejects(saving, /Could not save/)
  assert.notDeepEqual(f.records.get(CREDENTIAL_KEY)?.payload?.tokens, tokens)
})

test('credential storage errors and invalid client grants never leak provider secrets', async () => {
  const secret = 'PRIVATE-PROVIDER-DETAIL'
  const provider = { readRecord() { throw Error(secret) }, modifyRecord() { throw Error(secret) }, deleteRecord() { throw Error(secret) } }
  const adapter = credentialAdapter(provider, clientId)
  for (const operation of [() => adapter.get(), () => adapter.set(tokens), () => adapter.delete()]) await assert.rejects(operation(), error => !error.message.includes(secret))
  const f = fixture()
  register(f.service)
  for (const record of [undefined, { kind: 'secret' }, { kind: 'grant', payload: { version: 1, clientId: 'invalid', clientSecret: secret } }]) {
    f.records.set(CLIENT_KEY, record)
    const status = await f.service.status()
    assert.equal(status.configured, false)
    assert.equal(status.integrations[0].authorized, false)
    assert.equal(JSON.stringify(status).includes(secret), false)
  }
  assert.equal(f.clients.length, 0)
})
