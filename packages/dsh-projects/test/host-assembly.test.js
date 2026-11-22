import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('emitted host entrypoint exposes the Projects plugin contract', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const plugin = await import(new URL(`../${manifest.main}`, import.meta.url))
  assert.equal(plugin.CHANNEL, '/projects')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof plugin.apply, 'function')
})
