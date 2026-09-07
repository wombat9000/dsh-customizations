window.__ModuleLoader__.load({
  id: '@local/dsh-google-auth',
  factory: (require) => {
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
      let url
      try { if (typeof value === 'string') url = new URL(value) } catch { /* Reject malformed links. */ }
      if (!url || url.protocol !== 'https:' || url.hostname !== 'accounts.google.com' || url.port || url.username || url.password || url.pathname !== '/o/oauth2/v2/auth' || url.hash) {
        throw new Error('Google returned an invalid authorization link. Cancel and try connecting again.')
      }
      return url.href
    }
    async function api(method, body = {}) {
      let response
      try {
        response = await window.fetch(`/api/plugins/google-auth/${method}`, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-DSH-Google-Auth': '1' }, body: JSON.stringify(body),
        })
      } catch { throw new Error('Cannot reach DSH. Check your connection and open the local DSH GUI, then retry.') }
      let result
      try { result = await response.json() } catch { throw new Error('DSH returned an unreadable response. Check that the Google auth plugin is enabled.') }
      if (result?.ok === false && typeof result.error?.message === 'string') throw new Error(result.error.message)
      if (!response.ok || result?.ok !== true) throw new Error('Google accounts are unavailable. Open the local DSH GUI and retry.')
      return result.value
    }
    function validStatus(value) {
      return value && ['configured', 'connected', 'pending'].every((key) => typeof value[key] === 'boolean')
        && ['useSandbox', 'sandboxAvailable'].every((key) => value[key] === undefined || typeof value[key] === 'boolean')
        && Array.isArray(value.integrations) && value.integrations.every((item) => item && typeof item.id === 'string' && typeof item.label === 'string'
          && typeof item.authorized === 'boolean' && ['scopes', 'missingScopes'].every((key) => Array.isArray(item[key]) && item[key].every((scope) => typeof scope === 'string')))
    }
    function GoogleAuthSettingsSection({ api: request, subscribe }) {
      const [draft, setDraft] = React.useState('')
      const [status, setStatus] = React.useState(undefined)
      const [link, setLink] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [failure, setFailure] = React.useState(undefined)
      const [revision, setRevision] = React.useState(0)
      const generation = React.useRef(0)
      const acting = React.useRef(false)
      React.useEffect(() => {
        const dispose = subscribe(() => {
          generation.current++; acting.current = false
          setDraft(''); setLink(undefined); setStatus(undefined); setFailure(undefined); setBusy(false); setRevision((value) => value + 1)
        })
        return () => { generation.current++; dispose?.() }
      }, [subscribe])
      React.useEffect(() => {
        if (busy) return
        let active = true, timer
        const current = generation.current
        const refresh = async () => {
          try {
            const value = await request('status')
            if (!active || current !== generation.current) return
            if (!validStatus(value)) throw new Error('DSH returned an invalid Google accounts status. Retry or restart the local DSH GUI.')
            setStatus(value)
            if (!value.pending) setLink(undefined)
            if (value.pending) timer = window.setTimeout(refresh, 1000)
          } catch (error) {
            if (!active || current !== generation.current) return
            setStatus(null); setLink(undefined)
            setFailure(error instanceof Error ? error.message : 'Could not check Google accounts status.')
          }
        }
        void refresh()
        return () => { active = false; window.clearTimeout(timer) }
      }, [request, revision, busy])
      const act = async (method, integrationId) => {
        if (acting.current || (status?.pending && method !== 'cancel')) return
        if (method === 'configure') {
          if (!draft.trim() || draft.length > 32768) { setFailure('Paste the downloaded Desktop OAuth client JSON (at most 32,768 characters).'); return }
          try {
            const value = JSON.parse(draft)
            if (typeof value?.installed?.client_id !== 'string' || !value.installed.client_id || typeof value.installed.client_secret !== 'string' || !value.installed.client_secret) throw new Error()
          } catch { setFailure('Use the JSON downloaded for a Google OAuth client of type Desktop app, including client_id and client_secret.'); return }
          if (status?.configured && !window.confirm('Replace the Google client configuration? ALL integrations lose local access. This clears local tokens and any pending connection.')) return
        }
        if (method === 'clear-config' && !window.confirm('Remove the Google client configuration, local tokens, and any pending connection? ALL integrations lose local access. This does not revoke Google account grants.')) return
        if (method === 'cancel' && !window.confirm('Cancel the pending Google connection?')) return
        if (method === 'disconnect' && !window.confirm('Disconnect this Google account? ALL integrations lose local access. This does not revoke access in your Google account.')) return
        const current = ++generation.current
        acting.current = true; setBusy(true); setFailure(undefined); setLink(undefined)
        try {
          const value = await request(method, method === 'configure' ? { clientJson: draft } : method === 'connect' ? { integrationId } : {})
          if (current !== generation.current) return
          if (method === 'configure' || method === 'clear-config') setDraft('')
          if (method === 'connect') setLink(authorizationUrl(value?.authorizationUrl))
        } catch (error) {
          if (current !== generation.current) return
          setFailure(method === 'configure' || method === 'clear-config'
            ? 'Could not save or remove the client configuration. Check the Desktop OAuth JSON and retry from the local DSH GUI.'
            : error instanceof Error ? error.message : 'Google accounts request failed. Retry from the local DSH GUI.')
        } finally {
          if (current === generation.current) { acting.current = false; setBusy(false); setRevision((value) => value + 1) }
        }
      }
      const setCallbackMode = async (useSandbox) => {
        if (acting.current || !status) return
        if (status.pending && !window.confirm('Change callback mode? The pending Google connection will be canceled.')) return
        const current = ++generation.current
        acting.current = true; setBusy(true); setFailure(undefined)
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
              if (current === generation.current && !failed) setFailure('Could not refresh callback mode status. Refresh status before connecting.')
            } finally {
              if (current === generation.current) { acting.current = false; setBusy(false); setRevision((value) => value + 1) }
            }
          }
        }
      }
      const sandboxUnavailable = status?.useSandbox === true && status?.sandboxAvailable !== true
      const label = status === undefined ? 'Checking…' : status === null ? 'Unavailable' : status.pending ? 'Waiting for Google authorization' : status.connected ? 'Connected' : status.configured ? 'Not connected' : 'Not configured'
      const button = (label, method, disabled = false, integrationId) => h('button', {
        type: 'button', style: styles.button, disabled: busy || disabled || (status?.pending && method !== 'cancel'), onClick: () => { void act(method, integrationId) },
      }, label)
      const account = status?.account
      const accountLabel = typeof account?.email === 'string' && account.email ? account.email : typeof account?.id === 'string' ? account.id : 'Google account'
      const pendingLabel = status?.integrations.find((item) => item.id === status.pendingIntegrationId)?.label ?? status?.pendingIntegrationId
      return h('details', { style: styles.card },
        h('summary', { style: { cursor: 'pointer' } }, h('span', { style: styles.title }, 'Google accounts'), h('p', { style: styles.hint }, 'Shared account and integration permissions.')),
        h('div', { style: styles.section, role: 'group', 'aria-labelledby': 'google-auth-card-title' },
          h('h3', { id: 'google-auth-card-title', style: styles.title }, 'Google accounts'),
          h('p', { role: 'status', style: styles.hint }, label),
          status?.connected ? h('p', { style: styles.hint }, 'Account: ', accountLabel) : null,
          h('p', { style: styles.hint }, 'This version supports one Google account per credential store, shared by all enabled integrations.'),
          h('p', { style: styles.hint }, 'Google sign-in also requests openid and email identity access to bind permissions to your account. Additional consent retains existing granted scopes.'),
          h('p', { style: styles.hint }, 'In Google Cloud Console, create an OAuth client of type Desktop app. Download its JSON and paste it below. DSH stores it on this host and never returns it to this page. Keep credentials out of Git. ', h('a', { ...external, href: 'https://developers.google.com/identity/protocols/oauth2/native-app' }, 'Google OAuth setup documentation')),
          h('label', { style: styles.hint }, h('input', { type: 'checkbox', checked: status?.useSandbox === true, disabled: busy || !status,
            onChange: (event) => { void setCallbackMode(event.target.checked) } }), 'Use sandbox callback forwarding'),
          h('p', { style: styles.hint }, 'Off: receive the Google callback directly on the DSH host. On: forward the callback from Docker through the sandbox bridge.'),
          sandboxUnavailable ? h('p', { role: 'alert', style: { ...styles.hint, color: '#ef4444' } }, 'Sandbox callback bridge unavailable. Restore the Docker sandbox bridge or turn off sandbox callback forwarding before connecting. DSH will not fall back to a direct host callback.') : null,
          h('label', { style: styles.hint, htmlFor: 'google-auth-client-json' }, 'Desktop OAuth client JSON'),
          h('textarea', { id: 'google-auth-client-json', value: draft, disabled: busy || status?.pending, maxLength: 32768, rows: 5, autoComplete: 'off', spellCheck: false,
            placeholder: status?.configured ? 'Paste new JSON to replace the stored configuration' : 'Paste downloaded Desktop OAuth client JSON',
            style: { ...styles.button, width: '100%', boxSizing: 'border-box', cursor: 'text' }, onChange: (event) => setDraft(event.target.value) }),
          h('div', { style: styles.actions }, button('Save client configuration', 'configure', !status || !draft.trim()), status?.configured ? button('Remove client configuration', 'clear-config') : null),
          ...(status?.integrations ?? []).map((item) => h('section', { key: item.id, 'aria-label': item.label },
            h('h4', { style: styles.title }, item.label),
            h('p', { style: styles.hint }, 'Required scopes:'), h('ul', null, ...item.scopes.map((scope) => h('li', { key: scope }, scope))),
            item.authorized ? h('p', { style: styles.hint }, 'Granted / Ready') : h('div', null,
              h('p', { style: styles.hint }, 'Missing permissions:'), h('ul', null, ...item.missingScopes.map((scope) => h('li', { key: scope }, scope))),
              status.pending ? null : button(status.connected ? `Grant additional permissions for ${item.label}` : `Connect ${item.label}`, 'connect', !status.configured || sandboxUnavailable, item.id)))),
          status && !status.integrations.length ? h('p', { style: styles.hint }, 'Install and enable a Google integration first. No integrations are registered.') : null,
          status?.pending ? h('p', { style: styles.hint }, 'Pending integration: ', typeof pendingLabel === 'string' ? pendingLabel : 'Google integration') : null,
          status?.pending && !link ? h('p', { style: styles.hint }, 'Complete authorization in the Google tab you already opened, or cancel and connect again to get a new link.') : null,
          link && status?.pending ? h('a', { ...external, href: link }, 'Continue with Google') : null,
          h('div', { style: styles.actions }, status?.pending ? button('Cancel', 'cancel') : null, status?.connected ? button('Disconnect', 'disconnect') : null,
            h('button', { type: 'button', style: styles.button, disabled: busy || status?.pending, onClick: () => { setFailure(undefined); setRevision((value) => value + 1) } }, 'Refresh status')),
          h('p', { style: styles.hint }, 'Disconnect removes only local DSH credentials for ALL integrations. It does not revoke Google access. ', h('a', { ...external, href: 'https://myaccount.google.com/connections' }, 'Manage Google account permissions')),
          (failure ?? status?.error) === undefined ? null : h('p', { role: 'alert', style: { ...styles.hint, color: '#ef4444' } }, failure ?? status.error)))
    }
    function apply(ctx) {
      const subscribe = (listener) => typeof ctx.on === 'function' ? ctx.on('connection/reset', listener) : () => {}
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({ name: 'settings.plugin.item', key: 'google-auth', order: 25, inject: () => ({ api, subscribe }) }, GoogleAuthSettingsSection))
    }
    return { apply, inject: ['slots'], GoogleAuthSettingsSection, authorizationUrl }
  },
})
