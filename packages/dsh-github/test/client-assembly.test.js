import assert from 'node:assert/strict'
import test from 'node:test'
import { loadClientBundle } from '../../../tests/helpers/load-client-bundle.mjs'

const clientPath = new URL('../client.js', import.meta.url)

test('GitHub assembly registers one lazy factory with the loader contract and React external', () => {
  const { plugin, requested } = loadClientBundle(clientPath, { expectedId: '@local/dsh-github' })
  assert.deepEqual([...new Set(requested)], ['react'])
  assert.deepEqual(Array.from(plugin.inject), ['slots'])
  assert.equal(typeof plugin.apply, 'function')
})
