window.__ModuleLoader__.load({
  id: '@local/dsh-jev',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const css = `
      .dsh-jev { border: .5px solid var(--dsw-alias-border-l4); border-radius: 16px; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); }
      .dsh-jev summary { cursor: pointer; padding: 14px 16px; font-size: 15px; font-weight: 600; }
      .dsh-jev[open] { background: var(--dsw-alias-bg-layer-2); }
      .dsh-jev__body { display: grid; gap: 12px; margin: 0 16px; padding: 12px 0 16px; border-top: .5px solid var(--dsw-alias-border-l2); font-size: 13px; line-height: 1.5; }
      .dsh-jev p { margin: 0; }
      .dsh-jev label { display: grid; gap: 6px; }
      .dsh-jev input { box-sizing: border-box; width: 100%; min-width: 0; height: 34px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; font: inherit; color: inherit; background: var(--dsw-alias-bg-layer-3); }
      .dsh-jev button { justify-self: end; font: inherit; color: inherit; background: transparent; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; padding: 5px 12px; cursor: pointer; }
      .dsh-jev button:disabled { opacity: .5; cursor: default; }
      .dsh-jev button:focus-visible, .dsh-jev input:focus-visible, .dsh-jev summary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .dsh-jev__hint { color: var(--dsw-alias-label-secondary); }
      .dsh-jev [role=alert] { color: var(--dsw-alias-label-error); }
    `
    async function call(rpc, method, payload = {}) {
      let result
      try {
        result = await rpc.call('/jev-integration', method, payload)
      } catch {
        throw new Error('Jev settings request failed.')
      }
      if (!result?.ok) throw new Error(result?.error?.message || 'Jev settings are unavailable.')
      return result.value
    }
    function SettingsCard({ rpc }) {
      const [status, setStatus] = React.useState(null)
      const [model, setModel] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const alive = React.useRef(false)
      const load = async (resetModel = false) => {
        try {
          const value = await call(rpc, 'status')
          if (alive.current) {
            setStatus(value)
            if (resetModel) setModel(value.model)
          }
        } catch {
          if (alive.current) setError('Could not read Jev settings.')
        }
      }
      React.useEffect(() => {
        alive.current = true
        const style = document.createElement('style')
        style.textContent = css
        style.dataset.pluginCss = 'jev/settings'
        document.head.appendChild(style)
        void load(true)
        return () => {
          alive.current = false
          style.remove()
        }
      }, [rpc])
      const save = async () => {
        if (busy) return
        setBusy(true)
        setError('')
        setNotice('')
        try {
          const value = await call(rpc, 'configure', { model: model.trim() })
          if (alive.current) {
            setStatus(value)
            setModel(value.model)
            setNotice('Jev model saved. No evaluation was sent.')
          }
        } catch (failure) {
          if (alive.current) setError(failure.message)
        } finally {
          if (alive.current) setBusy(false)
        }
      }
      return h(
        'details',
        { className: 'dsh-jev', 'aria-label': 'Jev settings' },
        h('summary', null, 'Jev'),
        h(
          'div',
          { className: 'dsh-jev__body' },
          h(
            'p',
            { role: 'status' },
            status
              ? `Shared OpenRouter key: ${status.credential?.configured ? 'Configured' : 'Not configured'}`
              : 'Checking shared OpenRouter key…',
          ),
          h(
            'p',
            { className: 'dsh-jev__hint' },
            'Manage the shared key in the OpenRouter plugin card. Jev evaluates typed questions; it is not a chat model. Consumers choose when to send data through OpenRouter to TypeSafe.',
          ),
          h(
            'label',
            null,
            'Jev model ID',
            h('input', {
              value: model,
              disabled: busy || !status,
              onChange: (event) => setModel(event.target.value),
              spellCheck: false,
            }),
          ),
          h(
            'p',
            { className: 'dsh-jev__hint' },
            'Default: typesafe/jev-1.13. Use ~typesafe/jev-latest only if you want the release to change automatically.',
          ),
          h(
            'button',
            {
              type: 'button',
              disabled: busy || !status || !model.trim(),
              onClick: () => {
                void save()
              },
            },
            'Save Jev model',
          ),
          h(
            'button',
            {
              type: 'button',
              disabled: busy,
              onClick: () => {
                void load()
              },
            },
            'Refresh credential status',
          ),
          error || status?.credential?.error
            ? h('p', { role: 'alert' }, error || status.credential.error)
            : null,
          notice ? h('p', { role: 'status' }, notice) : null,
        ),
      )
    }
    function apply(ctx) {
      ctx.slots.inject('settings.plugin.item', () =>
        ctx.slots.register(
          {
            name: 'settings.plugin.item',
            key: 'jev',
            inject: () => ({ rpc: ctx.get('connection').rpc }),
          },
          SettingsCard,
        ),
      )
    }
    return { inject: ['slots', 'connection'], apply, SettingsCard }
  },
})
