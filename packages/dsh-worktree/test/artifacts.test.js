import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { checkHost } from '../../../scripts/build-host.mjs'
import { buildHost } from '../scripts/build-host.mjs'
import { buildClient, clientPath } from '../scripts/build-client.mjs'
import { typecheck } from '../scripts/typecheck.mjs'

test('strict host contracts and committed ESM artifact set stay fresh', () => {
  checkHost(buildHost())
})

test('strict client contracts and committed lazy browser bundle stay fresh', async () => {
  await typecheck()
  assert.equal(await readFile(clientPath, 'utf8'), await buildClient())
})
