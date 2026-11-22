import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('emitted host modules expose the installable Session Recap plugin', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const plugin = await import(new URL(`../${manifest.main}`, import.meta.url))
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(plugin.CHANNEL, '/session-recap')
  assert.deepEqual(plugin.inject, ['sessions', 'llm', 'connection', 'webServer'])
})
