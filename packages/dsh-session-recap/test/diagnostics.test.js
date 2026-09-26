import test from 'node:test'
import assert from 'node:assert/strict'
import { registerTypeScript } from './fixtures/typescript.mjs'
registerTypeScript()
const {
  CARD_LABELS,
  CARD_QUESTIONS,
  cardSelectionDiagnostics,
  evaluateCardSelection,
  selectCardLabels,
} = await import('../src/cards.ts')
const { RecapRuntime } = await import('../src/runtime.ts')

function evaluation(labels = CARD_LABELS) {
  return {
    model: 'typesafe/jev-1.13-resolved',
    answers: Object.fromEntries(
      CARD_LABELS.flatMap((label) => [
        [`support_${label}`, { type: 'noul', noul: labels.includes(label) ? 0.75 : 0.1 }],
        [
          `usefulness_${label}`,
          {
            type: 'score',
            score: 2,
            confidence: 0.3,
            probabilities: { 0: 0.1, 1: 0.2, 2: 0.3, 3: 0.4 },
          },
        ],
      ]),
    ),
  }
}
function frozen(value) {
  if (!value || typeof value !== 'object') return
  assert.ok(Object.isFrozen(value))
  Object.values(value).forEach(frozen)
}
function fixture(raw = evaluation(['direction'])) {
  const state = { raw, evaluations: 0, writes: 0, enabled: true, absent: false, error: null }
  const session = {
    seq: 1,
    deriveMessages: () => [
      {
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'PRIVATE_HISTORY' }],
      },
    ],
  }
  const service = {
    settings: () => ({ model: 'typesafe/jev-1.13' }),
    async evaluate() {
      state.evaluations++
      if (state.error) throw state.error
      return state.raw
    },
  }
  const runtime = new RecapRuntime({
    sessions: { get: () => session },
    settings: () => ({ provider: 'p', model: 'm', useJev: state.enabled }),
    getJev: () => (state.absent ? undefined : service),
    llm: {
      async prepareCall(config) {
        return {
          config,
          async *stream() {
            state.writes++
            const labels =
              state.error || state.absent || !state.enabled ? [] : selectCardLabels(state.raw)
            const recap = labels.length
              ? {
                  headline: 'Topic',
                  cards: Object.fromEntries(labels.map((label) => [label, 'Recap text'])),
                }
              : { bullets: ['Recap text'] }
            yield { type: 'text-delta', text: JSON.stringify(recap) }
            yield { type: 'finish', reason: { kind: 'stop' } }
          },
        }
      },
    },
  })
  return { state, runtime, session }
}

test('diagnostics preserve exact scores, fixed questions, thresholds and ranked selection', () => {
  const raw = evaluation()
  raw.answers.usefulness_paused.score = 3
  raw.answers.support_next_step.noul = 0.9
  const { diagnostics: d, labels } = evaluateCardSelection(raw)
  assert.deepEqual(labels, ['paused', 'next_step', 'direction'])
  assert.deepEqual(labels, selectCardLabels(raw))
  assert.equal(d.version, 1)
  assert.equal(d.questionSetVersion, 'recap-categories-v1')
  assert.equal(d.status, 'evaluated')
  assert.equal(d.model, raw.model)
  assert.equal(d.questions, CARD_QUESTIONS)
  assert.deepEqual(d.thresholds, { support: 0.75, usefulness: 2, confidence: 0.3, maxCards: 3 })
  assert.deepEqual(d.categories[0], {
    label: 'direction',
    support: 0.75,
    usefulness: 2,
    confidence: 0.3,
    probabilities: { 0: 0.1, 1: 0.2, 2: 0.3, 3: 0.4 },
    selected: true,
    reasons: [],
  })
  assert.deepEqual(d.categories[1].reasons, ['ranked-out'])
  frozen(d)
  raw.answers.usefulness_direction.probabilities[0] = 1
  raw.answers.support_direction.noul = 0
  assert.equal(d.categories[0].probabilities[0], 0.1)
  assert.equal(d.categories[0].support, 0.75)
})

test('threshold and invalid-answer reasons retain original selection behavior', () => {
  const raw = evaluation()
  raw.answers.support_direction.noul = 0.7499
  raw.answers.usefulness_decision.score = 1.999
  raw.answers.usefulness_insight.confidence = 0.2999
  raw.answers.support_question.noul = NaN
  raw.answers.usefulness_next_step.score = Infinity
  raw.answers.usefulness_paused.confidence = 'SECRET'
  const d = cardSelectionDiagnostics(raw)
  assert.deepEqual(
    d.categories.map((row) => row.reasons),
    [
      ['support'],
      ['usefulness'],
      ['confidence'],
      ['invalid-answer'],
      ['invalid-answer'],
      ['invalid-answer'],
    ],
  )
  assert.equal(d.categories[3].support, null)
  assert.equal(d.categories[4].usefulness, null)
  assert.equal(d.categories[5].confidence, null)
  assert.deepEqual(selectCardLabels(raw), [])
})

test('safe JSON excludes dynamic content, raw fields, invalid numbers and unknown probability keys', () => {
  const raw = evaluation()
  raw.usage = { secret: 'SECRET' }
  raw.error = 'SECRET'
  raw.history = 'SECRET'
  raw.questions = { instructions: 'SECRET' }
  raw.answers.SECRET = { score: 1 }
  for (const label of CARD_LABELS) {
    Object.assign(raw.answers[`support_${label}`], { text: 'SECRET', probabilities: { SECRET: 1 } })
    Object.assign(raw.answers[`usefulness_${label}`], {
      legend: { 0: 'SECRET' },
      key: 'SECRET',
      probabilities: {
        0: 0,
        1: NaN,
        2: 'SECRET',
        3: Infinity,
        4: 0.5,
        SECRET: 0.9,
        toJSON() {
          throw Error('SECRET')
        },
      },
    })
  }
  for (const model of [
    'SECRET',
    'typesafe/jev-1.13\nSECRET',
    'typesafe/jev-<SECRET>',
    'typesafe/jev-' + 'x'.repeat(200),
    '~typesafe/jev-latest',
    { secret: 'SECRET' },
  ]) {
    raw.model = model
    const d = cardSelectionDiagnostics(raw)
    assert.equal(d.model, null)
    assert.deepEqual(d.categories[0].probabilities, { 0: 0 })
    assert.doesNotMatch(JSON.stringify(d), /SECRET|"usage":|"history":|"legend":|toJSON/)
  }
  raw.answers.usefulness_direction.probabilities = { 0: -1, 1: 2 }
  assert.equal(cardSelectionDiagnostics(raw).categories[0].probabilities, null)
  Object.defineProperty(raw, 'model', {
    get() {
      throw Error('SECRET')
    },
  })
  Object.defineProperty(raw.answers.support_direction, 'noul', {
    get() {
      throw Error('SECRET')
    },
  })
  assert.equal(cardSelectionDiagnostics(raw).model, null)
  assert.equal(cardSelectionDiagnostics(raw).categories[0].support, null)
})

test('same-generation diagnostics survive concurrent and cached requests without evaluation', async () => {
  const f = fixture()
  const [first, concurrent] = await Promise.all([
    f.runtime.recap({ sessionId: 's' }),
    f.runtime.recap({ sessionId: 's' }),
  ])
  assert.equal(first.selection.diagnostics, concurrent.selection.diagnostics)
  f.state.raw.answers.support_direction.noul = 0.1
  const cached = await f.runtime.recap({ sessionId: 's' })
  assert.equal(cached.cached, true)
  assert.equal(cached.selection.diagnostics, first.selection.diagnostics)
  assert.equal(cached.selection.diagnostics.categories[0].support, 0.75)
  assert.equal(f.state.evaluations, 1)
  assert.equal(f.state.writes, 1)
  frozen(first.selection)
  f.session.seq++
  const next = await f.runtime.recap({ sessionId: 's' })
  assert.equal(next.selection.diagnostics.categories[0].support, 0.1)
  assert.equal(f.state.evaluations, 2)
  assert.doesNotMatch(JSON.stringify(first.selection.diagnostics), /PRIVATE_HISTORY/)
})

test('no-label evaluations and unavailable failures are safe; disabled selection has no diagnostics', async () => {
  for (const mode of ['no-labels', 'absent', 'failed', 'disabled']) {
    const f = fixture(evaluation([]))
    if (mode === 'absent') f.state.absent = true
    if (mode === 'failed') f.state.error = Error('SECRET error with key and history')
    if (mode === 'disabled') f.state.enabled = false
    const result = await f.runtime.recap({ sessionId: 's' })
    if (mode === 'disabled') assert.deepEqual(result.selection, { mode: 'standard' })
    else {
      const d = result.selection.diagnostics
      assert.equal(d.status, mode === 'no-labels' ? 'evaluated' : 'unavailable')
      assert.equal(result.selection.reason, mode === 'no-labels' ? 'no-labels' : 'unavailable')
      if (mode !== 'no-labels') {
        assert.equal(d.model, null)
        assert.ok(
          d.categories.every(
            (row) =>
              row.support === null &&
              row.usefulness === null &&
              row.confidence === null &&
              row.probabilities === null &&
              !row.selected &&
              !row.reasons.length,
          ),
        )
      }
      frozen(d)
      assert.equal(f.runtime.cache.size, 0)
    }
    assert.doesNotMatch(JSON.stringify(result), /SECRET|PRIVATE_HISTORY/)
    assert.equal(f.state.evaluations, ['no-labels', 'failed'].includes(mode) ? 1 : 0)
  }
})
