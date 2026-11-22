import assert from 'node:assert/strict'
import test from 'node:test'

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
