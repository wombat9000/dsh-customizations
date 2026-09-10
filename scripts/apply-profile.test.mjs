import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync, symlinkSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const version = '0.1.5-rc.1'
const patchName = `dsh-client-connection-${version}-rpc-owner.patch`
function fixture(t, { patched = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-apply-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const put = (path, value) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), value) }
  put('scripts/apply-profile.mjs', readFileSync(join(root, 'scripts/apply-profile.mjs')))
  put(`patches/${patchName}`, readFileSync(join(root, 'patches', patchName)))
  put('pnpm-workspace.yaml', readFileSync(join(root, 'pnpm-workspace.yaml')))
  put('profiles/example/recipe.json', JSON.stringify({ profile: 'example', bundles: [{ name: '@deepseek-ai/dsh-web-app', source: '@deepseek-ai/dsh-web-app' }], patch: 'cordis.patch.yml' }))
  put('profiles/example/cordis.patch.yml', '[]\n')
  put('node_modules/@deepseek-ai/dsh/package.json', JSON.stringify({ name: '@deepseek-ai/dsh', version }))
  put('node_modules/@deepseek-ai/dsh-web-app/package.json', JSON.stringify({ name: '@deepseek-ai/dsh-web-app', version, main: 'index.js' }))
  put('node_modules/@deepseek-ai/dsh-web-app/index.js', '')
  put('node_modules/@deepseek-ai/dsh-client-connection/package.json', JSON.stringify({ name: '@deepseek-ai/dsh-client-connection', version, main: 'lib/index.js' }))
  put('node_modules/@deepseek-ai/dsh-client-connection/lib/index.js', patched ? 'import { Service, getTraceable } from "@deepseek-ai/cordis";\nconst owner = getTraceable(this.ctx, this.ctx);' : 'const owner = this.ctx;')
  // The stub records calls and materializes a fixture graph only; it never runs pnpm or DSH.
  put('node_modules/.bin/dsh', `#!${process.execPath}\nconst fs=require('fs'),p=require('path');const a=process.argv.slice(2);if(a[0]==='--version'){console.log('${version}');process.exit(0)}fs.appendFileSync(process.env.CALLS,JSON.stringify(a)+'\\n');if(a[0]==='plugin'){const d=p.join(process.env.DSH_HOME,'profiles',a[2]);fs.mkdirSync(d,{recursive:true});fs.writeFileSync(p.join(d,'package.json'),'{}');fs.cpSync(p.resolve(__dirname,'../@deepseek-ai'),p.join(d,'node_modules/@deepseek-ai'),{recursive:true});}`)
  put('bin/pnpm', `#!${process.execPath}\nconsole.log('11.9.0')`)
  chmodSync(join(dir, 'node_modules/.bin/dsh'), 0o755)
  chmodSync(join(dir, 'bin/pnpm'), 0o755)
  cpSync(resolve(root, 'node_modules/yaml'), join(dir, 'node_modules/yaml'), { recursive: true, dereference: true })
  const home = join(dir, 'home')
  return { dir, home, put, run(extra = [], env = {}) { const clean = { ...process.env, DSH_HOME: home, DSH_BIN: '', CALLS: join(dir, 'calls'), PATH: `${join(dir, 'bin')}:${process.env.PATH}`, ...env }; delete clean.NODE_PATH; return spawnSync(process.execPath, [join(dir, 'scripts/apply-profile.mjs'), 'example', ...extra], { cwd: dir, env: clean, encoding: 'utf8' }) } }
}

test('dry run remains dependency-free and never invokes launcher or writes home', t => {
  const f = fixture(t)
  rmSync(join(f.dir, 'node_modules'), { recursive: true })
  const result = f.run(['--dry-run'], { DSH_BIN: '/unsupported/launcher' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Would configure @deepseek-ai\/dsh-client-connection@0.1.5-rc.1/)
  assert.match(result.stdout, /--offline/)
  assert.equal(existsSync(f.home), false)
  assert.equal(existsSync(join(f.dir, 'calls')), false)
})

test('unsupported global launcher fails without modifying profile', t => {
  const f = fixture(t)
  const result = f.run([], { DSH_BIN: '/usr/local/bin/dsh' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unsupported launcher/)
  assert.equal(existsSync(f.home), false)
})

test('unpatched launcher fails before profile writes or plugin calls', t => {
  const f = fixture(t, { patched: false })
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /RPC-owner patch is missing/)
  assert.equal(existsSync(f.home), false)
  assert.equal(existsSync(join(f.dir, 'calls')), false)
})

test('apply preserves YAML settings and pins copied patch before one complete offline add', t => {
  const f = fixture(t)
  f.put('home/profiles/example/pnpm-workspace.yaml', '# preserve me\nregistry: https://example.invalid\noverrides:\n  react: 18.3.1\n')
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  const workspace = readFileSync(join(f.home, 'profiles/example/pnpm-workspace.yaml'), 'utf8')
  assert.match(workspace, /# preserve me/)
  assert.match(workspace, /react: 18.3.1/)
  assert.match(workspace, /patchedDependencies:/)
  assert.match(workspace, /allowUnusedPatches: false/)
  assert.equal(readFileSync(join(f.home, 'profiles/example/patches', patchName), 'utf8'), readFileSync(join(root, 'patches', patchName), 'utf8'))
  const calls = readFileSync(join(f.dir, 'calls'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(calls.filter(a => a.includes('add')).length, 1)
  assert.ok(calls[0].includes(`@deepseek-ai/dsh-web-app@${version}`))
  assert.ok(calls[0].includes('--offline') && calls[0].includes('--ignore-scripts'))
  assert.ok(calls[1].includes('--frozen-lockfile'))
  assert.ok(calls[2].includes('--dump-config'))
})

test('nonempty profile patch is refused before dependency changes', t => {
  const f = fixture(t)
  f.put('home/profiles/example/cordis.patch.yml', '- custom: true\n')
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /refusing to replace nonempty patch/)
  assert.equal(existsSync(join(f.dir, 'calls')), false)
})

test('conflicting required patch and symlinked dependencies fail closed', t => {
  const f = fixture(t)
  f.put('home/profiles/example/pnpm-workspace.yaml', `patchedDependencies:\n  '@deepseek-ai/dsh-client-connection@${version}': other.patch\n`)
  let result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /conflicting/)
  assert.equal(existsSync(join(f.dir, 'calls')), false)
  rmSync(join(f.home, 'profiles/example/pnpm-workspace.yaml'))
  symlinkSync(join(f.dir, 'node_modules'), join(f.home, 'profiles/example/node_modules'))
  result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /symlinked profile path/)
  assert.equal(existsSync(join(f.dir, 'calls')), false)
})
