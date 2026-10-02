import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildHost } from '../scripts/build-host.mjs'
import { checkHost } from '../../../scripts/build-host.mjs'
import { buildClient, clientPath } from '../scripts/build-client.mjs'
import { typecheck } from '../scripts/typecheck.mjs'

test('public host and sandbox imports resolve to generated implementations', async () => {
  const host = await import('@local/dsh-google-auth')
  const sandbox = await import('@local/dsh-google-auth/sandbox')
  assert.equal(typeof host.GoogleAuthService, 'function')
  assert.equal(typeof sandbox.SandboxCallbackPublisher, 'function')
  assert.equal(
    import.meta.resolve('@local/dsh-google-auth'),
    new URL('../dist/src/index.js', import.meta.url).href,
  )
  assert.equal(
    import.meta.resolve('@local/dsh-google-auth/sandbox'),
    new URL('../dist/src/sandbox-publisher.js', import.meta.url).href,
  )
})

test('strict host contracts compile and all generated host modules are fresh', () => {
  checkHost(buildHost())
})
test('strict client contracts compile and the lazy-loader artifact is fresh', async () => {
  await typecheck()
  assert.equal(await readFile(clientPath, 'utf8'), await buildClient())
})
