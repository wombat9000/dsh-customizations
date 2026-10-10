import React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  CIRow,
  SessionCIRequest,
  SessionCISnapshot,
} from '@local/dsh-session-environment/types'

export interface CIRemote {
  readCI?(request: SessionCIRequest, signal?: AbortSignal): Promise<RemoteResult<SessionCISnapshot>>
}

// Use the same actual overlay visibility as the preserved CSS rule. Observing
// shell marker changes covers retained non-Chat views and foreground sidebars;
// document visibility covers background browser tabs without a polling timer.
export function useEnvironmentVisible(
  ref: React.RefObject<HTMLElement>,
  enabled: boolean,
): boolean {
  const [visible, setVisible] = React.useState(false)
  React.useEffect(() => {
    if (!enabled) {
      setVisible(false)
      return
    }
    const update = () =>
      setVisible(
        document.visibilityState !== 'hidden' && Boolean(ref.current?.getClientRects().length),
      )
    const shell = ref.current?.closest('[data-shell-overlay]')?.parentElement ?? document.body
    const markers =
      '[data-chat-flow], [data-conversation-content], [data-sidebar-right-panel], [data-slot]'
    const containsMarker = (node: Node) =>
      node instanceof Element && (node.matches(markers) || Boolean(node.querySelector(markers)))
    let frame: number | undefined
    const schedule = () => {
      if (frame !== undefined) return
      frame = window.requestAnimationFrame(() => {
        frame = undefined
        update()
      })
    }
    const observer = new MutationObserver((mutations) => {
      // Streamed text, check-row updates, and unrelated class/style changes do
      // not affect the shell visibility rule or trigger a forced layout read.
      if (
        mutations.some((mutation) =>
          mutation.type === 'attributes'
            ? mutation.attributeName !== 'hidden' || containsMarker(mutation.target)
            : [...mutation.addedNodes, ...mutation.removedNodes].some(containsMarker),
        )
      )
        schedule()
    })
    observer.observe(shell, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'hidden',
        'data-sidebar-right-open',
        'data-conversation-session',
        'data-sidebar-right-session',
        'data-sidebar-right-panel',
        'data-slot',
        'data-chat-flow',
        'data-conversation-content',
      ],
    })
    document.addEventListener('visibilitychange', update)
    window.addEventListener('resize', schedule)
    update()
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame ?? 0)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('resize', schedule)
    }
  }, [ref, enabled])
  return enabled && visible
}

export function useLiveCI(
  remote: CIRemote,
  request: SessionCIRequest | null,
  visible: boolean,
): SessionCISnapshot | null {
  const [result, setResult] = React.useState<{
    sessionId: string
    snapshot: SessionCISnapshot
  } | null>(null)
  const sessionId = request?.sessionId
  const checkoutKey = request?.checkoutKey
  React.useEffect(() => {
    if (!visible || !sessionId || !checkoutKey || !remote.readCI) return
    const controller = new AbortController()
    let timer: number | undefined
    let active = true
    const refresh = async () => {
      let delay = 30000
      try {
        const response = await remote.readCI!({ sessionId, checkoutKey }, controller.signal)
        if (!active) return
        if (response.ok && response.value.checkoutKey === checkoutKey) {
          setResult({ sessionId, snapshot: response.value })
          delay = Math.max(15000, Math.min(300000, response.value.refreshAfterMs))
        } else
          setResult({
            sessionId,
            snapshot: {
              checkoutKey,
              rows: [],
              error: 'CI unavailable',
              stale: false,
              checkedAt: Date.now(),
              freshUntil: Date.now(),
              refreshAfterMs: delay,
            },
          })
      } catch {
        if (!active) return
        setResult({
          sessionId,
          snapshot: {
            checkoutKey,
            rows: [],
            error: 'CI unavailable',
            stale: false,
            checkedAt: Date.now(),
            freshUntil: Date.now(),
            refreshAfterMs: delay,
          },
        })
      }
      if (active)
        timer = window.setTimeout(() => {
          void refresh()
        }, delay)
    }
    void refresh()
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [remote, sessionId, checkoutKey, visible])
  return result !== null &&
    result.sessionId === sessionId &&
    result.snapshot.checkoutKey === checkoutKey
    ? result.snapshot
    : null
}

// Equal partitions show reported check states, not a percentage or time estimate.
// The bar fills the fixed-width Environment card; names never affect its layout.
function CICheckBar({ row, stale }: { row: CIRow; stale: boolean }): React.ReactElement | null {
  const [focusedIndex, setFocusedIndex] = React.useState<number | null>(null)
  const tooltipId = React.useId()
  const checks = row.checks
  if (!checks?.length) return null
  const colors: Partial<Record<CIRow['state'], string>> = {
    success: '#3fb950',
    running: '#d29922',
    failure: '#f85149',
    pending: '#6e7681',
  }
  const qualifiers = `${stale ? ' · stale' : ''}${row.complete ? '' : ' · partial'}`
  const selectedIndex = focusedIndex === null ? null : Math.min(focusedIndex, checks.length - 1)
  const selected = selectedIndex === null ? undefined : checks[selectedIndex]
  const bar = React.createElement(
    'span',
    {
      role: 'list',
      'aria-label': `${row.label} check statuses${qualifiers}`,
      style: {
        display: 'flex',
        width: '100%',
        height: 8,
        overflow: 'hidden',
        borderRadius: 3,
        opacity: stale || !row.complete ? 0.55 : 1,
      },
    },
    checks.map((check, index) =>
      React.createElement(
        'span',
        {
          key: index,
          role: 'listitem',
          'aria-label': `${check.name}: ${check.state}`,
          title: `${check.name}: ${check.state}${qualifiers}`,
          style: {
            position: 'relative',
            flex: '1 1 0',
            minWidth: 0,
            backgroundColor: colors[check.state] ?? '#6e7681',
            backgroundImage: colors[check.state]
              ? undefined
              : 'repeating-linear-gradient(135deg, transparent 0 2px, rgba(0, 0, 0, 0.3) 2px 4px)',
          },
        },
        index < checks.length - 1
          ? React.createElement('span', {
              'aria-hidden': true,
              style: {
                position: 'absolute',
                top: 0,
                right: 0,
                height: '100%',
                // Preserve the color even when a partition is narrower than 1px.
                width: 'min(1px, 10%)',
                backgroundColor: 'var(--dsw-alias-bg-layer-1)',
                pointerEvents: 'none',
              },
            })
          : null,
      ),
    ),
  )
  return React.createElement(
    row.url ? 'a' : 'div',
    {
      ...(row.url
        ? {
            href: row.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            'aria-label': `Open ${row.label} checks on GitHub${qualifiers}`,
          }
        : {}),
      tabIndex: row.url ? undefined : 0,
      'aria-describedby': selected ? tooltipId : undefined,
      onFocus: () => setFocusedIndex(0),
      onBlur: () => setFocusedIndex(null),
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        const index = selectedIndex ?? 0
        const destinations: Record<string, number | null> = {
          ArrowLeft: (index + checks.length - 1) % checks.length,
          ArrowRight: (index + 1) % checks.length,
          Home: 0,
          End: checks.length - 1,
          Escape: null,
        }
        const next = Object.hasOwn(destinations, event.key) ? destinations[event.key] : undefined
        if (next !== undefined) {
          event.preventDefault()
          setFocusedIndex(next)
        }
      },
      style: { position: 'relative', display: 'block', width: '100%', margin: '5px 0' },
    },
    bar,
    selected
      ? React.createElement(
          'span',
          {
            id: tooltipId,
            role: 'tooltip',
            'aria-live': 'polite',
            style: {
              position: 'absolute',
              top: '100%',
              left: 0,
              zIndex: 1,
              width: '100%',
              boxSizing: 'border-box',
              marginTop: 4,
              padding: 6,
              border: '1px solid var(--dsw-alias-border-l1)',
              borderRadius: 4,
              backgroundColor: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 11,
              overflowWrap: 'anywhere',
              pointerEvents: 'none',
            },
          },
          `${selected.name}: ${selected.state}${qualifiers} · ${(selectedIndex ?? 0) + 1}/${checks.length} (←/→)`,
        )
      : null,
  )
}

export function CIRows({
  snapshot,
  available,
}: {
  snapshot: SessionCISnapshot | null
  available: boolean
}): React.ReactElement {
  const age = snapshot ? Math.max(0, Math.floor((Date.now() - snapshot.checkedAt) / 1000)) : 0
  const stale = snapshot && (snapshot.stale || Date.now() > snapshot.freshUntil + 10000)
  const muted = 'var(--dsw-alias-label-secondary)'
  return React.createElement(
    'div',
    {
      'aria-label': 'Live checkout CI',
      style: {
        borderTop: '1px solid var(--dsw-alias-border-l1)',
        marginTop: 8,
        paddingTop: 8,
        fontSize: 12,
      },
    },
    !snapshot?.rows.length
      ? React.createElement(
          'div',
          { style: { color: muted } },
          snapshot?.error ?? (available ? 'CI · Checking…' : 'CI · Unavailable'),
        )
      : snapshot.rows.map((row) =>
          React.createElement(
            'div',
            { key: row.kind, style: { marginBottom: 5 } },
            React.createElement(
              'div',
              { style: { display: 'flex', justifyContent: 'space-between', gap: 8 } },
              React.createElement(
                'span',
                {
                  title: row.label,
                  style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                },
                row.label,
              ),
              React.createElement(
                'span',
                { style: { flexShrink: 0 } },
                `${row.state === 'no-checks' ? 'No checks' : row.state}${row.complete || !row.sha ? '' : ' · partial'}`,
              ),
            ),
            React.createElement(CICheckBar, { row, stale: Boolean(stale) }),
            React.createElement(
              'div',
              { style: { color: muted, fontSize: 11 } },
              row.url && row.sha
                ? React.createElement(
                    'a',
                    {
                      href: row.url,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      style: { color: 'inherit', fontFamily: 'monospace' },
                      'aria-label': `${row.label} checks at ${row.sha.slice(0, 7)}`,
                    },
                    row.sha.slice(0, 7),
                  )
                : '—',
              ` · ${stale ? 'stale · ' : ''}${age}s ago`,
            ),
            row.mismatch
              ? React.createElement(
                  'div',
                  { style: { color: muted, fontSize: 11 } },
                  'Local HEAD differs · checks cover remote code',
                )
              : null,
            row.warning
              ? React.createElement('div', { style: { color: muted, fontSize: 11 } }, row.warning)
              : null,
          ),
        ),
    snapshot?.error && snapshot.rows.length
      ? React.createElement('div', { style: { color: muted, fontSize: 11 } }, snapshot.error)
      : null,
  )
}
