import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadClientBundle } from '../../../tests/helpers/load-client-bundle.mjs'

const CLIENT_URL = new URL('../client.js', import.meta.url)
const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url))

function loadClient(react = React) {
  const { record, plugin, requested } = loadClientBundle(CLIENT_URL, {
    react,
    expectedId: '@local/dsh-tool-trivy',
  })
  assert.deepEqual(requested, ['react'])
  return { record, exports: plugin }
}

test('package exposes the Trivy Web Settings client', async () => {
  const pkg = JSON.parse(await readFile(PACKAGE_PATH, 'utf8'))
  assert.equal(pkg.exports['./client'], './client.js')
  assert.ok(pkg.files.includes('client.js'))
  assert.ok(pkg.files.includes('assets'))
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-settings'])
})

test('client registers the Trivy settings section and renders SSR shell', () => {
  const { record, exports } = loadClient()
  assert.equal(record.id, '@local/dsh-tool-trivy')
  assert.deepEqual(Array.from(exports.inject), ['slots', 'connection'])
  const registrations = []
  const rpc = {
    call() {
      throw new Error('SSR must not dispatch RPC')
    },
  }
  const context = {
    get(name) {
      assert.equal(name, 'connection')
      return { rpc }
    },
    on: () => () => {},
    slots: {
      inject(name, callback) {
        assert.equal(name, 'settings.section')
        callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  exports.apply(context)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.id, 'trivy')
  assert.equal(registrations[0].options.order, 40)
  assert.equal(registrations[0].options.label, 'Trivy')
  const injected = registrations[0].options.inject()
  assert.equal(injected.rpc, rpc)
  assert.equal(registrations[0].component, exports.TrivySettingsSection)

  const html = renderToStaticMarkup(React.createElement(registrations[0].component, injected))
  assert.match(html, /<section class="dsh-settings-panel dsh-settings-panel--section"/u)
  assert.match(html, /<style>[^<]*\.dsh-settings-panel/u)
  assert.ok(html.includes(exports.INSTALL_URL))
  assert.doesNotMatch(html, /<input\b/u)
  assert.match(html, /Recheck/u)
})

test('presentation maps Trivy states and failures to labels and tones', () => {
  const { exports } = loadClient()
  assert.equal(exports.presentation(undefined, 'boom').label, 'Unavailable')
  assert.equal(exports.presentation(undefined, undefined).label, 'Checking…')
  assert.equal(exports.presentation({ state: 'ready' }, undefined).label, 'Ready')
  assert.equal(exports.presentation({ state: 'not-found' }, undefined).label, 'Not found')
  assert.equal(
    exports.presentation({ state: 'unsupported-version' }, undefined).label,
    'Unsupported version',
  )
  assert.equal(
    exports.presentation({ state: 'execution-failed' }, undefined).label,
    'Execution failed',
  )
})
