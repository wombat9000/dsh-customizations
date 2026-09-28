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

test('all four tools evaluate without approval and without leaking source', async (t) => {
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
              { id: 'other', description: 'Other' },
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
          { id: 'fit', question: 'How relevant?', levels: ['Unrelated', 'Direct implementation'] },
        ],
      },
    ],
    ['scout_files', { pattern: 'src/*.ts', question: 'Relevant?' }],
  ]
  for (const [name, args] of variants)
    await t.test(name, async (t) => {
      const host = await fixture(t, { approval: false })
      const result = await host.execute(name, args)
      assert.equal(result.isError, false, JSON.stringify(result))
      assert.equal(host.calls.length, name === 'scout_files' ? 2 : 1)
      assert.equal(host.requests.length, 0)
      assert.deepEqual(host.audit(), [])
      assert.equal(JSON.stringify(result).includes('export function'), false)
      assert.equal(
        result.value.files[0].sha256,
        createHash('sha256').update(host.files.get('src/a.ts')).digest('hex'),
      )
      assert.ok(host.calls.every((call) => call.signal instanceof AbortSignal))
    })
})

test('Scout does not invoke installed answerers or require an approval policy', async (t) => {
  for (const options of [
    { answer: 'rejected' },
    { answer: 'unavailable' },
    { policy: 'never' },
    { openTurn: false },
  ])
    await t.test(JSON.stringify(options), async (t) => {
      const host = await fixture(t, options)
      const result = await host.execute('ask_file', ARGS)
      assert.equal(result.isError, false, JSON.stringify(result))
      assert.equal(host.calls.length, 1)
      assert.equal(host.requests.length, 0)
      assert.deepEqual(host.audit(), [])
    })
})

test('direct execution and consumed-token replay cannot dispatch', async (t) => {
  const host = await fixture(t, { approval: false })
  const tool = host.tools.get('ask_file')
  await assert.rejects(
    tool.execute(ARGS, {
      name: 'ask_file',
      token: {},
      agent: host.agent,
      arguments: ARGS,
      signal: new AbortController().signal,
    }),
    /unused preparation/,
  )
  let captured
  host.ctx.on('tools/execute', async (exec, next) => {
    captured = exec
    return next()
  })
  assert.equal((await host.execute('ask_file', ARGS)).isError, false)
  await assert.rejects(tool.execute(ARGS, captured), /unused preparation/)
  assert.equal(host.calls.length, 1)
})

test('evaluation uses immutable prepared content rather than a changed reread', async (t) => {
  const host = await fixture(t, { approval: false })
  const original = host.files.get('src/a.ts')
  host.ctx.on('tools/execute', async (_exec, next) => {
    host.files.set('src/a.ts', 'changed')
    return next()
  })
  assert.equal((await host.execute('ask_file', ARGS)).isError, false)
  assert.equal(host.calls[0].state.file.content, original)
})

test('a model change before dispatch prevents evaluation', async (t) => {
  const host = await fixture(t, { approval: false })
  host.ctx.on('tools/execute', async (_exec, next) => {
    host.changeModel('typesafe/jev-other')
    return next()
  })
  const result = await host.execute('ask_file', ARGS)
  assert.equal(host.calls.length, 0)
  assert.equal(result.value.files[0].reason, 'model_changed')
})

test('a workspace change after preparation prevents evaluation', async (t) => {
  const host = await fixture(t, { approval: false })
  host.ctx.on('tools/execute', async (_exec, next) => {
    host.agent.session.header.cwd = '/different'
    return next()
  })
  assert.equal((await host.execute('ask_file', ARGS)).isError, true)
  assert.equal(host.calls.length, 0)
})

test('other policies retain deny and cancel decisions without Jev dispatch', async (t) => {
  for (const decision of [{ kind: 'deny', reason: 'test-policy' }, { kind: 'cancel' }])
    await t.test(decision.kind, async (t) => {
      const host = await fixture(t, { approval: false })
      host.ctx.on('tools/pre-execute', async () => decision)
      assert.equal((await host.execute('ask_file', ARGS)).isError, true)
      assert.equal(host.calls.length, 0)
    })
})

test('other policies retain their asks and localized text', async (t) => {
  for (const answer of ['allowed-once', 'rejected'])
    await t.test(answer, async (t) => {
      const host = await fixture(t, { answer })
      const displayReason = { en: 'External policy information', de: 'Andere Richtlinie' }
      host.ctx.on('tools/pre-execute', async () => ({
        kind: 'ask',
        reason: 'external-policy',
        displayReason,
      }))
      const result = await host.execute('ask_file', ARGS)
      assert.equal(result.isError, answer !== 'allowed-once')
      assert.equal(host.calls.length, answer === 'allowed-once' ? 1 : 0)
      assert.equal(host.requests.length, 1)
      assert.equal(host.requests[0].reason, 'external-policy')
      assert.deepEqual(host.requests[0].displayReason, displayReason)
      assert.equal(host.audit().at(-1).data.outcome, answer)
    })
})

for (const action of ['expiry', 'unload', 'caller-cancel'])
  test(`${action} aborts in-flight evaluation without an approval prompt`, async (t) => {
    let announce
    const started = new Promise((resolve) => {
      announce = resolve
    })
    const controller = new AbortController()
    const host = await fixture(t, { approval: false })
    let signal
    host.jev.evaluate = async (input) => {
      host.calls.push(input)
      signal = input.signal
      announce()
      return new Promise(() => {})
    }
    if (action === 'expiry') t.mock.timers.enable({ apis: ['setTimeout'] })
    const pending = host.execute('ask_file', ARGS, { signal: controller.signal })
    await started
    if (action === 'expiry') t.mock.timers.tick(120_000)
    else if (action === 'unload') host.registration.dispose()
    else controller.abort()
    await pending
    assert.equal(signal.aborted, true)
    assert.equal(host.calls.length, 1)
    assert.equal(host.requests.length, 0)
  })

test('empty discovery makes no provider call', async (t) => {
  const host = await fixture(t, { approval: false })
  const result = await host.execute('scout_files', { pattern: 'src/*.py', question: 'Relevant?' })
  assert.equal(result.isError, false)
  assert.equal(host.calls.length, 0)
  assert.equal(host.requests.length, 0)
})
