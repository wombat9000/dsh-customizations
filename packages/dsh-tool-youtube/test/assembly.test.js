import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildHost } from '../scripts/build-host.mjs'
import { checkHost } from '../../../scripts/build-host.mjs'
import { buildClient } from '../scripts/build-client.mjs'
import { typecheck } from '../scripts/typecheck.mjs'

test('YouTube host and client pass strict type checking', async () => {
  await typecheck()
})

test('YouTube generated host modules are reproducible and fresh', async () => {
  const first = buildHost()
  const second = buildHost()
  assert.deepEqual([...first.files], [...second.files])
  checkHost(first)
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.main, 'dist/src/index.js')
  const host = await import(new URL(`../${manifest.main}`, import.meta.url))
  const archive = await import(
    new URL(`../${manifest.exports['./transcript-store']}`, import.meta.url)
  )
  assert.equal(typeof host.apply, 'function')
  assert.equal(typeof archive.YoutubeTranscriptArchive, 'function')
})

test('YouTube generated client is reproducible and fresh', async () => {
  const first = await buildClient()
  assert.equal(first, await buildClient())
  assert.equal(await readFile(new URL('../client.js', import.meta.url), 'utf8'), first)
})
