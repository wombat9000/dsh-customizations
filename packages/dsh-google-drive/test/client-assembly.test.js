import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildClient, clientPath } from '../scripts/build-client.mjs'
import { typecheck } from '../scripts/typecheck-client.mjs'

test('Drive client strict contracts and generated lazy-loader remain reproducible and fresh', async () => {
  await typecheck()
  const first = await buildClient()
  assert.equal(first, await buildClient())
  assert.equal(await readFile(clientPath, 'utf8'), first)
})
