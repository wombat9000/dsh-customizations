import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { apply, inject } from '../src/tools.js'

function fixture() {
  const tools = new Map()
  const calls = []
  const service = Object.fromEntries(['create', 'list', 'dispatch'].map(method => [method, async (...args) => {
    calls.push({ method, args })
    return { method }
  }]))
  apply({ tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } }, worktreeWorkers: service })
  return { tools, calls }
}

test('preset contributes exactly three tools and consumes the host service', async () => {
  assert.deepEqual(inject, ['tools', 'worktreeWorkers'])
  const { tools, calls } = fixture()
  assert.deepEqual([...tools.keys()], ['worktree_create', 'worktree_list', 'worktree_dispatch'])
  const agent = { session: { id: 'parent' } }
  const signal = new AbortController().signal
  const args = { worktree: '/repo/.dsh/worktrees/a', task: 'Review', mode: 'read-only' }
  const result = await tools.get('worktree_dispatch').execute(args, { agent, signal })
  assert.deepEqual(JSON.parse(result), { method: 'dispatch' })
  assert.equal(calls[0].args[0], agent)
  assert.equal(calls[0].args[1], args)
  assert.equal(calls[0].args[2], signal)
  await assert.rejects(tools.get('worktree_list').execute({}, {}), /calling agent/)
})

test('bundle keeps worktree tools out of the host and remains in the portable recipe', async () => {
  const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
  const manifest = await json('../package.json')
  const recipe = await json('../../../profiles/personal-web/recipe.json')
  assert.equal(manifest.name, '@local/dsh-worktree')
  assert.equal(manifest.exports['./tools'], './src/tools.js')
  assert.deepEqual(manifest.dsh, { bundle: { patch: './cordis.patch.yml' } })
  const bundleIndex = recipe.bundles.findIndex(bundle => bundle.name === manifest.name)
  assert.equal(recipe.bundles[bundleIndex].source, '../../packages/dsh-worktree')
  const webIndex = recipe.bundles.findIndex(bundle => bundle.name === '@deepseek-ai/dsh-web-app')
  assert.ok(webIndex >= 0 && bundleIndex > webIndex, 'worktree roster patch requires Web first')
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /name: '@local\/dsh-worktree'/)
  assert.doesNotMatch(patch, /name: '@local\/dsh-worktree\/tools'/)
  const preset = await readFile(new URL('../agent.cordis.example.yml', import.meta.url), 'utf8')
  assert.match(preset, /name: '@local\/dsh-worktree\/tools'/)
  const result = spawnSync(process.execPath, ['scripts/apply-profile.mjs', '--', 'personal-web', '--dry-run'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8', timeout: 10000,
    env: { PATH: process.env.PATH },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Applying @local\/dsh-worktree/)
})
