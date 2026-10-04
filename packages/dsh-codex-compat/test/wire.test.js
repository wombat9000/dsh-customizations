import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, findPackageJSON } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { CodexFastBridge } from '../dist/src/fast/bridge.js'
import { inferenceFixture, request, consume } from './inference-fixture.js'

const require = createRequire(import.meta.url)
const piPackage = findPackageJSON(
  '@earendil-works/pi-ai',
  pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json')),
)
const api = await import(
  pathToFileURL(join(dirname(piPackage), 'dist/api/openai-codex-responses.js')).href
)
const fixtureJwt = `e30.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' } })).toString('base64url')}.fixture`

test('actual pi-ai Codex serialization drops direct serviceTier but sends the bridge payload tier', async (t) => {
  const f = await inferenceFixture(t)
  const bodies = []
  const fetch = async (_url, init) => {
    const body =
      new Headers(init.headers).get('content-encoding') === 'zstd'
        ? zstdDecompressSync(init.body).toString('utf8')
        : String(init.body)
    bodies.push(JSON.parse(body))
    // Deliberate terminal response: prove serialization without a server or inference.
    return new Response(JSON.stringify({ error: { message: 'synthetic wire fixture' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const snapshot = f.adapter.current()
  const model = f.adapter.modelOf(snapshot, 'openai-codex', 'gpt-6-sol')
  const context = {
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'synthetic wire input' }], timestamp: 1 },
    ],
  }
  for await (const _event of api.streamSimple(model, context, {
    apiKey: fixtureJwt,
    transport: 'sse',
    fetch,
    serviceTier: 'priority',
    maxRetries: 0,
  })) {
    /* consume native terminal fixture */
  }
  assert.equal(
    bodies[0].service_tier,
    undefined,
    'negative control: pi simple drops the direct option',
  )
  snapshot.models.streamSimple = (resolved, history, options) =>
    api.streamSimple(resolved, history, { ...options, apiKey: fixtureJwt, transport: 'sse', fetch })
  const bridge = new CodexFastBridge(f.ctx.llm)
  bridge.enable()
  t.after(() => bridge.disable())
  let reports = 0
  f.ctx.on('llm/stream', (options, next) =>
    bridge.stream(
      options,
      next,
      options.sessionId === 'fast-session'
        ? {
            live: () => true,
            report() {
              reports++
            },
          }
        : null,
    ),
  )
  await consume(f.ctx.llm.stream(request()))
  await consume(f.ctx.llm.stream(request('standard-session')))
  assert.equal(bodies[1].service_tier, 'priority')
  assert.equal(bodies[2].service_tier, undefined)
  assert.equal(bodies[1].model, 'gpt-6-sol')
  assert.equal(bodies[1].stream, true)
  assert.equal(bodies[1].store, false)
  assert.equal(reports, 1)
})
