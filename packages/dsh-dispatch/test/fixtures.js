import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as GitHub from '../../dsh-github/dist/src/index.js'
import {
  Context,
  EntryTree,
  Loader,
  auditRows,
  cli,
  declarations,
  flatten,
  installed,
  json,
  repo,
  standardPatch,
} from '../../dsh-product-mode/test/fixtures.js'

export { cli, declarations, flatten, json, repo, standardPatch }
export const source = join(repo, 'packages/dsh-dispatch')
export const patch = join(source, 'cordis.patch.yml')

// Packaged copy of only the publication files, beside the pinned DSH graph.
export async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dispatch-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const packaged = join(directory, 'node_modules/@local/dsh-dispatch')
  await mkdir(packaged, { recursive: true })
  const manifest = await json(join(source, 'package.json'))
  for (const file of ['package.json', ...manifest.files])
    await cp(join(source, file), join(packaged, file), { recursive: true })
  const namespace = join(directory, 'node_modules/@deepseek-ai')
  await mkdir(namespace)
  const names = new Set(
    [
      '@deepseek-ai/dsh-agent-preset-registry',
      '@deepseek-ai/dsh-agent-preset',
      '@deepseek-ai/dsh-session-projection',
      '@deepseek-ai/dsh-working-directory',
      ...declarations([standardPatch, join(packaged, 'cordis.patch.yml')]).flatMap((row) =>
        row.config?.plugins ? flatten(row.config.plugins).map((plugin) => plugin.name) : [row.name],
      ),
    ]
      .filter((name) => name.startsWith('@deepseek-ai/'))
      .map((name) => name.split('/').slice(0, 2).join('/')),
  )
  for (const name of names)
    await symlink(
      dirname(cli.resolve(`${name}/package.json`)),
      join(namespace, name.split('/')[1]),
      'dir',
    )
  return { directory, packaged, source, baseUrl: pathToFileURL(`${directory}/`).href }
}

// Loader 1.1 persists entry changes through commit(change); keep them in memory.
class MemoryTree extends EntryTree {
  commit() {}
}

export async function host(t, fixture, rows, { full = true, selectedDefault, before } = {}) {
  const ctx = new Context()
  await before?.(ctx)
  t.after(() => ctx.fiber.dispose())
  ctx.baseUrl = fixture.baseUrl
  await ctx.plugin(Loader, {}).await()
  const { default: Group } = await installed('@deepseek-ai/cordis-plugin-group')
  ctx.get('loader').builtins.group = Group
  const calls = []
  const forbidden = (...args) => {
    calls.push(args)
    assert.fail('mounting must not execute a subprocess or PTC workflow')
  }
  if (full) {
    ctx.provide('subprocess', { resolveExecutable: forbidden, spawn: forbidden })
    for (const suffix of [
      'session',
      'agent',
      'system-prompt',
      'tools',
      'tool-executor-native',
      'commands',
      'goal',
      'skill',
      'token-meter',
      'bash-local',
      'shell-env',
      'fs-local',
      'jobs-local',
      'subagent',
      'user-questions',
      'web',
      'llm',
      'subagent-spawn-in-process',
      'subagent-fork-in-process',
      'tool-subagent/model-selection-settings',
    ]) {
      const module = await installed(`@deepseek-ai/dsh-${suffix}`)
      await ctx.plugin(module.default ?? module, {}).await()
    }
    const { default: SandboxPolicy } = await installed('@deepseek-ai/dsh-sandbox-policy')
    await ctx.plugin(SandboxPolicy, { mode: 'read-only', workspaceRoot: fixture.directory }).await()
    for (const suffix of ['sandbox-local', 'ptc-runtime-node']) {
      const module = await installed(`@deepseek-ai/dsh-${suffix}`)
      await ctx.plugin(module.default ?? module, {}).await()
    }
    await ctx.plugin(GitHub, {}).await()
  } else {
    // The 0.2.2 preset registry also injects the Agent registry.
    const { default: Agents } = await installed('@deepseek-ai/dsh-agent')
    await ctx.plugin(Agents, {}).await()
  }
  const tree = new MemoryTree(ctx)
  t.after(async () => {
    tree.root.stop()
    await tree.await()
  })
  const registry = {
    id: 'agent-preset-registry',
    name: '@deepseek-ai/dsh-agent-preset-registry',
    config: { default: 'standard', ...(selectedDefault ? { selectedDefault } : {}) },
  }
  // Loader applies volatile selectedDefault and preserves nested !!js expressions.
  await tree.root.update([
    { id: 'session-projections', name: '@deepseek-ai/dsh-session-projection' },
    ...(full
      ? [
          {
            id: 'working-directory',
            name: '@deepseek-ai/dsh-working-directory',
            config: { defaultDirectory: fixture.directory },
          },
        ]
      : []),
    registry,
    ...rows,
  ])
  await tree.await()
  const audit = await auditRows(tree)
  assert.deepEqual(audit.failed, [])
  assert.deepEqual(audit.pending, [])
  return { ctx, tree, registry, calls }
}

export async function lease(t, roster, id) {
  const scope = await roster.acquireScope(id)
  t.after(() => scope[Symbol.asyncDispose]())
  return scope
}
