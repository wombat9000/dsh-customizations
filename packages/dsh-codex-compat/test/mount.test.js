import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { installed } from '../../dsh-google-auth/test/profile-fixture.js'
import { mountCodexFast } from '../dist/src/fast/runtime.js'
import * as plugin from '../dist/src/fast/index.js'
import { inferenceFixture } from './inference-fixture.js'
const Storage = (await installed('@deepseek-ai/dsh-storage')).default
const StorageJson = await installed('@deepseek-ai/dsh-storage-json')
const StorageDomain = await installed('@deepseek-ai/dsh-storage-domain')

test('real Cordis mount, Connection lifetime and JSON domain survive plugin unload/reopen', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-codex-fast-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const f = await inferenceFixture(t)
  const ctx = f.ctx
  const routes = new Set()
  ctx.provide('webServer', {
    register(route) {
      routes.add(route)
      return () => routes.delete(route)
    },
  })
  ctx.provide('settings', { configure: () => () => {} })
  ctx.provide('agents', { get: (id) => ({ id, session: { header: {} } }) })
  ctx.provide('sessionProjections', {
    stateOf: () => ({ pending: { provider: 'openai-codex', model: 'gpt-6-sol' }, lastUsed: null }),
  })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'openai-codex', model: 'gpt-6-sol' }),
  })
  await ctx.plugin(Storage).await()
  await ctx.plugin(StorageJson, { root }).await()
  await ctx.plugin(StorageDomain, { backend: 'json' }).await()
  // Real persisted v1 fixture predates the additive subagents table. Opening the new
  // plugin must preserve existing choices and initialize child policy to off.
  const legacy = await ctx.storageDomain.open(
    StorageDomain.defineDomain({
      name: 'local_codex_fast',
      version: 1,
      global: {
        schema: z.object({ enabled: z.boolean(), revision: z.number() }),
        initial: { enabled: true, revision: 0 },
      },
      tables: {
        sessions: StorageDomain.domainTable(
          z.object({
            provider: z.string(),
            model: z.string(),
            enabled: z.boolean(),
            revision: z.number(),
          }),
        ),
      },
    }),
  )
  await legacy.table('sessions').put('legacy-session', {
    provider: 'openai-codex',
    model: 'gpt-6-sol',
    enabled: true,
    revision: 7,
  })
  await legacy.close()
  await ctx
    .plugin({
      apply(owner) {
        new HostConnectionService(owner, [], {})
      },
    })
    .await()
  let runtime
  const mount = () =>
    ctx.plugin({
      name: 'fast-lifetime-fixture',
      inject: plugin.inject,
      async apply(owner) {
        runtime = await mountCodexFast(owner)
      },
    })
  const first = mount()
  await first.await()
  const signal = new AbortController().signal
  const oldChoice = runtime.sessionStatus('legacy-session')
  assert.equal(oldChoice.requested, true)
  assert.equal(oldChoice.sessionRevision, 7)
  assert.equal(oldChoice.subagentsRequested, false)
  assert.equal(
    (
      await runtime.rpc(
        'mode-set',
        {
          sessionId: 'fixture-session',
          provider: 'openai-codex',
          model: 'gpt-6-sol',
          mode: 'all',
          sessionRevision: 0,
          subagentsRevision: 0,
        },
        signal,
      )
    ).ok,
    true,
  )
  assert.equal(
    (await runtime.rpc('integration-set', { enabled: false, revision: 0 }, signal)).ok,
    true,
  )
  await first.dispose()
  assert.equal(routes.size, 0, 'unload removes the real Connection route')
  const second = mount()
  await second.await()
  const status = await runtime.rpc('session-status', { sessionId: 'fixture-session' }, signal)
  assert.equal(status.ok, true)
  assert.equal(status.value.requested, true)
  assert.equal(status.value.enabled, false)
  assert.equal(status.value.sessionRevision, 1)
  assert.equal(status.value.subagentsRequested, true)
  assert.equal(status.value.subagentsRevision, 1)
  assert.equal(runtime.sessionStatus('legacy-session').requested, true)
  assert.equal(runtime.sessionStatus('legacy-session').subagentsRequested, false)
  assert.equal(
    (await runtime.rpc('integration-set', { enabled: true, revision: 1 }, signal)).ok,
    true,
  )
  const changeMode = (mode, sessionRevision, subagentsRevision) =>
    runtime.rpc(
      'mode-set',
      {
        sessionId: 'fixture-session',
        provider: 'openai-codex',
        model: 'gpt-6-sol',
        mode,
        sessionRevision,
        subagentsRevision,
      },
      signal,
    )
  assert.equal((await changeMode('main', 1, 1)).ok, true)
  await second.dispose()
  const third = mount()
  await third.await()
  const main = runtime.sessionStatus('fixture-session')
  assert.equal(main.requested, true)
  assert.equal(main.subagentsRequested, false)
  assert.equal(main.sessionRevision, 2)
  assert.equal(main.subagentsRevision, 2)
  assert.equal(
    (await changeMode('off', 0, 0)).ok,
    true,
    'stale Off remains a durable recovery action',
  )
  await third.dispose()
  const fourth = mount()
  await fourth.await()
  const off = runtime.sessionStatus('fixture-session')
  assert.equal(off.requested, false)
  assert.equal(off.subagentsRequested, false)
  assert.equal(off.sessionRevision, 3)
  assert.equal(off.subagentsRevision, 3)
  await fourth.dispose()
  // Exercise the packaged exported plugin, not just its cohesive mount operation.
  const exported = ctx.plugin(plugin)
  await exported.await()
  assert.equal(routes.size, 1)
  await exported.dispose()
  assert.equal(routes.size, 0)
})
