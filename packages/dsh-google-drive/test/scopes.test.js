import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import * as DriveTools from '../src/tools.js'

// Existing pinned registries only: no active agent loop, model, OAuth or network.
const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = name => import(pathToFileURL(cli.resolve(name)).href)
const { Context } = await installed('@deepseek-ai/cordis')
const { createScope, bindScopeParent, scopeParentOf } = await installed('@deepseek-ai/dsh-scope')
const { default: SystemPrompt } = await installed('@deepseek-ai/dsh-system-prompt')
const { default: Tools } = await installed('@deepseek-ai/dsh-tools')
const { default: Skills } = await installed('@deepseek-ai/dsh-skill')

async function fixture(t) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  await ctx.plugin(Skills).await()
  const roots = new Set()
  const allowed = new Set()
  const editable = new Set()
  const observers = new Map()
  const service = {
    assertOwner(agent) { if (!roots.has(agent)) throw new Error('Exact root required.') },
    hasAccess: agent => allowed.has(agent),
    hasEditAccess: agent => editable.has(agent),
    async requestEdit(agent) { this.assertOwner(agent); return { state: 'pending' } },
    observe(agent, callback) {
      this.assertOwner(agent)
      const callbacks = observers.get(agent) ?? new Set()
      observers.set(agent, callbacks)
      callbacks.add(callback)
      return () => callbacks.delete(callback)
    },
    async request(agent) { this.assertOwner(agent); return { state: 'pending' } },
    async listFiles(agent) { this.assertOwner(agent); assert.ok(allowed.has(agent)); return { files: [] } },
    async readText(agent) { this.assertOwner(agent); assert.ok(allowed.has(agent)); return { text: 'synthetic' } },
  }
  await ctx.plugin({ name: 'scope-test-drive-service', apply(ctx) { ctx.provide('googleDrive', service) } }).await()
  const standingKey = {}
  const standing = createScope(ctx, standingKey)
  const plugin = standing.ctx.plugin(DriveTools)
  await plugin.await()
  function agent(id, root = true) {
    const value = { session: { id } }
    // Mirrors AgentLoop's fresh scope and AgentPresets.mount/composeFrom:
    // every agent joins the standing preset directly, including subagents.
    const scope = createScope(ctx, value)
    value.ctx = scope.ctx.extend({ agent: value })
    bindScopeParent(value, standingKey)
    if (root) roots.add(value)
    return { value, scope }
  }
  const a = agent('a')
  const b = agent('b')
  const child = agent('child', false)
  const registry = ctx.get('tools')
  const skills = ctx.get('skills')
  const names = key => [...registry.view(key).visible.keys()].sort()
  const skillNames = async key => (await skills.snapshot({ scope: key })).skills.map(skill => skill.name)
  const change = (owner, grant) => {
    if (grant) allowed.add(owner)
    else allowed.delete(owner)
    for (const observer of observers.get(owner) ?? []) observer()
  }
  const prepare = owner => registry.view(owner).visible.get('request_drive_access').execute({ reason: 'Read synthetic notes' }, { agent: owner, callId: `request-${owner.session.id}`, signal: new AbortController().signal })
  const changeEdit = (owner, grant) => { if (grant) editable.add(owner); else editable.delete(owner); for (const cb of observers.get(owner) ?? []) cb() }
  return { ctx, standingKey, standing, plugin, a, b, child, names, skillNames, change, changeEdit, prepare, registry, skills, observers }
}

test('real registry views and skill snapshots isolate granted roots sharing one preset', async t => {
  const f = await fixture(t)
  for (const owner of [f.a.value, f.b.value, f.child.value]) {
    assert.equal(scopeParentOf(owner), f.standingKey)
    assert.deepEqual(f.names(owner), ['request_drive_access', 'request_sheets_edit_access'])
    assert.deepEqual(await f.skillNames(owner), [])
  }
  assert.deepEqual(f.names(), [])
  assert.deepEqual(await f.skillNames(), [])
  await f.prepare(f.a.value)
  await f.prepare(f.b.value)
  await assert.rejects(f.prepare(f.child.value), /Exact root/)
  const expected = ['google_drive_list_files', 'google_drive_read_file', 'google_sheets_list_tabs', 'google_sheets_read_range', 'request_drive_access', 'request_sheets_edit_access']
  f.change(f.a.value, true)
  // No reload, remount or registry rebuild: each next view sees the mutation.
  assert.deepEqual(f.names(f.a.value), expected)
  assert.deepEqual(await f.skillNames(f.a.value), ['google-drive-read', 'google-sheets'])
  for (const key of [f.b.value, f.child.value, f.standingKey]) {
    assert.deepEqual(f.names(key), ['request_drive_access', 'request_sheets_edit_access'])
    assert.deepEqual(await f.skillNames(key), [])
  }
  assert.deepEqual(f.names(), [])
  assert.deepEqual(await f.skillNames(), [])
  f.change(f.b.value, true)
  assert.deepEqual(f.names(f.b.value), expected)
  assert.deepEqual(await f.skillNames(f.b.value), ['google-drive-read', 'google-sheets'])
  f.change(f.a.value, false)
  assert.deepEqual(f.names(f.a.value), ['request_drive_access', 'request_sheets_edit_access'])
  assert.deepEqual(await f.skillNames(f.a.value), [])
  assert.deepEqual(f.names(f.b.value), expected)
  assert.deepEqual(await f.skillNames(f.b.value), ['google-drive-read', 'google-sheets'])
  assert.deepEqual(f.names(f.child.value), ['request_drive_access', 'request_sheets_edit_access'])
  assert.deepEqual(await f.skillNames(f.child.value), [])
})

test('edit-only and mixed grants remain exact-root scoped through independent revocation', async t => {
  const f = await fixture(t)
  const owner = f.a.value
  await f.registry.view(owner).visible.get('request_sheets_edit_access').execute({ reason: 'Edit budget' }, { agent: owner, callId: 'edit' })
  f.changeEdit(owner, true)
  const editOnly = ['google_sheets_list_tabs', 'google_sheets_propose_edit', 'google_sheets_read_range', 'request_drive_access', 'request_sheets_edit_access']
  assert.deepEqual(f.names(owner), editOnly)
  assert.deepEqual(await f.skillNames(owner), ['google-sheets'])
  assert.deepEqual(f.names(f.b.value), ['request_drive_access', 'request_sheets_edit_access'])
  assert.deepEqual(f.names(f.child.value), ['request_drive_access', 'request_sheets_edit_access'])
  f.change(owner, true)
  assert.equal(f.names(owner).length, 7)
  assert.deepEqual((await f.skillNames(owner)).sort(), ['google-drive-read', 'google-sheets'])
  f.changeEdit(owner, false)
  assert.ok(!f.names(owner).includes('google_sheets_propose_edit'))
  assert.equal(f.names(owner).length, 6)
  f.changeEdit(owner, true); f.change(owner, false)
  assert.deepEqual(f.names(owner), editOnly)
  f.changeEdit(owner, false)
  assert.deepEqual(f.names(owner), ['request_drive_access', 'request_sheets_edit_access'])
  assert.deepEqual(await f.skillNames(owner), [])
})

test('real agent fiber disposal and preset plugin disposal remove progressive registrations', async t => {
  const f = await fixture(t)
  await f.prepare(f.a.value)
  await f.prepare(f.b.value)
  f.change(f.a.value, true)
  f.change(f.b.value, true)
  // Repeated notifications must not duplicate entries in either real registry.
  f.change(f.a.value, true)
  assert.equal(f.names(f.a.value).length, 6)
  await f.a.scope.dispose()
  assert.deepEqual(f.names(f.a.value), ['request_drive_access', 'request_sheets_edit_access'])
  assert.deepEqual(await f.skillNames(f.a.value), [])
  assert.equal(f.observers.get(f.a.value).size, 0)
  assert.equal(f.names(f.b.value).length, 6)
  await f.plugin.dispose()
  assert.deepEqual(f.names(f.b.value), [])
  assert.deepEqual(await f.skillNames(f.b.value), [])
  assert.deepEqual(f.names(f.child.value), [])
  assert.equal(f.observers.get(f.b.value).size, 0)
})
