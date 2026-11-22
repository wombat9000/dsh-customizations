import React, { useId } from 'react'
import type { ComponentProps, ReactNode } from 'react'

const css = `
.dsh-settings-panel { border: .5px solid var(--dsw-alias-border-l4); border-radius: 16px; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); }
.dsh-settings-panel > summary { cursor: pointer; padding: 14px 16px; font-size: 15px; font-weight: 600; }
.dsh-settings-panel__subtitle { margin: 4px 0 0; font-size: 13px; font-weight: 400; color: var(--dsw-alias-label-secondary); }
.dsh-settings-panel[open] { background: var(--dsw-alias-bg-layer-2); }
.dsh-settings-panel--section { display: grid; gap: 12px; padding: 16px; }
.dsh-settings-panel--section > h2 { margin: 0; font-size: 18px; font-weight: 600; }
.dsh-settings-panel__body { display: grid; gap: 12px; margin: 0 16px; padding: 12px 0 16px; border-top: .5px solid var(--dsw-alias-border-l2); font-size: 13px; line-height: 1.5; }
.dsh-settings-panel--section > .dsh-settings-panel__body { margin: 0; padding: 12px 0 0; }
.dsh-settings-panel__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dsh-settings-panel__header h3, .dsh-settings-panel h4 { margin: 0; font-size: 14px; font-weight: 600; }
.dsh-settings-panel__badge { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.dsh-settings-panel__dot { width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto; background: var(--dsw-alias-label-secondary); }
.dsh-settings-panel__dot--ok { background: #22c55e; }
.dsh-settings-panel__dot--warn { background: #f59e0b; }
.dsh-settings-panel__dot--error { background: #ef4444; }
.dsh-settings-panel__dot--muted { background: #94a3b8; }
.dsh-settings-panel__details { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 12px; font-size: 13px; }
.dsh-settings-panel__term { color: var(--dsw-alias-label-secondary); }
.dsh-settings-panel__value { overflow-wrap: anywhere; }
.dsh-settings-panel p { margin: 0; }
.dsh-settings-panel label { display: grid; gap: 6px; }
.dsh-settings-panel label.dsh-settings-panel__checkbox { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.dsh-settings-panel input:not([type=checkbox]), .dsh-settings-panel textarea { box-sizing: border-box; width: 100%; min-width: 0; padding: 7px 10px; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; font: inherit; color: inherit; background: var(--dsw-alias-bg-layer-3); }
.dsh-settings-panel input:not([type=checkbox]) { height: 34px; padding: 0 10px; }
.dsh-settings-panel textarea { resize: vertical; }
.dsh-settings-panel input[type=checkbox] { width: auto; height: auto; margin: 0; }
.dsh-settings-panel button { font: inherit; color: inherit; background: transparent; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; padding: 5px 12px; cursor: pointer; }
.dsh-settings-panel__button--primary { border-color: var(--dsw-alias-brand-primary); }
.dsh-settings-panel__button--danger { color: var(--dsw-alias-label-error); }
.dsh-settings-panel button:disabled, .dsh-settings-panel input:disabled, .dsh-settings-panel textarea:disabled { opacity: .5; cursor: default; }
.dsh-settings-panel button:focus-visible, .dsh-settings-panel input:focus-visible, .dsh-settings-panel textarea:focus-visible, .dsh-settings-panel a:focus-visible, .dsh-settings-panel > summary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsh-settings-panel__actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.dsh-settings-panel__actions--stacked-end { display: grid; gap: 12px; justify-items: end; }
.dsh-settings-panel__hint { color: var(--dsw-alias-label-secondary); }
.dsh-settings-panel a { color: inherit; font-size: 13px; }
.dsh-settings-panel [role=alert] { color: var(--dsw-alias-label-error); }
`

export type SettingsStatusTone = 'ok' | 'warn' | 'error' | 'muted'

export interface SettingsPanelProps {
  as?: 'details' | 'section' | undefined
  title: string
  subtitle?: string | undefined
  groupTitle?: string | undefined
  initiallyOpen?: boolean | undefined
  status?: string | undefined
  statusTone?: SettingsStatusTone | undefined
  description?: string | undefined
  children?: ReactNode
  actions?: ReactNode
  actionLayout?: 'row' | 'stacked-end' | undefined
  error?: string | undefined
  notice?: string | undefined
}

// Presentation only: consumers retain all request, credential and draft state.
export function SettingsPanel({
  as = 'details',
  title,
  subtitle,
  groupTitle,
  initiallyOpen = false,
  status,
  statusTone,
  description,
  children,
  actions,
  actionLayout = 'row',
  error,
  notice,
}: SettingsPanelProps) {
  const headingId = useId()
  const groupId = useId()
  const body = (
    <div
      className="dsh-settings-panel__body"
      role={groupTitle ? 'group' : undefined}
      aria-labelledby={groupTitle ? groupId : undefined}
    >
      {groupTitle ? (
        <div className="dsh-settings-panel__header">
          <h3 id={groupId}>{groupTitle}</h3>
          {status ? (
            <span className="dsh-settings-panel__badge" role="status">
              {statusTone ? (
                <span
                  className={`dsh-settings-panel__dot dsh-settings-panel__dot--${statusTone}`}
                  aria-hidden="true"
                />
              ) : null}
              {status}
            </span>
          ) : null}
        </div>
      ) : status ? (
        <p role="status">{status}</p>
      ) : null}
      {description ? <p className="dsh-settings-panel__hint">{description}</p> : null}
      {children}
      {actions ? (
        <div className={`dsh-settings-panel__actions dsh-settings-panel__actions--${actionLayout}`}>
          {actions}
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  )

  if (as === 'section') {
    return (
      <section
        className="dsh-settings-panel dsh-settings-panel--section"
        aria-labelledby={headingId}
      >
        <h2 id={headingId}>{title}</h2>
        {subtitle ? <p className="dsh-settings-panel__hint">{subtitle}</p> : null}
        {/* Each mounted panel owns its styles. No shared head node or cross-bundle registry. */}
        <style>{css}</style>
        {body}
      </section>
    )
  }

  return (
    <details className="dsh-settings-panel" aria-label={`${title} settings`} open={initiallyOpen}>
      <summary>
        {title}
        {subtitle ? <p className="dsh-settings-panel__subtitle">{subtitle}</p> : null}
      </summary>
      {/* Each mounted panel owns its styles. No shared head node or cross-bundle registry. */}
      <style>{css}</style>
      {body}
    </details>
  )
}

export function SettingsDetailList({
  items,
}: {
  items: readonly (readonly [string, string] | null | undefined | false)[]
}) {
  const entries = items.filter((item): item is readonly [string, string] => Boolean(item))
  if (!entries.length) return null
  return (
    <div className="dsh-settings-panel__details">
      {entries.map(([term, value]) => (
        <React.Fragment key={term}>
          <span className="dsh-settings-panel__term">{term}</span>
          <span className="dsh-settings-panel__value">{value}</span>
        </React.Fragment>
      ))}
    </div>
  )
}

type SettingsFieldProps = Omit<ComponentProps<'input'>, 'id' | 'children'> & {
  label: string
  hint?: string | undefined
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
