import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const text = (path) => readFile(new URL(path, root), 'utf8')

test('Drive publishes host/client and compatibility tools but no agent preset', async () => {
  const manifest = JSON.parse(await text('package.json'))
  assert.equal(manifest.exports['.'], './src/index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.exports['./tools'], './src/tools.js')
  assert.equal(manifest.files.includes('presets'), false)
  for (const path of ['agent.cordis.yml', 'preset.yml', 'LICENSE.standard']) {
    await assert.rejects(access(new URL(`presets/google-drive/${path}`, root)), { code: 'ENOENT' })
  }
  const patch = await text('cordis.patch.yml')
  assert.match(patch, /id: local-google-drive/)
  assert.match(patch, /name: '@local\/dsh-google-drive'/)
  assert.doesNotMatch(patch, /id: agent-presets|roots:|default:/)
})

test('personal-web retains Standard default without a Drive preset or directory roster', async () => {
  const patch = await text('../../profiles/personal-web/cordis.patch.yml')
  assert.match(patch, /id: agent-preset-registry/)
  assert.match(patch, /default: standard/)
  assert.doesNotMatch(patch, /roots:|trust: system|google-drive/)
  const recipe = JSON.parse(await text('../../profiles/personal-web/recipe.json'))
  for (const name of [
    '@local/dsh-worktree',
    '@local/dsh-project-steward',
    '@local/dsh-product-mode',
  ]) {
    assert.equal(recipe.bundles.filter((bundle) => bundle.name === name).length, 1)
  }
})
