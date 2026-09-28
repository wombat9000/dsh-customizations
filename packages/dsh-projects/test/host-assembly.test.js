import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { buildHost } from '../scripts/build-host.mjs'
import { checkHost } from '../../../scripts/build-host.mjs'

test('host strict typecheck and emitted modules remain reproducible and fresh', async () => {
  const first = buildHost()
  const second = buildHost()
  assert.deepEqual([...first.files], [...second.files])
  checkHost(first)
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const plugin = await import(new URL(`../${manifest.main}`, import.meta.url))
  assert.equal(plugin.CHANNEL, '/projects')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof plugin.apply, 'function')
})
