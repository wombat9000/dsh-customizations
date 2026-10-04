import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { installed } from '../../dsh-google-auth/test/profile-fixture.js'
import * as oauth from '../dist/src/oauth/index.js'
import * as fast from '../dist/src/fast/index.js'
import { gate } from './inference-fixture.js'

const { default: AuthorizationService } = await installed('@deepseek-ai/dsh-authorization')
const { default: CredentialsLocal, parseCredentialsDocument } = await installed(
  '@deepseek-ai/dsh-credentials-local',
)
const { credentialKey } = await installed('@deepseek-ai/dsh-credentials')
const { default: LlmRuntime } = await installed('@deepseek-ai/dsh-llm')
const pi = await installed('@deepseek-ai/dsh-llm-pi-ai')
const { HostConnectionService } = await installed('@deepseek-ai/dsh-client-connection')
const { default: Storage } = await installed('@deepseek-ai/dsh-storage')
const StorageJson = await installed('@deepseek-ai/dsh-storage-json')
const StorageDomain = await installed('@deepseek-ai/dsh-storage-domain')
const nativeKey = credentialKey('llm-pi-ai', 'openai-codex')
const previousGrant = {
  kind: 'grant',
  payload: { access: 'synthetic-old', refresh: 'synthetic-refresh' },
}

// Real Cordis authorization and native durable credentials. Only the protocol runner is synthetic.
async function fixture(t) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'codex-oauth-contract-')))
  const path = join(home, '.credentials.yaml')
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  await ctx.plugin(CredentialsLocal, { path, watch: false, dotenvPaths: [] }).await()
  await ctx.plugin(AuthorizationService).await()
  const readRecord = ctx.credentials.readRecord.bind(ctx.credentials)
  return {
    ctx,
    home,
    path,
    readRecord,
    disk: async () => parseCredentialsDocument(await readFile(path, 'utf8'), path).records,
    flow(key, run) {
      return ctx.authorization.registerFlow({
        key,
        label: 'Synthetic authorization',
        methods: [{ id: 'oauth', label: 'Synthetic sign-in' }],
        run,
      })
    },
  }
}

function terminal(interactive = false) {
  const input = new PassThrough()
  const output = new PassThrough()
  input.isTTY = interactive
  output.isTTY = interactive
  const chunks = []
  output.on('data', (chunk) => chunks.push(String(chunk)))
  return { input, output, text: () => chunks.join('') }
}

const methods = [
  { id: 'browser', label: 'Browser' },
  { id: 'device_code', label: 'Device code' },
]

// Gate: helper-owned skip/security boundary; token reads or accidental login must fail,
// unlike the old mocked store. Native key compatibility is observed against persisted records.
test(
  'existing native grant skips login using metadata, never token payloads',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t)
    assert.equal(oauth.CODEX_CREDENTIAL_KEY, nativeKey)
    await f.ctx.credentials.modifyRecord(nativeKey, async () => previousGrant)
    const before = await readFile(f.path, 'utf8')
    t.mock.method(f.ctx.credentials, 'readRecord', () => assert.fail('helper read token payload'))
    t.mock.method(f.ctx.credentials, 'deleteRecord', () =>
      assert.fail('helper deleted native grant'),
    )
    t.mock.method(f.ctx.authorization, 'begin', () => assert.fail('helper started login'))
    const io = terminal()
    assert.equal(
      await oauth.authorizeCodex(f.ctx, new AbortController().signal, { output: io.output }),
      'already-configured',
    )
    assert.equal(await readFile(f.path, 'utf8'), before)
    assert.deepEqual(await f.readRecord(nativeKey), previousGrant)
    assert.equal(io.text(), '')
  },
)

// Gate: helper reauth must retain the usable grant through failure and delegate the only
// replacement write to real AuthorizationService.commit, not a persistence-shaped mock.
test(
  'explicit reauth preserves the native grant until a successful native commit',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t)
    await f.ctx.credentials.modifyRecord(nativeKey, async () => previousGrant)
    const before = await readFile(f.path, 'utf8')
    t.mock.method(f.ctx.credentials, 'readRecord', () => assert.fail('helper read token payload'))
    t.mock.method(f.ctx.credentials, 'deleteRecord', () =>
      assert.fail('helper deleted native grant'),
    )
    const entered = gate()
    const finish = gate()
    const replacement = {
      kind: 'grant',
      payload: { access: 'synthetic-new', refresh: 'synthetic-new-refresh' },
    }
    let fail = true
    let writes = 0
    f.ctx.on('credentials/record-updated', () => writes++)
    f.flow(nativeKey, async (session) => {
      assert.equal(session.method, 'oauth')
      assert.deepEqual(await f.readRecord(nativeKey), previousGrant)
      assert.equal(
        await session.prompt({ kind: 'select', message: 'Choose sign-in', options: methods }),
        'device_code',
      )
      if (fail) {
        entered.resolve()
        await finish.promise
        throw new Error('synthetic exchange failure')
      }
      await session.commit(replacement)
    })
    const io = terminal()
    const attempt = oauth.authorizeCodex(f.ctx, new AbortController().signal, {
      forceLogin: true,
      output: io.output,
    })
    const rejected = assert.rejects(attempt, /synthetic exchange failure/)
    await entered.promise
    assert.equal(f.ctx.authorization.describe(nativeKey).inFlight, true)
    assert.equal(await readFile(f.path, 'utf8'), before, 'reauth must not delete before exchange')
    finish.resolve()
    await rejected
    assert.equal(writes, 0)
    assert.deepEqual((await f.disk()).get(nativeKey), previousGrant)
    fail = false
    assert.equal(
      await oauth.authorizeCodex(f.ctx, new AbortController().signal, {
        forceLogin: true,
        output: io.output,
      }),
      'authorized',
    )
    assert.equal(writes, 1)
    assert.deepEqual((await f.disk()).get(nativeKey), replacement)
    assert.deepEqual([...(await f.disk()).keys()], [nativeKey])
    assert.match(io.text(), /Login complete/)
    assert.doesNotMatch(io.text(), /synthetic-(old|new|refresh)/)
  },
)

// Gate: terminal interaction is the human-facing owner. TTY selection and refusal of
// secrets are separate risks from authorization persistence; no duplicated protocol mocks.
test('human terminal interaction selects browser/device methods and refuses secrets', async () => {
  for (const interactive of [false, true]) {
    const io = terminal(interactive)
    const interaction = oauth.createTerminalInteraction(io)
    assert.equal(
      await interaction.prompt({ kind: 'select', message: 'Choose', options: methods }),
      interactive ? 'browser' : 'device_code',
    )
    assert.equal(
      await interaction.prompt({
        kind: 'select',
        message: 'Only method',
        options: [{ id: 'other', label: 'Other' }],
      }),
      'other',
    )
    await assert.rejects(
      interaction.prompt({ kind: 'select', message: 'No methods', options: [] }),
      /no login method/,
    )
    await assert.rejects(
      interaction.prompt({ kind: 'secret', message: 'Unexpected token request' }),
      /refuses unexpected secret prompts/,
    )
    interaction.notify({
      message: 'Continue sign-in',
      url: 'https://example.invalid/authorize',
      code: 'FIXTURE-CODE',
    })
    assert.match(io.text(), /Open: https:\/\/example\.invalid\/authorize/)
    assert.match(io.text(), /Code: FIXTURE-CODE/)
    assert.doesNotMatch(io.text(), /Unexpected token request/)
  }
})

// Gate: optional callback must remain pending until cancelled and release readline in
// interactive mode. The selection test cannot observe this losing-question lifecycle.
test('manual callback cancellation binds prompt and owner lifetimes and releases input', async () => {
  for (const interactive of [false, true])
    for (const cancelOwner of [false, true]) {
      const io = terminal(interactive)
      const owner = new AbortController()
      const manual = new AbortController()
      const interaction = oauth.createTerminalInteraction({ ...io, signal: owner.signal })
      let settled = false
      let error
      const pending = interaction
        .prompt({ kind: 'text', message: 'Optional callback', signal: manual.signal })
        .then(
          () => {
            settled = true
          },
          (failure) => {
            error = failure
            settled = true
          },
        )
      const reason = new Error('synthetic browser cancellation')
      try {
        await new Promise(setImmediate)
        assert.equal(settled, false)
        ;(cancelOwner ? owner : manual).abort(reason)
        await new Promise(setImmediate)
        assert.equal(
          settled,
          true,
          'a distinct native manual-prompt signal cannot outlive its owner',
        )
        assert.ok(error === reason || error?.cause === reason)
        assert.equal(io.input.listenerCount('keypress'), 0)
        if (interactive) assert.equal(io.input.isPaused(), true)
        await assert.rejects(
          interaction.prompt({ kind: 'text', message: 'Already cancelled', signal: manual.signal }),
          (failure) => failure === reason,
        )
      } finally {
        manual.abort(reason)
        owner.abort(reason)
        await pending
      }
    }
})

// Gate: installed pi discovery/pre-cancel proves native addressing without calling the
// real OAuth protocol. Synthetic flows cannot detect drift in the installed provider seam.
test('native Codex OAuth is available without configured routes and pre-cancellation never prompts', async (t) => {
  const f = await fixture(t)
  await f.ctx.plugin(LlmRuntime).await()
  await f.ctx.plugin(pi, { providers: {} }).await()
  const flow = f.ctx.authorization.describe(nativeKey)
  assert.ok(flow)
  assert.ok(flow.methods.some((method) => method.id === 'oauth'))
  assert.deepEqual(
    f.ctx.llm.listProviders(),
    [],
    'native sign-in does not require or create an inference route',
  )
  const controller = new AbortController()
  controller.abort(new Error('no real OAuth permitted'))
  assert.deepEqual(
    await f.ctx.authorization.begin({
      key: nativeKey,
      method: 'oauth',
      signal: controller.signal,
      interaction: {
        notify: () => assert.fail('pre-cancelled native flow notified'),
        prompt: async () => assert.fail('pre-cancelled native flow prompted'),
      },
    }),
    { status: 'cancelled' },
  )
  assert.equal((await f.ctx.credentials.describeRecord(nativeKey)).configured, false)
})

// Gate: real component disposal must cancel only its own pending attempt; Fast route and
// another native surface's same-key attempt outlive it. Unit cancellation cannot reach Cordis ownership.
test(
  'OAuth disposal cancels owned authorization without stopping Fast or native callers',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t)
    const previousReauth = process.env.DSH_CODEX_REAUTH
    delete process.env.DSH_CODEX_REAUTH
    t.after(() => {
      if (previousReauth === undefined) delete process.env.DSH_CODEX_REAUTH
      else process.env.DSH_CODEX_REAUTH = previousReauth
    })
    await f.ctx.plugin(LlmRuntime).await()
    await f.ctx.plugin(Storage).await()
    await f.ctx.plugin(StorageJson, { root: join(f.home, 'storage') }).await()
    await f.ctx.plugin(StorageDomain, { backend: 'json' }).await()
    const routes = new Set()
    f.ctx.provide('webServer', {
      register(route) {
        routes.add(route)
        return () => routes.delete(route)
      },
    })
    f.ctx.provide('settings', { configure: () => () => {} })
    f.ctx.provide('agents', { get: () => undefined })
    f.ctx.provide('sessionProjections', { stateOf: () => undefined })
    f.ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'openai-codex', model: 'gpt-6-sol' }),
    })
    await f.ctx
      .plugin({
        apply: (ctx) => {
          new HostConnectionService(ctx, [], {})
        },
      })
      .await()
    const fastMount = f.ctx.plugin(fast)
    await fastMount.await()
    assert.equal(routes.size, 1)
    const fastRoutes = [...routes]
    const authorization = f.ctx.authorization
    const ownedEntered = gate()
    const ownedExited = gate()
    const manualController = new AbortController()
    t.after(() => manualController.abort())
    f.flow(nativeKey, async (session) => {
      ownedEntered.resolve(session.signal)
      try {
        await session.prompt({
          kind: 'text',
          message: 'Synthetic callback',
          signal: manualController.signal,
        })
        await session.commit(previousGrant)
      } finally {
        ownedExited.resolve()
      }
    })
    const settled = gate()
    f.ctx.on('authorization/settled', (key, status) => {
      if (key === nativeKey) settled.resolve(status)
    })
    const helper = f.ctx.plugin(oauth)
    await helper.await()
    const ownedSignal = await ownedEntered.promise
    assert.equal(ownedSignal.aborted, false)
    await helper.dispose()
    assert.equal(await settled.promise, 'cancelled')
    await ownedExited.promise
    assert.equal(ownedSignal.aborted, true)
    assert.ok(f.ctx.authorization.describe(nativeKey), 'the native flow remains registered')
    assert.equal(authorization.describe(nativeKey).inFlight, false)
    assert.deepEqual([...routes], fastRoutes)

    // A native surface owns this same-key attempt; the helper must not cancel by key.
    const nativeEntered = gate()
    const nativeFinish = gate()
    const nativeController = new AbortController()
    t.after(() => nativeController.abort())
    let nativeSignal
    const nativeAttempt = authorization.begin({
      key: nativeKey,
      method: 'oauth',
      signal: nativeController.signal,
      interaction: {
        notify() {},
        async prompt(prompt) {
          nativeSignal = prompt.signal
          nativeEntered.resolve()
          await nativeFinish.promise
          prompt.signal.throwIfAborted()
          return 'synthetic callback'
        },
      },
    })
    await nativeEntered.promise
    const diagnostics = gate()
    t.mock.method(process.stderr, 'write', (text) => {
      if (String(text).includes('login failed')) diagnostics.resolve(String(text))
      return true
    })
    const competingHelper = f.ctx.plugin(oauth)
    await competingHelper.await()
    assert.match(await diagnostics.promise, /native Models page/)
    await competingHelper.dispose()
    assert.equal(nativeSignal.aborted, false)
    assert.equal(authorization.describe(nativeKey).inFlight, true)
    assert.deepEqual([...routes], fastRoutes)
    nativeFinish.resolve()
    assert.deepEqual(await nativeAttempt, { status: 'authorized' })
    assert.deepEqual((await f.disk()).get(nativeKey), previousGrant)
    assert.equal(authorization.describe(nativeKey).inFlight, false)
    await fastMount.dispose()
    assert.equal(routes.size, 0)
  },
)
