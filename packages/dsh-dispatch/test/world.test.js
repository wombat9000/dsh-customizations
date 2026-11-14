import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context, installed } from '../../dsh-product-mode/test/fixtures.js'
import { Repositories } from '../dist/src/repositories.js'
import { managedWorld } from '../dist/src/world.js'

// Primary boundary for Dispatch's Git execution: the real DSH 0.2.2-rc.3 local
// subprocess and filesystem providers and sandbox policy, with a recording
// sandbox provider. No Host child_process or filesystem call is made by Dispatch.

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@e',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@e',
    },
  }).trim()

async function world(t, mode) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dispatch-world-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const name of ['@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-subprocess-local']) {
    const module = await installed(name)
    await ctx.plugin(module.default ?? module, {}).await()
  }
  const { default: Fs } = await installed('@deepseek-ai/dsh-fs-local')
  await ctx.plugin(Fs, {}).await()
  const { default: Policy } = await installed('@deepseek-ai/dsh-sandbox-policy')
  await ctx.plugin(Policy, { mode, workspaceRoot: root }).await()
  const confined = []
  // Records what the managed runner asks the sandbox to confine; runs it unchanged.
  const sandbox = {
    async confine(argv, policy) {
      confined.push({ argv: [...argv], mode: policy.mode })
      return { argv }
    },
  }
  const services = () => ({
    subprocess: ctx.get('subprocess'),
    fs: ctx.get('fs'),
    sandboxPolicy: ctx.get('sandboxPolicy'),
    sandbox,
  })
  return { root, ctx, confined, world: managedWorld(services, { timeoutMs: 20_000 }) }
}

async function repository(root) {
  const remote = join(root, 'remote.git')
  const main = join(root, 'main')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['init', '-q', '-b', 'main', main])
  await writeFile(join(main, 'README.md'), 'one\n')
  git(main, 'add', '.')
  git(main, 'commit', '-q', '-m', 'one')
  git(main, 'remote', 'add', 'origin', remote)
  git(main, 'push', '-q', '-u', 'origin', 'main')
  git(main, 'remote', 'set-head', 'origin', 'main')
  return { remote, main }
}

test('Git runs through the DSH subprocess provider, confined under the Session policy', async (t) => {
  const { root, confined, world: w } = await world(t, 'workspace-write')
  const { main, remote } = await repository(root)
  const linked = join(root, 'linked')
  git(main, 'worktree', 'add', '-q', '-b', 'feature', linked)
  const repositories = new Repositories(w)
  const { Session } = await installed('@deepseek-ai/dsh-session')
  const session = Session.create('coord', undefined, {
    version: 4,
    id: 'coord',
    createdAt: 0,
    isSeeded: false,
    cwd: main,
  })

  const identity = await repositories.inspect(session, join(linked, '.'))
  assert.equal(identity.provider, 'LocalFileSystem')
  assert.equal(identity.worktreePath, linked)
  assert.equal(identity.worktreeKey, linked, 'the provider key identifies the checkout')
  assert.equal(identity.repositoryRoot, main)
  assert.equal(identity.linked, true)
  assert.equal(identity.registered, true)
  assert.equal(identity.branch, 'feature')
  assert.equal((await repositories.inspect(session, main)).linked, false)

  const base = await repositories.refreshBase(session, main, {})
  assert.equal(base.provider, 'LocalFileSystem')
  assert.equal(base.commit, git(remote, 'rev-parse', 'main'))
  assert.equal(await repositories.branchExists(session, main, 'feature'), true)
  assert.equal(await repositories.branchExists(session, main, 'absent'), false)

  assert.ok(confined.length > 0)
  assert.ok(
    confined.every(({ mode }) => mode === 'workspace-write'),
    'every command is confined under the calling Session policy',
  )
  assert.ok(confined.some(({ argv }) => argv.includes('fetch')))
  assert.ok(confined.every(({ argv }) => argv[0].endsWith('git')))
})

test('a failing or non-repository command fails closed with a bounded error', async (t) => {
  const { root, world: w } = await world(t, 'danger-full-access')
  const repositories = new Repositories(w)
  assert.equal(await repositories.inspect(undefined, root), null)
  await assert.rejects(
    w.git(undefined, root, ['rev-parse', '--verify', 'HEAD']),
    /git rev-parse failed/,
  )
  const missing = managedWorld(() => ({}))
  await assert.rejects(missing.git(undefined, root, ['status']), /subprocess, sandbox/)
})
