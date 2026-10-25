import React, { useEffect, useRef, useState } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  CHANNEL,
  COST_NOTICE,
  isFastStatus,
  isIntegrationStatus,
  isObject,
} from '../../shared/contracts.js'
import type {
  FastMode,
  FastStatus,
  IntegrationStatus,
  RpcTransport,
  RpcEndpoints,
} from '../../shared/contracts.js'

async function call<E extends keyof RpcEndpoints>(
  rpc: RpcTransport,
  endpoint: E,
  payload: RpcEndpoints[E]['input'],
  valid: (value: unknown) => value is RpcEndpoints[E]['result'],
): Promise<RpcEndpoints[E]['result']> {
  let result: unknown
  try {
    result = await rpc.call(CHANNEL, endpoint, payload)
  } catch {
    throw new Error('Codex Fast settings request failed.')
  }
  if (!isObject(result) || result.ok !== true || !valid(result.value)) {
    const message =
      isObject(result) && isObject(result.error) && typeof result.error.message === 'string'
        ? result.error.message
        : 'Codex Fast settings are unavailable.'
    throw new Error(message)
  }
  return result.value
}
const box: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: 'var(--dsw-alias-label-secondary)',
}
const control: React.CSSProperties = {
  padding: '5px 8px',
  borderRadius: 6,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  cursor: 'pointer',
}
const modeLabels: Record<FastMode, string> = {
  off: 'Off',
  all: 'Everything Fast',
  main: 'Main thread only',
}
const nextMode: Record<FastMode, FastMode> = { off: 'all', all: 'main', main: 'off' }

function Bolt({ filled }: { filled: boolean }) {
  return (
    <svg
      width="16"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{
        display: 'block',
        color: filled ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-tertiary)',
      }}
    >
      <path d="m13 2-10 12h8l-1 8 11-12h-8l1-8Z" />
    </svg>
  )
}

export interface FastToggleProps {
  rpc: RpcTransport
  sessionId: string
  useProjection: UseProjection
}
export function FastToggle({ rpc, sessionId, useProjection }: FastToggleProps) {
  const projection = useProjection('modelSelection')
  const [state, setState] = useState<FastStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const readSequence = useRef(0)
  const mutating = useRef(false)
  const button = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  useEffect(() => {
    if (busy || !restoreFocus.current) return
    restoreFocus.current = false
    // Native disabled buttons lose focus while saving; preserve keyboard cycling without
    // taking focus back from another control the user selected during the request.
    if (document.activeElement === document.body) button.current?.focus()
  }, [busy])
  // Bind settlements to session/model identity, including unmount and native model changes.
  useEffect(() => {
    const current = ++generation.current
    mutating.current = false
    restoreFocus.current = false
    setState(null)
    setError('')
    setBusy(false)
    const refresh = () => {
      if (mutating.current) return
      const sequence = ++readSequence.current
      void call(rpc, 'session-status', { sessionId }, isFastStatus).then(
        (value) => {
          if (
            current === generation.current &&
            sequence === readSequence.current &&
            value.sessionId === sessionId
          ) {
            setState(value)
            setError('')
          }
        },
        () => {
          if (current === generation.current && sequence === readSequence.current) {
            setState(null)
            setError('Fast settings unavailable. Refresh to try again.')
          }
        },
      )
    }
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('dsh-codex-fast-changed', refresh)
    return () => {
      ++generation.current
      window.removeEventListener('focus', refresh)
      window.removeEventListener('dsh-codex-fast-changed', refresh)
    }
  }, [rpc, sessionId, projection])
  const setMode = async (mode: FastMode) => {
    if (!state || busy || mutating.current) return
    const current = generation.current
    ++readSequence.current
    mutating.current = true
    restoreFocus.current = document.activeElement === button.current
    setBusy(true)
    setError('')
    try {
      const result = await call(
        rpc,
        'mode-set',
        {
          sessionId,
          // Off also recovers a saved Codex choice after switching providers.
          provider: mode === 'off' ? 'openai-codex' : state.provider,
          model: state.model,
          mode,
          sessionRevision: state.sessionRevision,
          subagentsRevision: state.subagentsRevision,
        },
        isFastStatus,
      )
      if (result.sessionId !== sessionId) throw new Error('Fast setting returned another session.')
      if (current === generation.current) setState(result)
    } catch (failure) {
      if (current === generation.current) {
        setError(failure instanceof Error ? failure.message : 'Fast setting failed.')
        // Off can take effect in memory even if its durable write fails.
        try {
          const fresh = await call(rpc, 'session-status', { sessionId }, isFastStatus)
          if (current === generation.current) setState(fresh.sessionId === sessionId ? fresh : null)
        } catch {
          if (current === generation.current) setState(null)
        }
      }
    } finally {
      if (current === generation.current) {
        mutating.current = false
        setBusy(false)
      }
    }
  }
  const unavailable = !state
    ? null
    : !state.enabled
      ? 'Fast integration is disabled. Enable it in Plugins → Codex Fast.'
      : !state.available
        ? (state.error ?? 'Fast integration is unavailable.')
        : !state.supported
          ? (state.notice ?? 'This model does not support Fast.')
          : null
  const active = !!state?.enabled && !!state.available && state.supported && state.requested
  const mode: FastMode = active ? (state.subagentsRequested ? 'all' : 'main') : 'off'
  const offPending = !!state?.sessionOffPending || !!state?.subagentsOffPending
  const canRecover = !!state?.requested || !!state?.subagentsRequested || offPending
  const target = offPending || unavailable ? 'off' : nextMode[mode]
  const label = state ? modeLabels[mode] : error ? 'Unavailable' : 'Loading'
  const title = [
    `Fast mode: ${label}.`,
    !state
      ? error
        ? 'Refresh Fast status to try again.'
        : 'Loading Fast status.'
      : offPending
        ? 'A Fast change is not saved. Click to save Off.'
        : unavailable
          ? `${unavailable}${canRecover ? ' Click to save Off.' : ''}`
          : `Click for ${modeLabels[target]}.`,
    COST_NOTICE,
    'Changes apply to new requests.',
  ].join(' ')
  return (
    <div style={{ ...box, flexWrap: 'nowrap' }} data-codex-fast-control>
      <button
        ref={button}
        type="button"
        aria-label={`Fast mode: ${label}${offPending ? ' (unsaved change)' : ''}`}
        aria-busy={busy}
        disabled={busy || !state || (!!unavailable && !canRecover)}
        title={title}
        style={{
          ...control,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          minWidth: 46,
          minHeight: 30,
          ...(mode !== 'off'
            ? {
                background:
                  'color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, var(--dsw-alias-bg-layer-1))',
              }
            : {}),
        }}
        onClick={() => {
          void setMode(target)
        }}
      >
        <Bolt filled={mode !== 'off'} />
        <Bolt filled={mode === 'all'} />
      </button>
      {error ? (
        <span role="alert" style={{ color: 'var(--dsw-alias-state-error-primary)' }}>
          {error}
        </span>
      ) : null}
      {error ? (
        <button
          type="button"
          style={control}
          disabled={busy}
          onClick={() => window.dispatchEvent(new Event('dsh-codex-fast-changed'))}
        >
          Refresh Fast status
        </button>
      ) : null}
    </div>
  )
}
export interface IntegrationProps {
  rpc: RpcTransport
  view?: 'summary' | 'page'
}
export function IntegrationSettings({ rpc, view }: IntegrationProps) {
  return view === 'summary' ? (
    <span>Optional Fast mode; disabling it preserves Codex login and Standard inference.</span>
  ) : (
    <IntegrationForm rpc={rpc} />
  )
}
function IntegrationForm({ rpc }: { rpc: RpcTransport }) {
  const [state, setState] = useState<IntegrationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const refresh = () => {
    const current = ++generation.current
    void call(rpc, 'integration-status', {}, isIntegrationStatus).then(
      (value) => {
        if (current === generation.current) {
          setState(value)
          setError('')
        }
      },
      () => {
        if (current === generation.current) setError('Fast integration status is unavailable.')
      },
    )
  }
  useEffect(() => {
    setState(null)
    refresh()
    return () => {
      ++generation.current
    }
  }, [rpc])
  const toggle = async () => {
    if (!state || busy) return
    const current = ++generation.current
    setBusy(true)
    setError('')
    try {
      const value = await call(
        rpc,
        'integration-set',
        { enabled: !state.enabled, revision: state.revision },
        isIntegrationStatus,
      )
      if (current === generation.current) setState(value)
      window.dispatchEvent(new Event('dsh-codex-fast-changed'))
    } catch (failure) {
      if (current === generation.current) {
        setError(failure instanceof Error ? failure.message : 'Fast integration update failed.')
        try {
          const value = await call(rpc, 'integration-status', {}, isIntegrationStatus)
          if (current === generation.current) setState(value)
        } catch {
          /* Preserve the failure; never optimistically claim a successful change. */
        }
      }
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }
  return (
    <section
      style={{ ...box, display: 'block', maxWidth: 640 }}
      aria-label="Codex Fast integration settings"
    >
      <h3 style={{ color: 'var(--dsw-alias-label-primary)' }}>Codex Fast</h3>
      <p>
        Keep the plugin installed while turning its inference integration off. Codex login and
        Standard inference do not depend on this switch.
      </p>
      <button
        type="button"
        role="switch"
        aria-label="Codex Fast integration"
        aria-checked={state?.enabled ?? false}
        disabled={!state || busy}
        style={control}
        onClick={() => {
          void toggle()
        }}
      >
        Fast integration {state?.enabled ? 'On' : 'Off'}
      </button>
      <button type="button" style={{ ...control, marginLeft: 8 }} disabled={busy} onClick={refresh}>
        Refresh integration status
      </button>
      <p>
        Off stops new Fast requests and pending payload construction. A request whose body is
        already prepared may still use Fast, even while its connection is opening.
      </p>
      <p>{COST_NOTICE}</p>
      <p>
        The two-bolt composer button cycles Off → Everything Fast → Main thread only → Off. Filled
        bolts show Fast for the main thread (left) and eligible Codex subagents (right). New
        sessions start Off. Your choice survives resume, but is not copied to new sessions or forks.
        Changing models uses Standard unless that exact model has a saved Fast choice. Title,
        summary, and compaction calls stay unchanged.
      </p>
      <p>
        Diagnostics report that Fast was requested—not that OpenAI confirmed the effective tier. No
        credentials or prompts are inspected.
      </p>
      {state?.error || error ? (
        <p role="alert" style={{ color: 'var(--dsw-alias-state-error-primary)' }}>
          {error || state?.error}
        </p>
      ) : null}
    </section>
  )
}
