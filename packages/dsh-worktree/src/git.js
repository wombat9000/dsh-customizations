import { spawn } from 'node:child_process'
import { lstat, mkdir, mkdtemp, realpath, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/
const TIMEOUT_MS = 30_000
const OUTPUT_LIMIT = 2 * 1024 * 1024

function abortError(signal) {
  const error = new Error('Git operation aborted', { cause: signal?.reason })
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError(signal)
}

// Do not inherit environment variables that redirect Git to a different repository,
// inject configuration, or substitute Git executables. Normal on-disk config remains.
function gitEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }
}

function git(cwd, args, { signal, accept = [0] } = {}) {
  checkAbort(signal)
  return new Promise((resolveResult, reject) => {
    const grouped = process.platform !== 'win32'
    const child = spawn('git', ['-c', 'core.fsmonitor=false', '-C', cwd, ...args], {
      env: gitEnvironment(), stdio: ['ignore', 'pipe', 'pipe'], detached: grouped,
    })
    let failure
    let bytes = 0
    const stdout = []
    const stderr = []
    let forceTimer
    const kill = (signalName) => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, signalName)
        else child.kill(signalName)
      } catch (error) {
        if (error.code !== 'ESRCH') failure ??= error
      }
    }
    const stop = (error) => {
      if (failure) return
      failure = error
      kill('SIGTERM')
      forceTimer = setTimeout(() => kill('SIGKILL'), 250)
      forceTimer.unref()
    }
    const timer = setTimeout(() => stop(new Error(`Git operation exceeded ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
    const onAbort = () => stop(abortError(signal))
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    const collect = (parts) => (chunk) => {
      bytes += chunk.length
      if (bytes > OUTPUT_LIMIT) {
        stop(new Error(`Git output exceeded ${OUTPUT_LIMIT} bytes`))
        return
      }
      parts.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.once('error', (error) => { failure ??= new Error(`Unable to start Git: ${error.message}`, { cause: error }) })
    child.once('close', (code) => {
      clearTimeout(timer)
      clearTimeout(forceTimer)
      signal?.removeEventListener('abort', onAbort)
      if (failure) return reject(failure)
      const out = Buffer.concat(stdout).toString('utf8')
      const err = Buffer.concat(stderr).toString('utf8')
      if (!accept.includes(code)) {
        return reject(new Error(`Git exited with code ${code}: ${err.slice(0, 2048).trim()}`))
      }
      resolveResult({ stdout: out, code })
    })
  })
}

function singleLine(value) {
  // Git terminates path/ref output with exactly one LF. Do not trim path whitespace.
  return value.endsWith('\n') ? value.slice(0, -1) : value
}

function parseWorktrees(output) {
  const rows = []
  let current
  for (const token of output.split('\0')) {
    if (token === '') {
      if (current) rows.push(current)
      current = undefined
      continue
    }
    if (token.startsWith('worktree ')) {
      if (current) throw new Error('Malformed Git worktree output')
      current = {
        path: token.slice(9), branch: null, head: null,
        bare: false, detached: false, locked: false, prunable: false,
      }
    } else {
      if (!current) throw new Error('Malformed Git worktree output')
      if (token.startsWith('HEAD ')) current.head = token.slice(5)
      else if (token.startsWith('branch ')) current.branch = token.slice(7).replace(/^refs\/heads\//, '')
      else if (token === 'bare') current.bare = true
      else if (token === 'detached') current.detached = true
      else if (token === 'locked' || token.startsWith('locked ')) current.locked = true
      else if (token === 'prunable' || token.startsWith('prunable ')) current.prunable = true
    }
  }
  if (current) rows.push(current)
  if (rows.length === 0) throw new Error('Git returned no registered worktrees')
  return rows
}

async function canonical(path) {
  const result = await realpath(path)
  const stat = await lstat(result)
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${path}`)
  return result
}

async function context(cwd, signal) {
  checkAbort(signal)
  const directory = await canonical(cwd)
  const common = singleLine((await git(directory, ['rev-parse', '--git-common-dir'], { signal })).stdout)
  const commonDir = await canonical(resolve(directory, common))
  const bare = singleLine((await git(directory, ['rev-parse', '--is-bare-repository'], { signal })).stdout) === 'true'
  const current = bare ? directory : await canonical(singleLine((await git(directory, ['rev-parse', '--show-toplevel'], { signal })).stdout))
  const rows = parseWorktrees((await git(directory, ['worktree', 'list', '--porcelain', '-z'], { signal })).stdout)
  // Git lists the original checkout first, including for a linked-worktree caller.
  const repository = await canonical(rows[0].path)
  const worktrees = []
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    let path = resolve(row.path)
    try { path = await canonical(path) } catch (error) {
      // Deleted worktrees remain registered and must remain visible for diagnosis.
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    }
    worktrees.push({ ...row, path, isCurrent: path === current, isOriginal: index === 0 })
  }
  return { repository, commonDir, worktrees, registeredPaths: rows.map((row) => resolve(row.path)) }
}

export function parseStatus(output) {
  const tokens = output.split('\0')
  const files = []
  let count = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    const status = token.slice(0, 2)
    const path = token.slice(3)
    const from = /[RC]/.test(status) ? tokens[++i] : undefined
    count++
    if (files.length < 500) files.push({ status, path, ...(from !== undefined ? { from } : {}) })
  }
  return { count, files, truncated: count > files.length }
}

/** Bounded read-only UI inspection. Paths come exclusively from Git membership. */
export async function inspectWorktrees(cwd, { signal } = {}) {
  const info = await context(cwd, signal)
  const rows = info.worktrees.slice(0, 100)
  let next = 0
  const worktrees = new Array(rows.length)
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (next < rows.length) {
      const index = next++
      const row = rows[index]
      let changes
      try {
        if (row.bare || row.prunable) throw new Error('Checkout unavailable')
        const registered = info.registeredPaths[index]
        if ((await lstat(registered)).isSymbolicLink()) throw new Error('Symlink checkout')
        const path = await canonical(registered)
        if (path !== row.path) throw new Error('Checkout moved')
        const actual = singleLine((await git(path, ['rev-parse', '--git-common-dir'], { signal })).stdout)
        if (await canonical(resolve(path, actual)) !== info.commonDir) throw new Error('Repository changed')
        const top = singleLine((await git(path, ['rev-parse', '--show-toplevel'], { signal })).stdout)
        if (await canonical(top) !== path) throw new Error('Checkout root changed')
        // Index refresh can invoke clean/process filters even for read-only status.
        const filters = await git(path, ['config', '--null', '--get-regexp', '^filter\\..*\\.(clean|process)$'], { signal, accept: [0, 1] })
        if (filters.stdout.split('\0').some(entry => entry && entry.slice(entry.indexOf('\n') + 1).trim())) throw new Error('External status filter configured')
        changes = parseStatus((await git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all'], { signal })).stdout)
      } catch {
        checkAbort(signal)
        changes = { error: 'Changed files unavailable for this checkout.' }
      }
      worktrees[index] = { ...row, changes }
    }
  }))
  return { repository: info.repository, worktrees, truncated: info.worktrees.length > rows.length }
}

/** List registered Git checkouts. Detached branches use null; flags are booleans. */
export async function listWorktrees(cwd, { signal } = {}) {
  const { repository, commonDir, worktrees } = await context(cwd, signal)
  return { repository, commonDir, worktrees }
}

async function ensureDirectory(path, signal) {
  checkAbort(signal)
  try { await mkdir(path, { mode: 0o700 }) } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isDirectory() || await realpath(path) !== path) {
    throw new Error(`Managed worktree directory must not contain symlinks: ${path}`)
  }
}

async function validateManagedRoot(repository, root) {
  for (const path of [join(repository, '.dsh'), root]) {
    const stat = await lstat(path)
    if (stat.isSymbolicLink() || !stat.isDirectory() || await realpath(path) !== path) {
      throw new Error(`Managed worktree directory must not contain symlinks: ${path}`)
    }
  }
}

async function refuseCheckoutFilters(cwd, signal) {
  const result = await git(cwd, ['config', '--null', '--get-regexp', '^filter\\..*\\.(smudge|process)$'], { signal, accept: [0, 1] })
  for (const entry of result.stdout.split('\0')) {
    if (!entry) continue
    const separator = entry.indexOf('\n')
    if (separator < 0 || entry.slice(separator + 1).trim() !== '') {
      throw new Error('Worktree creation refuses configured checkout filters (filter.*.smudge/process); these can execute external commands')
    }
  }
}

/** Create a new checkout at the original repository's .dsh/worktrees/<name>.
 * Starts from the caller's HEAD; dirty files are never copied. No branch/checkout
 * rollback is attempted after Git failure, so potentially useful work is retained.
 */
export async function createWorktree(cwd, name, { signal } = {}) {
  if (typeof name !== 'string' || !NAME.test(name)) throw new Error('Worktree name must match /^[a-z0-9][a-z0-9-]{0,47}$/')
  checkAbort(signal)
  const info = await context(cwd, signal)
  const current = info.worktrees.find((row) => row.isCurrent)
  if (!current || current.bare) throw new Error('Worktree creation requires a non-bare current checkout')
  await refuseCheckoutFilters(current.path, signal)
  // Resolve now so a concurrent movement of HEAD cannot silently choose a new base.
  const head = singleLine((await git(current.path, ['rev-parse', '--verify', 'HEAD^{commit}'], { signal })).stdout)
  const branch = `worktree/${name}`
  const branchProbe = await git(current.path, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { signal, accept: [0, 1] })
  if (branchProbe.code === 0) throw new Error(`Branch already exists: ${branch}`)
  const root = join(info.repository, '.dsh', 'worktrees')
  const target = join(root, name)
  if (info.worktrees.some((row) => row.path === target)) throw new Error(`Worktree is already registered: ${target}`)
  await ensureDirectory(join(info.repository, '.dsh'), signal)
  await ensureDirectory(root, signal)
  await validateManagedRoot(info.repository, root)
  checkAbort(signal)
  // Atomic reservation refuses all existing files/directories/symlinks, even empty ones.
  await mkdir(target, { mode: 0o700 })
  const reserved = await lstat(target)
  let hooks
  try {
    await validateManagedRoot(info.repository, root)
    if (await realpath(target) !== target) throw new Error('Worktree target escaped its managed root')
    hooks = await mkdtemp(join(await realpath(tmpdir()), 'dsh-worktree-hooks-'))
    const checkoutConfig = ['-c', `core.hooksPath=${hooks}`, '-c', 'submodule.recurse=false']
    // Registration must precede filter inspection: includeIf.gitdir/onbranch can
    // enable commands only for the new worktree. Do not materialize any files yet.
    await git(current.path, [...checkoutConfig, 'worktree', 'add', '--no-checkout', '-b', branch, '--', target, head], { signal })
    await validateManagedRoot(info.repository, root)
    if (await realpath(target) !== target) throw new Error('Worktree target escaped its managed root')
    await refuseCheckoutFilters(target, signal)
    // Populate only this new checkout, without branch switching, reset, or force.
    // checkout-index refuses to replace any unexpected pre-existing file.
    await git(target, [...checkoutConfig, 'read-tree', head], { signal })
    await git(target, [...checkoutConfig, 'checkout-index', '--all'], { signal })
    await validateManagedRoot(info.repository, root)
    const after = await context(current.path, signal)
    const worktree = after.worktrees.find((row) => row.path === target)
    if (!worktree || worktree.branch !== branch || worktree.head !== head) throw new Error('Created worktree registration could not be verified')
    return { repository: after.repository, commonDir: after.commonDir, worktree }
  } catch (error) {
    // Remove only our still-empty reservation, never a branch or populated checkout.
    try {
      const stat = await lstat(target)
      if (!stat.isSymbolicLink() && stat.dev === reserved.dev && stat.ino === reserved.ino) await rmdir(target)
    } catch { /* Preserve anything Git or another actor has populated. */ }
    throw error
  } finally {
    if (hooks) {
      try { await rmdir(hooks) } catch { /* Never recursively delete an unexpected directory. */ }
    }
  }
}

/** Resolve a registered, usable linked checkout. Relative paths use cwd as base. */
export async function resolveWorktree(cwd, path, { signal } = {}) {
  if (typeof path !== 'string' || path.length === 0) throw new Error('A worktree path is required')
  const info = await context(cwd, signal)
  const selected = await canonical(isAbsolute(path) ? path : resolve(cwd, path))
  const worktree = info.worktrees.find((row) => row.path === selected)
  if (!worktree) throw new Error('Selected directory is not a registered worktree of this repository')
  if (worktree.isOriginal || worktree.isCurrent) throw new Error('Dispatch requires a linked worktree other than the original or current checkout')
  if (worktree.bare || worktree.locked || worktree.prunable) throw new Error('Selected worktree is bare, locked, or prunable')
  const registeredPath = info.registeredPaths[info.worktrees.indexOf(worktree)]
  if ((await lstat(registeredPath)).isSymbolicLink()) throw new Error('Registered worktree root must not be a symlink')
  const managedRoot = join(info.repository, '.dsh', 'worktrees')
  const fromManaged = relative(managedRoot, registeredPath)
  if (fromManaged !== '..' && !fromManaged.startsWith(`..${sep}`) && !isAbsolute(fromManaged)) {
    await validateManagedRoot(info.repository, managedRoot)
  }
  const actual = singleLine((await git(selected, ['rev-parse', '--git-common-dir'], { signal })).stdout)
  if (await canonical(resolve(selected, actual)) !== info.commonDir) throw new Error('Selected worktree belongs to a different Git common directory')
  const top = singleLine((await git(selected, ['rev-parse', '--show-toplevel'], { signal })).stdout)
  if (await canonical(top) !== selected) throw new Error('Selected path is not the root of its registered worktree')
  checkAbort(signal)
  return { repository: info.repository, commonDir: info.commonDir, worktree }
}
