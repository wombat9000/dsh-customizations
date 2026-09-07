// Actual client components and pinned DSH theme, synthetic data only; no Google calls.
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { chromium } from '@playwright/test'
const require = createRequire(import.meta.url)
const root = new URL('../', import.meta.url)
const source = await readFile(new URL('client.js', root), 'utf8')
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const theme = await readFile(join(dirname(cli.resolve('@deepseek-ai/dsh-client-ui-theme/package.json')), 'lib/client.js'), 'utf8')
const sheets = [...theme.matchAll(/var \w+_css_default = ("(?:\\.|[^"\\])*");/g)]
assert.ok(sheets.length >= 3)
const css = sheets.map(m => JSON.parse(m[1])).join('\n')
const react = await readFile(join(dirname(require.resolve('react/package.json')), 'umd/react.production.min.js'), 'utf8')
const reactDOM = await readFile(join(dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.production.min.js'), 'utf8')
const output = new URL('docs/screenshots/', root)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const [name, themeName, width, height] of [['dark', 'dark', 1200, 1000], ['light', 'light', 1200, 1000], ['narrow', 'dark', 390, 844], ['landscape', 'dark', 844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: themeName })
    await context.route('**/*', route => route.abort())
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent(`<html><head><style>${css}body{margin:0;background:var(--dsw-alias-bg-layer-2);font-family:system-ui}</style></head><body ${themeName === 'dark' ? 'data-ds-dark-theme' : ''}><div id="app"></div></body></html>`)
    await page.addScriptTag({ content: react }); await page.addScriptTag({ content: reactDOM })
    await page.evaluate(() => { window.__ModuleLoader__ = { load: module => { window.module = module } } })
    await page.addScriptTag({ content: source })
    await page.evaluate(() => {
      const plugin = window.module.factory(() => window.React), h = window.React.createElement
      window.root = window.ReactDOM.createRoot(document.getElementById('app'))
      const tab = { sheetId: 0, title: 'Budget', rowCount: 100, columnCount: 4 }
      const header = { backgroundColor: { red: 0.12, green: 0.28, blue: 0.24 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } }
      const before = { fileId: 'synthetic-budget', range: 'Budget!A1:C3', tab, cells: [
        { cell: 'A1', userEnteredValue: { stringValue: 'Category' } }, { cell: 'B1', userEnteredValue: { stringValue: 'Planned' } }, { cell: 'C1', userEnteredValue: { stringValue: 'Actual' } },
        { cell: 'A2', userEnteredValue: { stringValue: 'Hosting' } }, { cell: 'B2', userEnteredValue: { numberValue: 120 } }, { cell: 'C2', userEnteredValue: { numberValue: 145 } },
        { cell: 'A3', userEnteredValue: { stringValue: 'Draft note' } }, { cell: 'B3', userEnteredValue: { numberValue: 200 } }, { cell: 'C3', userEnteredValue: { formulaValue: '=SUM(C2)' } },
      ] }
      const after = { ...before, cells: before.cells.map((c, i) => i < 3 ? { ...c, userEnteredFormat: header } : i === 6 ? { cell: c.cell } : i === 5 ? { ...c, userEnteredFormat: { backgroundColor: { red: 1, green: .88, blue: .8 }, numberFormat: { type: 'CURRENCY', pattern: '€#,##0.00' } } } : i === 8 ? { cell: c.cell, userEnteredValue: { formulaValue: '=SUM(C2:C2)*1.2' } } : c) }
      const status = { state: 'pending', requestId: 'synthetic-proposal', preview: { fileName: 'Annual operating budget', fileId: before.fileId, range: before.range, tab, before, after } }
      window.root.render(h(plugin.PreviewDialog, { status, busy: false, error: '', act() { throw new Error('Screenshots cannot write') }, close() {} }))
      window.showPicker = () => window.root.render(h(plugin.Picker, { entry: {
        sessionId: 'synthetic-session', callId: 'synthetic-call', mode: 'edit', status: { state: 'pending', mode: 'edit', requestId: 'synthetic', grants: [] },
        request: async (method, body) => { assertMethod(method); return { files: body.view === 'shared-with-me' ? [{ id: 'shared-budget', name: 'Partner budget', mimeType: 'application/vnd.google-apps.spreadsheet' }] : [{ id: 'folder', name: 'Finance', mimeType: 'application/vnd.google-apps.folder' }, { id: 'budget', name: 'Annual budget', mimeType: 'application/vnd.google-apps.spreadsheet' }, { id: 'forecast', name: 'Revenue forecast', mimeType: 'application/vnd.google-apps.spreadsheet' }] } }, onChanged() {},
      }, close() {} }))
      function assertMethod(method) { if (method !== 'edit-browse') throw new Error('Screenshot fixture permits browsing only') }
    })
    await page.getByRole('button', { name: 'Apply changes', exact: true }).waitFor()
    const layout = await page.getByRole('dialog').evaluate(d => ({ width: d.clientWidth, scroll: d.scrollWidth }))
    assert.ok(layout.scroll <= layout.width + 1)
    const footer = await page.getByRole('button', { name: 'Apply changes', exact: true }).boundingBox()
    assert.ok(footer.y + footer.height <= height)
    await page.screenshot({ path: new URL(`sheets-preview-${name}.png`, output).pathname })
    await page.locator('.gs-body').evaluate(e => { e.scrollTop = e.scrollHeight })
    await page.screenshot({ path: new URL(`sheets-details-${name}.png`, output).pathname })
    await page.evaluate(() => window.showPicker())
    await page.getByRole('checkbox', { name: 'Annual budget' }).check()
    await page.screenshot({ path: new URL(`sheets-picker-${name}.png`, output).pathname })
    await page.getByRole('tab', { name: 'Shared with me' }).click()
    await page.getByRole('checkbox', { name: 'Partner budget' }).check()
    await page.getByRole('button', { name: 'Review selection (2)' }).waitFor()
    await page.screenshot({ path: new URL(`sheets-picker-shared-${name}.png`, output).pathname })
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`Captured Sheets ${name}: preview, exact details, edit picker.`)
  }
} finally { await browser.close() }
