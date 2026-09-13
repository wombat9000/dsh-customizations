import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '..')
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const manifest = json(join(root, 'package.json'))
const version = manifest.devDependencies['@deepseek-ai/dsh']
const isDsh = name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
const directories = [root, ...readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => join(root, 'packages', entry.name))]

test('DSH declarations and normal lockfile resolve the target release, including peers', () => {
  assert.equal(version, '0.1.5-rc.2')
  for (const directory of directories) {
    const pkg = json(join(directory, 'package.json'))
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, declared] of Object.entries(pkg[field] ?? {})) {
        if (isDsh(name)) assert.equal(declared, version, `${pkg.name} ${field} ${name}`)
      }
    }
  }
  const lock = parse(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'))
  let count = 0
  for (const name of Object.keys(lock.packages)) {
    if (!name.startsWith('@deepseek-ai/dsh')) continue
    assert.equal(name.slice(name.lastIndexOf('@') + 1), version, name)
    count++
  }
  assert.ok(count > 0, 'lockfile contains DSH packages')
  // Snapshot keys and importer versions include nested peer resolutions.
  for (const section of [lock.importers, lock.snapshots]) {
    const references = JSON.stringify(section).matchAll(/@deepseek-ai\/dsh(?:-[a-z0-9-]+)?@([^()"\\]+)/g)
    for (const [, resolved] of references) assert.equal(resolved, version)
  }
  const workspace = parse(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'))
  const patchKey = `@deepseek-ai/dsh-client-connection@${version}`
  const patch = readFileSync(join(root, workspace.patchedDependencies[patchKey]))
  assert.equal(lock.patchedDependencies[patchKey], createHash('sha256').update(patch).digest('hex'))
  assert.match(patch.toString(), /getTraceable\(this\.ctx, this\.ctx\)/)
})

test('installed launcher resolves RC2 Web and the patched RPC owner', () => {
  const require = createRequire(join(root, 'package.json'))
  const launcher = require.resolve('@deepseek-ai/dsh/package.json')
  assert.equal(json(launcher).version, version)
  const web = createRequire(launcher).resolve('@deepseek-ai/dsh-web-app')
  const connection = createRequire(web).resolve('@deepseek-ai/dsh-client-connection')
  assert.equal(json(join(dirname(web), '..', 'package.json')).version, version)
  assert.equal(json(join(dirname(connection), '..', 'package.json')).version, version)
  assert.match(readFileSync(connection, 'utf8'), /const owner = getTraceable\(this\.ctx, this\.ctx\);/)
})
