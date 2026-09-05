import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import React from 'react'
import sessionEnvironmentRemote from '@local/dsh-session-environment/remote'
import type { SessionEnvironmentSnapshot } from '@local/dsh-session-environment/types'

const POLL_INTERVAL_MS = 3_000
const LOADING_DELAY_MS = 300

type LoadStatus = 'idle' | 'pending' | 'ready' | 'error'

interface CachedEnvironment {
  readonly home: string
  readonly repo: boolean
  readonly hasHead: boolean | null
  readonly branch: string | null
  readonly upstream: string | null
  readonly ahead: number | null
  readonly behind: number | null
  readonly dirtyFiles: number | null
  readonly additions: number | null
  readonly deletions: number | null
}

interface EnvironmentInfo {
  readonly status: LoadStatus
  readonly cwd: string | null
  readonly home: string | null
  readonly repo: boolean | null
  readonly hasHead: boolean | null
  readonly branch: string | null
  readonly upstream: string | null
  readonly ahead: number | null
  readonly behind: number | null
  readonly dirtyFiles: number | null
  readonly additions: number | null
  readonly deletions: number | null
  readonly error: string | null
  readonly showLoading: boolean
}

interface SessionListState {
  readonly current?: SessionId
  readonly byId: Readonly<Record<string, { readonly cwd?: string }>>
}

interface EnvironmentCardProps {
  useSessions<T>(selector: (state: SessionListState) => T): T
}

interface SessionEnvironmentRemote {
  read(
    request: { readonly sessionId: SessionId },
    signal?: AbortSignal,
  ): Promise<RemoteResult<SessionEnvironmentSnapshot>>
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    position: 'fixed', top: 84, right: 18, zIndex: 50,
    width: 'min(300px, calc(100vw - 36px))', boxSizing: 'border-box',
    pointerEvents: 'auto', border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: 14, background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)', boxShadow: '0 10px 28px rgba(0, 0, 0, 0.18)',
    padding: '14px 15px 15px', fontSize: 13,
  },
  title: {
    margin: '0 0 12px', color: 'var(--dsw-alias-label-secondary)',
    fontSize: 12, fontWeight: 600, letterSpacing: '0.02em',
  },
  row: {
    display: 'grid', gridTemplateColumns: '74px minmax(0, 1fr)',
    alignItems: 'baseline', gap: 10, minHeight: 26,
  },
  label: { color: 'var(--dsw-alias-label-secondary)' },
  value: {
    overflow: 'hidden', minWidth: 0, textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  muted: { color: 'var(--dsw-alias-label-secondary)' },
  branchIcon: {
    width: 14, height: 14, marginRight: 7, color: 'var(--dsw-alias-label-secondary)',
    verticalAlign: -2,
  },
  sync: { display: 'inline-flex', alignItems: 'baseline', gap: 8, width: '100%', minWidth: 0 },
  upstream: { overflow: 'hidden', minWidth: 0, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  syncCounts: { flexShrink: 0, color: 'var(--dsw-alias-label-secondary)' },
  changes: { display: 'inline-flex', alignItems: 'baseline', gap: 8 },
  additions: { color: 'var(--dsw-alias-state-success-primary)' },
  deletions: { color: 'var(--dsw-alias-state-error-primary)' },
}

export function blankInfo(status: LoadStatus, cwd: string | null, showLoading: boolean): EnvironmentInfo {
  return {
    status, cwd, home: null, repo: null, hasHead: null, branch: null,
    upstream: null, ahead: null, behind: null,
    dirtyFiles: null, additions: null, deletions: null, error: null, showLoading,
  }
}

function cachedInfo(cwd: string | null, cached: CachedEnvironment): EnvironmentInfo {
  return {
    status: 'ready', cwd, home: cached.home, repo: cached.repo,
    hasHead: cached.hasHead, branch: cached.branch,
    upstream: cached.upstream, ahead: cached.ahead, behind: cached.behind,
    dirtyFiles: cached.dirtyFiles, additions: cached.additions, deletions: cached.deletions,
    error: null, showLoading: false,
  }
}

export function describeSync(upstream: string | null, ahead: number | null, behind: number | null): {
  readonly label: string
  readonly title: string
} {
  if (upstream === null) {
    return {
      label: 'No upstream',
      title: 'This branch does not track an upstream branch',
    }
  }
  if (ahead === null || behind === null) {
    return {
      label: 'Unavailable',
      title: `Unable to compare with ${upstream}`,
    }
  }
  if (ahead === 0 && behind === 0) {
    return {
      label: 'Synced',
      title: `Synced with ${upstream} based on the last-fetched upstream state`,
    }
  }
  const aheadLabel = `${ahead} ${ahead === 1 ? 'commit' : 'commits'} ahead`
  const behindLabel = `${behind} ${behind === 1 ? 'commit' : 'commits'} behind`
  return {
    label: [ahead > 0 ? `↑${ahead}` : '', behind > 0 ? `↓${behind}` : ''].filter(Boolean).join(' '),
    title: `${upstream}: ${aheadLabel}, ${behindLabel} based on the last-fetched upstream state`,
  }
}

export function compactPath(path: string | null, home: string | null): string {
  if (!path) return 'Unavailable'
  let value = path
  if (home) {
    const normalizedHome = home.length > 1 && (home.endsWith('/') || home.endsWith('\\'))
      ? home.slice(0, -1)
      : home
    const boundary = path.length === normalizedHome.length
      || path[normalizedHome.length] === '/'
      || path[normalizedHome.length] === '\\'
    if (boundary && path.slice(0, normalizedHome.length) === normalizedHome) {
      value = `~${path.slice(normalizedHome.length)}`
    }
  }
  if (value.length <= 25) return value

  const separator = value.includes('\\') && !value.includes('/') ? '\\' : '/'
  let prefix = ''
  let rest = value
  if (value.startsWith(`~${separator}`)) {
    prefix = `~${separator}`
    rest = value.slice(2)
  } else if (value.startsWith(separator)) {
    prefix = separator
    rest = value.slice(1)
  } else if (separator === '\\' && value.length > 2 && value[1] === ':') {
    prefix = value.slice(0, 3)
    rest = value.slice(3)
  }

  const parts = rest.split(separator).filter(Boolean)
  if (parts.length <= 2) return value
  let candidate = `${prefix}…${separator}${parts.slice(-2).join(separator)}`
  if (candidate.length <= 25) return candidate
  candidate = `…${separator}${parts.slice(-2).join(separator)}`
  if (candidate.length <= 25) return candidate
  return `…${separator}${parts.at(-1) ?? ''}`
}

function BranchIcon(): React.ReactElement {
  return React.createElement('svg', {
    style: styles.branchIcon,
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  },
  React.createElement('line', { x1: 6, y1: 3, x2: 6, y2: 15 }),
  React.createElement('circle', { cx: 18, cy: 6, r: 3 }),
  React.createElement('circle', { cx: 6, cy: 18, r: 3 }),
  React.createElement('path', { d: 'M18 9a9 9 0 0 1-9 9' }))
}

export function createEnvironmentCard(
  ctx: Context,
  sessionEnvironment: SessionEnvironmentRemote,
): React.ComponentType<EnvironmentCardProps> {
  const environmentCache = new Map<string, CachedEnvironment>()

  return function EnvironmentCard(props: EnvironmentCardProps): React.ReactElement | null {
    const sessionId = props.useSessions((state) => state.current)
    const cwd = props.useSessions((state) => {
      const item = state.current === undefined ? undefined : state.byId[state.current]
      return typeof item?.cwd === 'string' ? item.cwd : null
    })
    const [info, setInfo] = React.useState<EnvironmentInfo>(blankInfo('idle', null, false))

    React.useEffect(() => {
      if (sessionId === undefined) {
        setInfo(blankInfo('idle', null, false))
        return undefined
      }

      const cached = cwd === null ? undefined : environmentCache.get(cwd)
      setInfo(cached === undefined ? blankInfo('pending', cwd, false) : cachedInfo(cwd, cached))

      let active = true
      let busy = false
      const controller = new AbortController()
      let loadingTimer: number | null = cached === undefined
        ? window.setTimeout(() => {
            if (!active) return
            setInfo((previous) => previous.cwd === cwd && previous.status === 'pending'
              ? { ...previous, showLoading: true }
              : previous)
          }, LOADING_DELAY_MS)
        : null

      const clearLoadingTimer = (): void => {
        if (loadingTimer === null) return
        window.clearTimeout(loadingTimer)
        loadingTimer = null
      }
      const preserveCacheOrError = (message: string): void => {
        const latest = cwd === null ? undefined : environmentCache.get(cwd)
        setInfo(latest === undefined
          ? { ...blankInfo('error', cwd, false), error: message }
          : cachedInfo(cwd, latest))
      }

      const refresh = async (): Promise<void> => {
        if (busy) return
        busy = true
        try {
          const result = await sessionEnvironment.read({ sessionId }, controller.signal)
          if (!active) return
          clearLoadingTimer()
          if (!result.ok) {
            preserveCacheOrError('Unavailable')
            return
          }
          const next: SessionEnvironmentSnapshot = result.value
          if (next.repo === null || next.error !== undefined) {
            preserveCacheOrError(next.error ?? 'Unavailable')
            return
          }
          const nextCwd = next.cwd ?? cwd
          const cacheValue: CachedEnvironment = {
            home: next.home,
            repo: next.repo,
            hasHead: next.hasHead,
            branch: next.branch,
            upstream: next.upstream,
            ahead: next.ahead,
            behind: next.behind,
            dirtyFiles: next.dirtyFiles,
            additions: next.additions,
            deletions: next.deletions,
          }
          if (nextCwd !== null) environmentCache.set(nextCwd, cacheValue)
          setInfo(cachedInfo(nextCwd, cacheValue))
        } catch {
          if (active && !controller.signal.aborted) {
            clearLoadingTimer()
            preserveCacheOrError('Unavailable')
          }
        } finally {
          busy = false
        }
      }

      void refresh()
      const interval = window.setInterval(() => { void refresh() }, POLL_INTERVAL_MS)
      const resetDisposer = ctx.on('connection/reset', () => { void refresh() })
      return () => {
        active = false
        controller.abort()
        clearLoadingTimer()
        window.clearInterval(interval)
        resetDisposer()
      }
    }, [sessionId, cwd])

    if (sessionId === undefined) return null

    const cached = cwd === null ? undefined : environmentCache.get(cwd)
    const displayInfo = info.cwd === cwd
      ? info
      : cached === undefined
        ? blankInfo('pending', cwd, false)
        : cachedInfo(cwd, cached)
    const fullCwd = cwd ?? displayInfo.cwd ?? 'Unavailable'
    const shownCwd = compactPath(fullCwd, displayInfo.home)
    const waitingText = displayInfo.showLoading ? 'Checking…' : '—'

    let shownBranch = waitingText
    let branchStyle: React.CSSProperties = { ...styles.value, ...styles.muted }
    let showBranchIcon = false
    if (displayInfo.status === 'ready') {
      if (!displayInfo.repo) shownBranch = 'Not a Git repository'
      else if (displayInfo.hasHead === false) shownBranch = 'No commits yet'
      else if (displayInfo.branch) {
        shownBranch = displayInfo.branch
        branchStyle = styles.value ?? {}
        showBranchIcon = true
      } else shownBranch = 'Detached or unavailable'
    } else if (displayInfo.status === 'error') {
      shownBranch = displayInfo.error ?? 'Unavailable'
    }

    let syncNode: React.ReactNode = waitingText
    let syncTitle = waitingText
    if (displayInfo.status === 'ready') {
      if (!displayInfo.repo) {
        syncNode = '—'
        syncTitle = 'Not a Git repository'
      } else if (displayInfo.hasHead === false) {
        syncNode = 'Requires a commit'
        syncTitle = 'Upstream comparison requires at least one commit'
      } else {
        const sync = describeSync(displayInfo.upstream, displayInfo.ahead, displayInfo.behind)
        syncTitle = sync.title
        syncNode = displayInfo.upstream === null
          ? sync.label
          : React.createElement('span', { style: styles.sync, 'aria-label': sync.title },
              React.createElement('span', { style: styles.upstream }, displayInfo.upstream),
              React.createElement('span', { style: styles.syncCounts }, sync.label))
      }
    } else if (displayInfo.status === 'error') {
      syncNode = displayInfo.error ?? 'Unavailable'
      syncTitle = String(syncNode)
    }

    let changesNode: React.ReactNode = waitingText
    let changesTitle = waitingText
    if (displayInfo.status === 'ready') {
      if (!displayInfo.repo) {
        changesNode = '—'
        changesTitle = 'Not a Git repository'
      } else if (displayInfo.hasHead === false) {
        changesNode = 'Requires a commit'
        changesTitle = 'Change statistics require at least one commit'
      } else if (displayInfo.dirtyFiles !== null) {
        const fileLabel = displayInfo.dirtyFiles === 1 ? 'file' : 'files'
        changesTitle = `${displayInfo.dirtyFiles} dirty ${fileLabel}, ${displayInfo.additions ?? 0} lines added, ${displayInfo.deletions ?? 0} lines deleted`
        changesNode = React.createElement('span', { style: styles.changes, 'aria-label': changesTitle },
          React.createElement('span', null, `${displayInfo.dirtyFiles} ${fileLabel}`),
          React.createElement('span', { style: styles.additions }, `+${displayInfo.additions ?? 0}`),
          React.createElement('span', { style: styles.deletions }, `−${displayInfo.deletions ?? 0}`))
      } else {
        changesNode = 'Unavailable'
        changesTitle = 'Change statistics unavailable'
      }
    } else if (displayInfo.status === 'error') {
      changesNode = displayInfo.error ?? 'Unavailable'
      changesTitle = String(changesNode)
    }

    return React.createElement('section', { style: styles.card, 'aria-label': 'Session environment' },
      React.createElement('h2', { style: styles.title }, 'Environment'),
      React.createElement('div', { style: styles.row },
        React.createElement('span', { style: styles.label }, 'CWD'),
        React.createElement('span', { style: styles.value, title: fullCwd, 'aria-label': fullCwd }, shownCwd)),
      React.createElement('div', { style: styles.row },
        React.createElement('span', { style: styles.label }, 'Branch'),
        React.createElement('span', { style: branchStyle, title: shownBranch },
          showBranchIcon ? React.createElement(BranchIcon) : null,
          shownBranch)),
      React.createElement('div', { style: styles.row },
        React.createElement('span', { style: styles.label }, 'Sync'),
        React.createElement('span', { style: styles.value, title: syncTitle }, syncNode)),
      React.createElement('div', { style: styles.row },
        React.createElement('span', { style: styles.label }, 'Changes'),
        React.createElement('span', { style: styles.value, title: changesTitle }, changesNode)))
  }
}

export const inject = ['remote', 'slots']

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(sessionEnvironmentRemote)
  const mounted = ctx.get('remote.sessionEnvironment')
  if (mounted === undefined || mounted === null || typeof mounted !== 'object' || typeof Reflect.get(mounted, 'read') !== 'function') {
    await unmountRemote()
    throw new Error('session-environment: mounted Remote namespace is unavailable')
  }
  const EnvironmentCard = createEnvironmentCard(ctx, mounted as SessionEnvironmentRemote)
  const unregisterSlot = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'session-environment',
    order: 0,
    label: 'Session environment',
  }, EnvironmentCard))
  return async () => {
    unregisterSlot()
    await unmountRemote()
  }
}
