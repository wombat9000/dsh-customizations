import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Readable, Writable } from 'node:stream'
import * as Projects from '../dist/src/index.js'
import { config } from './fixtures.js'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = (name) => import(pathToFileURL(cli.resolve(name)).href)
const { Context } = await installed('@deepseek-ai/cordis')
const { HostConnectionService } = await installed('@deepseek-ai/dsh-client-connection')

// Real patched RC2 connection accessor, owner tracing, registration and HTTP parser.
// Only the socket listener and admission/authentication boundary are replaced.
class FixtureConnection extends HostConnectionService {
  constructor(ctx) {
    super(ctx, [], {})
  }
  admit() {
    return { peer: this.operator }
  }
}
async function send(
  route,
  endpoint,
  payload,
  { method = endpoint, body, contentType = 'application/json' } = {},
) {
  const req = Readable.from([
    Buffer.from(
      body ?? JSON.stringify({ type: 'client-request', rpcId: 'fixture-id', method, payload }),
    ),
  ])
  Object.assign(req, {
    url: `/projects/${endpoint}`,
    method: 'POST',
    headers: { 'content-type': contentType, host: 'fixture.invalid' },
  })
  const chunks = []
  let status
  const res = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(Buffer.from(chunk))
      done()
    },
  })
  res.writeHead = (code) => {
    status = code
  }
  await route.handler(req, res)
  return { status, text: Buffer.concat(chunks).toString('utf8') }
}

test('Projects physically mounts its RPC route through real caller-owned Connection and removes it on disposal', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const routes = new Map()
  ctx.provide('webServer', {
    register(route) {
      assert.equal(routes.has(route.path), false)
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  })
  // Dormant tool registry: this test isolates HTTP registration, not tool execution.
  ctx.provide('tools', { register() {} })
  await ctx.plugin(FixtureConnection).await()
  const plugin = ctx.plugin(Projects, { catalogJson: JSON.stringify(config()) })
  await plugin.await()
  const route = routes.get('/projects')
  assert.ok(route, 'rpc.handle must create an actual WebServer route in an admitted caller scope')
  assert.equal(route.kind, 'prefix')
  const catalog = await send(route, 'catalog', {})
  assert.equal(catalog.status, 200)
  const envelope = JSON.parse(catalog.text)
  assert.equal(envelope.type, 'server-response')
  assert.equal(envelope.rpcId, 'fixture-id')
  assert.equal(envelope.result.ok, true)
  assert.equal(envelope.result.value.projects[0].id, 'app')
  const unknown = JSON.parse((await send(route, 'delete', {})).text)
  assert.equal(unknown.result.error.code, 'invalid')
  const mismatch = JSON.parse((await send(route, 'catalog', {}, { method: 'configure' })).text)
  assert.equal(mismatch.result.error.code, 'gateway/bad-request')
  assert.equal((await send(route, 'catalog', {}, { body: '{' })).status, 400)
  assert.equal((await send(route, 'catalog', {}, { contentType: 'text/plain' })).status, 415)
  await plugin.dispose()
  assert.equal(routes.has('/projects'), false)
  assert.equal(ctx.get('projects'), undefined)
  assert.ok(ctx.get('connection'), 'Projects disposal must not dispose the shared connection')
})
