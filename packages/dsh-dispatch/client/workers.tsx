import React from 'react'
import type { WorkerStatus } from '../shared/contracts.js'
import type { Request } from './card.js'
import { css } from './card.js'

const WORK_STATES: Record<WorkerStatus['workState'], string> = {
  working: 'Working',
  'waiting-for-user': 'Waiting for input',
  'ready-for-review': 'Ready for review',
  done: 'Done',
  failed: 'Failed',
}

export function validWorkers(value: unknown): value is WorkerStatus[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as WorkerStatus).workerId === 'string' &&
        typeof (item as WorkerStatus).workState === 'string' &&
        typeof (item as WorkerStatus).assignmentOpen === 'boolean' &&
        typeof (item as WorkerStatus).eligible === 'boolean',
    )
  )
}

/** Presentation only: one coordinator's managed workers as the Host reports them now. */
export function WorkersView({
  workers,
  openSession,
  refresh,
  error,
}: {
  workers: WorkerStatus[]
  openSession?: ((sessionId: string) => void) | undefined
  refresh?: () => void
  error?: string
}) {
  return (
    <section className="dsp-card" aria-label="Dispatch workers">
      <style>{css}</style>
      <h3>Dispatch workers</h3>
      {workers.length === 0 ? <p className="dsp-muted">No managed workers.</p> : null}
      {workers.map((worker) => {
        const rows: [string, string][] = [
          [
            'Work state',
            `${WORK_STATES[worker.workState] ?? worker.workState} (${worker.stateSource})`,
          ],
          ['Assignment', `${worker.assignmentId} · ${worker.assignmentOpen ? 'open' : 'closed'}`],
          ['Runtime', worker.runtime],
          ['Branch', worker.branch],
          ['Checkout', worker.worktreePath],
          ['Checkout check', worker.eligibility],
        ]
        if (worker.lastReport)
          rows.push(['Latest report', `${worker.lastReport.kind}: ${worker.lastReport.summary}`])
        return (
          <article key={worker.workerId} aria-label={`Worker ${worker.title ?? worker.workerId}`}>
            <p>
              <strong>{worker.title ?? worker.workerId}</strong>
            </p>
            <dl>
              {rows.map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </React.Fragment>
              ))}
            </dl>
            {openSession ? (
              <div className="dsp-actions">
                <button type="button" onClick={() => openSession(worker.workerId)}>
                  Open worker session
                </button>
              </div>
            ) : null}
          </article>
        )
      })}
      {error ? (
        <p className="dsp-error" role="alert">
          {error}
        </p>
      ) : null}
      {refresh ? (
        <div className="dsp-actions">
          <button type="button" onClick={refresh}>
            Refresh
          </button>
        </div>
      ) : null}
    </section>
  )
}

/** Tool-view container: reads current status from the Host; never decides or sends. */
export function WorkersCard({
  sessionId,
  request,
  openSession,
}: {
  sessionId: string
  request: Request
  openSession?: ((sessionId: string) => void) | undefined
}) {
  const [workers, setWorkers] = React.useState<WorkerStatus[] | null>(null)
  const [error, setError] = React.useState('')
  const [revision, refresh] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    const controller = new AbortController()
    request('workers', { sessionId }, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return
        if (!validWorkers(value)) throw new Error('Invalid Dispatch worker status.')
        setWorkers(value)
        setError('')
      },
      (err: unknown) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : 'Dispatch is unavailable.')
      },
    )
    return () => controller.abort()
  }, [sessionId, request, revision])
  if (!workers)
    return error ? (
      <p className="dsp-error" role="alert">
        {error}
      </p>
    ) : null
  return <WorkersView workers={workers} openSession={openSession} refresh={refresh} error={error} />
}
