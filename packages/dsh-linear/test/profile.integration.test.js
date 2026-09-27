import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createRequire } from 'node:module'
import { apply, Config } from '../src/index.js'
import { installLinearSettings } from '../src/settings.js'

// Use the same real reference writer as Loader, resolved through Schemastery.
const require = createRequire(import.meta.url)
const { updateVolatile } = createRequire(require.resolve('@deepseek-ai/schemastery'))(
  '@deepseek-ai/cosmokit',
)

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const json = async (relative) =>
  JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'))

// Repository wiring and dormant-host checks: no installs, live credentials,
// network requests, or running DSH instance are needed.
test('portable recipe selects Linear after base and Web with its plugin settings client', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-linear-recipe-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const manifest = await json('../package.json')
  const recipe = await json('../../../profiles/personal-web/recipe.json')
  const index = recipe.bundles.findIndex((bundle) => bundle.name === manifest.name)
  for (const name of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) {
    const prerequisite = recipe.bundles.findIndex((bundle) => bundle.name === name)
    assert.ok(prerequisite >= 0 && index > prerequisite, `Linear must follow ${name}`)
  }
  assert.equal(recipe.bundles[index].source, '../../packages/dsh-linear')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes'))
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const [name, version] of Object.entries({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
  })) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, '0.1.7-rc.2', name)
  }
  assert.equal(manifest.dependencies['@linear/sdk'], '92.0.0')
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /- insert:\s+- id: local-linear\s+name: '@local\/dsh-linear'/)
  assert.doesNotMatch(patch, /apiKey|LINEAR_API_KEY|agent-presets|isolate/)
  const result = spawnSync(
    process.execPath,
    ['scripts/apply-profile.mjs', 'personal-web', '--dry-run'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 10000,
      env: { PATH: process.env.PATH, DSH_HOME: dshHome },
    },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Applying @local\/dsh-linear to profile personal-web/)
  assert.match(result.stdout, /Dry run complete/)
})

test('host registers the matching settings namespace and reversible RPC without reading credentials at boot', async () => {
  const tools = []
  const prompts = []
  const disposers = []
  let settings
  let handler
  let disposed = false
  const connection = {
    rpc: {
      handle(channel, callback) {
        assert.equal(channel, '/linear-integration')
        handler = callback
        return () => {
          disposed = true
        }
      },
    },
  }
  const ctx = {
    fiber: {},
    inject(dependencies, install) {
      assert.deepEqual(dependencies, ['settings'])
      install({
        effect(callback) {
          disposers.push(callback())
        },
        settings: {
          configure(presentation, owner) {
            settings = { presentation, owner }
            return () => {
              settings = undefined
            }
          },
        },
      })
    },
    get(name) {
      if (name === 'credentials') return { describe: async () => ({ configured: false }) }
      assert.equal(name, 'connection')
      return connection
    },
    effect(callback) {
      disposers.push(callback())
    },
    on() {
      return () => {}
    },
    tools: {
      register(tool) {
        tools.push(tool)
      },
    },
    systemPrompt: {
      section(value) {
        prompts.push(value)
      },
    },
  }
  const config = Config({})
  apply(ctx, config)
  assert.equal(settings.owner, ctx.fiber)
  assert.deepEqual(settings.presentation, { auto: false })
  assert.deepEqual((await handler('status')).value.workspace, null)
  const candidate = Config({
    organizationId: 'org-live',
    organizationName: 'Live workspace',
    organizationUrlKey: 'live',
  })
  updateVolatile(config.organizationId, candidate.organizationId)
  updateVolatile(config.organizationName, candidate.organizationName)
  updateVolatile(config.organizationUrlKey, candidate.organizationUrlKey)
  assert.deepEqual((await handler('status')).value.workspace, {
    id: 'org-live',
    name: 'Live workspace',
    urlKey: 'live',
  })
  assert.equal(typeof handler, 'function')
  assert.equal(tools.length, 12)
  assert.match(prompts[0].text, /Plugins → Linear → Configure/)
  assert.equal(disposed, false)
  for (const dispose of disposers) dispose?.()
  assert.equal(disposed, true)
  assert.equal(settings, undefined)
})

test('Linear reads real volatile Config refs without Settings and rejects scalar substitutes', () => {
  const config = Config({ organizationId: 'org-initial' })
  let attach
  const ctx = {
    inject: (_dependencies, callback) => {
      attach = callback
    },
  }
  const settings = installLinearSettings(ctx, config)
  assert.equal(typeof attach, 'function')
  assert.equal(settings().organizationId, 'org-initial')
  updateVolatile(config.organizationId, Config({ organizationId: 'org-updated' }).organizationId)
  assert.equal(settings().organizationId, 'org-updated')
  assert.equal(Config.dict.organizationId.meta.volatile, true)
  assert.equal(Config.dict.apiKey.meta.volatile, undefined)
  assert.throws(() => installLinearSettings(ctx, { organizationId: 'scalar' })(), /get/)
})
