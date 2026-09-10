window.__ModuleLoader__.load({
  id: '@local/dsh-tool-trivy',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const STATUS_CHANNEL = '/trivy-status'
    const STATUS_GET = 'get'
    const STATUS_RECHECK = 'recheck'
    const INSTALL_URL = 'https://trivy.dev/latest/getting-started/installation/'

    const styles = {
      section: { display: 'flex', flexDirection: 'column', gap: '16px', width: 'min(720px, 100%)' },
      heading: { margin: 0, fontSize: '20px', fontWeight: 650 },
      intro: { margin: 0, opacity: 0.72, lineHeight: 1.5 },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '18px',
        border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
        borderRadius: '12px',
        background: 'color-mix(in srgb, currentColor 3%, transparent)',
      },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
      title: { margin: 0, fontSize: '16px', fontWeight: 650 },
      badge: { display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '13px', opacity: 0.84 },
      dot: (color) => ({ width: '8px', height: '8px', borderRadius: '999px', background: color }),
      details: { display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '7px 12px', fontSize: '13px' },
      key: { opacity: 0.62 },
      value: { overflowWrap: 'anywhere' },
      hint: { margin: 0, fontSize: '13px', opacity: 0.72, lineHeight: 1.5 },
      actions: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
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
      link: { color: 'inherit', fontSize: '13px', fontWeight: 600 },
      error: { margin: 0, color: '#ef4444', fontSize: '13px' },
    }

    function messageOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    function presentation(status, failure) {
      if (failure !== undefined) return { label: 'Unavailable', color: '#ef4444' }
      if (status === undefined) return { label: 'Checking…', color: '#94a3b8' }
      if (status.state === 'ready') return { label: 'Ready', color: '#22c55e' }
      if (status.state === 'not-found') return { label: 'Not found', color: '#ef4444' }
      if (status.state === 'unsupported-version') return { label: 'Unsupported version', color: '#f59e0b' }
      return { label: 'Execution failed', color: '#ef4444' }
    }

    function formatCheckedAt(value) {
      if (typeof value !== 'string') return undefined
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
    }

    function TrivySettingsSection(props) {
      const { rpc, subscribe } = props
      const [status, setStatus] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [failure, setFailure] = React.useState(undefined)
      const [revision, setRevision] = React.useState(0)

      React.useEffect(() => subscribe(() => setRevision((value) => value + 1)), [subscribe])
      React.useEffect(() => {
        let active = true
        setFailure(undefined)
        rpc.call(STATUS_CHANNEL, STATUS_GET, {}).then((response) => {
          if (!active) return
          if (!response.ok) {
            setFailure(response.error.message)
            return
          }
          setStatus(response.value)
        }, (error) => {
          if (active) setFailure(messageOf(error))
        })
        return () => { active = false }
      }, [rpc, revision])

      const recheck = async () => {
        setBusy(true)
        setFailure(undefined)
        try {
          const response = await rpc.call(STATUS_CHANNEL, STATUS_RECHECK, {})
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
      return React.createElement('section', { style: styles.section, 'aria-labelledby': 'trivy-settings-title' },
        React.createElement('h2', { id: 'trivy-settings-title', style: styles.heading }, 'Trivy'),
        React.createElement('p', { style: styles.intro },
          'Check the pre-installed Trivy CLI used by vulnerability audits. DSH never installs or updates the executable.'),
        React.createElement('div', { style: styles.card, role: 'group', 'aria-labelledby': 'trivy-card-title' },
          React.createElement('div', { style: styles.row },
            React.createElement('h3', { id: 'trivy-card-title', style: styles.title }, 'Trivy CLI'),
            React.createElement('span', { style: styles.badge, role: 'status' },
              React.createElement('span', { style: styles.dot(state.color), 'aria-hidden': true }),
              state.label)),
          status === undefined ? null : React.createElement('div', { style: styles.details },
            status.version === undefined ? null : React.createElement(React.Fragment, null,
              React.createElement('span', { style: styles.key }, 'Version'),
              React.createElement('span', { style: styles.value }, status.version)),
            status.path === undefined ? null : React.createElement(React.Fragment, null,
              React.createElement('span', { style: styles.key }, 'Executable'),
              React.createElement('span', { style: styles.value }, status.path)),
            React.createElement(React.Fragment, null,
              React.createElement('span', { style: styles.key }, 'Required'),
              React.createElement('span', { style: styles.value }, `Trivy ${status.minimumVersion}+`)),
            checkedAt === undefined ? null : React.createElement(React.Fragment, null,
              React.createElement('span', { style: styles.key }, 'Last checked'),
              React.createElement('span', { style: styles.value }, checkedAt))),
          status?.message === undefined ? null : React.createElement('p', { style: styles.hint }, status.message),
          React.createElement('p', { style: styles.hint },
            'If Trivy works in a terminal but is not found here, DSH may have a different effective PATH. The first audit may download or update Trivy’s vulnerability database.'),
          React.createElement('div', { style: styles.actions },
            React.createElement('button', {
              type: 'button',
              disabled: busy,
              style: { ...styles.button, opacity: busy ? 0.55 : 1 },
              onClick: () => { void recheck() },
            }, busy ? 'Checking…' : 'Recheck'),
            React.createElement('a', {
              href: INSTALL_URL,
              target: '_blank',
              rel: 'noreferrer',
              style: styles.link,
            }, 'Official installation instructions')),
          failure === undefined ? null : React.createElement('p', { style: styles.error, role: 'alert' }, failure)))
    }

    const inject = ['slots', 'connection']

    function apply(ctx) {
      const connection = ctx.get('connection')
      const subscribe = (listener) => ctx.on('connection/reset', listener)
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'trivy',
        order: 40,
        label: 'Trivy',
        inject: () => ({ rpc: connection.rpc, subscribe }),
      }, TrivySettingsSection))
    }

    exports.apply = apply
    exports.inject = inject
    exports.INSTALL_URL = INSTALL_URL
    exports.STATUS_CHANNEL = STATUS_CHANNEL
    exports.STATUS_GET = STATUS_GET
    exports.STATUS_RECHECK = STATUS_RECHECK
    exports.presentation = presentation
    exports.TrivySettingsSection = TrivySettingsSection
    return module.exports
  },
})
