import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { executeOne } from '../../dsh-github/test/approval-fixture.js'
import { installed } from '../../dsh-product-mode/test/fixtures.js'
import {
  cli,
  declarations,
  fixture,
  flatten,
  host,
  json,
  patch,
  standardPatch,
} from './fixtures.js'

// Real Loader, preset registry, tool registry/executor, Standard preset, and
// Host-wide GitHub tools. Agents are minted as real scopes under each preset
// and announced through `agent/created` exactly as the registry dispatches it;
// no agent loop, model, subprocess, or network runs.

// Real DSH storage hub, JSON backend, and domain facility: Dispatch records are
// validated by the facility exactly as in a deployed Host.
async function durableStorage(t, ctx) {
  const root = await mkdtemp(join(tmpdir(), 'dispatch-storage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await ctx.plugin((await installed('@deepseek-ai/dsh-storage')).default).await()
  await ctx.plugin(await installed('@deepseek-ai/dsh-storage-json'), { root }).await()
  await ctx.plugin(await installed('@deepseek-ai/dsh-storage-domain'), { backend: 'json' }).await()
  return root
}

async function mountedHost(t) {
  const f = await fixture(t)
  const rows = declarations([standardPatch, patch])
  const mounted = await host(t, f, rows, { before: (ctx) => durableStorage(t, ctx) })
  const roster = mounted.ctx.get('agentPresets')
  const { createScope, scopeTarget } = await installed('@deepseek-ai/dsh-scope')
  const { Session } = await installed('@deepseek-ai/dsh-session')
  let count = 0
  const lease = async (id) => {
    const scope = await roster.acquireScope(id)
    t.after(() => scope[Symbol.asyncDispose]())
    return scope
  }
  const agentIn = async (lease) => {
    const id = `agent-${++count}`
    const session = Session.create(id, undefined, {
      version: 4,
      id,
      createdAt: 0,
      isSeeded: false,
      cwd: f.directory,
    })
    const agent = { id, session, followup() {}, steer() {} }
    const scope = createScope(mounted.ctx, agent, { parent: lease.key })
    t.after(() => scope.dispose())
    agent.ctx = scope.ctx
    await mounted.ctx.serial(scopeTarget(agent, agent), 'agent/created', { agent })
    return agent
  }
  const tools = mounted.ctx.get('tools')
  const names = (key) => [...tools.view(key).visible.keys()].sort()
  return { ...mounted, f, rows, lease, agentIn, tools, names }
}

const definition = (name) => ({
  name,
  description: name,
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: { schema: { type: 'string' }, render: () => [] },
  execute: async () => 'ran',
})

test('publication: one host row, two additive presets, and the Standard notice', async (t) => {
  const f = await fixture(t)
  const manifest = await json(join(f.packaged, 'package.json'))
  assert.equal(manifest.name, '@local/dsh-dispatch')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh'], '0.2.2-rc.3')
  assert.equal((await json(cli.resolve('@deepseek-ai/dsh/package.json'))).version, '0.2.2-rc.3')
  assert.equal(manifest.dependencies, undefined)
  assert.equal(manifest.devDependencies, undefined)
  const own = declarations([join(f.packaged, 'cordis.patch.yml')])
  assert.deepEqual(
    own.map((row) => [row.id, row.name, row.config?.id]),
    [
      ['local-dispatch', '@local/dsh-dispatch', undefined],
      ['local-preset-dispatch', '@deepseek-ai/dsh-agent-preset', 'dispatch'],
      ['local-preset-dispatch-worker', '@deepseek-ai/dsh-agent-preset', 'dispatch-worker'],
    ],
  )
  const webRoot = dirname(cli.resolve('@deepseek-ai/dsh-web-app/package.json'))
  assert.equal(
    await readFile(join(f.packaged, 'presets/dispatch-worker/LICENSE.standard'), 'utf8'),
    await readFile(join(webRoot, 'LICENSE'), 'utf8'),
  )
  // Dispatch Worker = pinned Standard minus delegation and plugin-manager routes, plus guidance and reporting.
  const standard = declarations([standardPatch])[0].config.plugins
  const worker = own[2].config.plugins
  const removed = new Set(['delegation', 'tool-plugin-manager', 'tool-plugin-market'])
  assert.deepEqual(
    worker.filter((row) => !['persona', 'local-dispatch-worker'].includes(row.id)),
    standard.filter((row) => !removed.has(row.id) && row.id !== 'persona'),
  )
  // rc.3 persona templates register only {{provider}} and {{model}}; any other
  // variable throws when the first turn renders the system prompt.
  for (const row of own.slice(1)) {
    const persona = row.config.plugins.find((plugin) => plugin.id === 'persona').config
    const used = `${persona.prefix}\n${persona.suffix}`.match(/\{\{\s*[^}]*\}\}/gu) ?? []
    for (const variable of used) assert.match(variable, /^\{\{\s*(provider|model)\s*\}\}$/u)
  }
  assert.equal(worker.at(-1).name, '@local/dsh-dispatch/worker')
  for (const row of flatten(worker)) assert.notEqual(row.name, '@deepseek-ai/dsh-tool-ralph')
  assert.ok(await readFile(join(f.packaged, 'client.js'), 'utf8'))
})

test(
  'coordinator tools stay restricted with Host-wide and later tools loaded',
  { timeout: 30000 },
  async (t) => {
    const h = await mountedHost(t)
    const coordinator = await h.agentIn(await h.lease('dispatch'))
    const standard = await h.agentIn(await h.lease('standard'))
    const allowed = [
      'ask_user_question',
      'dispatch_add_session',
      'dispatch_create_session',
      'dispatch_find_sessions',
      'dispatch_get_session_status',
      'dispatch_interrupt_session',
      'dispatch_list_presets',
      'dispatch_list_sessions',
      'dispatch_list_workspaces',
      'dispatch_read_session',
      'dispatch_refresh_base',
      'dispatch_remove_session',
      'dispatch_send_message',
      'dispatch_update_session',
      'dispatch_wait_session',
      'skill',
      'todo_write',
    ]
    assert.deepEqual(h.names(coordinator), allowed)
    assert.ok(
      h.names().some((name) => name.startsWith('github_')),
      'GitHub tools are loaded Host-wide',
    )
    assert.ok(h.names(standard).includes('bash'))
    assert.ok(
      !h.names(standard).some((name) => name.startsWith('dispatch_')),
      'Standard is unchanged',
    )

    // A global registered later stays hidden; a tool another plugin adds to the
    // coordinator's own scope is visible (rc.3 limitation) but cannot execute.
    const disposeGlobal = h.tools.register(definition('late_global_tool'))
    t.after(disposeGlobal)
    coordinator.ctx.get('tools').register(definition('late_agent_tool'))
    assert.ok(!h.names(coordinator).includes('late_global_tool'))
    assert.ok(h.names(standard).includes('late_global_tool'))
    const denied = await executeOne(h.tools, 'late_agent_tool', {}, { agent: coordinator })
    assert.match(JSON.stringify(denied), /cannot run late_agent_tool/)
    const github = await executeOne(h.tools, 'github_list_issues', {}, { agent: coordinator })
    assert.equal(github.isError, true, 'a hidden Host-wide tool is not executable')
    assert.equal(
      (await executeOne(h.tools, 'late_global_tool', {}, { agent: standard })).value,
      'ran',
    )
    const presets = await executeOne(h.tools, 'dispatch_list_presets', {}, { agent: coordinator })
    assert.match(JSON.stringify(presets), /dispatch-worker/)
  },
)

test(
  'worker preset keeps coding tools, adds dispatch_report, and blocks orchestration',
  { timeout: 30000 },
  async (t) => {
    const h = await mountedHost(t)
    const worker = await h.agentIn(await h.lease('dispatch-worker'))
    const standard = await h.agentIn(await h.lease('standard'))
    const added = h.names(worker).filter((name) => !h.names(standard).includes(name))
    const missing = h.names(standard).filter((name) => !h.names(worker).includes(name))
    assert.deepEqual(added, ['dispatch_report'])
    for (const name of ['subagent', 'subagent_fork', 'workflow', 'send_message'])
      assert.ok(missing.includes(name))
    for (const name of ['bash', 'edit', 'todo_write']) assert.ok(h.names(worker).includes(name))
    const disposeTeam = h.tools.register(definition('team_task_create'))
    t.after(disposeTeam)
    const team = await executeOne(h.tools, 'team_task_create', {}, { agent: worker })
    assert.match(JSON.stringify(team), /Dispatch workers cannot use team_task_create/)
    const report = await executeOne(
      h.tools,
      'dispatch_report',
      { assignmentId: 'a', kind: 'done', summary: 'x' },
      { agent: worker },
    )
    assert.match(JSON.stringify(report), /no approved Dispatch assignment/)
    assert.equal(
      (await executeOne(h.tools, 'team_task_create', {}, { agent: standard })).value,
      'ran',
    )
  },
)

test('Dispatch fails closed without durable storage and keeps records across reopen', async (t) => {
  const { apply } = await import('../dist/src/index.js')
  const { domainStore } = await import('../dist/src/store.js')
  const ctx = (storageDomain) => ({
    storageDomain,
    get: () => undefined,
    provide() {},
    effect() {},
    inject() {},
  })
  await assert.rejects(apply(ctx(undefined)), /requires the DSH storage domain/)
  await assert.rejects(
    apply(
      ctx({
        open: async () => {
          throw new Error('invalid-record')
        },
      }),
    ),
    /invalid-record/,
  )
  const { Context } = await installed('@deepseek-ai/cordis')
  const host = new Context()
  t.after(() => host.fiber.dispose())
  await durableStorage(t, host)
  const first = await domainStore(host.get('storageDomain'))
  await first.transaction((tables) =>
    tables.workers.put('w', {
      version: 2,
      workerId: 'w',
      coordinatorId: 'c',
      generation: 1,
    }),
  )
  await first.close()
  const second = await domainStore(host.get('storageDomain'))
  assert.equal(second.tables.workers.get('w').coordinatorId, 'c')
  await second.close()
})

test('generated host and client artifacts are fresh', async () => {
  const { buildHost } = await import('../scripts/build-host.mjs')
  const { checkHost } = await import('../../../scripts/build-host.mjs')
  checkHost(buildHost())
  const { buildClient, clientPath } = await import('../scripts/build-client.mjs')
  assert.equal(await readFile(clientPath, 'utf8'), await buildClient())
})
