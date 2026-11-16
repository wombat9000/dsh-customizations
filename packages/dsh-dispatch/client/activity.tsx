import React from 'react'
import type { ActivityStatus } from '../shared/contracts.js'
import type { Request } from './card.js'

export interface ConnectionStateSource {
  getSnapshot(): 'connected' | 'connecting' | 'disconnected' | undefined
  subscribe(listener: () => void): () => void
}
export interface ActivityProps {
  sessionId: string
  /** rc.3 session-scoped standard projection hook, not the creation header. */
  useProjection(key: 'agentPreset'): string | undefined
}

function validActivity(value: unknown, sessionId: string): value is ActivityStatus {
  if (!value || typeof value !== 'object') return false
  const v = value as ActivityStatus
  return (
    v.coordinatorId === sessionId &&
    Number.isSafeInteger(v.occupied) &&
    v.occupied >= 0 &&
    Number.isSafeInteger(v.queued) &&
    v.queued >= 0 &&
    v.queued <= 5 &&
    (v.active === null ||
      (Number.isSafeInteger(v.active) && v.active >= 0 && v.active <= v.occupied)) &&
    Array.isArray(v.workers) &&
    v.workers.every((w) => w && typeof w.workerId === 'string' && typeof w.title === 'string')
  )
}

const css = `
.dsp-activity { display: inline-flex; flex-shrink: 0; align-items: center; gap: 7px; min-height: 30px;
  box-sizing: border-box; padding: 4px 10px; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary);
  box-shadow: 0 1px 2px #00000008; font: 12px/1.4 var(--dsw-font-family, system-ui, sans-serif);
  white-space: nowrap; transition: color 160ms ease, border-color 160ms ease, background 160ms ease; }
button.dsp-activity { cursor: pointer; }
button.dsp-activity:hover { border-color: var(--dsw-alias-label-tertiary); color: var(--dsw-alias-label-primary); }
button.dsp-activity:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 3px; }
.dsp-activity[data-busy=true] .dsp-activity-glyph { color: var(--dsw-alias-brand-primary); }
.dsp-activity-count { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); font-weight: 600; }
.dsp-activity-queue { padding: 1px 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); }
.dsp-activity-detail { font-size: 11px; }
@media (max-width: 700px) { .dsp-activity { gap: 5px; padding: 4px 8px; } .dsp-activity-detail { display: none; } }
@media (prefers-reduced-motion: reduce) { .dsp-activity { transition: none; } }
`

/** One native header contribution. Null removes only this additive list entry. */
export function ActivityPill(
  props: ActivityProps & {
    request: Request
    connection: ConnectionStateSource
    openSession?: ((sessionId: string) => void) | undefined
  },
) {
  const preset = props.useProjection('agentPreset')
  if (preset !== 'dispatch') return null
  return <OwnedActivity key={props.sessionId} {...props} />
}

function OwnedActivity({
  sessionId,
  request,
  connection,
  openSession,
}: ActivityProps & {
  request: Request
  connection: ConnectionStateSource
  openSession?: ((sessionId: string) => void) | undefined
}) {
  const connected = React.useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
    connection.getSnapshot,
  )
  const [status, setStatus] = React.useState<ActivityStatus | null>(null)
  const [error, setError] = React.useState(false)
  React.useEffect(() => {
    setStatus(null)
    setError(false)
    if (connected !== 'connected') return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    // Read real coordinator-scoped dispatcher state. Polling never executes tools
    // or interprets model text; one request at a time, canceled on scope disposal.
    async function read() {
      try {
        const value = await request('activity', { sessionId }, controller.signal)
        if (controller.signal.aborted) return
        if (!validActivity(value, sessionId)) throw new Error('Unavailable activity')
        setStatus(value)
        setError(false)
      } catch {
        if (controller.signal.aborted) return
        setStatus(null)
        setError(true)
      }
      timer = setTimeout(() => void read(), 2000)
    }
    void read()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [sessionId, request, connection, connected])

  const known = connected === 'connected' && !error ? status : null
  const unavailable = connected !== 'connected' || error
  const label = known
    ? `Dispatch activity: ${known.occupied} occupied, ${known.active ?? 'unknown'} active, ${known.queued} queued${known.queued === 5 ? '. Queue full' : ''}`
    : `Dispatch activity: ${unavailable ? 'unavailable' : 'loading'}`
  const worker = known?.workers[0]
  const navigate = worker && openSession ? () => openSession(worker.workerId) : undefined
  const content = (
    <>
      <svg
        className="dsp-activity-glyph"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M2 8h3l2-4 2 8 2-4h3" />
      </svg>
      {known ? (
        <>
          <span>
            <span className="dsp-activity-count">{known.occupied}</span> occupied
          </span>
          <span className="dsp-activity-detail">
            {known.active === null
              ? 'activity unknown'
              : known.active
                ? `${known.active} active`
                : known.occupied
                  ? 'waiting'
                  : 'idle'}
          </span>
          {known.queued > 0 ? (
            <span className="dsp-activity-queue">
              <span className="dsp-activity-count">{known.queued}</span> queued
            </span>
          ) : null}
        </>
      ) : (
        <span>Dispatch · {unavailable ? 'unavailable' : 'loading…'}</span>
      )}
    </>
  )
  const common = {
    className: 'dsp-activity',
    'aria-label': label,
    'data-busy': Boolean(known?.active),
    title: `${label}${navigate && worker ? `. Open worker: ${worker.title}` : ''}`,
  }
  return (
    <>
      <style>{css}</style>
      {navigate ? (
        <button {...common} type="button" onClick={navigate}>
          {content}
        </button>
      ) : (
        <span {...common} role="status">
          {content}
        </span>
      )}
    </>
  )
}
