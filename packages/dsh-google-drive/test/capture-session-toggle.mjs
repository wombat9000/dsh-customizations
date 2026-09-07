// Synthetic toolbar with the actual component and pinned native DSH theme CSS.
// No running profile, Google account, external network, or baseline updates.
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const theme = await readFile(join(dirname(cli.resolve('@deepseek-ai/dsh-client-ui-theme/package.json')), 'lib/client.js'), 'utf8')
const sheets = [...theme.matchAll(/var \w+_css_default = ("(?:\\.|[^"\\])*");/g)]
assert.ok(sheets.length >= 3)
const css = sheets.map(match => JSON.parse(match[1])).join('\n')
const react = await readFile(join(dirname(require.resolve('react/package.json')), 'umd/react.production.min.js'), 'utf8')
const dom = await readFile(join(dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.production.min.js'), 'utf8')
const source = await readFile(join(root, 'client.js'), 'utf8')
await mkdir(join(root, 'docs/screenshots'), { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const variant of [{ name: 'dark', width: 980, theme: 'dark' }, { name: 'light', width: 980, theme: 'light' }, { name: 'narrow', width: 390, theme: 'dark' }]) {
    const context = await browser.newContext({ viewport: { width: variant.width, height: 320 }, deviceScaleFactor: 1, colorScheme: variant.theme })
    await context.route('**/*', route => route.abort())
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent(`<!doctype html><html style="color-scheme:${variant.theme}"><head><style>${css}
      body { margin:0; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:13px/1.5 var(--dsw-font-family,system-ui); }
      header { display:flex; flex-wrap:wrap; justify-content:space-between; gap:14px; padding:18px; border-bottom:1px solid var(--dsw-alias-border-l2); }
      nav { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      nav>button { background:transparent; color:var(--dsw-alias-label-secondary); border:0; font:inherit; padding:5px; }
      main { padding:24px; max-width:670px; } p { color:var(--dsw-alias-label-secondary); }
    </style></head><body ${variant.theme === 'dark' ? 'data-ds-dark-theme' : ''}><div id="app"></div></body></html>`)
    await page.addScriptTag({ content: react }); await page.addScriptTag({ content: dom })
    await page.evaluate(() => { window.__ModuleLoader__ = { load: value => { window.module = value } } })
    await page.addScriptTag({ content: source })
    await page.evaluate(() => {
      const h = React.createElement, plugin = window.module.factory(() => React)
      let enabled = false, revision = 0
      window.calls = []
      const api = async (method, body) => {
        window.calls.push({ method, body })
        if (method === 'session-set') { enabled = body.enabled; revision++ }
        return { available: true, enabled, revision, ownerId: 'synthetic-owner' }
      }
      ReactDOM.createRoot(document.getElementById('app')).render(h(React.Fragment, null,
        h('header', null, h('strong', null, 'Quarterly planning'), h('nav', { 'aria-label': 'Session utilities' }, h('button', null, 'Session log'), h('button', null, 'Recap'), h(plugin.SessionToggle, { sessionId: 'synthetic-session', api }))),
        h('main', null, h('strong', null, 'Google Drive is optional for each session'), h('p', null, 'Enable Drive and Sheets tools without granting file access. Select files separately when requested.'), h('p', null, 'Turning OFF revokes session grants and cancels requests and previews. It cannot undo dispatched writes.'))))
    })
    const toggle = page.getByRole('switch', { name: 'Google Drive' })
    await toggle.waitFor()
    await page.waitForFunction(() => !document.querySelector('[role=switch]').disabled)
    assert.equal(await toggle.getAttribute('aria-checked'), 'false')
    await page.screenshot({ path: join(root, `docs/screenshots/session-toggle-${variant.name}.png`) })
    await toggle.click()
    await page.waitForFunction(() => document.querySelector('[role=switch]').getAttribute('aria-checked') === 'true')
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'session-set').length), 1)
    if (variant.name === 'dark') await page.screenshot({ path: join(root, 'docs/screenshots/session-toggle-enabled-dark.png') })
    assert.deepEqual(errors, [])
    await context.close()
  }
} finally { await browser.close() }
console.log('Captured four synthetic session toggle screenshots; actual component, native theme, no external requests.')
