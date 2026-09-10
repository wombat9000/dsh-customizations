import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { apply, FIRECRAWL_CREDENTIAL_REF } from '../src/index.js'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const json = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'))

// Adapted from the source package's standalone Web boot smoke test. Repository
// wiring checks must not install profiles or start another DSH instance.
test('portable recipe installs the matching Firecrawl bundle after base and Web', async () => {
  const manifest = await json('../package.json')
  const recipe = await json('../../../profiles/personal-web/recipe.json')
  const index = recipe.bundles.findIndex((bundle) => bundle.name === manifest.name)
  for (const name of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) {
    const prerequisite = recipe.bundles.findIndex((bundle) => bundle.name === name)
    assert.ok(prerequisite >= 0, `Missing prerequisite bundle: ${name}`)
    assert.ok(index > prerequisite, `Firecrawl must follow ${name}`)
  }
  assert.equal(recipe.bundles[index].source, '../../packages/dsh-web-firecrawl')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-plugins'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes'))
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, '0.1.5-rc.1', name)
  }
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /- id: web\s+config:\s+searchProvider: firecrawl\s+fetchProvider: firecrawl/)
  assert.match(patch, /- id: tool-web\s+config:\s+search: true\s+fetch: true/)
  assert.match(patch, /- insert:\s+- id: local-web-firecrawl\s+name: '@local\/dsh-web-firecrawl'/)
  assert.doesNotMatch(patch, /apiKey|FIRECRAWL_API_KEY/)
  const result = spawnSync(process.execPath, ['scripts/apply-profile.mjs', '--', 'personal-web', '--dry-run'], {
    cwd: ROOT, encoding: 'utf8', timeout: 10000,
    // No credentials or user DSH paths are needed for a dry run.
    env: { PATH: process.env.PATH },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Applying @local\/dsh-web-firecrawl to profile personal-web/)
  assert.ok(result.stdout.includes(JSON.stringify(fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, ''))))
  assert.match(result.stdout, /Would run: .*"--dump-config"/)
  assert.match(result.stdout, /Dry run complete/)
})

function host(config = {}) {
  let key = 'fc-test-first'
  let provider
  let settings
  const refs = []
  const ctx = {
    inject(dependencies, install) {
      assert.deepEqual(dependencies, ['settings'])
      install({ settings: { installSection(owner, namespace, schema, initial) {
        settings = { owner, namespace, schema, initial }
      } } })
    },
    get(name) {
      assert.equal(name, 'credentials')
      return { async resolve(ref) { refs.push(ref); return key ? { value: key } : undefined } }
    },
    web: {
      registerSearchProvider(value) { provider = value },
      registerFetchProvider(value) { assert.equal(value, provider) },
    },
  }
  apply(ctx, config)
  return { ctx, provider, refs, settings, rotate(value) { key = value } }
}

test('host settings stay empty while the provider resolves rotated credential references', async () => {
  const instance = host()
  assert.equal(instance.settings.owner, instance.ctx)
  assert.equal(instance.settings.namespace, 'web-firecrawl')
  assert.deepEqual(instance.settings.initial, {})
  assert.deepEqual(instance.settings.schema.dict, {})
  assert.equal(await instance.provider.apiKey(undefined, 'search'), 'fc-test-first')
  instance.rotate('fc-test-rotated')
  assert.equal(await instance.provider.apiKey(undefined, 'scrape'), 'fc-test-rotated')
  instance.rotate(undefined)
  await assert.rejects(instance.provider.apiKey(undefined, 'search'), { code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  assert.deepEqual(instance.refs, Array(3).fill(FIRECRAWL_CREDENTIAL_REF))
  assert.deepEqual(instance.settings.initial, {})
})

test('legacy literal config overrides references without exposing it in settings', async () => {
  const instance = host({ apiKey: 'fc-test-literal' })
  assert.equal(await instance.provider.apiKey(undefined, 'search'), 'fc-test-literal')
  assert.deepEqual(instance.refs, [])
  assert.deepEqual(instance.settings.initial, {})
  assert.deepEqual(instance.settings.schema.dict, {})
})
