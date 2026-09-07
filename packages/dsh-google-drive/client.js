window.__ModuleLoader__.load({
  id: '@local/dsh-google-drive',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const h = React.createElement
    const styles = {
      card: { display: 'block', padding: '18px', border: '1px solid color-mix(in srgb, currentColor 16%, transparent)', borderRadius: '12px', background: 'color-mix(in srgb, currentColor 3%, transparent)' },
      section: { display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px', width: 'min(720px, 100%)' },
      title: { margin: 0, fontSize: '16px', fontWeight: 650 },
      hint: { margin: 0, fontSize: '13px', opacity: 0.75, lineHeight: 1.45 },
      actions: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
      button: { border: '1px solid color-mix(in srgb, currentColor 22%, transparent)', borderRadius: '8px', background: 'color-mix(in srgb, currentColor 8%, transparent)', color: 'inherit', font: 'inherit', padding: '8px 13px', cursor: 'pointer' },
    }
    const external = { target: '_blank', rel: 'noopener noreferrer' }

    function authorizationUrl(value) {
      if (typeof value !== 'string') throw new Error('Google returned an invalid authorization link. Cancel and try connecting again.')
      let url
      try { url = new URL(value) } catch { /* Reject malformed links below. */ }
      if (!url || url.protocol !== 'https:' || url.hostname !== 'accounts.google.com'
        || url.port || url.username || url.password || url.pathname !== '/o/oauth2/v2/auth' || url.hash) {
        throw new Error('Google returned an invalid authorization link. Cancel and try connecting again.')
      }
      return url.href
    }

    async function api(method, body = {}) {
      let response
      try {
        response = await window.fetch(`/api/plugins/google-drive/${method}`, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-DSH-Google-Drive': '1' },
          body: JSON.stringify(body),
        })
      } catch {
        throw new Error('Cannot reach DSH. Check your connection and open the local DSH GUI, then retry.')
      }
      let result
      try { result = await response.json() } catch {
        throw new Error('DSH returned an unreadable response. Open the local DSH GUI and check that the Google Drive plugin is enabled.')
      }
      if (result?.ok === false && typeof result.error?.message === 'string') {
        throw new Error(result.error.message)
      }
      if (!response.ok || result?.ok !== true) {
        throw new Error('Google Drive is unavailable. Open the local DSH GUI and retry.')
      }
      return result.value
    }

    function GoogleDriveSettingsSection({ api: request, subscribe }) {
      const [draft, setDraft] = React.useState('')
      const [status, setStatus] = React.useState(undefined)
      const [link, setLink] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [failure, setFailure] = React.useState(undefined)
      const [revision, setRevision] = React.useState(0)
      const generation = React.useRef(0)

      React.useEffect(() => {
        const dispose = subscribe(() => {
          generation.current++
          setLink(undefined)
          setStatus(undefined)
          setFailure(undefined)
          setBusy(false)
          setRevision((value) => value + 1)
        })
        return () => { generation.current++; dispose?.() }
      }, [subscribe])

      React.useEffect(() => {
        if (busy) return
        let active = true
        let timer
        const current = generation.current
        const refresh = async () => {
          try {
            const value = await request('status')
            if (!active || current !== generation.current) return
            if (!value || typeof value.configured !== 'boolean' || typeof value.connected !== 'boolean' || typeof value.pending !== 'boolean') {
              throw new Error('DSH returned an invalid Google Drive status. Retry or restart the local DSH GUI.')
            }
            setStatus(value)
            // Action failures stay visible until the user retries or refreshes.
            if (!value.pending) setLink(undefined)
            if (value.pending) timer = window.setTimeout(refresh, 1000)
          } catch (error) {
            if (!active || current !== generation.current) return
            setStatus(null)
            setLink(undefined)
            setFailure(error instanceof Error ? error.message : 'Could not check Google Drive status. Retry from the local DSH GUI.')
          }
        }
        void refresh()
        return () => { active = false; window.clearTimeout(timer) }
      }, [request, revision, busy])

      const act = async (method) => {
        if (busy) return
        if (method === 'configure') {
          if (!draft.trim() || draft.length > 32768) {
            setFailure('Paste the downloaded Desktop OAuth client JSON (at most 32,768 characters).')
            return
          }
          try {
            const value = JSON.parse(draft)
            if (typeof value?.installed?.client_id !== 'string' || !value.installed.client_id
              || typeof value.installed.client_secret !== 'string' || !value.installed.client_secret) throw new Error()
          } catch {
            setFailure('Use the JSON downloaded for a Google OAuth client of type Desktop app, including client_id and client_secret.')
            return
          }
          if (status?.configured && !window.confirm('Replace the Google Drive client configuration? This clears local tokens and any pending connection.')) return
        }
        if (method === 'clear-config' && !window.confirm('Remove the Google Drive client configuration, local tokens, and any pending connection? This does not revoke Google account access.')) return
        if (method === 'cancel' && !window.confirm('Cancel the pending Google Drive connection?')) return
        if (method === 'disconnect' && !window.confirm('Remove Google Drive credentials from this DSH installation? This does not revoke access in your Google account.')) return
        const current = ++generation.current
        setBusy(true)
        setFailure(undefined)
        setLink(undefined)
        try {
          const value = await request(method, method === 'configure' ? { clientJson: draft } : {})
          if (current !== generation.current) return
          if (method === 'configure' || method === 'clear-config') setDraft('')
          if (method === 'connect') setLink(authorizationUrl(value?.authorizationUrl))
        } catch (error) {
          if (current !== generation.current) return
          // Configuration errors must not echo pasted credentials from a server response.
          setFailure(method === 'configure' || method === 'clear-config'
            ? 'Could not save or remove the client configuration. Check the Desktop OAuth JSON and retry from the local DSH GUI.'
            : error instanceof Error ? error.message : 'Google Drive request failed. Retry from the local DSH GUI.')
        } finally {
          if (current === generation.current) {
            setBusy(false)
            setRevision((value) => value + 1)
          }
        }
      }
      const label = status === undefined ? 'Checking…' : status === null ? 'Unavailable'
        : status.pending ? 'Waiting for Google authorization' : status.connected ? 'Connected' : status.configured ? 'Not connected' : 'Not configured'
      const button = (label, method, disabled = false) => h('button', {
        type: 'button', style: styles.button, disabled: busy || disabled,
        onClick: () => { void act(method) },
      }, label)
      return h('details', { style: styles.card },
        h('summary', { style: { cursor: 'pointer' } },
          h('span', { style: styles.title }, 'Google Drive'),
          h('p', { style: styles.hint }, 'Read-only file metadata access.')),
        h('div', { style: styles.section, role: 'group', 'aria-labelledby': 'google-drive-card-title' },
          h('h3', { id: 'google-drive-card-title', style: styles.title }, 'Google Drive'),
          h('p', { role: 'status', style: styles.hint }, label),
          h('p', { style: styles.hint }, 'Permission: drive.metadata.readonly. DSH can read file metadata, not file contents, and cannot edit files.'),
          h('p', { style: styles.hint },
            'In Google Cloud Console, create an OAuth client of type Desktop app. Download its JSON and paste it below. DSH stores it on this host and never returns it to this page. Keep credentials out of Git. ',
            h('a', { ...external, href: 'https://developers.google.com/identity/protocols/oauth2/native-app' }, 'Google OAuth setup documentation')),
          h('label', { style: styles.hint, htmlFor: 'google-drive-client-json' }, 'Desktop OAuth client JSON'),
          h('textarea', {
              id: 'google-drive-client-json',
              value: draft, disabled: busy, maxLength: 32768, rows: 5,
              autoComplete: 'off', spellCheck: false,
              placeholder: status?.configured ? 'Paste new JSON to replace the stored configuration' : 'Paste downloaded Desktop OAuth client JSON',
              style: { ...styles.button, width: '100%', boxSizing: 'border-box', cursor: 'text' },
              onChange: (event) => setDraft(event.target.value),
            }),
          h('div', { style: styles.actions },
            button('Save client configuration', 'configure', !status || !draft.trim()),
            status?.configured ? button('Remove client configuration', 'clear-config') : null),
          status?.pending && !link ? h('p', { style: styles.hint }, 'Complete authorization in the Google tab you already opened, or cancel and connect again to get a new link.') : null,
          link && status?.pending ? h('a', { ...external, href: link }, 'Continue with Google') : null,
          h('div', { style: styles.actions },
            status?.pending ? button('Cancel', 'cancel') : button('Connect', 'connect', !status?.configured || status?.connected),
            status?.connected ? button('Disconnect', 'disconnect') : null,
            h('button', { type: 'button', style: styles.button, disabled: busy, onClick: () => { setFailure(undefined); setRevision((value) => value + 1) } }, 'Refresh status')),
          h('p', { style: styles.hint }, 'Disconnect removes only local DSH credentials. It does not revoke Google access. ',
            h('a', { ...external, href: 'https://myaccount.google.com/connections' }, 'Manage Google account permissions')),
          (failure ?? status?.error) === undefined ? null : h('p', { role: 'alert', style: { ...styles.hint, color: '#ef4444' } }, failure ?? status.error)))
    }

    function apply(ctx) {
      const subscribe = (listener) => typeof ctx.on === 'function' ? ctx.on('connection/reset', listener) : () => {}
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item', key: 'google-drive', order: 25,
        inject: () => ({ api, subscribe }),
      }, GoogleDriveSettingsSection))
    }
    module.exports = { apply, inject: ['slots'], GoogleDriveSettingsSection, authorizationUrl }
    return module.exports
  },
})
