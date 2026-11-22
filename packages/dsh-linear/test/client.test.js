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
    expectedId: '@local/dsh-linear',
  })
  assert.deepEqual(requested, ['react'])
  return { record, exports: plugin }
}

test('package exposes a Web Settings client bundle', async () => {
  const pkg = JSON.parse(await readFile(PACKAGE_PATH, 'utf8'))
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.files.includes('client.js'))
})

test('client registers only a Linear plugin configuration card', () => {
  const { record, exports } = loadClient()
  assert.equal(record.id, '@local/dsh-linear')
  assert.deepEqual(Array.from(exports.inject), ['slots', 'connection', 'remote'])
  const registrations = []
  const rpc = {
    call() {
      throw new Error('SSR must not dispatch RPC')
    },
  }
  const ctx = {
    remote: { $on: () => () => {} },
    get(name) {
      assert.equal(name, 'connection')
      return { rpc }
    },
    on: () => () => {},
    slots: {
      inject(name, callback) {
        assert.equal(name, 'plugins.row.config')
        callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  exports.apply(ctx)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'plugins.row.config')
  assert.equal(registrations[0].options.key, '@local/dsh-linear#local-linear')
  assert.equal(registrations[0].options.id, undefined)
  assert.equal(registrations[0].options.order, 35)
  const injected = registrations[0].options.inject()
  assert.equal(injected.rpc, rpc)

  const summary = renderToStaticMarkup(
    React.createElement(registrations[0].component, { ...injected, view: 'summary' }),
  )
  assert.match(summary, /Workspace connection/)
  assert.doesNotMatch(summary, /<(?:details|input|button|style)\b/u)

  const pageHtml = renderToStaticMarkup(
    React.createElement(registrations[0].component, { ...injected, view: 'page' }),
  )
  assert.match(pageHtml, /<details[^>]+open=""/u)
  assert.match(pageHtml, /<summary>Linear/u)
  assert.match(pageHtml, /<style>[^<]*\.dsh-settings-panel/u)
  assert.match(pageHtml, /type="password"/u)
})

test('client-side key validation rejects blank and shell-style pastes', () => {
  const { exports } = loadClient()
  assert.equal(exports.apiKeyFailure('lin_api_valid'), undefined)
  assert.match(exports.apiKeyFailure(' '), /Enter a Linear API key/)
  assert.match(exports.apiKeyFailure('LINEAR_API_KEY=secret'), /Paste only the API key/)
  assert.match(exports.apiKeyFailure('"secret"'), /Paste only the API key/)
})
