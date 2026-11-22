import React from 'react'
import {
  CHANNEL,
  type ConnectionStatus,
  type SettingsRpc,
  type RpcEndpoints,
} from '../shared/rpc.js'
import { apiKeyFailure } from '../shared/api-key.js'
import { messageOf, sourceLabel } from './labels.js'
import {
  SettingsDetailList,
  SettingsField,
  SettingsPanel,
} from '../../../shared/client/settings.tsx'
export interface SettingsProps {
  rpc: SettingsRpc
  subscribe(listener: () => void): () => void
  view?: string
}
export function LinearSettingsSection(props: SettingsProps) {
  const { rpc, subscribe } = props
  const [status, setStatus] = React.useState<ConnectionStatus | undefined>(undefined)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | undefined>(undefined)
  const [success, setSuccess] = React.useState<string | undefined>(undefined)
  const [revision, setRevision] = React.useState(0)

  React.useEffect(() => subscribe(() => setRevision((value) => value + 1)), [subscribe])

  React.useEffect(() => {
    let active = true
    rpc.call(CHANNEL, 'status', {}).then(
      (result) => {
        if (!active) return
        if (!result.ok) {
          setFailure(result.error.message)
          return
        }
        setStatus(result.value)
      },
      (error) => {
        if (active) setFailure(messageOf(error))
      },
    )
    return () => {
      active = false
    }
  }, [rpc, revision])

  const call = async <E extends keyof RpcEndpoints>(
    endpoint: E,
    payload: RpcEndpoints[E],
    successMessage: string,
  ) => {
    setBusy(true)
    setFailure(undefined)
    setSuccess(undefined)
    try {
      const result = await rpc.call(CHANNEL, endpoint, payload)
      if (!result.ok) {
        setFailure(result.error.message)
        return false
      }
      setStatus(result.value)
      setSuccess(successMessage)
      return true
    } catch (error) {
      setFailure(messageOf(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  const connect = async () => {
    const validation = apiKeyFailure(draft)
    if (validation !== undefined) {
      setFailure(validation)
      setSuccess(undefined)
      return
    }
    const connected = await call('connect', { apiKey: draft.trim() }, 'Linear workspace connected.')
    if (connected) setDraft('')
  }

  const test = () => call('test', {}, 'Connection verified against Linear.')
  const disconnect = async () => {
    if (!window.confirm('Remove the stored Linear API key and workspace binding?')) return
    const removed = await call('disconnect', {}, 'Linear workspace disconnected.')
    if (removed) setDraft('')
  }

  const credential = status?.credential
  const configured = credential?.configured === true
  const writable = credential?.writable === true
  const source = credential?.source === undefined ? undefined : sourceLabel(credential.source)
  const badge =
    status === undefined
      ? 'Checking…'
      : status.live
        ? 'Connected'
        : configured
          ? `Configured${source === undefined ? '' : ` via ${source}`}`
          : 'Not configured'
  const statusTone = status?.live ? 'ok' : configured ? 'warn' : 'error'
  return (
    <SettingsPanel
      title="Linear"
      subtitle="Workspace connection for issue discovery and approval-gated project management."
      groupTitle="Workspace connection"
      initiallyOpen={props.view === 'page'}
      status={badge}
      statusTone={statusTone}
      error={failure}
      notice={success}
      actions={
        <>
          <button
            type="button"
            className="dsh-settings-panel__button--primary"
            disabled={busy || !writable}
            onClick={() => {
              void connect()
            }}
          >
            {busy ? 'Working…' : configured ? 'Replace and connect' : 'Connect'}
          </button>
          {configured ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void test()
              }}
            >
              Test connection
            </button>
          ) : null}
          {configured && writable ? (
            <button
              type="button"
              className="dsh-settings-panel__button--danger"
              disabled={busy}
              onClick={() => {
                void disconnect()
              }}
            >
              Disconnect
            </button>
          ) : null}
        </>
      }
    >
      {status?.workspace == null ? null : (
        <SettingsDetailList
          items={[
            ['Workspace', status.workspace.name],
            ['Workspace key', status.workspace.urlKey || '—'],
            status.viewer == null
              ? null
              : ['Authenticated as', status.viewer.email ?? status.viewer.name],
          ]}
        />
      )}
      <SettingsField
        label={configured ? 'Replace API key' : 'Linear API key'}
        hint={
          writable
            ? 'DSH validates the key against Linear, binds the returned workspace ID, and stores the key write-only in the credential store.'
            : configured
              ? 'This key comes from a read-only source. Remove it there before managing it in this page.'
              : 'Credential writes are unavailable from this browser. Open DSH on its loopback URL.'
        }
        type="password"
        value={draft}
        disabled={busy || !writable}
        autoComplete="off"
        spellCheck={false}
        placeholder={configured ? 'Enter a replacement key' : 'lin_api_…'}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !busy && writable) void connect()
        }}
      />
    </SettingsPanel>
  )
}

// RC2 row slots render summaries without mounting the credential/RPC form.
export function LinearConfigPage(props: SettingsProps) {
  return props.view === 'summary' ? (
    'Workspace connection for issue discovery and approval-gated project management.'
  ) : (
    <LinearSettingsSection {...props} />
  )
}
