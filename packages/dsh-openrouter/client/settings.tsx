import React, { useEffect, useRef, useState } from 'react'
import type { OpenRouterStatus, RpcTransport } from '../shared/contracts.js'
import { call } from './transport.js'
import { SettingsField, SettingsPanel } from '../../../shared/client/settings.tsx'

export interface SettingsProps {
  rpc: RpcTransport
  view?: 'summary' | 'page' | 'inline'
}

export function SettingsCard(props: SettingsProps) {
  return props.view === 'summary' ? (
    <p>Shared OpenRouter credential for trusted integrations.</p>
  ) : (
    <SettingsForm {...props} />
  )
}

function SettingsForm({ rpc, view }: SettingsProps) {
  const [status, setStatus] = useState<OpenRouterStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    void call(rpc, 'status', {}).then(
      (value) => {
        if (alive.current) setStatus(value)
      },
      () => {
        if (alive.current) setError('Could not read OpenRouter credential status.')
      },
    )
    return () => {
      alive.current = false
    }
  }, [rpc])
  const mutate = async (method: 'save' | 'clear') => {
    if (busy || !status?.writable || status.target === null) return
    if (
      method === 'clear' &&
      !window.confirm(
        'Remove the shared OpenRouter key? This affects every integration and DSH model route using it. A lower-priority environment key may become active.',
      )
    )
      return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const value =
        method === 'save'
          ? await call(rpc, 'save', { target: status.target, apiKey: draft.trim() })
          : await call(rpc, 'clear', { target: status.target })
      if (alive.current) {
        setStatus(value)
        setDraft('')
        setNotice(
          method === 'save'
            ? 'Shared OpenRouter key saved. No remote request was made.'
            : 'Stored key removed. Effective credential status refreshed.',
        )
      }
    } catch (failure) {
      if (alive.current) {
        setError(
          failure instanceof Error ? failure.message : 'OpenRouter settings are unavailable.',
        )
        // A changed effective source must be reviewed before a later write.
        try {
          const value = await call(rpc, 'status', {})
          if (alive.current) setStatus(value)
        } catch {
          if (alive.current) setStatus(null)
        }
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <SettingsPanel
      title="OpenRouter"
      initiallyOpen={view === 'page'}
      status={
        status
          ? `Shared key: ${status.configured ? 'Configured' : 'Not configured'}${status.source ? ` (${status.source})` : ''}`
          : 'Checking shared key…'
      }
      description="One credential for trusted OpenRouter integrations and the built-in OpenRouter model route. Replacing or removing it affects all consumers. The key is stored in DSH credentials, never ordinary plugin settings."
      error={error || status?.error}
      notice={notice}
      actions={
        <>
          <button
            type="button"
            disabled={busy || !status?.writable || !draft.trim()}
            onClick={() => {
              void mutate('save')
            }}
          >
            Save shared key
          </button>
          <button
            type="button"
            disabled={busy || !status?.writable || !status?.configured}
            onClick={() => {
              void mutate('clear')
            }}
          >
            Remove shared key
          </button>
        </>
      }
    >
      {status && !status.writable ? (
        <p>This credential source is read-only. Change it where it is configured.</p>
      ) : null}
      <SettingsField
        label="OpenRouter API key"
        type="password"
        value={draft}
        disabled={busy || !status?.writable}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
      />
    </SettingsPanel>
  )
}
