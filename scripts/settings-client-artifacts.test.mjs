import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Execute only the shipped artifact, with the same React-only module table as
// the browser loader. No repository/shared-source resolver exists in this VM.
for (const [directory, title, field] of [
  ['dsh-jev', 'Jev', 'Jev model ID'],
  ['dsh-openrouter', 'OpenRouter', 'OpenRouter API key'],
]) {
  test(`${title} standalone client inlines shared settings and uses only host React`, () => {
    const root = new URL(`../packages/${directory}/`, import.meta.url)
    const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
    const source = readFileSync(new URL(manifest.exports['./client'], root), 'utf8')
    let declaration
    vm.runInNewContext(source, {
      window: {
        __ModuleLoader__: {
          load: (value) => {
            declaration = value
          },
        },
      },
    })
    assert.equal(declaration.id, manifest.name)
    const imports = []
    const plugin = declaration.factory((name) => {
      imports.push(name)
      assert.equal(name, 'react', 'file snapshots must not require repository shared source')
      return React
    })
    assert.deepEqual(imports, ['react'])
    const rpc = {
      call: () => {
        throw new Error('Rendering must not dispatch RPC')
      },
    }
    const html = renderToStaticMarkup(
      React.createElement(plugin.SettingsCard, { rpc, view: 'page' }),
    )
    assert.match(html, /<details[^>]+open=""/u)
    assert.ok(html.includes(`aria-label="${title} settings"`))
    assert.ok(html.includes(field))
    assert.match(html, /<style>[^<]*\.dsh-settings-panel/u)
    assert.match(html, /<label for="([^"]+)">[^<]+<input[^>]+id="\1"/u)
    const summary = renderToStaticMarkup(
      React.createElement(plugin.SettingsCard, { rpc, view: 'summary' }),
    )
    assert.doesNotMatch(summary, /<(?:details|input|button|style)\b/u)
  })
}
