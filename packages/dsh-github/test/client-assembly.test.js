import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const clientPath = new URL('../client.js', import.meta.url)

test('GitHub assembly registers one lazy factory with the loader contract and React external', async () => {
  const source = await readFile(clientPath, 'utf8')
  const registrations = []
  // At script evaluation there are no React, require, exports, module, or process globals.
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
  })
  assert.equal(registrations.length, 1)
  const [{ id, factory }] = registrations
  assert.equal(id, '@local/dsh-github')
  const requested = []
  const plugin = factory((name) => {
    requested.push(name)
    assert.equal(name, 'react', 'DSH supplies all client externals')
    return {}
  })
  assert.deepEqual([...new Set(requested)], ['react'])
  assert.deepEqual(Array.from(plugin.inject), ['slots'])
  assert.equal(typeof plugin.apply, 'function')
})
