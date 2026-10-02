export const css = `
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
