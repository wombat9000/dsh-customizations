// Manual, reproducible PR screenshots. Uses the actual client component with
// synthetic Drive data, not a running DSH profile or a visual-baseline update.
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const require = createRequire(import.meta.url)
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const output = resolve(packageRoot, 'docs/screenshots')
const source = await readFile(join(packageRoot, 'client.js'), 'utf8')
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const themeSource = await readFile(join(dirname(cli.resolve('@deepseek-ai/dsh-client-ui-theme/package.json')), 'lib/client.js'), 'utf8')
// Use the pinned DSH bundle's static CSS strings without executing its runtime.
const themeSheets = [...themeSource.matchAll(/var \w+_css_default = ("(?:\\.|[^"\\])*");/g)]
assert.ok(themeSheets.length >= 3, 'pinned DSH theme CSS is available')
const themeCSS = themeSheets.map(match => JSON.parse(match[1])).join('\n')
const react = await readFile(join(dirname(require.resolve('react/package.json')), 'umd/react.production.min.js'), 'utf8')
const reactDOM = await readFile(join(dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.production.min.js'), 'utf8')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const variant of [
    { name: 'picker-dark', theme: 'dark', width: 1200, height: 900 },
    { name: 'picker-light', theme: 'light', width: 1200, height: 900 },
    { name: 'picker-mobile', theme: 'dark', width: 390, height: 844 },
    { name: 'picker-landscape', theme: 'dark', width: 844, height: 390 },
  ]) {
    const context = await browser.newContext({ viewport: { width: variant.width, height: variant.height }, deviceScaleFactor: 1, colorScheme: variant.theme })
    await context.route('**/*', route => route.abort())
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const dark = variant.theme === 'dark'
    await page.setContent(`<!doctype html><html style="color-scheme:${variant.theme}"><head><meta charset="utf-8"><style>
      ${themeCSS}
      body { margin:0; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font-family:var(--dsw-font-family); }
    </style></head><body ${dark ? 'data-ds-dark-theme' : ''}><div id="app"></div></body></html>`)
    await page.addScriptTag({ content: react })
    await page.addScriptTag({ content: reactDOM })
    await page.evaluate(() => { window.__ModuleLoader__ = { load: module => { window.pickerModule = module } } })
    await page.addScriptTag({ content: source })
    await page.evaluate(() => {
      const plugin = window.pickerModule.factory(() => window.React)
      const FOLDER = 'application/vnd.google-apps.folder'
      const files = [
        { id: 'design', name: 'Product design', mimeType: FOLDER },
        { id: 'engineering', name: 'Engineering', mimeType: FOLDER },
        { id: 'research', name: 'Research & insights', mimeType: FOLDER },
        { id: 'launch', name: 'Launch brief', mimeType: 'application/vnd.google-apps.document' },
        { id: 'roadmap', name: 'Q3 roadmap', mimeType: 'application/vnd.google-apps.spreadsheet' },
        { id: 'notes', name: 'API notes.md', mimeType: 'text/markdown' },
        { id: 'brand', name: 'Brand guidelines.pdf', mimeType: 'application/pdf' },
        { id: 'retro', name: 'Team retrospective', mimeType: 'application/vnd.google-apps.document' },
        { id: 'budget', name: 'Budget forecast.csv', mimeType: 'text/csv' },
        { id: 'onboarding', name: 'Onboarding checklist', mimeType: 'application/vnd.google-apps.document' },
      ]
      window.captureCalls = []
      const entry = {
        sessionId: 'synthetic-session', callId: 'synthetic-call',
        status: { state: 'pending', requestId: 'synthetic-request', grants: [] },
        request: async (method, body) => {
          window.captureCalls.push({ method, body })
          if (method !== 'browse') throw new Error('Screenshot fixture permits browsing only.')
          return { files: body.view === 'shared-with-me' ? [
            { id: 'shared-folder', name: 'Partner collaboration', mimeType: FOLDER },
            { id: 'shared-sheet', name: 'Shared planning', mimeType: 'application/vnd.google-apps.spreadsheet' },
            { id: 'shared-brief', name: 'Project brief', mimeType: 'application/vnd.google-apps.document' },
          ] : files }
        }, onChanged() {},
      }
      window.ReactDOM.createRoot(document.getElementById('app')).render(
        window.React.createElement(plugin.Picker, { entry, close() {} }),
      )
    })
    await page.getByRole('checkbox', { name: 'Engineering', exact: true }).waitFor({ state: 'visible' })
    if (variant.name === 'picker-dark') {
      await page.screenshot({ path: join(output, 'picker-empty.png'), animations: 'disabled' })
    }
    await page.getByRole('checkbox', { name: 'Engineering', exact: true }).check()
    await page.getByRole('checkbox', { name: 'Launch brief', exact: true }).check()
    await page.getByRole('button', { name: 'Allow read access', exact: true }).waitFor({ state: 'visible' })
    assert.equal(await page.evaluate(() => window.captureCalls[0].body.view), 'my-drive')
    assert.equal(await page.evaluate(() => window.captureCalls[0].body.parentId), undefined)
    const layout = await page.getByRole('dialog').evaluate(dialog => ({
      width: dialog.getBoundingClientRect().width,
      scrollWidth: dialog.scrollWidth,
      clientWidth: dialog.clientWidth,
    }))
    assert.ok(layout.width <= variant.width, 'dialog fits viewport')
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1, 'no horizontal overflow')
    const footer = await page.getByRole('button', { name: 'Allow read access', exact: true }).boundingBox()
    assert.ok(footer.y >= 0 && footer.y + footer.height <= variant.height, 'confirmation stays within viewport')
    const colors = await page.getByRole('button', { name: 'Allow read access', exact: true }).evaluate(button => {
      const style = getComputedStyle(button)
      return { foreground: style.color, background: style.backgroundColor }
    })
    const luminance = color => {
      const rgb = color.match(/[\d.]+/g).slice(0, 3).map(value => {
        const channel = Number(value) / 255
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
    }
    const a = luminance(colors.foreground), b = luminance(colors.background)
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, 'primary button text contrast is at least 4.5:1')
    const scrollRegion = page.locator(variant.height <= 560 ? '.gd-main' : '.gd-browser')
    await scrollRegion.evaluate(node => { node.scrollTop = node.scrollHeight })
    const afterScroll = await page.getByRole('button', { name: 'Allow read access', exact: true }).boundingBox()
    assert.equal(afterScroll.y, footer.y, 'footer does not move when files scroll')
    await scrollRegion.evaluate(node => { node.scrollTop = 0 })
    await page.screenshot({ path: join(output, `${variant.name}.png`), animations: 'disabled' })
    if (variant.name === 'picker-dark') {
      await page.getByRole('button', { name: 'Review selection (2)', exact: true }).click()
      await page.getByRole('list', { name: 'Selected access' }).waitFor({ state: 'visible' })
      await page.screenshot({ path: join(output, 'picker-selection.png'), animations: 'disabled' })
    }
    if (variant.name === 'picker-landscape') {
      await page.getByRole('button', { name: 'Review selection (2)', exact: true }).click()
      await page.getByRole('list', { name: 'Selected access' }).waitFor({ state: 'visible' })
      const expandedFooter = await page.getByRole('button', { name: 'Allow read access', exact: true }).boundingBox()
      assert.equal(expandedFooter.y, footer.y, 'landscape review cannot push confirmation offscreen')
      await scrollRegion.evaluate(node => { node.scrollTop = node.scrollHeight })
      await page.screenshot({ path: join(output, 'picker-landscape.png'), animations: 'disabled' })
    }
    await page.getByRole('tab', { name: 'Shared with me' }).click()
    await page.getByRole('checkbox', { name: 'Shared planning', exact: true }).check()
    await page.getByRole('button', { name: 'Review selection (3)', exact: true }).waitFor({ state: 'visible' })
    assert.equal(await page.evaluate(() => window.captureCalls.at(-1).body.view), 'shared-with-me')
    assert.equal(await page.getByRole('navigation', { name: 'Drive folders' }).count(), 0)
    await page.screenshot({ path: join(output, `${variant.name}-shared.png`), animations: 'disabled' })
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`Captured ${variant.name}; viewport and overflow checks passed.`)
  }
} finally {
  await browser.close()
}
