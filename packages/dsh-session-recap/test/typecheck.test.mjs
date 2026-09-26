import test from 'node:test'
import { typecheck } from '../scripts/typecheck.mjs'

test('host, client, shared contracts and compile-time regressions pass strict TypeScript', async () => {
  await typecheck()
})
