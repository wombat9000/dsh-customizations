import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadClientBundle } from '../../../tests/helpers/load-client-bundle.mjs'

const CLIENT_URL = new URL('../client.js', import.meta.url)

function loadClient(react = React) {
  const { record, plugin, requested } = loadClientBundle(CLIENT_URL, {
    react,
    expectedId: '@local/dsh-web-firecrawl',
  })
  assert.deepEqual(requested, ['react'])
  return { record, exports: plugin }
}

test('client registers an open Firecrawl configuration page, not an additional tab', () => {
  const { record, exports } = loadClient()
  assert.equal(record.id, '@local/dsh-web-firecrawl')
  assert.deepEqual(Array.from(exports.inject), ['slots', 'remote', 'remote.credentials'])

  let registration
  const remote = {
    credentials: {
      describe() {
        throw new Error('SSR must not dispatch credential requests')
      },
    },
    $on: () => () => {},
  }
  exports.apply({
    remote,
    on: () => () => {},
    // Deliberately no connection or get(): the remote is the credentials API.
    slots: {
      inject(name, callback) {
        assert.equal(name, 'plugins.row.config')
        return callback()
      },
      register(options, component) {
        registration = { options, component }
        return () => {}
      },
    },
  })

  assert.equal(registration.options.name, 'plugins.row.config')
  assert.equal(registration.options.key, '@local/dsh-web-firecrawl#local-web-firecrawl')
  assert.equal(registration.options.order, 20)
  assert.equal(Object.hasOwn(registration.options, 'id'), false)
  assert.equal(Object.hasOwn(registration.options, 'label'), false)
  const injected = registration.options.inject()
  assert.equal(injected.api, remote)
  assert.equal(typeof injected.subscribe, 'function')

  const summary = renderToStaticMarkup(
    React.createElement(registration.component, { ...injected, view: 'summary' }),
  )
  assert.match(summary, /Configure Firecrawl/)
  assert.doesNotMatch(summary, /<(?:details|input|button|style)\b/u)

  const pageHtml = renderToStaticMarkup(
    React.createElement(registration.component, { ...injected, view: 'page' }),
  )
  assert.match(pageHtml, /<details[^>]+open=""/u)
  assert.match(pageHtml, /<summary>Firecrawl/u)
  assert.match(pageHtml, /<style>[^<]*\.dsh-settings-panel/u)
  assert.doesNotMatch(pageHtml, /<h2\b/u)
})

test('client-side key validation rejects blank and shell-style pastes', () => {
  const { exports } = loadClient()
  assert.equal(exports.apiKeyFailure('fc-valid-key'), undefined)
  assert.match(exports.apiKeyFailure('   '), /Enter a Firecrawl API key/)
  assert.match(exports.apiKeyFailure('FIRECRAWL_API_KEY=fc-key'), /Paste only the API key/)
  assert.match(exports.apiKeyFailure('"fc-key"'), /Paste only the API key/)
  assert.match(exports.apiKeyFailure("'fc-key'"), /Paste only the API key/)
  assert.match(exports.apiKeyFailure('fc-\nkey'), /printable characters only/)
})
