import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { registerScoutTools } from '../dist/src/tools.js'
// Reuse the repository's real DSH Tools/UserApproval/Session fixture. No GitHub API is used.
import { approvalHost } from '../../dsh-github/test/approval-fixture.js'

const MODEL = 'typesafe/jev-1.13'
const ARGS = {
  path: 'src/a.ts',
  questions: [{ id: 'auth', question: 'Does file.content implement permission checks?' }],
}
function filesystem() {
  const files = new Map([
    ['src/a.ts', 'export function authorize() { return true }'],
    ['src/b.ts', 'export const b = 1'],
  ])
  const paths = ['.', 'src', ...files.keys()]
  const targets = new Map(
    paths.map((path, i) => [path, { targetKey: `opaque-${i}`, displayPath: 'remote://opaque' }]),
  )
  const reverse = new Map([...targets].map(([p, t]) => [t.targetKey, p]))
  const infos = (p) =>
    p === '.' || p === 'src'
      ? { type: 'directory', version: 'v1' }
      : files.has(p)
        ? { type: 'file', version: 'v1', size: Buffer.byteLength(files.get(p)) }
        : undefined
  const reads = []
  return {
    files,
    reads,
    fs: {
      async resolve(path, { cwd, signal }) {
        signal?.throwIfAborted()
        assert.ok(cwd.startsWith('/'))
        const target = targets.get(path)
        if (!target) throw new Error('unavailable')
        return target
      },
      contains(_root, child) {
        return reverse.has(child.targetKey)
      },
      async lstat(path) {
        return infos(path)
      },
      async stat(target) {
        return infos(reverse.get(target.targetKey))
      },
      async listDir(target) {
        const path = reverse.get(target.targetKey)
        return path === '.'
          ? [{ name: 'src', type: 'directory', target: targets.get('src') }]
          : [...files.keys()].map((p) => ({
              name: p.slice(4),
              type: 'file',
              target: targets.get(p),
            }))
      },
      async readBytes(target, signal, max) {
        signal.throwIfAborted()
        const path = reverse.get(target.targetKey)
        reads.push(path)
        const data = Buffer.from(files.get(path))
        assert.ok(data.length <= max)
        return data
      },
    },
  }
}
async function fixture(t, options = {}) {
  const host = await approvalHost(t, options)
  const fs = filesystem()
  const calls = []
  let model = MODEL
  const jev = {
    settings: () => ({ model }),
    async evaluate(input) {
      calls.push(input)
      assert.ok(Object.isFrozen(input.questions))
      return {
        model,
        answers: Object.fromEntries(
          Object.entries(input.questions).map(([id, q]) => [
            id,
            q.type === 'noul'
              ? { type: 'noul', noul: 0.8 }
              : q.type === 'choice'
                ? {
                    type: 'choice',
                    choice: Object.keys(q.criteria)[0],
                    confidence: 1,
                    probabilities: Object.fromEntries(
                      Object.keys(q.criteria).map((key, i) => [key, i === 0 ? 1 : 0]),
                    ),
                  }
                : {
                    type: 'score',
                    score: 0,
                    confidence: 1,
                    legend: Object.fromEntries(q.criteria.map((s, i) => [i, s])),
                    probabilities: Object.fromEntries(
                      q.criteria.map((_, i) => [i, i === 0 ? 1 : 0]),
                    ),
                  },
          ]),
        ),
        usage: { input_tokens: 10, output_tokens: 2, cost: 0.001 },
      }
    },
  }
  host.ctx.provide('fs', fs.fs)
  host.ctx.provide('jev', jev)
  const registration = host.ctx.plugin({
    name: 'scout-test-tools',
    inject: ['tools', 'fs'],
    apply: registerScoutTools,
  })
  await registration.await()
  return {
    ...host,
    ...fs,
    calls,
    jev,
    registration,
    changeModel(value) {
      model = value
    },
  }
}

test('native approval and real output validation cover all four tools without leaking source', async (t) => {
  const variants = [
    ['ask_file', ARGS],
    [
      'classify_file',
      {
        path: 'src/a.ts',
        questions: [
          {
            id: 'layer',
            question: 'Primary layer?',
            choices: [
              { id: 'domain', description: 'Domain logic' },
              { id: 'other', description: 'Other or insufficient evidence' },
            ],
          },
        ],
      },
    ],
    [
      'score_file',
      {
        path: 'src/a.ts',
        questions: [
          {
            id: 'fit',
            question: 'How directly relevant?',
            levels: ['No relevant implementation', 'Direct implementation'],
          },
        ],
      },
    ],
    [
      'scout_files',
      { pattern: 'src/*.ts', question: 'Does file.content implement permission checks?' },
    ],
  ]
  for (const [name, args] of variants)
    await t.test(name, async (t) => {
      const host = await fixture(t, { answer: 'allowed-once' })
      const result = await host.execute(name, args)
      assert.equal(result.isError, false, JSON.stringify(result))
      assert.equal(host.requests.length, 1)
      const reason = host.requests[0].reason
      assert.match(reason, /OpenRouter \/ TypeSafe/)
      assert.match(reason, /Charges may apply/)
      assert.match(
        reason,
        new RegExp(createHash('sha256').update(host.files.get('src/a.ts')).digest('hex')),
      )
      assert.equal(reason.includes('export function'), false)
      assert.equal(JSON.stringify(result).includes('export function'), false)
      assert.equal(host.calls.length, name === 'scout_files' ? 2 : 1)
      assert.deepEqual(
        host.audit().map((e) => e.type),
        ['approval/asked', 'approval/decided'],
      )
      assert.equal(host.audit()[1].data.outcome, 'allowed-once')
      assert.ok(host.calls.every((call) => call.signal instanceof AbortSignal))
    })
})

test('denied, unavailable, missing and disabled approval make zero Jev calls', async (t) => {
  for (const options of [
    { answer: 'rejected' },
    { answer: 'unavailable' },
    {},
    { answer: 'yes' },
    { approval: false, answer: 'allowed-once' },
    { policy: 'never', answer: 'allowed-once' },
    { openTurn: false, answer: 'allowed-once' },
  ])
    await t.test(JSON.stringify(options), async (t) => {
      const host = await fixture(t, options)
      const result = await host.execute('ask_file', ARGS)
      assert.equal(result.isError, true)
      assert.equal(host.calls.length, 0)
    })
})

test('direct execution and consumed-token replay cannot dispatch', async (t) => {
  const host = await fixture(t, { answer: 'allowed-once' })
  const tool = host.tools.get('ask_file')
  await assert.rejects(
    tool.execute(ARGS, {
      name: 'ask_file',
      token: {},
      agent: host.agent,
      arguments: ARGS,
      signal: new AbortController().signal,
    }),
    /one-shot/,
  )
  let captured
  host.ctx.on('tools/execute', async (exec, next) => {
    captured = exec
    return next()
  })
  assert.equal((await host.execute('ask_file', ARGS)).isError, false)
  await assert.rejects(tool.execute(ARGS, captured), /one-shot/)
  assert.equal(host.calls.length, 1)
})

test('approval binds immutable content snapshots, not subsequently modified files', async (t) => {
  let host
  host = await fixture(t, {
    answer: () => {
      host.files.set('src/a.ts', 'changed after approval')
      return 'allowed-once'
    },
  })
  const original = host.files.get('src/a.ts')
  const result = await host.execute('ask_file', ARGS)
  assert.equal(result.isError, false)
  assert.equal(host.calls[0].state.file.content, original)
})

test('model changes after approval prevent all dispatch', async (t) => {
  let host
  host = await fixture(t, {
    answer: () => {
      host.changeModel('typesafe/jev-other')
      return 'allowed-once'
    },
  })
  const result = await host.execute('ask_file', ARGS)
  assert.equal(host.calls.length, 0)
  assert.equal(result.value.files[0].reason, 'model_changed')
})

test('cwd and calling-agent identity cannot be changed after preparation', async (t) => {
  let host
  host = await fixture(t, {
    answer: () => {
      host.agent.session.header.cwd = '/different'
      return 'allowed-once'
    },
  })
  const result = await host.execute('ask_file', ARGS)
  assert.equal(result.isError, true)
  assert.equal(host.calls.length, 0)
})

test('cancellation during native approval makes zero provider calls', async (t) => {
  const controller = new AbortController()
  const host = await fixture(t, {
    answer: () => {
      controller.abort()
      return new Promise(() => {})
    },
  })
  const result = await host.execute('ask_file', ARGS, { signal: controller.signal })
  assert.equal(result.isError, true)
  assert.equal(host.calls.length, 0)
})

test('downstream policy denial cannot be overridden by Scout consent', async (t) => {
  const host = await fixture(t, { answer: 'allowed-once' })
  host.ctx.on('tools/pre-execute', async (exec, next) =>
    exec.name === 'ask_file' ? { kind: 'deny', reason: 'test-policy' } : next(),
  )
  assert.equal((await host.execute('ask_file', ARGS)).isError, true)
  assert.equal(host.calls.length, 0)
  assert.equal(host.requests.length, 0)
})

test('localized downstream asks retain both policy text and Scout disclosure', async (t) => {
  const host = await fixture(t, { answer: 'allowed-once' })
  host.ctx.on('tools/pre-execute', async (_exec, _next) => ({
    kind: 'ask',
    displayReason: { en: 'MANDATORY policy information', de: 'Wichtige Richtlinie' },
  }))
  const result = await host.execute('ask_file', ARGS)
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.match(host.requests[0].reason, /MANDATORY/)
  for (const value of Object.values(host.requests[0].displayReason))
    assert.match(value, /OpenRouter \/ TypeSafe/)
  assert.match(host.requests[0].displayReason.de, /Wichtige Richtlinie/)
  assert.equal(host.requests.length, 1)
})

for (const action of ['expiry', 'unload'])
  test(`${action} cancels the native approval prompt and queued evaluation`, async (t) => {
    let announce
    const asked = new Promise((resolve) => {
      announce = resolve
    })
    const host = await fixture(t, {
      answer: () => {
        announce()
        return new Promise(() => {})
      },
    })
    if (action === 'expiry') t.mock.timers.enable({ apis: ['setTimeout'] })
    const pending = host.execute('ask_file', ARGS)
    await asked
    if (action === 'expiry') t.mock.timers.tick(120_000)
    else host.registration.dispose()
    const result = await pending
    assert.equal(result.isError, true)
    assert.equal(host.requests[0].signal.aborted, true)
    assert.equal(host.calls.length, 0)
    assert.equal(host.audit().at(-1).data.outcome, 'cancelled')
  })

test('empty discovery is local-only and does not request paid approval', async (t) => {
  const host = await fixture(t, { answer: 'allowed-once' })
  const result = await host.execute('scout_files', { pattern: 'src/*.py', question: 'Relevant?' })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(host.calls.length, 0)
  assert.equal(host.requests.length, 0)
})
