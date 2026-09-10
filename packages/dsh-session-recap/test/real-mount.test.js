import test from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import * as recap from '../src/index.js'

test('real Cordis and host RPC mount recap without starting a GUI', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const routes = new Set()
  ctx.provide('webServer', { register(route) { routes.add(route); return () => routes.delete(route) } })
  ctx.provide('sessions', { get() {} })
  ctx.provide('llm', {})
  ctx.provide('settings', { installSection() {} })
  // Construct only the installed connection service; no auth plugin, listener,
  // providers, or GUI startup. Its real caller-scoped rpc getter/register run.
  await ctx.plugin({ apply(owner) { new HostConnectionService(owner, [], {}) } }).await()
  const mounted = ctx.plugin(recap)
  await mounted.await()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual([...routes].map(route => route.path), [recap.CHANNEL])
  await mounted.dispose()
  assert.equal(routes.size, 0, 'channel is disposed with its owning plugin')
})

test('target RPC core compatibility fix mounts and disposes a traced WebServer service', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const routes = new Set()
  class WebServer extends Service {
    constructor(owner) { super(owner, 'webServer') }
    register(route) { routes.add(route); return () => routes.delete(route) }
  }
  await ctx.plugin(WebServer).await()
  ctx.provide('sessions', { get() {} })
  ctx.provide('llm', {})
  ctx.provide('settings', { installSection() {} })
  await ctx.plugin({ apply(owner) { new HostConnectionService(owner, [], {}) } }).await()
  const mounted = ctx.plugin(recap)
  await mounted.await()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual([...routes].map(route => route.path), [recap.CHANNEL])
  await mounted.dispose()
  assert.equal(routes.size, 0, 'traced route is disposed with its owning plugin')
  await mounted.dispose()
  assert.equal(routes.size, 0, 'repeated disposal cannot restore or leak the route')
})
