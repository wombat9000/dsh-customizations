import React from 'react'
import type { CredentialInfo } from '@deepseek-ai/dsh-api-remotes/client'
import { CREDENTIAL_REF } from '../shared/contracts.js'
import type { CredentialAPI, Subscribe } from '../shared/contracts.js'
import { apiKeyFailure, messageOf, sourceLabel } from './validation.js'
import { SettingsField, SettingsPanel } from '../../../shared/client/settings.tsx'

export interface FirecrawlSettingsProps {
  api: CredentialAPI
  subscribe: Subscribe
  view?: 'summary' | 'page' | undefined
}

export function FirecrawlSettingsSection(props: FirecrawlSettingsProps) {
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
      setSuccess('Firecrawl API key saved. The next web request will use it.')
      setRevision((value) => value + 1)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm('Remove the stored Firecrawl API key?')) return
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
      setSuccess('Stored Firecrawl API key removed.')
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
    <SettingsPanel
      title="Firecrawl"
      subtitle="Web search and page fetching via Firecrawl."
      groupTitle="Firecrawl"
      initiallyOpen={props.view === 'page'}
      status={status}
      statusTone={configured ? 'ok' : 'error'}
      error={failure}
      notice={success}
      actions={
        <>
          <button
            type="button"
            disabled={busy || !writable}
            onClick={() => {
              void save()
            }}
          >
            {busy ? 'Saving…' : configured ? 'Replace key' : 'Save key'}
          </button>
          {configured && writable ? (
            <button
              type="button"
              className="dsh-settings-panel__button--danger"
              disabled={busy}
              onClick={() => {
                void remove()
              }}
            >
              Remove key
            </button>
          ) : null}
        </>
      }
    >
      <SettingsField
        label={configured ? 'Replace API key' : 'API key'}
        hint={
          credential === undefined
            ? 'Checking credential access…'
            : credential === null
              ? 'Could not check credential access. See the error below.'
              : writable
                ? 'The key is sent write-only to DSH’s credential store and is never returned to this page.'
                : configured
                  ? 'This key comes from a read-only source. Remove it from that source before managing it here.'
                  : 'Credential writes are unavailable from this browser. Open DSH on its loopback URL.'
        }
        type="password"
        value={draft}
        disabled={busy || !writable}
        autoComplete="off"
        spellCheck={false}
        placeholder={configured ? 'Enter a new key' : 'fc-…'}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !busy && writable) void save()
        }}
      />
    </SettingsPanel>
  )
}
