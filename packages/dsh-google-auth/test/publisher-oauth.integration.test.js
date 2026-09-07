import assert from 'node:assert/strict'
import { createServer, connect } from 'node:net'
import test from 'node:test'
import { GoogleOAuthClient } from '../src/oauth.js'
import { SandboxCallbackPublisher } from '../src/sandbox-publisher.js'

const SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly'

// Exercise the real publisher/engine boundary with a byte-preserving relay.
// The fake BridgeClient deliberately tears down sockets immediately on release,
// matching the deployment bridge's public cleanup contract. No host helper runs.
for (const outcome of ['success', 'denied']) {
  test(`real adapter preserves forwarded ${outcome} response before lease release`, async t => {
    const instances = []
    class BridgeClient {
      constructor() { this.sockets = new Set(); this.closes = 0; this.disposals = 0; instances.push(this) }
      async open({ port, name }) {
        assert.equal(name, 'Google OAuth callback')
        this.internalPort = port
        this.server = createServer(incoming => {
          const outgoing = connect(port, '127.0.0.1')
          for (const socket of [incoming, outgoing]) {
            this.sockets.add(socket)
            socket.on('close', () => this.sockets.delete(socket))
            socket.on('error', () => { incoming.destroy(); outgoing.destroy() })
          }
          incoming.pipe(outgoing)
          outgoing.pipe(incoming)
        })
        await new Promise((resolve, reject) => {
          this.server.once('error', reject)
          this.server.listen(0, '127.0.0.1', resolve)
        })
        this.publicPort = this.server.address().port
        return { url: `http://127.0.0.1:${this.publicPort}`, hostPort: this.publicPort }
      }
      async close(port) {
        this.closes++
        assert.equal(port, this.internalPort)
        for (const socket of this.sockets) socket.destroy()
        if (this.server?.listening) await new Promise(resolve => this.server.close(resolve))
      }
      async dispose() { this.disposals++ }
    }
    const publisher = new SandboxCallbackPublisher({ bridgeDir: '/unused-fixture',
      resolveBridge: () => 'fixture', loadBridge: async () => ({ BridgeClient }) })
    let saved
    const exchanges = []
    const client = new GoogleOAuthClient({ clientId: 'fixture-client',
      credentials: { get: async () => saved, set: async (value, valid) => { if (valid()) saved = value }, delete: async () => { saved = undefined } },
      fetch: async (url, options) => {
        exchanges.push({ url, options })
        const data = url.includes('userinfo') ? { sub: 'fixture-account' }
          : { access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'Bearer', expires_in: 3600 }
        return new Response(JSON.stringify(data))
      },
    })
    t.after(async () => { await client.dispose(); await publisher.dispose() })
    const started = await client.begin({ scopes: [SCOPE], publishCallback: (port, signal) => publisher.publish({ port, signal }) })
    const auth = new URL(started.authorizationUrl)
    const redirect = auth.searchParams.get('redirect_uri')
    const callback = new URL(redirect)
    assert.notEqual(instances[0].internalPort, instances[0].publicPort)
    assert.equal(callback.port, String(instances[0].publicPort))
    callback.searchParams.set('state', auth.searchParams.get('state'))
    callback.searchParams.set(outcome === 'success' ? 'code' : 'error', outcome === 'success' ? 'fixture-code' : 'access_denied')
    const response = await fetch(callback)
    assert.equal(response.status, outcome === 'success' ? 200 : 400)
    assert.match(await response.text(), outcome === 'success' ? /You can close this tab/ : /not authorized/)
    for (let attempt = 0; attempt < 200 && (await client.status()).pending; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal((await client.status()).pending, false)
    await client.cleanup()
    assert.equal(instances[0].closes, 1)
    assert.equal(instances[0].disposals, 1)
    assert.equal(publisher.leases.size, 0)
    assert.equal((await client.status()).connected, outcome === 'success')
    if (outcome === 'success') assert.equal(exchanges[0].options.body.get('redirect_uri'), redirect)
    else assert.equal(exchanges.length, 0)
  })
}
