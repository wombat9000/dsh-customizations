export const css = `
      .dsh-jev { border: .5px solid var(--dsw-alias-border-l4); border-radius: 16px; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); }
      .dsh-jev summary { cursor: pointer; padding: 14px 16px; font-size: 15px; font-weight: 600; }
      .dsh-jev[open] { background: var(--dsw-alias-bg-layer-2); }
      .dsh-jev__body { display: grid; gap: 12px; margin: 0 16px; padding: 12px 0 16px; border-top: .5px solid var(--dsw-alias-border-l2); font-size: 13px; line-height: 1.5; }
      .dsh-jev p { margin: 0; }
      .dsh-jev label { display: grid; gap: 6px; }
      .dsh-jev input { box-sizing: border-box; width: 100%; min-width: 0; height: 34px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; font: inherit; color: inherit; background: var(--dsw-alias-bg-layer-3); }
      .dsh-jev button { justify-self: end; font: inherit; color: inherit; background: transparent; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; padding: 5px 12px; cursor: pointer; }
      .dsh-jev button:disabled { opacity: .5; cursor: default; }
      .dsh-jev button:focus-visible, .dsh-jev input:focus-visible, .dsh-jev summary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .dsh-jev__hint { color: var(--dsw-alias-label-secondary); }
      .dsh-jev [role=alert] { color: var(--dsw-alias-label-error); }
    `
