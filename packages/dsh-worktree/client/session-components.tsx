import React, { useEffect, useRef, useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionStore } from './session-store.ts'

export const surface: React.CSSProperties = {
  color: 'var(--dsw-alias-label-primary)',
  background: 'var(--dsw-alias-bg-base)',
  border: '1px solid var(--dsw-alias-border-l3)',
  borderRadius: 12,
}
export const action: React.CSSProperties = {
  font: 'inherit',
  color: 'inherit',
  background: 'var(--dsw-alias-interactive-bg-hover)',
  border: '1px solid var(--dsw-alias-border-l3)',
  borderRadius: 8,
  padding: '6px 12px',
  cursor: 'pointer',
}
export function BranchIcon({ size = 16 }: { size?: number; active?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M6 7v10m12-10c0 6-12 3-12 8" />
    </svg>
  )
}
export function Dialog({
  title,
  children,
  footer,
  onClose,
  busy = false,
}: {
  title: string
  children: React.ReactNode
  footer: React.ReactNode
  onClose(): void
  busy?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = root.current
    node?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!busy) close.current()
      }
      if (event.key !== 'Tab' || !node) return
      const controls = [
        ...node.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ),
      ]
      const first = controls[0]
      const last = controls.at(-1)
      if (!first || !last) {
        event.preventDefault()
        node.focus()
        return
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || !node.contains(document.activeElement))
      ) {
        event.preventDefault()
        last.focus()
      }
      if (
        !event.shiftKey &&
        (document.activeElement === last || !node.contains(document.activeElement))
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('keydown', handleKey, true)
      previous?.focus()
    }
  }, [busy])
  const titleId = React.useId()
  return (
    <div
      style={{
        position: 'fixed',
        pointerEvents: 'auto',
        inset: 0,
        zIndex: 1000,
        background: 'rgb(0 0 0 / 35%)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <div
        ref={root}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          ...surface,
          padding: 24,
          width: 'min(560px, 100%)',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 12px 48px rgb(0 0 0 / 20%)',
        }}
      >
        <h2 id={titleId} style={{ fontSize: 18, margin: '0 0 16px' }}>
          {title}
        </h2>
        {children}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 20,
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  )
}
export function SessionWorktreesPage({ store }: { store: SessionStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const records = state.records
  const error = state.error ?? state.readError
  return (
    <section
      aria-label="Session worktrees"
      style={{
        padding: 28,
        overflow: 'auto',
        height: '100%',
        boxSizing: 'border-box',
        color: 'var(--dsw-alias-label-primary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ fontSize: 22 }}>Session worktrees</h1>
        <button
          type="button"
          style={action}
          onClick={() => {
            void store.refresh()
          }}
        >
          Refresh
        </button>
      </div>
      <p>
        Owned session checkouts remain recoverable here, including archived sessions whose checkout
        is missing.
      </p>
      <p style={{ color: 'var(--dsw-alias-label-tertiary)' }}>
        Use Restore and open before continuing an archived session. Native unarchive actions do not
        recreate a removed checkout. Turning off Use worktree keeps its checkout.
      </p>
      {error && <p role="alert">{error}</p>}
      {state.loading && <p role="status">Loading session worktrees…</p>}
      {!state.loading && records.length === 0 && <p>No session worktrees yet.</p>}
      <div style={{ display: 'grid', gap: 16, marginTop: 20 }}>
        {records.map((record) => (
          <article key={record.sessionId} style={{ ...surface, padding: 18 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <BranchIcon />
              <strong>{record.branch}</strong>
              <span>{record.state}</span>
            </div>
            <dl style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
              <dt>Checkout</dt>
              <dd style={{ margin: '4px 0 12px' }}>
                <code>{record.path}</code>
              </dd>
              <dt>Source</dt>
              <dd style={{ margin: '4px 0 12px' }}>
                {record.repository} · {record.sourceRef ?? 'HEAD'} · {record.sourceWorkspaceId}
              </dd>
              <dt>Session</dt>
              <dd style={{ margin: '4px 0 12px' }}>{record.sessionId}</dd>
              <dt>HEAD</dt>
              <dd style={{ margin: '4px 0' }}>
                <code>{record.head}</code>
                {record.branchDeleted ? ' · Branch removed' : ''}
              </dd>
            </dl>
            {record.message && <p>{record.message}</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {record.state === 'active' && (
                <button
                  type="button"
                  style={action}
                  disabled={state.busy.has(record.sessionId)}
                  onClick={() => {
                    void store.archive(record.sessionId)
                  }}
                >
                  Archive session
                </button>
              )}
              <button
                type="button"
                style={action}
                disabled={state.busy.has(record.sessionId) || record.state === 'creating'}
                onClick={() => {
                  void store.restore(record.sessionId)
                }}
              >
                Restore and open
              </button>
              {record.state !== 'removed' && (
                <button
                  type="button"
                  style={action}
                  disabled={state.busy.has(record.sessionId) || record.state === 'creating'}
                  onClick={() => {
                    void store.cleanup(record.sessionId)
                  }}
                >
                  {record.state === 'pending' ? 'Review cleanup' : 'Retry cleanup'}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
export function SessionOverlay({ store }: { store: SessionStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const dialog = state.dialog
  const error = state.error ?? state.readError
  const pending = state.records.filter((record) => record.state === 'pending') ?? []
  if (dialog) {
    const busy = state.busy.has(dialog.record.sessionId)
    return (
      <Dialog
        title="Remove archived session checkout?"
        busy={busy}
        onClose={store.keepCheckout}
        footer={
          <>
            <button type="button" style={action} disabled={busy} onClick={store.keepCheckout}>
              Keep checkout
            </button>
            <button
              type="button"
              style={{ ...action, color: 'var(--dsw-alias-label-danger, #c43c3c)' }}
              disabled={busy || Date.now() >= dialog.confirmation.expiresAt}
              onClick={() => {
                void store.discardCheckout()
              }}
            >
              Discard files and remove checkout
            </button>
          </>
        }
      >
        <p>
          This checkout contains files that cleanup would discard. This action cannot be undone.
        </p>
        <p style={{ overflowWrap: 'anywhere' }}>
          <code>{dialog.record.path}</code>
        </p>
        <p>
          Branch: <strong>{dialog.record.branch}</strong>
        </p>
        <p style={{ overflowWrap: 'anywhere' }}>
          HEAD: <code>{dialog.confirmation.head}</code>
        </p>
        <ul style={{ maxHeight: 200, overflow: 'auto', overflowWrap: 'anywhere' }}>
          {dialog.confirmation.files.map((file, index) => (
            <li key={`${index}:${file}`}>
              <code>{file}</code>
            </li>
          ))}
        </ul>
        <p style={{ fontSize: 12 }}>
          Review expires at {new Date(dialog.confirmation.expiresAt).toLocaleTimeString()}. If files
          or HEAD change, keep the checkout and request a new review.
        </p>
        {error && <p role="alert">{error}</p>}
      </Dialog>
    )
  }
  if (!pending.length && !error) return null
  return (
    <aside
      aria-label="Session worktree notice"
      style={{
        ...surface,
        position: 'fixed',
        pointerEvents: 'auto',
        bottom: 20,
        right: 20,
        zIndex: 100,
        padding: 14,
        maxWidth: 360,
      }}
    >
      {error && (
        <>
          <p role="alert" style={{ margin: '0 0 8px' }}>
            {error}
          </p>
          <button type="button" style={action} onClick={store.dismissError}>
            Dismiss
          </button>
          {state.readError && (
            <button
              type="button"
              style={action}
              onClick={() => {
                void store.refresh()
              }}
            >
              Retry
            </button>
          )}
        </>
      )}
      {pending.length > 0 && (
        <>
          <p style={{ margin: '0 0 8px' }}>
            {pending.length} archived session checkout{pending.length === 1 ? '' : 's'} need cleanup
            review. Kept files remain on disk.
          </p>
          <button
            type="button"
            style={action}
            disabled={state.busy.has(pending[0]!.sessionId)}
            onClick={() => {
              void store.cleanup(pending[0]!.sessionId)
            }}
          >
            Review cleanup
          </button>
        </>
      )}
    </aside>
  )
}
export function SessionLeading(
  props: PropsRuntime<'sidebar.session.row.leading'> & { store: SessionStore },
) {
  const state = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  const record = state.records.find((row) => row.sessionId === props.sessionId)
  return record ? (
    <span title={`Session worktree: ${record.branch}`} style={{ display: 'inline-flex' }}>
      <BranchIcon />
    </span>
  ) : null
}
export function SessionHover(
  props: PropsRuntime<'sidebar.session.row.hover'> & { store: SessionStore },
) {
  const state = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  const record = state.records.find((row) => row.sessionId === props.sessionId)
  return record ? (
    <div style={{ fontSize: 12, maxWidth: 320, overflowWrap: 'anywhere' }}>
      <strong>Session worktree</strong>
      <div>
        {record.branch} · {record.state}
      </div>
      <div>{record.path}</div>
      <div>Source: {record.repository}</div>
      {record.message && <div>{record.message}</div>}
    </div>
  ) : null
}
export function CopyCheckout(
  props: PropsRuntime<'sidebar.workspaces.session.menu.item'> & { store: SessionStore },
) {
  const state = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  const [, close] = props.useMenuOpenState()
  const record = state.records.find((row) => row.sessionId === props.sessionId)
  if (!record) return null
  return (
    <button
      type="button"
      role="menuitem"
      style={{ ...action, width: '100%', textAlign: 'left' }}
      onClick={() => {
        close(false)
        void navigator.clipboard.writeText(record.path).catch(props.store.report)
      }}
    >
      Copy checkout path
    </button>
  )
}
