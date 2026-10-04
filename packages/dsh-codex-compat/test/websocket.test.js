import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, findPackageJSON } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { CodexFastBridge } from '../dist/src/fast/bridge.js'
import { inferenceFixture, request, consume, gate } from './inference-fixture.js'

const require = createRequire(import.meta.url)
const piPackage = findPackageJSON(
  '@earendil-works/pi-ai',
  pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json')),
)
const api = await import(
  pathToFileURL(join(dirname(piPackage), 'dist/api/openai-codex-responses.js')).href
)
const fixtureJwt = `e30.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' } })).toString('base64url')}.fixture`

test(
  'onPayload completion commits Fast: Off cannot revoke a finalized body awaiting WebSocket opening',
  { timeout: 5000 },
  async (t) => {
    const f = await inferenceFixture(t)
    const snapshot = f.adapter.current()
    const originalSimple = snapshot.models.streamSimple
    const websocketDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket')
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
    const controller = new AbortController()
    const requested = gate()
    const connecting = gate()
    const frames = []
    const sockets = []
    let reports = 0
    let fetchCalls = 0
    let running
    const bridge = new CodexFastBridge(f.ctx.llm)

    // Only the transport is fake. The installed SDK constructs and serializes the body.
    class HeldWebSocket extends EventTarget {
      readyState = 0

      constructor() {
        super()
        sockets.push(this)
        connecting.resolve(this)
      }

      open() {
        this.readyState = 1
        this.dispatchEvent(new Event('open'))
      }

      send(frame) {
        frames.push(frame)
        // No server response or inference: abort immediately after capturing the real frame.
        controller.abort(new Error('synthetic WebSocket send captured'))
      }

      close() {
        if (this.readyState === 3) return
        this.readyState = 3
        this.dispatchEvent(new Event('close'))
      }
    }

    const fetch = async () => {
      fetchCalls++
      throw new Error('offline WebSocket test must never use fetch')
    }
    const abort = () => controller.abort(new Error('WebSocket test cleanup'))
    t.signal.addEventListener('abort', abort, { once: true })

    try {
      Object.defineProperty(globalThis, 'WebSocket', {
        configurable: true,
        writable: true,
        value: HeldWebSocket,
      })
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetch,
      })
      snapshot.models.streamSimple = (model, context, options) =>
        api.streamSimple(model, context, {
          ...options,
          apiKey: fixtureJwt,
          transport: 'websocket',
          fetch,
        })
      bridge.enable()
      f.ctx.on('llm/stream', (options, next) =>
        bridge.stream(options, next, {
          live: () => true,
          report() {
            reports++
            requested.resolve()
          },
        }),
      )
      running = consume(f.ctx.llm.stream(request('fast-session', { signal: controller.signal })))
      const [, socket] = await Promise.race([
        Promise.all([requested.promise, connecting.promise]),
        running.then(() => {
          throw new Error('stream ended before reporting priority and constructing a WebSocket')
        }),
      ])
      assert.equal(
        reports,
        1,
        'the final onPayload callback reports priority before transport opens',
      )
      assert.equal(sockets.length, 1)
      assert.equal(socket.readyState, 0)
      assert.deepEqual(frames, [], 'no response.create frame has been sent before Off')

      bridge.disable()
      assert.deepEqual(frames, [], 'turning Off does not itself send a frame')
      // Off revokes new calls and pending payload construction, not this finalized body.
      socket.open()
      const chunks = await running

      assert.equal(frames.length, 1, 'the committed in-flight request still sends exactly once')
      assert.equal(typeof frames[0], 'string', 'inspect the actual SDK-serialized transport frame')
      const frame = JSON.parse(frames[0])
      assert.equal(frame.type, 'response.create')
      assert.equal(
        frame.service_tier,
        'priority',
        'Off after onPayload cannot retract the committed tier',
      )
      assert.equal(frame.model, 'gpt-6-sol')
      assert.equal(reports, 1)
      assert.equal(fetchCalls, 0)
      assert.equal(chunks.find((chunk) => chunk.type === 'finish').reason.kind, 'aborted')
      assert.equal(socket.readyState, 3, 'aborting after send closes the SDK session socket')
    } finally {
      abort()
      try {
        if (running) await running
      } finally {
        bridge.disable()
        snapshot.models.streamSimple = originalSimple
        // pi-ai caches sockets and diagnostics by the bridge's distinct Fast session key.
        api.closeOpenAICodexWebSocketSessions('fast-session:dsh-codex-fast-v1')
        api.resetOpenAICodexWebSocketDebugStats('fast-session:dsh-codex-fast-v1')
        for (const socket of sockets) socket.close()
        t.signal.removeEventListener('abort', abort)
        if (websocketDescriptor) Object.defineProperty(globalThis, 'WebSocket', websocketDescriptor)
        else Reflect.deleteProperty(globalThis, 'WebSocket')
        if (fetchDescriptor) Object.defineProperty(globalThis, 'fetch', fetchDescriptor)
        else Reflect.deleteProperty(globalThis, 'fetch')
      }
    }
  },
)
