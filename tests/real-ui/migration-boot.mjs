// Browser-free smoke check using the exact visual-suite seed and host lifecycle.
// No user profile, provider configuration, prompt, or external request is used.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { startDisposableHost } from './global-setup.mjs'

const cleanup = await startDisposableHost({
  additionalPlugins: [
    { name: '@local/dsh-project-steward', directory: 'packages/dsh-project-steward' },
    { name: '@local/dsh-google-auth', directory: 'packages/dsh-google-auth' },
    { name: '@local/dsh-google-drive', directory: 'packages/dsh-google-drive' },
  ],
  profilePatch: resolve(import.meta.dirname, '../../profiles/personal-web/cordis.patch.yml'),
})
try {
  const url = new URL(process.env.DSH_TEST_URL)
  const { name, value } = JSON.parse(process.env.DSH_TEST_COOKIE)
  const cookie = `${name}=${value}`
  const page = await fetch(url, { headers: { cookie }, signal: AbortSignal.timeout(10000) })
  assert.equal(page.status, 200, 'authenticated shell')
  for (const [channel, method, payload] of [
    ['/session-recap', 'settings', {}],
    ['/local-worktrees', 'capability', { sessionId: 'nonexistent-synthetic-session' }],
  ]) {
    const response = await fetch(new URL(`${channel}/${method}`, url), {
      method: 'POST', headers: { cookie, origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'migration-check', method, payload }),
      signal: AbortSignal.timeout(10000),
    })
    assert.equal(response.status, 200, `${channel} HTTP status`)
    const result = await response.json()
    assert.equal(result.type, 'server-response')
    assert.equal(result.result?.ok, true, `${channel} success envelope`)
    if (channel === '/session-recap') assert.equal(result.result.value.autoRecap, true)
    if (channel === '/local-worktrees') assert.equal(result.result.value.state, 'unavailable')
  }
  console.log('PASS: five-plugin boot, seeded fixture, authentication, shell and read-only RPCs')
} finally {
  await cleanup()
}
