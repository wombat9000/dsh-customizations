import assert from 'node:assert/strict'
import test from 'node:test'
import { loadClientBundle } from '../../../tests/helpers/load-client-bundle.mjs'

test('built Ship It client registers one lazy factory with the session header slot', () => {
  const { plugin, requested } = loadClientBundle(new URL('../client.js', import.meta.url), {
    expectedId: '@local/dsh-ship-it',
  })
  assert.deepEqual([...new Set(requested)], ['react'])
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'sessions', 'conversation'])
  assert.equal(typeof plugin.apply, 'function')
})
