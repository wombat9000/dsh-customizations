import React from 'react'
import type { ProposalStatus, RpcEndpoints } from '../shared/contracts.js'

export type Request = <E extends keyof RpcEndpoints>(
  endpoint: E,
  input: RpcEndpoints[E]['input'],
  signal?: AbortSignal,
) => Promise<RpcEndpoints[E]['result']>

export interface CardProps {
  sessionId: string
  callId: string
  request: Request
}

const LIVE = new Set(['pending', 'executing'])

export function validStatus(value: unknown): value is ProposalStatus {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.proposalId === 'string' &&
    typeof v.state === 'string' &&
    typeof v.intent === 'string' &&
    typeof v.prompt === 'string' &&
    typeof v.preset === 'string' &&
    typeof v.model === 'string' &&
    typeof v.digest === 'string' &&
    /^[0-9a-f]{64}$/u.test(v.digest) &&
    Array.isArray(v.checkpoints)
  )
}

const css = `
.dsp-card { font: 13px/1.5 var(--dsw-font-family, system-ui, sans-serif); color: var(--dsw-alias-label-primary);
  padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; display: grid; gap: 10px; }
.dsp-card * { box-sizing: border-box; }
.dsp-card h3 { margin: 0; font-size: 14px; }
.dsp-card p { margin: 0; }
.dsp-muted { color: var(--dsw-alias-label-secondary); }
.dsp-card dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin: 0; }
.dsp-card dt { color: var(--dsw-alias-label-secondary); }
.dsp-card dd { margin: 0; overflow-wrap: anywhere; font-family: var(--dsw-font-family-mono, ui-monospace, monospace); }
.dsp-card pre { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow: auto;
  padding: 8px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.dsp-card button { font: inherit; color: inherit; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  padding: 6px 12px; background: var(--dsw-alias-bg-layer-1); cursor: pointer; }
.dsp-card button:disabled { opacity: .45; cursor: default; }
.dsp-card button:focus-visible, .dsp-card summary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsp-card .dsp-primary { background: var(--dsw-alias-button-primary-fill); border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground); font-weight: 600; }
.dsp-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.dsp-error { color: var(--dsw-alias-label-danger, #c62828); }
`

const TITLES: Record<ProposalStatus['kind'], string> = {
  create: 'Create Dispatch worker',
  adopt: 'Adopt session as Dispatch worker',
  assign: 'New Dispatch assignment',
}

const STATES: Record<ProposalStatus['state'], string> = {
  pending: 'Waiting for your decision. Nothing has been created or sent.',
  rejected: 'Rejected. Nothing was created or sent.',
  expired: 'Expired. This card can no longer authorize anything.',
  executing: 'Approved. Dispatch is carrying out this exact proposal.',
  succeeded: 'Done. The worker received the approved prompt.',
  failed: 'Failed. Retained artifacts are listed below; nothing was retried.',
  uncertain: 'Outcome uncertain. Inspect retained artifacts before trying again.',
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Dispatch is unavailable.'
}

/** Presentation only: every value shown comes from the Host-held immutable proposal. */
export function ProposalView({
  status,
  busy,
  error,
  decide,
}: {
  status: ProposalStatus
  busy: boolean
  error: string
  decide?: (decision: 'approve' | 'reject') => void
}) {
  const rows: [string, string][] = [
    ['Preset', status.preset],
    ['Model', status.model],
  ]
  if (status.base) {
    rows.push(['Repository', status.base.repositoryRoot])
    rows.push([
      'Base',
      `${status.base.ref} @ ${status.base.commit.slice(0, 12)} (fetched ${status.base.fetchedAt})`,
    ])
  }
  if (status.target) {
    rows.push(['Repository', status.target.repositoryRoot])
    rows.push(['Checkout', status.target.worktreePath])
    rows.push(['Commit', status.target.head.slice(0, 12)])
  }
  if (status.branch) rows.push(['Branch', status.branch])
  if (status.workerSessionId) rows.push(['Worker session', status.workerSessionId])
  if (status.worktree) rows.push(['Worktree', status.worktree.path])
  if (status.checkpoints.length) rows.push(['Completed steps', status.checkpoints.join(', ')])
  return (
    <section className="dsp-card" aria-label={TITLES[status.kind] ?? 'Dispatch proposal'}>
      <style>{css}</style>
      <h3>{TITLES[status.kind] ?? 'Dispatch proposal'}</h3>
      <p>{status.intent}</p>
      <dl>
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <details>
        <summary>Complete prompt ({status.prompt.length} characters)</summary>
        <pre>{status.prompt}</pre>
      </details>
      <p className="dsp-muted" role="status">
        {STATES[status.state] ?? status.state}
      </p>
      {status.message ? <p className="dsp-muted">{status.message}</p> : null}
      {error ? (
        <p className="dsp-error" role="alert">
          {error}
        </p>
      ) : null}
      {status.state === 'pending' && decide ? (
        <div className="dsp-actions">
          <button
            type="button"
            className="dsp-primary"
            disabled={busy}
            onClick={() => decide('approve')}
          >
            Approve
          </button>
          <button type="button" disabled={busy} onClick={() => decide('reject')}>
            Reject
          </button>
        </div>
      ) : null}
      <p className="dsp-muted">Observed {status.observedAt}</p>
    </section>
  )
}

/**
 * Tool-view container. Status comes from the Host each time; a reloaded or
 * historical card shows the stored outcome and can only decide a proposal
 * the Host still holds as pending in this Host lifetime.
 */
export function ProposalCard({ sessionId, callId, request }: CardProps) {
  const [status, setStatus] = React.useState<ProposalStatus | null>(null)
  const [missing, setMissing] = React.useState(false)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [revision, refresh] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    async function load() {
      try {
        const value = await request('status', { sessionId, callId }, controller.signal)
        if (controller.signal.aborted) return
        if (!validStatus(value))
          throw new Error('Invalid Dispatch proposal; approval is unavailable.')
        setStatus(value)
        setMissing(false)
        failures = 0
        if (LIVE.has(value.state)) timer = setTimeout(load, 2000)
      } catch (err) {
        if (controller.signal.aborted) return
        if (errorMessage(err).includes('no longer exists')) setMissing(true)
        else {
          setError(errorMessage(err))
          if (++failures <= 5) timer = setTimeout(load, 2000)
        }
      }
    }
    void load()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [sessionId, callId, request, revision])
  const decide = React.useCallback(
    async (decision: 'approve' | 'reject') => {
      if (!status || busy) return
      setBusy(true)
      setError('')
      try {
        const value = await request('decide', {
          sessionId,
          callId,
          proposalId: status.proposalId,
          digest: status.digest,
          decision,
        })
        if (validStatus(value)) setStatus(value)
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setBusy(false)
        refresh()
      }
    },
    [status, busy, request, sessionId, callId],
  )
  if (missing) return null
  if (!status)
    return error ? (
      <p className="dsp-error" role="alert">
        {error}
      </p>
    ) : null
  return <ProposalView status={status} busy={busy} error={error} decide={decide} />
}
