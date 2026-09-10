import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'

// Exercise the pinned repository CLI's actual implementations. No dependency
// installation, real profile boot, user preset writes, or GUI mutation occurs.
const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = name => import(pathToFileURL(cli.resolve(name)).href)
const { loadOverlayPatches, composeEntries } = await installed('@deepseek-ai/dsh-app-boot')
const { default: Loader, interpolate } = await installed('@deepseek-ai/cordis-plugin-loader')
const { entryListSchema } = await installed('@deepseek-ai/cordis-plugin-include')
const { default: AgentPresets, discoverPresets, SHIPPED_PRESET_ROOT } = await installed('@deepseek-ai/dsh-agent-presets')
const { default: yaml } = await installed('js-yaml')
const { default: FileSettingsProvider } = await installed('@deepseek-ai/dsh-settings-file')
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const presetRoot = join(packageRoot, 'presets')
const presetId = 'worktree-coordinator'
const compositionFile = join(presetRoot, presetId, 'agent.cordis.yml')
const webPatch = join(dirname(cli.resolve('@deepseek-ai/dsh-web-app/package.json')), 'cordis.patch.yml')
const ownPatch = join(packageRoot, 'cordis.patch.yml')
const parse = text => yaml.load(text, { schema: entryListSchema })
const flatten = rows => rows.flatMap(row => [row, ...(row.group && Array.isArray(row.config) ? flatten(row.config) : [])])

async function profile(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-worktree-preset-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'node_modules', '@local'), { recursive: true })
  await symlink(packageRoot, join(directory, 'node_modules', '@local', 'dsh-worktree'), 'dir')
  // The CLI's own dependency scope supplies its stock preset plugin packages.
  await symlink(dirname(dirname(cli.resolve('@deepseek-ai/dsh/package.json'))), join(directory, 'node_modules', '@deepseek-ai'), 'dir')
  return { directory, baseUrl: pathToFileURL(`${directory}/`).href }
}

function patchedRoster() {
  const warnings = []
  const rows = composeEntries([
    loadOverlayPatches('preset-test', webPatch),
    loadOverlayPatches('preset-test', ownPatch),
  ], warning => warnings.push(warning))
  // Web patches also disable optional Base rows, which are absent in this
  // intentionally small fixture. The roster patch itself must never miss.
  assert.ok(!warnings.some(warning => warning.includes('agent-presets')), warnings.join('\n'))
  return flatten(rows).find(row => row.id === 'agent-presets')
}

test('bundle registers its packaged preset root and keeps the stock default', async t => {
  const { baseUrl } = await profile(t)
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(manifest.files.includes('presets'))
  assert.ok(manifest.exports['./package.json'], 'path expression needs the package.json export')
  const row = patchedRoster()
  assert.equal(row.name, '@deepseek-ai/dsh-agent-presets')
  const config = interpolate({ baseUrl }, row.config)
  assert.equal(config.default, 'standard')
  assert.equal(config.includeShippedRoot ?? true, true)
  assert.equal(config.includeUserRoot ?? true, true)
  const packaged = config.roots.find(root => root.trust === 'system' && root.path.endsWith('/presets'))
  assert.ok(packaged)
  const roster = await discoverPresets([{ path: SHIPPED_PRESET_ROOT, trust: 'system' }, ...config.roots], baseUrl)
  for (const id of ['standard', 'minimal', 'cordis', presetId]) {
    const preset = roster.find(item => item.id === id)
    assert.ok(preset, `missing ${id}`)
    assert.equal(preset.broken, undefined, `${id}: ${preset.broken}`)
    assert.equal(preset.trust, 'system')
  }
  const own = roster.find(item => item.id === presetId)
  assert.ok(own.name && own.description, 'publish picker metadata')
  assert.equal(await readFile(own.path, 'utf8'), await readFile(compositionFile, 'utf8'))
})

test('coordinator retains every Standard row and only adds its tool contribution', async () => {
  const standard = parse(await readFile(join(SHIPPED_PRESET_ROOT, 'standard', 'agent.cordis.yml'), 'utf8'))
  const coordinator = parse(await readFile(compositionFile, 'utf8'))
  const baseline = flatten(standard)
  const actual = flatten(coordinator)
  assert.equal(actual.length, baseline.length + 1)
  for (const original of baseline) {
    const copied = actual.find(row => row.id === original.id)
    assert.ok(copied, `missing Standard row ${original.id}`)
    assert.equal(copied.name, original.name)
    assert.deepEqual(copied.disabled, original.disabled, `${original.id} enablement changed`)
    assert.deepEqual(copied.isolate, original.isolate, `${original.id} realm changed`)
    // Only guidance, the official skill root, and bounded job wakes differ.
    if (original.id === 'tool-jobs') assert.deepEqual(copied.config, {
      ...original.config, completionDelivery: 'wakeup', maxConsecutiveWakes: 10,
    })
    else if (!original.group && !['persona', 'skill-filesystem'].includes(original.id)) assert.deepEqual(copied.config, original.config, `${original.id} config changed`)
  }
  const tools = actual.filter(row => row.name === '@local/dsh-worktree/tools')
  assert.equal(tools.length, 1)
  assert.equal(tools[0].disabled, undefined)
  assert.ok(!actual.some(row => row.name === '@local/dsh-worktree'), 'shared service belongs in host, not preset')
  const normalized = structuredClone(coordinator).filter(row => row.name !== '@local/dsh-worktree/tools')
  normalized.find(row => row.id === 'persona').config = structuredClone(standard.find(row => row.id === 'persona').config)
  const skillConfig = standard.find(row => row.id === 'skill-filesystem').config
  if (skillConfig === undefined) delete normalized.find(row => row.id === 'skill-filesystem').config
  else normalized.find(row => row.id === 'skill-filesystem').config = structuredClone(skillConfig)
  const jobsConfig = standard.find(row => row.id === 'tool-jobs').config
  if (jobsConfig === undefined) delete normalized.find(row => row.id === 'tool-jobs').config
  else normalized.find(row => row.id === 'tool-jobs').config = structuredClone(jobsConfig)
  assert.deepEqual(normalized, standard, 'preserve exact Standard nesting and consumer realms')
  assert.ok(!actual.some(row => row.name.includes('tool-cordis')))
  const personaConfig = actual.find(row => row.id === 'persona').config
  assert.equal(personaConfig.text, undefined)
  assert.equal(personaConfig.core, undefined, 'retain the default DSH persona core')
  assert.equal(personaConfig.prefix, 'You are a coding agent powered by the {{model}} model.')
  const persona = personaConfig.suffix
  assert.ok(persona.includes('Your working directory is {{cwd}}.'))
  assert.match(persona, /Finish independent coordination work first/)
  assert.match(persona, /When only background workers remain, END your turn with a brief progress update/)
  assert.match(persona, /Yielding the turn is not reporting task completion/)
  assert.match(persona, /Do not use job_output\(wait: true\) merely to supervise workers; collect their results after completion notifications/)
  assert.match(persona, /Do not create an automatic goal solely for worker supervision/)
  assert.match(persona, /pending workers alone do not justify marking it complete or blocked/)
  assert.match(persona, /Claiming a human user message from the inbox resets the wake budget/)
  assert.match(persona, /completions remain queued rather than waking/)
  assert.match(persona, /plugin implementation or review, load the cordis-plugin-development skill/)
  assert.match(persona, /Before writing or changing a Cordis composition, load the editing-cordis-compositions skill/)
  assert.match(persona, /not grants of Creator runtime tools or broader permissions/)
  assert.match(persona, /execution rules .* and cordis_inspect_\*, cordis_define, and cordis_run workflow apply only to dynamic plugins/)
  assert.match(persona, /static packaged plugin development and review, use repository API contracts, imports, TypeScript\/JSX where supported, and normal build\/test workflows/)
  assert.match(persona, /rather than bypassing restrictions or blocking static repository work/)
})

test('Creator skills resolve from a relocated preset and load official bodies on demand', async t => {
  const { directory, baseUrl } = await profile(t)
  const rows = parse(await readFile(compositionFile, 'utf8'))
  // A normal user root is outside the deployment's dependency ancestry.
  const userRoot = await mkdtemp(join(tmpdir(), 'dsh-user-creator-'))
  t.after(() => rm(userRoot, { recursive: true, force: true }))
  const relocated = pathToFileURL(`${userRoot}/copied-coordinator/`).href
  assert.throws(() => createRequire(relocated).resolve('@deepseek-ai/dsh-agent-presets/package.json'), /Cannot find module/)
  const ctxBase = new Context()
  ctxBase.baseUrl = baseUrl
  t.after(() => ctxBase.fiber.dispose())
  const config = interpolate(ctxBase.extend({ baseUrl: relocated }), rows.find(row => row.id === 'skill-filesystem').config)
  const local = createRequire(join(packageRoot, 'package.json'))
  const officialRoot = join(dirname(local.resolve('@deepseek-ai/dsh-agent-presets/package.json')), 'presets/cordis/skills')
  assert.deepEqual(config, { customSkillDirs: [officialRoot] })
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies['@deepseek-ai/dsh-agent-presets'], '0.1.5-rc.1')
  const { FileSystemSkillProvider } = await installed('@deepseek-ai/dsh-skill-filesystem')
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const control = { signal: new AbortController().signal, invalidate() {} }
  const provider = new FileSystemSkillProvider(ctx, control, {
    ...config, includeDefaultRoots: false, watch: false,
  })
  t.after(() => provider.dispose())
  const catalog = await provider.list({ cwd: directory })
  for (const name of ['cordis-plugin-development', 'editing-cordis-compositions']) {
    const summary = catalog.find(skill => skill.name === name)
    assert.ok(summary, `installed Creator skill layout incompatible: missing ${name}`)
    assert.equal(summary.content, undefined, 'catalog must not inject the full body')
    assert.ok(summary.description)
    assert.equal(summary.invocation.modelInvocable, true)
    assert.equal(summary.path, join(officialRoot, name, 'SKILL.md'))
    const loaded = await provider.get(summary, {})
    const raw = await readFile(summary.path, 'utf8')
    assert.equal(loaded.content, raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim())
    assert.equal(loaded.resourceBase.path, join(officialRoot, name))
  }
  const absent = new FileSystemSkillProvider(ctx, control, {
    customSkillDirs: [join(directory, 'missing-skills')], includeDefaultRoots: false, watch: false,
  })
  t.after(() => absent.dispose())
  assert.deepEqual(await absent.list({}), [], 'upstream omits absent skill directories')
})

test('missing deployment bundle fails interpolation instead of using a machine path', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-no-creator-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const rows = parse(await readFile(compositionFile, 'utf8'))
  assert.throws(() => interpolate({ root: { baseUrl: pathToFileURL(`${directory}/`).href } },
    rows.find(row => row.id === 'skill-filesystem').config), /Cannot find module.*dsh-worktree/s)
})

test('package root wins a colliding user preset id', async t => {
  const { directory, baseUrl } = await profile(t)
  const userRoot = join(directory, 'user-presets')
  await mkdir(join(userRoot, presetId), { recursive: true })
  await writeFile(join(userRoot, presetId, 'agent.cordis.yml'), '- name: node:path\n')
  await writeFile(join(userRoot, presetId, 'preset.yml'), 'name: User collision\n')
  const roster = await discoverPresets([
    { path: SHIPPED_PRESET_ROOT, trust: 'system' },
    { path: presetRoot, trust: 'system' },
    { path: userRoot, trust: 'user' },
  ], baseUrl)
  const own = roster.filter(row => row.id === presetId)
  assert.equal(own.length, 1)
  assert.equal(own[0].trust, 'system')
  assert.equal(own[0].path, compositionFile)
  assert.notEqual(own[0].name, 'User collision')
})

test('saved user default overrides bundle default without rewriting settings', async t => {
  const { directory, baseUrl } = await profile(t)
  const path = join(directory, 'settings.yaml')
  const saved = '# User preference must survive bundle installation.\nagent-presets:\n  default: minimal\n'
  await writeFile(path, saved)
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.baseUrl = baseUrl
  for (const Plugin of [Loader, SessionProjections]) await ctx.plugin(Plugin, {}).await()
  await ctx.plugin(FileSettingsProvider, { path, watch: false }).await()
  await ctx.plugin(AgentPresets, {
    ...interpolate({ baseUrl }, patchedRoster().config), includeUserRoot: false,
  }).await()
  const roster = ctx.get('agentPresets')
  assert.equal(roster.config.default, 'standard')
  assert.equal(roster.defaultId, 'minimal')
  assert.equal((await roster.resolve()).id, 'minimal')
  assert.ok((await roster.list()).some(row => row.id === presetId))
  assert.equal(await readFile(path, 'utf8'), saved)
})

test('patch replacement and precedence remain explicit', () => {
  const base = [{ id: 'agent-presets', name: '@deepseek-ai/dsh-agent-presets', config: { default: 'standard', roots: [] } }]
  const rootsOnly = composeEntries([[{ insert: base }], [{ id: 'agent-presets', config: { roots: [] } }]])
  assert.equal(rootsOnly[0].config.default, undefined, 'Cordis replaces config; it does not merge roots')
  const override = { default: 'minimal', roots: [{ path: '/deployment-presets', trust: 'system' }] }
  const rows = composeEntries([
    loadOverlayPatches('preset-test', webPatch),
    loadOverlayPatches('preset-test', ownPatch),
    [{ id: 'agent-presets', config: override }],
  ])
  assert.deepEqual(flatten(rows).find(row => row.id === 'agent-presets').config, override)
  const customBeforeBundle = composeEntries([
    loadOverlayPatches('preset-test', webPatch),
    [{ id: 'agent-presets', config: override }],
    loadOverlayPatches('preset-test', ownPatch),
  ])
  const replaced = flatten(customBeforeBundle).find(row => row.id === 'agent-presets').config
  assert.equal(replaced.default, 'standard')
  assert.ok(!replaced.roots.some(root => root.path === '/deployment-presets'), 'bundle cannot append to earlier custom roots')
})

test('full Standard and coordinator standing mounts coexist on an isolated host', { timeout: 15000 }, async t => {
  const { directory, baseUrl } = await profile(t)
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.baseUrl = baseUrl
  await ctx.plugin(Loader, {}).await()
  // dsh-app-boot installs this same public Loader builtin for cordis:group.
  const { default: Group } = await installed('@deepseek-ai/cordis-plugin-group')
  ctx.get('loader').builtins.group = Group
  // Real dormant host services, with no AgentLoop/model adapter, transport,
  // credentials, telemetry, persistence backend, or tool execution. File and
  // subprocess backends are present for dependency validation, never invoked.
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
  await ctx.plugin(SandboxPolicy, { mode: 'read-only', workspaceRoot: directory }).await()
  const { default: WorktreeService } = await import('../src/index.js')
  await ctx.plugin(WorktreeService, {}).await()
  const manager = ctx.get('worktreeWorkers')
  const userRoot = await mkdtemp(join(tmpdir(), 'dsh-user-mount-'))
  t.after(() => rm(userRoot, { recursive: true, force: true }))
  assert.throws(() => createRequire(pathToFileURL(`${userRoot}/`)).resolve('@local/dsh-worktree/package.json'), /Cannot find module/)
  await ctx.plugin(AgentPresets, {
    default: 'standard', roots: [{ path: presetRoot, trust: 'system' }, { path: userRoot, trust: 'user' }],
    includeShippedRoot: true, includeUserRoot: false,
  }).await()
  const roster = ctx.get('agentPresets')
  await roster.copy(presetId, 'copied-coordinator')
  const copied = await roster.resolve('copied-coordinator')
  assert.equal(copied.path, join(userRoot, 'copied-coordinator', 'agent.cordis.yml'))
  assert.equal(await readFile(copied.path, 'utf8'), await readFile(compositionFile, 'utf8'))
  const standard = await roster.standingKeyFor('standard')
  const coordinator = await roster.standingKeyFor(presetId)
  const copiedKey = await roster.standingKeyFor('copied-coordinator')
  assert.deepEqual([...ctx.get('tools').view(copiedKey).visible.keys()].sort(), [...ctx.get('tools').view(coordinator).visible.keys()].sort())
  for (const name of ['cordis-plugin-development', 'editing-cordis-compositions']) {
    assert.ok((await ctx.get('skills').get(name, { scope: copiedKey, cwd: directory })).content)
  }
  assert.notEqual(standard, coordinator)
  const standardNames = [...ctx.get('tools').view(standard).visible.keys()].sort()
  const coordinatorNames = [...ctx.get('tools').view(coordinator).visible.keys()].sort()
  assert.ok(standardNames.length > 20)
  assert.deepEqual(coordinatorNames, [...standardNames, 'worktree_create', 'worktree_dispatch', 'worktree_list'].sort())
  assert.deepEqual([...ctx.get('tools').view().visible.keys()], [])
  const skills = ctx.get('skills')
  const catalog = await skills.list({ scope: coordinator, cwd: directory })
  for (const name of ['cordis-plugin-development', 'editing-cordis-compositions']) {
    assert.ok(catalog.some(skill => skill.name === name), `missing scoped skill ${name}`)
    assert.ok((await skills.get(name, { scope: coordinator, cwd: directory })).content)
  }
  assert.deepEqual(await skills.list({ cwd: directory }), [], 'skills must not leak into the host scope')
  assert.equal(typeof manager.create, 'function')
  assert.equal(typeof ctx.get('worktreeWorkers').dispatch, 'function')
  for (const service of ['planMode', 'compaction', 'toolResultPruner', 'workflowEngine']) {
    assert.equal(ctx.get(service), undefined, `${service} must stay behind its preset realm`)
  }
})

test('actual standing mount scopes the added tools without publishing a service', async t => {
  const { directory, baseUrl } = await profile(t)
  // Mount the exact added tool row, not a fake plugin. Standard's whole host
  // dependency graph is outside this bounded fixture; baseline parity and full
  // composition discovery are tested above, not claimed as a full Web boot.
  const coordinator = parse(await readFile(compositionFile, 'utf8'))
  const toolsRow = flatten(coordinator).find(row => row.name === '@local/dsh-worktree/tools')
  const root = join(directory, 'fixture-presets')
  await mkdir(join(root, 'tool-contribution'), { recursive: true })
  await writeFile(join(root, 'tool-contribution', 'agent.cordis.yml'), yaml.dump([toolsRow]))
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.baseUrl = baseUrl
  for (const Plugin of [Loader, SessionProjections, SystemPrompt, Tools]) await ctx.plugin(Plugin, {}).await()
  // The tool plugin consumes the host registry but does not call it at mount.
  const manager = {}
  ctx.provide('worktreeWorkers', manager)
  await ctx.plugin(AgentPresets, {
    default: 'tool-contribution', roots: [{ path: root, trust: 'system' }],
    includeShippedRoot: false, includeUserRoot: false,
  }).await()
  const roster = ctx.get('agentPresets')
  const key = await roster.standingKeyFor('tool-contribution')
  assert.equal(await roster.standingKeyFor('tool-contribution'), key, 'standing composition is reused')
  assert.deepEqual([...ctx.get('tools').view(key).visible.keys()].sort(), ['worktree_create', 'worktree_dispatch', 'worktree_list'])
  assert.deepEqual([...ctx.get('tools').view().visible.keys()], [], 'tools must not leak into the host scope')
  assert.equal(ctx.get('worktreeWorkers'), manager, 'preset must not replace the host provider')
})
