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
  border: '1px solid var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  cursor: 'pointer',
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
  // Bind settlements to session/model identity, including unmount and native model changes.
  useEffect(() => {
    const current = ++generation.current
    mutating.current = false
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
            setError(
              'Fast settings unavailable. Standard inference is unaffected while Fast is off.',
            )
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
  const toggle = async () => {
    if (!state || busy) return
    const current = generation.current
    ++readSequence.current
    mutating.current = true
    setBusy(true)
    setError('')
    try {
      const result = await call(
        rpc,
        'session-set',
        {
          sessionId,
          provider: state.provider,
          model: state.model,
          enabled: !state.requested,
          revision: state.sessionRevision,
        },
        isFastStatus,
      )
      if (current === generation.current) setState(result)
    } catch (failure) {
      if (current === generation.current) {
        setError(failure instanceof Error ? failure.message : 'Fast setting failed.')
        // Off can take effect in memory even if its durable write fails.
        try {
          const fresh = await call(rpc, 'session-status', { sessionId }, isFastStatus)
          if (current === generation.current) setState(fresh)
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
  const unavailable = !state?.enabled
    ? 'Fast integration is disabled. Enable it in Plugins → Codex Fast.'
    : !state.available
      ? state.error
      : !state.supported
        ? state.notice
        : null
  const checked = !!state?.requested && !!state.enabled && !!state.available && state.supported
  return (
    <div style={box} data-codex-fast-control>
      <button
        type="button"
        role="switch"
        aria-label="Codex Fast mode"
        aria-checked={checked}
        disabled={busy || !state || (!state.requested && !!unavailable)}
        style={{
          ...control,
          ...(checked ? { borderColor: 'var(--dsw-alias-brand-primary)' } : {}),
        }}
        title={unavailable ?? COST_NOTICE}
        onClick={() => {
          void toggle()
        }}
      >
        Fast {checked ? 'On' : 'Off'}
      </button>
      <details style={{ maxWidth: 320 }}>
        <summary style={{ cursor: 'pointer' }}>Higher usage</summary>
        <p>{COST_NOTICE}</p>
        <p>
          Changes affect new requests. A request whose body is already prepared may still use Fast.
        </p>
        <p>
          {unavailable ??
            state?.notice ??
            'Only this session’s ordinary Codex requests use Fast. Other calls stay unchanged.'}
        </p>
        <button
          type="button"
          style={control}
          onClick={() => window.dispatchEvent(new Event('dsh-codex-fast-changed'))}
        >
          Refresh Fast status
        </button>
      </details>
      {error ? (
        <span role="alert" style={{ color: 'var(--dsw-alias-state-error-primary)' }}>
          {error}
        </span>
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
        New sessions start on Standard. Fast selections survive resume, stay tied to the exact
        selected model, and are not inherited by forks or subagents. Title, summary, and compaction
        calls stay unchanged.
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
