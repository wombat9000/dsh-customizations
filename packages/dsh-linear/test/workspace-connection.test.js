import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EMPTY_LINEAR_SETTINGS,
  LINEAR_CREDENTIAL_REF,
  registerLinearSettingsRpc,
} from '../dist/src/settings.js'
import { createLinearWorkspaceConnection } from '../dist/src/workspace-connection.js'

const bound = {
  organizationId: 'previous-org',
  organizationName: 'Previous workspace',
  organizationUrlKey: 'previous',
}
const workspace = { id: 'next-org', name: 'Next workspace', urlKey: 'next' }
const viewer = { id: 'viewer', name: 'Ada' }

function fixture(overrides = {}) {
  let key = 'previous-key'
  let settings = { ...bound }
  const attempts = { probe: 0, set: 0, unset: 0, write: 0 }
  const failure = new Error('fixture persistence failure')
  const credentials = {
    describe: async () => ({ configured: key !== undefined, writable: true, source: 'store' }),
    async set(value) {
      attempts.set += 1
      if (overrides.fail === 'set') throw failure
      key = value
    },
    async unset() {
      attempts.unset += 1
      if (overrides.fail === 'unset') throw failure
      key = undefined
    },
  }
  const connection = createLinearWorkspaceConnection({
    readSettings: () => settings,
    emptySettings: EMPTY_LINEAR_SETTINGS,
    async writeSettings(patch) {
      attempts.write += 1
      if (overrides.fail === 'write') throw failure
      settings = { ...settings, ...patch }
    },
    getCredentials: () => credentials,
    loadWorkspace: async () => ({ workspace, viewer, teams: [{ id: 'team' }] }),
    createClient() {
      attempts.probe += 1
      if (overrides.fail === 'probe') throw failure
      return { organization: Promise.resolve(workspace), viewer: Promise.resolve(viewer) }
    },
    ...overrides,
  })
  return { connection, attempts, failure, snapshot: () => ({ key, settings }) }
}

// Existing RPC tests own ordinary status and initial environment-key binding.
// These cases own failure boundaries, source policy, and runtime delegation.
test('connect waits for both identities before storing and projects only public fields', async () => {
  const started = Promise.withResolvers()
  const organization = Promise.withResolvers()
  const identity = Promise.withResolvers()
  const signal = new AbortController().signal
  const { connection, snapshot } = fixture({
    createClient(apiKey, receivedSignal) {
      assert.equal(apiKey, 'next-key')
      assert.equal(receivedSignal, signal)
      started.resolve()
      return { organization: organization.promise, viewer: identity.promise }
    },
  })
  const pending = connection.connect('  next-key  ', signal)
  await started.promise
  organization.resolve({ ...workspace, apiKey: 'organization-secret' })
  await Promise.resolve()
  assert.deepEqual(snapshot(), { key: 'previous-key', settings: bound })
  identity.resolve({ ...viewer, apiKey: 'viewer-secret', accessToken: 'private-token' })
  const result = await pending
  assert.deepEqual(result, {
    credential: { configured: true, writable: true, source: 'store' },
    workspace,
    viewer,
    live: true,
  })
  assert.deepEqual(snapshot(), {
    key: 'next-key',
    settings: {
      organizationId: 'next-org',
      organizationName: 'Next workspace',
      organizationUrlKey: 'next',
    },
  })
})

for (const fail of ['probe', 'set', 'write']) {
  test(`connect preserves the ${fail} failure boundary without retries or rollback`, async () => {
    const { connection, attempts, failure, snapshot } = fixture({ fail })
    await assert.rejects(connection.connect('next-key'), (error) => error === failure)
    assert.deepEqual(snapshot(), {
      key: fail === 'write' ? 'next-key' : 'previous-key',
      settings: bound,
    })
    assert.deepEqual(attempts, {
      probe: 1,
      set: fail === 'probe' ? 0 : 1,
      unset: 0,
      write: fail === 'write' ? 1 : 0,
    })
  })
}

for (const fail of ['unset', 'write']) {
  test(`disconnect preserves the ${fail} failure boundary without retries or rollback`, async () => {
    const { connection, attempts, failure, snapshot } = fixture({ fail })
    await assert.rejects(connection.disconnect(), (error) => error === failure)
    assert.deepEqual(snapshot(), {
      key: fail === 'unset' ? 'previous-key' : undefined,
      settings: bound,
    })
    assert.deepEqual(attempts, { probe: 0, set: 0, unset: 1, write: fail === 'write' ? 1 : 0 })
  })
}

test('source guards reject replacement and removal before probing or persistence', async () => {
  const scenarios = [
    {
      literalApiKey: 'composition-key',
      getCredentials: () => assert.fail('Composition must not access the credential provider'),
      connectValue: undefined,
      message: 'The Linear key is fixed by the composition',
      statusCredential: { configured: true, writable: false, source: 'composition' },
    },
    {
      getCredentials: () => ({
        describe: async () => ({ configured: true, writable: false, source: 'env' }),
      }),
      connectValue: 'next-key',
      message: 'LINEAR_API_KEY is supplied by a read-only source',
      statusCredential: { configured: true, writable: false, source: 'env' },
    },
    {
      getCredentials: () => undefined,
      connectValue: 'next-key',
      message: 'DSH credential storage is unavailable.',
      statusCredential: { configured: false, writable: false },
    },
  ]
  for (const scenario of scenarios) {
    const { connection, attempts, snapshot } = fixture(scenario)
    assert.deepEqual((await connection.status()).credential, scenario.statusCredential)
    await assert.rejects(connection.connect(scenario.connectValue), {
      message:
        scenario.message === 'DSH credential storage is unavailable.'
          ? scenario.message
          : `${scenario.message} and cannot be replaced here.`,
    })
    await assert.rejects(connection.disconnect(), {
      message:
        scenario.message === 'DSH credential storage is unavailable.'
          ? scenario.message
          : `${scenario.message} and cannot be removed here.`,
    })
    assert.deepEqual(attempts, { probe: 0, set: 0, unset: 0, write: 0 })
    assert.deepEqual(snapshot(), { key: 'previous-key', settings: bound })
  }
})

test('test delegates the signal and never rewrites an existing binding or exposes teams', async () => {
  const signal = new AbortController().signal
  const { connection, attempts, snapshot } = fixture({
    async loadWorkspace(receivedSignal) {
      assert.equal(receivedSignal, signal)
      return { workspace, viewer, teams: [{ id: 'team' }] }
    },
  })
  assert.deepEqual(await connection.test(signal), {
    credential: { configured: true, writable: true, source: 'store' },
    workspace,
    viewer,
    live: true,
  })
  assert.equal(attempts.write, 0)
  assert.deepEqual(snapshot(), { key: 'previous-key', settings: bound })
})

test('aborted provider probe rejects before storing or binding the candidate key', async () => {
  const controller = new AbortController()
  const started = Promise.withResolvers()
  const failure = new Error('cancelled probe')
  const { connection, attempts, snapshot } = fixture({
    createClient(_apiKey, signal) {
      assert.equal(signal, controller.signal)
      const organization = new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      started.resolve()
      return { organization, viewer: Promise.resolve(viewer) }
    },
  })
  const pending = connection.connect('next-key', controller.signal)
  await started.promise
  controller.abort(failure)
  await assert.rejects(pending, (error) => error === failure)
  assert.equal(attempts.set, 0)
  assert.equal(attempts.write, 0)
  assert.deepEqual(snapshot(), { key: 'previous-key', settings: bound })
})

test('RPC scopes lazy credential effects and reports missing persistence in the existing envelope', async () => {
  let handler
  let credentials
  let storedKey
  let settings = { ...bound }
  let storageAvailable = false
  const ctx = {
    get(name) {
      if (name === 'connection')
        return {
          rpc: {
            handle(channel, callback, options) {
              assert.equal(channel, '/linear-integration')
              assert.deepEqual(options, { authority: 'trusted-host' })
              handler = callback
              return () => {}
            },
          },
        }
      if (name === 'credentials') return credentials
      if (name === 'settings' && storageAvailable)
        return {
          async update(namespace, patch) {
            assert.equal(namespace, 'local-linear')
            settings = { ...settings, ...patch }
          },
        }
    },
    effect(install) {
      install()
    },
  }
  registerLinearSettingsRpc(ctx, {
    settings: () => settings,
    runtime: {
      createClient: () => ({
        organization: Promise.resolve(workspace),
        viewer: Promise.resolve(viewer),
      }),
    },
  })
  credentials = {
    async describe(ref) {
      assert.equal(ref, LINEAR_CREDENTIAL_REF)
      return { configured: storedKey !== undefined, writable: true }
    },
    async set(ref, value) {
      assert.equal(ref, LINEAR_CREDENTIAL_REF)
      storedKey = value
    },
    async unset(ref) {
      assert.equal(ref, LINEAR_CREDENTIAL_REF)
      storedKey = undefined
    },
  }
  assert.deepEqual(await handler('connect', { apiKey: 'next-key' }), {
    ok: false,
    error: {
      code: 'linear-settings-error',
      message: 'DSH settings storage is unavailable.',
      details: {},
    },
  })
  assert.equal(storedKey, 'next-key')
  assert.deepEqual(settings, bound)
  storageAvailable = true
  assert.deepEqual(await handler('disconnect'), {
    ok: true,
    value: {
      credential: { configured: false, writable: true },
      workspace: null,
      viewer: null,
      live: false,
    },
  })
  assert.equal(storedKey, undefined)
  assert.deepEqual(settings, EMPTY_LINEAR_SETTINGS)
})
