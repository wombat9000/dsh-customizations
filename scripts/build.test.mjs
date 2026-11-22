import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildClient } from './build-client.mjs'
import { buildHost } from './build-host.mjs'
import { buildPackage, listPackages } from './build.mjs'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

test('listPackages discovers workspace packages and buildPackage emits deterministic host and client artifacts', async () => {
  const packages = listPackages()
  assert.ok(packages.includes('dsh-github'))
  assert.ok(packages.includes('dsh-projects'))
  assert.ok(packages.includes('dsh-session-environment'))

  const pkgDir = join(repositoryRoot, 'packages', 'dsh-web-firecrawl')
  await buildPackage('dsh-web-firecrawl')
  await buildPackage('dsh-web-firecrawl', { check: true })

  const hostFirst = buildHost(pathToFileURL(join(pkgDir, 'tsconfig.host.json')))
  const hostSecond = buildHost(pathToFileURL(join(pkgDir, 'tsconfig.host.json')))
  assert.deepEqual([...hostFirst.files], [...hostSecond.files])

  const clientFirst = await buildClient({ packageRoot: pathToFileURL(`${pkgDir}/`) })
  const clientSecond = await buildClient({ packageRoot: pathToFileURL(`${pkgDir}/`) })
  assert.equal(clientFirst, clientSecond)
  assert.equal(readFileSync(join(pkgDir, 'client.js'), 'utf8'), clientFirst)
})
