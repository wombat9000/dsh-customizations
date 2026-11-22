import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('YouTube generated host modules expose the plugin and transcript archive exports', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.main, 'dist/src/index.js')
  const host = await import(new URL(`../${manifest.main}`, import.meta.url))
  const archive = await import(
    new URL(`../${manifest.exports['./transcript-store']}`, import.meta.url)
  )
  assert.equal(typeof host.apply, 'function')
  assert.equal(typeof archive.YoutubeTranscriptArchive, 'function')
})
