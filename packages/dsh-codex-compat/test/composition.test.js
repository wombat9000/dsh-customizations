import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { installed } from '../../dsh-google-auth/test/profile-fixture.js'

const {
  boot,
  composeEntries,
  initProfile,
  loadProfileDirectory,
  readProfilePatches,
  resolveBundleDir,
} = await installed('@deepseek-ai/dsh-app-boot')
const { default: CredentialsLocal } = await installed('@deepseek-ai/dsh-credentials-local')
const { AuthorizationService } = await installed('@deepseek-ai/dsh-authorization')
const { credentialKey } = await installed('@deepseek-ai/dsh-credentials')
const require = createRequire(import.meta.url)
const launcherAnchor = require.resolve('@deepseek-ai/dsh/package.json')
const bundleRoot = fileURLToPath(new URL('..', import.meta.url))
const bundleName = '@local/dsh-codex-compat'
const nativeKey = credentialKey('llm-pi-ai', 'openai-codex')
const providers = {
  'openai-codex': { displayName: 'Saved Codex', headers: { 'x-fixture': 'preserved' } },
  openai: { displayName: 'Other saved provider', apiKeyEnv: 'SYNTHETIC_UNUSED_KEY' },
}
const selection = { provider: 'openai-codex', model: 'gpt-6-sol', reasoningEffort: 'medium' }
const flatten = (rows) =>
  rows.flatMap((row) => [
    row,
    ...(row.group && Array.isArray(row.config) ? flatten(row.config) : []),
  ])

// Load shipped base/Web patches and the actual package manifest/exports through app-boot.
// A safety overlay disables unrelated shell, telemetry, browser and listener owners.
// Authorization, CredentialsLocal, pi, Settings/ConfigEditor, Storage and Connection are real.
// Only web route transport and the unused session lookup boundary are inert.
async function composition(t, legacy) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'codex-composition-contract-')))
  let ctx
  t.after(async () => {
    await ctx?.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  const dir = join(home, 'profiles', 'test')
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  if (legacy) bundles.push('@local/dsh-codex-oauth')
  bundles.push(bundleName)
  initProfile(dir, bundles)
  await mkdir(join(dir, 'node_modules', '@local'), { recursive: true })
  await symlink(bundleRoot, join(dir, 'node_modules', bundleName), 'dir')
  if (legacy) {
    const old = join(dir, 'node_modules', '@local/dsh-codex-oauth')
    await mkdir(old)
    await writeFile(
      join(old, 'package.json'),
      JSON.stringify({
        name: '@local/dsh-codex-oauth',
        version: '0.1.0',
        type: 'module',
        exports: './index.js',
        dsh: { bundle: { patch: 'cordis.patch.yml' } },
      }),
    )
    await writeFile(
      join(old, 'cordis.patch.yml'),
      JSON.stringify([{ insert: [{ id: 'local-codex-oauth', name: '@local/dsh-codex-oauth' }] }]),
    )
    await writeFile(
      join(old, 'index.js'),
      "throw new Error('legacy helper must be replaced, not loaded')\n",
    )
  }
  const profile = {
    name: 'test',
    startedBundles: bundles,
    dir,
    patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: launcherAnchor,
    cwd: home,
    home,
    overlays: [],
    telemetryDisabledEnv: '1',
  }
  const saved = [
    { id: 'llm-pi-ai', config: { providers } },
    { id: 'agent-default-model', config: selection },
  ]
  await writeFile(profile.patchPath, JSON.stringify(saved) + '\n')
  const savedBytes = await readFile(profile.patchPath, 'utf8')
  const loaded = loadProfileDirectory('dsh', dir, launcherAnchor)
  assert.deepEqual(loaded.skippedBundles, [])
  assert.deepEqual(
    loaded.layers.map((layer) => layer.packageName),
    bundles,
  )
  const bundleLayer = loaded.layers.find((layer) => layer.packageName === bundleName)
  const inherited = flatten(
    composeEntries([
      ...loaded.layers.filter((layer) => layer !== bundleLayer).map((layer) => layer.patches),
      saved,
      bundleLayer.patches,
    ]),
  )
  // Put saved configuration before this bundle as a negative control: a bundle-owned
  // pi override must not hide behind the profile's normally later saved-config layer.
  assert.deepEqual(inherited.find((row) => row.id === 'llm-pi-ai').config, { providers })
  assert.deepEqual(inherited.find((row) => row.id === 'agent-default-model').config, selection)
  const rows = flatten(
    composeEntries([...loaded.layers.map((layer) => layer.patches), loaded.patches]),
  )
  const enabled = new Set([
    'llm',
    'llm-pi-ai',
    'authorization',
    'credentials',
    'config-editor',
    'settings',
    'agent-default-model',
    'storage',
    'storage-json',
    'storage-domain',
    'connection',
    'local-codex-oauth',
    'local-codex-fast',
  ])
  profile.overlays = [
    ...rows
      .filter((row) => !enabled.has(row.id))
      .map((row) => ({
        id: row.id,
        disabled: true,
        ...(row.group ? { group: false } : {}),
      })),
    {
      id: 'credentials',
      config: { path: join(home, '.credentials.yaml'), watch: false, dotenvPaths: [] },
    },
    { id: 'storage-json', config: { root: join(home, 'storages') } },
  ]
  // Native packages resolve from this isolated profile without changing dependencies.
  for (const row of rows.filter(
    (row) => enabled.has(row.id) && row.name.startsWith('@deepseek-ai/'),
  )) {
    const target = join(dir, 'node_modules', row.name)
    await mkdir(dirname(target), { recursive: true })
    await symlink(resolveBundleDir('dsh', row.name, launcherAnchor, dir), target, 'dir')
  }
  // Seed the native store before activation so this real helper can never request pi login.
  const seed = new Context()
  try {
    await seed
      .plugin(CredentialsLocal, {
        path: join(home, '.credentials.yaml'),
        watch: false,
        dotenvPaths: [],
      })
      .await()
    await seed.credentials.modifyRecord(nativeKey, async () => ({
      kind: 'grant',
      payload: { access: 'synthetic-already-configured' },
    }))
  } finally {
    await seed.fiber.dispose()
  }
  const oldReauth = process.env.DSH_CODEX_REAUTH
  delete process.env.DSH_CODEX_REAUTH
  t.after(() => {
    if (oldReauth === undefined) delete process.env.DSH_CODEX_REAUTH
    else process.env.DSH_CODEX_REAUTH = oldReauth
  })
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const routes = new Set()
  ctx = await boot('dsh', join(dir, 'cordis.yml'), readProfilePatches('dsh', profile), (root) => {
    root.provide('profileContext', profile)
    root.provide('appReady', {
      onReady: (listener) => {
        listener()
        return () => {}
      },
    })
    root.provide('webRuntime', { trustedHosts: [] })
    root.provide('webServer', {
      register(route) {
        routes.add(route)
        return () => routes.delete(route)
      },
    })
    root.provide('agents', { get: () => undefined })
    root.provide('sessionProjections', { stateOf: () => undefined })
  })
  await ctx.loader.await()
  return { ctx, profile, routes, savedBytes }
}

// Gate: real Loader activation detects unresolved component exports, duplicate services and
// configuration replacement that the existing Fast mount/source suites cannot reach.
// Coexistence is the same journey with a legacy stable-id row, not a copied manifest inventory.
for (const legacy of [false, true]) {
  test(
    `actual bundle mounts native base/Web graph${legacy ? ' replacing a legacy stable-id helper' : ''} without changing saved pi configuration`,
    { timeout: 10000 },
    async (t) => {
      const noLogin = t.mock.method(AuthorizationService.prototype, 'begin', () => {
        assert.fail('composition must never start a native login')
      })
      const f = await composition(t, legacy)
      const entries = [...f.ctx.loader.entries()]
      const profileRequire = createRequire(join(f.profile.dir, 'package.json'))
      for (const [id, component] of [
        ['local-codex-oauth', 'oauth'],
        ['local-codex-fast', 'fast'],
      ]) {
        const matches = entries.filter((entry) => entry.options.id === id)
        assert.equal(matches.length, 1, `${id} must have exactly one runtime owner`)
        // RC2 requires a bare package row to discover Fast's Client half. Its root
        // Host export must still resolve to the public /fast component entry.
        const loaderName = component === 'fast' ? bundleName : `${bundleName}/oauth`
        assert.equal(matches[0].options.name, loaderName)
        assert.equal(
          profileRequire.resolve(`${bundleName}/${component}`),
          join(bundleRoot, 'dist', 'src', component, 'index.js'),
        )
        assert.equal(
          profileRequire.resolve(loaderName),
          profileRequire.resolve(`${bundleName}/${component}`),
        )
        assert.equal(matches[0].fiber.state, 2, `${component} export must activate through Loader`)
      }
      const authorization = entries.filter(
        (entry) => entry.options.name === '@deepseek-ai/dsh-authorization',
      )
      assert.equal(authorization.length, 1)
      assert.equal(authorization[0].fiber.state, 2)
      assert.equal(
        entries.filter((entry) => entry.options.name === '@local/dsh-codex-oauth').length,
        0,
      )
      const flow = f.ctx.authorization.describe(nativeKey)
      assert.ok(flow.methods.some((method) => method.id === 'oauth'))
      assert.equal(flow.inFlight, false)
      assert.equal(noLogin.mock.callCount(), 0)
      assert.deepEqual(f.ctx.agentDefaultModel.currentSelection(), selection)
      const forms = f.ctx.settings.describe()
      assert.deepEqual(forms.find((form) => form.ns === 'llm-pi-ai').user, { providers })
      assert.deepEqual(forms.find((form) => form.ns === 'agent-default-model').user, selection)
      assert.ok((await f.ctx.llm.listModels('openai-codex')).length > 0)
      assert.ok(
        (await f.ctx.llm.listModels('openai')).length > 0,
        'unrelated saved provider survives',
      )
      assert.equal(await readFile(f.profile.patchPath, 'utf8'), f.savedBytes)
      const routes = [...f.routes]
      assert.deepEqual(
        routes.map((route) => route.path).sort(),
        ['/api', '/codex-fast-integration'],
        'native Connection and Fast register their distinct inert routes',
      )
      await entries.find((entry) => entry.options.id === 'local-codex-oauth').fiber.dispose()
      assert.deepEqual(
        [...f.routes],
        routes,
        'OAuth lifetime does not remove Fast/native Connection',
      )
      assert.ok(f.ctx.authorization.describe(nativeKey), 'native pi still owns the flow')
      assert.deepEqual(f.ctx.agentDefaultModel.currentSelection(), selection)
      assert.equal(await readFile(f.profile.patchPath, 'utf8'), f.savedBytes)
    },
  )
}
