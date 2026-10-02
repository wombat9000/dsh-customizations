import React, { useEffect, useRef, useState } from 'react'
import type { JevStatus } from '../shared/contracts.ts'
import { call, type Rpc } from './rpc.ts'
import { css } from './styles.ts'

export interface SettingsProps {
  rpc: Rpc
  view?: 'summary' | 'page' | 'card'
}
export function SettingsCard(props: SettingsProps) {
  return props.view === 'summary' ? (
    <p>Jev model and shared OpenRouter credential status.</p>
  ) : (
    <SettingsForm {...props} />
  )
}
function SettingsForm({ rpc, view }: SettingsProps) {
  const [status, setStatus] = useState<JevStatus | null>(null)
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const alive = useRef(false)
  const load = async (resetModel = false) => {
    try {
      const value = await call(rpc, 'status', {})
      if (alive.current) {
        setStatus(value)
        if (resetModel) setModel(value.model)
      }
    } catch {
      if (alive.current) setError('Could not read Jev settings.')
    }
  }
  useEffect(() => {
    alive.current = true
    const style = document.createElement('style')
    style.textContent = css
    style.dataset.pluginCss = 'jev/settings'
    document.head.appendChild(style)
    void load(true)
    return () => {
      alive.current = false
      style.remove()
    }
  }, [rpc])
  const save = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const value = await call(rpc, 'configure', { model: model.trim() })
      if (alive.current) {
        setStatus(value)
        setModel(value.model)
        setNotice('Jev model saved. No evaluation was sent.')
      }
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : 'Jev settings are unavailable.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <details className="dsh-jev" aria-label="Jev settings" open={view === 'page'}>
      <summary>Jev</summary>
      <div className="dsh-jev__body">
        <p role="status">
          {status
            ? `Shared OpenRouter key: ${status.credential?.configured ? 'Configured' : 'Not configured'}`
            : 'Checking shared OpenRouter key…'}
        </p>
        <p className="dsh-jev__hint">
          Manage the shared key in the OpenRouter plugin card. Jev evaluates typed questions; it is
          not a chat model. Consumers choose when to send data through OpenRouter to TypeSafe.
        </p>
        <label>
          Jev model ID
          <input
            value={model}
            disabled={busy || !status}
            onChange={(event) => setModel(event.target.value)}
            spellCheck={false}
          />
        </label>
        <p className="dsh-jev__hint">
          Default: typesafe/jev-1.13. Use ~typesafe/jev-latest only if you want the release to
          change automatically.
        </p>
        <button
          type="button"
          disabled={busy || !status || !model.trim()}
          onClick={() => {
            void save()
          }}
        >
          Save Jev model
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void load()
          }}
        >
          Refresh credential status
        </button>
        {error || status?.credential?.error ? (
          <p role="alert">{error || status?.credential.error}</p>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
      </div>
    </details>
  )
}
