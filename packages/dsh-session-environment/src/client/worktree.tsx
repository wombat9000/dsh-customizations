import React from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { UseSession } from '@deepseek-ai/dsh-client-ui-session/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorktreePreferenceChange,
  WorktreePreferenceRequest,
  WorktreePreferenceSnapshot,
} from '@local/dsh-session-environment/types'

export interface WorktreeRemote {
  readWorktreePreference(
    request: WorktreePreferenceRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorktreePreferenceSnapshot>>
  setWorktreePreference(
    request: WorktreePreferenceChange,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorktreePreferenceSnapshot>>
}

export interface WorktreeToggleProps {
  remote: WorktreeRemote
  sessionId: SessionId
  useSession: UseSession
  // Native wire value is string|null; undefined means its baseline is not here yet.
  useProjection: (key: 'workingDirectory') => string | null | undefined
  placement: 'hero' | 'composer'
}

type Refresh = (sessionId: SessionId) => void
// Only mounted component instances subscribe. No window event or page reload is needed.
const refreshListeners = new WeakMap<WorktreeRemote, Set<Refresh>>()

interface ViewState {
  sessionId: SessionId
  cwd: string | null
  snapshot: WorktreePreferenceSnapshot | null
  pending: 'read' | 'save' | null
  error: string | null
}

const guidance =
  'Prefer an isolated Git worktree for code changes. Create it when needed using DSH’s worktree tools. This is guidance, not enforced isolation.'
const offGuidance =
  'Off does not change or delete a worktree. Your last choice is remembered for new sessions.'

const styles: Record<string, React.CSSProperties> = {
  group: {
    display: 'inline-flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    maxWidth: '100%',
    fontSize: 12,
    color: 'var(--dsw-alias-label-secondary)',
  },
  toggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minHeight: 30,
    padding: '4px 9px',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: 8,
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-secondary)',
    font: 'inherit',
    whiteSpace: 'nowrap',
  },
  error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 11 },
  retry: {
    border: 0,
    background: 'none',
    padding: 2,
    color: 'var(--dsw-alias-label-primary)',
    font: 'inherit',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  description: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
}

export function WorktreeToggle(props: WorktreeToggleProps): React.ReactElement | null {
  const { remote, sessionId, placement } = props
  const blank = props.useSession((session) => session.blank)
  const subagent = props.useSession((session) => session.subagent !== null)
  const open = props.useSession((session) => session.openState === 'open')
  const cwd = props.useProjection('workingDirectory') ?? null
  const descriptionId = React.useId()
  const [view, setView] = React.useState<ViewState | null>(null)
  const actions = React.useRef<{ read: () => void; save: () => void } | null>(null)

  React.useEffect(() => {
    // Native slots mount while a cold history is still opening on the Host.
    // Wait for that lifecycle instead of treating a not-yet-live Session as an error.
    if (subagent || !open) return
    let active = true
    let sequence = 0
    let controller: AbortController | null = null
    let current: WorktreePreferenceSnapshot | null = null
    let pending = false
    let saving = false
    const listeners = refreshListeners.get(remote) ?? new Set<Refresh>()
    refreshListeners.set(remote, listeners)
    const matches = (snapshot: WorktreePreferenceSnapshot) =>
      snapshot.sessionId === sessionId && (cwd === null || snapshot.cwd === cwd)
    const update = (next: Omit<ViewState, 'sessionId' | 'cwd'>) =>
      setView({ sessionId, cwd, ...next })

    const request = async (save: boolean): Promise<void> => {
      // This synchronous guard also covers two clicks before React rerenders.
      if (save && (pending || !current || (!current.available && !current.enabled))) return
      controller?.abort()
      controller = new AbortController()
      const signal = controller.signal
      const attempt = ++sequence
      const saved = current
      pending = true
      saving = save
      update({ snapshot: current, pending: save ? 'save' : 'read', error: null })
      try {
        const result =
          save && saved
            ? await remote.setWorktreePreference(
                {
                  sessionId,
                  enabled: !saved.enabled,
                  revision: saved.revision,
                  cwd: saved.cwd,
                },
                signal,
              )
            : await remote.readWorktreePreference({ sessionId }, signal)
        if (!active || sequence !== attempt) return
        if (!result.ok || !matches(result.value)) throw new Error('Unconfirmed preference')
        current = result.value
        pending = false
        saving = false
        update({ snapshot: current, pending: null, error: null })
        if (save) {
          for (const refresh of listeners) {
            if (refresh !== refreshPeer) refresh(sessionId)
          }
        }
      } catch {
        if (!active || sequence !== attempt) return
        pending = false
        saving = false
        update({
          snapshot: current,
          pending: null,
          error: save
            ? 'Could not save Worktree mode. Retry to check the saved choice.'
            : 'Could not check Worktree mode.',
        })
      }
    }
    const refreshPeer: Refresh = (changedSessionId) => {
      // Do not discard another in-flight write: its accepted result must also
      // publish. Host revision checks arbitrate competing writes.
      if (changedSessionId === sessionId && !saving) void request(false)
    }
    listeners.add(refreshPeer)
    actions.current = {
      read: () => void request(false),
      save: () => void request(true),
    }
    void request(false)
    return () => {
      active = false
      sequence += 1
      controller?.abort()
      actions.current = null
      listeners.delete(refreshPeer)
      if (listeners.size === 0) refreshListeners.delete(remote)
    }
  }, [remote, sessionId, cwd, subagent, open])

  if (subagent || (placement === 'hero' ? !blank : blank)) return null

  // Hide the old identity synchronously, before the next effect starts its read.
  const current = open && view?.sessionId === sessionId && view.cwd === cwd ? view : null
  const snapshot = current?.snapshot ?? null
  const loading = current === null || current.pending !== null
  const disabled =
    loading || Boolean(current?.error) || !snapshot || (!snapshot.available && !snapshot.enabled)
  const on = Boolean(snapshot?.enabled && snapshot.available)
  const status = loading
    ? current?.pending === 'save'
      ? 'Saving…'
      : 'Checking…'
    : current?.error
      ? 'Unconfirmed'
      : !snapshot?.available
        ? 'Unavailable'
        : on
          ? 'On'
          : 'Off'
  const tooltip = [
    guidance,
    offGuidance,
    snapshot && !snapshot.available ? snapshot.reason : null,
    snapshot?.enabled && !snapshot.available ? 'Saved preference: On; inactive here.' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span style={styles.group} data-worktree-toggle={placement} title={tooltip}>
      <button
        type="button"
        role="switch"
        aria-label="Worktree mode"
        aria-checked={snapshot?.enabled ?? false}
        aria-describedby={descriptionId}
        aria-busy={loading}
        disabled={disabled}
        onClick={() => actions.current?.save()}
        style={{
          ...styles.toggle,
          color: on ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 6v7m0-3h5a5 5 0 0 0 5-5" />
          <circle cx="5" cy="4" r="2" />
          <circle cx="5" cy="15" r="2" />
          <circle cx="15" cy="3" r="2" />
        </svg>
        <span>Worktree</span>
        <span aria-hidden="true">{status}</span>
      </button>
      <span id={descriptionId} style={styles.description}>
        {tooltip}
      </span>
      {current?.error && (
        <span role="alert" style={styles.error}>
          {current.error}
        </span>
      )}
      {(current?.error || (snapshot && !snapshot.available)) && (
        <button
          type="button"
          style={styles.retry}
          disabled={loading}
          aria-label={current?.error ? 'Retry' : 'Refresh Worktree status'}
          onClick={() => actions.current?.read()}
        >
          {current?.error ? 'Retry' : 'Refresh'}
        </button>
      )}
    </span>
  )
}
