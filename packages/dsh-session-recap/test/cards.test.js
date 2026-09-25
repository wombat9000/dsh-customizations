import test from 'node:test'
import assert from 'node:assert/strict'
import { CARD_LABELS, CARD_QUESTIONS, selectCardLabels } from '../src/cards.js'

test('twelve typed questions, exact thresholds, ranking, stable ties and maximum three', () => {
  assert.equal(Object.keys(CARD_QUESTIONS).length, 12)
  for (const label of CARD_LABELS) {
    assert.equal(CARD_QUESTIONS[`support_${label}`].type, 'noul')
    assert.equal(CARD_QUESTIONS[`usefulness_${label}`].criteria.length, 4)
  }
  const result = {
    answers: Object.fromEntries(
      CARD_LABELS.flatMap((label) => [
        [`support_${label}`, { type: 'noul', noul: 0.9 }],
        [`usefulness_${label}`, { type: 'score', score: 2, confidence: 0.3 }],
      ]),
    ),
  }
  assert.deepEqual(selectCardLabels(result), CARD_LABELS.slice(0, 3))
  result.answers.support_direction.noul = 0.7499
  result.answers.usefulness_decision.score = 1.999
  result.answers.usefulness_insight.confidence = 0.2999
  result.answers.support_question.noul = 0.75
  result.answers.usefulness_paused.score = 3
  assert.deepEqual(selectCardLabels(result), ['paused', 'next_step', 'question'])
  assert.deepEqual(selectCardLabels({}), [])
})
