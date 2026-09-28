import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import * as Projects from '../dist/src/index.js'
import { config, github } from './fixtures.js'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = (name) => import(pathToFileURL(cli.resolve(name)).href)
const { Context } = await installed('@deepseek-ai/cordis')
const { updateVolatile } = createRequire(require.resolve('@deepseek-ai/schemastery'))(
  '@deepseek-ai/cosmokit',
)

async function mount(t, { connection = true, settings = true } = {}) {
  const ctx = new Context()
  if (connection) ctx.provide('webServer', {})
  t.after(() => ctx.fiber.dispose())
  for (const name of ['system-prompt', 'tools']) {
    const module = await installed(`@deepseek-ai/dsh-${name}`)
    await ctx.plugin(module.default ?? module, {}).await()
  }
  const value = Projects.Config({ catalogJson: JSON.stringify(config()) })
  const state = {
    rpc: undefined,
    rpcDisposed: false,
    presentationDisposed: false,
    writes: [],
    reads: 0,
  }
  if (settings)
    ctx.provide('settings', {
      describe(options) {
        assert.deepEqual(options, { redactSecrets: true })
        return [{ ns: 'local-projects', revision: 7 }]
      },
      configure(options, owner) {
        state.presentation = { options, owner }
        return () => {
          state.presentationDisposed = true
        }
      },
      async update(namespace, patch, revision) {
        assert.equal(revision, 7)
        if (state.settingsConflict)
          throw Object.assign(new Error('private settings contents'), { code: 'SETTINGS_CONFLICT' })
        state.writes.push({ namespace, patch, revision })
        updateVolatile(value.catalogJson, Projects.Config(patch).catalogJson)
      },
    })
  if (connection)
    ctx.provide('connection', {
      rpc: {
        handle(channel, handler) {
          assert.equal(channel, '/projects')
          state.rpc = handler
          return async () => {
            state.rpcDisposed = true
          }
        },
      },
    })
  ctx.provide('localGitHubReads', {
    listIssues: async () => {
      state.reads++
      return github()
    },
  })
  const plugin = ctx.plugin({
    name: 'projects-fixture',
    inject: Projects.inject,
    apply(child) {
      child.fiber.entry = { options: { id: 'local-projects' } }
      Projects.apply(child, value)
    },
  })
  await plugin.await()
  return { ctx, plugin, state, service: ctx.get('projects') }
}
const signal = () => new AbortController().signal

test('real Cordis provides shared Projects service, tools and reversible RPC; volatile settings remain live', async (t) => {
  const { ctx, plugin, state, service } = await mount(t)
  assert.ok(service)
  assert.equal(state.reads, 0)
  assert.deepEqual(state.presentation.options, { auto: false })
  const first = await state.rpc('catalog', {}, signal())
  assert.equal(first.ok, true)
  assert.equal(first.value.projects[0].id, 'app')
  const next = config()
  next.projects[0].name = 'Renamed'
  const changed = await state.rpc(
    'configure',
    { configuration: next, expectedRevision: first.value.revision },
    signal(),
  )
  assert.equal(changed.ok, true)
  assert.equal(changed.value.projects[0].name, 'Renamed')
  assert.equal(state.writes[0].namespace, 'local-projects')
  assert.equal(service.project({ projectId: 'app' }).name, 'Renamed')
  const tool = ctx.get('tools').get('projects_get')
  assert.ok(tool)
  const result = JSON.parse(await tool.execute({ projectId: 'app' }, { signal: signal() }))
  assert.equal(result.name, 'Renamed')
  const issues = await state.rpc('issues', { projectId: 'app', sourceId: 'repo' }, signal())
  assert.equal(issues.ok, true)
  assert.equal(state.reads, 1)
  await plugin.dispose()
  assert.equal(ctx.get('projects'), undefined)
  assert.equal(ctx.get('tools').get('projects_get'), undefined)
  assert.equal(state.rpcDisposed, true)
  assert.equal(state.presentationDisposed, true)
  assert.equal((await state.rpc('catalog', {}, signal())).error.code, 'stopped')
})

test('RPC rejects unknown endpoints, extra params and pre-aborted requests without tracker reads', async (t) => {
  const { state } = await mount(t)
  for (const endpoint of ['delete', '__proto__', 'constructor', 'toString']) {
    const response = await state.rpc(endpoint, {}, signal())
    assert.equal(response.ok, false)
    assert.equal(response.error.code, 'invalid')
    assert.deepEqual(response.error.details, {})
  }
  assert.equal((await state.rpc('catalog', { key: 'private' }, signal())).error.code, 'invalid')
  const controller = new AbortController()
  controller.abort()
  assert.equal(
    (await state.rpc('issues', { projectId: 'app', sourceId: 'repo' }, controller.signal)).error
      .code,
    'cancelled',
  )
  assert.equal(state.reads, 0)
  state.settingsConflict = true
  const revision = (await state.rpc('catalog', {}, signal())).value.revision
  const conflict = await state.rpc(
    'configure',
    { configuration: config(), expectedRevision: revision },
    signal(),
  )
  assert.equal(conflict.error.code, 'conflict')
  assert.doesNotMatch(JSON.stringify(conflict), /private/)
  assert.equal(state.writes.length, 0)
})

test('host service and tools work without Connection; unavailable Settings saves fail safely', async (t) => {
  const { service, state } = await mount(t, { connection: false, settings: false })
  assert.equal(state.rpc, undefined)
  assert.equal(service.catalog().projects.length, 1)
  await assert.rejects(
    service.configure({ configuration: config(), expectedRevision: service.catalog().revision }),
    { code: 'settings' },
  )
})
