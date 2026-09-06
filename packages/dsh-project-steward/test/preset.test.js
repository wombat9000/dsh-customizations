import assert from 'node:assert/strict'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

// Use the repository's exact-pinned official CLI dependency graph. No install,
// real profile, model, network, user-home writes, or tool execution is needed.
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
const presetId = 'project-steward'
const presetRoot = join(packageRoot, 'presets')
const composition = join(presetRoot, presetId, 'agent.cordis.yml')
const webPatch = join(dirname(cli.resolve('@deepseek-ai/dsh-web-app/package.json')), 'cordis.patch.yml')
const parse = text => yaml.load(text, { schema: entryListSchema })
const flatten = rows => rows.flatMap(row => [row, ...(row.group ? flatten(row.config) : [])])
const json = async path => JSON.parse(await readFile(path, 'utf8'))

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'project-steward-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const local = join(directory, 'node_modules', '@local')
  await mkdir(local, { recursive: true })
  // Simulate package publication: only manifest.files and package.json travel.
  const packaged = join(local, 'dsh-project-steward')
  await mkdir(packaged)
  const manifest = await json(join(packageRoot, 'package.json'))
  for (const file of ['package.json', ...manifest.files]) {
    await cp(join(packageRoot, file), join(packaged, file), { recursive: true })
  }
  await symlink(join(repo, 'packages/dsh-worktree'), join(local, 'dsh-worktree'), 'dir')
  await symlink(dirname(dirname(cli.resolve('@deepseek-ai/dsh/package.json'))), join(directory, 'node_modules', '@deepseek-ai'), 'dir')
  return { directory, packaged, baseUrl: pathToFileURL(`${directory}/`).href }
}

async function recipePatches() {
  const recipeDirectory = join(repo, 'profiles/personal-web')
  const recipe = await json(join(recipeDirectory, 'recipe.json'))
  const names = recipe.bundles.map(bundle => bundle.name)
  // The final profile override can mask bundle-order mistakes in the roster.
  // Check the required precedence separately from the composed result.
  const ordered = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@local/dsh-worktree', '@local/dsh-project-steward']
  for (const name of ordered) assert.equal(names.filter(value => value === name).length, 1)
  for (let index = 1; index < ordered.length; index++) {
    assert.ok(names.indexOf(ordered[index - 1]) < names.indexOf(ordered[index]), `${ordered[index - 1]} must precede ${ordered[index]}`)
  }
  const patches = []
  for (const bundle of recipe.bundles) {
    const manifestPath = bundle.source.startsWith('.')
      ? resolve(recipeDirectory, bundle.source, 'package.json')
      : cli.resolve(`${bundle.source}/package.json`)
    const manifest = await json(manifestPath)
    assert.equal(manifest.name, bundle.name)
    assert.equal(typeof manifest.dsh?.bundle?.patch, 'string')
    patches.push(resolve(dirname(manifestPath), manifest.dsh.bundle.patch))
  }
  assert.equal(typeof recipe.patch, 'string', 'personal-web must retain its final profile override')
  patches.push(resolve(recipeDirectory, recipe.patch))
  return patches
}

function rosterConfig(baseUrl, patches = [webPatch, join(packageRoot, 'cordis.patch.yml')]) {
  const warnings = []
  const rows = composeEntries(patches.map(path => loadOverlayPatches('steward-test', path)), warning => warnings.push(warning))
  assert.ok(!warnings.some(warning => warning.includes('agent-presets')), warnings.join('\n'))
  return interpolate({ baseUrl }, flatten(rows).find(row => row.id === 'agent-presets').config)
}

async function snapshot(directory) {
  const result = {}
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name)
    const stat = await lstat(path)
    result[name] = stat.isSymbolicLink() ? { link: await readlink(path) }
      : stat.isDirectory() ? await snapshot(path) : await readFile(path, 'utf8')
  }
  return result
}

async function host(t, fixture, config) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.baseUrl = fixture.baseUrl
  await ctx.plugin(Loader, {}).await()
  const { default: Group } = await installed('@deepseek-ai/cordis-plugin-group')
  ctx.get('loader').builtins.group = Group
  // Actual dormant host services. No AgentLoop, transport, credentials,
  // persistence, model adapter, or tools are executed by this fixture.
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
  await ctx.plugin(SandboxPolicy, { mode: 'read-only', workspaceRoot: fixture.directory }).await()
  await ctx.plugin(AgentPresets, { ...config, includeUserRoot: false }).await()
  return ctx
}

test('published files discover independently and personal-web retains both preset roots', async t => {
  const f = await fixture(t)
  const manifest = await json(join(f.packaged, 'package.json'))
  assert.equal(manifest.name, '@local/dsh-project-steward')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.exports['./package.json'], './package.json')
  assert.equal((await json(cli.resolve('@deepseek-ai/dsh/package.json'))).version, '0.1.2-rc.1')
  const lock = yaml.load(await readFile(join(repo, 'pnpm-lock.yaml'), 'utf8'))
  assert.deepEqual(lock.importers['packages/dsh-project-steward'], {}, 'dependency-free workspace importer stays explicit')
  assert.equal(manifest.dependencies, undefined, 'no new dependencies or runtime implementation')
  assert.equal(manifest.main, undefined)
  assert.deepEqual(Object.keys(manifest.scripts), ['test'], 'no startup or install hooks')
  for (const combined of [false, true]) {
    const config = rosterConfig(f.baseUrl, combined ? await recipePatches() : undefined)
    assert.equal(config.default, 'standard')
    assert.equal(config.includeShippedRoot ?? true, true)
    assert.equal(config.includeUserRoot ?? true, true)
    assert.equal(config.roots.length, combined ? 2 : 1)
    const roster = await discoverPresets([{ path: SHIPPED_PRESET_ROOT, trust: 'system' }, ...config.roots], f.baseUrl)
    for (const id of ['standard', 'minimal', 'cordis', presetId, ...(combined ? ['worktree-coordinator'] : [])]) {
      const row = roster.find(item => item.id === id)
      assert.ok(row, `missing ${id}`)
      assert.equal(row.broken, undefined)
      assert.equal(row.trust, 'system')
    }
    const own = roster.find(row => row.id === presetId)
    assert.equal(own.name, 'Project Steward')
    assert.ok(own.description)
    assert.equal(own.path, join(f.packaged, 'presets', presetId, 'agent.cordis.yml'))
  }
  const recipe = await json(join(repo, 'profiles/personal-web/recipe.json'))
  assert.equal(recipe.bundles.filter(row => row.name === manifest.name).length, 1)
  const source = recipe.bundles.find(row => row.name === manifest.name).source
  assert.equal(source, '../../packages/dsh-project-steward')
})

test('composition preserves exact Standard rows, configs, nesting, realms, and license', async () => {
  const standard = parse(await readFile(join(SHIPPED_PRESET_ROOT, 'standard/agent.cordis.yml'), 'utf8'))
  const steward = parse(await readFile(composition, 'utf8'))
  const extra = steward.filter(row => row.id === 'local-project-steward-skills')
  assert.equal(extra.length, 1)
  assert.equal(extra[0].name, '@deepseek-ai/dsh-skill-filesystem')
  assert.equal(extra[0].config.includeDefaultRoots, false)
  const normalized = steward.filter(row => row.id !== 'local-project-steward-skills')
  normalized.find(row => row.id === 'persona').config = standard.find(row => row.id === 'persona').config
  assert.deepEqual(normalized, standard)
  assert.ok(!flatten(steward).some(row => /dsh-(tool-cordis|cordis-runtime)|@local\/dsh-worktree/.test(row.name)))
  assert.equal(await readFile(join(presetRoot, presetId, 'LICENSE.standard'), 'utf8'), await readFile(join(dirname(SHIPPED_PRESET_ROOT), 'LICENSE'), 'utf8'))
})

test('actual Standard and Steward mounts coexist; catalog loads skills on demand without writes', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  await mkdir(join(f.directory, '.git'))
  const repoSkill = join(f.directory, '.agents/skills/repository-setup/SKILL.md')
  await mkdir(dirname(repoSkill), { recursive: true })
  await cp(join(repo, '.agents/skills/repository-setup/SKILL.md'), repoSkill)
  const ctx = await host(t, f, rosterConfig(f.baseUrl))
  const before = await snapshot(f.directory)
  const roster = ctx.get('agentPresets')
  const standard = await roster.standingKeyFor('standard')
  const steward = await roster.standingKeyFor(presetId)
  assert.notEqual(standard, steward)
  assert.equal(await roster.standingKeyFor(presetId), steward)
  const names = key => [...ctx.get('tools').view(key).visible.keys()].sort()
  assert.ok(names(standard).length > 20)
  assert.deepEqual(names(steward), names(standard))
  assert.deepEqual(names(), [])
  for (const service of ['planMode', 'compaction', 'toolResultPruner', 'workflowEngine']) assert.equal(ctx.get(service), undefined)
  const skills = ctx.get('skills')
  const options = { scope: steward, cwd: f.directory }
  const catalog = await skills.list(options)
  const summary = catalog.find(skill => skill.name === presetId)
  assert.ok(summary)
  assert.equal(summary.content, undefined, 'catalog must not inject the body')
  const loaded = await skills.get(presetId, options)
  assert.equal(loaded.source, 'bundled')
  assert.match(loaded.content, /## Inspect before proposing changes/)
  assert.equal(loaded.resourceBase.path, join(f.packaged, 'presets/project-steward/skills/project-steward'))
  assert.match(await readFile(join(loaded.resourceBase.path, 'templates/v1/AGENTS.md.template'), 'utf8'), /Draft template v1/)
  assert.equal(await skills.get(presetId, { scope: standard, cwd: f.directory }), undefined)
  assert.equal(await skills.get(presetId, { cwd: f.directory }), undefined)
  for (const scope of [standard, steward]) {
    const setup = await skills.get('repository-setup', { scope, cwd: f.directory })
    assert.equal(setup.source, 'project-agents', 'repo-owned guidance needs no Steward contribution')
    assert.equal(setup.path, repoSkill)
    assert.match(setup.content, /## Check safe prerequisites/)
  }
  assert.deepEqual(await snapshot(f.directory), before, 'discovery, mount, and reads must not mutate the fixture')
})

test('roster.copy mounts from a user root and resolves copied resources without the bundle', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  const userRoot = join(f.directory, 'user-presets')
  await mkdir(userRoot)
  const ctx = await host(t, f, { ...rosterConfig(f.baseUrl), roots: [...rosterConfig(f.baseUrl).roots, { path: userRoot, trust: 'user' }] })
  const roster = ctx.get('agentPresets')
  await roster.copy(presetId, 'my-steward', 'My Steward')
  const own = await roster.resolve('my-steward')
  assert.equal(own.trust, 'user')
  assert.equal(own.path, join(userRoot, 'my-steward/agent.cordis.yml'))
  await rm(f.packaged, { recursive: true })
  const before = await snapshot(f.directory)
  const key = await roster.standingKeyFor('my-steward')
  const loaded = await ctx.get('skills').get(presetId, { scope: key, cwd: f.directory })
  assert.equal(loaded.resourceBase.path, join(userRoot, 'my-steward/skills/project-steward'))
  assert.match(await readFile(join(loaded.resourceBase.path, 'templates/v1/repository-setup.SKILL.md.template'), 'utf8'), /unverified proposals/)
  assert.deepEqual(await snapshot(f.directory), before)
})

test('saved default survives and packaged IDs precede colliding user IDs', async t => {
  const f = await fixture(t)
  const root = join(f.directory, 'user-presets')
  await mkdir(join(root, presetId), { recursive: true })
  await writeFile(join(root, presetId, 'agent.cordis.yml'), '- name: node:path\n')
  const path = join(f.directory, 'settings.yaml')
  const saved = '# Keep user preference.\nagent-presets:\n  default: minimal\n'
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
})
