import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClientBundle } from '../../../tests/helpers/load-client-bundle.mjs'

test('generated client retains lazy package identity and native settings registration', () => {
  const { plugin, requested } = loadClientBundle(new URL('../client.js', import.meta.url), {
    expectedId: '@local/dsh-jev',
  })
  assert.deepEqual(requested, ['react'])
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'connection'])
  assert.equal(typeof plugin.SettingsCard, 'function')
  const rpc = {}
  let registration
  plugin.apply({
    get(name) {
      assert.equal(name, 'connection')
      return { rpc }
    },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'plugins.row.config')
        callback()
      },
      register(options, component) {
        registration = { options, component }
      },
    },
  })
  assert.equal(registration.options.name, 'plugins.row.config')
  assert.equal(registration.options.key, '@local/dsh-jev#local-jev')
  assert.equal(registration.options.inject().rpc, rpc)
  assert.equal(registration.component, plugin.SettingsCard)
})
