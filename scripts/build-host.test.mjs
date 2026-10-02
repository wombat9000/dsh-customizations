import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import test from 'node:test'
import { buildHost, checkHost, writeHost } from './build-host.mjs'

const require = createRequire(import.meta.url)
const compiler = require.resolve('typescript/bin/tsc')

test('optional declarations expose checked host contracts without changing default artifacts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-host-declarations-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(
    join(directory, 'index.ts'),
    'export interface Reading { value: number }\nexport function read(value: number): Reading { return { value } }\n',
  )
  const options = {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    types: [],
    noEmit: true,
    rootDir: '.',
    outDir: 'dist',
  }
  const project = join(directory, 'tsconfig.json')
  await writeFile(project, JSON.stringify({ compilerOptions: options, include: ['index.ts'] }))
  assert.deepEqual([...buildHost(pathToFileURL(project)).files.keys()], ['index.js'])

  const output = buildHost(pathToFileURL(project), { declaration: true })
  assert.deepEqual([...output.files.keys()].sort(), ['index.d.ts', 'index.js'])
  writeHost(output)
  checkHost(output)
  const runtime = await import(pathToFileURL(join(directory, 'dist/index.js')).href)
  assert.deepEqual(runtime.read(7), { value: 7 })

  await writeFile(
    join(directory, 'consumer.ts'),
    'import { read, type Reading } from "./dist/index.js"\nconst result: Reading = read(7)\nconst value: number = result.value\n// @ts-expect-error published contract rejects string arguments\nread("invalid")\n',
  )
  await writeFile(
    join(directory, 'tsconfig.consumer.json'),
    JSON.stringify({ compilerOptions: options, include: ['consumer.ts'] }),
  )
  await promisify(execFile)(process.execPath, [
    compiler,
    '--project',
    join(directory, 'tsconfig.consumer.json'),
    '--pretty',
    'false',
  ])
  assert.ok((await readFile(join(directory, 'dist/index.d.ts'), 'utf8')).length > 0)
  await rm(join(directory, 'dist/index.d.ts'))
  assert.throws(() => checkHost(output), /Host artifact file set is stale/)
})
