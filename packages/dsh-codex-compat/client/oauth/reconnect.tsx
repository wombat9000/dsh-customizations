import React, { useEffect, useRef, useState } from 'react'
import { isObject } from '../../shared/contracts.js'
import type { RpcTransport } from '../../shared/contracts.js'
import { CODEX_DEVICE_URL, isReconnectStatus, OAUTH_CHANNEL } from '../../shared/oauth.js'
import type { ReconnectEndpoints, ReconnectStatus } from '../../shared/oauth.js'

export interface ReconnectCodexProps {
  provider: { provider: string }
  configured: boolean
  rpc: RpcTransport
}

interface Run {
  id?: string
  abandoned: boolean
}

const control: React.CSSProperties = {
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
}

const unavailable = 'Codex reconnect is unavailable. Check that Codex OAuth is enabled in Plugins.'
const descriptions: Record<ReconnectStatus['phase'], string> = {
  starting: 'Requesting a one-time code…',
  code: 'Enter this one-time code on the OpenAI page.',
  cancelling: 'Cancelling sign-in…',
  authorized: 'Codex reconnected. You can retry your turn.',
  cancelled: 'Stopped waiting. If you already approved sign-in, DSH may still save the connection.',
  failed:
    'Codex sign-in failed. Check that your ChatGPT account allows device sign-in, then try again.',
}

function ReconnectControl({ rpc }: Pick<ReconnectCodexProps, 'rpc'>) {
  const run = useRef<Run>()
  const [status, setStatus] = useState<ReconnectStatus>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [cancelPending, setCancelPending] = useState(false)

  const call = <E extends keyof ReconnectEndpoints>(
    endpoint: E,
    input: ReconnectEndpoints[E]['input'],
  ) => rpc.call<ReconnectEndpoints[E]['result']>(OAUTH_CHANNEL, endpoint, input)

  useEffect(
    () => () => {
      if (run.current) run.current.abandoned = true
    },
    [],
  )

  async function start() {
    if (run.current) return
    const current: Run = { abandoned: false }
    run.current = current
    setBusy(true)
    setError(undefined)
    setStatus({ phase: 'starting' })
    let finished = false
    try {
      const started = await call('start', {})
      if (!started.ok || !isObject(started.value)) throw new Error(unavailable)
      if ('busy' in started.value && started.value.busy === true) {
        if (!current.abandoned) {
          setStatus(undefined)
          setError('A Codex sign-in is already in progress.')
        }
        return
      }
      if (!('id' in started.value) || typeof started.value.id !== 'string')
        throw new Error(unavailable)
      current.id = started.value.id
      while (!current.abandoned) {
        const result = await call('status', { id: current.id })
        if (current.abandoned) break
        if (!result.ok || !isReconnectStatus(result.value)) throw new Error(unavailable)
        setStatus(result.value)
        if (['authorized', 'cancelled', 'failed'].includes(result.value.phase)) {
          finished = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    } catch {
      if (!current.abandoned) {
        setStatus(undefined)
        setError(unavailable)
      }
    } finally {
      // The start reply may arrive after the card closes. Cancel that attempt too.
      if (!finished && current.id) void call('cancel', { id: current.id }).catch(() => {})
      run.current = undefined
      if (!current.abandoned) {
        setBusy(false)
        setCancelPending(false)
      }
    }
  }

  async function cancel() {
    const current = run.current
    if (!current?.id || cancelPending) return
    setCancelPending(true)
    setError(undefined)
    try {
      const result = await call('cancel', { id: current.id })
      if (!result.ok) throw new Error('Cancel failed')
    } catch {
      if (run.current === current && !current.abandoned) {
        setError('Could not cancel Codex sign-in. Try again.')
        setCancelPending(false)
      }
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" style={control} onClick={() => void start()} disabled={busy}>
          Reconnect Codex
        </button>
        {busy && run.current?.id && (
          <button
            type="button"
            style={control}
            onClick={() => void cancel()}
            disabled={cancelPending}
          >
            Cancel sign-in
          </button>
        )}
      </div>
      {status && (
        <div role="status">{descriptions[cancelPending ? 'cancelling' : status.phase]}</div>
      )}
      {status?.phase === 'code' && !cancelPending && (
        <div>
          <a href={CODEX_DEVICE_URL} target="_blank" rel="noopener noreferrer">
            Open OpenAI sign-in
          </a>{' '}
          <code>{status.code}</code>
        </div>
      )}
      {error && <div role="alert">{error}</div>}
    </div>
  )
}

/** The provider slot is shared by all pi-ai routes. Only Codex uses this flow. */
export function ReconnectCodex({ provider, configured, rpc }: ReconnectCodexProps) {
  if (provider.provider !== 'openai-codex' || !configured) return null
  return <ReconnectControl rpc={rpc} />
}
