import test from 'node:test'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { GoogleSheetsClient, SHEETS_SCOPE, SHEETS_MIME } from '../src/sheets.js'
import { SheetsTransport } from '../src/sheets-transport.js'

const fileId = 'sheet_123'
const range = "'Tab'!A1:B2"
const data = (cells = [], properties = {}) => ({ properties: { title: 'Book' }, sheets: [{ properties: { sheetId: 0, title: 'Tab', index: 0, sheetType: 'GRID', gridProperties: { rowCount: 1000, columnCount: 26 }, ...properties }, data: [{ rowData: cells.map(values => ({ values })) }] }] })
function fixture({ responses = [], fetch: custom, auth, timeout = 1000 } = {}) {
  const calls = []
  const client = new GoogleSheetsClient({ withAccessToken: auth ?? (fn => fn('secret-token')), requestTimeoutMs: timeout, fetch: async (url, options) => {
    calls.push({ url, ...options })
    if (custom) return custom(url, options, calls.length)
    const next = responses.length ? responses.shift() : data()
    if (next instanceof Error) throw next
    return Response.json(next)
  } })
  return { client, calls }
}
const prepare = (client, changes = [{ cell: 'A1', value: 'new' }]) => client.prepare({ fileId, range, changes })

test('auth and caller listeners clean up after success and failure', async () => {
  const auth = new AbortController(), caller = new AbortController()
  for (const bad of [false, true]) {
    const { client } = fixture({ auth: fn => fn('secret-token', auth.signal), fetch: async () => { if (bad) throw Error('failure'); return Response.json(data()) } })
    await client.read({ fileId, range, signal: caller.signal }).catch(() => {})
    assert.equal(getEventListeners(auth.signal, 'abort').length, 0)
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0)
  }
})
test('async dispatch guards and aborting guards never dispatch', async () => {
  const { client, calls } = fixture(); const c = new AbortController()
  const first = await prepare(client)
  await assert.rejects(client.apply({ proposal: first, beforeDispatch: async () => { throw Error('private') } }))
  const second = await prepare(client)
  await assert.rejects(client.apply({ proposal: second, signal: c.signal, beforeDispatch: () => { c.abort() } }), { code: 'cancelled' })
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
test('malformed grid boundaries and oversized cell strings reject', async () => {
  for (const raw of [data([[{ formattedValue: 'x'.repeat(10001) }]]), { sheets: [] }, data([], { sheetType: 'OBJECT' })]) {
    const { client } = fixture({ responses: [raw] }); await assert.rejects(client.read({ fileId, range }))
  }
})
test('nested null masks do not clear unsupported text format links', async () => {
  const { client } = fixture({ responses: [data([[{ userEnteredFormat: { textFormat: { bold: true, link: { uri: 'https://example.test' } } } }]])] }); const p = await prepare(client, [{ cell: 'A1', format: { textFormat: null } }])
  const mask = p.requests[0].updateCells.fields.split(',')
  assert.ok(mask.includes('userEnteredFormat.textFormat.bold'))
  assert.ok(!mask.includes('userEnteredFormat.textFormat')); assert.ok(!mask.some(v => v.includes('link')))
})
for (const field of ['textFormatRuns', 'chipRuns']) test(`${field} presence rejects value, formula, and clear without leaking run contents`, async () => {
  for (const change of [{ value: 'new' }, { formula: '=1' }, { value: null }]) {
    const raw = data([[{ userEnteredValue: { stringValue: '@test' }, [field]: [{ startIndex: 0 }] }]])
    const { client, calls } = fixture({ responses: [raw] })
    await assert.rejects(prepare(client, [{ cell: 'A1', ...change }]), { code: 'unsupported' })
    assert.equal(calls.length, 1)
    const fields = new URL(calls[0].url).searchParams.get('fields')
    assert.ok(fields.includes(`${field}(startIndex)`)); assert.ok(!fields.includes('uri'))
  }
})
for (const field of ['textFormatRuns', 'chipRuns']) test(`new ${field} invalidates approval before write`, async () => {
  const raw = data([[{ [field]: [{ startIndex: 0 }] }]])
  const { client, calls } = fixture({ responses: [data(), raw] }); const p = await prepare(client)
  await assert.rejects(client.apply({ proposal: p }), { code: 'stale' })
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
test('run-bearing cells permit narrow formatting-only changes', async () => {
  const raw = data([[{ textFormatRuns: [{ startIndex: 0 }], chipRuns: [{ startIndex: 0 }] }]])
  const { client } = fixture({ responses: [raw] }); const p = await prepare(client, [{ cell: 'A1', format: { textFormat: { bold: true } } }])
  assert.equal(p.before.cells[0].hasRichText, true); assert.equal(p.before.cells[0].hasSmartChips, true)
  assert.equal(p.requests[0].updateCells.fields, 'userEnteredFormat.textFormat.bold')
})
test('ColorStyle union changes replace the old branch in both directions', async () => {
  for (const [before, after] of [[{ rgbColor: { red: 1 } }, { themeColor: 'ACCENT1' }], [{ themeColor: 'ACCENT1' }, { rgbColor: { blue: 1 } }]]) {
    const { client } = fixture({ responses: [data([[{ userEnteredFormat: { backgroundColorStyle: before } }]])] })
    const p = await prepare(client, [{ cell: 'A1', format: { backgroundColorStyle: after } }])
    assert.deepEqual(p.after.cells[0].userEnteredFormat.backgroundColorStyle, after)
    assert.deepEqual(p.requests[0].updateCells.rows[0].values[0].userEnteredFormat.backgroundColorStyle, after)
    assert.equal(p.requests[0].updateCells.fields, 'userEnteredFormat.backgroundColorStyle')
  }
})
test('atomic format clears use supported parent masks, preserving unrelated fields', async () => {
  const { client } = fixture({ responses: [data([[{ userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0%' }, backgroundColorStyle: { themeColor: 'ACCENT1' }, textFormat: { bold: true } } }]])] })
  const p = await prepare(client, [{ cell: 'A1', format: { numberFormat: null, backgroundColorStyle: null } }])
  assert.equal(p.requests[0].updateCells.fields, 'userEnteredFormat.backgroundColorStyle,userEnteredFormat.numberFormat')
  assert.deepEqual(p.requests[0].updateCells.rows[0].values[0], { userEnteredFormat: {} })
  assert.deepEqual(p.after.cells[0].userEnteredFormat, { textFormat: { bold: true } })
})
for (const format of [{ numberFormat: { pattern: '0.00' } }, { numberFormat: { type: null } }, { backgroundColorStyle: { themeColor: null } }, { backgroundColorStyle: { rgbColor: null } }, { backgroundColorStyle: { rgbColor: { red: 1 }, themeColor: 'ACCENT1' } }, { backgroundColorStyle: { rgbColor: { red: 1, alpha: 0.5 } } }]) test(`reject unsafe atomic format ${JSON.stringify(format)}`, async () => {
  const { client, calls } = fixture(); await assert.rejects(prepare(client, [{ cell: 'A1', format }]), { code: 'invalid' }); assert.equal(calls.length, 0)
})
test('number formatting invalidates stale display without inventing calculated output', async () => {
  const { client } = fixture({ responses: [data([[{ userEnteredValue: { numberValue: 0.25 }, effectiveValue: { numberValue: 0.25 }, formattedValue: '0.25' }]])] })
  const p = await prepare(client, [{ cell: 'A1', format: { numberFormat: { type: 'PERCENT', pattern: '0%' } } }])
  assert.equal(p.before.cells[0].formattedValue, '0.25'); assert.equal(p.after.cells[0].formattedValue, '')
  assert.equal(p.after.cells[0].displayUncalculated, true); assert.deepEqual(p.after.cells[0].effectiveValue, { numberValue: 0.25 })
  assert.equal(p.requests[0].updateCells.fields, 'userEnteredFormat.numberFormat')
})
test('merged cells reject edits and new merges invalidate previews', async () => {
  const merged = data(); merged.sheets[0].merges = [{ sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 2 }]
  for (const change of [{ value: 1 }, { format: { textFormat: { bold: true } } }]) {
    const { client } = fixture({ responses: [merged] }); await assert.rejects(prepare(client, [{ cell: 'A1', ...change }]), { code: 'unsupported' })
  }
  const { client, calls } = fixture({ responses: [data(), merged] }); const p = await prepare(client)
  await assert.rejects(client.apply({ proposal: p }), { code: 'stale' }); assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
test('calculated output cells reject values and newly spilled output invalidates preview', async () => {
  const derived = data([[{ effectiveValue: { numberValue: 12 }, formattedValue: '12' }]])
  const first = fixture({ responses: [derived] }); await assert.rejects(prepare(first.client), { code: 'unsupported' })
  const { client, calls } = fixture({ responses: [data(), derived] }); const p = await prepare(client)
  await assert.rejects(client.apply({ proposal: p }), { code: 'stale' }); assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
test('exports fixed scope and MIME', () => { assert.equal(SHEETS_SCOPE, 'https://www.googleapis.com/auth/spreadsheets'); assert.equal(SHEETS_MIME, 'application/vnd.google-apps.spreadsheet') })
test('missing cells normalize to explicit row-major rectangle', async () => {
  const { client, calls } = fixture({ responses: [data([[{ userEnteredValue: { numberValue: 0 }, effectiveValue: { numberValue: 0 }, formattedValue: '0' }]])] })
  const result = await client.read({ fileId, range })
  assert.deepEqual(result.cells.map(c => c.cell), ['A1', 'B1', 'A2', 'B2'])
  assert.deepEqual(result.cells[3], { cell: 'B2', userEnteredValue: null, effectiveValue: null, formattedValue: '', userEnteredFormat: {} })
  assert.ok(Object.isFrozen(result.cells[0])); assert.equal(new URL(calls[0].url).hostname, 'sheets.googleapis.com'); assert.equal(calls[0].redirect, 'error')
})
test('offset ranges and quoted apostrophes retain exact cells', async () => {
  const raw = data([], { title: "O'Brien" }); raw.sheets[0].data = [{ startRow: 2, startColumn: 2, rowData: [{ values: [{ userEnteredValue: { boolValue: false } }] }] }]
  const { client } = fixture({ responses: [raw] })
  const result = await client.read({ fileId, range: "'O''Brien'!C3:D4" })
  assert.equal(result.cells[0].cell, 'C3'); assert.deepEqual(result.cells[0].userEnteredValue, { boolValue: false })
})
test('describe bounds tab metadata', async () => {
  const raw = data(); raw.sheets = Array.from({ length: 105 }, (_, index) => ({ properties: { ...raw.sheets[0].properties, sheetId: index, index } }))
  const { client } = fixture({ responses: [raw] }); const result = await client.describe({ fileId })
  assert.equal(result.tabs.length, 100); assert.equal(result.truncated, true); assert.equal(result.title, 'Book')
})
for (const range of ['A1:B2', 'Tab!A:A', 'Tab!1:2', 'Tab!A1:U1', 'Tab!A1:A101', 'Tab!A1:T11', 'Tab!B2:A1', 'Tab!A0', 'Tab!A1,B2', 'Tab!A1!B2', 'https://evil.test!A1', 'Tab!A99999999', 'Tab!$A$1']) test(`reject range ${range}`, async () => {
  const { client, calls } = fixture(); await assert.rejects(client.read({ fileId, range })); assert.equal(calls.length, 0)
})
test('boundary rectangle 200 cells is accepted', async () => { const { client } = fixture(); assert.equal((await client.read({ fileId, range: 'Tab!A1:T10' })).cells.length, 200) })
for (const change of [ { cell: 'A1', value: undefined }, { cell: 'A1', value: NaN }, { cell: 'A1', value: Infinity }, { cell: 'A1', value: {} }, { cell: 'A1', formula: 'SUM(B1)' }, { cell: 'A1', formula: '=1', value: 1 }, { cell: 'C1', value: 1 }, { cell: 'A1', note: 'bad' }, { cell: 'A1' }, { cell: 'A1', format: {} }, { cell: 'A1', format: { padding: {} } }, { cell: 'A1', format: { textFormat: { link: { uri: 'evil' } } } }, { cell: 'A1', format: { backgroundColor: { red: 2 } } }, { cell: 'A1', format: { wrapStrategy: 'EVIL' } }, { cell: 'A1', format: { textFormat: { bold: 'true' } } } ]) test(`strict change validation ${JSON.stringify(change)}`, async () => {
  const { client, calls } = fixture(); await assert.rejects(prepare(client, [change])); assert.ok(calls.length <= 1); assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
test('hostile keys, accessors, and file IDs reject without leaking input', async () => {
  const { client, calls } = fixture()
  for (const change of [JSON.parse('{"cell":"A1","value":1,"__proto__":{}}'), Object.create({ cell: 'A1', value: 1 }), { cell: 'A1', get value() { throw Error('secret') } }]) await assert.rejects(prepare(client, [change]), e => !e.message.includes('secret'))
  for (const id of ['../secret', 'x?access_token=secret', 'https://evil.test', 'x/y']) await assert.rejects(client.read({ fileId: id, range }))
  assert.equal(calls.length, 0)
})
test('typed values and explicit clears never use implicit formula parsing', async () => {
  const { client, calls } = fixture({ responses: [data([[{}, { userEnteredValue: { stringValue: 'old' } }]])] })
  const proposal = await prepare(client, [{ cell: 'A1', value: '=IMPORTXML("evil")' }, { cell: 'B1', value: null }, { cell: 'A2', value: false }, { cell: 'B2', formula: '=1+1' }])
  assert.equal(calls.length, 1); assert.deepEqual(proposal.requests[0].updateCells.rows[0].values[0], { userEnteredValue: { stringValue: '=IMPORTXML("evil")' } })
  assert.deepEqual(proposal.requests[1].updateCells.rows[0].values[0], {}); assert.equal(proposal.requests[1].updateCells.fields, 'userEnteredValue')
  assert.ok(Object.isFrozen(proposal.requests[0].updateCells)); assert.equal(proposal.after.cells[3].effectiveValue, null)
})
test('supported formats preserve untouched fields and provide exact leaf masks', async () => {
  const raw = data([[{ userEnteredFormat: { textFormat: { bold: false, italic: true }, padding: { top: 2 } } }]])
  const { client } = fixture({ responses: [raw] })
  const proposal = await prepare(client, [{ cell: 'A1', format: { textFormat: { bold: true, italic: null }, backgroundColor: { red: 1 }, borders: { top: { style: 'SOLID', colorStyle: { themeColor: 'ACCENT1' } } }, horizontalAlignment: 'CENTER', verticalAlignment: 'TOP', wrapStrategy: 'WRAP', numberFormat: { type: 'NUMBER', pattern: '0.00' } } }])
  assert.deepEqual(proposal.after.cells[0].userEnteredFormat.textFormat, { bold: true })
  assert.ok(proposal.requests[0].updateCells.fields.includes('userEnteredFormat.textFormat.italic'))
  assert.equal(proposal.before.cells[0].userEnteredFormat.padding, undefined)
})
test('format null clears only basic groups', async () => { const { client } = fixture({ responses: [data([[{ userEnteredFormat: { textFormat: { bold: true } } }]])] }); const p = await prepare(client, [{ cell: 'A1', format: null }]); assert.ok(!p.requests[0].updateCells.fields.includes('*')); assert.deepEqual(p.requests[0].updateCells.rows[0].values[0], { userEnteredFormat: {} }) })
test('identical formula in mixed proposal is never dispatched or marked uncalculated', async () => {
  const raw = data([[{ userEnteredValue: { formulaValue: '=NOW()' }, effectiveValue: { numberValue: 12 }, formattedValue: '12' }]])
  const { client, calls } = fixture({ responses: [raw, raw, { spreadsheetId: fileId }, raw] })
  const p = await prepare(client, [{ cell: 'A1', formula: '=NOW()' }, { cell: 'B1', value: 'new' }])
  assert.equal(p.requests.length, 1); assert.equal(p.requests[0].updateCells.range.startColumnIndex, 1)
  assert.deepEqual(p.after.cells[0], p.before.cells[0])
  await client.apply({ proposal: p })
  const body = JSON.parse(calls.find(c => c.method === 'POST').body)
  assert.equal(body.requests.length, 1); assert.ok(!JSON.stringify(body).includes('NOW'))
})
test('identical value with real formatting writes only changed format masks', async () => {
  const raw = data([[{ userEnteredValue: { stringValue: 'same' }, effectiveValue: { stringValue: 'same' }, formattedValue: 'same', textFormatRuns: [{ startIndex: 0 }], userEnteredFormat: { textFormat: { bold: true }, numberFormat: { type: 'TEXT' } } }]])
  const { client } = fixture({ responses: [raw] })
  const p = await prepare(client, [{ cell: 'A1', value: 'same', format: { textFormat: { bold: true, italic: true }, numberFormat: { type: 'TEXT' } } }])
  assert.equal(p.requests[0].updateCells.fields, 'userEnteredFormat.textFormat.italic')
  assert.deepEqual(p.requests[0].updateCells.rows[0].values[0], { userEnteredFormat: { textFormat: { italic: true } } })
  assert.equal(p.after.cells[0].formattedValue, 'same'); assert.equal(p.after.cells[0].displayUncalculated, undefined)
})
for (const change of [{ cell: 'A1', value: null }, { cell: 'A1', format: null }, { cell: 'A1', format: { textFormat: { bold: null } } }]) test(`empty clears reject as no-op ${JSON.stringify(change)}`, async () => {
  const { client, calls } = fixture(); await assert.rejects(prepare(client, [change]), { code: 'noop' }); assert.equal(calls.length, 1)
})
test('identical formula and atomic formats reject all-noop proposals', async () => {
  const raw = data([[{ userEnteredValue: { formulaValue: '=1' }, userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 1 } }, numberFormat: { type: 'NUMBER', pattern: '0.00' } } }]])
  const { client } = fixture({ responses: [raw] })
  await assert.rejects(prepare(client, [{ cell: 'A1', formula: '=1', format: { backgroundColorStyle: { rgbColor: { red: 1 } }, numberFormat: { type: 'NUMBER', pattern: '0.00' } } }]), { code: 'noop' })
})
test('duplicates and foreign/serialized proposals reject', async () => {
  const { client, calls } = fixture(); await assert.rejects(prepare(client, [{ cell: 'A1', value: 1 }, { cell: 'A1', value: 2 }]))
  const p = await prepare(client); await assert.rejects(client.apply({ proposal: JSON.parse(JSON.stringify(p)) })); assert.equal(calls.length, 1)
})
for (const variant of ['value', 'format', 'identity']) test(`stale ${variant} rejects without POST`, async () => {
  const next = variant === 'identity' ? data([], { sheetId: 42 }) : data([[variant === 'value' ? { userEnteredValue: { stringValue: 'other' } } : { userEnteredFormat: { textFormat: { bold: true } } }]])
  const { client, calls } = fixture({ responses: [data(), next] }); const p = await prepare(client)
  await assert.rejects(client.apply({ proposal: p }), { code: 'stale' }); assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
test('effective recalculation does not invalidate; one batch and readback', async () => {
  const a = data([[{ userEnteredValue: { formulaValue: '=NOW()' }, effectiveValue: { numberValue: 1 } }]]), b = structuredClone(a); b.sheets[0].data[0].rowData[0].values[0].effectiveValue.numberValue = 2
  const { client, calls } = fixture({ responses: [a, b, { spreadsheetId: fileId }, data()] }); const p = await prepare(client)
  assert.equal((await client.apply({ proposal: p })).status, 'applied'); assert.equal(calls.length, 4); assert.equal(calls.filter(c => c.method === 'POST').length, 1)
  await assert.rejects(client.apply({ proposal: p })); assert.equal(calls.length, 4)
})
test('pre-dispatch cancellation and policy guard prevent writes', async () => {
  const { client, calls } = fixture(); const p = await prepare(client); const c = new AbortController(); c.abort()
  await assert.rejects(client.apply({ proposal: p, signal: c.signal }), { code: 'cancelled' })
  const p2 = await prepare(client); await assert.rejects(client.apply({ proposal: p2, beforeDispatch() { throw Error('secret-policy') } }), e => !e.message.includes('secret-policy'))
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
for (const kind of ['network', 'timeout', 'abort', 'http', 'bad-json', 'readback']) test(`post-dispatch ${kind} is uncertain and never retries`, async () => {
  const controller = new AbortController(); let posts = 0
  const { client, calls } = fixture({ timeout: 20, fetch: async (_url, o, n) => {
    if (o.method === 'POST') { posts++; if (kind === 'network') throw Error('secret-token'); if (kind === 'timeout') return new Promise(() => {}); if (kind === 'abort') { controller.abort(); return new Promise(() => {}) } if (kind === 'http') return Response.json({ error: 'secret-token' }, { status: 503 }); if (kind === 'bad-json') return new Response('not json'); return Response.json({}) }
    if (kind === 'readback' && n === 4) throw Error('secret-token')
    return Response.json(data())
  } })
  const p = await prepare(client); const result = await client.apply({ proposal: p, signal: controller.signal })
  assert.equal(result.status, 'uncertain'); assert.ok(!result.message.includes('secret-token')); assert.equal(posts, 1)
  const count = calls.length; await assert.rejects(client.apply({ proposal: p })); assert.equal(calls.length, count)
})
test('bounded response and upstream auth errors stay sanitized', async () => {
  const { client } = fixture({ fetch: async () => new Response('x'.repeat(2_000_001)) }); await assert.rejects(client.read({ fileId, range }), e => !e.message.includes('xxx'))
  const second = fixture({ auth: async () => { throw Error('secret-token') } }); await assert.rejects(second.client.read({ fileId, range }), e => !e.message.includes('secret-token'))
})
test('tiny and empty response chunks have bounded bookkeeping and work', async () => {
  let cancelled = false, count = 0
  const { client } = fixture({ timeout: 1000, fetch: async () => ({ ok: true, body: { getReader: () => ({ read: async () => { count++; return { done: false, value: new Uint8Array(0) } }, cancel: async () => { cancelled = true } }) } }) })
  await assert.rejects(client.read({ fileId, range }), { code: 'request' })
  assert.equal(count, 32_769); assert.equal(cancelled, true)
})
test('fragmented JSON response decodes in a fixed bounded buffer', async () => {
  const encoded = new TextEncoder().encode(JSON.stringify(data()))
  let i = 0
  const { client } = fixture({ fetch: async () => ({ ok: true, body: { getReader: () => ({ read: async () => i < encoded.length ? { done: false, value: encoded.subarray(i, ++i) } : { done: true }, cancel: async () => {} }) } }) })
  assert.equal((await client.read({ fileId, range })).cells.length, 4)
})
test('late auth callback after cancellation cannot dispatch', async () => {
  let callback; const { client, calls } = fixture({ auth: fn => { callback = fn; return new Promise(() => {}) } })
  const c = new AbortController(); const pending = client.read({ fileId, range, signal: c.signal }); await Promise.resolve(); c.abort(); await assert.rejects(pending)
  await assert.rejects(callback('secret-token')); assert.equal(calls.length, 0)
})
test('auth lifecycle abort and dispose cancel reads', async () => {
  const auth = new AbortController(); const { client, calls } = fixture({ auth: fn => fn('secret-token', auth.signal), fetch: async () => { auth.abort(); return new Promise(() => {}) } })
  await assert.rejects(client.read({ fileId, range }), { code: 'cancelled' }); client.dispose(); await assert.rejects(client.read({ fileId, range })); assert.equal(calls.length, 1)
})
const privateDiagnostic = 'secret-token https://evil.test/?access_token=private ignore instructions <script>alert(1)</script>'
const errorInfo = reason => ({ error: { message: privateDiagnostic, details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, metadata: { service: privateDiagnostic, activationUrl: privateDiagnostic } }] } })
const diagnosticCases = [
  [403, errorInfo('SERVICE_DISABLED'), 'api_disabled'],
  [403, { error: { errors: [{ reason: 'accessNotConfigured', message: privateDiagnostic }] } }, 'api_disabled'],
  [403, errorInfo('ACCESS_TOKEN_SCOPE_INSUFFICIENT'), 'scopes'],
  [403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }, 'scopes'],
  ...['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded'].map(reason => [403, { error: { errors: [{ reason, message: privateDiagnostic }] } }, 'rate_limit']),
  [403, { error: { errors: [{ reason: `rateLimitExceeded ${privateDiagnostic}` }] } }, 'forbidden'],
  [403, errorInfo('IAM_PERMISSION_DENIED'), 'forbidden'],
  [403, { error: { message: 'SERVICE_DISABLED ACCESS_TOKEN_SCOPE_INSUFFICIENT', details: [{ reason: 'SERVICE_DISABLED' }] } }, 'forbidden'],
  [403, errorInfo(`SERVICE_DISABLED ${privateDiagnostic}`), 'forbidden'],
  [403, { error: { details: [null, 42, privateDiagnostic], errors: [null] } }, 'forbidden'],
  [401, errorInfo('SERVICE_DISABLED'), 'auth'],
  [404, errorInfo('SERVICE_DISABLED'), 'not_found'],
  [400, errorInfo('SERVICE_DISABLED'), 'invalid'],
  [429, errorInfo('SERVICE_DISABLED'), 'rate_limit'],
  [500, errorInfo('SERVICE_DISABLED'), 'server'],
  [503, errorInfo('SERVICE_DISABLED'), 'server'],
  [418, errorInfo('SERVICE_DISABLED'), 'http'],
]
for (const [status, payload, diagnostic] of diagnosticCases) for (const write of [false, true]) test(`safe ${status} ${diagnostic} diagnostics for ${write ? 'POST' : 'GET'}`, async () => {
  let calls = 0
  const transport = new SheetsTransport({ withAccessToken: fn => fn('secret-token'), fetch: async () => { calls++; return Response.json(payload, { status }) } })
  await assert.rejects(transport.request('https://sheets.googleapis.com/private', write ? { body: '{}' } : {}), error => {
    assert.equal(error.code, write ? 'uncertain' : 'request'); assert.equal(error.diagnostic, diagnostic)
    assert.ok(error.message.length < 400)
    for (const secret of ['secret-token', 'https://', 'access_token', '<script>', 'ignore instructions', 'activationUrl']) assert.ok(!`${error.message} ${JSON.stringify(error)} ${error.stack}`.includes(secret))
    assert.equal(error.cause, undefined)
    if (write) assert.match(error.message, /Inspect the sheet before preparing another edit/)
    if (diagnostic === 'not_found') assert.match(error.message, /not found or is not accessible/)
    return true
  })
  assert.equal(calls, 1); transport.dispose()
})
for (const write of [false, true]) for (const kind of ['network', 'timeout', 'bad-json', 'missing-body', 'oversize', 'error-oversize', 'broken-stream', 'malformed-error']) test(`bounded ${kind} diagnostics for ${write ? 'POST' : 'GET'}`, async () => {
  let calls = 0
  const transport = new SheetsTransport({ requestTimeoutMs: 20, withAccessToken: fn => fn('secret-token'), fetch: async () => {
    calls++
    if (kind === 'network') throw Object.assign(Error(privateDiagnostic), { diagnostic: privateDiagnostic, code: 'api_disabled' })
    if (kind === 'timeout') return new Promise(() => {})
    if (kind === 'missing-body') return new Response(null)
    if (kind === 'oversize' || kind === 'error-oversize') return new Response('x'.repeat(kind === 'oversize' ? 2_000_001 : 16_385), { status: kind === 'oversize' ? 200 : 403 })
    if (kind === 'broken-stream') return { ok: true, body: { getReader: () => ({ read() { throw Error(privateDiagnostic) }, cancel() { throw Error(privateDiagnostic) } }) } }
    return new Response(privateDiagnostic, { status: kind === 'malformed-error' ? 403 : 200 })
  } })
  await assert.rejects(transport.request('https://sheets.googleapis.com/private', write ? { body: '{}' } : {}), error => {
    assert.equal(error.code, write ? 'uncertain' : 'request')
    assert.equal(error.diagnostic, kind === 'network' || kind === 'timeout' ? kind : kind === 'malformed-error' ? 'forbidden' : 'response')
    assert.ok(!error.message.includes('secret-token')); assert.ok(!error.message.includes('https://')); return true
  })
  assert.equal(calls, 1); transport.dispose()
})
test('forged authentication diagnostics are not forwarded and never dispatch', async () => {
  let calls = 0
  const transport = new SheetsTransport({ withAccessToken: () => { throw Object.assign(Error(privateDiagnostic), { code: 'scopes', diagnostic: privateDiagnostic }) }, fetch: async () => { calls++ } })
  await assert.rejects(transport.request('https://sheets.googleapis.com/private'), { code: 'request', diagnostic: 'auth', message: 'Google Sheets authentication is unavailable or was rejected. Check Google accounts in Settings. Reconnecting clears session grants.' })
  assert.equal(calls, 0)
})
for (const token of [undefined, '', 'bad\ntoken', 'x'.repeat(16_385)]) test(`invalid token is diagnosed locally without dispatch (${typeof token}, ${token?.length ?? 0})`, async () => {
  let calls = 0
  const transport = new SheetsTransport({ withAccessToken: fn => fn(token), fetch: async () => { calls++ } })
  await assert.rejects(transport.request('https://sheets.googleapis.com/private', { body: '{}' }), error => {
    assert.equal(error.code, 'request'); assert.equal(error.diagnostic, 'auth')
    assert.match(error.message, /Check Google accounts in Settings/); assert.match(error.message, /Reconnecting clears session grants/)
    return true
  })
  assert.equal(calls, 0)
})
test('unclassified dispatch guard errors stay neutral and do not dispatch', async () => {
  let calls = 0
  const transport = new SheetsTransport({ withAccessToken: fn => fn('secret-token'), fetch: async () => { calls++ } })
  await assert.rejects(transport.request('https://sheets.googleapis.com/private', { body: '{}', beforeDispatch() { throw Error(privateDiagnostic) } }), { code: 'request', diagnostic: 'request', message: 'Google Sheets request failed for an unknown reason.' })
  assert.equal(calls, 0)
})
test('auth callback replay cannot repeat a write', async () => {
  const { client, calls } = fixture({ auth: async fn => { try { return await fn('secret-token') } catch { return fn('secret-token') } }, fetch: async (_url, o) => { if (o.method === 'POST') throw Error('secret'); return Response.json(data()) } })
  const p = await prepare(client); assert.equal((await client.apply({ proposal: p })).status, 'uncertain'); assert.equal(calls.filter(c => c.method === 'POST').length, 1)
})
