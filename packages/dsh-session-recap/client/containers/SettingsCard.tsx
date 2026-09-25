import React from 'react'
import { CHANNEL, ID, errorMessage } from '../rpc.ts'
import { settingsStyles } from '../styles.ts'
import { SettingsForm } from '../components/SettingsForm.tsx'
import type { SettingsDraft } from '../components/SettingsForm.tsx'
import type { ModelsResult, Rpc } from '../../shared/contracts.ts'
import type { Controller } from '../controller-types.ts'

export interface SettingsCardProps {
  rpc: Rpc
  controller: Controller
}

// Keep original raw RPC envelopes/messages, separate from cached controller settings.
export function SettingsCard({ rpc, controller }: SettingsCardProps) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<SettingsDraft | null>(null)
  const [providers, setProviders] = React.useState<ModelsResult['providers']>([])
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
        if (alive) setError(errorMessage(error))
      }
    }
    void load()
    rpc.call(CHANNEL, 'models', {}).then(
      (result) => {
        if (!alive) return
        if (result.ok) setProviders(result.value.providers)
        else setNotice('Model catalog unavailable. You can enter an exact route below.')
      },
      () => {
        if (alive) setNotice('Model catalog unavailable. You can enter an exact route below.')
      },
    )
    return () => {
      alive = false
      style?.remove()
    }
  }, [rpc])

  // These callbacks are rendered only after settings load; keep draft updates
  // unchanged while recording that UI invariant for strict null checking.
  function change<K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) {
    setDraft((draft) => ({ ...draft!, [key]: value }))
  }

  function chooseModel(event: React.ChangeEvent<HTMLSelectElement>) {
    if (event.target.value) {
      // SettingsForm serializes this exact pair into each option value.
      const [provider, model] = JSON.parse(event.target.value) as [string, string]
      setDraft((draft) => ({ ...draft!, provider, model }))
    }
  }

  async function save() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { autoRecap, inactivityMinutes, provider, model } = draft!
      const result = await rpc.call(CHANNEL, 'configure', {
        autoRecap,
        useJev: draft!.useJev === true,
        inactivityMinutes: Number(inactivityMinutes),
        provider,
        model,
      })
      if (!result.ok) throw new Error(result.error.message)
      setDraft(result.value)
      controller.invalidateSettings()
      setNotice('Session recap settings saved.')
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsForm
      open={open}
      draft={draft}
      providers={providers}
      error={error}
      notice={notice}
      busy={busy}
      onToggle={() => setOpen((value) => !value)}
      onChange={change}
      onChooseModel={chooseModel}
      onSave={() => {
        void save()
      }}
    />
  )
}
