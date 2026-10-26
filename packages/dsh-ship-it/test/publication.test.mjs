import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildClient, clientPath } from '../scripts/build-client.mjs'
import { typecheck } from '../scripts/typecheck.mjs'

test('strict client types and the published DSH loader bundle stay current', async () => {
  await typecheck()
  assert.equal(await readFile(clientPath, 'utf8'), await buildClient())
})
