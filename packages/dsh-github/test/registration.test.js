import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import * as GitHub from '../src/index.js'
import { createGitHubTools } from '../src/tools.js'
import { fakeSubprocess } from './fixtures.js'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = name => import(pathToFileURL(cli.resolve(name)).href)
const { Context } = await installed('@deepseek-ai/cordis')
const { createScope } = await installed('@deepseek-ai/dsh-scope')
const names = [
  'connection_status', 'detect_repositories', 'list_repositories', 'get_repository',
  'list_projects', 'get_project', 'list_project_items', 'list_issues',
  'search_issues', 'get_issue', 'get_issue_comments',
].map(name => `github_${name}`).sort()
const camel = name => name.replace(/^github_/, '').replace(/_([a-z])/g, (_, char) => char.toUpperCase())

test('eleven plain definitions forward only the calling workspace and cancellation', async () => {
  const calls = []
  const runtime = Object.fromEntries(names.map(name => [camel(name), async (args, exec) => {
    calls.push({ method: camel(name), args, exec })
    return { fixture: name }
  }]))
  const definitions = createGitHubTools(runtime)
  assert.deepEqual(definitions.map(tool => tool.name).sort(), names)
  for (const tool of definitions) {
    assert.equal(Object.getPrototypeOf(tool), Object.prototype)
    assert.equal(typeof tool.execute, 'function')
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
    assert.doesNotMatch(tool.name, /create|update|delete|mutate|api|shell/)
    const args = { owner: 'acme', repo: 'example' }
    const signal = new AbortController().signal
    await tool.execute(args, { cwd: '/wrong', signal, agent: { session: { header: { cwd: '/session/a' } } } })
    assert.deepEqual(calls.at(-1), { method: camel(tool.name), args, exec: { cwd: '/session/a', signal } })
  }
})

test('real pinned DSH registry exposes host tools across preset/session scopes and disposes them', async t => {
  assert.equal(require(cli.resolve('@deepseek-ai/dsh/package.json')).version, '0.1.5-rc.1')
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const name of ['system-prompt', 'tools']) {
    const module = await installed(`@deepseek-ai/dsh-${name}`)
    await ctx.plugin(module.default ?? module, {}).await()
  }
  const subprocess = fakeSubprocess(() => ({ stdout: '', stderr: 'fatal: not a git repository', exitCode: 128 }))
  ctx.provide('subprocess', subprocess)
  const plugin = ctx.plugin(GitHub, {})
  await plugin.await()
  const registry = ctx.get('tools')
  const standard = { preset: 'standard' }
  const minimal = { preset: 'minimal' }
  const a = { session: { header: { cwd: '/session/a' } } }
  const b = { session: { header: { cwd: '/session/b' } } }
  createScope(ctx, standard)
  createScope(ctx, minimal)
  createScope(ctx, a, { parent: standard })
  createScope(ctx, b, { parent: minimal })
  for (const scope of [undefined, standard, minimal, a, b]) {
    assert.deepEqual([...registry.view(scope).visible.keys()].sort(), names)
    assert.equal(registry.schemas(scope).length, 11)
  }
  for (const agent of [a, b]) {
    const tool = registry.get('github_detect_repositories', agent)
    const result = JSON.parse(await tool.execute({}, { agent, signal: new AbortController().signal }))
    assert.equal(result.data.gitRepository, false)
    assert.deepEqual(result.data.candidates, [])
    assert.equal(subprocess.specs.at(-1).cwd, agent.session.header.cwd)
  }
  assert.deepEqual([...new Set(subprocess.specs.map(spec => spec.cwd))], ['/session/a', '/session/b'])
  await plugin.dispose()
  for (const scope of [undefined, standard, minimal, a, b]) assert.equal(registry.view(scope).visible.size, 0)
})
