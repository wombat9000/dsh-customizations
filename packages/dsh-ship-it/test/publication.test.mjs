import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

test('built Ship It client registers one lazy factory with the session header slot', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const registrations = []
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
  })
  assert.equal(registrations.length, 1)
  const [{ id, factory }] = registrations
  assert.equal(id, '@local/dsh-ship-it')
  const requested = []
  const plugin = factory((name) => {
    requested.push(name)
    assert.equal(name, 'react')
    return {}
  })
  assert.deepEqual([...new Set(requested)], ['react'])
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'sessions', 'conversation'])
  assert.equal(typeof plugin.apply, 'function')
})
