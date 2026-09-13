import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { fields, item } from './write-payloads.js'
let record
vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load(value) { record = value } } }, URL })
const plugin = record.factory(() => ({}))
const value = (dataType, before, after, selectedOption = null) => ({ field: fields.find(field => field.dataType === dataType), before, after, selectedOption })
const result = outcome => ({ kind: 'tool-result', content: [{ type: 'text', text: JSON.stringify({ host: 'github.com', operation: 'setProjectItemField', outcome }) }] })

test('exact supported field values preserve empty, zero, fractional and multiline values', () => {
  for (const [change, before, after] of [
    [value('TEXT', { text: '' }, { text: 'Exact  multiline\ntext' }), '""', '"Exact  multiline\\ntext"'],
    [value('NUMBER', { number: 0 }, { number: -1.25 }), '0', '-1.25'],
    [value('DATE', { date: '2024-02-29' }, { date: '2026-01-01' }), '2024-02-29', '2026-01-01'],
    [value('SINGLE_SELECT', item.fieldValues.nodes[0], { singleSelectOptionId: 'OPT_READY' }, { id: 'OPT_READY', name: 'Ready' }), 'Todo', 'Ready'],
    [value('ITERATION', { iterationId: 'OLD', title: 'Old sprint' }, { iterationId: 'NEW' }, { id: 'NEW', title: 'Current sprint', startDate: '2026-01-01', duration: 14 }), 'Old sprint', 'Current sprint'],
  ]) {
    assert.equal(plugin.fieldValueModel(change, 'before').label, before)
    assert.equal(plugin.fieldValueModel(change, 'after').label, after)
  }
})
test('completed iterations and missing friendly names use verified selected identity', () => {
  const selected = fields[4].configuration.completedIterations[0]
  const change = value('ITERATION', { iterationId: 'BEFORE' }, { iterationId: selected.id }, selected)
  assert.equal(plugin.fieldValueModel(change, 'before').label, 'BEFORE')
  assert.equal(plugin.fieldValueModel(change, 'after').label, 'Old sprint')
  assert.equal(plugin.fieldValueModel(change, 'after').detail, '2025-12-01 · 14 days')
  assert.equal(plugin.fieldValueModel({ ...change, selectedOption: { id: 'WRONG', title: 'Misleading' } }, 'after').label, selected.id)
})
test('null means unset while absent or malformed values never imply clearing or a previous value', () => {
  assert.equal(plugin.fieldValueModel(value('TEXT', null, { text: '' }), 'before').label, 'Not set')
  for (const change of [value('TEXT', undefined, { text: 'new' }), value('TEXT', { number: 4 }, { text: 'new' }), value('TEXT', { text: 'old', field: { id: 'FOREIGN' } }, { text: 'new' })]) assert.equal(plugin.fieldValueModel(change, 'before').available, false)
  for (const change of [value('NUMBER', null, { number: Infinity }), value('DATE', null, { date: '2026-02-30' }), value('TEXT', null, { text: 'new', number: 1 }), value('NUMBER', null, { number: '2' }), { field: { id: 'F', dataType: 'LABELS' }, after: {} }]) assert.equal(plugin.fieldValueModel(change, 'after').available, false)
})
test('field DTO binds version, tool and call while accepting only explicit expired identity fallback', () => {
  const status = { version: 1, toolName: 'github_set_project_item_field', callId: 'call', phase: 'prepared' }
  assert.equal(plugin.validFieldStatus(status, 'call'), true)
  assert.equal(plugin.validFieldStatus({ version: 1, phase: 'expired', grants: [], history: [] }, 'call'), true)
  for (const wrong of [null, { ...status, callId: 'other' }, { ...status, toolName: 'github_create_issue' }, { version: 1, phase: 'confirmed' }, { ...status, exactPreview: {} }]) assert.equal(plugin.validFieldStatus(wrong, 'call'), false)
})
test('explicit uncertainty wins over confirmation; approval never becomes confirmation', () => {
  assert.equal(plugin.fieldPhase({ phase: 'confirmed' }, result('uncertain')), 'uncertain')
  assert.equal(plugin.fieldPhase({ phase: 'uncertain' }, result('confirmed')), 'uncertain')
  assert.equal(plugin.fieldPhase({ phase: 'confirmed' }, { ...result('confirmed'), isError: true }), 'uncertain')
  assert.equal(plugin.fieldPhase({ phase: 'approved' }, {}), 'approved')
  assert.equal(plugin.fieldPhase({ phase: 'authorized-by-grant' }, {}), 'authorized-by-grant')
  assert.equal(plugin.fieldPhase({ phase: 'running' }, {}, {}), 'awaiting-approval')
  assert.equal(plugin.fieldPhase({ phase: 'running' }, result('confirmed')), 'confirmed')
  assert.equal(plugin.fieldPhase(undefined, { kind: 'tool-result', isError: false, content: [{ type: 'text', text: 'not JSON' }] }), 'unknown')
})
test('no-change requires its structured reason and explicit no-dispatch evidence', () => {
  const block = payload => ({ kind: 'tool-result', content: [{ type: 'text', text: JSON.stringify(payload) }] })
  const value = { host: 'github.com', operation: 'setProjectItemField', outcome: 'no-change', dispatched: false, reason: 'FIELD_VALUE_ALREADY_SET' }
  assert.equal(plugin.fieldPhase(null, block(value)), 'no-change')
  assert.equal(plugin.fieldPhase({ result: value, phase: 'no-change' }, {}), 'no-change')
  assert.equal(plugin.fieldPhase(null, { ...block(value), isError: true }), 'failed')
  for (const invalid of [{ ...value, reason: undefined }, { ...value, dispatched: undefined }, { ...value, dispatched: true }, { ...value, reason: 'already exists' }]) {
    assert.equal(plugin.fieldResult(block(invalid)), undefined)
    assert.equal(plugin.fieldPhase({ phase: 'no-change', result: invalid }, block(invalid)), 'unknown')
  }
  assert.equal(plugin.fieldPhase(null, { kind: 'tool-result', isError: true, content: [{ type: 'text', text: 'Error: The requested relationship or value already exists. No mutation was dispatched.' }] }), 'failed')
  assert.equal(plugin.fieldPhaseLabel('failed'), 'Field change failed')
})
test('malformed or foreign result envelopes never imply success', () => {
  for (const payload of [{ outcome: 'confirmed' }, { host: 'github.com', operation: 'createIssue', outcome: 'confirmed' }, { host: 'github.com', outcome: 'confirmed' }]) assert.equal(plugin.fieldResult({ kind: 'tool-result', content: [{ type: 'text', text: JSON.stringify(payload) }] }), undefined)
  const malformed = { kind: 'tool-result', content: [{ type: 'text', text: 'malformed' }] }
  assert.equal(plugin.fieldPhase({ phase: 'confirmed' }, malformed), 'unknown')
  assert.equal(plugin.fieldPhase({ phase: 'confirmed', result: { outcome: 'confirmed' } }, malformed), 'unknown')
  assert.equal(plugin.fieldPhase({ phase: 'confirmed', result: { host: 'github.com', operation: 'setProjectItemField', outcome: 'confirmed' } }, malformed), 'confirmed')
  assert.equal(plugin.fieldResult(result('confirmed')).outcome, 'confirmed')
  assert.equal(plugin.fieldResult({ kind: 'tool-result', content: [{ type: 'text', text: JSON.stringify({ host: 'github.com', outcome: 'failed', error: { code: 'CONFLICT' } }) }] }).outcome, 'failed')
})
