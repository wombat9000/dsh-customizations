import React, { useEffect, useState } from 'react'
import {
  TRIVY_STATUS_CHANNEL,
  TRIVY_STATUS_GET,
  TRIVY_STATUS_RECHECK,
} from '../shared/contracts.js'
import type { PublicTrivyStatus, StatusRpc } from '../shared/contracts.js'
import {
  SettingsDetailList,
  SettingsPanel,
  type SettingsStatusTone,
} from '../../../shared/client/settings.tsx'

export const INSTALL_URL = 'https://trivy.dev/latest/getting-started/installation/'
export interface SettingsProps {
  rpc: StatusRpc
  subscribe(listener: () => void): () => void
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
export function presentation(
  status: PublicTrivyStatus | undefined,
  failure: string | undefined,
): { label: string; color: string; tone: SettingsStatusTone } {
  if (failure !== undefined) return { label: 'Unavailable', color: '#ef4444', tone: 'error' }
  if (status === undefined) return { label: 'Checking…', color: '#94a3b8', tone: 'muted' }
  if (status.state === 'ready') return { label: 'Ready', color: '#22c55e', tone: 'ok' }
  if (status.state === 'not-found') return { label: 'Not found', color: '#ef4444', tone: 'error' }
  if (status.state === 'unsupported-version')
    return { label: 'Unsupported version', color: '#f59e0b', tone: 'warn' }
  return { label: 'Execution failed', color: '#ef4444', tone: 'error' }
}
function formatCheckedAt(value: string | undefined) {
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
export function TrivySettingsSection({ rpc, subscribe }: SettingsProps) {
  const [status, setStatus] = useState<PublicTrivyStatus>()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [revision, setRevision] = useState(0)

  useEffect(() => subscribe(() => setRevision((value) => value + 1)), [subscribe])
  useEffect(() => {
    let active = true
    setFailure(undefined)
    rpc.call(TRIVY_STATUS_CHANNEL, TRIVY_STATUS_GET, {}).then(
      (response) => {
        if (!active) return
        if (!response.ok) {
          setFailure(response.error.message)
          return
        }
        setStatus(response.value)
      },
      (error: unknown) => {
        if (active) setFailure(messageOf(error))
      },
    )
    return () => {
      active = false
    }
  }, [rpc, revision])

  const recheck = async () => {
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await rpc.call(TRIVY_STATUS_CHANNEL, TRIVY_STATUS_RECHECK, {})
      if (!response.ok) {
        setFailure(response.error.message)
        return
      }
      setStatus(response.value)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }
  const state = presentation(status, failure)
  const checkedAt = formatCheckedAt(status?.checkedAt)
  return (
    <SettingsPanel
      as="section"
      title="Trivy"
      subtitle="Check the pre-installed Trivy CLI used by vulnerability audits. DSH never installs or updates the executable."
      groupTitle="Trivy CLI"
      status={state.label}
      statusTone={state.tone}
      error={failure}
      actions={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void recheck()
            }}
          >
            {busy ? 'Checking…' : 'Recheck'}
          </button>
          <a href={INSTALL_URL} target="_blank" rel="noreferrer">
            Official installation instructions
          </a>
        </>
      }
    >
      {status === undefined ? null : (
        <SettingsDetailList
          items={[
            status.version === undefined ? null : ['Version', status.version],
            status.path === undefined ? null : ['Executable', status.path],
            ['Required', `Trivy ${status.minimumVersion}+`],
            checkedAt === undefined ? null : ['Last checked', checkedAt],
          ]}
        />
      )}
      {status?.message === undefined ? null : (
        <p className="dsh-settings-panel__hint">{status.message}</p>
      )}
      <p className="dsh-settings-panel__hint">
        If Trivy works in a terminal but is not found here, DSH may have a different effective PATH.
        The first audit may download or update Trivy’s vulnerability database.
      </p>
    </SettingsPanel>
  )
}
