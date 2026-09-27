import assert from 'node:assert/strict'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as GitHub from '../../dsh-github/src/index.js'

// Shared Product/Steward fixture; deliberately independent of Worktree tests.
// Real dormant registries and Loader; subprocess/PTC execution is forbidden.
const require = createRequire(import.meta.url)
export const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
export const installed = (name) => import(pathToFileURL(cli.resolve(name)).href)
export const { Context } = await installed('@deepseek-ai/cordis')
export const { default: Loader, EntryTree } = await installed('@deepseek-ai/cordis-plugin-loader')
const { entryListSchema } = await installed('@deepseek-ai/cordis-plugin-include')
export const { default: yaml } = await installed('js-yaml')
export const { auditRows, livePresetMounts } = await installed(
  '@deepseek-ai/dsh-agent-preset-registry',
)
const { loadOverlayPatches, composeEntries } = await installed('@deepseek-ai/dsh-app-boot')
export const packageRoot = fileURLToPath(new URL('../', import.meta.url))
export const repo = fileURLToPath(new URL('../../../', import.meta.url))
export const presetId = 'product-mode'
export const skillName = 'product-planning'
export const presetRoot = join(packageRoot, 'presets')
export const webRoot = dirname(cli.resolve('@deepseek-ai/dsh-web-app/package.json'))
export const standardPatch = join(webRoot, 'presets/standard.patch.yml')
export const parse = (text) => yaml.load(text, { schema: entryListSchema })
export const flatten = (rows) =>
  rows.flatMap((row) => [row, ...(row.group ? flatten(row.config) : [])])
export const json = async (path) => JSON.parse(await readFile(path, 'utf8'))
export const declarations = (patches) =>
  composeEntries(
    patches.map((path) => loadOverlayPatches('preset-test', path)),
    (warning) => assert.fail(warning),
  )

export async function fixture(t, id = presetId) {
  const directory = await mkdtemp(join(tmpdir(), `${id}-`))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const local = join(directory, 'node_modules', '@local')
  await mkdir(local, { recursive: true })
  const source = join(repo, 'packages', `dsh-${id}`)
  const packaged = join(local, `dsh-${id}`)
  await mkdir(packaged)
  const manifest = await json(join(source, 'package.json'))
  // Only publication files travel; resource resolution cannot use source/test assets.
  for (const file of ['package.json', ...manifest.files])
    await cp(join(source, file), join(packaged, file), { recursive: true })
  const namespace = join(directory, 'node_modules', '@deepseek-ai')
  await mkdir(namespace)
  const names = new Set(
    [
      '@deepseek-ai/dsh-agent-preset-registry',
      '@deepseek-ai/dsh-agent-preset',
      '@deepseek-ai/dsh-session-projection',
      ...declarations([standardPatch, join(packaged, 'cordis.patch.yml')]).flatMap((row) =>
        flatten(row.config.plugins).map((plugin) => plugin.name),
      ),
    ]
      .filter((name) => name.startsWith('@deepseek-ai/'))
      .map((name) => name.split('/').slice(0, 2).join('/')),
  )
  for (const name of names)
    await symlink(
      dirname(cli.resolve(`${name}/package.json`)),
      join(namespace, name.split('/')[1]),
      'dir',
    )
  return { directory, packaged, source, baseUrl: pathToFileURL(`${directory}/`).href }
}

export async function recipeRows() {
  const directory = join(repo, 'profiles/personal-web')
  const recipe = await json(join(directory, 'recipe.json'))
  const patches = []
  for (const bundle of recipe.bundles) {
    const manifestPath = bundle.source.startsWith('.')
      ? resolve(directory, bundle.source, 'package.json')
      : cli.resolve(`${bundle.source}/package.json`)
    const manifest = await json(manifestPath)
    assert.equal(manifest.name, bundle.name)
    for (const patch of [manifest.dsh.bundle.patch].flat())
      patches.push(resolve(dirname(manifestPath), patch))
  }
  return declarations([...patches, resolve(directory, recipe.patch)])
}

export async function snapshot(directory) {
  const result = {}
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name)
    const stat = await lstat(path)
    result[name] = stat.isSymbolicLink()
      ? { link: await readlink(path) }
      : stat.isDirectory()
        ? await snapshot(path)
        : await readFile(path, 'utf8')
  }
  return result
}

class MemoryTree extends EntryTree {
  write() {}
}

export async function host(t, fixture, rows, { full = true, selectedDefault } = {}) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.baseUrl = fixture.baseUrl
  await ctx.plugin(Loader, {}).await()
  const { default: Group } = await installed('@deepseek-ai/cordis-plugin-group')
  ctx.get('loader').builtins.group = Group
  const calls = []
  const forbidden = (...args) => {
    calls.push(args)
    assert.fail('mounting must not execute a subprocess or PTC workflow')
  }
  if (full) {
    ctx.provide('subprocess', { resolveExecutable: forbidden, spawn: forbidden })
    for (const suffix of [
      'session',
      'agent',
      'system-prompt',
      'tools',
      'commands',
      'goal',
      'skill',
      'token-meter',
      'bash-local',
      'shell-env',
      'fs-local',
      'jobs-local',
      'subagent',
      'user-questions',
      'web',
      'llm',
      'subagent-spawn-in-process',
      'subagent-fork-in-process',
      'tool-subagent/model-selection-settings',
    ]) {
      const module = await installed(`@deepseek-ai/dsh-${suffix}`)
      await ctx.plugin(module.default ?? module, {}).await()
    }
    const { default: SandboxPolicy } = await installed('@deepseek-ai/dsh-sandbox-policy')
    await ctx.plugin(SandboxPolicy, { mode: 'read-only', workspaceRoot: fixture.directory }).await()
    for (const suffix of ['sandbox-local', 'ptc-runtime-node']) {
      const module = await installed(`@deepseek-ai/dsh-${suffix}`)
      await ctx.plugin(module.default ?? module, {}).await()
    }
    await ctx.plugin(GitHub, {}).await()
  }
  const tree = new MemoryTree(ctx)
  t.after(async () => {
    tree.root.stop()
    await tree.await()
  })
  const registry = {
    id: 'agent-preset-registry',
    name: '@deepseek-ai/dsh-agent-preset-registry',
    config: { default: 'standard', ...(selectedDefault ? { selectedDefault } : {}) },
  }
  // Loader applies volatile selectedDefault and preserves nested !!js expressions.
  await tree.root.update([
    { id: 'session-projections', name: '@deepseek-ai/dsh-session-projection' },
    registry,
    ...rows,
  ])
  await tree.await()
  const audit = await auditRows(tree)
  assert.deepEqual(audit.failed, [])
  assert.deepEqual(audit.pending, [])
  return { ctx, tree, registry, calls }
}

export async function lease(t, roster, id) {
  const scope = await roster.acquireScope(id)
  t.after(() => scope[Symbol.asyncDispose]())
  return scope
}
