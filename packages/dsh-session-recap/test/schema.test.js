import test from 'node:test'
import assert from 'node:assert/strict'
import { registerTypeScript } from './fixtures/typescript.mjs'
registerTypeScript()
const { parseCards, parseRecap } = await import('../src/recap-schema.ts')

const answer = {
  bullets: [
    'Recaps should refresh your memory, not report task status.',
    'We settled on a few short bullets that disappear after you send a message.',
  ],
}
const draft = {
  headline: 'Current direction',
  cards: { direction: 'Explore the available options.' },
}

test('headline schema accepts either key order and preserves legacy bullets', () => {
  const headline = 'Google Drive: shared-file picker and invoice export'
  for (const value of [
    { headline, ...answer },
    { ...answer, headline },
  ]) {
    const parsed = parseRecap(JSON.stringify(value))
    assert.deepEqual(parsed, { headline, ...answer })
    assert.ok(Object.isFrozen(parsed))
  }
  assert.deepEqual(parseRecap(JSON.stringify(answer)), answer)
  assert.equal(
    parseRecap(JSON.stringify({ ...answer, headline: '  Google\nDrive:\tshared picker  ' }))
      .headline,
    'Google Drive: shared picker',
  )
  assert.equal(
    parseRecap(JSON.stringify({ ...answer, headline: 'x'.repeat(120) })).headline.length,
    120,
  )
  for (const headline of [null, 42, [], {}, '', ' \n ', 'SECRET'.repeat(21)]) {
    assert.throws(
      () => parseRecap(JSON.stringify({ ...answer, headline })),
      (error) => error.code === 'invalid-response' && !error.message.includes('SECRET'),
    )
  }
})
test('normalizes bullet whitespace before size checks', () => {
  assert.deepEqual(parseRecap(JSON.stringify({ bullets: ['  First\r\n Second\t third.  '] })), {
    bullets: ['First Second third.'],
  })
})
test('strict bullet shape and hard brevity bounds', () => {
  assert.deepEqual(parseRecap(JSON.stringify(answer)), answer)
  assert.deepEqual(parseRecap('{"bullets":[" One topic. "]}'), { bullets: ['One topic.'] })
  for (const value of [
    '```json\n{}\n```',
    '{}',
    'null',
    JSON.stringify({ ...answer, extra: true }),
    ...[
      [],
      ['', 'Topic'],
      [1],
      ['a', 'b', 'c', 'd'],
      ['x'.repeat(321)],
      Array(3).fill('x'.repeat(201)),
      ['  \n\t '],
      ['x'.repeat(321), null],
    ].map((bullets) => JSON.stringify({ bullets })),
    JSON.stringify({ goal: 'Old', outcome: 'Format', nextStep: 'Rejected' }),
  ])
    assert.throws(() => parseRecap(value))
  assert.ok(Object.isFrozen(parseRecap(JSON.stringify(answer)).bullets))
  const escaped =
    '{"bullets":[' +
    Array(3)
      .fill('"' + '\\u4e2d'.repeat(200) + '"')
      .join(',') +
    ']}'
  assert.deepEqual(parseRecap(escaped).bullets, Array(3).fill('中'.repeat(200)))
})
test('strict card parsing normalizes whitespace, omits null, rejects malformed/duplicate fields before length', () => {
  assert.deepEqual(
    parseCards('{"headline":" A\\n B ","cards":{"decision":null,"direction":" Some  text "}}', [
      'direction',
      'decision',
    ]),
    { headline: 'A B', cards: [{ label: 'direction', text: 'Some text' }] },
  )
  for (const value of [
    { ...draft, extra: true },
    { ...draft, cards: { unknown: 'No' } },
    { ...draft, cards: {} },
    { ...draft, cards: { direction: null } },
    { ...draft, cards: { direction: '' } },
    { ...draft, cards: { direction: 1 } },
    { ...draft, headline: null },
  ])
    assert.throws(() => parseCards(JSON.stringify(value), ['direction']))
  for (const raw of [
    '{"headline":"a","headline":"b","cards":{"direction":"ok"}}',
    '{"headline":"a","cards":{"direction":"ok","dir\\u0065ction":"again"}}',
  ])
    assert.throws(() => parseCards(raw, ['direction']), { reason: 'shape' })
  assert.throws(
    () =>
      parseCards(
        JSON.stringify({ headline: 'x'.repeat(121), cards: { direction: 'ok', decision: 1 } }),
        ['direction', 'decision'],
      ),
    { reason: 'card-type' },
  )
})
test('combined card text has a hard length bound', () => {
  assert.throws(
    () =>
      parseCards(
        JSON.stringify({
          headline: 'A',
          cards: {
            direction: 'x'.repeat(161),
            decision: 'y'.repeat(161),
            insight: 'z'.repeat(161),
          },
        }),
        ['direction', 'decision', 'insight'],
      ),
    { reason: 'combined-length' },
  )
})
