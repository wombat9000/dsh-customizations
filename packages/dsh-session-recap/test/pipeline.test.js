import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import * as openrouter from '../../dsh-openrouter/src/index.js'
import * as jev from '../../dsh-jev/src/index.js'
import * as recap from '../dist/src/index.js'

// Real Cordis service binding across all three packages. Only credentials, HTTP,
// persistence, and the writing model are fixtures; no provider is contacted.
test('shared credentials -> Jev -> constrained writer works through real Cordis and falls back on removal', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const sections = new Map([
    ['llm-pi-ai', { providers: {} }],
    ['wombat9000-session-recap', { provider: 'fixture', model: 'writer', useJev: true }],
  ])
  ctx.provide('settings', {
    get: (ns) => sections.get(ns),
    installSection(owner, ns, schema, defaults, hooks) {
      sections.set(ns, { ...defaults, ...sections.get(ns) })
      hooks.setSource(() => sections.get(ns))
    },
    async update(ns, value) {
      sections.set(ns, { ...sections.get(ns), ...value })
    },
  })
  const credentialReads = []
  ctx.provide('credentials', {
    async readRecord(key) {
      credentialReads.push(key)
      return { kind: 'api-key', key: 'test-only-shared-key' }
    },
    async describeRecord() {
      return { configured: true, kind: 'api-key', writable: true }
    },
    async describe() {
      return { configured: false, writable: true }
    },
  })
  const routes = new Map()
  ctx.provide('connection', {
    rpc: {
      handle(channel, handler) {
        routes.set(channel, handler)
        return () => routes.delete(channel)
      },
    },
  })
  ctx.provide('webServer', {})
  ctx.provide('sessions', { get: () => ({ seq: 1, deriveMessages: () => [] }) })
  const session = {
    seq: 1,
    deriveMessages: () => [
      {
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Use fixed labels. How should cards be arranged?' }],
      },
    ],
  }
  // Use the same stable session identity across reads, matching DSH's session store.
  ctx.sessions.get = () => session
  const calls = []
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push('jev')
    assert.equal(url, 'https://openrouter.ai/api/alpha/decisions')
    assert.equal(options.headers.Authorization, 'Bearer test-only-shared-key')
    assert.equal(options.redirect, 'error')
    const body = JSON.parse(options.body)
    assert.equal(body.state.conversation[0].text, session.deriveMessages()[0].content[0].text)
    const answers = Object.fromEntries(
      Object.entries(body.questions).map(([id, q]) => {
        const useful = id.endsWith('_decision') || id.endsWith('_question')
        return [
          id,
          q.type === 'noul'
            ? { type: 'noul', noul: useful ? 0.95 : 0.1 }
            : {
                type: 'score',
                score: useful ? 3 : 0,
                confidence: 0.95,
                probabilities: Object.fromEntries(
                  q.criteria.map((_, i) => [i, i === (useful ? 3 : 0) ? 1 : 0]),
                ),
                legend: Object.fromEntries(q.criteria.map((v, i) => [i, v])),
              },
        ]
      }),
    )
    return new Response(JSON.stringify({ model: body.model, answers }))
  })
  ctx.provide('llm', {
    async prepareCall(config) {
      return {
        config,
        async *stream(request) {
          calls.push('writer')
          const value = request.system.includes('cards is an object')
            ? {
                headline: 'Visual recap cards',
                cards: {
                  decision: 'Use fixed labels.',
                  question: 'How should the cards be arranged?',
                },
              }
            : {
                headline: 'Visual recap cards',
                bullets: ['Use fixed labels; layout remains open.'],
              }
          yield { type: 'text-delta', text: JSON.stringify(value) }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  })
  const routerMount = ctx.plugin(openrouter)
  await routerMount.await()
  const jevMount = ctx.plugin(jev)
  await jevMount.await()
  const recapMount = ctx.plugin(recap)
  await recapMount.await()
  const handler = routes.get('/session-recap')
  const first = await handler('recap', { sessionId: 'fixture' })
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(first.value.selection.mode, 'jev')
  assert.deepEqual(
    first.value.recap.cards.map((card) => card.label),
    ['decision', 'question'],
  )
  assert.deepEqual(calls, ['jev', 'writer'])
  assert.ok(credentialReads.every((key) => key === 'llm-pi-ai/openrouter'))
  assert.ok(!JSON.stringify(first).includes('test-only-shared-key'))
  assert.equal((await handler('recap', { sessionId: 'fixture' })).value.cached, true)
  await jevMount.dispose()
  const fallback = await handler('recap', { sessionId: 'fixture' })
  assert.equal(fallback.ok, true, JSON.stringify(fallback))
  assert.equal(fallback.value.selection.mode, 'standard')
  assert.equal(fallback.value.selection.reason, 'unavailable')
  assert.equal(fallback.value.selection.diagnostics.status, 'unavailable')
  assert.deepEqual(calls, ['jev', 'writer', 'writer'])
  assert.equal(fetchMock.mock.callCount(), 1)
  await recapMount.dispose()
  await routerMount.dispose()
  assert.equal(routes.size, 0)
})
