// Browser-free smoke check using the exact visual-suite seed and host lifecycle.
// No user profile, provider configuration, prompt, or external request is used.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { startDisposableHost } from './global-setup.mjs'

const cleanup = await startDisposableHost({
  additionalPlugins: [
    { name: '@local/dsh-file-intuition', directory: 'packages/dsh-file-intuition' },
    { name: '@local/dsh-project-steward', directory: 'packages/dsh-project-steward' },
    { name: '@local/dsh-google-auth', directory: 'packages/dsh-google-auth' },
    { name: '@local/dsh-google-drive', directory: 'packages/dsh-google-drive' },
    { name: '@local/dsh-product-mode', directory: 'packages/dsh-product-mode' },
    { name: '@local/dsh-web-firecrawl', directory: 'packages/dsh-web-firecrawl' },
    { name: '@local/dsh-linear', directory: 'packages/dsh-linear' },
    { name: '@local/dsh-tool-youtube', directory: 'packages/dsh-tool-youtube' },
    { name: '@local/dsh-tool-trivy', directory: 'packages/dsh-tool-trivy' },
    { name: '@local/dsh-tool-imagegen', directory: 'packages/dsh-tool-imagegen' },
  ],
  profilePatch: resolve(import.meta.dirname, '../../profiles/personal-web/cordis.patch.yml'),
})
try {
  const url = new URL(process.env.DSH_TEST_URL)
  const { name, value } = JSON.parse(process.env.DSH_TEST_COOKIE)
  const cookie = `${name}=${value}`
  const page = await fetch(url, { headers: { cookie }, signal: AbortSignal.timeout(10000) })
  assert.equal(page.status, 200, 'authenticated shell')
  const response = await fetch(new URL('/session-recap/settings', url), {
    method: 'POST',
    headers: { cookie, origin: url.origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'migration-check',
      method: 'settings',
      payload: {},
    }),
    signal: AbortSignal.timeout(10000),
  })
  assert.equal(response.status, 200, 'session-recap HTTP status')
  const result = await response.json()
  assert.equal(result.type, 'server-response')
  assert.equal(result.result?.ok, true, 'session-recap success envelope')
  assert.equal(result.result.value.autoRecap, true)
  console.log(
    'PASS: plugin boot, V4 persisted fixtures, authentication, shell and read-only Recap RPC',
  )
} finally {
  await cleanup()
}
