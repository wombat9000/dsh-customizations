import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'
import { registerTrivyStatusRpc } from '../src/status.js'

const PACKAGE_ROOT = new URL('../', import.meta.url)
const RECIPE = new URL('../../profiles/personal-web/recipe.json', PACKAGE_ROOT)

// Portable bundle wiring and dormant RPC checks, not a live Loader/HTTP test.
// No package install, CLI execution, process launch, or database download occurs.
test('Trivy bundle ships its client, skill, and controlled scanner inputs', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', PACKAGE_ROOT), 'utf8'))
  assert.equal(manifest.name, '@local/dsh-tool-trivy')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.files.includes('assets'))
  assert.ok(manifest.files.includes('src/**/*.js'))
  for (const path of [...Object.values(manifest.exports), 'assets/trivy-audit.md', 'assets/trivy-empty.yaml', 'assets/trivy-empty.ignore']) {
    assert.ok((await stat(new URL(path, PACKAGE_ROOT))).isFile())
  }
  const patch = await readFile(new URL(manifest.dsh.bundle.patch, PACKAGE_ROOT), 'utf8')
  assert.match(patch, /id: local-tool-trivy\s+name: '@local\/dsh-tool-trivy'/)
  assert.doesNotMatch(patch, /agentPresets|isolate:/)
})

test('personal-web selects the portable Trivy source', async () => {
  const recipe = JSON.parse(await readFile(RECIPE, 'utf8'))
  const bundle = recipe.bundles.find((entry) => entry.name === '@local/dsh-tool-trivy')
  assert.equal(bundle?.source, '../../packages/dsh-tool-trivy')
  assert.equal(new URL(`${bundle.source}/`, RECIPE).href, PACKAGE_ROOT.href)
})

test('Trivy status RPC strips executable paths and owns its lifecycle', async () => {
  const calls = []
  const runtime = { async check(options) {
    calls.push(options)
    return { state: 'ready', version: '0.69.2', path: '/private/example/trivy' }
  } }
  let handler
  let dispose
  let removed = false
  const connection = { rpc: {
    handle(channel, callback, options) {
      assert.equal(channel, '/trivy-status')
      assert.equal(options.authority, 'trusted-host')
      handler = callback
      return () => { removed = true }
    },
  } }
  registerTrivyStatusRpc({
    get(name) { assert.equal(name, 'connection'); return connection },
    effect(setup) { dispose = setup() },
  }, runtime)
  const signal = new AbortController().signal
  assert.deepEqual(await handler('get', {}, signal), { ok: true, value: { state: 'ready', version: '0.69.2' } })
  await handler('recheck', {}, signal)
  assert.deepEqual(calls, [{ force: false, signal }, { force: true, signal }])
  assert.equal((await handler('scan', {}, signal)).ok, false)
  assert.equal(calls.length, 2)
  dispose()
  assert.equal(removed, true)
})
