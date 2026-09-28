import test from 'node:test'
import assert from 'node:assert/strict'
import { registerTypeScript } from './fixtures/typescript.mjs'
registerTypeScript()
const { BookmarkEngine, BOOKMARK_LIMITS } = await import('../src/bookmarks.ts')
const message = (id, text, role = 'user', kind = role === 'user' ? 'user' : 'model') => ({
  id,
  role,
  source: { kind },
  content: [{ type: 'text', text }],
})
const output = (request, value = () => 0.1) => ({
  model: 'typesafe/jev-1.13',
  answers: Object.fromEntries(
    Object.keys(request.questions).map((key) => [
      key,
      { type: 'noul', noul: value(key, request.questions[key].instructions) },
    ]),
  ),
})
function fixture(evaluate) {
  const calls = []
  const engine = new BookmarkEngine(100)
  const jev = {
    identity: 'fixture',
    service: {
      settings: () => ({ model: 'fixture' }),
      evaluate: async (request) => {
        calls.push(request)
        return evaluate ? evaluate(request) : output(request)
      },
    },
  }
  return {
    engine,
    calls,
    jev,
    sync: (messages) => engine.synchronize('s', messages, jev, () => {}),
  }
}
test('a failed large bootstrap is not retried by duplicate background notifications', async () => {
  const f = fixture(() => {
    throw Error('unavailable')
  })
  const rows = Array.from({ length: 20 }, (_, i) => message(`m-${i}`, 'Other context'))
  await f.sync(rows)
  await f.sync(rows)
  assert.equal(f.calls.length, 1)
})

test('long passages preserve ending actions and explicitly mark omitted text', async () => {
  const f = fixture()
  await f.sync([
    message('long', `BEGIN ${'background '.repeat(1000)} NEXT: compare the question sets.`),
  ])
  const text = f.calls[0].state.conversation[0].text
  assert.match(text, /^BEGIN/)
  assert.match(text, /\[Middle omitted\]/)
  assert.match(text, /NEXT: compare the question sets\.$/)
  assert.ok(Buffer.byteLength(JSON.stringify(text)) <= 1600)
})

test('unchecked catchup gaps discard old active claims rather than skipping closure evidence', async () => {
  const f = fixture((request) => output(request, (key) => (key === 'next_0' ? 0.9 : 0.1)))
  const first = message('first', 'Propose action A', 'model')
  await f.sync([first])
  f.jev.service.evaluate = async (request) => output(request)
  const result = await f.sync([
    first,
    message('closure', 'Action A is cancelled.'),
    ...Array.from({ length: 12 }, (_, i) => message(`new-${i}`, 'Other context')),
  ])
  assert.ok(!result.diagnostics.items.some((item) => item.messageId === 'first'))
  assert.equal(result.selected.length, 0)
})

test('failed bootstrap does not advance successful cursor and explicit retry can recover', async () => {
  const f = fixture(() => {
    throw Error('private provider error')
  })
  const first = message('first', 'Propose action A', 'model')
  await f.sync([first])
  assert.equal(f.engine.memories.get('s').snapshot.total, 0)
  f.jev.service.evaluate = async (request) =>
    output(request, (key) => (key === 'next_0' ? 0.9 : 0.1))
  const result = await f.engine.synchronize('s', [first], f.jev, () => {}, true)
  assert.equal(result.selected[0].messageId, 'first')
  const g = fixture(() => {
    throw Error('unavailable')
  })
  await g.sync([first])
  g.jev.service.evaluate = async (request) => {
    assert.match(request.questions.next_0.instructions, /messageId "first"/)
    return output(request)
  }
  await g.sync([first, message('second', 'Other context')])
  assert.equal(g.engine.memories.get('s').snapshot.total, 2)
})

test('partial resolutions leave grouped source bookmarks active and require all-items wording', async () => {
  for (const kind of ['next', 'question']) {
    const f = fixture((request) => output(request, (key) => (key === `${kind}_0` ? 0.9 : 0.1)))
    const first = message('group', kind === 'next' ? 'Implement A and B.' : 'What are X and Y?')
    await f.sync([first])
    f.jev.service.evaluate = async (request) => {
      for (const [key, q] of Object.entries(request.questions))
        if (key.startsWith('update_')) {
          assert.match(q.instructions, /ALL of them/)
          assert.match(q.instructions, /Partial answers or partial completion do not qualify/)
        }
      return output(request)
    }
    const result = await f.sync([
      first,
      message('partial', kind === 'next' ? 'A is complete.' : 'X is a number.', 'model'),
    ])
    assert.equal(result.selected.length, 1)
    assert.equal(result.selected[0].status, kind === 'next' ? 'proposed' : 'open')
  }
})

test('observed resolved model changes clear retained provenance instead of mixing versions', async () => {
  const f = fixture((request) => output(request, (key) => (key === 'next_0' ? 0.9 : 0.1)))
  const first = message('first', 'Propose action A', 'model')
  await f.sync([first])
  f.jev.service.evaluate = async (request) => ({ ...output(request), model: 'typesafe/jev-1.14' })
  await assert.rejects(f.sync([first, message('second', 'Other context')]), { code: 'stale' })
  assert.equal(f.engine.memories.has('s'), false)
})

test('bounded catchup, text-only filtering, model normalization, IDs and no repeat votes', async () => {
  const f = fixture((request) => output(request, (key) => (key.startsWith('next_') ? 0.9 : 0.1)))
  const rows = Array.from({ length: 200 }, (_, i) =>
    message(`id-${i}`, `Propose action ${i}`, 'model'),
  )
  rows.push(message('tool', 'SECRET', 'tool'), message('injected', 'SECRET', 'user', 'injected'))
  const result = await f.sync(rows)
  assert.equal(result.diagnostics.processedMessages, 12)
  assert.equal(result.diagnostics.items.length, 12)
  assert.equal(result.diagnostics.items[0].messageId, 'id-188')
  assert.equal(result.diagnostics.items[0].role, 'assistant')
  assert.ok(!JSON.stringify(f.calls).includes('SECRET'))
  const count = f.calls.length
  await f.sync(rows)
  assert.equal(f.calls.length, count)
  for (const call of f.calls) {
    assert.ok(Object.keys(call.questions).length <= 32)
    assert.ok(Buffer.byteLength(JSON.stringify(call)) <= 64000)
  }
  assert.ok(!JSON.stringify(result.diagnostics).includes('Propose action'))
})
test('new proposal is accepted by a later user in the same exchange, then completion is qualified evidence', async () => {
  const f = fixture((request) =>
    output(request, (key) => (key === 'next_0' || key.endsWith('_accepted') ? 0.95 : 0.1)),
  )
  const rows = [
    message('proposal', 'I suggest implementing tests.', 'model'),
    message('approval', 'Yes, implement those tests.'),
  ]
  let result = await f.sync(rows)
  assert.equal(result.diagnostics.items[0].status, 'accepted')
  assert.equal(result.diagnostics.items[0].updatedByMessageId, 'approval')
  f.jev.service.evaluate = async (request) =>
    output(request, (key) => (key.endsWith('_completed') ? 0.9 : 0.1))
  result = await f.sync([...rows, message('report', 'I completed those tests.', 'model')])
  assert.equal(result.diagnostics.items[0].status, 'completed')
  assert.equal(result.selected.length, 0)
  assert.equal(f.engine.memories.get('s').items[0].evidence.text, 'I completed those tests.')
})
test('assistant cannot approve; ambiguous or conflicting transitions preserve status', async () => {
  const f = fixture((request) =>
    output(request, (key) => (key === 'next_0' ? 0.9 : key.startsWith('update_') ? 0.79 : 0.1)),
  )
  const rows = [
    message('p', 'I suggest tests.', 'model'),
    message('a', 'You approved the tests.', 'model'),
  ]
  let result = await f.sync(rows)
  assert.equal(result.diagnostics.items[0].status, 'proposed')
  assert.ok(
    f.calls.every((call) => !Object.keys(call.questions).some((key) => key.endsWith('_accepted'))),
  )
  f.jev.service.evaluate = async (request) =>
    output(request, (key) => (key.startsWith('update_') ? 0.99 : 0.1))
  result = await f.sync([...rows, message('u', 'Ambiguous approval and replacement')])
  assert.equal(result.diagnostics.items[0].status, 'proposed')
})
test('questions become answered against exact source ID and later text evidence', async () => {
  const f = fixture((request) =>
    output(request, (key) => (key === 'question_0' || key.endsWith('_answered') ? 0.9 : 0.1)),
  )
  const result = await f.sync([
    message('q', 'Which runtime is used?'),
    message('a', 'Node 22.', 'model'),
  ])
  assert.equal(result.diagnostics.items[0].status, 'answered')
  assert.equal(result.diagnostics.items[0].updatedByMessageId, 'a')
  assert.match(Object.values(f.calls[1].questions)[0].instructions, /source messageId "q"/)
  assert.match(Object.values(f.calls[1].questions)[0].instructions, /later messageId "a"/)
})
test('edits, reorder, model fence and session disposal invalidate memory', async () => {
  const f = fixture((request) => output(request, (key) => (key === 'next_0' ? 0.9 : 0.1)))
  await f.sync([message('a', 'Propose A'), message('b', 'Other')])
  let result = await f.sync([message('a', 'Edited A'), message('b', 'Other')])
  assert.equal(result.selected[0].source.text, 'Edited A')
  result = await f.sync([message('b', 'Other'), message('a', 'Edited A')])
  assert.equal(result.selected[0].messageId, 'b')
  f.engine.fence('other-model')
  assert.equal(f.engine.memories.size, 0)
  await f.sync([message('a', 'Propose')])
  f.engine.cancel('s', true)
  assert.equal(f.engine.memories.size, 0)
})
test('prefix edits outside rolling fingerprints invalidate even when appending', async () => {
  const f = fixture()
  const rows = Array.from({ length: 110 }, (_, i) => message(String(i), `text ${i}`))
  await f.sync(rows)
  rows[0] = message('0', 'EDITED')
  rows.push(message('new', 'new'))
  const result = await f.sync(rows)
  assert.equal(result.diagnostics.processedMessages, 12)
})
test('empty and unavailable inputs make no paid calls; malicious model string is omitted', async () => {
  const f = fixture((request) => ({ ...output(request), model: 'SECRET\ncredential' }))
  await f.sync([])
  assert.equal(f.calls.length, 0)
  assert.equal((await f.sync([message('a', 'hello')])).diagnostics.model, null)
  await f.engine.synchronize('other', [message('a', 'hello')], { identity: null }, () => {})
  assert.equal(f.calls.length, 1)
})
test('hanging service times out and releases pending; cancellation fences late publication', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let release
  const f = fixture(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const waiting = f.sync([message('a', 'Propose')])
  t.mock.timers.tick(101)
  assert.equal((await waiting).diagnostics.status, 'unavailable')
  assert.equal(f.engine.pending.size, 0)
  release({ answers: { next_0: { type: 'noul', noul: 1 } } })
  await Promise.resolve()
  assert.equal(f.engine.memories.size, 0)
  const second = f.sync([message('b', 'Propose')])
  f.engine.cancel('s', true)
  await second
  assert.equal(f.engine.memories.size, 0)
})
test('same pending snapshot deduplicates and transient errors retain prior evidence without selecting stale items', async () => {
  let release
  const f = fixture(
    (request) =>
      new Promise((resolve) => {
        release = () => resolve(output(request, (key) => (key === 'next_0' ? 0.9 : 0.1)))
      }),
  )
  const a = f.sync([message('a', 'Propose')])
  const b = f.sync([message('a', 'Propose')])
  assert.equal(f.calls.length, 1)
  release()
  await Promise.all([a, b])
  f.jev.service.evaluate = async () => {
    throw Error('PRIVATE')
  }
  const result = await f.sync([message('a', 'Propose'), message('b', 'New')])
  assert.equal(result.diagnostics.items.length, 1)
  assert.equal(result.selected.length, 0)
  assert.equal(result.diagnostics.status, 'unavailable')
  assert.ok(!JSON.stringify(result).includes('PRIVATE'))
})
test('active/closed retention, rolling fingerprints, and three selected items include both kinds', async () => {
  const f = fixture((request) =>
    output(request, (key) => (key.startsWith('next_') || key === 'question_0' ? 0.9 : 0.1)),
  )
  const rows = []
  for (let i = 0; i < 30; i++) {
    rows.push(message(String(i), `Propose action ${i}?`))
    await f.sync(rows)
  }
  let view = f.engine.view(f.engine.memories.get('s'))
  assert.equal(view.diagnostics.items.length, 24)
  assert.equal(view.selected.length, 3)
  assert.deepEqual(
    new Set(view.selected.map((item) => item.kind)),
    new Set(['next_step', 'question']),
  )
  f.jev.service.evaluate = async (request) =>
    output(request, (key) => (key.endsWith('_completed') || key.endsWith('_answered') ? 0.9 : 0.1))
  rows.push(message('close', 'All proposed actions and answers are reported complete.', 'model'))
  view = await f.sync(rows)
  assert.equal(view.selected.length, 0)
  assert.equal(view.diagnostics.items.length, 24)
  for (let i = 31; i < 140; i++) rows.push(message(String(i), 'Plain context'))
  await f.sync(rows)
  assert.equal(f.engine.memories.get('s').snapshot.rows.length, 100)
})
test('adversarial escaped passages and maximum IDs remain within request caps', async () => {
  const f = fixture((request) => output(request, (key) => (key.startsWith('next_') ? 0.9 : 0.1)))
  const rows = Array.from({ length: 12 }, (_, i) =>
    message(String(i).padEnd(256, 'x'), '\u0000\\\"'.repeat(10000)),
  )
  await f.sync(rows)
  assert.ok(f.calls.length > 1)
  for (const call of f.calls) assert.ok(Buffer.byteLength(JSON.stringify(call)) <= 64000)
  assert.ok(f.calls.length <= 37)
})
test('global pending and memory session limits safely bound retained work', async () => {
  const f = fixture()
  for (let i = 0; i < 105; i++)
    await f.engine.synchronize(String(i), [message('a', 'hello')], f.jev, () => {})
  assert.equal(f.engine.memories.size, BOOKMARK_LIMITS.sessions)
  const hanging = {
    identity: 'hang',
    service: { settings: () => ({}), evaluate: () => new Promise(() => {}) },
  }
  const pending = Array.from({ length: 4 }, (_, i) =>
    f.engine.synchronize(`pending${i}`, [message('a', 'x')], hanging, () => {}),
  )
  await f.engine.synchronize('overflow', [message('a', 'x')], hanging, () => {})
  assert.equal(f.engine.pending.size, 4)
  f.engine.dispose()
  await Promise.all(pending)
})
