import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { checkHost } from '../../../scripts/build-host.mjs'
import { buildHost } from '../scripts/build-host.mjs'
import { buildClient, clientPath } from '../scripts/build-client.mjs'
import { typecheck } from '../scripts/typecheck.mjs'

test('strict source contracts and committed host/client artifacts are current', async () => {
  await typecheck()
  checkHost(buildHost())
  assert.equal(await readFile(clientPath, 'utf8'), await buildClient())
})
