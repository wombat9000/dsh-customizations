import React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionCIRequest, SessionCISnapshot } from '@local/dsh-session-environment/types'

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
