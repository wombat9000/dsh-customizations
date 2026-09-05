#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs'
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
  DSH_BIN             DSH executable to invoke; defaults to dsh
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

const dsh = process.env.DSH_BIN || 'dsh'
for (const bundle of recipe.bundles) {
  const source = resolveBundleSource(bundle, recipeDirectory)
  console.log(`Applying ${bundle.name} to profile ${profile}`)
  run(dsh, ['plugin', '--profile', profile, 'add', source], options)
}

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDirectory = join(dshHome, 'profiles', profile)
const patchSource = resolve(recipeDirectory, recipe.patch)
if (!existsSync(patchSource)) fail(`recipe patch not found: ${patchSource}`)

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
