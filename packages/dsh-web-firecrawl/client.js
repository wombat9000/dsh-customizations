window.__ModuleLoader__.load({
  id: '@local/dsh-web-firecrawl',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const CREDENTIAL_REF = 'FIRECRAWL_API_KEY'

    const styles = {
      section: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        width: 'min(720px, 100%)',
      },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '18px',
        border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
        borderRadius: '12px',
        background: 'color-mix(in srgb, currentColor 3%, transparent)',
      },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
      title: { margin: 0, fontSize: '16px', fontWeight: 650 },
      badge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '7px',
        fontSize: '13px',
        opacity: 0.82,
      },
      dot: (configured) => ({
        width: '8px',
        height: '8px',
        borderRadius: '999px',
        background: configured ? '#22c55e' : '#ef4444',
      }),
      label: { display: 'flex', flexDirection: 'column', gap: '7px', fontSize: '13px', fontWeight: 600 },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
        borderRadius: '8px',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        padding: '10px 12px',
      },
      hint: { margin: 0, fontSize: '13px', opacity: 0.68, lineHeight: 1.45 },
      actions: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
      button: {
        border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
        borderRadius: '8px',
        background: 'color-mix(in srgb, currentColor 8%, transparent)',
        color: 'inherit',
        font: 'inherit',
        fontWeight: 600,
        padding: '8px 13px',
        cursor: 'pointer',
      },
      danger: { color: '#ef4444' },
      message: (error) => ({
        margin: 0,
        fontSize: '13px',
        color: error ? '#ef4444' : '#22c55e',
      }),
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
      }
      return labels[source] ?? source
    }

    function apiKeyFailure(value) {
      if (value.length === 0 || value.trim().length === 0) return 'Enter a Firecrawl API key.'
      const trimmed = value.trim()
      if (!/^[\x21-\x7e]+$/u.test(trimmed)) return 'Use an unquoted API key containing printable characters only.'
      if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(trimmed)
        || ((trimmed.startsWith('"') && trimmed.endsWith('"'))
          || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
        return 'Paste only the API key, without FIRECRAWL_API_KEY= or surrounding quotes.'
      }
    }

    function FirecrawlSettingsSection(props) {
      const { api, subscribe } = props
      const [credential, setCredential] = React.useState(undefined)
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [failure, setFailure] = React.useState(undefined)
      const [success, setSuccess] = React.useState(undefined)
      const [revision, setRevision] = React.useState(0)

      React.useEffect(() => subscribe(() => setRevision((value) => value + 1)), [subscribe])

      React.useEffect(() => {
        let active = true
        setFailure(undefined)
        Promise.resolve().then(() => api.credentials.describe([CREDENTIAL_REF])).then((response) => {
          if (!active) return
          if (!response.ok) {
            setCredential(null)
            setFailure(response.error.message)
            return
          }
          setCredential(response.value[CREDENTIAL_REF] ?? {
            configured: false,
            writable: false,
          })
        }, (error) => {
          if (!active) return
          setCredential(null)
          setFailure(messageOf(error))
        })
        return () => { active = false }
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
      const status = credential === undefined
        ? 'Checking…'
        : credential === null
          ? 'Unavailable'
          : configured
            ? `Configured${source === undefined ? '' : ` via ${source}`}`
            : 'Not configured'

      return React.createElement('details', { style: { ...styles.card, display: 'block' } },
        React.createElement('summary', { style: { cursor: 'pointer' } },
          React.createElement('span', { style: styles.title }, 'Firecrawl'),
          React.createElement('p', { style: { ...styles.hint, marginTop: '4px' } },
            'Web search and page fetching via Firecrawl.')),
        React.createElement('div', {
          style: { ...styles.section, marginTop: '16px' },
          role: 'group', 'aria-labelledby': 'firecrawl-card-title',
        },
          React.createElement('div', { style: styles.row },
            React.createElement('h3', { id: 'firecrawl-card-title', style: styles.title }, 'Firecrawl'),
            React.createElement('span', { style: styles.badge, role: 'status' },
              React.createElement('span', { style: styles.dot(configured), 'aria-hidden': 'true' }),
              status)),
          React.createElement('label', { style: styles.label },
            configured ? 'Replace API key' : 'API key',
            React.createElement('input', {
              type: 'password',
              value: draft,
              disabled: busy || !writable,
              autoComplete: 'off',
              spellCheck: false,
              placeholder: configured ? 'Enter a new key' : 'fc-…',
              style: styles.input,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !busy && writable) void save()
              },
            })),
          React.createElement('p', { style: styles.hint },
            credential === undefined
              ? 'Checking credential access…'
              : credential === null
                ? 'Could not check credential access. See the error below.'
                : writable
                  ? 'The key is sent write-only to DSH’s credential store and is never returned to this page.'
                  : configured
                    ? 'This key comes from a read-only source. Remove it from that source before managing it here.'
                    : 'Credential writes are unavailable from this browser. Open DSH on its loopback URL.'),
          React.createElement('div', { style: styles.actions },
            React.createElement('button', {
              type: 'button',
              disabled: busy || !writable,
              style: { ...styles.button, opacity: busy || !writable ? 0.5 : 1 },
              onClick: () => { void save() },
            }, busy ? 'Saving…' : configured ? 'Replace key' : 'Save key'),
            configured && writable
              ? React.createElement('button', {
                  type: 'button',
                  disabled: busy,
                  style: { ...styles.button, ...styles.danger, opacity: busy ? 0.5 : 1 },
                  onClick: () => { void remove() },
                }, 'Remove key')
              : null),
          failure === undefined ? null
            : React.createElement('p', { style: styles.message(true), role: 'alert' }, failure),
          success === undefined ? null
            : React.createElement('p', { style: styles.message(false), role: 'status' }, success)))
    }

    const inject = ['slots', 'remote', 'remote.credentials']

    function apply(ctx) {
      const subscribe = (listener) => {
        const disposers = [
          ctx.remote.$on('credentials/reference-updated', (ref) => {
            if (ref === CREDENTIAL_REF) listener()
          }),
          ctx.on('connection/reset', listener),
        ]
        return () => {
          for (const dispose of disposers) dispose()
        }
      }
      const injected = () => ({ api: ctx.remote, subscribe })
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: 'web-firecrawl',
        order: 20,
        inject: injected,
      }, FirecrawlSettingsSection))
    }

    exports.apply = apply
    exports.inject = inject
    exports.apiKeyFailure = apiKeyFailure
    exports.FirecrawlSettingsSection = FirecrawlSettingsSection
    return module.exports
  },
})
