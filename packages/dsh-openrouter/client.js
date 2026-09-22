window.__ModuleLoader__.load({
  id: '@local/dsh-openrouter',
  factory: require => {
    const React = require('react')
    const h = React.createElement
    const CHANNEL = '/openrouter-integration'
    const css = `
      .dsh-openrouter { border: .5px solid var(--dsw-alias-border-l4); border-radius: 16px; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); }
      .dsh-openrouter summary { cursor: pointer; padding: 14px 16px; font-size: 15px; font-weight: 600; }
      .dsh-openrouter[open] { background: var(--dsw-alias-bg-layer-2); }
      .dsh-openrouter__body { display: grid; gap: 12px; margin: 0 16px; padding: 12px 0 16px; border-top: .5px solid var(--dsw-alias-border-l2); font-size: 13px; line-height: 1.5; }
      .dsh-openrouter p { margin: 0; }
      .dsh-openrouter label { display: grid; gap: 6px; }
      .dsh-openrouter input { box-sizing: border-box; width: 100%; min-width: 0; height: 34px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; font: inherit; color: inherit; background: var(--dsw-alias-bg-layer-3); }
      .dsh-openrouter button { font: inherit; color: inherit; background: transparent; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; padding: 5px 12px; cursor: pointer; }
      .dsh-openrouter button:disabled, .dsh-openrouter input:disabled { opacity: .5; cursor: default; }
      .dsh-openrouter button:focus-visible, .dsh-openrouter input:focus-visible, .dsh-openrouter summary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .dsh-openrouter__actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .dsh-openrouter__hint { color: var(--dsw-alias-label-secondary); }
      .dsh-openrouter [role=alert] { color: var(--dsw-alias-label-error); }
    `
    async function call(rpc, method, payload = {}) {
      let result
      try { result = await rpc.call(CHANNEL, method, payload) }
      catch { throw new Error('OpenRouter settings request failed.') }
      if (!result?.ok) throw new Error(result?.error?.message || 'OpenRouter settings are unavailable.')
      return result.value
    }
    function SettingsCard({ rpc }) {
      const [status, setStatus] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const alive = React.useRef(false)
      React.useEffect(() => {
        alive.current = true
        const style = document.createElement('style')
        style.dataset.pluginCss = 'openrouter/settings'
        style.textContent = css
        document.head.appendChild(style)
        void call(rpc, 'status').then(value => { if (alive.current) setStatus(value) }, () => { if (alive.current) setError('Could not read OpenRouter credential status.') })
        return () => { alive.current = false; style.remove() }
      }, [rpc])
      const mutate = async method => {
        if (busy || !status?.writable) return
        if (method === 'clear' && !window.confirm('Remove the shared OpenRouter key? This affects every integration and DSH model route using it. A lower-priority environment key may become active.')) return
        setBusy(true); setError(''); setNotice('')
        try {
          const value = await call(rpc, method, { target: status.target, ...(method === 'save' ? { apiKey: draft.trim() } : {}) })
          if (alive.current) {
            setStatus(value); setDraft('')
            setNotice(method === 'save' ? 'Shared OpenRouter key saved. No remote request was made.' : 'Stored key removed. Effective credential status refreshed.')
          }
        } catch (failure) {
          if (alive.current) {
            setError(failure.message)
            // A changed effective source must be reviewed before a later write.
            try { const value = await call(rpc, 'status'); if (alive.current) setStatus(value) } catch { if (alive.current) setStatus(null) }
          }
        } finally { if (alive.current) setBusy(false) }
      }
      return h('details', { className: 'dsh-openrouter', 'aria-label': 'OpenRouter settings' },
        h('summary', null, 'OpenRouter'),
        h('div', { className: 'dsh-openrouter__body' },
          h('p', { role: 'status' }, status ? `Shared key: ${status.configured ? 'Configured' : 'Not configured'}${status.source ? ` (${status.source})` : ''}` : 'Checking shared key…'),
          h('p', { className: 'dsh-openrouter__hint' }, 'One credential for trusted OpenRouter integrations and the built-in OpenRouter model route. Replacing or removing it affects all consumers. The key is stored in DSH credentials, never ordinary plugin settings.'),
          status && !status.writable ? h('p', null, 'This credential source is read-only. Change it where it is configured.') : null,
          h('label', null, 'OpenRouter API key', h('input', { type: 'password', value: draft, disabled: busy || !status?.writable, autoComplete: 'off', spellCheck: false, onChange: event => setDraft(event.target.value) })),
          h('div', { className: 'dsh-openrouter__actions' },
            h('button', { type: 'button', disabled: busy || !status?.writable || !draft.trim(), onClick: () => { void mutate('save') } }, 'Save shared key'),
            h('button', { type: 'button', disabled: busy || !status?.writable || !status?.configured, onClick: () => { void mutate('clear') } }, 'Remove shared key')),
          error || status?.error ? h('p', { role: 'alert' }, error || status.error) : null,
          notice ? h('p', { role: 'status' }, notice) : null))
    }
    function apply(ctx) {
      // RC2 settings.plugin.item is keyed by a served namespace, additive to other cards.
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item', key: 'openrouter', inject: () => ({ rpc: ctx.get('connection').rpc }),
      }, SettingsCard))
    }
    return { inject: ['slots', 'connection'], apply, SettingsCard }
  },
})
