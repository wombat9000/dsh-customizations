import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { devNull, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorktree, listWorktrees, resolveWorktree, inspectWorktrees, parseStatus } from '../src/git.js'

// Production intentionally ignores GIT_CONFIG_* environment overrides. Isolate
// normal user-config discovery instead, within this test file's own process.
let testHome
let originalEnvironment
before(async () => {
  originalEnvironment = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }
  testHome = await realpath(await mkdtemp(join(tmpdir(), 'dsh-worktree-test-home-')))
  const configHome = join(testHome, 'xdg')
  await mkdir(configHome)
  process.env.HOME = testHome
  process.env.XDG_CONFIG_HOME = configHome
})
after(async () => {
  if (originalEnvironment) {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  if (testHome) await rm(testHome, { recursive: true, force: true })
})

function run(cwd, args) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
    const child = spawn('git', ['-c', 'core.hooksPath=' + devNull, '-c', 'commit.gpgSign=false', '-C', cwd, ...args], {
      env: { ...env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const output = []
    const error = []
    child.stdout.on('data', (data) => output.push(data))
    child.stderr.on('data', (data) => error.push(data))
    child.once('error', reject)
    child.once('close', (code) => code === 0
      ? resolve(Buffer.concat(output).toString('utf8').replace(/\n$/, ''))
      : reject(new Error(`git ${args[0]} failed (${code}): ${Buffer.concat(error)}`)))
  })
}

async function fixture(t) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'dsh-worktree-test-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  const repository = join(base, 'repo')
  await mkdir(repository)
  await run(repository, ['init', '--quiet', '--initial-branch=main'])
  await run(repository, ['config', 'user.name', 'Test'])
  await run(repository, ['config', 'user.email', 'test@example.invalid'])
  await writeFile(join(repository, 'file.txt'), 'committed\n')
  await run(repository, ['add', '--', 'file.txt'])
  await run(repository, ['commit', '--quiet', '-m', 'initial'])
  return { base, repository }
}

test('UI status preserves unusual filenames, bounds lists and never refreshes the index', async t => {
  const { repository } = await fixture(t)
  const index = await readFile(join(repository, '.git', 'index'))
  await writeFile(join(repository, 'odd\nname.txt'), 'new')
  await writeFile(join(repository, 'file.txt'), 'modified')
  const snapshot = await inspectWorktrees(repository)
  assert.equal(snapshot.worktrees[0].changes.count, 2)
  assert.ok(snapshot.worktrees[0].changes.files.some(file => file.path === 'odd\nname.txt'))
  assert.deepEqual(await readFile(join(repository, '.git', 'index')), index)
  const parsed = parseStatus('R  new\0old\0' + Array.from({ length: 600 }, (_, i) => `?? file${i}\0`).join(''))
  assert.equal(parsed.count, 601)
  assert.equal(parsed.files.length, 500)
  assert.equal(parsed.files[0].from, 'old')
  assert.equal(parsed.truncated, true)
})

test('UI status refuses executable filters and handles non-Git cwd', async t => {
  const { repository, base } = await fixture(t)
  await run(repository, ['config', 'filter.evil.clean', 'touch SHOULD_NOT_EXIST'])
  await writeFile(join(repository, '.gitattributes'), '* filter=evil\n')
  await writeFile(join(repository, 'file.txt'), 'modified')
  const result = await inspectWorktrees(repository)
  assert.ok(result.worktrees[0].changes.error)
  await absent(join(repository, 'SHOULD_NOT_EXIST'))
  await assert.rejects(inspectWorktrees(base), /Git exited/)
})

async function absent(path) {
  await assert.rejects(lstat(path), { code: 'ENOENT' })
}

test('creates a managed branch at HEAD without copying dirty changes or switching parent', async (t) => {
  const { repository } = await fixture(t)
  const originalHead = await run(repository, ['rev-parse', 'HEAD'])
  await writeFile(join(repository, 'file.txt'), 'dirty\n')
  await writeFile(join(repository, 'untracked.txt'), 'private\n')
  const result = await createWorktree(repository, 'feature-one')
  const path = join(repository, '.dsh', 'worktrees', 'feature-one')
  assert.equal(result.repository, repository)
  assert.equal(result.commonDir, join(repository, '.git'))
  assert.equal(result.worktree.path, path)
  assert.equal(result.worktree.branch, 'worktree/feature-one')
  assert.equal(result.worktree.head, originalHead)
  assert.equal(result.worktree.isCurrent, false)
  assert.equal(result.worktree.isOriginal, false)
  assert.equal(await readFile(join(path, 'file.txt'), 'utf8'), 'committed\n')
  await absent(join(path, 'untracked.txt'))
  assert.equal(await readFile(join(repository, 'file.txt'), 'utf8'), 'dirty\n')
  assert.equal(await run(repository, ['branch', '--show-current']), 'main')
  const listing = await listWorktrees(repository)
  assert.equal(listing.worktrees.length, 2)
  assert.equal(listing.worktrees[0].isOriginal, true)
  assert.equal(listing.worktrees[0].isCurrent, true)
  assert.deepEqual(await resolveWorktree(repository, path), result)
})

test('names reject traversal, refs, flags, punctuation, uppercase, and length overflow', async (t) => {
  const { repository } = await fixture(t)
  for (const name of ['', '../escape', 'a/b', '-flag', 'Upper', 'a.b', 'a_b', 'a b', 'a\n', 'a'.repeat(49), null]) {
    await assert.rejects(createWorktree(repository, name), /name must match/)
  }
  await absent(join(repository, '.dsh'))
  const result = await createWorktree(repository, 'a'.repeat(48))
  assert.equal(result.worktree.branch, `worktree/${'a'.repeat(48)}`)
})

test('refuses existing branch and any existing target without reuse or deletion', async (t) => {
  const { repository } = await fixture(t)
  const first = await createWorktree(repository, 'taken')
  await assert.rejects(createWorktree(repository, 'taken'), /already exists|already registered/)
  assert.equal(await readFile(join(first.worktree.path, 'file.txt'), 'utf8'), 'committed\n')
  await run(repository, ['branch', 'worktree/branch-only'])
  await assert.rejects(createWorktree(repository, 'branch-only'), /Branch already exists/)
  const root = join(repository, '.dsh', 'worktrees')
  await mkdir(join(root, 'empty'))
  await assert.rejects(createWorktree(repository, 'empty'), { code: 'EEXIST' })
  await writeFile(join(root, 'file'), 'keep')
  await assert.rejects(createWorktree(repository, 'file'), { code: 'EEXIST' })
  assert.equal(await readFile(join(root, 'file'), 'utf8'), 'keep')
})

test('rejects symlink escapes in .dsh, worktrees root, and target', async (t) => {
  for (const level of ['.dsh', 'worktrees', 'target']) {
    await t.test(level, async (t) => {
      const { repository, base } = await fixture(t)
      const outside = join(base, 'outside')
      await mkdir(outside)
      if (level === '.dsh') await symlink(outside, join(repository, '.dsh'), 'dir')
      if (level === 'worktrees') {
        await mkdir(join(repository, '.dsh'))
        await symlink(outside, join(repository, '.dsh', 'worktrees'), 'dir')
      }
      if (level === 'target') {
        await mkdir(join(repository, '.dsh', 'worktrees'), { recursive: true })
        await symlink(outside, join(repository, '.dsh', 'worktrees', 'escape'), 'dir')
      }
      await assert.rejects(createWorktree(repository, 'escape'), /symlinks|EEXIST/)
      await absent(join(outside, 'escape'))
      assert.equal(await run(repository, ['branch', '--list', 'worktree/escape']), '')
    })
  }
})

test('disables post-checkout hooks', async (t) => {
  const { repository, base } = await fixture(t)
  const hooks = join(base, 'hooks')
  await mkdir(hooks)
  const hook = join(hooks, 'post-checkout')
  await writeFile(hook, '#!/bin/sh\nprintf executed > "$0.ran"\n')
  await chmod(hook, 0o700)
  await run(repository, ['config', 'core.hooksPath', hooks])
  await createWorktree(repository, 'safe-hooks')
  await absent(`${hook}.ran`)
})

test('refuses configured external checkout filters before any creation', async (t) => {
  for (const type of ['smudge', 'process']) {
    await t.test(type, async (t) => {
      const { repository } = await fixture(t)
      await run(repository, ['config', `filter.unsafe.${type}`, 'false'])
      await assert.rejects(createWorktree(repository, 'filtered'), /checkout filters/)
      await absent(join(repository, '.dsh'))
      assert.equal(await run(repository, ['branch', '--list', 'worktree/filtered']), '')
    })
  }
})

test('refuses filters activated only by the new worktree conditional config', async (t) => {
  for (const condition of ['onbranch', 'gitdir']) {
    for (const type of ['smudge', 'process']) {
      await t.test(`${condition} ${type}`, async (t) => {
        const { repository, base } = await fixture(t)
        await writeFile(join(repository, '.gitattributes'), '*.txt filter=unsafe\n')
        await run(repository, ['add', '--', '.gitattributes'])
        await run(repository, ['commit', '--quiet', '-m', 'filter attributes'])
        const filter = join(base, 'external-filter')
        await writeFile(filter, '#!/bin/sh\nprintf executed > "$0.ran"\ncat\n')
        await chmod(filter, 0o700)
        const config = join(base, 'conditional.config')
        await run(repository, ['config', '--file', config, `filter.unsafe.${type}`, JSON.stringify(filter)])
        const predicate = condition === 'onbranch'
          ? 'onbranch:worktree/**'
          : `gitdir:${join(repository, '.git', 'worktrees')}/**`
        await run(repository, ['config', `includeIf.${predicate}.path`, config])
        // The parent has no filter: only registration of the new checkout makes it effective.
        await assert.rejects(run(repository, ['config', '--get', `filter.unsafe.${type}`]))
        await assert.rejects(createWorktree(repository, 'conditional'), /checkout filters/)
        const target = join(repository, '.dsh', 'worktrees', 'conditional')
        assert.equal(await run(target, ['config', '--get', `filter.unsafe.${type}`]), JSON.stringify(filter))
        await absent(`${filter}.ran`)
        await absent(join(target, 'file.txt'))
        assert.equal(await run(repository, ['branch', '--show-current']), 'main')
        // Failures retain the registered checkout and branch; never destructively roll back.
        assert.equal(await run(repository, ['rev-parse', 'refs/heads/worktree/conditional']), await run(repository, ['rev-parse', 'HEAD']))
        assert.equal((await listWorktrees(repository)).worktrees.some((row) => row.path === target), true)
      })
    }
  }
})

test('porcelain -z preserves unusual paths and parses detached, locked, prunable flags', async (t) => {
  const { repository, base } = await fixture(t)
  const unusual = join(base, 'space \t newline\n"quote"')
  await run(repository, ['worktree', 'add', '--quiet', '-b', 'unusual', '--', unusual, 'HEAD'])
  await run(repository, ['worktree', 'lock', '--reason', 'maintenance\nuntil later', '--', unusual])
  const detached = join(base, 'detached')
  await run(repository, ['worktree', 'add', '--quiet', '--detach', '--', detached, 'HEAD'])
  const removed = join(base, 'removed')
  await run(repository, ['worktree', 'add', '--quiet', '-b', 'removed', '--', removed, 'HEAD'])
  await rm(removed, { recursive: true })
  const result = await listWorktrees(repository)
  assert.equal(result.worktrees.length, 4)
  assert.equal(result.worktrees.find((row) => row.path === unusual).locked, true)
  assert.equal(result.worktrees.find((row) => row.path === unusual).branch, 'unusual')
  const detachedRow = result.worktrees.find((row) => row.path === detached)
  assert.equal(detachedRow.detached, true)
  assert.equal(detachedRow.branch, null)
  assert.equal(result.worktrees.find((row) => row.path === removed).prunable, true)
  await assert.rejects(resolveWorktree(repository, unusual), /locked/)
  assert.equal((await resolveWorktree(repository, detached)).worktree.detached, true)
})

test('resolves only registered linked roots of the same repository', async (t) => {
  const { repository, base } = await fixture(t)
  const created = await createWorktree(repository, 'worker')
  const path = created.worktree.path
  await assert.rejects(resolveWorktree(repository, repository), /original or current/)
  await assert.rejects(resolveWorktree(path, path), /original or current/)
  await mkdir(join(path, 'subdir'))
  await assert.rejects(resolveWorktree(repository, join(path, 'subdir')), /not a registered/)
  const other = join(base, 'other')
  await mkdir(other)
  await run(other, ['init', '--quiet'])
  await assert.rejects(resolveWorktree(repository, other), /not a registered/)
  const alias = join(base, 'alias')
  await symlink(path, alias, 'dir')
  assert.equal((await resolveWorktree(repository, alias)).worktree.path, path)
  assert.equal((await resolveWorktree(repository, '.dsh/worktrees/worker')).worktree.path, path)
})

test('caller in a linked checkout uses its HEAD but original repository managed root', async (t) => {
  const { repository } = await fixture(t)
  const first = await createWorktree(repository, 'first')
  await writeFile(join(first.worktree.path, 'new.txt'), 'next commit\n')
  await run(first.worktree.path, ['add', '--', 'new.txt'])
  await run(first.worktree.path, ['commit', '--quiet', '-m', 'second'])
  const head = await run(first.worktree.path, ['rev-parse', 'HEAD'])
  const second = await createWorktree(first.worktree.path, 'second')
  assert.equal(second.repository, repository)
  assert.equal(second.worktree.path, join(repository, '.dsh', 'worktrees', 'second'))
  assert.equal(second.worktree.head, head)
  const list = await listWorktrees(first.worktree.path)
  assert.equal(list.worktrees.find((row) => row.isCurrent).path, first.worktree.path)
})

test('bare repositories list explicitly and cannot create managed checkouts', async (t) => {
  const { base } = await fixture(t)
  const bare = join(base, 'bare.git')
  await mkdir(bare)
  await run(bare, ['init', '--quiet', '--bare'])
  const listed = await listWorktrees(bare)
  assert.equal(listed.repository, bare)
  assert.equal(listed.worktrees[0].bare, true)
  assert.equal(listed.worktrees[0].head, null)
  await assert.rejects(createWorktree(bare, 'no'), /non-bare/)
})

test('abort-before-start leaves repository untouched', async (t) => {
  const { repository } = await fixture(t)
  const controller = new AbortController()
  controller.abort('cancelled')
  for (const operation of [
    () => createWorktree(repository, 'cancelled', { signal: controller.signal }),
    () => listWorktrees(repository, { signal: controller.signal }),
    () => resolveWorktree(repository, repository, { signal: controller.signal }),
  ]) await assert.rejects(operation(), { name: 'AbortError', code: 'ABORT_ERR' })
  await absent(join(repository, '.dsh'))
})

test('dispatch rejects a managed root replaced by a symlink', async (t) => {
  const { repository, base } = await fixture(t)
  const created = await createWorktree(repository, 'moved')
  const outside = join(base, 'moved-dsh')
  await rename(join(repository, '.dsh'), outside)
  await symlink(outside, join(repository, '.dsh'), 'dir')
  await assert.rejects(resolveWorktree(repository, created.worktree.path), /symlinks/)
  await assert.rejects(resolveWorktree(repository, join(outside, 'worktrees', 'moved')), /symlinks/)
})

test('Git startup failure is reported rather than hanging', async (t) => {
  const { repository } = await fixture(t)
  const previous = process.env.PATH
  try {
    process.env.PATH = ''
    await assert.rejects(listWorktrees(repository), /Unable to start Git/)
  } finally {
    if (previous === undefined) delete process.env.PATH
    else process.env.PATH = previous
  }
})

test('reports non-repositories without creating files', async (t) => {
  const { base } = await fixture(t)
  await assert.rejects(listWorktrees(base), /Git exited/)
  await assert.rejects(createWorktree(base, 'no'), /Git exited/)
  await absent(join(base, '.dsh'))
})
