import { createHash } from 'node:crypto'
import { object } from './contracts.js'
import type { APIReader, APITransport, Subprocess } from './contracts.js'
import { createGitHubAPITransport, parseGitHubAPIResponse } from './api-transport.js'
import { GitHubError, normalizeRemoteUrl } from './runtime.js'

export const GITHUB_LIVE_CI_SERVICE = 'localGitHubLiveCI'

// Host-only input, supplied by Environment's managed shell probe. Never expose
// this service as an arbitrary browser GitHub proxy. The caller owns revalidation
// of the live session/checkout before and after this cancellable read.
export interface CICheckout {
  cwd: string
  root: string
  branch: string | null
  head: string | null
  remotes: string[]
}
export type CIState =
  | 'pending'
  | 'running'
  | 'failure'
  | 'success'
  | 'cancelled'
  | 'skipped'
  | 'neutral'
  | 'stale'
  | 'unknown'
  | 'no-checks'
export interface CICheck {
  name: string
  state: Exclude<CIState, 'no-checks'>
}
export interface CIRow {
  kind: 'current' | 'default'
  label: string
  sha: string | null
  url: string | null
  state: CIState
  complete: boolean
  count: number
  checks: CICheck[]
  mismatch: boolean
  warning: string | null
}
export interface CISnapshot {
  rows: CIRow[]
  checkedAt: number
  refreshAfterMs: number
  freshUntil: number
  error: string | null
  stale: boolean
}
export interface GitHubLiveCI {
  readCheckout(checkout: CICheckout, signal: AbortSignal): Promise<CISnapshot>
}
const invalid = (): never => {
  throw new GitHubError('INVALID_RESPONSE', 'Invalid CI response.')
}
function record(value: unknown): Record<string, unknown> {
  return object(value) ?? invalid()
}
function sha(value: unknown): string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value)
    ? value.toLowerCase()
    : invalid()
}
function branch(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 1024 ||
    value.includes('..') ||
    value.includes('@{') ||
    value === '@' ||
    value.startsWith('-') ||
    /[\u0000-\u0020\u007f\\~^:?*\[\]]/.test(value)
  )
    invalid()
  return value as string
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) && value.length <= 100 ? value : invalid()
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid()
}
function aggregate(states: CIState[], complete: boolean): CIState {
  if (states.includes('failure')) return 'failure'
  if (states.includes('running')) return 'running'
  if (states.includes('pending')) return 'pending'
  if (!complete || states.includes('unknown')) return 'unknown'
  if (!states.length) return 'no-checks'
  for (const state of ['stale', 'cancelled', 'neutral', 'skipped'] as const)
    if (states.includes(state)) return state
  return 'success'
}

// Each REST page is explicitly tied to the requested immutable commit. Bounded
// pagination never upgrades an incomplete collection to success.
async function commitChecks(read: APIReader, root: string, commit: string) {
  const checks: CICheck[] = []
  let complete = true
  for (const source of ['check-runs', 'status'] as const) {
    for (let page = 1; page <= 2; page++) {
      const data = record(
        await read({
          method: 'GET',
          path: `${root}/commits/${commit}/${source}?per_page=100&page=${page}${source === 'check-runs' ? '&filter=latest' : ''}`,
        }),
      )
      if (source === 'status' && sha(data.sha) !== commit) invalid()
      const total = count(data.total_count)
      const entries = array(source === 'status' ? data.statuses : data.check_runs)
      for (const input of entries) {
        const entry = record(input)
        const rawName = source === 'status' ? entry.context : entry.name
        if (typeof rawName !== 'string' || !rawName.trim()) invalid()
        const name = (rawName as string)
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .trim()
          .slice(0, 256)
        if (!name) invalid()
        let state: CICheck['state']
        if (source === 'status') {
          if (
            typeof entry.state !== 'string' ||
            !['pending', 'success', 'failure', 'error'].includes(entry.state)
          )
            invalid()
          state = entry.state === 'error' ? 'failure' : (entry.state as CICheck['state'])
        } else {
          if (sha(entry.head_sha) !== commit) invalid()
          if (
            typeof entry.status !== 'string' ||
            !['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'].includes(
              entry.status,
            )
          )
            invalid()
          if (entry.status !== 'completed')
            state = entry.status === 'in_progress' ? 'running' : 'pending'
          else {
            switch (entry.conclusion) {
              case 'success':
              case 'cancelled':
              case 'neutral':
              case 'skipped':
              case 'stale':
                state = entry.conclusion
                break
              case 'failure':
              case 'timed_out':
              case 'action_required':
              case 'startup_failure':
                state = 'failure'
                break
              default:
                state = 'unknown'
            }
          }
        }
        checks.push({ name, state })
      }
      if (entries.length !== Math.min(100, Math.max(0, total - (page - 1) * 100))) complete = false
      if (page * 100 >= total) break
      if (entries.length !== 100 || page === 2) {
        complete = false
        break
      }
    }
  }
  return {
    state: aggregate(
      checks.map((check) => check.state),
      complete,
    ),
    count: checks.length,
    checks,
    complete,
  }
}
function emptyRow(kind: CIRow['kind'], label: string, warning: string): CIRow {
  return {
    kind,
    label,
    sha: null,
    url: null,
    state: 'unknown',
    complete: false,
    count: 0,
    checks: [],
    mismatch: false,
    warning,
  }
}
function errorCode(error: unknown): string {
  return error instanceof GitHubError ? error.code : 'READ_FAILED'
}
async function observe(checkout: CICheckout, read: APIReader) {
  let failure: unknown = null
  const attempt = async (kind: CIRow['kind'], label: string, operation: () => Promise<CIRow>) => {
    try {
      return await operation()
    } catch (error) {
      if (failure === null || errorCode(error) === 'RATE_LIMITED') failure = error
      return emptyRow(kind, label, `CI unavailable (${errorCode(error)})`)
    }
  }
  const result = (rows: CIRow[]) => ({ rows, failure })
  const candidates = new Map<string, NonNullable<ReturnType<typeof normalizeRemoteUrl>>>()
  if (checkout.remotes.length > 100) invalid()
  let unsupported = false
  for (const url of checkout.remotes) {
    const target = normalizeRemoteUrl(url)
    if (target) candidates.set(target.nameWithOwner.toLowerCase(), target)
    else unsupported = true
  }
  if (candidates.size !== 1 || unsupported)
    return result([
      emptyRow(
        'current',
        'CI',
        candidates.size ? 'Ambiguous GitHub remotes' : 'No GitHub repository',
      ),
    ])
  const target = [...candidates.values()][0]!
  const root = `/repos/${target.owner}/${target.repo}`
  const metadata = record(await read({ method: 'GET', path: root }))
  if (
    typeof metadata.full_name !== 'string' ||
    metadata.full_name.toLowerCase() !== target.nameWithOwner.toLowerCase()
  )
    invalid()
  const defaultBranch = branch(metadata.default_branch)
  const commits = new Map<string, ReturnType<typeof commitChecks>>()
  const checks = (commit: string) => {
    if (!commits.has(commit)) commits.set(commit, commitChecks(read, root, commit))
    return commits.get(commit)!
  }
  const defaultRow = await attempt('default', `Default · ${defaultBranch}`, async () => {
    const defaultCommit = sha(
      record(
        await read({ method: 'GET', path: `${root}/commits/${encodeURIComponent(defaultBranch)}` }),
      ).sha,
    )
    const row: CIRow = {
      kind: 'default',
      label: `Default · ${defaultBranch}`,
      sha: defaultCommit,
      url: `${target.url}/commit/${defaultCommit}/checks`,
      ...(await checks(defaultCommit)),
      mismatch: checkout.branch === defaultBranch && checkout.head !== defaultCommit,
      warning: null,
    }
    if (!row.complete) row.warning = 'Partial checks (pagination bound)'
    return row
  })
  if (checkout.branch === defaultBranch) return result([defaultRow])
  if (!checkout.branch || !checkout.head)
    return result([
      emptyRow(
        'current',
        'Current PR',
        checkout.head ? 'Detached HEAD; no branch PR' : 'No local commit',
      ),
      defaultRow,
    ])
  const current = await attempt('current', 'Current PR', async () => {
    // Exact head owner + ref, OPEN only. A full page is conservatively ambiguous:
    // no heuristic, upstream guessing, search qualifier, or fork-parent fallback.
    const pulls = array(
      await read({
        method: 'GET',
        path: `${root}/pulls?state=open&head=${encodeURIComponent(`${target.owner}:${checkout.branch}`)}&per_page=100&page=1`,
      }),
    )
    const matches = pulls.filter((input) => {
      const pr = record(input)
      return (
        pr.state === 'open' &&
        record(pr.head).ref === checkout.branch &&
        String(record(record(pr.head).repo).full_name).toLowerCase() ===
          target.nameWithOwner.toLowerCase() &&
        String(record(record(pr.base).repo).full_name).toLowerCase() ===
          target.nameWithOwner.toLowerCase()
      )
    })
    if (pulls.length === 100 || matches.length !== 1)
      return emptyRow(
        'current',
        'Current PR',
        matches.length || pulls.length === 100 ? 'Ambiguous open PRs' : 'No open PR',
      )
    const pr = record(matches[0])
    const number = count(pr.number)
    if (!number) invalid()
    const head = sha(record(pr.head).sha)
    const current: CIRow = {
      kind: 'current',
      label: `PR #${number}`,
      sha: head,
      url: `${target.url}/pull/${number}/checks`,
      ...(await checks(head)),
      mismatch: checkout.head !== head,
      warning: null,
    }
    if (!current.complete) current.warning = 'Partial checks (pagination bound)'
    return current
  })
  return result([current, defaultRow])
}

// One owner handles bounded reads, cache/deduplication, consumer cancellation,
// backoff and disposal. It starts no background timer: visibility drives reads.
export function createGitHubLiveCI(
  subprocess: Subprocess,
  options: { transport?: APITransport; now?: () => number } = {},
): { service: GitHubLiveCI; dispose(): void } {
  const transport = options.transport ?? createGitHubAPITransport(subprocess)
  const now = options.now ?? Date.now
  const lifetime = new AbortController()
  type Entry = {
    value?: CISnapshot
    due: number
    failures: number
    pending?: Promise<CISnapshot>
    controller?: AbortController
    consumers: number
  }
  const cache = new Map<string, Entry>()
  let running = 0
  const cancelled = () => new GitHubError('CANCELLED', 'CI read cancelled.')
  const forCheckout = (value: CISnapshot, checkout: CICheckout): CISnapshot => {
    const rows = value.rows.map((row) => ({
      ...row,
      mismatch:
        row.sha !== null &&
        (row.kind === 'current' || value.rows.length === 1) &&
        row.sha !== checkout.head,
    }))
    return rows.some((row, index) => row.mismatch !== value.rows[index]!.mismatch)
      ? { ...value, rows }
      : value
  }
  const service: GitHubLiveCI = {
    async readCheckout(checkout, signal) {
      if (signal.aborted || lifetime.signal.aborted) throw cancelled()
      if (
        !checkout ||
        typeof checkout !== 'object' ||
        typeof checkout.cwd !== 'string' ||
        typeof checkout.root !== 'string' ||
        !checkout.cwd ||
        !checkout.root ||
        checkout.cwd.length > 4096 ||
        checkout.root.length > 4096 ||
        !Array.isArray(checkout.remotes) ||
        checkout.remotes.length > 100 ||
        checkout.remotes.some((remote) => typeof remote !== 'string' || remote.length > 4096)
      )
        invalid()
      if (checkout.head !== null) sha(checkout.head)
      if (checkout.branch !== null) branch(checkout.branch)
      // Local unpushed commits do not invalidate remote checks or their cadence.
      // Recompute mismatch for each consumer instead of associating green with HEAD.
      const key = createHash('sha256')
        .update(JSON.stringify({ ...checkout, head: null }))
        .digest('hex')
      let entry = cache.get(key)
      if (entry?.value && now() < entry.due)
        return forCheckout(
          { ...entry.value, refreshAfterMs: Math.max(15000, entry.due - now()) },
          checkout,
        )
      if (!entry) {
        if (cache.size >= 32) {
          const evict = [...cache].find(([, candidate]) => !candidate.pending)
          if (!evict)
            return {
              rows: [],
              checkedAt: now(),
              freshUntil: now(),
              refreshAfterMs: 25000,
              error: 'CI busy',
              stale: false,
            }
          cache.delete(evict[0])
        }
        entry = { due: 0, failures: 0, consumers: 0 }
        cache.set(key, entry)
      }
      const owned = entry
      if (!owned.pending) {
        if (running >= 2)
          return {
            rows: [],
            checkedAt: now(),
            freshUntil: now(),
            refreshAfterMs: 25000,
            error: 'CI busy',
            stale: false,
          }
        const controller = new AbortController()
        owned.controller = controller
        const requestSignal = AbortSignal.any([
          lifetime.signal,
          controller.signal,
          AbortSignal.timeout(20000),
        ])
        running++
        owned.pending = (async () => {
          let requests = 0
          const read: APIReader = async (request) => {
            if (requestSignal.aborted) throw cancelled()
            if (++requests > 12)
              throw new GitHubError('BOUND_EXCEEDED', 'CI request bound exceeded.')
            const response = await transport(request, { cwd: checkout.cwd, signal: requestSignal })
            if (requestSignal.aborted) throw cancelled()
            return parseGitHubAPIResponse(response, request)
          }
          const failed = (error: unknown, rows?: CIRow[]) => {
            owned.failures++
            const code = requestSignal.aborted ? 'TIMEOUT' : errorCode(error)
            const wait = Math.min(
              300000,
              (code === 'RATE_LIMITED' ? 120000 : 30000) * 2 ** Math.min(3, owned.failures - 1),
            )
            owned.value = {
              rows: rows ?? owned.value?.rows ?? [],
              checkedAt: rows ? now() : (owned.value?.checkedAt ?? now()),
              freshUntil: rows ? now() + 25000 : (owned.value?.freshUntil ?? now()),
              refreshAfterMs: wait,
              error: `CI unavailable (${code})`,
              stale: !rows && owned.value !== undefined,
            }
          }
          try {
            const observation = await observe(checkout, read)
            if (controller.signal.aborted || lifetime.signal.aborted) throw cancelled()
            if (observation.failure !== null) failed(observation.failure, observation.rows)
            else {
              owned.failures = 0
              const active = observation.rows.some((row) =>
                ['pending', 'running', 'failure', 'no-checks', 'unknown'].includes(row.state),
              )
              const cadence = active ? 25000 : 60000
              owned.value = {
                rows: observation.rows,
                checkedAt: now(),
                freshUntil: now() + cadence,
                refreshAfterMs: cadence,
                error: null,
                stale: false,
              }
            }
          } catch (error) {
            if (controller.signal.aborted || lifetime.signal.aborted) throw cancelled()
            failed(error)
          } finally {
            running--
            delete owned.pending
            delete owned.controller
          }
          owned.due = now() + owned.value!.refreshAfterMs
          return owned.value!
        })()
      }
      const pending = owned.pending
      owned.consumers++
      return new Promise<CISnapshot>((resolve, reject) => {
        let settled = false
        const finish = (value?: CISnapshot, error?: unknown) => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', abort)
          owned.consumers--
          if (!owned.consumers && owned.pending) owned.controller?.abort()
          if (error !== undefined) reject(error)
          else resolve(forCheckout(value!, checkout))
        }
        const abort = () => finish(undefined, cancelled())
        signal.addEventListener('abort', abort, { once: true })
        pending!.then(
          (value) => finish(value),
          (error: unknown) => finish(undefined, error),
        )
        if (signal.aborted) abort()
      })
    },
  }
  return {
    service: Object.freeze(service),
    dispose: () => {
      lifetime.abort()
      cache.clear()
    },
  }
}

export function mountGitHubLiveCI(ctx: {
  subprocess: Subprocess
  effect(callback: () => () => void): unknown
  provide(name: string, service: Readonly<GitHubLiveCI>): unknown
}) {
  const owner = createGitHubLiveCI(ctx.subprocess)
  ctx.effect(() => () => owner.dispose())
  ctx.provide(GITHUB_LIVE_CI_SERVICE, owner.service)
}
