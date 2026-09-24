import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedHistory } from '../src/history.js'
import { LIMITS } from '../src/settings.js'

const message = (text, role = 'user', kind = 'user') => ({ role, source: { kind }, content: [{ type: 'text', text }] })

test('history excludes tools, reasoning, attachments and injected instructions', () => {
  const messages = [message('secret', 'system', 'plugin'), message('tool secret', 'user', 'tool'), message('injected', 'user', 'plugin'), { ...message('visible'), content: [{ type: 'reasoning', text: 'private' }, { type: 'image', attachment: 'secret' }, { type: 'tool-call', arguments: 'secret' }, { type: 'text', text: 'visible' }] }]
  assert.deepEqual(boundedHistory(messages), [{ role: 'user', text: 'visible' }])
})
test('history bounds transmitted text and selected messages', () => {
  const rows = boundedHistory(Array.from({ length: 1000 }, (_, i) => message(`${i} ${'😀'.repeat(30000)}`)))
  assert.ok(rows.length <= LIMITS.messages)
  assert.ok(rows.reduce((n, row) => n + Buffer.byteLength(row.text), 0) <= LIMITS.inputBytes)
  assert.ok(rows.at(-1).text.startsWith('999 '))
  assert.ok(Buffer.byteLength(JSON.stringify(rows)) <= LIMITS.inputBytes)
  assert.ok(rows.every(row => row.truncated && !/[\uD800-\uDBFF]$/u.test(row.text)))
})
test('history redistributes short-message allowances and keeps fitting reports whole', () => {
  const report = 'A'.repeat(16000)
  const messages = Array.from({ length: 40 }, (_, i) => message(i === 15 ? report : `Short ${i}`))
  const rows = boundedHistory(messages)
  assert.deepEqual(rows.map(row => row.text), messages.map(item => item.content[0].text))
  assert.ok(rows.every(row => !row.truncated))
  assert.ok(Buffer.byteLength(JSON.stringify(rows)) <= LIMITS.inputBytes)
})
test('spare bytes favor recent messages without starving older context', () => {
  const messages = Array.from({ length: 40 }, () => message('Short'))
  messages[0] = message('A'.repeat(50000))
  messages[1] = message('B'.repeat(900))
  messages[39] = message('C'.repeat(50000))
  const rows = boundedHistory(messages)
  assert.equal(rows[1].text, 'B'.repeat(900))
  assert.ok(!rows[1].truncated)
  assert.ok(rows[0].text.length > 600)
  assert.ok(rows[39].text.length > rows[0].text.length)
  assert.ok(rows[39].text.length < rows[0].text.length * 1.6)
  assert.ok(Buffer.byteLength(JSON.stringify(rows)) <= LIMITS.inputBytes)
  assert.deepEqual(boundedHistory(messages), rows)
})
test('shortened history keeps both ends across text blocks and marks the gap', () => {
  const input = message('')
  input.content = [{ type: 'text', text: 'Opening decision. ' + 'x'.repeat(100000) },
    { type: 'tool-call', arguments: 'PRIVATE' }, { type: 'text', text: 'y'.repeat(100000) + ' Final correction.' }]
  const [row] = boundedHistory([input])
  assert.equal(row.truncated, true)
  const [head, tail] = row.text.split('\n[Middle omitted]\n')
  assert.ok(head.startsWith('Opening decision.'))
  assert.ok(tail.endsWith('Final correction.'))
  assert.ok(Math.abs(head.length - 2 * tail.length) <= 2)
  assert.ok(!row.text.includes('PRIVATE'))
  assert.ok(Buffer.byteLength(JSON.stringify([row])) <= LIMITS.inputBytes)
})
test('head and tail cuts prefer nearby sentence boundaries', () => {
  const [row] = boundedHistory([message('Sentence with useful context. '.repeat(4000))])
  const [head, tail] = row.text.split('\n[Middle omitted]\n')
  assert.ok(head.trimEnd().endsWith('.'))
  assert.ok(tail.trimStart().startsWith('Sentence'))
})
test('serialized budgets include escaping, Unicode, omission metadata, and block caps', () => {
  for (const text of ['😀漢字', '\\"\n\t\\', 'é', 'word. ']) {
    const messages = Array.from({ length: 93 }, (_, i) => message(`Start ${i} ` + text.repeat(3000) + ` End ${i}`))
    const rows = boundedHistory(messages)
    assert.equal(rows.length, 40)
    assert.ok(rows.some(row => row.omittedBefore > 0))
    assert.ok(rows.every(row => row.text.isWellFormed()))
    assert.ok(Buffer.byteLength(JSON.stringify(rows)) <= LIMITS.inputBytes)
    assert.ok(rows[0].text.startsWith('Start 0 '))
    assert.ok(rows.at(-1).text.endsWith(` End 92`))
  }
  const input = message('')
  input.content = Array.from({ length: LIMITS.blocks + 1 }, (_, i) => ({ type: 'text', text: i === LIMITS.blocks ? 'EXCLUDED' : `Block ${i}` }))
  const [row] = boundedHistory([input])
  assert.equal(row.truncated, true)
  assert.ok(row.text.endsWith(`Block ${LIMITS.blocks - 1}`))
  assert.ok(!row.text.includes('EXCLUDED'))
})
test('history retains opening, middle, and recent context with explicit gaps', () => {
  const rows = boundedHistory(Array.from({ length: 1000 }, (_, i) => message(`${i} discussion`, i % 2 ? 'assistant' : 'user', i % 2 ? 'model' : 'user')))
  assert.equal(rows.length, LIMITS.messages)
  assert.equal(rows[0].text, '0 discussion')
  assert.equal(rows.at(-1).text, '999 discussion')
  assert.ok(rows.some(row => Number.parseInt(row.text) > 300 && Number.parseInt(row.text) < 700))
  assert.ok(rows.some(row => row.omittedBefore > 0))
  assert.deepEqual(rows.map(row => Number.parseInt(row.text)), rows.map(row => Number.parseInt(row.text)).sort((a, b) => a - b))
})
test('long reports do not crowd out user intent or corrections', () => {
  const rows = boundedHistory([message('Make this a memory refresh.'), message('Report '.repeat(20000), 'assistant', 'model'), message('No status report. Keep it short.')])
  assert.equal(rows.length, 3)
  assert.equal(rows[0].text, 'Make this a memory refresh.')
  assert.equal(rows[2].text, 'No status report. Keep it short.')
  assert.equal(rows[1].truncated, true)
  assert.ok(Buffer.byteLength(JSON.stringify(rows)) <= LIMITS.inputBytes)
})
test('injected and tool traffic cannot displace the visible conversation', () => {
  const rows = boundedHistory([message('Original intent'), ...Array.from({ length: 500 }, () => message('Excluded data', 'user', 'tool')), message('Still exploring.', 'assistant', 'model')])
  assert.deepEqual(rows, [{ role: 'user', text: 'Original intent' }, { role: 'assistant', text: 'Still exploring.' }])
})
test('short exploratory conversations retain all visible text without gaps', () => {
  assert.deepEqual(boundedHistory([message('Could we explore two approaches?'), message('Both remain open.', 'assistant', 'model')]), [
    { role: 'user', text: 'Could we explore two approaches?' }, { role: 'assistant', text: 'Both remain open.' },
  ])
})
test('JSON escaping cannot exceed transmitted input bound', () => {
  const rows = boundedHistory([message('\u0000'.repeat(100000))])
  assert.ok(Buffer.byteLength(JSON.stringify(rows)) <= LIMITS.inputBytes)
})
