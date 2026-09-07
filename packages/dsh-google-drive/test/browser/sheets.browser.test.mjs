import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import source from '../../client.js?raw'
import preparedFixture from '../fixtures/sheets-preview.json'
let root, container
const h = React.createElement
const click = locator => act(async () => locator.click())
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => { await act(async () => root?.unmount()); container?.remove() })
const tab = { sheetId: 0, title: 'Budget', rowCount: 10, columnCount: 4 }
const before = { fileId: 'sheet', range: 'Budget!A1:B2', tab, cells: [
  { cell: 'A1', userEnteredValue: { stringValue: 'Budget' } },
  { cell: 'B1', userEnteredValue: { numberValue: 10 } },
  { cell: 'A2', userEnteredValue: { stringValue: '<script>unsafe</script>' } },
  { cell: 'B2', userEnteredValue: { formulaValue: '=B1*2' }, effectiveValue: { numberValue: 20 }, formattedValue: '20' },
] }
const after = { ...before, cells: [before.cells[0], { ...before.cells[1], userEnteredFormat: { textFormat: { bold: true }, numberFormat: { type: 'CURRENCY', pattern: '€0.00' } } }, { cell: 'A2' }, { cell: 'B2', userEnteredValue: { formulaValue: '=B1*3' }, effectiveValue: { numberValue: 999999 } }] }
const pending = { state: 'pending', requestId: 'opaque', preview: { fileId: 'sheet', range: before.range, tab, before, after } }
async function mount(component, handler) {
  let record
  const previous = window.__ModuleLoader__
  window.__ModuleLoader__ = { load: value => { record = value } }
  try { new Function(source)() } finally { window.__ModuleLoader__ = previous }
  const plugin = record.factory(() => React), picker = plugin.createPickerStore(), calls = []
  const request = async (method, body, signal) => { calls.push({ method, body, signal }); return handler(method, body, signal) }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(h(React.Fragment, null, h(plugin[component], { sessionId: 's', callId: 'c', picker, request }), h(plugin.Overlay, { picker }))))
  return { calls, plugin, async switchSession(sessionId) { await act(async () => root.render(h(plugin[component], { sessionId, callId: 'c', picker, request }))) } }
}
test('edit picker navigates folders but grants only native spreadsheets', async () => {
  const status = { state: 'pending', mode: 'edit', requestId: 'opaque', grants: [] }
  const fixture = await mount('EditCard', method => method === 'edit-browse' ? { files: [
    { id: 'folder', name: 'Reports', mimeType: 'application/vnd.google-apps.folder' },
    { id: 'pdf', name: 'Report PDF', mimeType: 'application/pdf' },
    { id: 'sheet', name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet' },
  ] } : method === 'edit-grant' ? { ...status, state: 'granted' } : status)
  await click(page.getByRole('button', { name: 'Choose spreadsheets' }))
  await expect.element(page.getByRole('checkbox', { name: 'Reports', exact: true })).toBeDisabled()
  await expect.element(page.getByRole('checkbox', { name: 'Report PDF' })).toBeDisabled()
  await click(page.getByRole('button', { name: 'Reports', exact: true }))
  expect(fixture.calls.at(-1).body.parentId).toBe('folder')
  await click(page.getByRole('checkbox', { name: 'Budget', exact: true }))
  await click(page.getByRole('button', { name: 'Allow editing for this session' }))
  expect(fixture.calls.find(c => c.method === 'edit-grant').body).toEqual({ sessionId: 's', callId: 'c', requestId: 'opaque', selected: [{ id: 'sheet', recursive: false }] })
})
test('preview displays exact clear/formula/format details and applies identity only once', async () => {
  const fixture = await mount('PreviewCard', method => method === 'preview-apply' ? { ...pending, state: 'applied' } : pending)
  await click(page.getByRole('button', { name: 'Review changes' }))
  await expect.element(page.getByRole('heading', { name: 'Exact changes' })).toBeVisible()
  expect(page.getByRole('dialog').element().textContent).toContain('1 cleared')
  expect(page.getByRole('dialog').element().textContent).toContain('Number Format › Pattern')
  expect(page.getByRole('dialog').element().textContent).toContain('=B1*3')
  expect(page.getByRole('dialog').element().textContent).not.toContain('999999')
  expect(page.getByRole('dialog').element().querySelector('script')).toBeNull()
  await click(page.getByRole('button', { name: 'Apply changes', exact: true }))
  expect(fixture.calls.find(c => c.method === 'preview-apply').body).toEqual({ sessionId: 's', callId: 'c', requestId: 'opaque' })
  await expect.element(page.getByRole('button', { name: 'Apply changes', exact: true })).not.toBeInTheDocument()
  expect(fixture.calls.filter(c => c.method === 'preview-apply')).toHaveLength(1)
})
test('lost apply response becomes terminal uncertain without retry', async () => {
  await mount('PreviewCard', method => { if (method === 'preview-apply') throw new Error('lost'); return pending })
  await click(page.getByRole('button', { name: 'Review changes' }))
  await click(page.getByRole('button', { name: 'Apply changes', exact: true }))
  await expect.element(page.getByRole('button', { name: 'Apply changes', exact: true })).not.toBeInTheDocument()
  expect(page.getByRole('dialog').element().textContent).toContain('Do not retry')
})
test('cancel proposal sends deny identity, never a write', async () => {
  const fixture = await mount('PreviewCard', method => method === 'preview-deny' ? { ...pending, state: 'denied' } : pending)
  await click(page.getByRole('button', { name: 'Review changes' }))
  await click(page.getByRole('button', { name: 'Cancel proposal' }))
  expect(fixture.calls.find(c => c.method === 'preview-deny').body).toEqual({ sessionId: 's', callId: 'c', requestId: 'opaque' })
  expect(fixture.calls.some(c => c.method === 'preview-apply')).toBe(false)
})
test('in-flight Apply is one shot and disables cancellation', async () => {
  let settle
  const fixture = await mount('PreviewCard', method => method === 'preview-apply' ? new Promise(resolve => { settle = resolve }) : pending)
  await click(page.getByRole('button', { name: 'Review changes' }))
  const apply = page.getByRole('button', { name: 'Apply changes', exact: true }).element()
  await act(async () => { apply.click(); apply.click() })
  expect(fixture.calls.filter(c => c.method === 'preview-apply')).toHaveLength(1)
  await expect.element(page.getByRole('button', { name: 'Cancel proposal' })).toBeDisabled()
  await act(async () => settle({ ...pending, state: 'applied' }))
})
test('preparing proposal can be cancelled without any apply', async () => {
  const fixture = await mount('PreviewCard', method => ({ state: method === 'preview-deny' ? 'cancelled' : 'preparing', requestId: 'opaque' }))
  await click(page.getByRole('button', { name: 'Cancel proposal' }))
  expect(fixture.calls.find(c => c.method === 'preview-deny').body).toEqual({ sessionId: 's', callId: 'c', requestId: 'opaque' })
  expect(fixture.calls.some(c => c.method === 'preview-apply')).toBe(false)
})
test('checking unknown outcome cannot restore approval even if server returns pending', async () => {
  const fixture = await mount('PreviewCard', method => { if (method === 'preview-apply') throw new Error('lost'); return pending })
  await click(page.getByRole('button', { name: 'Review changes' }))
  await click(page.getByRole('button', { name: 'Apply changes', exact: true }))
  await click(page.getByRole('button', { name: 'Close', exact: true }))
  await click(page.getByRole('button', { name: 'Check outcome status' }))
  await click(page.getByRole('button', { name: 'View proposal' }))
  await expect.element(page.getByRole('button', { name: 'Apply changes', exact: true })).not.toBeInTheDocument()
  expect(fixture.calls.filter(c => c.method === 'preview-apply')).toHaveLength(1)
})
test.each([[100, 2], [10, 20]])('all 200 changes remain reviewable for %i rows and %i columns', async (rows, columns) => {
  const cells = Array.from({ length: rows * columns }, (_, i) => ({ cell: `${String.fromCharCode(65 + i % columns)}${Math.floor(i / columns) + 1}`, userEnteredValue: { stringValue: 'before' } }))
  const long = 'Long unbroken value '.repeat(500) + 'END-OF-CELL'
  const proposal = { ...pending, preview: { ...pending.preview, fileName: 'Annual operating budget', before: { ...before, cells }, after: { ...after, cells: cells.map((c, i) => ({ ...c, userEnteredValue: { stringValue: i === 199 ? long : 'after' } })) } } }
  const { plugin } = await mount('PreviewCard', () => proposal)
  expect(plugin.validPreviewStatus(proposal)).toBe(true)
  await click(page.getByRole('button', { name: 'Review changes' }))
  const dialog = page.getByRole('dialog').element()
  expect(dialog.textContent).toContain('Annual operating budget')
  expect(dialog.querySelectorAll('.gs-detail')).toHaveLength(200)
  expect(dialog.querySelectorAll('td')).toHaveLength(400)
  const last = dialog.querySelectorAll('.gs-detail')[199]
  expect(last.textContent).toContain(long)
  const value = last.querySelectorAll('.gs-value')[1]
  expect(getComputedStyle(value).whiteSpace).toBe('pre-wrap')
  expect(getComputedStyle(value).overflowWrap).toBe('anywhere')
  expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1)
  const body = dialog.querySelector('.gs-body')
  body.scrollTop = body.scrollHeight
  expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(dialog.getBoundingClientRect().bottom)
})
test('exact values distinguish types, empty strings, clearing and whitespace', async () => {
  const values = [{ numberValue: 1 }, { boolValue: true }, { stringValue: '' }, { stringValue: 'old' }, null, { stringValue: 'old' }]
  const next = [{ stringValue: '1' }, { stringValue: 'TRUE' }, null, { stringValue: '' }, { stringValue: '  \n\t' }, { formulaValue: '=1' }]
  const snapshot = list => ({ ...before, cells: list.map((value, i) => ({ cell: `A${i + 1}`, userEnteredValue: value })) })
  await mount('PreviewCard', () => ({ ...pending, preview: { ...pending.preview, before: snapshot(values), after: snapshot(next) } }))
  await click(page.getByRole('button', { name: 'Review changes' }))
  const dialog = page.getByRole('dialog').element()
  expect(dialog.textContent).toContain('1 cleared')
  const details = dialog.querySelectorAll('.gs-detail')
  expect(details[0].textContent).toContain('Number'); expect(details[0].textContent).toContain('"1"Text')
  expect(details[1].textContent).toContain('Boolean'); expect(details[1].textContent).toContain('"TRUE"Text')
  expect(details[2].textContent).toContain('""Empty string'); expect(details[2].textContent).toContain('Empty cell · Clear cell value')
  expect(details[3].textContent).toContain('""Empty string'); expect(details[3].textContent).not.toContain('Clear cell value')
  expect(details[4].querySelectorAll('.gs-value')[1].textContent).toBe(JSON.stringify(next[4].stringValue))
  expect(details[5].textContent).toContain('Formula · result not predicted')
})
test('empty RGB objects and cleared formats have exact visible descriptions', async () => {
  const a = [{ cell: 'A1' }, { cell: 'A2', userEnteredFormat: { backgroundColor: {} } }, { cell: 'A3' }]
  const b = [{ cell: 'A1', userEnteredFormat: { backgroundColor: {} } }, { cell: 'A2' }, { cell: 'A3', userEnteredFormat: { backgroundColorStyle: { rgbColor: {} } } }]
  await mount('PreviewCard', () => ({ ...pending, preview: { ...pending.preview, before: { ...before, cells: a }, after: { ...after, cells: b } } }))
  await click(page.getByRole('button', { name: 'Review changes' }))
  const details = page.getByRole('dialog').element().querySelectorAll('.gs-detail')
  expect(details[0].textContent).toContain('Default / unset → {} (RGB default black)')
  expect(details[1].textContent).toContain('{} (RGB default black) → Default / unset')
  expect(details[2].textContent).toContain('Background Color Style › Rgb Color')
  expect(details[2].textContent).toContain('{} (RGB default black)')
})
test('session changes and unmount abort outstanding status reads', async () => {
  const fixture = await mount('PreviewCard', () => new Promise(() => {}))
  const first = fixture.calls[0].signal
  await fixture.switchSession('other')
  expect(first.aborted).toBe(true)
  expect(fixture.calls.at(-1).body.sessionId).toBe('other')
  const second = fixture.calls.at(-1).signal
  await act(async () => root.unmount()); root = undefined
  expect(second.aborted).toBe(true)
})
test('real GoogleSheetsClient.prepare fixture exposes every typed and format transition', async () => {
  const { plugin } = await mount('PreviewCard', () => preparedFixture)
  expect(plugin.validPreviewStatus(preparedFixture)).toBe(true)
  await click(page.getByRole('button', { name: 'Review changes' }))
  const dialog = page.getByRole('dialog').element()
  expect(dialog.querySelectorAll('.gs-detail')).toHaveLength(10)
  const detail = cell => dialog.querySelector(`[aria-label="Changes to ${cell}"]`).textContent
  expect(detail('A1')).toContain('RGB default black')
  expect(detail('B1')).toContain('ACCENT1'); expect(detail('B1')).toContain('→ Default / unset')
  expect(detail('C1')).toContain('ACCENT2 → Default / unset'); expect(detail('C1')).toContain('Rgb Color › Blue')
  expect(detail('D1')).toContain('CURRENCY → NUMBER'); expect(detail('D1')).toContain('Number Format › Pattern'); expect(detail('D1')).toContain('Empty string')
  expect(detail('E1')).toContain('Clear cell value'); expect(detail('E1')).toContain('Bold')
  expect(detail('A2')).toContain('Default / unset'); expect(detail('B2')).toContain('Default / unset')
  expect(detail('C2')).toContain('"=1+1"Text'); expect(detail('D2')).toContain('"=1+1"Formula')
  expect(detail('E2')).toContain('Boolean'); expect(detail('E2')).toContain('"false"Text'); expect(detail('E2')).toContain('NONE')
})
test('style projection excludes CSS injection and unbounded font sizes', async () => {
  const { plugin } = await mount('PreviewCard', () => pending)
  const style = plugin.cellStyle({ backgroundColor: { red: 99 }, textFormat: { fontFamily: 'x; background:url(https://bad)', fontSize: 999999 }, position: 'fixed' })
  expect(style).toEqual({})
})
