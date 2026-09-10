#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, copyFileSync, writeFileSync, mkdirSync, realpathSync, lstatSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`apply-profile: ${message}`)
  process.exit(1)
}

function usage() {
  console.log(`Usage: pnpm run apply -- <recipe> [options]

Arguments:
  recipe              A directory under profiles/ or a recipe.json path

Options:
  --profile <name>    Override the profile name from the recipe
  --dry-run           Print actions without changing the profile
  --force-patch       Replace a nonempty profile patch and save a .bak file
  --help              Show this help

Environment:
  DSH_BIN             Only this checkout's node_modules/.bin/dsh is supported (default)
  DSH_HOME            Harness home; defaults to ~/.dsh`)
}

function parseArguments(argv) {
  // pnpm forwards the documented script-argument separator.
  if (argv[0] === '--') argv = argv.slice(1)
  const result = {
    recipe: undefined,
    profile: undefined,
    dryRun: false,
    forcePatch: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') {
      usage()
      process.exit(0)
    }
    if (argument === '--dry-run') {
      result.dryRun = true
      continue
    }
    if (argument === '--force-patch') {
      result.forcePatch = true
      continue
    }
    if (argument === '--profile') {
      result.profile = argv[index + 1]
      if (!result.profile) fail('--profile requires a value')
      index += 1
      continue
    }
    if (argument.startsWith('-')) fail(`unknown option ${argument}`)
    if (result.recipe) fail('provide exactly one recipe')
    result.recipe = argument
  }

  if (!result.recipe) {
    usage()
    process.exit(1)
  }
  return result
}

function resolveRecipePath(input) {
  const directPath = resolve(input)
  if (existsSync(directPath)) {
    return directPath.endsWith('.json') ? directPath : join(directPath, 'recipe.json')
  }
  return join(repositoryRoot, 'profiles', input, 'recipe.json')
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`cannot read ${label} at ${path}: ${error.message}`)
  }
}

function validateRecipe(recipe, path) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    fail(`${path} must contain a JSON object`)
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(recipe.profile ?? '')) {
    fail(`${path} has an invalid profile name`)
  }
  if (!Array.isArray(recipe.bundles) || recipe.bundles.length === 0) {
    fail(`${path} must select at least one bundle`)
  }
  for (const [index, bundle] of recipe.bundles.entries()) {
    if (!bundle || typeof bundle.name !== 'string' || !bundle.name) {
      fail(`${path} bundle ${index + 1} requires a name`)
    }
    if (typeof bundle.source !== 'string' || !bundle.source) {
      fail(`${path} bundle ${index + 1} requires a source`)
    }
  }
  if (typeof recipe.patch !== 'string' || !recipe.patch) {
    fail(`${path} requires a patch path`)
  }
}

function isLocalSource(source) {
  return source.startsWith('.') || isAbsolute(source)
}

function resolveBundleSource(bundle, recipeDirectory) {
  if (!isLocalSource(bundle.source)) return bundle.source

  const source = resolve(recipeDirectory, bundle.source)
  const manifestPath = join(source, 'package.json')
  const manifest = readJson(manifestPath, `local package ${bundle.name}`)
  if (manifest.name !== bundle.name) {
    fail(`${manifestPath} is named ${JSON.stringify(manifest.name)}, expected ${JSON.stringify(bundle.name)}`)
  }
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string' || !existsSync(resolve(source, patch))) {
    fail(`${manifestPath} does not declare an existing dsh.bundle.patch`)
  }
  return source
}

function displayCommand(command, arguments_) {
  return [command, ...arguments_].map((part) => JSON.stringify(part)).join(' ')
}

function run(command, arguments_, { dryRun, capture = false }) {
  if (dryRun) {
    console.log(`Would run: ${displayCommand(command, arguments_)}`)
    return ''
  }

  const result = spawnSync(command, arguments_, {
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? 'pipe' : 'inherit',
    maxBuffer: 32 * 1024 * 1024,
  })

  if (result.error) fail(`cannot run ${command}: ${result.error.message}`)
  if (result.status !== 0) {
    if (capture) {
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
    fail(`${command} exited with status ${result.status}`)
  }
  return capture ? result.stdout : ''
}

function isEmptyPatch(content) {
  const meaningful = content
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+#.*$/u, '').trim())
    .filter((line) => line && !line.startsWith('#'))
    .join('')
  return meaningful === '' || meaningful === '[]'
}

function applyPatch({ source, target, dryRun, forcePatch }) {
  const desired = readFileSync(source, 'utf8')
  const current = existsSync(target) ? readFileSync(target, 'utf8') : undefined

  if (current === desired) {
    console.log(`Patch is current: ${target}`)
    return
  }

  if (current !== undefined && !isEmptyPatch(current) && !forcePatch) {
    fail(`refusing to replace nonempty patch ${target}; inspect it, then rerun with --force-patch`)
  }

  if (dryRun) {
    console.log(`Would write patch: ${source} -> ${target}`)
    if (current !== undefined && !isEmptyPatch(current)) {
      console.log(`Would save backup: ${target}.bak`)
    }
    return
  }

  if (current !== undefined && !isEmptyPatch(current)) copyFileSync(target, `${target}.bak`)
  writeFileSync(target, desired)
  console.log(`Wrote patch: ${target}`)
}

const options = parseArguments(process.argv.slice(2))
const recipePath = resolveRecipePath(options.recipe)
if (!existsSync(recipePath)) fail(`recipe not found: ${recipePath}`)

const recipeDirectory = dirname(recipePath)
const recipe = readJson(recipePath, 'profile recipe')
validateRecipe(recipe, recipePath)

const profile = options.profile ?? recipe.profile
if (!/^[a-z0-9][a-z0-9-]*$/.test(profile)) fail(`invalid target profile name ${JSON.stringify(profile)}`)

const version = '0.1.5-rc.1'
const coreName = '@deepseek-ai/dsh-client-connection'
const patchKey = `${coreName}@${version}`
const corePatchName = `dsh-client-connection-${version}-rpc-owner.patch`
const localDsh = join(repositoryRoot, 'node_modules', '.bin', 'dsh')
const dsh = process.env.DSH_BIN || localDsh
const dshHome = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'))
const profileDirectory = join(dshHome, 'profiles', profile)
const patchSource = resolve(recipeDirectory, recipe.patch)
if (!existsSync(patchSource)) fail(`recipe patch not found: ${patchSource}`)
const sources = recipe.bundles.map(bundle => {
  const source = resolveBundleSource(bundle, recipeDirectory)
  if (!bundle.name.startsWith('@deepseek-ai/dsh')) return source
  if (source !== bundle.name && source !== `${bundle.name}@${version}`) fail(`unsupported DSH bundle source ${source}; this migration requires ${version}`)
  return `${bundle.name}@${version}`
})
const targetPatch = join(profileDirectory, 'cordis.patch.yml')
// All read-only checks precede the first profile write or package-manager call.
applyPatch({ source: patchSource, target: targetPatch, dryRun: true, forcePatch: options.forcePatch })

function verifyCore(anchor) {
  const web = createRequire(anchor).resolve('@deepseek-ai/dsh-web-app')
  const core = createRequire(web).resolve(coreName)
  if (anchor === join(profileDirectory, 'package.json') &&
      (!web.startsWith(`${profileDirectory}/node_modules/`) || !core.startsWith(`${profileDirectory}/node_modules/`))) {
    fail('profile must resolve its own Web and patched Connection packages, not launcher or NODE_PATH fallbacks')
  }
  const manifest = readJson(join(dirname(core), '..', 'package.json'), coreName)
  const source = readFileSync(core, 'utf8')
  if (manifest.version !== version || !source.includes('const owner = getTraceable(this.ctx, this.ctx);') ||
      !/import \{[^}]*getTraceable[^}]*\} from "@deepseek-ai\/cordis"/.test(source)) {
    fail(`required ${patchKey} RPC-owner patch is missing; install the pinned patched graph before applying`)
  }
}

function assertOwnedPath(path) {
  // Do not mutate a profile or dependency tree redirected to another installation.
  for (let current = path; ; current = dirname(current)) {
    try {
      // existsSync follows symlinks and misses dangling links that writes follow.
      if (lstatSync(current).isSymbolicLink()) fail(`unsupported symlinked profile path: ${current}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (dirname(current) === current) break
  }
}

async function configureProfileDependencies() {
  const { parseDocument } = await import('yaml')
  const workspacePath = join(profileDirectory, 'pnpm-workspace.yaml')
  assertOwnedPath(profileDirectory)
  for (const name of ['node_modules', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'pnpm-workspace.yaml.bak', 'patches', 'cordis.patch.yml', 'cordis.patch.yml.bak']) {
    assertOwnedPath(join(profileDirectory, name))
  }
  const document = parseDocument(existsSync(workspacePath) ? readFileSync(workspacePath, 'utf8') : '{}')
  if (document.errors.length) fail(`cannot parse ${workspacePath}: ${document.errors[0].message}`)
  const config = document.toJS()
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail(`unsupported workspace configuration: ${workspacePath}`)
  const destination = `patches/${corePatchName}`
  const existing = config.patchedDependencies?.[patchKey]
  if (existing && existing !== destination) fail(`conflicting ${patchKey} patch in ${workspacePath}; reconcile it manually`)
  if (config.allowUnusedPatches === true || config.ignorePatchFailures === true) fail('profile must not ignore patch failures or allow unused patches')
  const repositoryConfig = parseDocument(readFileSync(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')).toJS()
  const targetPackages = repositoryConfig.minimumReleaseAgeExclude.filter(spec => spec.startsWith('@deepseek-ai/dsh') && spec.endsWith(`@${version}`))
  for (const spec of targetPackages) {
    const name = spec.slice(0, -version.length - 1)
    if (config.overrides?.[name] && config.overrides[name] !== version) fail(`conflicting profile override for ${name}; reconcile it manually`)
    document.setIn(['overrides', name], version)
  }
  document.set('minimumReleaseAgeExclude', [...new Set([...(config.minimumReleaseAgeExclude ?? []), ...targetPackages])])
  document.setIn(['patchedDependencies', patchKey], destination)
  document.set('allowUnusedPatches', false)
  document.set('ignorePatchFailures', false)
  mkdirSync(join(profileDirectory, 'patches'), { recursive: true })
  const patchTarget = join(profileDirectory, destination)
  assertOwnedPath(patchTarget)
  const patchContent = readFileSync(join(repositoryRoot, 'patches', corePatchName), 'utf8')
  if (existsSync(patchTarget) && readFileSync(patchTarget, 'utf8') !== patchContent) fail(`conflicting core patch: ${patchTarget}`)
  writeFileSync(patchTarget, patchContent)
  if (existsSync(workspacePath)) copyFileSync(workspacePath, `${workspacePath}.bak`)
  writeFileSync(workspacePath, document.toString())
}

function profileBundles(manifest) {
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (!Array.isArray(bundles) || bundles.some(name => typeof name !== 'string')) fail('invalid profile bundle list')
  return bundles
}

function restoreAddedBundleOrder(previousBundles) {
  const manifestPath = join(profileDirectory, 'package.json')
  assertOwnedPath(manifestPath)
  const manifest = readJson(manifestPath, 'profile manifest')
  const installed = profileBundles(manifest)
  const previous = new Set(previousBundles)
  const added = [...new Set(recipe.bundles.map(bundle => bundle.name))]
    .filter(name => !previous.has(name) && installed.includes(name))
  const addedNames = new Set(added)
  let index = 0
  // pnpm sorts dependencies and DSH appends in that order. Reorder only newly
  // selected bundles; retained bundles and template layers keep their positions.
  const ordered = installed.map(name => addedNames.has(name) ? added[index++] : name)
  if (ordered.every((name, position) => name === installed[position])) return
  manifest.dsh.profile.bundles = ordered
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

let previousBundles = []
if (options.dryRun) {
  console.log(`Would verify checkout-local DSH ${version} launcher and required RPC-owner patch (other launchers unsupported).`)
  console.log(`Would configure ${patchKey} in ${join(profileDirectory, 'pnpm-workspace.yaml')} and copy its patch.`)
} else {
  if (resolve(dsh) !== localDsh || !existsSync(localDsh)) fail('unsupported launcher; use this checkout’s installed node_modules/.bin/dsh; global DSH is never modified')
  const launcherManifest = join(repositoryRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  if (readJson(launcherManifest, 'launcher').version !== version) fail(`launcher must be DSH ${version}`)
  verifyCore(realpathSync(launcherManifest))
  const reported = run(dsh, ['--version'], { capture: true }).trim()
  if (reported !== version) fail(`launcher reported unsupported version ${reported}`)
  const pnpmVersion = run('pnpm', ['--version'], { capture: true }).trim()
  if (pnpmVersion !== '11.9.0') fail(`pnpm 11.9.0 is required; found ${pnpmVersion}`)
  await configureProfileDependencies()
  const manifestPath = join(profileDirectory, 'package.json')
  if (existsSync(manifestPath)) previousBundles = profileBundles(readJson(manifestPath, 'profile manifest'))
}
for (const [index, bundle] of recipe.bundles.entries()) console.log(`Applying ${bundle.name} to profile ${profile} from ${JSON.stringify(sources[index])}`)
// Resolve the complete graph at once: a base-only intermediate graph has no core patch target.
// Snapshot local bundles rather than symlinking to a different dependency graph.
run(dsh, ['plugin', '--profile', profile, 'add',
  ...sources.map(source => isLocalSource(source) ? `file:${source}` : source),
  '--offline', '--ignore-scripts'], options)
if (options.dryRun) {
  console.log('Would restore recipe order for newly added bundles, preserving retained bundle positions.')
} else {
  restoreAddedBundleOrder(previousBundles)
  run(dsh, ['plugin', '--profile', profile, 'install', '--offline', '--frozen-lockfile', '--ignore-scripts'], options)
  verifyCore(join(profileDirectory, 'package.json'))
}

if (!options.dryRun && !existsSync(profileDirectory)) {
  fail(`DSH did not create the expected profile directory: ${profileDirectory}`)
}
applyPatch({
  source: patchSource,
  target: join(profileDirectory, 'cordis.patch.yml'),
  dryRun: options.dryRun,
  forcePatch: options.forcePatch,
})

console.log(`Validating profile ${profile}`)
run(dsh, ['--profile', profile, '--dump-config'], { ...options, capture: true })
console.log(options.dryRun ? 'Dry run complete.' : `Profile ${profile} is ready.`)
