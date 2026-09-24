// React, CHANNEL, ID and settingsStyles are supplied by the client factory.
// Settings UI deliberately uses the original raw RPC envelopes and messages;
// it does not share the controller's cached settings request.
function SettingsCard({ rpc, controller }) {
  const h = React.createElement
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(null)
  const [providers, setProviders] = React.useState([])
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    let alive = true
    const style = typeof document === 'undefined' ? null : document.createElement('style')
    if (style) {
      style.dataset.pluginCss = `${ID}/settings`
      style.textContent = settingsStyles
      document.head.appendChild(style)
    }
    async function load() {
      try {
        const result = await rpc.call(CHANNEL, 'settings', {})
        if (!result.ok) throw new Error(result.error.message)
        if (alive) setDraft(result.value)
      } catch (error) {
        if (alive) setError(error.message || String(error))
      }
    }
    void load()
    rpc.call(CHANNEL, 'models', {}).then((result) => {
      if (!alive) return
      if (result.ok) setProviders(result.value.providers)
      else setNotice('Model catalog unavailable. You can enter an exact route below.')
    }, () => {
      if (alive) setNotice('Model catalog unavailable. You can enter an exact route below.')
    })
    return () => {
      alive = false
      style?.remove()
    }
  }, [rpc])

  function change(key, value) {
    setDraft((draft) => ({ ...draft, [key]: value }))
  }

  function chooseModel(event) {
    if (event.target.value) {
      const [provider, model] = JSON.parse(event.target.value)
      setDraft((draft) => ({ ...draft, provider, model }))
    }
  }

  async function save() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { autoRecap, inactivityMinutes, provider, model } = draft
      const result = await rpc.call(CHANNEL, 'configure', {
        autoRecap, useJev: draft.useJev === true,
        inactivityMinutes: Number(inactivityMinutes), provider, model,
      })
      if (!result.ok) throw new Error(result.error.message)
      setDraft(result.value)
      controller.invalidateSettings()
      setNotice('Session recap settings saved.')
    } catch (error) {
      setError(error.message || String(error))
    } finally {
      setBusy(false)
    }
  }

  function row(label, input) {
    return h('label', { className: 'dsh-session-recap-settings__row' }, label, input)
  }

  function renderProvider(provider) {
    return h('optgroup', { key: provider.id, label: provider.name || provider.id },
      ...provider.models.map((model) => h('option', {
        key: model.id, value: JSON.stringify([provider.id, model.id]),
      }, model.name || model.id)))
  }

  return h('section', { 'aria-label': 'Session recap settings', className: 'dsh-session-recap-settings', 'data-open': open },
    h('button', {
      type: 'button', 'aria-expanded': open, 'aria-label': `${open ? 'Collapse' : 'Expand'}: Session recap`,
      onClick: () => setOpen((value) => !value),
      className: 'dsh-session-recap-settings__header',
    },
      h('span', { className: 'dsh-session-recap-settings__heading' },
        h('span', { className: 'dsh-session-recap-settings__name' }, 'Session recap'),
        h('span', { className: 'dsh-session-recap-settings__description' }, 'Show a short recap above the composer.')),
      h('svg', { className: 'dsh-session-recap-settings__chevron', 'aria-hidden': true, focusable: 'false', width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none' },
        h('path', { d: 'M3.5 5.25 7 8.75l3.5-3.5', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
    open ? h('div', { className: 'dsh-session-recap-settings__body' },
      h('p', { style: { margin: 0 } }, 'Recaps use the selected model and never change the transcript.'),
      draft ? h(React.Fragment, null,
        row('Automatic recap on return', h('input', { type: 'checkbox', checked: draft.autoRecap, disabled: busy, onChange: (event) => change('autoRecap', event.target.checked) })),
        row('Use Jev to choose recap cards', h('input', { type: 'checkbox', checked: draft.useJev === true, disabled: busy, 'aria-describedby': `${ID}-jev-privacy`, onChange: (event) => change('useJev', event.target.checked) })),
        h('small', { id: `${ID}-jev-privacy`, className: 'dsh-session-recap-settings__hint' }, 'Optional; requires the Jev plugin. Sends the same bounded history through OpenRouter to TypeSafe to choose recap categories. Manage the shared key and model in the OpenRouter and Jev settings cards; no new key is needed.'),
        row('Inactivity (minutes)', h('input', { type: 'number', min: 1, value: draft.inactivityMinutes, disabled: busy, onChange: (event) => change('inactivityMinutes', event.target.value) })),
        row('Available models', h('select', { value: '', disabled: busy || providers.length === 0, onChange: chooseModel },
          h('option', { value: '' }, 'Choose a model…'),
          ...providers.map(renderProvider))),
        row('Provider ID', h('input', { value: draft.provider || '', disabled: busy, onChange: (event) => change('provider', event.target.value) })),
        row('Model ID', h('input', { value: draft.model || '', disabled: busy, onChange: (event) => change('model', event.target.value) })),
        h('small', { className: 'dsh-session-recap-settings__hint' }, 'The catalog is advisory. You can enter an exact provider and model route. Saving validates the route without generating a recap.'),
        h('div', { className: 'dsh-session-recap-settings__footer' },
          h('button', { type: 'button', className: 'dsh-session-recap-settings__save', disabled: busy, onClick: () => { void save() } }, busy ? 'Saving…' : 'Save'))) : h('span', null, 'Loading settings…'),
      error ? h('p', { role: 'alert' }, error) : null,
      notice ? h('p', { role: 'status' }, notice) : null) : null)
}
