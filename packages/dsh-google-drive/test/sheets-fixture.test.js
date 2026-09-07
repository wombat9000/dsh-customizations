import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

// Keep browser approval evidence tied to the actual server-side compiler, not a
// separately maintained approximation of its value/format semantics.
test('browser preview fixture matches real client preparation without writes', async () => {
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./generate-sheets-preview.mjs', import.meta.url)), '--check'], { timeout: 10000, maxBuffer: 16384 })
})
