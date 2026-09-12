import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

// Existing pinned DSH dependencies only; no live profile, credentials or network.
const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = name => import(pathToFileURL(cli.resolve(name)).href)
const { interpolate } = await installed('@deepseek-ai/cordis-plugin-loader')
const { discoverPresets, SHIPPED_PRESET_ROOT } = await installed('@deepseek-ai/dsh-agent-presets')
const { loadOverlayPatches, composeEntries } = await installed('@deepseek-ai/dsh-app-boot')
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const webPatch = join(dirname(cli.resolve('@deepseek-ai/dsh-web-app/package.json')), 'cordis.patch.yml')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const flatten = rows => rows.flatMap(row => [row, ...(row.group ? flatten(row.config) : [])])

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-google-drive-roster-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const local = join(directory, 'node_modules/@local')
  await mkdir(local, { recursive: true })
  const packaged = join(local, 'dsh-google-drive')
  await mkdir(packaged)
  const manifest = await json(join(packageRoot, 'package.json'))
  for (const file of ['package.json', ...manifest.files]) {
    await cp(join(packageRoot, file), join(packaged, file), { recursive: true })
  }
  for (const name of ['dsh-worktree', 'dsh-project-steward', 'dsh-product-mode']) {
    await symlink(join(repo, 'packages', name), join(local, name), 'dir')
  }
  await symlink(dirname(dirname(cli.resolve('@deepseek-ai/dsh/package.json'))), join(directory, 'node_modules/@deepseek-ai'), 'dir')
  return { directory, packaged, baseUrl: pathToFileURL(`${directory}/`).href }
}

function rosterConfig(baseUrl, patches) {
  const warnings = []
  const rows = composeEntries(patches.map(path => loadOverlayPatches('drive-test', path)), warning => warnings.push(warning))
  assert.ok(!warnings.some(warning => warning.includes('agent-presets')), warnings.join('\n'))
  return interpolate({ baseUrl }, flatten(rows).find(row => row.id === 'agent-presets').config)
}

async function recipePatches() {
  const directory = join(repo, 'profiles/personal-web')
  const recipe = await json(join(directory, 'recipe.json'))
  const names = recipe.bundles.map(bundle => bundle.name)
  assert.equal(names.filter(name => name === '@local/dsh-google-drive').length, 1)
  assert.equal(names.filter(name => name === '@local/dsh-google-auth').length, 1)
  assert.ok(names.indexOf('@local/dsh-google-auth') < names.indexOf('@local/dsh-google-drive'))
  const patches = []
  for (const bundle of recipe.bundles) {
    const manifestPath = bundle.source.startsWith('.')
      ? resolve(directory, bundle.source, 'package.json') : cli.resolve(`${bundle.source}/package.json`)
    const manifest = await json(manifestPath)
    assert.equal(manifest.name, bundle.name)
    patches.push(resolve(dirname(manifestPath), manifest.dsh.bundle.patch))
  }
  patches.push(resolve(directory, recipe.patch))
  return patches
}

test('Drive adds no preset and personal-web preserves all custom roots', async t => {
  const f = await fixture(t)
  const drivePatch = join(f.packaged, 'cordis.patch.yml')
  const base = rosterConfig(f.baseUrl, [webPatch])
  assert.deepEqual(rosterConfig(f.baseUrl, [webPatch, drivePatch]), base)
  const shipped = await discoverPresets([{ path: SHIPPED_PRESET_ROOT, trust: 'system' }], f.baseUrl)
  for (const combined of [false, true]) {
    const config = rosterConfig(f.baseUrl, combined ? await recipePatches() : [webPatch, drivePatch])
    assert.equal(config.default, 'standard')
    assert.equal(config.includeShippedRoot ?? true, true)
    assert.equal(config.includeUserRoot ?? true, true)
    const roots = config.roots ?? []
    if (combined) assert.deepEqual(roots, ['dsh-worktree', 'dsh-project-steward', 'dsh-product-mode'].map(name => ({
      path: join(repo, 'packages', name, 'presets'), trust: 'system',
    })))
    const roster = await discoverPresets([{ path: SHIPPED_PRESET_ROOT, trust: 'system' }, ...roots], f.baseUrl)
    for (const id of [...shipped.map(row => row.id), ...(combined ? ['worktree-coordinator', 'project-steward', 'product-mode'] : [])]) {
      const row = roster.find(item => item.id === id)
      assert.ok(row, `missing ${id}`)
      assert.equal(row.broken, undefined)
      assert.equal(row.trust, 'system')
    }
    assert.equal(roster.some(row => row.id === 'google-drive'), false)
  }
})

test('Drive insertion preserves arbitrary custom roster configuration', async t => {
  const f = await fixture(t)
  const config = { default: 'custom', includeShippedRoot: false, includeUserRoot: false,
    roots: [{ path: '/custom/first', trust: 'user' }, { path: '/custom/second', trust: 'system' }] }
  const rows = composeEntries([
    [{ insert: [{ id: 'agent-presets', name: '@deepseek-ai/dsh-agent-presets', config }] }],
    loadOverlayPatches('drive-test', join(f.packaged, 'cordis.patch.yml')),
  ])
  assert.deepEqual(flatten(rows).find(row => row.id === 'agent-presets').config, config)
})
