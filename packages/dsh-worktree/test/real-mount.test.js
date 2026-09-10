import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import WorktreeService from '../src/index.js'
import { CHANNEL } from '../src/snapshot.js'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const { HostConnectionService } = await import(pathToFileURL(cli.resolve('@deepseek-ai/dsh-client-connection')))

test('real host RPC mounts optional Worktree channel without GUI startup', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const service of WorktreeService.inject) ctx.provide(service, {})
  const mounted = ctx.plugin(WorktreeService)
  await mounted.await()
  assert.ok(ctx.get('worktreeWorkers'), 'agent service works without Web services')
  const routes = new Set()
  ctx.provide('webServer', { register(route) { routes.add(route); return () => routes.delete(route) } })
  // Real Cordis service rebinding and real caller-scoped rpc getter/register;
  // only the dormant route registry boundary is simulated (no listener).
  await ctx.plugin({ apply(owner) { new HostConnectionService(owner, [], {}) } }).await()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual([...routes].map(route => route.path), [CHANNEL])
  await mounted.dispose()
  assert.equal(routes.size, 0, 'optional channel belongs to Worktree lifetime')
})
