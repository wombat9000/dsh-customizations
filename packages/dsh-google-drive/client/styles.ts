export const css = `
      .gd-access {
        font: 13px/1.5 var(--dsw-font-family, system-ui, sans-serif);
        color: var(--dsw-alias-label-primary);
      }
      .gd-access *, .gd-access *::before, .gd-access *::after { box-sizing: border-box; }
      .gd-access button, .gd-access input[type=search] {
        font: inherit;
        color: inherit;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 8px;
        padding: 8px 12px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .gd-access button { cursor: pointer; }
      .gd-access button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .gd-access button:disabled { opacity: .45; cursor: default; }
      .gd-access button:focus-visible, .gd-access input:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .gd-access p { margin: 0; }
      .gd-access .gd-muted { color: var(--dsw-alias-label-secondary); }
      .gd-access .gd-primary {
        background: var(--dsw-alias-button-primary-fill);
        border-color: transparent;
        color: var(--dsw-alias-label-primary-foreground);
        font-weight: 600;
      }
      .gd-access .gd-primary:hover:not(:disabled) {
        background: var(--dsw-alias-button-primary-hover);
      }
      .gd-access .gd-quiet { background: transparent; border-color: transparent; }
      .gd-icon { width: 20px; height: 20px; flex: 0 0 auto; }
      .gd-access .gd-icon-button {
        display: inline-flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; padding: 6px; flex: 0 0 auto;
        border-color: transparent; background: transparent;
      }
      .gd-card { padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; }
      .gd-card p { margin-top: 6px; }
      .gd-card-title { display: flex; align-items: center; gap: 9px; }
      .gd-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
      .gd-modal {
        pointer-events: auto;
        width: min(800px, calc(100vw - 40px));
        max-width: none;
        height: min(660px, calc(100dvh - 48px));
        max-height: calc(100dvh - 48px);
        padding: 0;
        overflow: hidden;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 16px;
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        box-shadow: var(--dsw-shadow-lv3);
      }
      .gd-modal[open] { display: flex; flex-direction: column; }
      .gd-main { display: contents; }
      .gd-modal::backdrop { background: #0008; }
      .gd-header { display: flex; align-items: center; gap: 12px; padding: 20px 24px 16px; flex: 0 0 auto; }
      .gd-header-copy { flex: 1; min-width: 0; }
      .gd-header h2 { font-size: 18px; font-weight: 600; line-height: 26px; margin: 0; }
      .gd-header p { font-size: 12px; margin-top: 2px; }
      .gd-drive-mark {
        display: flex; align-items: center; justify-content: center;
        width: 40px; height: 40px; border-radius: 11px;
        background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary);
      }
      .gd-toolbar { padding: 0 24px; flex: 0 0 auto; }
      .gd-search {
        display: flex; align-items: center; gap: 8px;
        padding: 3px 4px 3px 12px;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2);
      }
      .gd-search > .gd-icon { color: var(--dsw-alias-label-secondary); width: 18px; }
      .gd-search input[type=search] {
        width: 100%; min-width: 0; border: 0; background: transparent; padding: 7px 0;
      }
      .gd-search button { border: 0; background: transparent; }
      .gd-tabs { display: flex; gap: 16px; margin-top: 10px; }
      .gd-access .gd-tabs button { border: 0; border-radius: 0; border-bottom: 2px solid transparent; background: transparent; padding: 10px 2px; }
      .gd-access .gd-tabs button[aria-selected=true] { border-bottom-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); font-weight: 600; }
      .gd-search-results { padding: 10px 0; overflow-wrap: anywhere; }
      .gd-breadcrumbs { display: flex; align-items: center; gap: 2px; min-height: 50px; overflow-x: auto; white-space: nowrap; }
      .gd-breadcrumbs button { padding: 5px 8px; border: 0; background: transparent; }
      .gd-breadcrumbs button:first-child { margin-left: -8px; }
      .gd-breadcrumbs button[aria-current] { font-weight: 600; }
      .gd-breadcrumbs .gd-icon { width: 14px; height: 14px; color: var(--dsw-alias-label-secondary); }
      .gd-column-head {
        display: flex; justify-content: space-between;
        padding: 9px 34px 9px 88px; font-size: 11px;
        color: var(--dsw-alias-label-secondary);
        border-block: 1px solid var(--dsw-alias-border-l2);
        flex: 0 0 auto;
      }
      .gd-browser { flex: 1 1 auto; min-height: 80px; overflow-y: auto; padding: 8px 16px; }
      .gd-modal ul { list-style: none; padding: 0; margin: 0; }
      .gd-file-row { display: flex; align-items: center; gap: 12px; padding: 8px 12px; min-height: 48px; border-radius: 8px; }
      .gd-file-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .gd-file-row.gd-selected {
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, var(--dsw-alias-bg-layer-1));
        box-shadow: inset 2px 0 var(--dsw-alias-brand-primary);
      }
      .gd-file-row input[type=checkbox] {
        width: 16px; height: 16px; margin: 0; flex: 0 0 auto;
        accent-color: var(--dsw-alias-brand-primary); cursor: pointer;
      }
      .gd-file-icon { display: flex; color: var(--dsw-alias-label-secondary); }
      .gd-file-icon[data-kind=folder] { color: var(--dsw-alias-state-warn-primary); }
      .gd-file-icon[data-kind=document], .gd-file-icon[data-kind=pdf] { color: var(--dsw-alias-brand-primary); }
      .gd-file-icon[data-kind=spreadsheet] { color: var(--dsw-alias-state-success-primary); }
      .gd-file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .gd-access button.gd-file-name { text-align: left; border: 0; background: transparent; padding: 4px 0; }
      .gd-file-row label.gd-file-name { cursor: pointer; }
      .gd-file-row button.gd-file-name:hover { text-decoration: underline; text-underline-offset: 3px; }
      .gd-file-type { font-size: 12px; color: var(--dsw-alias-label-secondary); width: 100px; text-align: right; flex: 0 0 auto; }
      .gd-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 42px 16px; text-align: center; }
      .gd-empty > .gd-icon { width: 28px; height: 28px; color: var(--dsw-alias-label-secondary); }
      .gd-error { margin: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
      .gd-error button { margin-top: 8px; }
      .gd-access [role=alert] { color: var(--dsw-alias-state-error-primary); }
      .gd-pagination { display: flex; justify-content: center; padding: 8px; }
      .gd-selection { flex: 0 0 auto; border-top: 1px solid var(--dsw-alias-border-l2); padding: 10px 24px; background: var(--dsw-alias-bg-layer-2); }
      .gd-selection-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .gd-selection-top button { padding: 2px 0; border: 0; background: transparent; display: flex; align-items: center; gap: 6px; font-weight: 500; }
      .gd-selection-top .gd-icon { width: 14px; height: 14px; }
      .gd-selection-note { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 4px !important; }
      .gd-modal .gd-tray { max-height: 132px; overflow-y: auto; margin-top: 8px; }
      .gd-tray li { display: flex; align-items: center; gap: 10px; min-height: 36px; }
      .gd-tray .gd-file-type { width: auto; }
      .gd-footer { flex: 0 0 auto; border-top: 1px solid var(--dsw-alias-border-l2); padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
      .gd-footer-count { font-weight: 500; }
      .gd-footer-count p { font-size: 11px; font-weight: 400; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
      .gd-footer-actions { display: flex; gap: 8px; flex: 0 0 auto; }
      @media (max-width: 560px) {
        .gd-modal { width: calc(100vw - 16px); height: calc(100dvh - 24px); max-height: calc(100dvh - 24px); border-radius: 12px; }
        .gd-header { padding: 16px; gap: 10px; }
        .gd-header h2 { font-size: 16px; }
        .gd-drive-mark { width: 34px; height: 34px; }
        .gd-toolbar { padding: 0 16px; }
        .gd-browser { padding: 6px 8px; }
        .gd-column-head { padding-left: 80px; padding-right: 22px; }
        .gd-file-row { gap: 10px; }
        .gd-file-type { width: 62px; font-size: 11px; }
        .gd-selection { padding: 10px 16px; }
        .gd-footer { padding: 12px 16px; flex-wrap: wrap; gap: 10px; }
        .gd-footer-count { width: 100%; display: flex; gap: 8px; align-items: baseline; }
        .gd-footer-actions { width: 100%; }
        .gd-footer-actions button { flex: 1; }
      }
      @media (max-height: 560px) {
        /* Keep confirmation outside the scroll region on landscape screens. */
        .gd-main { display: block; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
        .gd-browser { min-height: 0; overflow: visible; }
      }
    `

export const previewCSS = `
      .gs-preview { width: min(1080px, calc(100vw - 24px)); }
      .gs-preview .gd-header-copy { overflow-wrap: anywhere; max-height: 24dvh; overflow: auto; }
      .gs-body { flex: 1; min-height: 0; overflow: auto; padding: 0 24px 24px; }
      .gs-body p { margin: 8px 0; overflow-wrap: anywhere; }
      .gs-grids { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .gs-grid { min-width: 0; }
      .gs-table-scroll { overflow: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
      .gs-grid table { border-collapse: collapse; min-width: 100%; background: white; color: #202124; font: 13px Arial, sans-serif; }
      .gs-grid th { background: #eef0f3; color: #444; font: 11px system-ui; padding: 6px; }
      .gs-grid td { border: 1px solid #dadce0; min-width: 96px; max-width: 240px; padding: 6px; overflow-wrap: anywhere; white-space: pre-wrap; }
      .gs-grid td[data-changed=true] { outline: 2px solid #b06000; outline-offset: -2px; }
      .gs-detail { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 12px; margin-top: 10px; }
      .gs-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .gs-pair > div { min-width: 0; }
      .gs-value { white-space: pre-wrap; overflow-wrap: anywhere; padding: 8px; background: var(--dsw-alias-bg-layer-2); border-radius: 6px; }
      .gs-fields { margin: 8px 0; }
      .gs-fields dt { color: var(--dsw-alias-label-secondary); }
      .gs-fields dd { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
      @media (max-width: 650px) { .gs-grids, .gs-pair { grid-template-columns: 1fr; } .gs-body { padding: 0 16px 16px; } }
    `
