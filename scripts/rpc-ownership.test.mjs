import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const launcher = require.resolve('@deepseek-ai/dsh/package.json')
const webRequire = createRequire(createRequire(launcher).resolve('@deepseek-ai/dsh-web-app'))
const { Context, Service } = await import(pathToFileURL(webRequire.resolve('@deepseek-ai/cordis')))
const { HostConnectionService } = await import(
  pathToFileURL(webRequire.resolve('@deepseek-ai/dsh-client-connection'))
)

// Exercise published target artifacts without starting HTTP, loading a profile,
// reading personal credentials, or depending on any customization plugin.
for (const traced of [false, true]) {
  test(`RPC registration belongs to its consumer (${traced ? 'traced' : 'plain'} WebServer)`, async (t) => {
    const ctx = new Context()
    t.after(() => ctx.fiber.dispose())
    const routes = new Set()
    const register = (route) => {
      routes.add(route)
      return () => routes.delete(route)
    }
    if (traced) {
      class WebServer extends Service {
        constructor(owner) {
          super(owner, 'webServer')
        }
        register(route) {
          return register(route)
        }
      }
      await ctx.plugin(WebServer).await()
    } else {
      ctx.provide('webServer', { register })
    }
    await ctx
      .plugin({
        name: 'connection-fixture',
        apply(owner) {
          new HostConnectionService(owner, [], {})
        },
      })
      .await()
    const consumer = ctx.plugin({
      name: 'rpc-consumer-fixture',
      inject: ['connection', 'webServer'],
      apply(owner) {
        owner.connection.rpc.handle('/ownership-test', async () => ({ ok: true, value: null }))
      },
    })
    await consumer.await()
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(
      [...routes].map((route) => route.path),
      ['/ownership-test'],
    )
    await consumer.dispose()
    assert.equal(routes.size, 0, 'disposing the consumer removes its route')
    await consumer.dispose()
    assert.equal(routes.size, 0, 'repeated disposal leaves no route')
  })
}
