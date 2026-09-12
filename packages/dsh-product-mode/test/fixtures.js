import assert from 'node:assert/strict'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as GitHub from '../../dsh-github/src/index.js'

// Resolve through the root's exact-pinned official CLI graph. These fixtures use
// dormant services, not a model, live profile, persistence store or network.
const require = createRequire(import.meta.url)
export const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
export const installed = name => import(pathToFileURL(cli.resolve(name)).href)
export const { Context } = await installed('@deepseek-ai/cordis')
export const { default: Loader, interpolate } = await installed('@deepseek-ai/cordis-plugin-loader')
const { entryListSchema } = await installed('@deepseek-ai/cordis-plugin-include')
export const { default: yaml } = await installed('js-yaml')
export const { default: AgentPresets, discoverPresets, SHIPPED_PRESET_ROOT } = await installed('@deepseek-ai/dsh-agent-presets')
const { loadOverlayPatches, composeEntries } = await installed('@deepseek-ai/dsh-app-boot')
export const packageRoot = fileURLToPath(new URL('../', import.meta.url))
export const repo = fileURLToPath(new URL('../../../', import.meta.url))
export const presetId = 'product-mode'
export const skillName = 'product-planning'
export const presetRoot = join(packageRoot, 'presets')
export const composition = join(presetRoot, presetId, 'agent.cordis.yml')
const webPatch = join(dirname(cli.resolve('@deepseek-ai/dsh-web-app/package.json')), 'cordis.patch.yml')
export const parse = text => yaml.load(text, { schema: entryListSchema })
export const flatten = rows => rows.flatMap(row => [row, ...(row.group ? flatten(row.config) : [])])
export const json = async path => JSON.parse(await readFile(path, 'utf8'))

export async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'product-mode-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const local = join(directory, 'node_modules', '@local')
  await mkdir(local, { recursive: true })
  const packaged = join(local, 'dsh-product-mode')
  await mkdir(packaged)
  const manifest = await json(join(packageRoot, 'package.json'))
  // Only published files travel. The copied preset cannot use test-only assets.
  for (const file of ['package.json', ...manifest.files]) await cp(join(packageRoot, file), join(packaged, file), { recursive: true })
  for (const name of ['dsh-worktree', 'dsh-project-steward', 'dsh-google-drive', 'dsh-github']) {
    await symlink(join(repo, 'packages', name), join(local, name), 'dir')
  }
  await symlink(dirname(dirname(cli.resolve('@deepseek-ai/dsh/package.json'))), join(directory, 'node_modules', '@deepseek-ai'), 'dir')
  return { directory, packaged, baseUrl: pathToFileURL(`${directory}/`).href }
}

export async function recipePatches() {
  const directory = join(repo, 'profiles/personal-web')
  const recipe = await json(join(directory, 'recipe.json'))
  const names = recipe.bundles.map(bundle => bundle.name)
  const ordered = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@local/dsh-worktree', '@local/dsh-project-steward', '@local/dsh-product-mode']
  for (const name of [...ordered, '@local/dsh-github']) assert.equal(names.filter(value => value === name).length, 1)
  for (let i = 1; i < ordered.length; i++) assert.ok(names.indexOf(ordered[i - 1]) < names.indexOf(ordered[i]))
  const patches = []
  for (const bundle of recipe.bundles) {
    const manifestPath = bundle.source.startsWith('.') ? resolve(directory, bundle.source, 'package.json') : cli.resolve(`${bundle.source}/package.json`)
    const manifest = await json(manifestPath)
    assert.equal(manifest.name, bundle.name)
    patches.push(resolve(dirname(manifestPath), manifest.dsh.bundle.patch))
  }
  assert.equal(typeof recipe.patch, 'string')
  return [...patches, resolve(directory, recipe.patch)]
}

export function rosterConfig(baseUrl, patches = [webPatch, join(packageRoot, 'cordis.patch.yml')]) {
  const warnings = []
  const rows = composeEntries(patches.map(path => loadOverlayPatches('product-mode-test', path)), warning => warnings.push(warning))
  assert.ok(!warnings.some(warning => warning.includes('agent-presets')), warnings.join('\n'))
  return interpolate({ baseUrl }, flatten(rows).find(row => row.id === 'agent-presets').config)
}

export async function snapshot(directory) {
  const result = {}
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name)
    const stat = await lstat(path)
    result[name] = stat.isSymbolicLink() ? { link: await readlink(path) } : stat.isDirectory() ? await snapshot(path) : await readFile(path, 'utf8')
  }
  return result
}

export async function host(t, fixture, config) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.baseUrl = fixture.baseUrl
  await ctx.plugin(Loader, {}).await()
  const { default: Group } = await installed('@deepseek-ai/cordis-plugin-group')
  ctx.get('loader').builtins.group = Group
  const subprocessCalls = []
  ctx.provide('subprocess', {
    async resolveExecutable(...args) { subprocessCalls.push(args); assert.fail('preset discovery must not resolve any CLI') },
    spawn(...args) { subprocessCalls.push(args); assert.fail('preset discovery must not launch any process') },
  })
  for (const suffix of [
    'session', 'agent', 'session-projection', 'system-prompt', 'tools',
    'commands', 'goal', 'skill', 'token-meter', 'bash-local',
    'shell-env', 'fs-local', 'jobs-local', 'subagent', 'user-questions', 'web',
    'llm', 'subagent-spawn-in-process', 'subagent-fork-in-process',
    'tool-subagent/model-selection-settings',
  ]) {
    const module = await installed(`@deepseek-ai/dsh-${suffix}`)
    await ctx.plugin(module.default ?? module, {}).await()
  }
  const { default: SandboxPolicy } = await installed('@deepseek-ai/dsh-sandbox-policy')
  await ctx.plugin(SandboxPolicy, { mode: 'read-only', workspaceRoot: fixture.directory }).await()
  await ctx.plugin(GitHub, {}).await()
  await ctx.plugin(AgentPresets, { ...config, includeUserRoot: false }).await()
  return { ctx, subprocessCalls }
}
