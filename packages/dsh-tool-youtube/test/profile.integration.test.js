import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'
import { createTranscriptProgressStore, registerTranscriptProgressRpc } from '../src/progress.js'

const PACKAGE_ROOT = new URL('../', import.meta.url)
const RECIPE = new URL('../../profiles/personal-web/recipe.json', PACKAGE_ROOT)

// Portable bundle wiring and dormant RPC checks, not a live Loader/HTTP test.
// Do not install packages, inherit credentials, start DSH, or contact Gemini.
test('YouTube bundle ships its archive provider without a workspace dependency', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', PACKAGE_ROOT), 'utf8'))
  assert.equal(manifest.name, '@local/dsh-tool-youtube')
  assert.equal(manifest.exports['./transcript-store'], './src/transcript-store.js')
  assert.equal(manifest.dependencies['@google/genai'], '2.21.0')
  assert.equal(manifest.dependencies['@local/dsh-youtube-transcript-store'], undefined)
  assert.ok(manifest.files.includes('src/**/*.js'))
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const path of Object.values(manifest.exports)) {
    assert.ok((await stat(new URL(path, PACKAGE_ROOT))).isFile())
  }
  const patch = await readFile(new URL(manifest.dsh.bundle.patch, PACKAGE_ROOT), 'utf8')
  assert.match(patch, /id: local-youtube-transcript-store\s+name: '@local\/dsh-tool-youtube\/transcript-store'/)
  assert.match(patch, /dshHomePath\('archives\/youtube-transcripts\.sqlite'\)/)
  assert.match(patch, /id: local-tool-youtube\s+name: '@local\/dsh-tool-youtube'/)
  assert.doesNotMatch(patch, /agentPresets|isolate:/)
})

test('personal-web selects the portable YouTube source', async () => {
  const recipe = JSON.parse(await readFile(RECIPE, 'utf8'))
  const bundle = recipe.bundles.find((entry) => entry.name === '@local/dsh-tool-youtube')
  assert.equal(bundle?.source, '../../packages/dsh-tool-youtube')
  assert.equal(new URL(`${bundle.source}/`, RECIPE).href, PACKAGE_ROOT.href)
})

test('transcript progress RPC remains read-only and lifecycle-owned', async () => {
  const store = createTranscriptProgressStore()
  let handler
  let dispose
  let removed = false
  const connection = { rpc: {
    handle(channel, callback, options) {
      assert.equal(channel, '/youtube-transcript-progress')
      assert.equal(options.authority, 'trusted-host')
      handler = callback
      return () => { removed = true }
    },
  } }
  registerTranscriptProgressRpc({
    get(name) { assert.equal(name, 'connection'); return connection },
    effect(setup) { dispose = setup() },
  }, store)
  assert.deepEqual(await handler('get', { callId: 'unknown-call' }), { ok: true, value: null })
  assert.equal((await handler('get', {})).ok, false)
  assert.equal((await handler('write', { callId: 'unknown-call' })).ok, false)
  dispose()
  assert.equal(removed, true)
})
