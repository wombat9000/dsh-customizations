#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildClient } from './build-client.mjs'
import { buildHost, checkHost, typecheckProject, writeHost } from './build-host.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packagesRoot = join(repositoryRoot, 'packages')
const tscBin = join(repositoryRoot, 'node_modules', '.bin', 'tsc')
const tsdownBin = join(repositoryRoot, 'node_modules', '.bin', 'tsdown')

// Packages whose client entrypoint exports the plugin as `default` and must be
// unwrapped by the DSH lazy module factory.
const DEFAULT_EXPORT_CLIENTS = new Set([
  'dsh-codex-compat',
  'dsh-dispatch',
  'dsh-github',
  'dsh-google-auth',
  'dsh-google-drive',
  'dsh-jev',
  'dsh-openrouter',
  'dsh-projects',
  'dsh-ship-it',
])

function readManifest(directory) {
  return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
}

function needsHostDeclarations(manifest) {
  const serialized = JSON.stringify(manifest.exports ?? {})
  return serialized.includes('./dist/') && serialized.includes('.d.ts')
}

export function listPackages() {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(packagesRoot, entry.name, 'package.json')),
    )
    .map((entry) => entry.name)
    .sort()
}

function resolvePackageName(input) {
  const all = listPackages()
  if (all.includes(input)) return input
  for (const dir of all) {
    const manifest = readManifest(join(packagesRoot, dir))
    if (manifest.name === input) return dir
  }
  throw new Error(`Unknown package: ${input}`)
}

function runCommand(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

function buildTsdownPackage(directory, { face, typecheckOnly }) {
  const runHost = face === 'all' || face === 'host'
  const runClient = face === 'all' || face === 'client'
  if (runHost) {
    runCommand(tscBin, ['-b', 'tsconfig.node.json', '--force'], directory)
    if (!typecheckOnly) {
      runCommand(
        tsdownBin,
        [
          '--config',
          'tsdown.config.mjs',
          '--config-loader',
          'native',
          '--env.DSH_BUILD_FACE',
          'host',
        ],
        directory,
      )
    }
  }
  if (runClient) {
    runCommand(tscBin, ['-b', 'tsconfig.browser.json', '--force'], directory)
    if (!typecheckOnly) {
      runCommand(
        tsdownBin,
        [
          '--config',
          'tsdown.config.mjs',
          '--config-loader',
          'native',
          '--env.DSH_BUILD_FACE',
          'client',
        ],
        directory,
      )
    }
  }
}

export async function buildPackage(
  name,
  { face = 'all', check = false, typecheckOnly = false } = {},
) {
  const dirName = resolvePackageName(name)
  const directory = join(packagesRoot, dirName)
  const manifest = readManifest(directory)

  // Session Environment keeps its own Typert/tsdown multi-entry build under lib/.
  if (existsSync(join(directory, 'tsdown.config.mjs'))) {
    buildTsdownPackage(directory, { face, typecheckOnly })
    return
  }

  const hostConfig = join(directory, 'tsconfig.host.json')
  const clientConfig = join(directory, 'tsconfig.json')
  const publicTypesConfig = join(directory, 'test', 'public-types', 'tsconfig.json')
  const clientEntry = join(directory, 'client', 'index.ts')
  const oauthClientEntry = join(directory, 'oauth', 'client', 'index.ts')

  const doHost = face === 'all' || face === 'host'
  const doClient = face === 'all' || face === 'client'

  if (doHost && dirName === 'dsh-projects') {
    for (const provider of ['dsh-github', 'dsh-linear']) {
      if (!existsSync(join(packagesRoot, provider, 'dist', 'src', 'reads.d.ts'))) {
        await buildPackage(provider, { face: 'host' })
      }
    }
  }

  if (doHost && existsSync(hostConfig)) {
    const declaration = needsHostDeclarations(manifest)
    if (typecheckOnly && !declaration) {
      typecheckProject(pathToFileURL(hostConfig), `${dirName} host`)
    } else {
      const output = buildHost(pathToFileURL(hostConfig), { declaration })
      if (check) checkHost(output)
      else writeHost(output)
    }
  }

  if (doClient && existsSync(clientConfig)) {
    typecheckProject(pathToFileURL(clientConfig), `${dirName} client`)
  }

  if (doClient && !typecheckOnly && existsSync(clientEntry)) {
    const targets = [
      {
        root: directory,
        outputPath: join(directory, 'client.js'),
        defaultExport: DEFAULT_EXPORT_CLIENTS.has(dirName),
      },
    ]
    if (existsSync(oauthClientEntry)) {
      targets.push({
        root: join(directory, 'oauth'),
        outputPath: join(directory, 'oauth', 'client.js'),
        defaultExport: true,
      })
    }
    for (const target of targets) {
      const code = await buildClient({
        packageRoot: pathToFileURL(`${target.root}/`),
        defaultExport: target.defaultExport,
      })
      if (check) {
        if (!existsSync(target.outputPath) || readFileSync(target.outputPath, 'utf8') !== code) {
          throw new Error(`${dirName}: client artifact is stale. Run pnpm run build.`)
        }
      } else {
        writeFileSync(target.outputPath, code)
      }
    }
  }

  if (doHost && existsSync(publicTypesConfig)) {
    typecheckProject(pathToFileURL(publicTypesConfig), `${dirName} public declarations`)
  }
}

export async function buildAll({
  packages,
  face = 'all',
  check = false,
  typecheckOnly = false,
} = {}) {
  const selected = packages?.length ? packages.map(resolvePackageName) : listPackages()
  // Build packages that emit public .d.ts first so downstream consumers (e.g. dsh-projects)
  // always see current declarations when building in a clean checkout.
  const ordered = [...selected].sort((a, b) => {
    const aDecl = needsHostDeclarations(readManifest(join(packagesRoot, a))) ? 0 : 1
    const bDecl = needsHostDeclarations(readManifest(join(packagesRoot, b))) ? 0 : 1
    return aDecl - bDecl || a.localeCompare(b)
  })
  for (const pkg of ordered) {
    await buildPackage(pkg, { face, check, typecheckOnly })
  }
}

function parseArgs(argv) {
  let face = 'all'
  let check = false
  let typecheckOnly = false
  const packages = []
  for (const arg of argv) {
    if (arg === '--check') check = true
    else if (arg === '--typecheck') typecheckOnly = true
    else if (arg === '--host') face = 'host'
    else if (arg === '--client') face = 'client'
    else if (arg.startsWith('-')) {
      throw new Error(
        `Unknown option: ${arg}\nUsage: node scripts/build.mjs [--check] [--typecheck] [--host|--client] [package...]`,
      )
    } else {
      packages.push(arg)
    }
  }
  return { packages, face, check, typecheckOnly }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2))
  await buildAll(options)
}
