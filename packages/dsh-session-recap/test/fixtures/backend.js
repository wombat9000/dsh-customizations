import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import * as recap from '../../dist/src/index.js'

// Match the Steward fixture: resolve only through the repository's pinned CLI.
const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = (name) => {
  const manifest = require(cli.resolve(`@deepseek-ai/${name}/package.json`))
  assert.equal(manifest.version, name === 'cordis' ? '4.0.2' : '0.1.5-rc.2')
  return import(pathToFileURL(cli.resolve(`@deepseek-ai/${name}`)).href)
}
const { Context, Service } = await installed('cordis')
const { HostConnectionService } = await installed('dsh-client-connection')
const { default: FileSettingsProvider } = await installed('dsh-settings-file')
const { default: SessionStore } = await installed('dsh-session')
const { default: JsonlSessionPersistence } = await installed('dsh-session-persistence-jsonl')
export const version = require(cli.resolve('@deepseek-ai/dsh/package.json')).version

export function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// Model calls use a deterministic fixture. Transport/auth adapters are documented
// below; settings and session persistence are real. Never mount live providers.
export function model() {
  const calls = []
  let gate
  return {
    calls,
    hold() {
      gate = { entered: deferred(), release: deferred() }
      return gate
    },
    listProviders: () => [{ id: 'fixture', name: 'Offline fixture' }],
    listModels: async () => [{ id: 'summary', name: 'Summary' }],
    async prepareCall(config) {
      return {
        config,
        inputModalities: config.model === 'image-only' ? ['image'] : ['text'],
        async *stream(request) {
          calls.push(request)
          const pending = gate
          gate = undefined
          if (pending) {
            pending.entered.resolve(request)
            await Promise.race([
              pending.release.promise,
              new Promise((resolve) =>
                request.signal.addEventListener('abort', resolve, { once: true }),
              ),
            ])
          }
          if (request.signal.aborted) return
          yield {
            type: 'text-delta',
            text: JSON.stringify({
              headline: 'Session restored',
              bullets: ['The user plans an offline integration test.'],
            }),
          }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  }
}

const contexts = new Map()

export async function state(t) {
  const directory = await mkdtemp(join(tmpdir(), 'recap-backend-'))
  const previous = process.env.DSH_HOME
  const owned = []
  contexts.set(directory, owned)
  process.env.DSH_HOME = directory
  t.after(async () => {
    try {
      // Drain real persistence before removing state, even after an assertion fails.
      for (const ctx of owned.toReversed()) await ctx.fiber.dispose()
    } finally {
      contexts.delete(directory)
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(directory, { recursive: true, force: true })
    }
  })
  return directory
}

export async function backend(t, directory, llm = model()) {
  assert.ok(contexts.has(directory), 'backend requires fixture-owned temporary state')
  const ctx = new Context()
  contexts.get(directory).push(ctx)
  const routes = new Map()
  // Deliberate transport adapters: a traced route registry and memory streams
  // replace the listening HTTP server/socket, not Connection's RPC machinery.
  class DormantWebServer extends Service {
    constructor(owner) {
      super(owner, 'webServer')
    }
    register(route) {
      assert.equal(routes.has(route.path), false, 'duplicate RPC route')
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    }
  }
  await ctx.plugin(DormantWebServer).await()
  await ctx
    .plugin(FileSettingsProvider, { path: join(directory, 'settings.json'), watch: false })
    .await()
  await ctx.plugin(SessionStore).await()
  await ctx
    .plugin(JsonlSessionPersistence, { root: join(directory, 'sessions'), compression: 'none' })
    .await()
  assert.ok(ctx.settings instanceof FileSettingsProvider)
  assert.ok(ctx.sessions instanceof SessionStore)
  assert.ok(ctx.sessionPersistence instanceof JsonlSessionPersistence)
  ctx.provide('llm', llm)
  // Authentication is a fixed fixture capability. This does not test login,
  // cookies, browser auth persistence, or the live WebServer routing stack.
  await ctx
    .plugin({
      apply(owner) {
        new HostConnectionService(owner, [], {
          isAuthenticated: (req) => req.headers.authorization === 'fixture',
        })
      },
    })
    .await()
  let mounted
  async function mount() {
    mounted = ctx.plugin(recap)
    await mounted.await()
    assert.equal(routes.has(recap.CHANNEL), true)
  }
  await mount()
  let rpcId = 0
  async function request(endpoint, payload = {}, headers = {}) {
    const route = routes.get(recap.CHANNEL)
    if (!route) return { status: 404 }
    const id = `fixture-${++rpcId}`
    const req = Readable.from([
      Buffer.from(JSON.stringify({ type: 'client-request', rpcId: id, method: endpoint, payload })),
    ])
    req.method = 'POST'
    req.url = `${recap.CHANNEL}/${endpoint}`
    req.headers = {
      host: 'localhost',
      authorization: 'fixture',
      'content-type': 'application/json',
      ...headers,
    }
    const chunks = []
    const res = new Writable({
      write(chunk, encoding, done) {
        chunks.push(Buffer.from(chunk))
        done()
      },
    })
    res.writeHead = (status) => {
      res.status = status
    }
    await route.handler(req, res)
    const text = Buffer.concat(chunks).toString()
    if (res.status !== 200) return { status: res.status, text }
    const envelope = JSON.parse(text)
    assert.equal(envelope.type, 'server-response')
    assert.equal(envelope.rpcId, id)
    return { status: res.status, result: envelope.result }
  }
  async function rpc(endpoint, payload) {
    const response = await request(endpoint, payload)
    assert.equal(response.status, 200)
    return response.result
  }
  async function createSession(id = 'recap-session') {
    const session = ctx.sessions.create(id)
    await ctx.sessionPersistence.create(session.header)
    return session
  }
  async function restoreSession(id = 'recap-session') {
    const handle = await ctx.sessionPersistence.open(id, 'write')
    const stored = await handle.read()
    const session = ctx.sessions.create(id, {
      seed: stored.events,
      meta: handle.header,
      eventState: stored.eventState,
      inheritedEventCount: handle.inheritedEventCount,
    })
    // The dormant fixture owns the load transaction normally owned by AgentLoop.
    // Session adds its real end-seed marker before publication; persist that tail.
    await handle.append(session.snapshotEvents(stored.events.length))
    return session
  }
  return {
    ctx,
    routes,
    llm,
    rpc,
    request,
    mount,
    createSession,
    restoreSession,
    unmount: () => mounted.dispose(),
    close: () => ctx.fiber.dispose(),
  }
}

export function userMessage(session, text = 'Plan an offline integration test.') {
  return session.append(
    'user/message',
    {
      id: `user-${session.seq}`,
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text }],
    },
    { surfaceOp: 'append' },
  )
}
