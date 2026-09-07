// Run from any directory: node packages/dsh-google-drive/test/generate-sheets-preview.mjs
// Synthetic data only. The real client prepares this fixture without network or writes.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { GoogleSheetsClient } from '../src/sheets.js'

const cell = (value, format = {}, formattedValue = '') => ({
  ...(value === null ? {} : { userEnteredValue: value, effectiveValue: value.formulaValue ? { numberValue: 2 } : value }),
  formattedValue, userEnteredFormat: format,
})
const rows = [
  [
    cell({ numberValue: 0 }, {}, '0'),
    cell({ stringValue: '0' }, { backgroundColorStyle: { rgbColor: { red: 1, green: 0.2, blue: 0.1 } } }, '0'),
    cell({ boolValue: true }, { backgroundColorStyle: { themeColor: 'ACCENT2' } }, 'TRUE'),
    cell(null, { numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' } }),
    cell({ stringValue: '' }, { textFormat: { bold: true, italic: true } }),
  ],
  [
    cell({ stringValue: 'Clear me' }, { textFormat: { fontFamily: 'Arial', fontSize: 12, bold: true, italic: true, foregroundColor: { red: 0.4 } } }, 'Clear me'),
    cell({ numberValue: 12 }, { backgroundColor: { red: 1 }, textFormat: { bold: true }, numberFormat: { type: 'NUMBER', pattern: '0.00' }, horizontalAlignment: 'RIGHT', wrapStrategy: 'WRAP' }, '12.00'),
    cell({ formulaValue: '=1+1' }, {}, '2'),
    cell({ stringValue: '=1+1' }, {}, '=1+1'),
    cell({ boolValue: false }, { borders: { top: { style: 'SOLID', color: { red: 0.2 } } } }, 'FALSE'),
  ],
]
const changes = [
  { cell: 'A1', value: '0', format: { backgroundColor: {} } },
  { cell: 'B1', value: 0, format: { backgroundColorStyle: { themeColor: 'ACCENT1' } } },
  { cell: 'C1', value: 'true', format: { backgroundColorStyle: { rgbColor: { blue: 1 } } } },
  { cell: 'D1', value: '', format: { numberFormat: { type: 'NUMBER' } } },
  { cell: 'E1', value: null, format: { textFormat: { bold: null } } },
  { cell: 'A2', value: null, format: { textFormat: null } },
  { cell: 'B2', format: null },
  { cell: 'C2', value: '=1+1' },
  { cell: 'D2', formula: '=1+1' },
  { cell: 'E2', value: 'false', format: { borders: { top: { style: 'NONE' } } } },
]
let calls = 0
const client = new GoogleSheetsClient({
  withAccessToken: fn => fn('synthetic-fixture-token'),
  fetch: async (url, options) => {
    calls++
    assert.equal(new URL(url).hostname, 'sheets.googleapis.com')
    assert.equal(options.method, 'GET', 'fixture generation must never dispatch a write')
    assert.equal(new URL(url).searchParams.get('ranges'), "'Tab'!A1:E2")
    return Response.json({ sheets: [{ properties: { sheetId: 7, title: 'Tab', sheetType: 'GRID', gridProperties: { rowCount: 100, columnCount: 20 } }, data: [{ rowData: rows.map(values => ({ values })) }] }] })
  },
})
try {
  const proposal = await client.prepare({ fileId: 'synthetic-preview-book', range: 'Tab!A1:E2', changes })
  assert.equal(calls, 1)
  assert.equal(proposal.requests.length, 10)
  assert.ok(Object.isFrozen(proposal))
  const after = Object.fromEntries(proposal.after.cells.map(c => [c.cell, c]))
  assert.deepEqual(after.A1.userEnteredFormat.backgroundColor, {})
  assert.deepEqual(after.B1.userEnteredFormat.backgroundColorStyle, { themeColor: 'ACCENT1' })
  assert.deepEqual(after.C1.userEnteredFormat.backgroundColorStyle, { rgbColor: { blue: 1 } })
  assert.deepEqual(after.D1.userEnteredFormat.numberFormat, { type: 'NUMBER' })
  assert.deepEqual(after.D1.userEnteredValue, { stringValue: '' })
  assert.equal(after.E1.userEnteredValue, null)
  assert.deepEqual(after.E1.userEnteredFormat.textFormat, { italic: true })
  assert.deepEqual(after.A2.userEnteredFormat, {})
  assert.deepEqual(after.B2.userEnteredFormat, {})
  const fixture = { state: 'pending', requestId: 'synthetic-preview-request', preview: {
    fileId: proposal.fileId, fileName: 'Synthetic format and value transitions', range: proposal.range,
    tab: proposal.tab, before: proposal.before, after: proposal.after,
  } }
  const output = JSON.stringify(fixture, null, 2) + '\n'
  assert.ok(!output.includes('requests'))
  assert.ok(!output.includes('synthetic-fixture-token'))
  const directory = new URL('./fixtures/', import.meta.url)
  if (process.argv.includes('--check')) {
    assert.equal(await readFile(new URL('sheets-preview.json', directory), 'utf8'), output, 'Regenerate the synthetic Sheets browser fixture after reviewing client contract changes.')
  } else {
    await mkdir(directory, { recursive: true })
    await writeFile(new URL('sheets-preview.json', directory), output, 'utf8')
    console.log('Generated test/fixtures/sheets-preview.json from GoogleSheetsClient.prepare (10 cells, no network).')
  }
} finally { client.dispose() }
