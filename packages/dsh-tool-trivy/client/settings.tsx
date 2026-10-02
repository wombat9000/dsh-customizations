import React, { useEffect, useState } from 'react'
import {
  TRIVY_STATUS_CHANNEL,
  TRIVY_STATUS_GET,
  TRIVY_STATUS_RECHECK,
} from '../shared/contracts.js'
import type { PublicTrivyStatus, StatusRpc } from '../shared/contracts.js'
import { styles } from './styles.js'

export const INSTALL_URL = 'https://trivy.dev/latest/getting-started/installation/'
export interface SettingsProps {
  rpc: StatusRpc
  subscribe(listener: () => void): () => void
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
export function presentation(status: PublicTrivyStatus | undefined, failure: string | undefined) {
  if (failure !== undefined) return { label: 'Unavailable', color: '#ef4444' }
  if (status === undefined) return { label: 'Checking…', color: '#94a3b8' }
  if (status.state === 'ready') return { label: 'Ready', color: '#22c55e' }
  if (status.state === 'not-found') return { label: 'Not found', color: '#ef4444' }
  if (status.state === 'unsupported-version')
    return { label: 'Unsupported version', color: '#f59e0b' }
  return { label: 'Execution failed', color: '#ef4444' }
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
    <section style={styles.section} aria-labelledby="trivy-settings-title">
      <h2 id="trivy-settings-title" style={styles.heading}>
        Trivy
      </h2>
      <p style={styles.intro}>
        Check the pre-installed Trivy CLI used by vulnerability audits. DSH never installs or
        updates the executable.
      </p>
      <div style={styles.card} role="group" aria-labelledby="trivy-card-title">
        <div style={styles.row}>
          <h3 id="trivy-card-title" style={styles.title}>
            Trivy CLI
          </h3>
          <span style={styles.badge} role="status">
            <span style={styles.dot(state.color)} aria-hidden={true} />
            {state.label}
          </span>
        </div>
        {status === undefined ? null : (
          <div style={styles.details}>
            {status.version === undefined ? null : (
              <>
                <span style={styles.key}>Version</span>
                <span style={styles.value}>{status.version}</span>
              </>
            )}
            {status.path === undefined ? null : (
              <>
                <span style={styles.key}>Executable</span>
                <span style={styles.value}>{status.path}</span>
              </>
            )}
            <>
              <span style={styles.key}>Required</span>
              <span style={styles.value}>{`Trivy ${status.minimumVersion}+`}</span>
            </>
            {checkedAt === undefined ? null : (
              <>
                <span style={styles.key}>Last checked</span>
                <span style={styles.value}>{checkedAt}</span>
              </>
            )}
          </div>
        )}
        {status?.message === undefined ? null : <p style={styles.hint}>{status.message}</p>}
        <p style={styles.hint}>
          If Trivy works in a terminal but is not found here, DSH may have a different effective
          PATH. The first audit may download or update Trivy’s vulnerability database.
        </p>
        <div style={styles.actions}>
          <button
            type="button"
            disabled={busy}
            style={{ ...styles.button, opacity: busy ? 0.55 : 1 }}
            onClick={() => {
              void recheck()
            }}
          >
            {busy ? 'Checking…' : 'Recheck'}
          </button>
          <a href={INSTALL_URL} target="_blank" rel="noreferrer" style={styles.link}>
            Official installation instructions
          </a>
        </div>
        {failure === undefined ? null : (
          <p style={styles.error} role="alert">
            {failure}
          </p>
        )}
      </div>
    </section>
  )
}
