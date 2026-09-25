import * as React from 'react'
import type { CardProps } from '../shared/contracts.ts'
import { object, text, id, rawDetails } from './validation.ts'
import { Link } from './common.tsx'
import { css } from './styles.ts'
import { api } from './transport.ts'
import {
  FIELD_TOOL,
  fieldValueModel,
  validFieldStatus,
  fieldPhase,
  fieldPhaseLabel,
  fieldResult,
  validatedFieldResult,
  fieldFailureReason,
  fieldRequestedTarget,
  fieldSafeText,
  type FieldStatus,
} from './field-model.ts'

export function FieldChangeCard({
  sessionId,
  callId,
  block,
  inspect,
  useSessionPendingInteraction,
  request = api,
}: CardProps) {
  const pending =
    typeof useSessionPendingInteraction === 'function'
      ? useSessionPendingInteraction((map) => {
          const value = map.get(sessionId)
          return value?.kind === 'approval' &&
            value.callId === callId &&
            value.toolName === FIELD_TOOL
            ? value
            : undefined
        })
      : undefined
  const [loaded, setLoaded] = React.useState<{
      sessionId: string
      callId: string
      value: FieldStatus
    } | null>(null),
    [error, setError] = React.useState('')
  const generation = React.useRef(0)
  const status = loaded?.sessionId === sessionId && loaded?.callId === callId ? loaded.value : null
  React.useEffect(() => {
    const token = ++generation.current,
      controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined,
      failures = 0
    setLoaded(null)
    setError('')
    async function load() {
      if (generation.current !== token) return
      try {
        const value = await request('status', { sessionId, callId }, controller.signal)
        if (generation.current !== token) return
        if (!validFieldStatus(value, callId)) throw new Error('Invalid prepared change')
        setLoaded({ sessionId, callId, value })
        setError('')
        failures = 0
        if (
          [
            'preparing',
            'prepared',
            'approved',
            'authorized-by-grant',
            'running',
            'awaiting-approval',
          ].includes(value.phase)
        )
          timer = setTimeout(load, 1500)
      } catch {
        if (generation.current !== token || controller.signal.aborted) return
        setLoaded(null)
        setError(
          'Prepared change details are unavailable. See the native approval preview and raw tool details; no previous value or outcome is inferred.',
        )
        if (++failures <= 3) timer = setTimeout(load, 1500)
      }
    }
    void load()
    return () => {
      generation.current++
      controller.abort()
      clearTimeout(timer)
    }
  }, [sessionId, callId, request, pending?.key, block?.kind])
  const change = status?.change,
    field = object(change?.field) ? change.field : undefined,
    project = object(status?.targets?.project) ? status.targets.project : undefined,
    item = object(status?.targets?.item) ? status.targets.item : undefined
  const content = object(item?.content) ? item.content : undefined,
    before = fieldValueModel(change, 'before'),
    after = fieldValueModel(change, 'after')
  const phase = fieldPhase(status, block, pending),
    result = fieldResult(block) ?? validatedFieldResult(status?.result)
  const reason = fieldFailureReason(block, result),
    requested = fieldRequestedTarget(block)
  const showValues = phase !== 'no-change' && (before.available || after.available)
  const target =
    content?.__typename === 'Issue'
      ? `Issue #${content.number ?? content.id ?? ''}`
      : content?.__typename === 'PullRequest'
        ? `Pull request #${content.number ?? content.id ?? ''}`
        : content?.__typename === 'DraftIssue'
          ? `Draft issue ${text(content.id)}`
          : text(item?.id)
            ? `Item ${item?.id}`
            : ''
  const identities = [
    ['Project', project?.id],
    ['Item', item?.id],
    ['Field', field?.id],
  ]
    .filter(([, value]) => id(value))
    .map(([label, value]) => `${label} ID: ${value}`)
    .join('; ')
  const projectLabel =
    text(project?.title) ||
    (project?.number
      ? `Project ${project.number}`
      : text(project?.id)
        ? `Project ${project?.id}`
        : '')
  const fieldLabel = text(field?.name) || (text(field?.id) ? `Field ${field?.id}` : '')
  const exact = pending?.reason ?? status?.exactPreview
  return (
    <section className="gh-grant" aria-label="GitHub project field change">
      <style>{css}</style>
      <h3>GitHub · Project field change</h3>
      <p role="status">{fieldPhaseLabel(phase)}</p>
      {phase === 'no-change' && (
        <p>The field already has the requested value. Nothing was changed.</p>
      )}
      {reason && <p role="alert">{reason}</p>}
      {!reason && phase === 'unknown' && error && <p role="alert">{error}</p>}
      {target && (
        <p>
          <Link
            url={content?.url}
          >{`${target}${text(content?.title) ? ` — ${content?.title}` : ''}`}</Link>
        </p>
      )}
      {projectLabel && (
        <p>
          <Link url={project?.url}>{projectLabel}</Link>
        </p>
      )}
      {fieldLabel && (
        <p>
          <strong>{fieldLabel}</strong>
        </p>
      )}
      {requested && !identities && (
        <p className="gh-note">{`Requested target (call arguments, not verified resource metadata): ${requested}`}</p>
      )}
      {showValues && (
        <>
          <p className="gh-note">Prepared change (not a fresh read of the field):</p>
          <pre tabIndex={0} aria-label="Prepared before and after values">
            {before.available && after.available
              ? `${before.label} → ${after.label}`
              : before.available
                ? `Before: ${before.label}`
                : `After: ${after.label}`}
          </pre>
          {[before, after].map(
            (value, index) =>
              value.identity && (
                <small
                  key={index}
                >{`${index ? 'After' : 'Before'} ID: ${value.identity}${value.detail ? `; ${value.detail}` : ''}`}</small>
              ),
          )}
        </>
      )}
      {pending && (
        <p>
          The native approval panel keeps the complete exact preview and Allow once / Reject
          controls. Approval is not confirmation that this write succeeded.
        </p>
      )}
      {phase === 'uncertain' && (
        <p role="alert">
          Do not retry automatically. Inspect the explicit GitHub targets before requesting a fresh
          change. No rollback is implied.
        </p>
      )}
      {!['no-change', 'failed'].includes(phase) && typeof result?.message === 'string' && (
        <p>{fieldSafeText(result.message)}</p>
      )}
      {typeof result?.cleanupWarning === 'string' && (
        <p role="alert">{fieldSafeText(result.cleanupWarning)}</p>
      )}
      {exact && (
        <details>
          <summary>Complete exact approval preview</summary>
          <pre tabIndex={0}>{exact}</pre>
        </details>
      )}
      <details>
        <summary>Technical details</summary>
        {identities && <p>{`Verified preparation identifiers: ${identities}`}</p>}
        <pre tabIndex={0}>{rawDetails(block) || 'No raw tool result is available yet.'}</pre>
        {typeof inspect === 'function' && (
          <button type="button" onClick={inspect}>
            Inspect tool call
          </button>
        )}
      </details>
    </section>
  )
}
