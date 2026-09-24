import React from 'react'
import { ID } from '../rpc.ts'
import type { ModelsResult, Settings } from '../../shared/contracts.ts'

export type SettingsDraft = Omit<Settings, 'inactivityMinutes'> & { inactivityMinutes: number | string }
export interface SettingsRowProps { label: string; children: React.ReactNode }
export interface SettingsFormProps {
  open: boolean
  draft: SettingsDraft | null
  providers: ModelsResult['providers']
  error: string
  notice: string
  busy: boolean
  onToggle: React.MouseEventHandler<HTMLButtonElement>
  onChange: <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => void
  onChooseModel: React.ChangeEventHandler<HTMLSelectElement>
  onSave: React.MouseEventHandler<HTMLButtonElement>
}

function SettingsRow({ label, children }: SettingsRowProps) {
  return <label className="dsh-session-recap-settings__row">{label}{children}</label>
}

export function SettingsForm({
  open, draft, providers, error, notice, busy,
  onToggle, onChange, onChooseModel, onSave,
}: SettingsFormProps) {
  return <section
    aria-label="Session recap settings"
    className="dsh-session-recap-settings"
    data-open={open}
  >
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? 'Collapse' : 'Expand'}: Session recap`}
      onClick={onToggle}
      className="dsh-session-recap-settings__header"
    >
      <span className="dsh-session-recap-settings__heading">
        <span className="dsh-session-recap-settings__name">Session recap</span>
        <span className="dsh-session-recap-settings__description">Show a short recap above the composer.</span>
      </span>
      <svg
        className="dsh-session-recap-settings__chevron"
        aria-hidden={true}
        focusable="false"
        width={14}
        height={14}
        viewBox="0 0 14 14"
        fill="none"
      >
        <path
          d="M3.5 5.25 7 8.75l3.5-3.5"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
    {open ? <div className="dsh-session-recap-settings__body">
      <p style={{ margin: 0 }}>Recaps use the selected model and never change the transcript.</p>
      {draft ? <>
        <SettingsRow label="Automatic recap on return">
          <input
            type="checkbox"
            checked={draft.autoRecap}
            disabled={busy}
            onChange={event => onChange('autoRecap', event.target.checked)}
          />
        </SettingsRow>
        <SettingsRow label="Use Jev to choose recap cards">
          <input
            type="checkbox"
            checked={draft.useJev === true}
            disabled={busy}
            aria-describedby={`${ID}-jev-privacy`}
            onChange={event => onChange('useJev', event.target.checked)}
          />
        </SettingsRow>
        <small id={`${ID}-jev-privacy`} className="dsh-session-recap-settings__hint">
          Optional; requires the Jev plugin. Sends the same bounded history through OpenRouter to TypeSafe to choose recap categories. Manage the shared key and model in the OpenRouter and Jev settings cards; no new key is needed.
        </small>
        <SettingsRow label="Inactivity (minutes)">
          <input
            type="number"
            min={1}
            value={draft.inactivityMinutes}
            disabled={busy}
            onChange={event => onChange('inactivityMinutes', event.target.value)}
          />
        </SettingsRow>
        <SettingsRow label="Available models">
          <select value="" disabled={busy || providers.length === 0} onChange={onChooseModel}>
            <option value="">Choose a model…</option>
            {providers.map(provider => <optgroup key={provider.id} label={provider.name || provider.id}>
              {provider.models.map(model => <option
                key={model.id}
                value={JSON.stringify([provider.id, model.id])}
              >{model.name || model.id}</option>)}
            </optgroup>)}
          </select>
        </SettingsRow>
        <SettingsRow label="Provider ID">
          <input
            value={draft.provider || ''}
            disabled={busy}
            onChange={event => onChange('provider', event.target.value)}
          />
        </SettingsRow>
        <SettingsRow label="Model ID">
          <input
            value={draft.model || ''}
            disabled={busy}
            onChange={event => onChange('model', event.target.value)}
          />
        </SettingsRow>
        <small className="dsh-session-recap-settings__hint">
          The catalog is advisory. You can enter an exact provider and model route. Saving validates the route without generating a recap.
        </small>
        <div className="dsh-session-recap-settings__footer">
          <button
            type="button"
            className="dsh-session-recap-settings__save"
            disabled={busy}
            onClick={onSave}
          >{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </> : <span>Loading settings…</span>}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </div> : null}
  </section>
}
