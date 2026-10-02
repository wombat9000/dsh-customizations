import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { parseRequest, prepareScan, evaluateScan } from '../dist/src/engine.js'
import { LIMITS } from '../dist/src/contracts.js'
import { readFile } from 'node:fs/promises'
import { createJevRuntime } from '../../dsh-jev/dist/src/runtime.js'

const model = 'typesafe/jev-1.13'
const bool = (questions = [{ id: 'q', question: 'Does this file validate input?' }]) =>
  parseRequest('ask_file', { path: 'src/a.ts', questions })
const batch = (maxFiles = 12) =>
  parseRequest('scout_files', { pattern: 'src/*.ts', question: 'Relevant?', maxFiles })
const file = (path = 'src/a.ts', content = 'export const x = 1') => ({
  path,
  content,
  bytes: Buffer.byteLength(content),
  sha256: createHash('sha256').update(content).digest('hex'),
})
const discovery = (files = [file()]) => ({
  files,
  matchedFiles: files.length,
  visitedEntries: files.length,
  complete: true,
  skipped: [],
})
const response = (
  questions,
  probability = 0.8,
  usage = { input_tokens: 10, output_tokens: 3, cost: 0.001 },
) => ({
  model,
  answers: Object.fromEntries(
    Object.keys(questions).map((id) => [id, { type: 'noul', noul: probability }]),
  ),
  ...(usage === null ? {} : { usage }),
})
const service = (evaluate, settings = () => ({ model })) => ({ settings, evaluate })
const run = (prepared, evaluate, signal = new AbortController().signal) =>
  evaluateScan(prepared, service(evaluate), signal)
const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test('strict tool shapes, explicit unique IDs, bounded question/options/levels and criteria', () => {
  assert.equal(batch().maxFiles, 12)
  const valid = bool([
    { id: 'check', question: 'Valid?', criteria: { true: 'Valid input', false: 'Invalid input' } },
  ])
  assert.equal(valid.questions[0].criteria.true, 'Valid input')
  const invalid = [
    { path: 'a', questions: [] },
    { path: 'a', questions: [{ question: 'Missing ID' }] },
    { path: 'a', questions: [{ id: 'q', question: 'Q', extra: true }] },
    { path: 'a', questions: [{ id: 'q', question: 'Q', criteria: { true: 'yes' } }] },
    { path: 'a', questions: [{ id: 'q', question: 'Q', criteria: { true: '', false: 'no' } }] },
    { path: 'a', questions: [{ id: 'q', question: 'Q', criteria: undefined }] },
    { path: 'a', questions: [{ id: 'constructor', question: 'Q' }] },
    { path: 'a', questions: [{ id: '__proto__', question: 'Q' }] },
    {
      path: 'a',
      questions: [
        { id: 'q', question: 'Q' },
        { id: 'q', question: 'Again' },
      ],
    },
    { path: 'a', questions: Array.from({ length: 9 }, (_, i) => ({ id: `q${i}`, question: 'Q' })) },
    { path: 'a', questions: [{ id: 'q', question: 'x'.repeat(LIMITS.questionChars + 1) }] },
    { path: 'a', questions: [{ id: 'q', question: 'Q' }], unknown: true },
  ]
  for (const input of invalid)
    assert.throws(() => parseRequest('ask_file', input), { code: 'invalid_request' })
  assert.throws(() => parseRequest('scout_files', { pattern: '*', question: 'Q', maxFiles: 25 }))
  assert.throws(() =>
    parseRequest('classify_file', {
      path: 'a',
      questions: [{ id: 'q', question: 'Q', choices: [{ id: 'a', description: 'A' }] }],
    }),
  )
  assert.throws(() =>
    parseRequest('score_file', {
      path: 'a',
      questions: [{ id: 'q', question: 'Q', levels: ['one'] }],
    }),
  )
  assert.throws(() =>
    parseRequest('unknown', { path: 'a', questions: [{ id: 'q', question: 'Q' }] }),
  )
  let accessed = false
  assert.throws(() =>
    parseRequest('scout_files', {
      get pattern() {
        accessed = true
        return '*'
      },
      question: 'Q',
    }),
  )
  assert.equal(accessed, false)
  const cycle = {}
  cycle.true = cycle
  cycle.false = 'no'
  assert.throws(() => bool([{ id: 'q', question: 'Q', criteria: cycle }]))
})

test('prepare captures exact model, deep snapshots, and safe separate file.content state', async () => {
  const request = bool()
  const d = discovery()
  const prepared = prepareScan(request, model, d)
  request.questions[0].question = 'Changed'
  d.files[0].content = 'Changed'
  assert.equal(Object.isFrozen(prepared.discovery.files[0]), true)
  assert.equal(Object.isFrozen(prepared.questions.q), true)
  assert.equal(Object.isFrozen(prepared.request.questions), true)
  await run(prepared, async ({ state, questions }) => {
    assert.deepEqual(state, {
      file: {
        path: 'src/a.ts',
        content: 'export const x = 1',
        sha256: prepared.discovery.files[0].sha256,
      },
    })
    assert.match(questions.q.instructions, /file\.content/)
    assert.match(questions.q.instructions, /untrusted data/)
    assert.equal(questions.q.instructions.includes(state.file.content), false)
    return response(questions)
  })
  for (const invalid of ['openai/model', '', undefined, 'typesafe/jev-1.13\n'])
    assert.throws(() => prepareScan(bool(), invalid, discovery()), { code: 'invalid_model' })
  assert.equal(
    prepareScan(bool(), '~typesafe/jev-latest', discovery()).model,
    '~typesafe/jev-latest',
  )
})

test('boolean probability has no invented confidence; all same-file questions share one call', async () => {
  const prepared = prepareScan(
    bool([
      { id: 'one', question: 'One?' },
      { id: 'two', question: 'Two?' },
    ]),
    model,
    discovery(),
  )
  let calls = 0
  const result = await run(prepared, async ({ questions }) => {
    calls++
    return response(questions)
  })
  assert.equal(calls, 1)
  assert.deepEqual(result.files[0].answers, [
    { id: 'one', type: 'boolean', probability: 0.8 },
    { id: 'two', type: 'boolean', probability: 0.8 },
  ])
  assert.deepEqual(result.usage, {
    providerCalls: 1,
    reportedCalls: 1,
    complete: true,
    inputTokens: 10,
    outputTokens: 3,
    cost: 0.001,
  })
})

test('choice preserves actual confidence and complete distribution', async () => {
  const request = parseRequest('classify_file', {
    path: 'a',
    questions: [
      {
        id: 'q',
        question: 'Layer?',
        choices: [
          { id: 'ui', description: 'Presentation' },
          { id: 'host', description: 'Host integration' },
        ],
      },
    ],
  })
  const result = await run(prepareScan(request, model, discovery()), async () => ({
    model,
    answers: {
      q: { type: 'choice', choice: 'host', confidence: 0.6, probabilities: { ui: 0.2, host: 0.8 } },
    },
  }))
  assert.deepEqual(result.files[0].answers[0], {
    id: 'q',
    type: 'choice',
    choice: 'host',
    confidence: 0.6,
    probabilities: [
      { option: 'ui', probability: 0.2 },
      { option: 'host', probability: 0.8 },
    ],
  })
})

test('score is fractional scale value, not boolean probability; levels use prepared descriptions', async () => {
  const levels = ['No validation', 'Some validation', 'Complete validation']
  const request = parseRequest('score_file', {
    path: 'a',
    questions: [{ id: 'q', question: 'Validation coverage?', levels }],
  })
  const payload = {
    model,
    answers: {
      q: {
        type: 'score',
        score: 1.5,
        confidence: 0.7,
        probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 },
        legend: { 0: levels[0], 1: levels[1], 2: levels[2] },
      },
    },
  }
  const prepared = prepareScan(request, model, discovery())
  const result = await run(prepared, async () => payload)
  assert.deepEqual(result.files[0].answers[0], {
    id: 'q',
    type: 'score',
    score: 1.5,
    confidence: 0.7,
    levels,
    probabilities: [
      { level: 0, probability: 0.1 },
      { level: 1, probability: 0.3 },
      { level: 2, probability: 0.6 },
    ],
  })
  for (const mutation of [
    (a) => {
      a.score = 3
    },
    (a) => {
      a.score = NaN
    },
    (a) => {
      a.legend[0] = 'Provider rewrite'
    },
    (a) => {
      delete a.probabilities[2]
    },
    (a) => {
      a.probabilities[2] = 0.1
    },
    (a) => {
      a.confidence = 2
    },
  ]) {
    const bad = structuredClone(payload)
    mutation(bad.answers.q)
    assert.equal((await run(prepared, async () => bad)).files[0].reason, 'invalid_response')
  }
})

test('malformed model, IDs, types and ranges fail closed; provider prose never escapes', async () => {
  const prepared = prepareScan(bool(), model, discovery())
  for (const payload of [
    null,
    { model, answers: {} },
    { model: 'typesafe/jev-other', answers: { q: { type: 'noul', noul: 0.5 } } },
    { model, answers: { q: { type: 'score', score: 1 } } },
    { model, answers: { q: { type: 'noul', noul: Infinity } } },
    { model, answers: { q: { type: 'noul', noul: -1 } } },
    { model, answers: { q: { type: 'noul', noul: 0.5 }, extra: { type: 'noul', noul: 0.5 } } },
  ]) {
    const result = await run(prepared, async () => payload)
    assert.equal(result.files[0].reason, 'invalid_response')
  }
  const result = await run(prepared, async ({ questions }) => ({
    ...response(questions),
    snippet: 'SECRET CODE',
    explanation: 'SECRET PROSE',
    answers: { q: { type: 'noul', noul: 0.5, explanation: 'SECRET PROSE' } },
  }))
  assert.equal(result.files[0].status, 'evaluated')
  assert.equal(JSON.stringify(result).includes('SECRET'), false)
  assert.equal(JSON.stringify(result).includes('export const'), false)
  for (const accepted of [model, `${model}-2026`]) {
    assert.equal(
      (await run(prepared, async ({ questions }) => ({ ...response(questions), model: accepted })))
        .files[0].status,
      'evaluated',
    )
  }
  const alias = prepareScan(bool(), '~typesafe/jev-latest', discovery())
  assert.equal(
    (
      await evaluateScan(
        alias,
        service(
          async ({ questions }) => response(questions),
          () => ({ model: '~typesafe/jev-latest' }),
        ),
        new AbortController().signal,
      )
    ).files[0].status,
    'evaluated',
  )
})

test('eight workers refill independently, preserve partial failure and ranking, and never retry', async () => {
  const prepared = prepareScan(
    batch(),
    model,
    discovery(
      ['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map((path) => file(path)),
    ),
  )
  let active = 0
  let peak = 0
  let calls = 0
  const gates = Array.from({ length: 8 }, deferred)
  const started = deferred()
  const ninth = deferred()
  const pending = run(prepared, async ({ state, questions }) => {
    const index = calls++
    active++
    peak = Math.max(peak, active)
    if (calls === 8) started.resolve()
    if (calls === 9) ninth.resolve()
    if (index < 8) await gates[index].promise
    active--
    if (state.file.path === 'b') throw new Error('SECRET provider failure')
    return response(questions, state.file.path === 'd' ? 0.9 : 0.5)
  })
  await started.promise
  assert.equal(calls, 8)
  gates[0].resolve()
  await ninth.promise // A free worker advances without waiting for the other seven.
  for (const gate of gates.slice(1)) gate.resolve()
  const result = await pending
  assert.equal(peak, 8)
  assert.equal(calls, 12)
  assert.deepEqual(
    result.files.map((f) => f.path),
    ['d', 'a', 'c', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'b'],
  )
  assert.equal(result.files.at(-1).reason, 'provider_error')
  assert.equal(result.coverage.evaluatedFiles, 11)
  assert.equal(result.usage.complete, false)
  assert.equal(Object.hasOwn(result.usage, 'cost'), false)
  assert.equal(JSON.stringify(result).includes('SECRET'), false)
})

test('cancellation before dispatch makes no call; cancellation in flight returns and starts none', async () => {
  const prepared = prepareScan(
    batch(),
    model,
    discovery(Array.from({ length: 12 }, (_, i) => file(`file-${i}`))),
  )
  const pre = new AbortController()
  pre.abort()
  let calls = 0
  const before = await run(
    prepared,
    async () => {
      calls++
    },
    pre.signal,
  )
  assert.equal(calls, 0)
  assert.ok(before.files.every((f) => f.reason === 'cancelled'))
  const controller = new AbortController()
  const started = deferred()
  const pendingProvider = deferred()
  const pending = run(
    prepared,
    async () => {
      if (++calls === 8) started.resolve()
      return pendingProvider.promise
    },
    controller.signal,
  )
  await started.promise
  controller.abort()
  const result = await pending
  assert.equal(calls, 8)
  assert.ok(result.files.every((f) => f.reason === 'cancelled'))
  assert.equal(result.usage.providerCalls, 8)
  assert.equal(result.usage.complete, false)
  pendingProvider.resolve(null)
})

test('captured settings checked before every dispatch; changed setting stops queued calls', async () => {
  const prepared = prepareScan(batch(), model, discovery(['a', 'b', 'c'].map((path) => file(path))))
  let calls = 0
  const before = await evaluateScan(
    prepared,
    service(
      async () => {
        calls++
      },
      () => ({ model: 'typesafe/jev-2' }),
    ),
    new AbortController().signal,
  )
  assert.equal(calls, 0)
  assert.ok(before.files.every((f) => f.reason === 'model_changed'))
  let current = model
  const result = await evaluateScan(
    prepared,
    service(
      async ({ questions }) => {
        calls++
        current = 'typesafe/jev-2'
        return response(questions)
      },
      () => ({ model: current }),
    ),
    new AbortController().signal,
  )
  assert.equal(calls, 1)
  assert.equal(result.files.filter((f) => f.reason === 'model_changed').length, 2)
})

test('full serialized UTF8 request cap includes escaping, model, state, questions before any call', () => {
  const escaped = file('a', '\u0001'.repeat(LIMITS.fileBytes))
  assert.equal(escaped.bytes, LIMITS.fileBytes)
  assert.throws(() => prepareScan(bool(), model, discovery([escaped])), {
    code: 'request_too_large',
  })
  const multibyte = file('a', '界'.repeat(5_000))
  const prepared = prepareScan(bool(), model, discovery([multibyte]))
  assert.equal(prepared.discovery.files[0].bytes, 15_000)
  const questions = Array.from({ length: 8 }, (_, i) => ({
    id: `q${i}`,
    question: '界'.repeat(1024),
    choices: Array.from({ length: 16 }, (_, j) => ({ id: `c${j}`, description: '界'.repeat(512) })),
  }))
  const request = parseRequest('classify_file', { path: 'a', questions })
  assert.throws(
    () => prepareScan(request, model, discovery([file('a', 'x'.repeat(LIMITS.fileBytes))])),
    { code: 'request_too_large' },
  )
  assert.throws(() =>
    prepareScan(batch(24), model, discovery(Array.from({ length: 25 }, (_, i) => file(String(i))))),
  )
  assert.throws(() =>
    prepareScan(
      batch(24),
      model,
      discovery(Array.from({ length: 9 }, (_, i) => file(String(i), 'x'.repeat(LIMITS.fileBytes)))),
    ),
  )
})

test('larger files pass through the real Jev service without truncation (mocked HTTP)', async (t) => {
  const github = await readFile(new URL('../../dsh-github/src/runtime.js', import.meta.url), 'utf8')
  const samples = [
    ['GitHub runtime previously excluded by the 16 KiB cap', github],
    ['96 KiB ASCII boundary', 'x'.repeat(LIMITS.fileBytes)],
    ['96 KiB UTF8 boundary', '界'.repeat(LIMITS.fileBytes / 3)],
    ['96 KiB quotes requiring JSON escaping', '"'.repeat(LIMITS.fileBytes)],
  ]
  for (const [name, content] of samples)
    await t.test(name, async () => {
      assert.ok(Buffer.byteLength(content) > 16_384)
      let calls = 0
      const runtime = createJevRuntime({
        openrouter: { resolveApiKey: async () => 'fixture-key' },
        getModel: () => model,
        saveModel: async () => {},
        fetch: async (_url, init) => {
          calls++
          const body = JSON.parse(init.body)
          assert.equal(body.state.file.content, content)
          assert.equal(body.state.file.sha256, file('a', content).sha256)
          return new Response(JSON.stringify(response(body.questions)))
        },
      })
      try {
        const result = await evaluateScan(
          prepareScan(bool(), model, discovery([file('a', content)])),
          runtime.service,
          new AbortController().signal,
        )
        assert.equal(result.coverage.evaluatedFiles, 1, JSON.stringify(result))
        assert.equal(result.files[0].bytes, Buffer.byteLength(content))
        assert.equal(calls, 1)
      } finally {
        runtime.dispose()
      }
    })
})

test('simultaneous scans share eight Jev slots without busy failures or retries', async (t) => {
  const gate = deferred()
  const started = deferred()
  const calls = new Map()
  let active = 0
  let peak = 0
  const runtime = createJevRuntime({
    openrouter: { resolveApiKey: async () => 'fixture-key' },
    getModel: () => model,
    saveModel: async () => {},
    fetch: async (_url, init) => {
      const { state, questions } = JSON.parse(init.body)
      calls.set(state.file.path, (calls.get(state.file.path) ?? 0) + 1)
      peak = Math.max(peak, ++active)
      if (active === 8) started.resolve()
      try {
        await gate.promise
        return new Response(JSON.stringify(response(questions)))
      } finally {
        active--
      }
    },
  })
  t.after(() => runtime.dispose())
  const pending = Promise.all(
    Array.from({ length: 3 }, (_, scan) =>
      evaluateScan(
        prepareScan(
          batch(),
          model,
          discovery(Array.from({ length: 12 }, (_, i) => file(`${scan}/${i}.ts`))),
        ),
        runtime.service,
        new AbortController().signal,
      ),
    ),
  )
  await started.promise
  assert.equal(calls.size, 8)
  assert.equal(active, 8)
  gate.resolve()
  const results = await pending
  assert.equal(peak, 8)
  assert.equal(calls.size, 36)
  assert.ok([...calls.values()].every((count) => count === 1))
  for (const result of results) {
    assert.equal(result.coverage.evaluatedFiles, 12, JSON.stringify(result))
    assert.equal(result.coverage.failedFiles, 0)
    assert.equal(result.usage.providerCalls, 12)
  }
})

test('encoded request accepts its exact boundary and rejects one additional escaped byte', () => {
  const request = bool(
    Array.from({ length: 8 }, (_, i) => ({
      id: `q${i}`,
      question: 'q'.repeat(1024),
      criteria: { true: '\u0001'.repeat(512), false: '\u0001'.repeat(512) },
    })),
  )
  const base = file('a', 'x'.repeat(LIMITS.fileBytes))
  const { questions } = prepareScan(request, model, discovery([base]))
  const encodedBytes = ({ path, content, sha256 }) =>
    Buffer.byteLength(
      JSON.stringify({
        model,
        state: { file: { path, content, sha256 } },
        questions,
      }),
    )
  const extra = LIMITS.requestBytes - encodedBytes(base)
  assert.ok(extra > 0 && extra < LIMITS.fileBytes)
  const exact = file('a', '"'.repeat(extra) + 'x'.repeat(LIMITS.fileBytes - extra))
  assert.equal(encodedBytes(exact), LIMITS.requestBytes)
  assert.doesNotThrow(() => prepareScan(request, model, discovery([exact])))
  const over = file('a', '"'.repeat(extra + 1) + 'x'.repeat(LIMITS.fileBytes - extra - 1))
  assert.equal(encodedBytes(over), LIMITS.requestBytes + 1)
  assert.throws(() => prepareScan(request, model, discovery([over])), { code: 'request_too_large' })
})

test('usage partial metrics omit unknown sums, complete requires every metric on every call', async () => {
  const prepared = prepareScan(batch(), model, discovery(['a', 'b'].map((path) => file(path))))
  const result = await run(prepared, async ({ state, questions }) =>
    response(
      questions,
      0.5,
      state.file.path === 'a'
        ? { input_tokens: 10, output_tokens: 2, cost: 0.1 }
        : { input_tokens: 20 },
    ),
  )
  assert.deepEqual(result.usage, {
    providerCalls: 2,
    reportedCalls: 2,
    complete: false,
    inputTokens: 30,
  })
  const absent = await run(prepared, async ({ questions }) => response(questions, 0.5, null))
  assert.deepEqual(absent.usage, { providerCalls: 2, reportedCalls: 0, complete: false })
  const bad = await run(prepared, async ({ questions }) =>
    response(questions, 0.5, { input_tokens: -1, output_tokens: 0.5, cost: Infinity }),
  )
  assert.deepEqual(bad.usage, { providerCalls: 2, reportedCalls: 2, complete: false })
  const zero = await run(prepared, async ({ questions }) =>
    response(questions, 0.5, { input_tokens: 0, output_tokens: 0, cost: 0 }),
  )
  assert.deepEqual(zero.usage, {
    providerCalls: 2,
    reportedCalls: 2,
    complete: true,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
  })
})
