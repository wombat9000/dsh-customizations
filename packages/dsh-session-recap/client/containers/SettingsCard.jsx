import React from 'react'
import { CHANNEL, ID } from '../rpc.js'
import { settingsStyles } from '../styles.js'
import { SettingsForm } from '../components/SettingsForm.jsx'

// Keep original raw RPC envelopes/messages, separate from cached controller settings.
export function SettingsCard({ rpc, controller }) {
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

  return <SettingsForm
    open={open}
    draft={draft}
    providers={providers}
    error={error}
    notice={notice}
    busy={busy}
    onToggle={() => setOpen(value => !value)}
    onChange={change}
    onChooseModel={chooseModel}
    onSave={() => { void save() }}
  />
}
