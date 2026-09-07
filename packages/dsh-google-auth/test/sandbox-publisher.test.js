import assert from 'node:assert/strict'
import test from 'node:test'
import { SandboxCallbackPublisher, apply, name } from '../src/sandbox-publisher.js'

function fixture(overrides = {}, options = {}) {
  const clients = []
  let loads = 0
  class BridgeClient {
    constructor(config) { this.config = config; this.calls = []; clients.push(this) }
    async open(args, signal) {
      this.calls.push(['open', args, signal])
      return overrides.open ? overrides.open(args, signal) : { url: 'http://127.0.0.1:45678', hostPort: 45678 }
    }
    async close(port) { this.calls.push(['close', port]); await overrides.close?.(port) }
    async dispose() { this.calls.push(['dispose']); await overrides.dispose?.() }
  }
  const publisher = new SandboxCallbackPublisher({ bridgeDir: '/configured/bridge',
    resolveBridge: () => '/optional/bridge/index.js',
    loadBridge: async () => { loads++; return { BridgeClient } }, ...options })
  return { publisher, clients, loads: () => loads }
}
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('direct mode and availability do not load or contact the bridge', async () => {
  const { publisher, loads, clients } = fixture()
  assert.equal(publisher.available(), true)
  assert.equal(publisher.available(), true)
  assert.equal(loads(), 0)
  assert.equal(clients.length, 0)
  await publisher.dispose()
  assert.equal(loads(), 0)
})

test('missing optional module fails early without loading', async () => {
  const { publisher, loads } = fixture({}, { resolveBridge() { throw new Error('secret path') } })
  assert.equal(publisher.available(), false)
  await assert.rejects(publisher.publish({ port: 1234 }), /publishing is unavailable/)
  assert.equal(loads(), 0)
})

test('configuration uses DSH_HOME without probing directories', () => {
  const { publisher } = fixture({}, { bridgeDir: undefined, env: { DSH_HOME: '/not-created' } })
  assert.equal(publisher.bridgeDir, '/not-created/sbx-bridge')
  assert.equal(publisher.available(), true)
  assert.equal(fixture({}, { bridgeDir: '' }).publisher.available(), false)
})

test('publication exposes only port and constant label; release runs once', async () => {
  const { publisher, clients } = fixture()
  const lease = await publisher.publish({ port: 1234, callbackUrl: 'secret', code: 'secret', token: 'secret' })
  assert.equal(lease.origin, 'http://127.0.0.1:45678')
  assert.deepEqual(clients[0].calls[0][1], { port: 1234, name: 'Google OAuth callback' })
  assert.deepEqual(clients[0].config, { bridgeDir: '/configured/bridge' })
  await Promise.all([lease.dispose(), lease.dispose(), publisher.dispose()])
  assert.deepEqual(clients[0].calls.slice(1), [['close', 1234], ['dispose']])
})

test('helper failure is sanitized and disposes its dedicated client', async () => {
  const { publisher, clients } = fixture({ open() { throw new Error('secret provider log') } })
  await assert.rejects(publisher.publish({ port: 1234 }), error => {
    assert.equal(error.message.includes('secret'), false)
    assert.equal(error.cause, undefined)
    return true
  })
  assert.deepEqual(clients[0].calls.slice(1), [['close', 1234], ['dispose']])
  await publisher.dispose()
})

test('failed close still disposes relays and returns a sanitized error', async () => {
  const { publisher, clients } = fixture({ close() { throw new Error('secret') } })
  const lease = await publisher.publish({ port: 1234 })
  await assert.rejects(lease.dispose(), { message: 'Could not release the sandbox callback publication.' })
  await assert.rejects(lease.dispose(), /Could not release/)
  await publisher.dispose()
  assert.deepEqual(clients[0].calls.slice(1), [['close', 1234], ['dispose']])
})

test('stop during abort-ignoring open rejects promptly and cleans eventual lease', async () => {
  const opened = deferred()
  const started = deferred()
  const { publisher, clients } = fixture({ open() { started.resolve(); return opened.promise } })
  const publishing = publisher.publish({ port: 1234 })
  await started.promise
  const stopped = publisher.dispose()
  await assert.rejects(publishing, /cancelled/)
  opened.resolve({ url: 'http://127.0.0.1:45678' })
  await stopped
  assert.deepEqual(clients[0].calls.slice(1), [['close', 1234], ['dispose']])
  assert.equal(publisher.pending.size, 0)
  assert.equal(publisher.available(), false)
})

test('abort during lazy load never constructs a client', async () => {
  const loaded = deferred()
  const { publisher, clients } = fixture({}, { loadBridge: () => loaded.promise })
  const publishing = publisher.publish({ port: 1234 })
  const stopped = publisher.dispose()
  await assert.rejects(publishing, /cancelled/)
  loaded.resolve({})
  await stopped
  assert.equal(clients.length, 0)
})

test('lease isolation includes concurrent publications of the same port', async () => {
  const { publisher, clients } = fixture()
  const [first, second] = await Promise.all([publisher.publish({ port: 1234 }), publisher.publish({ port: 1234 })])
  assert.equal(clients.length, 2)
  await first.dispose()
  assert.equal(clients[1].calls.length, 1)
  await second.dispose()
  await publisher.dispose()
  for (const client of clients) assert.deepEqual(client.calls.slice(1), [['close', 1234], ['dispose']])
})

test('caller cancellation after setup preserves the lease until explicit release', async () => {
  const controller = new AbortController()
  const { publisher, clients } = fixture()
  const lease = await publisher.publish({ port: 1234, signal: controller.signal })
  controller.abort(new Error('secret'))
  await Promise.resolve()
  assert.equal(clients[0].calls.length, 1)
  await lease.dispose()
  assert.deepEqual(clients[0].calls.slice(1), [['close', 1234], ['dispose']])
})

test('invalid input ports never load the optional bridge', async () => {
  const { publisher, loads } = fixture()
  for (const port of [0, -1, 65536, 1.5, '1234', undefined]) {
    await assert.rejects(publisher.publish({ port }), /Invalid sandbox callback port/)
  }
  assert.equal(loads(), 0)
})

test('rejects non-loopback, non-origin, and invalid host port results', async () => {
  for (const url of ['https://127.0.0.1:1234', 'http://evil.test:1234', 'http://localhost:1234',
    'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:1234/callback',
    'http://127.0.0.1:1234?code=secret', 'http://127.0.0.1:1234#secret', 'http://user@127.0.0.1:1234']) {
    const { publisher, clients } = fixture({ open: () => ({ url }) })
    await assert.rejects(publisher.publish({ port: 1234 }), /Could not publish/)
    assert.deepEqual(clients[0].calls.slice(1), [['close', 1234], ['dispose']])
  }
  const { publisher } = fixture({ open: () => ({ url: 'http://127.0.0.1:1234', hostPort: 4567 }) })
  await assert.rejects(publisher.publish({ port: 1234 }), /Could not publish/)
})

test('plugin provides a minimal facade with lifecycle cleanup', async () => {
  let service
  let stop
  apply({ provide(key, value) { assert.equal(key, 'sandboxCallbackPublisher'); service = value },
    effect(fn) { stop = fn() } }, { bridgeDir: '', loadBridge() { assert.fail('unexpected load') } })
  assert.equal(name, 'sandbox-callback-publisher')
  assert.deepEqual(Object.keys(service), ['available', 'publish'])
  assert.equal(service.available(), false)
  await stop()
})
