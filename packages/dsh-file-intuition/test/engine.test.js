import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { parseRequest, prepareScan, evaluateScan } from '../dist/src/engine.js'
import { LIMITS } from '../dist/src/contracts.js'

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

test('bounded two-call concurrency, partial failure, deterministic relevance order, no retry', async () => {
  const prepared = prepareScan(
    batch(),
    model,
    discovery(['c', 'a', 'b', 'd'].map((path) => file(path))),
  )
  let active = 0
  let peak = 0
  let calls = 0
  const gates = [deferred(), deferred()]
  const started = deferred()
  const pending = run(prepared, async ({ state, questions }) => {
    const index = calls++
    active++
    peak = Math.max(peak, active)
    if (calls === 2) started.resolve()
    if (index < 2) await gates[index].promise
    active--
    if (state.file.path === 'b') throw new Error('SECRET provider failure')
    return response(questions, state.file.path === 'd' ? 0.9 : 0.5)
  })
  await started.promise
  assert.equal(calls, 2)
  gates[0].resolve()
  gates[1].resolve()
  const result = await pending
  assert.equal(peak, 2)
  assert.equal(calls, 4)
  assert.deepEqual(
    result.files.map((f) => f.path),
    ['d', 'a', 'c', 'b'],
  )
  assert.equal(result.files[3].reason, 'provider_error')
  assert.equal(result.coverage.evaluatedFiles, 3)
  assert.equal(result.usage.complete, false)
  assert.equal(Object.hasOwn(result.usage, 'cost'), false)
  assert.equal(JSON.stringify(result).includes('SECRET'), false)
})

test('cancellation before dispatch makes no call; cancellation in flight returns and starts none', async () => {
  const prepared = prepareScan(
    batch(),
    model,
    discovery(['a', 'b', 'c', 'd'].map((path) => file(path))),
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
      if (++calls === 2) started.resolve()
      return pendingProvider.promise
    },
    controller.signal,
  )
  await started.promise
  controller.abort()
  const result = await pending
  assert.equal(calls, 2)
  assert.ok(result.files.every((f) => f.reason === 'cancelled'))
  assert.equal(result.usage.providerCalls, 2)
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
  const escaped = file('a', '\u0001'.repeat(10_000))
  assert.ok(escaped.bytes < LIMITS.fileBytes)
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
  assert.throws(() => prepareScan(request, model, discovery()), { code: 'request_too_large' })
  assert.throws(() =>
    prepareScan(batch(24), model, discovery(Array.from({ length: 25 }, (_, i) => file(String(i))))),
  )
  assert.throws(() =>
    prepareScan(
      batch(24),
      model,
      discovery(Array.from({ length: 9 }, (_, i) => file(String(i), 'x'.repeat(16_384)))),
    ),
  )
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
