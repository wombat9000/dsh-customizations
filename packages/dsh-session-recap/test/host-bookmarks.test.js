import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { registerTypeScript } from './fixtures/typescript.mjs'
registerTypeScript()
const { RecapRuntime } = await import('../src/runtime.ts')
const require = createRequire(import.meta.url)
const cordis = createRequire(require.resolve('@deepseek-ai/cordis'))
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const { default: Loader } = await import(cordis.resolve('@deepseek-ai/cordis-plugin-loader'))
const { default: SessionStore } = await import(cli.resolve('@deepseek-ai/dsh-session'))
const message = (id, text, role = 'user') => ({
  id,
  role,
  source: { kind: role === 'user' ? 'user' : 'model' },
  content: [{ type: 'text', text }],
})
const result = (request, supported = 'next_0') => ({
  model: 'typesafe/jev-1.13',
  answers: Object.fromEntries(
    Object.keys(request.questions).map((key) => [
      key,
      { type: 'noul', noul: key === supported ? 0.9 : 0.1 },
    ]),
  ),
})
function fixture() {
  const rows = [message('proposal', 'I propose adding a test.', 'model')]
  const session = { seq: 1, deriveMessages: () => rows, snapshotEvents: () => [] }
  const settings = { provider: 'fixture', model: 'writer', useJev: true, bookmarkJev: true }
  const evaluations = [],
    writes = []
  const service = {
    settings: () => ({ model: 'typesafe/jev-1.13' }),
    evaluate: async (request) => {
      evaluations.push(request)
      return result(request)
    },
  }
  const llm = {
    prepareCall: async (config) => ({
      config,
      async *stream(request) {
        writes.push(request)
        yield {
          type: 'text-delta',
          text: JSON.stringify(
            request.system.includes('Bookmark passages')
              ? { headline: 'Test proposal', cards: { next_step: 'A test was proposed.' } }
              : { bullets: ['A test was discussed.'] },
          ),
        }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }),
  }
  const runtime = new RecapRuntime({
    sessions: { get: () => session },
    settings: () => settings,
    getJev: () => service,
    llm,
  })
  return { runtime, rows, session, settings, evaluations, writes, service }
}
test('background work synchronizes with recap once and passes evidence-only writer input', async () => {
  const f = fixture()
  f.runtime.sessionEvent('s', 'turn/end')
  const recap = await f.runtime.recap({ sessionId: 's' })
  assert.equal(f.evaluations.length, 1)
  assert.equal(recap.selection.mode, 'bookmarks')
  assert.equal(recap.selection.bookmarks.items[0].status, 'proposed')
  assert.ok(!JSON.stringify(recap.selection).includes('I propose'))
  const input = JSON.parse(f.writes[0].messages[0].content[0].text)
  assert.equal(input.bookmarks[0].source.messageId, 'proposal')
  assert.match(f.writes[0].system, /proposals, not commitments/)
  assert.match(f.writes[0].system, /never certified truth/)
  const cached = await f.runtime.recap({ sessionId: 's' })
  assert.equal(cached.cached, true)
  assert.equal(f.evaluations.length, 1)
  assert.equal(f.writes.length, 1)
  f.runtime.dispose()
})
test('bookmark disabled leaves background silent; no active or unavailable uses standard without category evaluation', async () => {
  const f = fixture()
  f.settings.bookmarkJev = false
  f.runtime.sessionEvent('s', 'turn/end')
  assert.equal(f.evaluations.length, 0)
  f.settings.bookmarkJev = true
  f.service.evaluate = async (request) => {
    f.evaluations.push(request)
    return result(request, 'none')
  }
  let recap = await f.runtime.recap({ sessionId: 's' })
  assert.equal(recap.selection.mode, 'standard')
  assert.equal(recap.selection.reason, 'no-labels')
  assert.equal(f.evaluations.length, 1)
  assert.ok(!Object.hasOwn(f.evaluations[0].questions, 'support_direction'))
  f.runtime.invalidateBookmarks()
  f.service.evaluate = async () => {
    throw Error('PRIVATE')
  }
  recap = await f.runtime.recap({ sessionId: 's' })
  assert.equal(recap.selection.reason, 'unavailable')
  f.runtime.dispose()
})
test('Jev changed/stopped lifecycle signals never trigger a paid fallback writer', async () => {
  for (const code of ['changed', 'stopped']) {
    const f = fixture()
    f.service.evaluate = async () => {
      throw Object.assign(new Error('private'), { code })
    }
    await assert.rejects(f.runtime.recap({ sessionId: 's' }), { code: 'stale' })
    assert.equal(f.writes.length, 0)
    f.runtime.dispose()
  }
})

test('turn/start cancels ignored-abort evaluation and no late bookmark state publishes', async () => {
  const f = fixture()
  let release
  f.service.evaluate = () =>
    new Promise((resolve) => {
      release = resolve
    })
  f.runtime.sessionEvent('s', 'turn/end')
  const pending = f.runtime.bookmarks.pending.get('s').promise
  f.runtime.sessionEvent('s', 'turn/start')
  await pending
  assert.equal(f.runtime.bookmarks.pending.size, 0)
  release({ answers: { next_0: { type: 'noul', noul: 1 } } })
  await Promise.resolve()
  assert.equal(f.runtime.bookmarks.memories.size, 0)
  f.runtime.dispose()
})
test('actual Cordis + installed SessionStore event publishes committed session.id to source plugin listener', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.plugin(SessionStore)
  let handler
  const calls = []
  ctx.provide('llm', { listProviders: () => [], listModels: async () => [] })
  ctx.provide('connection', {
    rpc: {
      handle: (_channel, fn) => {
        handler = fn
        return () => {}
      },
    },
  })
  ctx.provide('webServer', {})
  ctx.provide('jev', {
    settings: () => ({ model: 'typesafe/jev-1.13' }),
    evaluate: async (request) => {
      calls.push(request)
      return result(request)
    },
  })
  await ctx.plugin(Loader, { baseUrl: import.meta.url }).await()
  await ctx.loader.create({
    id: 'bookmark-fixture',
    name: '../src/index.ts',
    config: { useJev: true, bookmarkJev: true },
  })
  await ctx.loader.await()
  assert.equal(typeof handler, 'function')
  const session = ctx.sessions.create('actual-session-id')
  session.append('turn/start', { turn: 1 })
  session.append('user/message', message('real-source-id', 'Please add a test.'), {
    surfaceOp: 'append',
  })
  assert.equal(calls.length, 0)
  session.append('turn/end', { turn: 1, reason: { kind: 'stop' } })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].state.conversation[0].messageId, 'real-source-id')
  assert.equal(session.snapshotEvents().at(-1).type, 'turn/end')
})
