import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

// Use existing pinned official dependencies and temporary dormant contexts.
// No real profile, user credentials, OAuth, network, or tool execution.
const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = name => import(pathToFileURL(cli.resolve(name)).href)
const { Context } = await installed('@deepseek-ai/cordis')
const { default: Loader, interpolate } = await installed('@deepseek-ai/cordis-plugin-loader')
const { entryListSchema } = await installed('@deepseek-ai/cordis-plugin-include')
const { default: yaml } = await installed('js-yaml')
const { default: AgentPresets, discoverPresets, SHIPPED_PRESET_ROOT } = await installed('@deepseek-ai/dsh-agent-presets')
const { loadOverlayPatches, composeEntries } = await installed('@deepseek-ai/dsh-app-boot')
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const webPatch = join(dirname(cli.resolve('@deepseek-ai/dsh-web-app/package.json')), 'cordis.patch.yml')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const parse = text => yaml.load(text, { schema: entryListSchema })
const flatten = rows => rows.flatMap(row => [row, ...(row.group ? flatten(row.config) : [])])

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-google-drive-preset-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const local = join(directory, 'node_modules/@local')
  await mkdir(local, { recursive: true })
  const packaged = join(local, 'dsh-google-drive')
  await mkdir(packaged)
  const manifest = await json(join(packageRoot, 'package.json'))
  for (const file of ['package.json', ...manifest.files]) {
    await cp(join(packageRoot, file), join(packaged, file), { recursive: true })
  }
  for (const name of ['dsh-worktree', 'dsh-project-steward']) {
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
  assert.equal(names.at(-1), '@local/dsh-google-drive')
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

test('published bundle discovers Google Drive; personal-web preserves all three roots', async t => {
  const f = await fixture(t)
  const manifest = await json(join(f.packaged, 'package.json'))
  assert.equal(manifest.name, '@local/dsh-google-drive')
  assert.equal(manifest.exports['./tools'], './src/tools.js')
  assert.equal(manifest.exports['./package.json'], './package.json')
  assert.deepEqual(manifest.dependencies, { '@deepseek-ai/schemastery': '3.18.2' })
  for (const combined of [false, true]) {
    const config = rosterConfig(f.baseUrl, combined ? await recipePatches() : [webPatch, join(f.packaged, 'cordis.patch.yml')])
    assert.equal(config.default, 'standard')
    assert.equal(config.includeShippedRoot ?? true, true)
    assert.equal(config.includeUserRoot ?? true, true)
    assert.equal(config.roots.length, combined ? 3 : 1)
    const roster = await discoverPresets([{ path: SHIPPED_PRESET_ROOT, trust: 'system' }, ...config.roots], f.baseUrl)
    for (const id of ['standard', 'minimal', 'cordis', 'google-drive', ...(combined ? ['worktree-coordinator', 'project-steward'] : [])]) {
      const row = roster.find(item => item.id === id)
      assert.ok(row, `missing ${id}`)
      assert.equal(row.broken, undefined)
      assert.equal(row.trust, 'system')
    }
    const own = roster.find(row => row.id === 'google-drive')
    assert.equal(own.name, 'Google Drive')
    assert.equal(own.description, 'Standard coding tools plus read-only Drive metadata listing.')
    assert.equal(own.path, join(f.packaged, 'presets/google-drive/agent.cordis.yml'))
  }
})

test('preset preserves exact Standard configuration and appends only its consumer', async () => {
  const standard = parse(await readFile(join(SHIPPED_PRESET_ROOT, 'standard/agent.cordis.yml'), 'utf8'))
  const drive = parse(await readFile(join(packageRoot, 'presets/google-drive/agent.cordis.yml'), 'utf8'))
  assert.deepEqual(drive.slice(0, -1), standard)
  assert.deepEqual(drive.at(-1), { id: 'tool-google-drive', name: '@local/dsh-google-drive/tools' })
  assert.equal(await readFile(join(packageRoot, 'presets/google-drive/LICENSE.standard'), 'utf8'),
    await readFile(join(dirname(SHIPPED_PRESET_ROOT), 'LICENSE'), 'utf8'))
  const patch = parse(await readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8'))
  assert.ok(patch.some(row => row.insert?.some(item => item.name === '@local/dsh-google-drive')))
})

test('real dormant Standard and Google Drive mounts isolate tool contributions', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.baseUrl = f.baseUrl
  await ctx.plugin(Loader, {}).await()
  const { default: Group } = await installed('@deepseek-ai/cordis-plugin-group')
  ctx.get('loader').builtins.group = Group
  for (const suffix of [
    'session', 'agent', 'session-projection', 'system-prompt', 'tools',
    'commands', 'goal', 'skill', 'token-meter', 'subprocess-local', 'bash-local',
    'shell-env', 'fs-local', 'jobs-local', 'subagent', 'user-questions', 'web',
    'llm', 'subagent-spawn-in-process', 'subagent-fork-in-process',
    'tool-subagent/model-selection-settings',
  ]) {
    const module = await installed(`@deepseek-ai/dsh-${suffix}`)
    await ctx.plugin(module.default ?? module, {}).await()
  }
  const { default: SandboxPolicy } = await installed('@deepseek-ai/dsh-sandbox-policy')
  await ctx.plugin(SandboxPolicy, { mode: 'read-only', workspaceRoot: f.directory }).await()
  // Host implementation has separate tests. This sentinel supplies only its
  // business contract, and fails if mounting tries to use account data.
  const service = {
    listFiles() { assert.fail('mount must not list files') },
    getAccessToken() { assert.fail('mount must not access tokens') },
  }
  await ctx.plugin({ name: 'drive-host-fixture', apply(ctx) { ctx.provide('googleDrive', service) } }).await()
  await ctx.plugin(AgentPresets, {
    ...rosterConfig(f.baseUrl, [webPatch, join(f.packaged, 'cordis.patch.yml')]), includeUserRoot: false,
  }).await()
  const roster = ctx.get('agentPresets')
  const standard = await roster.standingKeyFor('standard')
  const drive = await roster.standingKeyFor('google-drive')
  assert.notEqual(standard, drive)
  assert.equal(await roster.standingKeyFor('google-drive'), drive)
  const names = key => [...ctx.get('tools').view(key).visible.keys()].sort()
  assert.ok(names(standard).length > 20)
  assert.deepEqual(names(drive), [...names(standard), 'google_drive_list_files'].sort())
  assert.deepEqual(names(), [])
  assert.equal(ctx.get('googleDrive'), service)
  for (const name of ['planMode', 'compaction', 'toolResultPruner', 'workflowEngine']) assert.equal(ctx.get(name), undefined)
})
