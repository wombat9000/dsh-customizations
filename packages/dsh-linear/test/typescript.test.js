import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildHost } from '../scripts/build-host.mjs'
import { checkHost } from '../../../scripts/build-host.mjs'
import { buildClient } from '../scripts/build-client.mjs'
import { typecheck } from '../scripts/typecheck.mjs'

test('strict host/public read/RPC/client contracts and generated artifacts are current', async () => {
  await typecheck()
  checkHost(buildHost())
  assert.equal(
    readFileSync(new URL('../client.js', import.meta.url), 'utf8'),
    await buildClient(),
    'Regenerate Linear client.js from its maintained client modules',
  )
})
