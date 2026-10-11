import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { devNull, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createWorktree } from '../dist/src/git.js'
import { sourceInfo, inspectOwned, removeOwned, restoreOwned } from '../dist/src/session-git.js'

const execute = promisify(execFile)
let home
let environment
before(async () => {
  environment = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }
  home = await realpath(await mkdtemp(join(tmpdir(), 'dsh-session-git-home-')))
  process.env.HOME = home
  process.env.XDG_CONFIG_HOME = home
})
after(async () => {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  assert.equal(resolve(home), home)
  await rm(home, { recursive: true, force: true })
})

async function run(cwd, args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  )
  const { stdout } = await execute(
    'git',
    ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', '-C', cwd, ...args],
    {
      env: {
        ...env,
        GIT_CONFIG_GLOBAL: devNull,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
    },
  )
  return stdout.replace(/\n$/, '')
}

async function fixture(t, detached = false) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'dsh-session-git-')))
  t.after(async () => {
    assert.equal(resolve(base), base)
    assert.ok(base.startsWith(join(await realpath(tmpdir()), 'dsh-session-git-')))
    await rm(base, { recursive: true, force: true })
  })
  const repository = join(base, 'repo')
  await mkdir(repository)
  await run(repository, ['init', '--quiet', '--initial-branch=main'])
  await run(repository, ['config', 'user.name', 'Test'])
  await run(repository, ['config', 'user.email', 'test@example.invalid'])
  await writeFile(join(repository, 'file.txt'), 'committed\n')
  await writeFile(join(repository, '.gitignore'), 'cache/\n.dsh/\n')
  await run(repository, ['add', '.'])
  await run(repository, ['commit', '--quiet', '-m', 'initial'])
  if (detached) await run(repository, ['checkout', '--detach', '--quiet'])
  const source = await sourceInfo(repository)
  const name = `session-${randomUUID()}`
  const created = await createWorktree(repository, name)
  const record = {
    repository,
    commonDir: source.commonDir,
    path: created.worktree.path,
    branch: created.worktree.branch,
    sourceRef: source.sourceRef,
    head: source.sourceHead,
  }
  return { base, repository, record }
}

async function absent(path) {
  await assert.rejects(lstat(path), { code: 'ENOENT' })
}
async function commitOwned(record) {
  await writeFile(join(record.path, 'file.txt'), 'session commit\n')
  await run(record.path, ['add', '.'])
  await run(record.path, ['commit', '--quiet', '-m', 'session work'])
  record.head = await run(record.path, ['rev-parse', 'HEAD'])
}

test('clean removal deletes only an ancestor of the recorded source branch; restore recreates the exact checkout', async (t) => {
  const { repository, record } = await fixture(t)
  assert.deepEqual(await sourceInfo(repository), {
    repository,
    commonDir: join(repository, '.git'),
    sourceRef: 'refs/heads/main',
    sourceHead: record.head,
  })
  await commitOwned(record)
  await run(repository, ['merge', '--ff-only', '--quiet', record.branch])
  // Current original branch is not the branch against which merge safety is decided.
  await run(repository, ['checkout', '--quiet', '-b', 'other', 'HEAD~1'])
  const preview = await inspectOwned(record)
  assert.equal(preview.dirty, false)
  assert.deepEqual(await removeOwned(record, { fingerprint: preview.fingerprint }), {
    head: record.head,
    branchDeleted: true,
  })
  await absent(record.path)
  assert.equal(await run(repository, ['branch', '--list', record.branch]), '')
  const restored = await restoreOwned(record)
  assert.equal(restored.head, record.head)
  assert.equal((await inspectOwned(record)).dirty, false)
  assert.equal(await readFile(join(record.path, 'file.txt'), 'utf8'), 'session commit\n')
  assert.equal(await run(record.path, ['branch', '--show-current']), record.branch)
  assert.deepEqual(await restoreOwned(record), restored)
  assert.equal(await run(repository, ['branch', '--show-current']), 'other')
})

test('unmerged commits and detached-source branches survive removal and restore', async (t) => {
  for (const detached of [false, true])
    await t.test(detached ? 'detached source' : 'unmerged', async (t) => {
      const { repository, record } = await fixture(t, detached)
      if (!detached) await commitOwned(record)
      else assert.equal((await sourceInfo(repository)).sourceRef, null)
      const saved = record.head
      assert.deepEqual(await removeOwned(record), { head: saved, branchDeleted: false })
      await absent(record.path)
      assert.equal(await run(repository, ['rev-parse', `refs/heads/${record.branch}`]), saved)
      await restoreOwned(record)
      assert.equal(await run(record.path, ['rev-parse', 'HEAD']), saved)
    })
})

test('dirty tracked, ignored, untracked, empty directories and symlinks need exact discard approval', async (t) => {
  const { base, record } = await fixture(t)
  await writeFile(join(record.path, 'file.txt'), 'modified\n')
  await writeFile(join(record.path, 'private.txt'), 'untracked\n')
  await mkdir(join(record.path, 'cache'))
  await writeFile(join(record.path, 'cache', 'secret'), 'ignored\n')
  await mkdir(join(record.path, 'empty'))
  const outside = join(base, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'keep'), 'outside\n')
  await symlink(outside, join(record.path, 'link'))
  const preview = await inspectOwned(record)
  assert.equal(preview.dirty, true)
  for (const path of ['file.txt', 'private.txt', 'cache/secret', 'empty/', 'link'])
    assert.ok(preview.files.includes(path), JSON.stringify(preview.files))
  for (const options of [{}, { fingerprint: preview.fingerprint }, { discard: true }])
    await assert.rejects(removeOwned(record, options), /requires explicit discard/)
  assert.equal(await readFile(join(record.path, 'cache', 'secret'), 'utf8'), 'ignored\n')
  await writeFile(join(record.path, 'cache', 'secret'), 'changed\n')
  await assert.rejects(
    removeOwned(record, { discard: true, fingerprint: preview.fingerprint }),
    /fingerprint changed/,
  )
  const fresh = await inspectOwned(record)
  await removeOwned(record, { discard: true, fingerprint: fresh.fingerprint })
  await absent(record.path)
  assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'outside\n')
})

test('fingerprints detect staged/index-only changes, symlink replacement, and changed HEAD', async (t) => {
  const { record } = await fixture(t)
  await writeFile(join(record.path, 'file.txt'), 'modified\n')
  const first = await inspectOwned(record)
  await run(record.path, ['add', 'file.txt'])
  const staged = await inspectOwned(record)
  assert.notEqual(first.fingerprint, staged.fingerprint)
  await assert.rejects(
    removeOwned(record, { discard: true, fingerprint: first.fingerprint }),
    /fingerprint changed/,
  )
  await symlink('first-target', join(record.path, 'link'))
  const symlinkPreview = await inspectOwned(record)
  // This task creates and verifies the target before deleting its own fixture symlink.
  assert.equal(resolve(join(record.path, 'link')), join(record.path, 'link'))
  assert.equal((await lstat(join(record.path, 'link'))).isSymbolicLink(), true)
  await rm(join(record.path, 'link'))
  await symlink('other-target', join(record.path, 'link'))
  await assert.rejects(
    removeOwned(record, { discard: true, fingerprint: symlinkPreview.fingerprint }),
    /fingerprint changed/,
  )
  await run(record.path, ['commit', '--quiet', '-m', 'new commit'])
  const latest = await inspectOwned(record)
  assert.notEqual(latest.head, record.head)
  await assert.rejects(
    removeOwned(record, { discard: true, fingerprint: latest.fingerprint }),
    /HEAD changed/,
  )
  record.head = latest.head
  await removeOwned(record, { discard: true, fingerprint: latest.fingerprint })
})

test('assume-unchanged content is still dirty and cannot be removed implicitly', async (t) => {
  const { record } = await fixture(t)
  await run(record.path, ['update-index', '--assume-unchanged', 'file.txt'])
  await writeFile(join(record.path, 'file.txt'), 'hidden modified bytes\n')
  assert.equal(await run(record.path, ['status', '--porcelain']), '')
  const preview = await inspectOwned(record)
  assert.equal(preview.dirty, true)
  assert.ok(preview.files.includes('file.txt'))
  await assert.rejects(removeOwned(record), /requires explicit discard/)
})

test('foreign, replaced and symlink checkout roots are rejected without deleting them', async (t) => {
  for (const replacement of ['foreign', 'symlink', 'branch', 'pointer'])
    await t.test(replacement, async (t) => {
      const { base, record } = await fixture(t)
      const preview = await inspectOwned(record)
      if (replacement === 'branch')
        await run(record.path, ['checkout', '--quiet', '-b', 'foreign-branch'])
      else if (replacement === 'pointer')
        await writeFile(join(record.path, '.git'), `gitdir: ${join(record.repository, '.git')}\n`)
      else {
        assert.equal(resolve(record.path), record.path)
        await rename(record.path, join(base, 'saved-owned'))
        if (replacement === 'symlink') await symlink(join(base, 'saved-owned'), record.path, 'dir')
        else {
          await mkdir(record.path)
          await run(record.path, ['init', '--quiet'])
          await writeFile(join(record.path, 'keep'), 'foreign\n')
        }
      }
      await assert.rejects(removeOwned(record, { discard: true, fingerprint: preview.fingerprint }))
      await assert.rejects(restoreOwned(record))
      assert.ok(await lstat(record.path))
      assert.equal(await readFile(join(record.repository, 'file.txt'), 'utf8'), 'committed\n')
    })
})

test('a copied replacement with the same branch and bytes invalidates a cleanup preview', async (t) => {
  const { base, record } = await fixture(t)
  const preview = await inspectOwned(record)
  const saved = join(base, 'saved-checkout')
  assert.equal(resolve(record.path), record.path)
  await rename(record.path, saved)
  await cp(saved, record.path, { recursive: true })
  const replaced = await inspectOwned(record)
  assert.equal(replaced.head, preview.head)
  assert.notEqual(replaced.fingerprint, preview.fingerprint)
  await assert.rejects(
    removeOwned(record, { fingerprint: preview.fingerprint }),
    /fingerprint changed/,
  )
  assert.equal(await readFile(join(record.path, 'file.txt'), 'utf8'), 'committed\n')
})

test('managed root symlinks and malformed ownership records never become removal targets', async (t) => {
  const { base, record } = await fixture(t)
  const root = join(record.repository, '.dsh', 'worktrees')
  const saved = join(base, 'saved-root')
  assert.equal(resolve(root), root)
  await rename(root, saved)
  await symlink(saved, root, 'dir')
  await assert.rejects(inspectOwned(record), /symlinks/)
  await assert.rejects(removeOwned(record, { discard: true, fingerprint: 'anything' }), /symlinks/)
  await assert.rejects(removeOwned({ ...record, path: record.repository }), /Invalid managed/)
  assert.equal(
    await readFile(join(saved, record.path.split('/').at(-1), 'file.txt'), 'utf8'),
    'committed\n',
  )
})

test('restoration refuses changed branches, existing paths, submodules and executable filters', async (t) => {
  for (const unsafe of ['branch', 'path', 'submodule', 'filter'])
    await t.test(unsafe, async (t) => {
      const { repository, record } = await fixture(t)
      await commitOwned(record)
      await removeOwned(record)
      if (unsafe === 'branch')
        await run(repository, ['update-ref', `refs/heads/${record.branch}`, 'main'])
      if (unsafe === 'path') {
        await mkdir(record.path)
        await writeFile(join(record.path, 'keep'), 'preserved')
      }
      if (unsafe === 'filter')
        await run(repository, ['config', 'filter.unsafe.smudge', 'touch SHOULD_NOT_EXIST'])
      if (unsafe === 'submodule') {
        await run(repository, ['update-index', '--add', '--cacheinfo', `160000,${record.head},sub`])
      }
      await assert.rejects(restoreOwned(record))
      await absent(join(repository, 'SHOULD_NOT_EXIST'))
      if (unsafe === 'path')
        assert.equal(await readFile(join(record.path, 'keep'), 'utf8'), 'preserved')
      else await absent(record.path)
    })
})

test('restore disables checkout hooks and refuses worktree-specific checkout filters', async (t) => {
  const { base, repository, record } = await fixture(t)
  await removeOwned(record)
  const hooks = join(base, 'hooks')
  await mkdir(hooks)
  const hook = join(hooks, 'post-checkout')
  await writeFile(hook, '#!/bin/sh\ntouch "$0.ran"\n')
  await chmod(hook, 0o700)
  await run(repository, ['config', 'core.hooksPath', hooks])
  await restoreOwned(record)
  await absent(hook + '.ran')
  await removeOwned(record)
  const config = join(base, 'conditional-config')
  await writeFile(config, '[filter "evil"]\nsmudge = touch SHOULD_NOT_EXIST\n')
  await run(repository, ['config', `includeIf.onbranch:${record.branch}.path`, config])
  await assert.rejects(restoreOwned(record), /checkout filters/)
  await absent(join(record.path, 'file.txt'))
  await absent(join(record.path, 'SHOULD_NOT_EXIST'))
})

test('nested repositories and bounded snapshot overflow preserve the checkout', async (t) => {
  const { record } = await fixture(t)
  await mkdir(join(record.path, 'nested'))
  await mkdir(join(record.path, 'nested', '.git'))
  await assert.rejects(inspectOwned(record), /Nested Git/)
  // Only this fixture's known nested metadata is removed to test the independent size bound.
  const nested = join(record.path, 'nested')
  assert.equal(resolve(nested), nested)
  await rm(nested, { recursive: true })
  const large = join(record.path, 'large')
  await writeFile(large, '')
  await truncate(large, 64 * 1024 * 1024 + 1)
  await assert.rejects(inspectOwned(record), /64 MiB/)
  await assert.rejects(removeOwned(record, { discard: true, fingerprint: 'anything' }), /64 MiB/)
  assert.equal((await lstat(large)).size, 64 * 1024 * 1024 + 1)
  assert.equal(await readFile(join(record.path, 'file.txt'), 'utf8'), 'committed\n')
})

test('entry-count overflow refuses cleanup before any removal', async (t) => {
  const { record } = await fixture(t)
  const many = join(record.path, 'many')
  await mkdir(many)
  for (let start = 0; start < 10_001; start += 100) {
    await Promise.all(
      Array.from({ length: Math.min(100, 10_001 - start) }, (_, offset) =>
        writeFile(join(many, String(start + offset)), ''),
      ),
    )
  }
  await assert.rejects(inspectOwned(record), /10000 entries/)
  await assert.rejects(
    removeOwned(record, { discard: true, fingerprint: 'anything' }),
    /10000 entries/,
  )
  assert.ok(await lstat(join(many, '10000')))
})

test('an aborted removal never mutates an owned checkout', async (t) => {
  const { record } = await fixture(t)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(removeOwned(record, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(await readFile(join(record.path, 'file.txt'), 'utf8'), 'committed\n')
})

test('restoration survives source-branch deletion and expired reflogs after merged cleanup', async (t) => {
  const { repository, record } = await fixture(t)
  await commitOwned(record)
  await run(repository, ['merge', '--ff-only', record.branch])
  assert.equal((await removeOwned(record)).branchDeleted, true)
  await run(repository, ['checkout', '--orphan', 'replacement'])
  await run(repository, ['rm', '-rf', '--cached', '.'])
  await run(repository, ['commit', '--allow-empty', '-m', 'new root'])
  await run(repository, ['branch', '-D', 'main'])
  await run(repository, ['reflog', 'expire', '--expire=now', '--all'])
  await run(repository, ['gc', '--prune=now'])
  await restoreOwned(record)
  assert.equal(await run(record.path, ['rev-parse', 'HEAD']), record.head)
  assert.equal(await readFile(join(record.path, 'file.txt'), 'utf8'), 'session commit\n')
})
