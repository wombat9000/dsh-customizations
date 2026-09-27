import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

for (const [packageName, rowId] of [
  ['dsh-openrouter', 'local-openrouter'],
  ['dsh-jev', 'local-jev'],
  ['dsh-google-auth', 'local-google-auth'],
]) {
  test(`${packageName} registers its exact row and renders a side-effect-free summary`, async () => {
    const source = await readFile(
      new URL(`../../${packageName}/client.js`, import.meta.url),
      'utf8',
    )
    let record, registration
    vm.runInNewContext(source, {
      window: {
        __ModuleLoader__: {
          load(value) {
            record = value
          },
        },
      },
      URL,
    })
    const plugin = record.factory((name) => {
      assert.equal(name, 'react')
      return React
    })
    // Registration argument contract only; real-shell election remains a separate test.
    plugin.apply({
      slots: {
        inject(name, register) {
          assert.equal(name, 'plugins.row.config')
          register()
        },
        register(options, Component) {
          assert.equal(options.name, 'plugins.row.config')
          assert.equal(options.key, `@local/${packageName}#${rowId}`)
          registration = { options, Component }
        },
      },
    })
    assert.equal(record.id, `@local/${packageName}`)
    const summary = renderToStaticMarkup(
      React.createElement(registration.Component, { view: 'summary' }),
    )
    assert.match(summary, /^<p>/)
    assert.doesNotMatch(summary, /input|button|details|form/)
    const page = renderToStaticMarkup(
      React.createElement(registration.Component, {
        view: 'page',
        rpc: {},
        api() {},
      }),
    )
    assert.match(page, /<details[^>]*open=""/)
    assert.match(page, /<button/)
  })
}
