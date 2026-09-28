import React from 'react'
import type { SettingsProps, CredentialInfo } from './contracts.ts'
import { CREDENTIAL_REF } from './constants.ts'
import { apiKeyFailure, messageOf, sourceLabel } from './model.ts'
import { styles } from './styles.ts'
export function GeminiSettingsSection(props: SettingsProps) {
  const { api, subscribe } = props
  const [credential, setCredential] = React.useState<CredentialInfo | null | undefined>(undefined)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | undefined>(undefined)
  const [success, setSuccess] = React.useState<string | undefined>(undefined)
  const [revision, setRevision] = React.useState(0)
  React.useEffect(() => subscribe(() => setRevision((value) => value + 1)), [subscribe])
  React.useEffect(() => {
    let active = true
    setFailure(undefined)
    Promise.resolve()
      .then(() => api.credentials.describe([CREDENTIAL_REF]))
      .then(
        (response) => {
          if (!active) return
          if (!response.ok) {
            setCredential(null)
            setFailure(response.error.message)
            return
          }
          setCredential(
            response.value[CREDENTIAL_REF] ?? {
              configured: false,
              writable: false,
            },
          )
        },
        (error) => {
          if (!active) return
          setCredential(null)
          setFailure(messageOf(error))
        },
      )
    return () => {
      active = false
    }
  }, [api, revision])
  const save = async () => {
    const validation = apiKeyFailure(draft)
    if (validation !== undefined) {
      setFailure(validation)
      setSuccess(undefined)
      return
    }
    setBusy(true)
    setFailure(undefined)
    setSuccess(undefined)
    try {
      const response = await api.credentials.set(CREDENTIAL_REF, draft.trim())
      if (!response.ok) {
        setFailure(response.error.message)
        return
      }
      setDraft('')
      setSuccess('Gemini API key saved. The next YouTube request will use it.')
      setRevision((value) => value + 1)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!window.confirm('Remove the stored Gemini API key?')) return
    setBusy(true)
    setFailure(undefined)
    setSuccess(undefined)
    try {
      const response = await api.credentials.unset(CREDENTIAL_REF)
      if (!response.ok) {
        setFailure(response.error.message)
        return
      }
      setDraft('')
      setSuccess('Stored Gemini API key removed.')
      setRevision((value) => value + 1)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }
  const configured = credential?.configured === true
  const writable = credential?.writable === true
  const source = credential?.source === undefined ? undefined : sourceLabel(credential.source)
  const status =
    credential === undefined
      ? 'Checking…'
      : credential === null
        ? 'Unavailable'
        : configured
          ? `Configured${source === undefined ? '' : ` via ${source}`}`
          : 'Not configured'
  return (
    <details style={{ ...styles.card, display: 'block' }} open={props.view === 'page' || undefined}>
      <summary style={{ cursor: 'pointer' }}>
        <span style={styles.title}>{'YouTube'}</span>
        <p style={{ ...styles.hint, marginTop: '4px' }}>
          {'Configure Gemini access used by the youtube_watch and youtube_transcript tools.'}
        </p>
      </summary>
      <div
        style={{ ...styles.section, marginTop: '16px' }}
        role={'group'}
        aria-labelledby={'gemini-card-title'}
      >
        <div style={styles.row}>
          <h3 id={'gemini-card-title'} style={styles.title}>
            {'Gemini'}
          </h3>
          <span style={styles.badge} role={'status'}>
            <span style={styles.dot(configured)} aria-hidden={'true'}></span>
            {status}
          </span>
        </div>
        <label style={styles.label}>
          {configured ? 'Replace API key' : 'API key'}
          <input
            type={'password'}
            value={draft}
            disabled={busy || !writable}
            autoComplete={'off'}
            spellCheck={false}
            placeholder={configured ? 'Enter a new key' : 'AIza…'}
            style={styles.input}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !busy && writable) void save()
            }}
          ></input>
        </label>
        <p style={styles.hint}>
          {writable
            ? 'The key is sent write-only to DSH’s credential store and is never returned to this page.'
            : configured
              ? 'This key comes from a read-only source. Remove it from that source before managing it here.'
              : 'Credential writes are unavailable from this browser. Open DSH on its loopback URL.'}
        </p>
        <div style={styles.actions}>
          <button
            type={'button'}
            disabled={busy || !writable}
            style={{ ...styles.button, opacity: busy || !writable ? 0.5 : 1 }}
            onClick={() => {
              void save()
            }}
          >
            {busy ? 'Saving…' : configured ? 'Replace key' : 'Save key'}
          </button>
          {configured && writable ? (
            <button
              type={'button'}
              disabled={busy}
              style={{ ...styles.button, ...styles.danger, opacity: busy ? 0.5 : 1 }}
              onClick={() => {
                void remove()
              }}
            >
              {'Remove key'}
            </button>
          ) : null}
        </div>
        {failure === undefined ? null : (
          <p style={styles.message(true)} role={'alert'}>
            {failure}
          </p>
        )}
        {success === undefined ? null : (
          <p style={styles.message(false)} role={'status'}>
            {success}
          </p>
        )}
      </div>
    </details>
  )
}
// RC2 row summaries never mount the credential form or start status requests.
export function YoutubeConfigPage(props: SettingsProps) {
  return props.view === 'summary' ? (
    'Configure Gemini access for YouTube analysis and transcripts.'
  ) : (
    <GeminiSettingsSection {...props}></GeminiSettingsSection>
  )
}
