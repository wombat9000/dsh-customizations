import React, { useId } from 'react'
import type { ComponentProps, ReactNode } from 'react'

const css = `
.dsh-settings-panel { border: .5px solid var(--dsw-alias-border-l4); border-radius: 16px; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); }
.dsh-settings-panel > summary { cursor: pointer; padding: 14px 16px; font-size: 15px; font-weight: 600; }
.dsh-settings-panel[open] { background: var(--dsw-alias-bg-layer-2); }
.dsh-settings-panel__body { display: grid; gap: 12px; margin: 0 16px; padding: 12px 0 16px; border-top: .5px solid var(--dsw-alias-border-l2); font-size: 13px; line-height: 1.5; }
.dsh-settings-panel p { margin: 0; }
.dsh-settings-panel label { display: grid; gap: 6px; }
.dsh-settings-panel input { box-sizing: border-box; width: 100%; min-width: 0; height: 34px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; font: inherit; color: inherit; background: var(--dsw-alias-bg-layer-3); }
.dsh-settings-panel button { font: inherit; color: inherit; background: transparent; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; padding: 5px 12px; cursor: pointer; }
.dsh-settings-panel button:disabled, .dsh-settings-panel input:disabled { opacity: .5; cursor: default; }
.dsh-settings-panel button:focus-visible, .dsh-settings-panel input:focus-visible, .dsh-settings-panel > summary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsh-settings-panel__actions { display: flex; gap: 8px; flex-wrap: wrap; }
.dsh-settings-panel__actions--stacked-end { display: grid; gap: 12px; justify-items: end; }
.dsh-settings-panel__hint { color: var(--dsw-alias-label-secondary); }
.dsh-settings-panel [role=alert] { color: var(--dsw-alias-label-error); }
`

interface SettingsPanelProps {
  title: string
  initiallyOpen: boolean
  status: string
  description: string
  children: ReactNode
  actions: ReactNode
  actionLayout?: 'row' | 'stacked-end'
  error?: string | undefined
  notice?: string | undefined
}

// Presentation only: consumers retain all request, credential and draft state.
export function SettingsPanel({
  title,
  initiallyOpen,
  status,
  description,
  children,
  actions,
  actionLayout = 'row',
  error,
  notice,
}: SettingsPanelProps) {
  return (
    <details className="dsh-settings-panel" aria-label={`${title} settings`} open={initiallyOpen}>
      <summary>{title}</summary>
      {/* Each mounted panel owns its styles. No shared head node or cross-bundle registry. */}
      <style>{css}</style>
      <div className="dsh-settings-panel__body">
        <p role="status">{status}</p>
        <p className="dsh-settings-panel__hint">{description}</p>
        {children}
        <div className={`dsh-settings-panel__actions dsh-settings-panel__actions--${actionLayout}`}>
          {actions}
        </div>
        {error ? <p role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
      </div>
    </details>
  )
}

type SettingsFieldProps = Omit<ComponentProps<'input'>, 'id' | 'children'> & {
  label: string
  hint?: string
}

export function SettingsField({ label, hint, ...input }: SettingsFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <>
      <label htmlFor={id}>
        {label}
        <input
          {...input}
          id={id}
          aria-describedby={
            [input['aria-describedby'], hint ? hintId : undefined].filter(Boolean).join(' ') ||
            undefined
          }
        />
      </label>
      {hint ? (
        <p id={hintId} className="dsh-settings-panel__hint">
          {hint}
        </p>
      ) : null}
    </>
  )
}
