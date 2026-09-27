import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

// Exact target implementations, dormant services and disposable deployment only.
const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = (name) => import(pathToFileURL(cli.resolve(name)).href)
const { Context } = await installed('@deepseek-ai/cordis')
const { default: Loader, interpolate } = await installed('@deepseek-ai/cordis-plugin-loader')
const { entryListSchema } = await installed('@deepseek-ai/cordis-plugin-include')
const { default: yaml } = await installed('js-yaml')
const { loadOverlayPatches, composeEntries } = await installed('@deepseek-ai/dsh-app-boot')
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const webRoot = dirname(cli.resolve('@deepseek-ai/dsh-web-app/package.json'))
const presetId = 'worktree-coordinator'
const ownPatch = join(packageRoot, 'cordis.patch.yml')
const parse = (text) => yaml.load(text, { schema: entryListSchema })
const flatten = (rows) => rows.flatMap((row) => [row, ...(row.group ? flatten(row.config) : [])])
const declaration = () =>
  composeEntries([loadOverlayPatches('worktree-test', ownPatch)]).find(
    (row) => row.config?.id === presetId,
  )
const standard = () =>
  composeEntries([
    loadOverlayPatches('worktree-test', join(webRoot, 'presets/standard.patch.yml')),
  ]).find((row) => row.config?.id === 'standard')

async function profile(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-worktree-preset-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'node_modules', '@local'), { recursive: true })
  await symlink(packageRoot, join(directory, 'node_modules', '@local', 'dsh-worktree'), 'dir')
  await mkdir(join(directory, 'node_modules', '@deepseek-ai'))
  const names = new Set([
    '@deepseek-ai/dsh-agent-preset-registry',
    '@deepseek-ai/dsh-agent-preset',
    ...flatten(standard().config.plugins)
      .map((row) => row.name)
      .filter((name) => name.startsWith('@deepseek-ai/')),
  ])
  for (const name of names) {
    const packageName = name.split('/').slice(0, 2).join('/')
    const destination = join(directory, 'node_modules', packageName)
    try {
      await symlink(dirname(cli.resolve(`${packageName}/package.json`)), destination, 'dir')
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  return { directory, baseUrl: pathToFileURL(`${directory}/`).href }
}

async function host(t, fixture) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.baseUrl = fixture.baseUrl
  await ctx.plugin(Loader, {}).await()
  const { default: Group } = await installed('@deepseek-ai/cordis-plugin-group')
  ctx.get('loader').builtins.group = Group
  for (const suffix of [
    'session',
    'agent',
    'session-projection',
    'system-prompt',
    'tools',
    'commands',
    'goal',
    'skill',
    'token-meter',
    'subprocess-local',
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
    const { default: Plugin } = await installed(`@deepseek-ai/dsh-${suffix}`)
    await ctx.plugin(Plugin, {}).await()
  }
  const { default: Worktree } = await import('../src/index.js')
  await ctx.plugin(Worktree, {}).await()
  await mount(ctx, {
    id: 'agent-preset-registry',
    name: '@deepseek-ai/dsh-agent-preset-registry',
    config: { default: 'standard' },
  })
  return ctx
}

async function mount(ctx, row) {
  const id = await ctx.get('loader').create(structuredClone(row))
  const entry = ctx.get('loader').resolve(id)
  await ctx.get('loader').await()
  assert.ok(
    entry.fiber,
    `Loader failed ${row.name}: ${entry.error?.stack ?? entry.error ?? 'no fiber'}`,
  )
  await entry.fiber.await()
  return entry
}

async function key(t, ctx, id) {
  const lease = await ctx.get('agentPresets').acquireScope(id)
  t.after(() => lease[Symbol.asyncDispose]())
  return lease.key
}

test('target-only declaration is additive and keeps stable identity and deployment default', async () => {
  assert.equal(
    JSON.parse(await readFile(cli.resolve('@deepseek-ai/dsh/package.json'), 'utf8')).version,
    '0.1.7-rc.2',
  )
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies['@deepseek-ai/dsh-agent-preset'], '0.1.7-rc.2')
  assert.equal(manifest.dependencies['@deepseek-ai/dsh-agent-presets'], undefined)
  assert.equal(
    await readFile(join(packageRoot, 'presets/worktree-coordinator/LICENSE.standard'), 'utf8'),
    await readFile(join(webRoot, 'LICENSE'), 'utf8'),
  )
  const web = JSON.parse(await readFile(join(webRoot, 'package.json'), 'utf8'))
  const warnings = []
  const rows = composeEntries(
    [
      ...[web.dsh.bundle.patch]
        .flat()
        .map((path) => loadOverlayPatches('test', join(webRoot, path))),
      loadOverlayPatches('test', ownPatch),
      loadOverlayPatches(
        'test',
        fileURLToPath(new URL('../../../profiles/personal-web/cordis.patch.yml', import.meta.url)),
      ),
    ],
    (warning) => warnings.push(warning),
  )
  assert.ok(!warnings.some((warning) => /preset/.test(warning)), warnings.join('\n'))
  assert.equal(rows.find((row) => row.id === 'agent-preset-registry').config.default, 'standard')
  assert.ok(!rows.some((row) => row.name === '@deepseek-ai/dsh-agent-presets'))
  for (const id of ['standard', 'ptc', 'minimal', 'cordis', presetId])
    assert.equal(rows.filter((row) => row.config?.id === id).length, 1)
  const own = declaration()
  assert.equal(own.id, 'local-preset-worktree-coordinator')
  assert.equal(own.name, '@deepseek-ai/dsh-agent-preset')
  assert.equal(own.config.name, 'Worktree coordinator')
  assert.ok(own.config.description)
})

test('exact target Standard baseline retains only intended coordinator customizations', () => {
  const baseline = standard().config.plugins
  const actual = declaration().config.plugins
  const normalized = structuredClone(actual).filter((row) => row.id !== 'local-worktree-tools')
  for (const id of ['persona', 'skill-filesystem', 'tool-jobs']) {
    const target = normalized.find((row) => row.id === id)
    const original = baseline.find((row) => row.id === id)
    if (original.config === undefined) delete target.config
    else target.config = structuredClone(original.config)
  }
  // Ralph remains deliberately enabled with the existing maxRounds: 64 budget.
  const ralph = flatten(normalized).find((row) => row.id === 'tool-ralph')
  assert.equal(ralph.disabled, undefined)
  assert.equal(ralph.config.maxRounds, 64)
  ralph.disabled = true
  assert.deepEqual(normalized, baseline)
  assert.deepEqual(actual.find((row) => row.id === 'tool-jobs').config, {
    completionDelivery: 'wakeup',
    maxConsecutiveWakes: 10,
  })
  assert.ok(!flatten(actual).some((row) => row.name.includes('tool-cordis')))
  const persona = actual.find((row) => row.id === 'persona').config
  assert.equal(persona.core, undefined)
  assert.equal(persona.text, undefined)
  for (const text of [
    'Your working directory is {{cwd}}.',
    'Finish independent coordination work first',
    'When only background workers remain, END your turn',
    'Do not use job_output(wait: true) merely to supervise workers',
    'Do not create an automatic goal solely for worker supervision',
    'Claiming a human user message from the inbox resets the wake budget',
    'cordis-plugin-development',
    'editing-cordis-compositions',
    'not grants of Creator runtime tools or broader permissions',
    'workflow apply only to dynamic plugins',
    'rather than bypassing restrictions or blocking static repository work',
  ])
    assert.ok(persona.suffix.includes(text), text)
})

test(
  'actual Loader declarations mount Standard and coordinator with isolated skills and host tools',
  { timeout: 20000 },
  async (t) => {
    const f = await profile(t)
    const ctx = await host(t, f)
    await mount(ctx, standard())
    const entry = await mount(ctx, declaration())
    const registry = ctx.get('agentPresets')
    assert.equal(
      registry.defaultId,
      'standard',
      'Loader creates the real volatile selectedDefault field',
    )
    const roster = await registry.list()
    assert.deepEqual(
      roster.map((row) => row.id),
      ['standard', presetId],
    )
    for (const row of roster) assert.equal(row.broken, undefined, row.broken)
    const standardKey = await key(t, ctx, 'standard')
    const coordinatorLease = await registry.acquireScope(presetId)
    t.after(() => coordinatorLease[Symbol.asyncDispose]())
    const coordinator = coordinatorLease.key
    const names = (scope) => [...ctx.get('tools').view(scope).visible.keys()].sort()
    assert.deepEqual(names(), ['worktree_create', 'worktree_dispatch', 'worktree_list'])
    assert.deepEqual(names(coordinator), [...names(standardKey), 'ralph'].sort())
    for (const name of names())
      assert.equal(ctx.get('tools').get(name, coordinator), ctx.get('tools').get(name))
    for (const service of ['planMode', 'compaction', 'toolResultPruner', 'workflowEngine'])
      assert.equal(ctx.get(service), undefined)
    const skills = ctx.get('skills')
    for (const name of [
      'cordis-plugin-development',
      'editing-cordis-compositions',
      'cordis-composition-reference',
    ]) {
      const loaded = await skills.get(name, { scope: coordinator, cwd: f.directory })
      assert.ok(loaded?.content, name)
      assert.ok(loaded.path.includes('/dsh-agent-preset/skills/'))
      assert.equal(await skills.get(name, { scope: standardKey, cwd: f.directory }), undefined)
    }
    assert.deepEqual(await skills.list({ cwd: f.directory }), [])
    const read = await registry.readDocument(presetId)
    assert.deepEqual(
      parse(read.content),
      declaration().config.plugins,
      'child expressions survive declaration loading',
    )
    // Removing the declaration prevents new bindings while a held lease remains usable.
    await entry.fiber.dispose()
    await assert.rejects(registry.resolve(presetId), /Unknown agent preset/)
    assert.ok(
      await skills.get('cordis-plugin-development', { scope: coordinator, cwd: f.directory }),
    )
    await coordinatorLease[Symbol.asyncDispose]()
    assert.equal(
      await skills.get('cordis-plugin-development', { scope: coordinator, cwd: f.directory }),
      undefined,
    )
    assert.ok(names().includes('worktree_dispatch'), 'retiring the preset cannot remove host tools')
  },
)

test('Creator skill expressions use the package dependency and fail closed outside deployment', async (t) => {
  const f = await profile(t)
  const row = declaration().config.plugins.find((row) => row.id === 'skill-filesystem')
  const local = createRequire(join(packageRoot, 'package.json'))
  const root = join(dirname(local.resolve('@deepseek-ai/dsh-agent-preset/package.json')), 'skills')
  const ctx = new Context()
  ctx.baseUrl = f.baseUrl
  t.after(() => ctx.fiber.dispose())
  assert.deepEqual(interpolate(ctx.extend({ baseUrl: 'file:///unrelated/' }), row.config), {
    customSkillDirs: [root],
  })
  assert.throws(
    () => interpolate({ root: { baseUrl: 'file:///missing-deployment/' } }, row.config),
    /Cannot find module.*dsh-worktree/s,
  )
})

test(
  'Loader retains selectedDefault across declaration installation and rejects duplicate preset IDs',
  { timeout: 20000 },
  async (t) => {
    const f = await profile(t)
    const ctx = await host(t, f)
    await mount(ctx, standard())
    const registry = ctx.get('agentPresets')
    const entry = ctx.get('loader').resolve('agent-preset-registry')
    await entry.update({ config: { default: 'standard', selectedDefault: presetId } })
    await entry.fiber.await()
    await mount(ctx, declaration())
    assert.equal(registry.defaultId, presetId)
    assert.equal((await registry.resolve()).id, presetId)
    await assert.rejects(registry.register({ id: presetId, plugins: [] }), /Duplicate agent preset/)
    assert.equal((await registry.list()).filter((row) => row.id === presetId).length, 1)
  },
)
