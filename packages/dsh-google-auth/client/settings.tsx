import React from 'react'
import type { ChangeEvent } from 'react'
import { styles, external } from './styles.js'
import type { ClientStatus } from './transport.js'
import { authorizationUrl, validStatus } from './transport.js'
import { isRecord } from '../shared/contracts.js'
import type { SettingsRequest, SettingsAction } from '../shared/contracts.js'
export interface SettingsProps {
  api: SettingsRequest
  subscribe: (listener: () => void) => (() => void) | undefined
  view?: string
}
type Action = Exclude<SettingsAction, 'status' | 'callback-mode'>
export function GoogleAuthSettingsSection(props: SettingsProps) {
  return props.view === 'summary' ? (
    <p>{'Shared Google account and integration permissions.'}</p>
  ) : (
    <GoogleAuthSettingsForm {...props} />
  )
}
function GoogleAuthSettingsForm({ api: request, subscribe, view }: SettingsProps) {
  const [draft, setDraft] = React.useState('')
  const [status, setStatus] = React.useState<ClientStatus | null | undefined>(undefined)
  const [link, setLink] = React.useState<string | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | undefined>(undefined)
  const [revision, setRevision] = React.useState(0)
  const generation = React.useRef(0)
  const acting = React.useRef(false)
  React.useEffect(() => {
    const dispose = subscribe(() => {
      generation.current++
      acting.current = false
      setDraft('')
      setLink(undefined)
      setStatus(undefined)
      setFailure(undefined)
      setBusy(false)
      setRevision((value) => value + 1)
    })
    return () => {
      generation.current++
      dispose?.()
    }
  }, [subscribe])
  React.useEffect(() => {
    if (busy) return
    let active = true,
      timer: number | undefined
    const current = generation.current
    const refresh = async () => {
      try {
        const value = await request('status')
        if (!active || current !== generation.current) return
        if (!validStatus(value))
          throw new Error(
            'DSH returned an invalid Google accounts status. Retry or restart the local DSH GUI.',
          )
        setStatus(value)
        if (!value.pending) setLink(undefined)
        if (value.pending) timer = window.setTimeout(refresh, 1000)
      } catch (error) {
        if (!active || current !== generation.current) return
        setStatus(null)
        setLink(undefined)
        setFailure(
          error instanceof Error ? error.message : 'Could not check Google accounts status.',
        )
      }
    }
    void refresh()
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [request, revision, busy])
  const act = async (method: Action) => {
    if (acting.current || (status?.pending && method !== 'cancel')) return
    if (method === 'configure') {
      if (!draft.trim() || draft.length > 32768) {
        setFailure('Paste the downloaded Desktop OAuth client JSON (at most 32,768 characters).')
        return
      }
      try {
        const raw: unknown = JSON.parse(draft)
        const value = isRecord(raw) && isRecord(raw.installed) ? raw.installed : undefined
        if (
          typeof value?.client_id !== 'string' ||
          !value.client_id ||
          typeof value.client_secret !== 'string' ||
          !value.client_secret
        )
          throw new Error()
      } catch {
        setFailure(
          'Use the JSON downloaded for a Google OAuth client of type Desktop app, including client_id and client_secret.',
        )
        return
      }
      if (
        status?.configured &&
        !window.confirm(
          'Replace the Google client configuration? ALL integrations lose local access. This clears local tokens and any pending connection.',
        )
      )
        return
    }
    if (
      method === 'clear-config' &&
      !window.confirm(
        'Remove the Google client configuration, local tokens, and any pending connection? ALL integrations lose local access. This does not revoke Google account grants.',
      )
    )
      return
    if (method === 'cancel' && !window.confirm('Cancel the pending Google connection?')) return
    if (
      method === 'disconnect' &&
      !window.confirm(
        'Disconnect this Google account? ALL integrations lose local access. This does not revoke access in your Google account.',
      )
    )
      return
    const current = ++generation.current
    acting.current = true
    setBusy(true)
    setFailure(undefined)
    setLink(undefined)
    try {
      const value =
        method === 'configure'
          ? await request('configure', { clientJson: draft })
          : await request(method, {})
      if (current !== generation.current) return
      if (method === 'configure' || method === 'clear-config') setDraft('')
      if (method === 'connect')
        setLink(authorizationUrl(isRecord(value) ? value.authorizationUrl : undefined))
    } catch (error) {
      if (current !== generation.current) return
      setFailure(
        method === 'configure' || method === 'clear-config'
          ? 'Could not save or remove the client configuration. Check the Desktop OAuth JSON and retry from the local DSH GUI.'
          : error instanceof Error
            ? error.message
            : 'Google accounts request failed. Retry from the local DSH GUI.',
      )
    } finally {
      if (current === generation.current) {
        acting.current = false
        setBusy(false)
        setRevision((value) => value + 1)
      }
    }
  }
  const setCallbackMode = async (useSandbox: boolean) => {
    if (acting.current || !status) return
    if (
      status.pending &&
      !window.confirm('Change callback mode? The pending Google connection will be canceled.')
    )
      return
    const current = ++generation.current
    acting.current = true
    setBusy(true)
    setFailure(undefined)
    let failed = false
    try {
      await request('callback-mode', { useSandbox })
      if (current !== generation.current) return
      setLink(undefined)
    } catch {
      if (current !== generation.current) return
      failed = true
      setFailure('Could not save callback mode. Check the local DSH GUI and retry.')
    } finally {
      if (current === generation.current) {
        try {
          const value = await request('status')
          if (current === generation.current) {
            if (!validStatus(value)) throw new Error()
            setStatus(value)
            if (!value.pending) setLink(undefined)
          }
        } catch {
          if (current === generation.current && !failed)
            setFailure('Could not refresh callback mode status. Refresh status before connecting.')
        } finally {
          if (current === generation.current) {
            acting.current = false
            setBusy(false)
            setRevision((value) => value + 1)
          }
        }
      }
    }
  }
  const sandboxUnavailable = status?.useSandbox === true && status?.sandboxAvailable !== true
  const label =
    status === undefined
      ? 'Checking…'
      : status === null
        ? 'Unavailable'
        : status.pending
          ? 'Waiting for Google authorization'
          : status.connected
            ? 'Connected'
            : status.configured
              ? 'Not connected'
              : 'Not configured'
  const button = (label: string, method: Action, disabled = false) => (
    <button
      type={'button'}
      style={styles.button}
      disabled={busy || disabled || (status?.pending && method !== 'cancel')}
      onClick={() => {
        void act(method)
      }}
    >
      {label}
    </button>
  )
  const account = isRecord(status?.account) ? status.account : undefined
  const message = failure ?? (typeof status?.error === 'string' ? status.error : undefined)
  const accountLabel =
    typeof account?.email === 'string' && account.email
      ? account.email
      : typeof account?.id === 'string'
        ? account.id
        : 'Google account'
  return (
    <details style={styles.card} open={view === 'page'}>
      <summary style={{ cursor: 'pointer' }}>
        <span style={styles.title}>{'Google accounts'}</span>
        <p style={styles.hint}>{'Shared account and integration permissions.'}</p>
      </summary>
      <div style={styles.section} role={'group'} aria-labelledby={'google-auth-card-title'}>
        <h3 id={'google-auth-card-title'} style={styles.title}>
          {'Google accounts'}
        </h3>
        <p role={'status'} style={styles.hint}>
          {label}
        </p>
        {status?.connected ? (
          <p style={styles.hint}>
            {'Account: '}
            {accountLabel}
          </p>
        ) : null}
        <p style={styles.hint}>
          {
            'This version supports one Google account per credential store, shared by all enabled integrations.'
          }
        </p>
        <p style={styles.hint}>
          {
            'Google sign-in also requests openid and email identity access to bind permissions to your account. Additional consent retains existing granted scopes.'
          }
        </p>
        <p style={styles.hint}>
          {
            'In Google Cloud Console, create an OAuth client of type Desktop app. Download its JSON and paste it below. DSH stores it on this host and never returns it to this page. Keep credentials out of Git. '
          }
          <a
            {...external}
            href={'https://developers.google.com/identity/protocols/oauth2/native-app'}
          >
            {'Google OAuth setup documentation'}
          </a>
        </p>
        <label style={styles.hint}>
          <input
            type={'checkbox'}
            checked={status?.useSandbox === true}
            disabled={busy || !status}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              void setCallbackMode(event.target.checked)
            }}
          />
          {'Use sandbox callback forwarding'}
        </label>
        <p style={styles.hint}>
          {
            'Off: receive the Google callback directly on the DSH host. On: forward the callback from Docker through the sandbox bridge.'
          }
        </p>
        {sandboxUnavailable ? (
          <p role={'alert'} style={{ ...styles.hint, color: '#ef4444' }}>
            {
              'Sandbox callback bridge unavailable. Restore the Docker sandbox bridge or turn off sandbox callback forwarding before connecting. DSH will not fall back to a direct host callback.'
            }
          </p>
        ) : null}
        <label style={styles.hint} htmlFor={'google-auth-client-json'}>
          {'Desktop OAuth client JSON'}
        </label>
        <textarea
          id={'google-auth-client-json'}
          value={draft}
          disabled={busy || status?.pending}
          maxLength={32768}
          rows={5}
          autoComplete={'off'}
          spellCheck={false}
          placeholder={
            status?.configured
              ? 'Paste new JSON to replace the stored configuration'
              : 'Paste downloaded Desktop OAuth client JSON'
          }
          style={{ ...styles.button, width: '100%', boxSizing: 'border-box', cursor: 'text' }}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value)}
        />
        <div style={styles.actions}>
          {button('Save client configuration', 'configure', !status || !draft.trim())}
          {status?.configured ? button('Remove client configuration', 'clear-config') : null}
        </div>
        {status?.integrations.length ? (
          <section aria-label={'Account permissions'}>
            <h4 style={styles.title}>{'Permissions for all enabled integrations'}</h4>
            <p style={styles.hint}>
              {
                'One Google login requests all required scopes below, plus identity access. Enabling an integration later may require additional consent. Existing granted scopes are retained.'
              }
            </p>
            <ul>
              {status.requiredScopes.map((scope) => (
                <li key={scope}>{scope}</li>
              ))}
            </ul>
            {status.requiredScopes.includes('https://www.googleapis.com/auth/spreadsheets') ? (
              <p style={styles.hint}>
                {
                  'Warning: Google Sheets edit permission is account-wide. Google can authorize editing all your spreadsheets, not only files selected in DSH. DSH still requires separate session read/edit grants and approval for each write.'
                }
              </p>
            ) : null}
            {status.pending || (status.connected && !status.missingScopes.length)
              ? null
              : button(
                  status.connected ? 'Grant additional permissions' : 'Connect Google account',
                  'connect',
                  !status.configured || sandboxUnavailable,
                )}
          </section>
        ) : null}
        {(status?.integrations ?? []).map((item) => (
          <section key={item.id} aria-label={item.label}>
            <h4 style={styles.title}>{item.label}</h4>
            <p style={styles.hint}>{'Required scopes:'}</p>
            <ul>
              {item.scopes.map((scope) => (
                <li key={scope}>{scope}</li>
              ))}
            </ul>
            {item.authorized ? (
              <p style={styles.hint}>{'Granted / Ready'}</p>
            ) : (
              <div>
                <p style={styles.hint}>{'Missing permissions:'}</p>
                <ul>
                  {item.missingScopes.map((scope) => (
                    <li key={scope}>{scope}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))}
        {status && !status.integrations.length ? (
          <p style={styles.hint}>
            {'Install and enable a Google integration first. No integrations are registered.'}
          </p>
        ) : null}
        {status?.pending && !link ? (
          <p style={styles.hint}>
            {
              'Complete authorization in the Google tab you already opened, or cancel and connect again to get a new link.'
            }
          </p>
        ) : null}
        {link && status?.pending ? (
          <a {...external} href={link}>
            {'Continue with Google'}
          </a>
        ) : null}
        <div style={styles.actions}>
          {status?.pending ? button('Cancel', 'cancel') : null}
          {status?.connected ? button('Disconnect', 'disconnect') : null}
          <button
            type={'button'}
            style={styles.button}
            disabled={busy || status?.pending}
            onClick={() => {
              setFailure(undefined)
              setRevision((value) => value + 1)
            }}
          >
            {'Refresh status'}
          </button>
        </div>
        <p style={styles.hint}>
          {
            'Disconnect removes only local DSH credentials for ALL integrations. It does not revoke Google access. '
          }
          <a {...external} href={'https://myaccount.google.com/connections'}>
            {'Manage Google account permissions'}
          </a>
        </p>
        {message === undefined ? null : (
          <p role={'alert'} style={{ ...styles.hint, color: '#ef4444' }}>
            {message}
          </p>
        )}
      </div>
    </details>
  )
}
