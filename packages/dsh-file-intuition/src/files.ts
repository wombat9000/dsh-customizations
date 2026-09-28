import { createHash } from 'node:crypto'
import type { FileSystem, FsTarget, FsInfo, FsPathInfo } from '@deepseek-ai/dsh-fs'
import {
  LIMITS,
  type Discovery,
  type FileSnapshot,
  type ScoutRequest,
  type SkipReason,
} from './contracts.js'

const excludedDirs = new Set(['node_modules', 'dist', 'build', 'lib', 'coverage', 'vendor'])
const textExtensions = new Set(
  'ts tsx js jsx mjs cjs mts cts py pyi rs go java kt kts c h cc cpp hpp cs rb php swift scala sh bash zsh fish ps1 sql graphql gql html htm css scss sass less vue svelte md mdx rst txt json jsonc yaml yml toml xml ini cfg conf properties csv tsv proto ex exs erl hr lua r jl clj cljs cljc edn dart fs fsx vb sol tf hcl make cmake dockerfile'.split(
    ' ',
  ),
)
const textNames = new Set([
  'readme',
  'license',
  'licence',
  'copying',
  'notice',
  'makefile',
  'dockerfile',
  'justfile',
  'gemfile',
  'rakefile',
])

class Rejected extends Error {
  readonly reason: SkipReason
  constructor(reason: SkipReason) {
    super(`File Intuition file rejected: ${reason}.`)
    this.reason = reason
  }
}
function check(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('File Intuition collection cancelled.')
}
function validatePath(path: string, glob: boolean): string[] {
  if (!path || path.length > 1024 || /[\\\x00-\x1f\x7f:{}\[\]!]/u.test(path))
    throw new Error('Invalid repository-relative path or pattern.')
  const parts = path.split('/')
  if (
    parts.some(
      (p) =>
        !p ||
        p === '.' ||
        p === '..' ||
        (!glob && /[*?]/u.test(p)) ||
        (p.includes('**') && p !== '**'),
    )
  )
    throw new Error('Invalid repository-relative path or pattern.')
  return parts
}
function segmentMatches(pattern: string, name: string): boolean {
  // A wildcard scan avoids regex backtracking on adversarial repeated stars.
  let p = 0
  let n = 0
  let star = -1
  let mark = 0
  while (n < name.length) {
    if (pattern[p] === '?' || (pattern[p] !== '*' && pattern[p] === name[n])) {
      p++
      n++
    } else if (pattern[p] === '*') {
      star = p++
      mark = n
    } else if (star >= 0) {
      p = star + 1
      n = ++mark
    } else return false
  }
  while (pattern[p] === '*') p++
  return p === pattern.length
}
function matcher(parts: string[]) {
  function states(path: string[]): Set<number> {
    let current = new Set([0])
    const expand = (set: Set<number>) => {
      for (const i of set) if (parts[i] === '**') set.add(i + 1)
    }
    expand(current)
    for (const name of path) {
      const next = new Set<number>()
      for (const i of current) {
        if (parts[i] === '**') next.add(i)
        else if (parts[i] !== undefined && segmentMatches(parts[i]!, name)) next.add(i + 1)
      }
      expand(next)
      current = next
    }
    return current
  }
  return {
    matches: (path: string[]) => states(path).has(parts.length),
    descends: (path: string[]) => [...states(path)].some((i) => i < parts.length),
  }
}
function excluded(name: string, directory: boolean): boolean {
  const lower = name.toLowerCase()
  if (lower.startsWith('.') || excludedDirs.has(lower)) return true
  if (directory) return false
  if (/^(?:id_(?:rsa|dsa|ecdsa|ed25519)|authorized_keys|known_hosts)(?:\.|$)/u.test(lower))
    return true
  if (
    /(?:^|[._-])(?:lock|locks)(?:\.|$)/u.test(lower) ||
    /\.(?:pem|key|p12|pfx|der|crt|cer|keystore|jks)$/u.test(lower)
  )
    return true
  const ext = lower.split('.').at(-1) ?? ''
  // Credential implementation source is useful; credential data is not.
  if (
    /(?:credential|secret|token|password|private[-_]?key)/u.test(lower) &&
    [
      'json',
      'jsonc',
      'yaml',
      'yml',
      'toml',
      'xml',
      'ini',
      'cfg',
      'conf',
      'properties',
      'csv',
      'tsv',
      'txt',
      'env',
    ].includes(ext)
  )
    return true
  return !textExtensions.has(ext) && !textNames.has(lower)
}
function sensitive(content: string): boolean {
  // Conservative, deliberately incomplete guard; this is not secret detection certification.
  return (
    /-----BEGIN (?:[A-Z0-9 ]*PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/u.test(content) ||
    /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret[_-]?key)\b["']?\s*[:=]\s*["'][^"'\r\n]{8,}["']/iu.test(
      content,
    ) ||
    /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret[_-]?key|token|secret)\b["']?\s*[:=]\s*[A-Za-z0-9_+/.=-]{12,}(?=\s|$|[,;}])/iu.test(
      content,
    ) ||
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{20,})\b/u.test(
      content,
    )
  )
}
function reason(error: unknown): SkipReason {
  if (error instanceof Rejected) return error.reason
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'FS_TOO_LARGE'
  )
    return 'too_large'
  return 'unreadable'
}
interface Probe {
  target: FsTarget
  info: FsInfo
  pathInfo: FsPathInfo
}

/** Read only through the execution-world filesystem. Never emit fs/observed: the agent has not read these contents. */
export async function collectFiles(
  fs: FileSystem,
  cwd: string,
  request: ScoutRequest,
  signal: AbortSignal,
): Promise<Discovery> {
  check(signal)
  if (!cwd || /[\x00-\x1f\x7f]/u.test(cwd) || !/^(?:\/|[A-Za-z]:[\\/])/u.test(cwd))
    throw new Error('File Intuition requires an absolute session cwd.')
  const batch = request.kind === 'files'
  const parts = validatePath(batch ? request.pattern : request.path, batch)
  if (!batch && parts.length > LIMITS.depth + 1)
    throw new Error('File Intuition path exceeds the depth limit.')
  if (
    batch &&
    (!Number.isSafeInteger(request.maxFiles) ||
      request.maxFiles < 1 ||
      request.maxFiles > LIMITS.maxFiles)
  )
    throw new Error('Invalid File Intuition file budget.')
  const match = matcher(parts)
  const files: FileSnapshot[] = []
  const skips = new Map<SkipReason, number>()
  let complete = true
  let visitedEntries = 0
  let matchedFiles = 0
  let directories = 0
  let candidates = 0
  let totalBytes = 0
  const seen = new Set<FsTarget['targetKey']>()
  const addSkip = (why: SkipReason) => {
    skips.set(why, (skips.get(why) ?? 0) + 1)
  }
  let root: FsTarget
  try {
    root = await fs.resolve('.', { cwd, signal })
    check(signal)
    const pathInfo = await fs.lstat('.', { cwd }, signal)
    check(signal)
    const info = await fs.stat(root, signal)
    check(signal)
    if (pathInfo?.type !== 'directory' || info?.type !== 'directory' || !fs.contains(root, root))
      throw new Rejected('unreadable')
  } catch {
    check(signal)
    throw new Error('File Intuition workspace is unavailable.')
  }

  async function probe(path: string): Promise<Probe> {
    check(signal)
    const pathInfo = await fs.lstat(path, { cwd }, signal)
    check(signal)
    if (pathInfo?.type === 'symlink') throw new Rejected('symlink')
    if (!pathInfo) throw new Rejected('unreadable')
    const target = await fs.resolve(path, { cwd, signal })
    check(signal)
    if (!fs.contains(root, target)) throw new Rejected('outside_workspace')
    const info = await fs.stat(target, signal)
    check(signal)
    if (!info || info.type !== pathInfo.type) throw new Rejected('changed')
    return { target, info, pathInfo }
  }
  async function chain(path: string, directory = false): Promise<Probe[]> {
    const chainParts = path.split('/')
    const probes: Probe[] = []
    const currentRoot = await probe('.')
    if (currentRoot.target.targetKey !== root.targetKey || currentRoot.info.type !== 'directory')
      throw new Rejected('changed')
    probes.push(currentRoot)
    for (let i = 0; i < chainParts.length; i++) {
      const name = chainParts[i]!
      if (excluded(name, directory || i < chainParts.length - 1)) throw new Rejected('excluded')
      const item = await probe(chainParts.slice(0, i + 1).join('/'))
      if (i < chainParts.length - 1 && item.info.type !== 'directory')
        throw new Rejected('unreadable')
      probes.push(item)
    }
    return probes
  }
  async function readFile(path: string): Promise<void> {
    const before = await chain(path)
    const item = before.at(-1)!
    if (item.info.type !== 'file') throw new Rejected('not_text')
    if (seen.has(item.target.targetKey)) throw new Rejected('excluded')
    seen.add(item.target.targetKey)
    if (
      item.info.size !== undefined &&
      (!Number.isSafeInteger(item.info.size) || item.info.size < 0)
    )
      throw new Rejected('unreadable')
    if ((item.info.size ?? 0) > LIMITS.fileBytes) throw new Rejected('too_large')
    if (batch && files.length >= request.maxFiles) {
      complete = false
      throw new Rejected('file_limit')
    }
    if (totalBytes + (item.info.size ?? LIMITS.fileBytes) > LIMITS.batchBytes) {
      complete = false
      throw new Rejected('byte_limit')
    }
    check(signal)
    const bytes = await fs.readBytes(item.target, signal, LIMITS.fileBytes)
    check(signal)
    if (bytes.byteLength > LIMITS.fileBytes) throw new Rejected('too_large')
    if (item.info.size !== undefined && item.info.size !== bytes.byteLength)
      throw new Rejected('changed')
    // These probes detect identity/version changes, but no backend API provides an atomic
    // containment + no-follow + read transaction. Backends remain the I/O trust boundary.
    const after = await chain(path)
    if (
      before.some((old, i) => {
        const next = after[i]
        return (
          !next ||
          next.target.targetKey !== old.target.targetKey ||
          next.info.version !== old.info.version ||
          next.pathInfo.version !== old.pathInfo.version
        )
      })
    )
      throw new Rejected('changed')
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    } catch {
      throw new Rejected('not_text')
    }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(content)) throw new Rejected('not_text')
    if (sensitive(content)) throw new Rejected('sensitive_content')
    if (totalBytes + bytes.byteLength > LIMITS.batchBytes) {
      complete = false
      throw new Rejected('byte_limit')
    }
    totalBytes += bytes.byteLength
    files.push(
      Object.freeze({
        path,
        content,
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }),
    )
  }
  async function walk(path: string[], depth: number): Promise<void> {
    check(signal)
    if (
      directories >= LIMITS.directories ||
      depth > LIMITS.depth ||
      candidates >= LIMITS.candidates ||
      visitedEntries >= LIMITS.visitedEntries
    ) {
      complete = false
      return
    }
    try {
      const dir = path.length ? (await chain(path.join('/'), true)).at(-1)! : await probe('.')
      if (!path.length && dir.target.targetKey !== root.targetKey) throw new Rejected('changed')
      if (dir.info.type !== 'directory') throw new Rejected('unreadable')
      if (seen.has(dir.target.targetKey)) {
        addSkip('excluded')
        return
      }
      seen.add(dir.target.targetKey)
      directories++
      check(signal)
      // listDir has no pagination seam: one backend listing may itself be large.
      // We cap entries processed and directories requested, not backend listing memory.
      const entries = await fs.listDir(dir.target, signal)
      check(signal)
      const after = await probe(path.length ? path.join('/') : '.')
      if (
        after.target.targetKey !== dir.target.targetKey ||
        after.info.version !== dir.info.version ||
        after.pathInfo.version !== dir.pathInfo.version
      )
        throw new Rejected('changed')
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      for (const entry of entries) {
        check(signal)
        if (visitedEntries >= LIMITS.visitedEntries || candidates >= LIMITS.candidates) {
          complete = false
          break
        }
        visitedEntries++
        if (
          !entry.name ||
          entry.name.length > 1024 ||
          /[/\\\x00-\x1f\x7f]/u.test(entry.name) ||
          entry.name === '.' ||
          entry.name === '..'
        ) {
          addSkip('excluded')
          continue
        }
        const child = [...path, entry.name]
        const matches = match.matches(child)
        if (entry.type !== 'directory' && matches) matchedFiles++
        if (entry.type === 'directory' ? !match.descends(child) : !matches) continue
        // An excluded directory contributes one skipped entry, not an invented
        // count of matching descendants that we intentionally never enumerate.
        if (!fs.contains(root, entry.target)) {
          addSkip('outside_workspace')
          continue
        }
        if (excluded(entry.name, entry.type === 'directory')) {
          addSkip('excluded')
          continue
        }
        if (entry.type === 'directory') {
          if (match.descends(child)) await walk(child, depth + 1)
        } else if (matches) {
          candidates++
          try {
            await readFile(child.join('/'))
          } catch (error) {
            check(signal)
            const why = reason(error)
            // An observed ancestor mutation can invalidate the directory listing.
            if (why === 'changed') complete = false
            addSkip(why)
          }
        }
      }
    } catch (error) {
      check(signal)
      complete = false
      addSkip(reason(error))
    }
  }
  if (batch) await walk([], 0)
  else {
    visitedEntries = 1
    matchedFiles = 1
    try {
      await readFile(parts.join('/'))
    } catch (error) {
      check(signal)
      throw new Rejected(reason(error))
    }
  }
  check(signal)
  // Freeze in memory so evaluation uses exactly the prepared snapshots.
  Object.freeze(files)
  const skipped = [...skips]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([why, count]) => Object.freeze({ reason: why, count }))
  Object.freeze(skipped)
  return Object.freeze({ files, matchedFiles, visitedEntries, complete, skipped })
}
