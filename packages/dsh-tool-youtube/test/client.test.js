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
    expectedId: '@local/dsh-tool-youtube',
  })
  assert.deepEqual(requested, ['react'])
  return { record, exports: plugin }
}

test('package exposes the Web Settings client bundle', async () => {
  const pkg = JSON.parse(await readFile(PACKAGE_PATH, 'utf8'))
  assert.equal(pkg.exports['./client'], './client.js')
  assert.ok(pkg.files.includes('client.js'))
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-ui-plugin-manager',
    '@deepseek-ai/dsh-api-remotes',
  ])
})

test('client bundle registers the expected module, Settings section, and toolviews', () => {
  const { record, exports } = loadClient()
  assert.equal(record.id, '@local/dsh-tool-youtube')
  assert.deepEqual(Array.from(exports.inject), [
    'slots',
    'connection',
    'remote',
    'remote.credentials',
  ])
  assert.equal(exports.CREDENTIAL_REF, 'GEMINI_API_KEY')

  const registrations = []
  const rpc = { call: async () => ({ ok: true, value: null }) }
  const context = {
    remote: { $on: () => () => {} },
    get(service) {
      assert.equal(service, 'connection')
      return { rpc }
    },
    on: () => () => {},
    slots: {
      inject(name, callback) {
        assert.ok(['plugins.row.config', 'tool.call.toolview'].includes(name))
        callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }

  exports.apply(context)
  const settings = registrations.find((entry) => entry.options.name === 'plugins.row.config')
  assert.equal(settings.options.key, '@local/dsh-tool-youtube#local-tool-youtube')
  assert.equal(settings.options.order, 30)
  assert.equal(
    registrations.some((entry) => entry.options.name === 'settings.section'),
    false,
  )
  assert.equal(typeof settings.options.inject, 'function')
  assert.equal(settings.options.inject().api, context.remote)
  assert.equal(typeof settings.component, 'function')

  const summary = renderToStaticMarkup(
    React.createElement(settings.component, { ...settings.options.inject(), view: 'summary' }),
  )
  assert.match(summary, /Configure Gemini/)
  assert.doesNotMatch(summary, /<(?:details|input|button|style)\b/u)

  const pageHtml = renderToStaticMarkup(
    React.createElement(settings.component, { ...settings.options.inject(), view: 'page' }),
  )
  assert.match(pageHtml, /<details[^>]+open=""/u)
  assert.match(pageHtml, /<summary>YouTube/u)
  assert.match(pageHtml, /<style>[^<]*\.dsh-settings-panel/u)
  assert.match(pageHtml, /type="password"/u)

  const toolviews = registrations.filter((entry) => entry.options.name === 'tool.call.toolview')
  assert.deepEqual(
    toolviews.map((entry) => entry.options.key),
    ['youtube_watch', 'youtube_transcript', 'youtube_transcript_read', 'youtube_transcript_search'],
  )
  assert.ok(toolviews.every((entry) => entry.options.locale === 'conversation'))
  assert.ok(toolviews.every((entry) => entry.options.inject().rpc === rpc))
  assert.ok(toolviews.every((entry) => entry.component === exports.YoutubeToolCard))
})

test('Settings subscription filters credential events and disposes listeners', () => {
  const { exports } = loadClient()
  const handlers = {}
  const disposed = []
  const registrations = []
  const context = {
    remote: {
      $on(name, handler) {
        handlers[name] = handler
        return () => disposed.push(name)
      },
    },
    get: () => ({ api: { credentials: {} }, rpc: {} }),
    on(name, handler) {
      handlers[name] = handler
      return () => disposed.push(name)
    },
    slots: {
      inject: (_name, callback) => callback(),
      register(options) {
        registrations.push(options)
        return () => {}
      },
    },
  }
  exports.apply(context)
  const props = registrations.find((entry) => entry.name === 'plugins.row.config').inject()
  let refreshes = 0
  const dispose = props.subscribe(() => {
    refreshes += 1
  })

  handlers['credentials/reference-updated']('OTHER_KEY')
  assert.equal(refreshes, 0)
  handlers['credentials/reference-updated']('GEMINI_API_KEY')
  handlers['connection/reset']()
  assert.equal(refreshes, 2)
  dispose()
  assert.deepEqual(disposed.sort(), ['connection/reset', 'credentials/reference-updated'])
})

test('client-side key validation rejects blank and shell-style pastes', () => {
  const { exports } = loadClient()

  assert.equal(exports.apiKeyFailure('AIza-valid-key'), undefined)
  assert.match(exports.apiKeyFailure('   '), /Enter a Gemini API key/)
  assert.match(exports.apiKeyFailure('GEMINI_API_KEY=AIza-key'), /Paste only the API key/)
  assert.match(exports.apiKeyFailure('"AIza-key"'), /Paste only the API key/)
  assert.match(exports.apiKeyFailure('AIza-\nkey'), /printable characters only/)
})
