import test from 'node:test'
import { checkHost } from '../../../scripts/build-host.mjs'
import { buildHost } from '../scripts/build-host.mjs'
import { buildClient, clientPath } from '../scripts/build-client.mjs'
import { typecheck } from '../scripts/typecheck.mjs'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

test('strict type contracts and committed artifacts match their production sources', async () => {
  await typecheck()
  checkHost(buildHost())
  assert.equal(
    await readFile(clientPath, 'utf8'),
    await buildClient(),
    'regenerate the client after source edits',
  )
})
