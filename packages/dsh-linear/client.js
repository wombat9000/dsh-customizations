window.__ModuleLoader__.load({
  id: '@local/dsh-linear',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const CREDENTIAL_REF = 'LINEAR_API_KEY'
    const SETTINGS_NAMESPACE = 'linear'
    const CHANNEL = '/linear-integration'

    const styles = {
      section: { display: 'flex', flexDirection: 'column', gap: '16px', width: 'min(760px, 100%)' },
      card: {
        display: 'flex', flexDirection: 'column', gap: '16px', padding: '18px',
        border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
        borderRadius: '12px', background: 'color-mix(in srgb, currentColor 3%, transparent)',
      },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' },
      title: { margin: 0, fontSize: '16px', fontWeight: 650 },
      badge: { display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '13px', opacity: 0.82 },
      dot: (configured, live) => ({
        width: '8px', height: '8px', borderRadius: '999px',
        background: live ? '#22c55e' : configured ? '#f59e0b' : '#ef4444',
      }),
      label: { display: 'flex', flexDirection: 'column', gap: '7px', fontSize: '13px', fontWeight: 600 },
      input: {
        width: '100%', boxSizing: 'border-box',
        border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
        borderRadius: '8px', background: 'transparent', color: 'inherit', font: 'inherit', padding: '10px 12px',
      },
      hint: { margin: 0, fontSize: '13px', opacity: 0.68, lineHeight: 1.45 },
      details: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', fontSize: '13px' },
      term: { opacity: 0.62 },
      actions: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
      button: {
        border: '1px solid color-mix(in srgb, currentColor 22%, transparent)', borderRadius: '8px',
        background: 'color-mix(in srgb, currentColor 8%, transparent)', color: 'inherit', font: 'inherit',
        fontWeight: 600, padding: '8px 13px', cursor: 'pointer',
      },
      primary: { background: '#5e6ad2', borderColor: '#5e6ad2', color: '#fff' },
      danger: { color: '#ef4444' },
      message: (error) => ({ margin: 0, fontSize: '13px', color: error ? '#ef4444' : '#22c55e' }),
    }

    function messageOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    function sourceLabel(source) {
      const labels = {
        env: 'launch environment',
        file: 'DSH credential store',
        'project-env': 'project .env',
        'user-env': 'user .env',
        composition: 'profile composition',
      }
      return labels[source] ?? source
    }

    function apiKeyFailure(value) {
      if (value.length === 0 || value.trim().length === 0) return 'Enter a Linear API key.'
      const trimmed = value.trim()
      if (!/^[\x21-\x7e]+$/u.test(trimmed)) return 'Use an unquoted API key containing printable characters only.'
      if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(trimmed)
        || ((trimmed.startsWith('"') && trimmed.endsWith('"'))
          || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
        return 'Paste only the API key, without LINEAR_API_KEY= or surrounding quotes.'
      }
    }

    function LinearSettingsSection(props) {
      const { rpc, subscribe } = props
      const [status, setStatus] = React.useState(undefined)
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [failure, setFailure] = React.useState(undefined)
      const [success, setSuccess] = React.useState(undefined)
      const [revision, setRevision] = React.useState(0)

      React.useEffect(() => subscribe(() => setRevision((value) => value + 1)), [subscribe])

      React.useEffect(() => {
        let active = true
        rpc.call(CHANNEL, 'status', {}).then((result) => {
          if (!active) return
          if (!result.ok) {
            setFailure(result.error.message)
            return
          }
          setStatus(result.value)
        }, (error) => {
          if (active) setFailure(messageOf(error))
        })
        return () => { active = false }
      }, [rpc, revision])

      const call = async (endpoint, payload, successMessage) => {
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
      const badge = status === undefined
        ? 'Checking…'
        : status.live
          ? 'Connected'
          : configured
            ? `Configured${source === undefined ? '' : ` via ${source}`}`
            : 'Not configured'
      return React.createElement('details', { style: { ...styles.card, display: 'block' } },
        React.createElement('summary', { style: { cursor: 'pointer' } },
          React.createElement('span', { style: styles.title }, 'Linear'),
          React.createElement('p', { style: { ...styles.hint, marginTop: '4px' } },
            'Workspace connection for issue discovery and approval-gated project management.')),
        React.createElement('div', {
          style: { ...styles.section, marginTop: '16px' },
          role: 'group', 'aria-labelledby': 'linear-connection-title',
        },
          React.createElement('div', { style: styles.row },
            React.createElement('h3', { id: 'linear-connection-title', style: styles.title }, 'Workspace connection'),
            React.createElement('span', { style: styles.badge, role: 'status' },
              React.createElement('span', { style: styles.dot(configured, status?.live === true), 'aria-hidden': 'true' }),
              badge)),
          status?.workspace == null ? null
            : React.createElement('div', { style: styles.details },
                React.createElement('span', { style: styles.term }, 'Workspace'),
                React.createElement('span', null, status.workspace.name),
                React.createElement('span', { style: styles.term }, 'Workspace key'),
                React.createElement('span', null, status.workspace.urlKey || '—'),
                status.viewer == null ? null : React.createElement(React.Fragment, null,
                  React.createElement('span', { style: styles.term }, 'Authenticated as'),
                  React.createElement('span', null, status.viewer.email ?? status.viewer.name))),
          React.createElement('label', { style: styles.label },
            configured ? 'Replace API key' : 'Linear API key',
            React.createElement('input', {
              type: 'password', value: draft, disabled: busy || !writable,
              autoComplete: 'off', spellCheck: false,
              placeholder: configured ? 'Enter a replacement key' : 'lin_api_…',
              style: styles.input,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !busy && writable) void connect()
              },
            })),
          React.createElement('p', { style: styles.hint },
            writable
              ? 'DSH validates the key against Linear, binds the returned workspace ID, and stores the key write-only in the credential store.'
              : configured
                ? 'This key comes from a read-only source. Remove it there before managing it in this page.'
                : 'Credential writes are unavailable from this browser. Open DSH on its loopback URL.'),
          React.createElement('div', { style: styles.actions },
            React.createElement('button', {
              type: 'button', disabled: busy || !writable,
              style: { ...styles.button, ...styles.primary, opacity: busy || !writable ? 0.5 : 1 },
              onClick: () => { void connect() },
            }, busy ? 'Working…' : configured ? 'Replace and connect' : 'Connect'),
            configured ? React.createElement('button', {
              type: 'button', disabled: busy, style: { ...styles.button, opacity: busy ? 0.5 : 1 },
              onClick: () => { void test() },
            }, 'Test connection') : null,
            configured && writable ? React.createElement('button', {
              type: 'button', disabled: busy,
              style: { ...styles.button, ...styles.danger, opacity: busy ? 0.5 : 1 },
              onClick: () => { void disconnect() },
            }, 'Disconnect') : null),
          failure === undefined ? null : React.createElement('p', { style: styles.message(true), role: 'alert' }, failure),
          success === undefined ? null : React.createElement('p', { style: styles.message(false), role: 'status' }, success)))
    }

    const inject = ['slots', 'connection', 'remote']

    function apply(ctx) {
      const connection = ctx.get('connection')
      const subscribe = (listener) => {
        const disposers = [
          ctx.remote.$on('credentials/reference-updated', (ref) => {
            if (ref === CREDENTIAL_REF) listener()
          }),
          ctx.remote.$on('settings/document-updated', (ns) => {
            if (ns === SETTINGS_NAMESPACE) listener()
          }),
          ctx.on('connection/reset', listener),
        ]
        return () => { for (const dispose of disposers) dispose() }
      }
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item', key: SETTINGS_NAMESPACE, order: 35,
        inject: () => ({ rpc: connection.rpc, subscribe }),
      }, LinearSettingsSection))
    }

    exports.CREDENTIAL_REF = CREDENTIAL_REF
    exports.SETTINGS_NAMESPACE = SETTINGS_NAMESPACE
    exports.CHANNEL = CHANNEL
    exports.apiKeyFailure = apiKeyFailure
    exports.LinearSettingsSection = LinearSettingsSection
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
