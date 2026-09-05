import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { SessionEnvironmentSnapshot } from './types.js'

export const DEFAULT_TIMEOUT_MS = 4_000
export const DEFAULT_STDOUT_MAX_BYTES = 1_048_576

export const GIT_ENVIRONMENT_COMMAND = `inside=$(git rev-parse --is-inside-work-tree 2>/dev/null) || { printf '__DSH_NOT_REPO__\\n'; exit 0; }
printf '__DSH_INSIDE__\\n%s\\n' "$inside"
[ "$inside" = true ] || exit 0
if ! git rev-parse --verify 'HEAD^{commit}' >/dev/null 2>&1; then
  printf '__DSH_NO_HEAD__\\n'
  exit 0
fi
printf '__DSH_BRANCH__\\n'
(git symbolic-ref --quiet --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null) || exit 4
printf '__DSH_UPSTREAM__\\n'
if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null); then
  printf '%s\\n' "$upstream"
  printf '__DSH_AHEAD_BEHIND__\\n'
  git rev-list --left-right --count 'HEAD...@{upstream}' || exit 5
else
  printf '__DSH_NO_UPSTREAM__\\n'
fi
printf '__DSH_STATUS__\\n'
git status --porcelain=v1 --untracked-files=normal || exit 6
printf '__DSH_NUMSTAT__\\n'
git diff --numstat HEAD -- || exit 7`

function baseSnapshot(cwd: string | null, home: string): SessionEnvironmentSnapshot {
  return {
    cwd,
    home,
    repo: null,
    hasHead: null,
    branch: null,
    upstream: null,
    ahead: null,
    behind: null,
    dirtyFiles: null,
    additions: null,
    deletions: null,
  }
}

export function unavailableSnapshot(cwd: string | null, home: string, error: string): SessionEnvironmentSnapshot {
  return { ...baseSnapshot(cwd, home), error }
}

export function nonRepositorySnapshot(cwd: string, home: string): SessionEnvironmentSnapshot {
  return {
    ...baseSnapshot(cwd, home),
    repo: false,
    hasHead: false,
  }
}

export function parseGitEnvironmentResult(input: {
  readonly cwd: string
  readonly home: string
  readonly result: ShellRunResult
}): SessionEnvironmentSnapshot {
  const { cwd, home, result } = input
  if (result.timedOut) return unavailableSnapshot(cwd, home, 'Git check timed out')
  if (result.aborted) return unavailableSnapshot(cwd, home, 'Git check cancelled')
  if (result.stdout.truncated) return unavailableSnapshot(cwd, home, 'Repository status is too large')

  const lines = result.stdout.text.split('\n')
  const insideIndex = lines.indexOf('__DSH_INSIDE__')
  const insideValue = lines[insideIndex + 1]
  const insideWorkTree = insideIndex >= 0
    && typeof insideValue === 'string'
    && insideValue.trim() === 'true'
  if (!insideWorkTree) return nonRepositorySnapshot(cwd, home)

  if (lines.includes('__DSH_NO_HEAD__')) {
    return {
      ...baseSnapshot(cwd, home),
      repo: true,
      hasHead: false,
    }
  }

  const branchIndex = lines.indexOf('__DSH_BRANCH__')
  const upstreamIndex = lines.indexOf('__DSH_UPSTREAM__')
  const aheadBehindIndex = lines.indexOf('__DSH_AHEAD_BEHIND__')
  const noUpstreamIndex = lines.indexOf('__DSH_NO_UPSTREAM__')
  const statusIndex = lines.indexOf('__DSH_STATUS__')
  const numstatIndex = lines.indexOf('__DSH_NUMSTAT__')
  if (result.exitCode !== 0 || branchIndex < 0 || upstreamIndex < 0 || statusIndex < 0 || numstatIndex < 0) {
    return unavailableSnapshot(cwd, home, 'Unable to read Git state')
  }

  const branch = lines
    .slice(branchIndex + 1, upstreamIndex)
    .map((line) => line.trim())
    .find(Boolean) ?? null
  let upstream: string | null = null
  let ahead: number | null = null
  let behind: number | null = null
  if (noUpstreamIndex < upstreamIndex || noUpstreamIndex > statusIndex) {
    if (aheadBehindIndex < upstreamIndex || aheadBehindIndex > statusIndex) {
      return unavailableSnapshot(cwd, home, 'Unable to read Git upstream state')
    }
    upstream = lines
      .slice(upstreamIndex + 1, aheadBehindIndex)
      .map((line) => line.trim())
      .find(Boolean) ?? null
    const counts = lines
      .slice(aheadBehindIndex + 1, statusIndex)
      .map((line) => line.trim())
      .find(Boolean)
      ?.split(/\s+/)
      .map(Number)
    if (upstream === null || counts?.length !== 2 || counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
      return unavailableSnapshot(cwd, home, 'Unable to read Git upstream state')
    }
    ;[ahead, behind] = counts as [number, number]
  }
  const dirtyFiles = lines
    .slice(statusIndex + 1, numstatIndex)
    .filter((line) => line.length > 0)
    .length
  let additions = 0
  let deletions = 0
  for (const line of lines.slice(numstatIndex + 1)) {
    if (!line) continue
    const [addedText, deletedText] = line.split('\t')
    const added = Number(addedText)
    const deleted = Number(deletedText)
    if (Number.isFinite(added)) additions += added
    if (Number.isFinite(deleted)) deletions += deleted
  }

  return {
    cwd,
    home,
    repo: true,
    hasHead: true,
    branch,
    upstream,
    ahead,
    behind,
    dirtyFiles,
    additions,
    deletions,
  }
}
