#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0
let recipeCount = 0
let packageCount = 0

function report(message) {
  console.error(`check: ${message}`)
  failures += 1
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    report(`${path}: ${error.message}`)
    return undefined
  }
}

function childDirectories(path) {
  if (!existsSync(path)) return []
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name))
    .sort()
}

function checkBundleManifest(directory, expectedName) {
  const manifestPath = join(directory, 'package.json')
  const manifest = readJson(manifestPath)
  if (!manifest) return
  packageCount += 1

  if (typeof manifest.name !== 'string' || !manifest.name) {
    report(`${manifestPath}: package name is required`)
  }
  if (expectedName && manifest.name !== expectedName) {
    report(`${manifestPath}: package name ${JSON.stringify(manifest.name)} does not match recipe name ${JSON.stringify(expectedName)}`)
  }

  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string' || !patch) {
    report(`${manifestPath}: dsh.bundle.patch is required`)
  } else if (!existsSync(resolve(directory, patch))) {
    report(`${manifestPath}: bundle patch does not exist: ${patch}`)
  }
}

for (const directory of childDirectories(join(repositoryRoot, 'packages'))) {
  if (existsSync(join(directory, 'package.json'))) checkBundleManifest(directory)
}

for (const directory of childDirectories(join(repositoryRoot, 'profiles'))) {
  const recipePath = join(directory, 'recipe.json')
  if (!existsSync(recipePath)) continue
  recipeCount += 1

  const recipe = readJson(recipePath)
  if (!recipe) continue
  if (!/^[a-z0-9][a-z0-9-]*$/.test(recipe.profile ?? '')) {
    report(`${recipePath}: invalid profile name`)
  }
  if (!Array.isArray(recipe.bundles) || recipe.bundles.length === 0) {
    report(`${recipePath}: select at least one bundle`)
    continue
  }
  if (typeof recipe.patch !== 'string' || !recipe.patch) {
    report(`${recipePath}: patch is required`)
  } else {
    const patchPath = resolve(directory, recipe.patch)
    if (!existsSync(patchPath)) report(`${recipePath}: patch does not exist: ${recipe.patch}`)
    else if (!readFileSync(patchPath, 'utf8').trim()) report(`${patchPath}: patch must not be empty`)
  }

  for (const [index, bundle] of recipe.bundles.entries()) {
    if (!bundle || typeof bundle.name !== 'string' || !bundle.name) {
      report(`${recipePath}: bundle ${index + 1} requires a name`)
      continue
    }
    if (typeof bundle.source !== 'string' || !bundle.source) {
      report(`${recipePath}: bundle ${index + 1} requires a source`)
      continue
    }
    if (bundle.source.startsWith('.') || bundle.source.startsWith('/')) {
      const source = resolve(directory, bundle.source)
      if (!existsSync(join(source, 'package.json'))) {
        report(`${recipePath}: local bundle source does not exist: ${bundle.source}`)
      } else {
        checkBundleManifest(source, bundle.name)
      }
    }
  }
}

if (failures > 0) {
  console.error(`Found ${failures} problem(s).`)
  process.exit(1)
}

console.log(`Checked ${recipeCount} profile recipe(s) and ${packageCount} package reference(s).`)
