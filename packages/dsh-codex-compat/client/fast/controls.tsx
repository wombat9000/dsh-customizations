import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--dsw-alias-border-l1)',
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
  const [expanded, setExpanded] = useState(false)
  const details = useRef<HTMLDetailsElement>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const [panelPosition, setPanelPosition] = useState({ left: 16, top: 16 })
  const generation = useRef(0)
  const readSequence = useRef(0)
  const mutating = useRef(false)
  useLayoutEffect(() => {
    if (!expanded || !anchor.current || !panel.current) return
    const position = () => {
      if (!anchor.current || !panel.current) return
      const trigger = anchor.current.getBoundingClientRect()
      const content = panel.current.getBoundingClientRect()
      const left = Math.max(
        16,
        Math.min(trigger.right - content.width, window.innerWidth - content.width - 16),
      )
      const above = trigger.top - content.height - 8
      const below = trigger.bottom + 8
      const top =
        above >= 16
          ? above
          : below + content.height <= window.innerHeight - 16
            ? below
            : Math.max(16, window.innerHeight - content.height - 16)
      setPanelPosition((previous) =>
        previous.left === left && previous.top === top ? previous : { left, top },
      )
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(anchor.current)
    observer.observe(panel.current)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [expanded])
  useEffect(() => {
    if (!expanded) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !details.current?.contains(event.target))
        setExpanded(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setExpanded(false)
      details.current?.querySelector<HTMLElement>('summary')?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [expanded])
  // Bind settlements to session/model identity, including unmount and native model changes.
  useEffect(() => {
    const current = ++generation.current
    mutating.current = false
    setState(null)
    setError('')
    setBusy(false)
    setExpanded(false)
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
  const toggle = async (scope: 'session' | 'subagents', desired?: boolean) => {
    if (!state || busy || mutating.current) return
    const enabled = desired ?? !(scope === 'subagents' ? state.subagentsRequested : state.requested)
    const current = generation.current
    ++readSequence.current
    mutating.current = true
    setBusy(true)
    setError('')
    try {
      const result =
        scope === 'subagents'
          ? await call(
              rpc,
              'subagents-set',
              {
                sessionId,
                enabled,
                revision: state.subagentsRevision,
              },
              isFastStatus,
            )
          : await call(
              rpc,
              'session-set',
              {
                sessionId,
                // Off is recovery for the saved Codex choice, even after selecting another provider.
                provider: enabled ? state.provider : 'openai-codex',
                model: state.model,
                enabled,
                revision: state.sessionRevision,
              },
              isFastStatus,
            )
      if (current === generation.current) setState(result)
    } catch (failure) {
      if (current === generation.current) {
        setError(failure instanceof Error ? failure.message : 'Fast setting failed.')
        setExpanded(true)
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
  const subagentsChecked = !!state?.subagentsRequested && !!state.enabled && !!state.available
  const integrationUnavailable = !state?.enabled || !state.available
  return (
    <div
      ref={anchor}
      style={{ ...box, flexWrap: 'nowrap', gap: 0, position: 'relative' }}
      data-codex-fast-control
    >
      <button
        type="button"
        role="switch"
        aria-label="Codex Fast mode"
        aria-checked={checked}
        disabled={busy || !state || (!state.requested && !!unavailable)}
        style={{
          ...control,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          whiteSpace: 'nowrap',
          ...(checked ? { borderColor: 'var(--dsw-alias-brand-primary)' } : {}),
        }}
        title={unavailable ?? COST_NOTICE}
        onClick={() => {
          void toggle('session')
        }}
      >
        Fast {checked ? 'On' : 'Off'}
      </button>
      <details
        ref={details}
        open={expanded}
        onToggle={() => setExpanded(details.current?.open ?? false)}
      >
        <summary
          role="button"
          aria-label="Fast options"
          aria-expanded={expanded}
          title={
            subagentsChecked
              ? 'Fast options — Subagents Fast is on'
              : 'Fast options and higher usage'
          }
          style={{
            ...control,
            display: 'block',
            listStyle: 'none',
            whiteSpace: 'nowrap',
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
            marginLeft: -1,
            ...(subagentsChecked ? { borderColor: 'var(--dsw-alias-brand-primary)' } : {}),
          }}
        >
          {subagentsChecked ? 'Subagents On ' : ''}▾
        </summary>
        <section
          ref={panel}
          aria-label="Fast options"
          style={{
            ...box,
            display: 'block',
            position: 'fixed',
            ...panelPosition,
            zIndex: 1100,
            boxSizing: 'border-box',
            width: 'min(320px, calc(100vw - 32px))',
            maxHeight: 'calc(100vh - 120px)',
            overflowY: 'auto',
            padding: 14,
            borderRadius: 10,
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-1)',
            boxShadow: 'var(--dsw-elevation-prominent)',
            lineHeight: '18px',
          }}
        >
          <button
            type="button"
            role="switch"
            aria-label="Subagents Fast"
            aria-checked={subagentsChecked}
            disabled={busy || !state || (!state.subagentsRequested && integrationUnavailable)}
            style={control}
            onClick={() => {
              void toggle('subagents')
            }}
          >
            Subagents Fast {subagentsChecked ? 'On' : 'Off'}
          </button>
          <p>
            Independent of this session’s Fast switch. Applies to eligible Codex subagents,
            including nested subagents. Other models stay unchanged.
          </p>
          <strong>Higher usage</strong>
          <p>{COST_NOTICE}</p>
          <p>
            Changes affect new requests. A request whose body is already prepared may still use
            Fast.
          </p>
          <p>
            {unavailable ??
              state?.notice ??
              'Fast requests priority service; OpenAI’s effective tier is not confirmed.'}
          </p>
          <button
            type="button"
            style={control}
            onClick={() => window.dispatchEvent(new Event('dsh-codex-fast-changed'))}
          >
            Refresh Fast status
          </button>
          {state?.sessionOffPending || state?.subagentsOffPending ? (
            <div>
              <p>Off applies in this process. Persist Off before restarting.</p>
              {state.sessionOffPending ? (
                <button
                  type="button"
                  style={control}
                  disabled={busy}
                  onClick={() => {
                    void toggle('session', false)
                  }}
                >
                  Retry session Off
                </button>
              ) : null}
              {state.subagentsOffPending ? (
                <button
                  type="button"
                  style={control}
                  disabled={busy}
                  onClick={() => {
                    void toggle('subagents', false)
                  }}
                >
                  Retry Subagents Off
                </button>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <p role="alert" style={{ color: 'var(--dsw-alias-state-error-primary)' }}>
              {error}
            </p>
          ) : null}
        </section>
      </details>
      {error && !expanded ? (
        <span role="alert" style={{ color: 'var(--dsw-alias-state-error-primary)', marginLeft: 8 }}>
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
        New sessions start on Standard with Subagents Fast off. This session’s Fast selection stays
        tied to the exact selected model. Its independent Subagents Fast setting covers eligible
        Codex descendants, even when this session uses Standard or another provider. Both choices
        survive resume but are not copied to new top-level sessions or forks. Title, summary, and
        compaction calls stay unchanged.
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
