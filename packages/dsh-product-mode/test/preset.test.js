import assert from 'node:assert/strict'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  AgentPresets, Context, Loader, SHIPPED_PRESET_ROOT, cli, composition, discoverPresets,
  fixture, flatten, host, installed, json, packageRoot, parse, presetId, presetRoot,
  recipePatches, repo, rosterConfig, skillName, snapshot, yaml,
} from './fixtures.js'

const githubNames = [
  'connection_status', 'detect_repositories', 'list_repositories', 'get_repository',
  'list_projects', 'get_project', 'list_project_items', 'list_issues', 'search_issues',
  'get_issue', 'get_issue_comments', 'create_project', 'update_project',
  'link_project_repository', 'create_issue', 'add_project_item', 'set_project_item_field',
  'add_issue_dependency',
].map(name => `github_${name}`).sort()

test('published composition-only package discovers independently and final recipe retains all three custom roots', async t => {
  const f = await fixture(t)
  const manifest = await json(join(f.packaged, 'package.json'))
  assert.equal(manifest.name, '@local/dsh-product-mode')
  assert.equal(manifest.exports['./package.json'], './package.json')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal((await json(cli.resolve('@deepseek-ai/dsh/package.json'))).version, '0.1.5-rc.1')
  assert.equal(manifest.main, undefined)
  assert.equal(manifest.dependencies, undefined)
  assert.equal(manifest.devDependencies, undefined)
  assert.deepEqual(Object.keys(manifest.scripts), ['test'], 'no install, setup, generation or startup scripts')
  assert.deepEqual(Object.keys(manifest.dsh), ['bundle'], 'no new host runtime or client UI')
  const lock = yaml.load(await readFile(join(repo, 'pnpm-lock.yaml'), 'utf8'))
  assert.deepEqual(lock.importers['packages/dsh-product-mode'], {})
  for (const combined of [false, true]) {
    const config = rosterConfig(f.baseUrl, combined ? await recipePatches() : undefined)
    assert.equal(config.default, 'standard')
    assert.equal(config.includeShippedRoot ?? true, true)
    assert.equal(config.includeUserRoot ?? true, true)
    assert.equal(config.roots.length, combined ? 3 : 1)
    const roster = await discoverPresets([{ path: SHIPPED_PRESET_ROOT, trust: 'system' }, ...config.roots], f.baseUrl)
    for (const id of ['standard', 'minimal', 'cordis', presetId, ...(combined ? ['worktree-coordinator', 'project-steward'] : [])]) {
      const row = roster.find(item => item.id === id)
      assert.ok(row, `missing ${id}`)
      assert.equal(row.broken, undefined)
      assert.equal(row.trust, 'system')
    }
    const own = roster.find(row => row.id === presetId)
    assert.equal(own.name, 'Product mode')
    assert.ok(own.description)
    assert.equal(own.path, join(f.packaged, 'presets/product-mode/agent.cordis.yml'))
  }
  const recipe = await json(join(repo, 'profiles/personal-web/recipe.json'))
  assert.equal(recipe.bundles.find(row => row.name === manifest.name).source, '../../packages/dsh-product-mode')
})

test('Product mode preserves exact Standard tool rows, configurations, nesting, realm boundaries and license', async () => {
  const standard = parse(await readFile(join(SHIPPED_PRESET_ROOT, 'standard/agent.cordis.yml'), 'utf8'))
  const product = parse(await readFile(composition, 'utf8'))
  const persona = product.find(row => row.id === 'persona').config
  assert.equal(persona.text, undefined)
  assert.equal(persona.core, undefined)
  assert.match(persona.prefix, /Product mode/)
  assert.ok(persona.prefix.includes('{{model}}'))
  assert.ok(persona.suffix.includes('Your working directory is {{cwd}}.'))
  assert.match(persona.suffix, /product-planning/)
  const extra = product.filter(row => row.id === 'local-product-mode-skills')
  assert.equal(extra.length, 1)
  assert.equal(extra[0].name, '@deepseek-ai/dsh-skill-filesystem')
  assert.equal(extra[0].config.includeDefaultRoots, false)
  assert.equal(extra[0].config.watch, false)
  const normalized = product.filter(row => row.id !== extra[0].id)
  normalized.find(row => row.id === 'persona').config = standard.find(row => row.id === 'persona').config
  assert.deepEqual(normalized, standard)
  assert.ok(!flatten(product).some(row => /@local\/dsh-github|dsh-(tool-cordis|cordis-runtime)/.test(row.name)), 'GitHub stays host-global, with no duplicated tools or elevated Cordis access')
  assert.equal(await readFile(join(presetRoot, presetId, 'LICENSE.standard'), 'utf8'), await readFile(join(dirname(SHIPPED_PRESET_ROOT), 'LICENSE'), 'utf8'))
})

test('real Standard and Product standing mounts share eighteen global GitHub tools without any CLI or planning writes', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  await mkdir(join(f.directory, '.git'))
  const setupPath = join(f.directory, '.agents/skills/repository-setup/SKILL.md')
  await mkdir(dirname(setupPath), { recursive: true })
  await cp(join(repo, '.agents/skills/repository-setup/SKILL.md'), setupPath)
  const { ctx, subprocessCalls } = await host(t, f, rosterConfig(f.baseUrl, await recipePatches()))
  const before = await snapshot(f.directory)
  const roster = ctx.get('agentPresets')
  const standard = await roster.standingKeyFor('standard')
  const product = await roster.standingKeyFor(presetId)
  assert.notEqual(product, standard)
  assert.equal(await roster.standingKeyFor(presetId), product)
  const names = scope => [...ctx.get('tools').view(scope).visible.keys()].sort()
  assert.deepEqual(names(), githubNames)
  assert.deepEqual(names(product), names(standard))
  assert.ok(names(product).length > 38)
  for (const scope of [undefined, standard, product]) {
    assert.deepEqual(names(scope).filter(name => name.startsWith('github_')), githubNames)
    for (const name of githubNames) assert.equal(ctx.get('tools').get(name, scope), ctx.get('tools').get(name))
  }
  for (const name of ['planMode', 'compaction', 'toolResultPruner', 'workflowEngine', 'productMode', 'planningDrafts']) assert.equal(ctx.get(name), undefined)
  const skills = ctx.get('skills')
  const options = { scope: product, cwd: f.directory }
  const catalog = await skills.list(options)
  const summary = catalog.find(skill => skill.name === skillName)
  assert.ok(summary)
  assert.equal(summary.content, undefined, 'catalog exposes summary; body loads only on request')
  const loaded = await skills.get(skillName, options)
  assert.equal(loaded.source, 'bundled')
  assert.equal(loaded.resourceBase.path, join(f.packaged, 'presets/product-mode/skills/product-planning'))
  assert.ok(loaded.content.includes('github_create_project'))
  assert.equal(await skills.get(skillName, { scope: standard, cwd: f.directory }), undefined)
  assert.equal(await skills.get(skillName, { cwd: f.directory }), undefined)
  for (const scope of [standard, product]) {
    const setup = await skills.get('repository-setup', { scope, cwd: f.directory })
    assert.equal(setup.source, 'project-agents')
    assert.equal(setup.path, setupPath)
  }
  assert.deepEqual(subprocessCalls, [])
  assert.deepEqual(await snapshot(f.directory), before, 'mounting and skill reads create no drafts, schemas, issues or state files')
})

test('copied Product preset resolves its bundled skill without the original package', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  const userRoot = join(f.directory, 'user-presets')
  await mkdir(userRoot)
  const { ctx, subprocessCalls } = await host(t, f, { ...rosterConfig(f.baseUrl), roots: [...rosterConfig(f.baseUrl).roots, { path: userRoot, trust: 'user' }] })
  const roster = ctx.get('agentPresets')
  await roster.copy(presetId, 'my-product', 'My Product mode')
  const own = await roster.resolve('my-product')
  assert.equal(own.trust, 'user')
  assert.equal(own.path, join(userRoot, 'my-product/agent.cordis.yml'))
  await rm(f.packaged, { recursive: true })
  const before = await snapshot(f.directory)
  const key = await roster.standingKeyFor('my-product')
  const loaded = await ctx.get('skills').get(skillName, { scope: key, cwd: f.directory })
  assert.equal(loaded.resourceBase.path, join(userRoot, 'my-product/skills/product-planning'))
  assert.ok(loaded.content.includes('github_create_project'))
  assert.equal(await readFile(join(loaded.resourceBase.path, 'LICENSE.matt-pocock'), 'utf8'), await readFile(join(presetRoot, presetId, 'skills/product-planning/LICENSE.matt-pocock'), 'utf8'))
  assert.equal(await readFile(join(userRoot, 'my-product/LICENSE.standard'), 'utf8'), await readFile(join(dirname(SHIPPED_PRESET_ROOT), 'LICENSE'), 'utf8'))
  assert.deepEqual(subprocessCalls, [])
  assert.deepEqual(await snapshot(f.directory), before)
})

test('saved default IDs survive and packaged Product ID has documented precedence over a user collision', async t => {
  const f = await fixture(t)
  const root = join(f.directory, 'user-presets')
  await mkdir(join(root, presetId), { recursive: true })
  await writeFile(join(root, presetId, 'agent.cordis.yml'), '- name: node:path\n')
  const path = join(f.directory, 'settings.yaml')
  const saved = '# Retain the selected preset.\nagent-presets:\n  default: minimal\n'
  await writeFile(path, saved)
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.baseUrl = f.baseUrl
  const { default: Projections } = await installed('@deepseek-ai/dsh-session-projection')
  const { default: Settings } = await installed('@deepseek-ai/dsh-settings-file')
  for (const Plugin of [Loader, Projections]) await ctx.plugin(Plugin, {}).await()
  await ctx.plugin(Settings, { path, watch: false }).await()
  await ctx.plugin(AgentPresets, { ...rosterConfig(f.baseUrl), roots: [...rosterConfig(f.baseUrl).roots, { path: root, trust: 'user' }], includeUserRoot: false }).await()
  const roster = ctx.get('agentPresets')
  assert.equal(roster.defaultId, 'minimal')
  assert.equal((await roster.resolve()).id, 'minimal')
  assert.equal((await roster.resolve(presetId)).trust, 'system')
  assert.equal(await readFile(path, 'utf8'), saved)
  const readme = await readFile(join(packageRoot, 'README.md'), 'utf8')
  assert.match(readme, /collision/i)
  assert.match(readme, /saved.*(?:ID|preset)|(?:ID|preset).*saved/i)
})
