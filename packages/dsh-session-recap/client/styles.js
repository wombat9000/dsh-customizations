import { useEffect } from 'react'
import { ID } from './rpc.js'

export const recapStyles = `
  .dsh-session-recap-action { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: none; font: inherit; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, inherit); background: transparent; border: 0; border-radius: 8px; padding: 5px 8px; cursor: pointer; }
  .dsh-session-recap-action:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, #8882); color: var(--dsw-alias-label-primary, inherit); }
  .dsh-session-recap-action:focus-visible, .dsh-session-recap-card__body:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #6b9cff); outline-offset: 2px; }
  .dsh-session-recap-action { position: relative; overflow: hidden; width: 30px; height: 30px; padding: 6px; }
  .dsh-session-recap-action[data-unread="true"] { color: var(--dsw-alias-brand-primary, #6b9cff); }
  .dsh-session-recap-action[data-unread="true"] .dsh-session-recap-action__icon { filter: drop-shadow(0 0 4px currentColor); }
  .dsh-session-recap-action[data-unread="true"]::before { content: ''; position: absolute; top: 3px; right: 3px; width: 4px; height: 4px; border-radius: 50%; background: currentColor; }
  .dsh-session-recap-action[data-open="true"] { color: var(--dsw-alias-brand-primary, #6b9cff); background: var(--dsw-alias-interactive-bg-hover, #8882); }
  .dsh-session-recap-action__warning { position: absolute; top: 0; right: 2px; font-size: 11px; font-weight: 700; color: var(--dsw-alias-label-error, #d55); }
  .dsh-session-recap-action[data-busy="true"] { color: var(--dsw-alias-brand-primary, #6b9cff); }
  .dsh-session-recap-action[data-busy="true"]::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(110deg, transparent 25%, currentColor 50%, transparent 75%); opacity: .25; transform: translateX(-140%); animation: dsh-session-recap-shimmer 1.8s linear infinite; }
  @keyframes dsh-session-recap-shimmer { to { transform: translateX(140%); } }
  @media (prefers-reduced-motion: reduce) { .dsh-session-recap-action[data-busy="true"]::after { animation: none; transform: none; background: none; opacity: 1; border-bottom: 2px solid currentColor; } }
  .dsh-session-recap-card { box-sizing: border-box; width: calc(100% - 2 * var(--dsh-composer-side-clearance, 16px) - 32px); max-width: var(--dsh-chat-content-width, 680px); min-width: 0; margin: 0 auto 8px; padding: 12px 16px; border: .5px solid var(--dsw-alias-border-l2, #8883); border-radius: 16px; background: var(--dsw-alias-bg-layer-2, #8881); color: var(--dsw-alias-label-primary, inherit); font-size: 13px; line-height: 1.6; }
  .dsh-session-recap-card__body { max-height: min(240px, 30vh); overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
  .dsh-session-recap-card__headline { margin: 0 0 6px; font: inherit; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dsh-session-recap-card__diagnostics { margin-top: 8px; font-size: 12px; white-space: normal; }
  .dsh-session-recap-card__diagnostics summary { cursor: pointer; }
  .dsh-session-recap-card__diagnostics summary:focus-visible, .dsh-session-recap-card__diagnostics button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #6b9cff); outline-offset: 2px; }
  .dsh-session-recap-card__diagnostics p { margin: 6px 0; }
  .dsh-session-recap-card__diagnostics pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
  .dsh-session-recap-card__diagnostics button { font: inherit; color: inherit; background: transparent; border: 1px solid var(--dsw-alias-border-l2, #8885); border-radius: 6px; padding: 4px 8px; margin-top: 8px; cursor: pointer; }
  .dsh-session-recap-card__table-wrap { max-width: 100%; overflow-x: auto; margin: 8px 0; }
  .dsh-session-recap-card__table-wrap table { border-collapse: collapse; min-width: 480px; width: 100%; }
  .dsh-session-recap-card__table-wrap th, .dsh-session-recap-card__table-wrap td { padding: 4px 6px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--dsw-alias-border-l2, #8883); }
  .dsh-session-recap-card__body--cards { max-height: min(420px, 45vh); }
  .dsh-session-recap-card__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
  .dsh-session-recap-card__tile { min-width: 0; padding: 10px 12px; border: .5px solid var(--dsw-alias-border-l2, #8883); border-radius: 10px; background: var(--dsw-alias-bg-layer-3, #8881); }
  .dsh-session-recap-card__title { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; font: inherit; font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary, inherit); }
  .dsh-session-recap-card__icon { flex: none; color: color-mix(in srgb, var(--recap-accent) 75%, var(--dsw-alias-label-primary, currentColor)); }
  .dsh-session-recap-card__text { margin: 0; }
  .dsh-session-recap-card__caption { margin: 6px 0 0; font-size: 11px; color: var(--dsw-alias-label-tertiary, inherit); }
  .dsh-session-recap-card__list { margin: 0; padding-left: 18px; }
  .dsh-session-recap-card__row + .dsh-session-recap-card__row { margin-top: 4px; }
  .dsh-session-recap-card__loading { margin: 0; color: var(--dsw-alias-label-secondary, inherit); }
  .dsh-session-recap-card__error { margin: 4px 0; color: var(--dsw-alias-label-error, #d55); overflow-wrap: anywhere; }
  @media (max-width: 600px) { .dsh-session-recap-card { padding: 10px 12px; border-radius: 12px; } }
`

// Match DSH's settings-card metrics using public theme tokens, not private CSS-module names.
export const settingsStyles = `
  .dsh-session-recap-settings { border: .5px solid var(--dsw-alias-border-l4); background: var(--dsw-alias-bg-layer-3); border-radius: 16px; list-style: none; transition: border-color .16s, background .16s; }
  .dsh-session-recap-settings:hover { border-color: var(--dsw-alias-label-dimmed); }
  .dsh-session-recap-settings[data-open="true"] { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-label-dimmed); }
  .dsh-session-recap-settings__header { appearance: none; width: 100%; font: inherit; color: inherit; text-align: left; cursor: pointer; background: transparent; border: 0; border-radius: 12px; display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
  .dsh-session-recap-settings__header:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
  .dsh-session-recap-settings__heading { display: flex; flex-direction: column; flex: 1; gap: 4px; min-width: 0; }
  .dsh-session-recap-settings__name { color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 600; line-height: 1.4; }
  .dsh-session-recap-settings__description { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 1.5; }
  .dsh-session-recap-settings__chevron { color: var(--dsw-alias-label-tertiary); flex: none; transition: transform .16s; }
  .dsh-session-recap-settings[data-open="true"] .dsh-session-recap-settings__chevron { transform: rotate(180deg); }
  .dsh-session-recap-settings__body { border-top: .5px solid var(--dsw-alias-border-l2); margin: 0 16px; padding: 12px 0 8px; display: grid; gap: 12px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; }
  .dsh-session-recap-settings__row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 13px; font-weight: 500; }
  .dsh-session-recap-settings__row input:not([type="checkbox"]), .dsh-session-recap-settings__row select { box-sizing: border-box; min-width: 0; max-width: 100%; border: .5px solid var(--dsw-alias-border-l4); background: var(--dsw-alias-bg-layer-3); height: 34px; font: inherit; font-weight: 400; color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 0 12px; }
  .dsh-session-recap-settings__row input:focus-visible, .dsh-session-recap-settings__row select:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
  .dsh-session-recap-settings__row input:disabled, .dsh-session-recap-settings__row select:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
  .dsh-session-recap-settings__hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5; }
  .dsh-session-recap-settings__footer { border-top: .5px solid var(--dsw-alias-border-l2); padding: 12px 0 4px; display: flex; justify-content: flex-end; }
  .dsh-session-recap-settings__save { appearance: none; font: inherit; cursor: pointer; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 5px 14px; font-size: 13px; line-height: 1.5; background: transparent; color: var(--dsw-alias-label-primary); }
  .dsh-session-recap-settings__save:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
  .dsh-session-recap-settings__save:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
  .dsh-session-recap-settings__save:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
  .dsh-session-recap-settings__body [role="alert"] { margin: 0; color: var(--dsw-alias-label-error); }
  .dsh-session-recap-settings__body [role="status"] { margin: 0; color: var(--dsw-alias-label-secondary); }
  @media (prefers-reduced-motion: reduce) { .dsh-session-recap-settings, .dsh-session-recap-settings__chevron { transition: none; } }
`

export function useRecapStyles(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return
    const style = document.createElement('style')
    style.dataset.pluginCss = `${ID}/recap`
    style.textContent = recapStyles
    document.head.appendChild(style)
    return () => style.remove()
  }, [enabled])
}
