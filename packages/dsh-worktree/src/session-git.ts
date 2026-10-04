import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readdir, readlink, realpath, rmdir } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { SignalOptions } from '../shared/contracts.js'
import {
  canonical,
  context,
  git,
  refuseCheckoutFilters,
  singleLine,
  validateManagedRoot,
} from './git.js'

/** Persist these canonical paths and refs at creation. Refresh head from the cleanup preview. */
export interface GitOwnership {
  repository: string
  commonDir: string
  path: string
  branch: string
  sourceRef: string | null
  head: string
}

export interface OwnedInspection {
  head: string
  fingerprint: string
  dirty: boolean
  files: string[]
}

type AuthorizedMutation = SignalOptions & { authorize?: () => void }

const SESSION = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const MAX_ENTRIES = 10_000
const MAX_BYTES = 64 * 1024 * 1024

function checkAbort(signal?: AbortSignal) {
  signal?.throwIfAborted()
}

function code(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

async function missing(path: string) {
  try {
    await lstat(path)
    return false
  } catch (error) {
    if (code(error) !== 'ENOENT') throw error
    return true
  }
}

async function branchHead(repository: string, ref: string, signal?: AbortSignal) {
  const probe = await git(repository, ['show-ref', '--verify', '--quiet', ref], {
    signal,
    accept: [0, 1],
  })
  if (probe.code === 1) return null
  const head = singleLine(
    (await git(repository, ['rev-parse', '--verify', ref], { signal })).stdout,
  )
  if (!OID.test(head)) throw new Error('Invalid Git ref object ID')
  // A symbolic owned ref could delete/restore somebody else's branch.
  const symbolic = await git(repository, ['symbolic-ref', '--quiet', ref], {
    signal,
    accept: [0, 1],
  })
  if (symbolic.code === 0) throw new Error('Owned and source branches must not be symbolic refs')
  return head
}

export async function sourceInfo(cwd: string, { signal }: SignalOptions = {}) {
  const info = await context(cwd, signal)
  if (info.commonDir !== join(info.repository, '.git'))
    throw new Error('Session lifecycle refuses foreign original Git directories')
  const current = info.worktrees.find((row) => row.isCurrent)
  if (!current || current.bare) throw new Error('Session worktrees require a non-bare checkout')
  const sourceHead = singleLine(
    (await git(current.path, ['rev-parse', '--verify', 'HEAD^{commit}'], { signal })).stdout,
  )
  const ref = await git(current.path, ['symbolic-ref', '--quiet', 'HEAD'], {
    signal,
    accept: [0, 1],
  })
  const sourceRef = ref.code === 1 ? null : singleLine(ref.stdout)
  if (sourceRef !== null && !sourceRef.startsWith('refs/heads/'))
    throw new Error('Source HEAD must name a local branch or be detached')
  if (sourceRef !== null && (await branchHead(current.path, sourceRef, signal)) !== sourceHead)
    throw new Error('Source HEAD changed during inspection')
  return { repository: info.repository, commonDir: info.commonDir, sourceRef, sourceHead }
}

/** Keep task-owned nested checkouts out of the source index without changing
 * tracked project files or global Git configuration. Only append a fixed rule
 * to this conventional repository's verified local metadata file.
 */
export async function excludeSessionCheckouts(
  cwd: string,
  { signal, authorize }: AuthorizedMutation = {},
) {
  const info = await sourceInfo(cwd, { signal })
  const probe = () =>
    git(info.repository, ['check-ignore', '--quiet', '--', '.dsh/worktrees/session-probe'], {
      signal,
      accept: [0, 1],
    })
  if ((await probe()).code === 0) return
  const directory = join(info.commonDir, 'info')
  const stat = await lstat(directory)
  if (stat.isSymbolicLink() || !stat.isDirectory() || (await realpath(directory)) !== directory)
    throw new Error('Unsafe repository-local ignore metadata directory')
  const path = join(directory, 'exclude')
  let handle
  try {
    const existing = await lstat(path)
    if (!existing.isFile() || existing.isSymbolicLink() || existing.size > 1024 * 1024)
      throw new Error('Unsafe repository-local ignore metadata file')
    handle = await open(path, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW)
    const opened = await handle.stat()
    if (opened.dev !== existing.dev || opened.ino !== existing.ino)
      throw new Error('Repository-local ignore metadata changed')
  } catch (error) {
    if (code(error) !== 'ENOENT') throw error
    handle = await open(
      path,
      constants.O_RDWR |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    )
  }
  try {
    const buffer = Buffer.alloc(1024 * 1024 + 1)
    const read = await handle.read(buffer, 0, buffer.length, 0)
    if (read.bytesRead > 1024 * 1024 || (await handle.stat()).size > 1024 * 1024)
      throw new Error('Repository-local ignore metadata exceeds 1 MiB')
    const before = buffer.subarray(0, read.bytesRead).toString('utf8')
    checkAbort(signal)
    authorize?.()
    await handle.writeFile(`${before && !before.endsWith('\n') ? '\n' : ''}/.dsh/worktrees/\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
  if ((await probe()).code !== 0)
    throw new Error('Managed checkouts could not be excluded from the source index')
}

async function ownership(record: GitOwnership, signal?: AbortSignal) {
  checkAbort(signal)
  const name = basename(record.path)
  if (
    !SESSION.test(name) ||
    record.path !== join(record.repository, '.dsh', 'worktrees', name) ||
    record.branch !== `worktree/${name}` ||
    !OID.test(record.head) ||
    (record.sourceRef !== null && !record.sourceRef.startsWith('refs/heads/'))
  )
    throw new Error('Invalid managed session ownership record')
  if (record.commonDir !== join(record.repository, '.git'))
    throw new Error('Session lifecycle refuses foreign original Git directories')
  if (
    (await canonical(record.repository)) !== record.repository ||
    (await canonical(record.commonDir)) !== record.commonDir
  )
    throw new Error('Recorded repository paths changed or contain symlinks')
  if (record.sourceRef !== null) {
    const valid = await git(record.repository, ['check-ref-format', record.sourceRef], {
      signal,
      accept: [0, 1],
    })
    if (valid.code !== 0) throw new Error('Invalid recorded source branch ref')
  }
  const info = await context(record.repository, signal)
  if (info.repository !== record.repository || info.commonDir !== record.commonDir)
    throw new Error('Recorded repository/common directory changed')
  await validateManagedRoot(record.repository, dirname(record.path))
  // Never target the original checkout, even if a malformed record claimed ownership.
  if (info.worktrees[0]?.path === record.path) throw new Error('Original checkout is not owned')
  return info
}

async function regular(path: string) {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe Git metadata: ${path}`)
  return stat
}

async function readMetadata(path: string) {
  const stat = await regular(path)
  if (stat.size > 64 * 1024) throw new Error('Git pointer metadata exceeds 64 KiB')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const buffer = Buffer.alloc(64 * 1024 + 1)
    const result = await handle.read(buffer, 0, buffer.length, 0)
    if (
      result.bytesRead > 64 * 1024 ||
      JSON.stringify(identity(await handle.stat())) !== JSON.stringify(identity(stat))
    )
      throw new Error('Git pointer metadata changed or exceeds 64 KiB')
    return buffer.subarray(0, result.bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function verified(record: GitOwnership, signal?: AbortSignal) {
  const info = await ownership(record, signal)
  const rootStat = await lstat(record.path)
  if (
    rootStat.isSymbolicLink() ||
    !rootStat.isDirectory() ||
    (await realpath(record.path)) !== record.path
  )
    throw new Error('Owned checkout root changed or is a symlink')
  const index = info.registeredPaths.indexOf(record.path)
  const row = index < 0 ? undefined : info.worktrees[index]
  if (
    !row ||
    row.path !== record.path ||
    row.branch !== record.branch ||
    row.bare ||
    row.locked ||
    row.prunable
  )
    throw new Error('Owned checkout membership or branch changed')
  await regular(join(record.path, '.git'))
  const pointer = await readMetadata(join(record.path, '.git'))
  if (!pointer.startsWith('gitdir: ') || !pointer.endsWith('\n'))
    throw new Error('Owned checkout has an unsafe Git directory pointer')
  const admin = resolve(record.path, pointer.slice(8, -1))
  if (dirname(admin) !== join(record.commonDir, 'worktrees') || (await canonical(admin)) !== admin)
    throw new Error('Owned checkout has a foreign Git directory')
  if ((await canonical(dirname(admin))) !== dirname(admin))
    throw new Error('Git worktrees metadata contains symlinks')
  for (const name of ['gitdir', 'commondir', 'HEAD', 'index']) await regular(join(admin, name))
  if (
    singleLine(await readMetadata(join(admin, 'gitdir'))) !== join(record.path, '.git') ||
    (await canonical(resolve(admin, singleLine(await readMetadata(join(admin, 'commondir')))))) !==
      record.commonDir
  )
    throw new Error('Owned checkout metadata backlink changed')
  const actual = await context(record.path, signal)
  const current = actual.worktrees.find((item) => item.isCurrent)
  if (
    actual.repository !== record.repository ||
    actual.commonDir !== record.commonDir ||
    current?.path !== record.path
  )
    throw new Error('Owned checkout belongs to a different repository')
  const head = singleLine(
    (await git(record.path, ['rev-parse', '--verify', 'HEAD^{commit}'], { signal })).stdout,
  )
  const ref = singleLine((await git(record.path, ['symbolic-ref', 'HEAD'], { signal })).stdout)
  if (
    ref !== `refs/heads/${record.branch}` ||
    head !== row.head ||
    (await branchHead(record.repository, ref, signal)) !== head
  )
    throw new Error('Owned checkout HEAD or branch changed')
  await refuseExternalFilters(record.path, signal)
  await refuseSubmodules(record.path, head, signal)
  return { head, admin, rootStat }
}

async function refuseExternalFilters(path: string, signal?: AbortSignal) {
  const result = await git(
    path,
    ['config', '--null', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$'],
    { signal, accept: [0, 1] },
  )
  if (
    result.stdout.split('\0').some((entry) => entry && entry.slice(entry.indexOf('\n') + 1).trim())
  )
    throw new Error('Session lifecycle refuses external Git filters')
}

async function refuseSubmodules(path: string, head: string, signal?: AbortSignal) {
  const index = await git(path, ['ls-files', '--stage', '-z'], { signal })
  const tree = await git(path, ['ls-tree', '-r', '-z', head], { signal })
  if (
    [index.stdout, tree.stdout].some((output) =>
      output.split('\0').some((entry) => entry.startsWith('160000 ')),
    )
  )
    throw new Error('Session lifecycle refuses submodules')
}

function identity(stat: Stats) {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs]
}

/** Hash actual bytes, not Git's stat cache. Never follow a tree symlink. */
async function snapshot(record: GitOwnership, signal?: AbortSignal): Promise<OwnedInspection> {
  const before = await verified(record, signal)
  const hash = createHash('sha256')
  let entries = 0
  let bytes = 0
  const directories: string[] = []
  const content = new Map<string, { oid: string; mode: string }>()
  const frame = (value: string | Buffer) => {
    hash.update(String(Buffer.byteLength(value)) + ':')
    hash.update(value)
  }
  const add = async (path: string, label: string, tree: boolean) => {
    checkAbort(signal)
    if (++entries > MAX_ENTRIES)
      throw new Error(`Snapshot exceeds ${MAX_ENTRIES} entries; checkout preserved`)
    const stat = await lstat(path)
    frame(label)
    frame(JSON.stringify(identity(stat)))
    if (stat.isSymbolicLink()) {
      if (!tree) throw new Error('Unsafe symlink Git metadata')
      const target = await readlink(path, { encoding: 'buffer' })
      bytes += target.length
      if (bytes > MAX_BYTES) throw new Error('Snapshot exceeds 64 MiB; checkout preserved')
      frame(target)
      if (tree)
        content.set(path.slice(record.path.length + 1), {
          oid: createHash(before.head.length === 40 ? 'sha1' : 'sha256')
            .update(`blob ${target.length}\0`)
            .update(target)
            .digest('hex'),
          mode: '120000',
        })
    } else if (stat.isDirectory()) {
      if (tree && path !== record.path) directories.push(path.slice(record.path.length + 1))
      const children = (await readdir(path)).sort()
      for (const child of children) {
        if (tree && path === record.path && child === '.git') continue
        if (tree && child === '.git')
          throw new Error('Nested Git directories are unsafe for cleanup')
        await add(join(path, child), `${label}/${child}`, tree)
      }
    } else if (stat.isFile()) {
      bytes += stat.size
      if (bytes > MAX_BYTES) throw new Error('Snapshot exceeds 64 MiB; checkout preserved')
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        if (JSON.stringify(identity(await handle.stat())) !== JSON.stringify(identity(stat)))
          throw new Error('File changed during snapshot')
        // Read a bounded amount even if a concurrent writer grows the file.
        let remaining = stat.size
        const blob = createHash(before.head.length === 40 ? 'sha1' : 'sha256').update(
          `blob ${stat.size}\0`,
        )
        const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(1, remaining)))
        frame(String(remaining))
        while (remaining > 0) {
          checkAbort(signal)
          const read = await handle.read(buffer, 0, Math.min(buffer.length, remaining), null)
          if (!read.bytesRead) throw new Error('File changed during snapshot')
          hash.update(buffer.subarray(0, read.bytesRead))
          blob.update(buffer.subarray(0, read.bytesRead))
          remaining -= read.bytesRead
        }
        if (tree)
          content.set(path.slice(record.path.length + 1), {
            oid: blob.digest('hex'),
            mode: stat.mode & 0o111 ? '100755' : '100644',
          })
        if (JSON.stringify(identity(await handle.stat())) !== JSON.stringify(identity(stat)))
          throw new Error('File changed during snapshot')
      } finally {
        await handle.close()
      }
    } else throw new Error('Snapshot refuses special files; checkout preserved')
    if (JSON.stringify(identity(await lstat(path))) !== JSON.stringify(identity(stat)))
      throw new Error('Checkout changed during snapshot')
  }
  frame(
    JSON.stringify([
      record.repository,
      record.commonDir,
      record.path,
      record.branch,
      record.sourceRef,
    ]),
  )
  frame(before.head)
  await add(record.path, 'tree', true)
  await add(join(record.path, '.git'), 'git-pointer', false)
  for (const name of (await readdir(before.admin)).sort()) {
    if (name === 'HEAD' || name === 'index' || name.startsWith('sharedindex.'))
      await add(join(before.admin, name), `metadata/${name}`, false)
  }
  const status = (
    await git(
      record.path,
      [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--ignored=traditional',
        '--ignore-submodules=none',
      ],
      { signal },
    )
  ).stdout
  const files: string[] = []
  const tokens = status.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i]
    if (!entry) continue
    files.push(entry.slice(3))
    if (/[RC]/.test(entry.slice(0, 2))) {
      const from = tokens[++i]
      if (from) files.push(from)
    }
  }
  // Git considers empty untracked/ignored directories clean, but removal loses them.
  const tracked = new Set<string>()
  const index = (await git(record.path, ['ls-files', '--stage', '-z'], { signal })).stdout
  for (const entry of index.split('\0')) {
    if (!entry) continue
    const tab = entry.indexOf('\t')
    const [mode, oid, stage] = entry.slice(0, tab).split(' ')
    if (tab < 0 || stage !== '0') throw new Error('Unsafe or unmerged index; checkout preserved')
    const path = entry.slice(tab + 1)
    tracked.add(path)
    const actual = content.get(path)
    // Raw byte comparison is deliberately conservative for line-ending conversions.
    // It also catches assume-unchanged, skip-worktree and forged stat-cache matches.
    if (!actual || actual.oid !== oid || actual.mode !== mode) files.push(path)
  }
  const trackedDirectories = new Set<string>()
  for (const file of tracked) {
    let parent = dirname(file)
    while (parent !== '.') {
      trackedDirectories.add(parent)
      parent = dirname(parent)
    }
  }
  for (const directory of directories) {
    if (
      !trackedDirectories.has(directory) &&
      !files.some((file) => file === directory || file.startsWith(directory + '/'))
    )
      files.push(directory + '/')
  }
  const after = await verified(record, signal)
  if (
    before.head !== after.head ||
    before.admin !== after.admin ||
    JSON.stringify(identity(before.rootStat)) !== JSON.stringify(identity(after.rootStat))
  )
    throw new Error('Owned checkout changed during inspection')
  return {
    head: before.head,
    fingerprint: hash.digest('hex'),
    dirty: files.length > 0,
    files: [...new Set(files)].sort(),
  }
}

/** Lightweight execution guard: validate Git ownership without scanning user
 * files. Dependencies/build outputs may exceed destructive-preview limits and
 * must not make an otherwise valid interactive session unusable.
 */
export async function assertOwnedCheckout(record: GitOwnership, { signal }: SignalOptions = {}) {
  await verified(record, signal)
}

export async function inspectOwned(record: GitOwnership, { signal }: SignalOptions = {}) {
  return snapshot({ ...record }, signal)
}

/** Discard is valid only for the exact, explicitly previewed dirty content. */
export async function removeOwned(
  record: GitOwnership,
  {
    fingerprint,
    discard = false,
    signal,
    authorize,
  }: AuthorizedMutation & { fingerprint?: string; discard?: boolean } = {},
) {
  record = { ...record }
  const preview = await snapshot(record, signal)
  if (preview.head !== record.head) throw new Error('Owned HEAD changed; refresh cleanup preview')
  if (fingerprint !== undefined && fingerprint !== preview.fingerprint)
    throw new Error('Cleanup fingerprint changed; checkout preserved')
  if (preview.dirty && (!discard || fingerprint !== preview.fingerprint))
    throw new Error(
      'Dirty, untracked or ignored content requires explicit discard and matching fingerprint',
    )
  const final = await snapshot(record, signal)
  if (final.fingerprint !== preview.fingerprint)
    throw new Error('Cleanup fingerprint changed; checkout preserved')
  checkAbort(signal)
  // Keep committed restoration points reachable after merged-branch deletion,
  // even if the source is later rewritten and Git expires its reflogs.
  authorize?.()
  const recoveryRef = `refs/dsh/worktree-sessions/${basename(record.path)}/${preview.head}`
  const recovered = await branchHead(record.repository, recoveryRef, signal)
  if (recovered !== null && recovered !== preview.head)
    throw new Error('The owned recovery ref was replaced; checkout preserved')
  if (recovered === null) {
    authorize?.()
    await git(
      record.repository,
      [
        '-c',
        `core.hooksPath=${devNull}`,
        'update-ref',
        '--no-deref',
        recoveryRef,
        preview.head,
        '0'.repeat(preview.head.length),
      ],
      { signal },
    )
  }
  authorize?.()
  await git(
    record.repository,
    ['worktree', 'remove', ...(preview.dirty ? ['--force'] : []), '--', record.path],
    { signal },
  )
  let branchDeleted = false
  const ref = `refs/heads/${record.branch}`
  if (
    record.sourceRef !== null &&
    record.sourceRef !== ref &&
    (await branchHead(record.repository, ref, signal)) === preview.head
  ) {
    const source = await branchHead(record.repository, record.sourceRef, signal)
    if (source !== null) {
      const merged = await git(
        record.repository,
        ['merge-base', '--is-ancestor', preview.head, source],
        { signal, accept: [0, 1] },
      )
      const info = await ownership(record, signal)
      if (
        merged.code === 0 &&
        !info.worktrees.some((row) => row.branch === record.branch) &&
        (await branchHead(record.repository, record.sourceRef, signal)) === source
      ) {
        authorize?.()
        // One ref transaction verifies the source and the expected-old owned OID.
        // A concurrently moved source cannot turn this into an unmerged deletion.
        await git(record.repository, ['-c', `core.hooksPath=${devNull}`, 'update-ref', '--stdin'], {
          signal,
          input: `start\nverify ${JSON.stringify(record.sourceRef)} ${source}\ndelete ${ref} ${preview.head}\nprepare\ncommit\n`,
        })
        branchDeleted = true
      }
    }
  }
  return { head: preview.head, branchDeleted }
}

/** Recover a completed removal after a lost Git response or storage write.
 * An absent path alone is not proof: require our immutable recovery checkpoint
 * and absence from the same repository's registered-worktree catalog.
 */
export async function removalOutcome(record: GitOwnership, { signal }: SignalOptions = {}) {
  const info = await ownership(record, signal)
  if (!(await missing(record.path)) || info.registeredPaths.includes(record.path)) return null
  const recoveryRef = `refs/dsh/worktree-sessions/${basename(record.path)}/${record.head}`
  if ((await branchHead(record.repository, recoveryRef, signal)) !== record.head) return null
  return {
    head: record.head,
    branchDeleted:
      (await branchHead(record.repository, `refs/heads/${record.branch}`, signal)) === null,
  }
}

/** Restore committed work only. Never reset or overwrite an existing checkout. */
export async function restoreOwned(
  record: GitOwnership,
  { signal, authorize }: AuthorizedMutation = {},
) {
  record = { ...record }
  const info = await ownership(record, signal)
  if (!(await missing(record.path))) {
    // Opening a retained checkout must preserve new commits and large build
    // outputs. Ownership is sufficient; destructive snapshot limits do not
    // apply to this non-mutating recovery path.
    const existing = await verified(record, signal)
    authorize?.()
    return { head: existing.head }
  }
  if (info.registeredPaths.includes(record.path))
    throw new Error('Missing checkout remains registered; refusing restore')
  if (info.worktrees.some((row) => row.branch === record.branch))
    throw new Error('Owned branch is used by another checkout')
  const ref = `refs/heads/${record.branch}`
  const saved = await branchHead(record.repository, ref, signal)
  if (saved !== null && saved !== record.head)
    throw new Error('Owned branch changed; refusing restore')
  await git(record.repository, ['cat-file', '-e', `${record.head}^{commit}`], { signal })
  await refuseCheckoutFilters(record.repository, signal)
  await refuseSubmodules(record.repository, record.head, signal)
  authorize?.()
  await mkdir(record.path, { mode: 0o700 })
  const reserved = await lstat(record.path)
  const hooks = await mkdtemp(join(await realpath(tmpdir()), 'dsh-session-hooks-'))
  const config = ['-c', `core.hooksPath=${hooks}`, '-c', 'submodule.recurse=false']
  try {
    await ownership(record, signal)
    if ((await realpath(record.path)) !== record.path)
      throw new Error('Restore path escaped managed root')
    authorize?.()
    await git(
      record.repository,
      [
        ...config,
        'worktree',
        'add',
        '--no-checkout',
        ...(saved === null ? ['-b', record.branch] : []),
        '--',
        record.path,
        saved === null ? record.head : record.branch,
      ],
      { signal },
    )
    await validateManagedRoot(record.repository, dirname(record.path))
    if ((await realpath(record.path)) !== record.path)
      throw new Error('Restore path escaped managed root')
    await refuseCheckoutFilters(record.path, signal)
    authorize?.()
    await git(record.path, [...config, 'read-tree', record.head], { signal })
    authorize?.()
    await git(record.path, [...config, 'checkout-index', '--all'], { signal })
    const result = await snapshot(record, signal)
    if (result.head !== record.head) throw new Error('Restored HEAD changed')
    return { head: result.head }
  } catch (error) {
    // Preserve populated/registered state after any uncertain Git outcome.
    const stat = await lstat(record.path)
    if (!stat.isSymbolicLink() && stat.dev === reserved.dev && stat.ino === reserved.ino) {
      try {
        await rmdir(record.path)
      } catch {
        /* Not empty: preserve it. */
      }
    }
    throw error
  } finally {
    try {
      await rmdir(hooks)
    } catch {
      /* Never recursively delete unexpected content. */
    }
  }
}
