import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHost } from '../scripts/build-host.mjs'
import { checkHost } from '../../../scripts/build-host.mjs'

test('Drive host strict contracts and generated artifacts are reproducible and fresh', () => {
  const first = buildHost()
  assert.deepEqual([...first.files], [...buildHost().files])
  checkHost(first)
})
