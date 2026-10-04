import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, findPackageJSON } from 'node:module'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { installed } from '../../dsh-google-auth/test/profile-fixture.js'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const piManifest = findPackageJSON(
  '@earendil-works/pi-ai',
  cli.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json'),
)
// pi-ai's exports are import-only. Locate this installed copy through its manifest,
// then import its public entry point, which exports createModels.
const { createModels } = await import(
  pathToFileURL(join(dirname(piManifest), 'dist/index.js')).href
)
const { default: AuthorizationService } = await installed('@deepseek-ai/dsh-authorization')
const { default: CredentialsLocal, parseCredentialsDocument } = await installed(
  '@deepseek-ai/dsh-credentials-local',
)
const { credentialKey } = await installed('@deepseek-ai/dsh-credentials')
const { default: LlmRuntime } = await installed('@deepseek-ai/dsh-llm')
const pi = await installed('@deepseek-ai/dsh-llm-pi-ai')

function gate() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function bounded(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out: ${label}`)), 3000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

// Primary owner: the installed DSH/pi authorization-to-persistence boundary.
// Existing helper tests use synthetic flows and cannot expose this native bridge risk.
// This deliberately records a limitation, not a fix: pi 0.87.1 passes { signal }
// to CredentialStore.modify, but DSH 0.2.0-rc.2 drops that argument. A queued write
// admitted before cancellation can therefore replace the grant after "cancelled".
// Only public provider OAuth login results are synthetic; Models.login, the native
// registered flow, AuthorizationService, record locking, and disk writes remain real.
test(
  'native cancelled Codex login can commit an already-admitted queued replacement',
  { timeout: 15000 },
  async (t) => {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'codex-native-auth-boundary-')))
    const path = join(home, '.credentials.yaml')
    const ctx = new Context()
    const key = credentialKey('llm-pi-ai', 'openai-codex')
    const previous = {
      kind: 'grant',
      payload: { type: 'oauth', access: 'synthetic-old', refresh: 'synthetic-old-refresh' },
    }
    const replacement = {
      type: 'oauth',
      access: 'synthetic-replacement',
      refresh: 'synthetic-replacement-refresh',
      expires: 4102444800000,
      accountId: 'synthetic-account',
    }
    const controller = new AbortController()
    const locked = gate()
    const release = gate()
    const queued = gate()
    const mocks = []
    const patchedAuth = new Set()
    let holder
    let attempt
    let nativeWrite
    let loginSignal
    let loginCalls = 0
    let fetchCalls = 0
    let updates = 0
    const disk = async () => parseCredentialsDocument(await readFile(path, 'utf8'), path)

    try {
      mocks.push(
        t.mock.method(globalThis, 'fetch', () => {
          fetchCalls++
          throw new Error('network is forbidden in the native auth boundary test')
        }),
      )
      assert.equal(JSON.parse(await readFile(piManifest, 'utf8')).version, '0.87.1')
      assert.equal(
        JSON.parse(await readFile(cli.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json'), 'utf8'))
          .version,
        '0.2.0-rc.2',
      )

      // Provider factories construct fresh auth objects. Observe the public Models
      // registration method and patch only each existing Codex OAuth login method.
      // Registration itself still runs unchanged; no native flow/bridge is copied.
      const modelsPrototype = Object.getPrototypeOf(createModels())
      const register = modelsPrototype.setProvider
      mocks.push(
        t.mock.method(modelsPrototype, 'setProvider', function (provider) {
          if (provider.id === 'openai-codex') {
            const auth = provider.auth.oauth
            assert.equal(typeof auth?.login, 'function')
            if (!patchedAuth.has(auth)) {
              patchedAuth.add(auth)
              mocks.push(
                t.mock.method(auth, 'login', async (interaction) => {
                  loginCalls++
                  loginSignal = interaction.signal
                  loginSignal.throwIfAborted()
                  return replacement
                }),
              )
            }
          }
          return register.call(this, provider)
        }),
      )

      await ctx.plugin(CredentialsLocal, { path, watch: false, dotenvPaths: [] }).await()
      await ctx.plugin(AuthorizationService).await()
      await ctx.plugin(LlmRuntime).await()
      await ctx.plugin(pi, { providers: {} }).await()
      assert.ok(ctx.authorization.describe(key).methods.some((method) => method.id === 'oauth'))
      assert.deepEqual(ctx.llm.listProviders(), [], 'the test creates no inference route')
      await ctx.credentials.modifyRecord(key, async () => previous)
      const before = await readFile(path, 'utf8')
      ctx.on('credentials/record-updated', (updatedKey) => {
        if (updatedKey === key) updates++
      })

      // Hold the actual provider-managed record lock. Returning undefined leaves
      // the existing grant untouched, so every subsequent update belongs to login.
      holder = ctx.credentials.modifyRecord(key, async (current) => {
        assert.deepEqual(current, previous)
        locked.resolve()
        await release.promise
        return undefined
      })
      await bounded(locked.promise, 'credential lock acquisition')

      const modify = ctx.credentials.modifyRecord.bind(ctx.credentials)
      mocks.push(
        t.mock.method(ctx.credentials, 'modifyRecord', (...args) => {
          assert.equal(args[0], key)
          assert.equal(nativeWrite, undefined, 'native login admits exactly one replacement')
          // Observe admission after the real store has enqueued the operation. Do not
          // wrap its mutation or simulate cancellation/persistence in this observer.
          nativeWrite = modify(...args)
          void nativeWrite.catch(() => {})
          queued.resolve()
          return nativeWrite
        }),
      )
      attempt = ctx.authorization.begin({
        key,
        method: 'oauth',
        signal: controller.signal,
        interaction: {
          notify: () => assert.fail('synthetic provider must not emit protocol notices'),
          prompt: async () => assert.fail('synthetic provider must not request OAuth input'),
        },
      })
      void attempt.catch(() => {})
      await bounded(queued.promise, 'native queued replacement admission')
      assert.equal(
        loginCalls,
        1,
        'the installed native flow reaches the substituted provider login',
      )
      assert.equal(loginSignal.aborted, false)
      assert.equal(ctx.authorization.describe(key).inFlight, true)
      assert.equal(await readFile(path, 'utf8'), before)
      assert.equal(updates, 0)

      controller.abort(new Error('synthetic caller cancellation'))
      assert.deepEqual(await bounded(attempt, 'native authorization cancellation'), {
        status: 'cancelled',
      })
      assert.equal(loginSignal.aborted, true)
      assert.equal(ctx.authorization.describe(key).inFlight, false)
      assert.equal(
        await readFile(path, 'utf8'),
        before,
        'cancellation returns while the lock is held',
      )
      assert.deepEqual(await ctx.credentials.readRecord(key), previous)
      assert.equal(updates, 0)

      release.resolve()
      await bounded(Promise.all([holder, nativeWrite]), 'queued native write completion')
      assert.equal(updates, 1, 'the cancelled native attempt still publishes its queued write')
      const committed = { kind: 'grant', payload: replacement }
      assert.deepEqual(await ctx.credentials.readRecord(key), committed)
      const document = await disk()
      assert.deepEqual([...document.records], [[key, committed]])
      assert.equal(document.refs.size, 0)
      assert.equal(fetchCalls, 0)
      assert.equal(ctx.authorization.describe(key).inFlight, false)
    } finally {
      controller.abort()
      release.resolve()
      try {
        await bounded(
          Promise.allSettled([holder, attempt, nativeWrite].filter(Boolean)),
          'native auth boundary cleanup',
        )
      } finally {
        for (const mock of mocks.reverse()) mock.mock.restore()
        try {
          await ctx.fiber.dispose()
        } finally {
          // home is the resolved, task-created mkdtemp directory, never runtime state.
          await rm(home, { recursive: true, force: true })
        }
      }
    }
  },
)
