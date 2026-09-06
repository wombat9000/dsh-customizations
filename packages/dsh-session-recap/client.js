window.__ModuleLoader__.load({
  id: '@wombat9000/dsh-session-recap',
  factory: (require) => {
    const React = require('react')
    const CHANNEL = '/session-recap'
    const ID = 'wombat9000-session-recap'
    // Only timestamps enter browser storage. Recap text stays in memory.
    function createController({ rpc, storage, now = Date.now }) {
      const states = new Map()
      const memory = new Map()
      let settingsPromise
      const settings = () => settingsPromise ??= rpc.call(CHANNEL, 'settings', {}).then(unwrap).catch((error) => {
        settingsPromise = undefined
        throw error
      })
      function unwrap(result) {
        if (!result?.ok) throw new Error(result?.error?.message || 'Session recap is unavailable.')
        return result.value
      }
      const state = (sessionId) => {
        if (!states.has(sessionId)) states.set(sessionId, { value: {}, listeners: new Set(), pending: null, generation: 0 })
        return states.get(sessionId)
      }
      const publish = (s, value) => { s.value = value; for (const listener of s.listeners) listener(value) }
      function key(config, sessionId) {
        return typeof config.storageScope === 'string' && config.storageScope
          ? `${ID}:activity:${JSON.stringify([config.storageScope, sessionId])}` : undefined
      }
      function read(key) {
        if (!key) return undefined
        let raw = memory.get(key)
        try { raw = storage?.getItem(key) ?? raw } catch {}
        const value = Number(raw)
        return raw != null && Number.isFinite(value) && value >= 0 && value <= now() ? value : undefined
      }
      function touch(key) {
        if (!key) return
        const value = String(now())
        memory.set(key, value)
        try { storage?.setItem(key, value) } catch {}
      }
      async function recap(sessionId, automatic = false) {
        const s = state(sessionId)
        if (s.pending) return s.pending
        const generation = s.generation
        publish(s, { ...s.value, busy: true, error: undefined })
        const pending = Promise.resolve().then(() => rpc.call(CHANNEL, 'recap', { sessionId, automatic })).then(unwrap).then((result) => {
          if (generation !== s.generation) return
          if (result.sessionId !== sessionId) throw new Error('Session recap returned a different session.')
          publish(s, { busy: false, recap: result.recap })
        }).catch((error) => {
          if (generation === s.generation) publish(s, { ...s.value, busy: false, error: error.message || String(error) })
        }).finally(() => { if (s.pending === pending) s.pending = null })
        s.pending = pending
        return pending
      }
      function mount(sessionId, { document, window }, listener) {
        const s = state(sessionId)
        s.listeners.add(listener)
        listener(s.value)
        let alive = true
        let active = false
        let activityKey
        let currentConfig
        let checking = false
        let retry
        async function checkReturn(config) {
          if (checking) return
          if (!config.autoRecap || !config.provider || !config.model) { touch(activityKey); return }
          checking = true
          const token = generation
          const recapGeneration = s.generation
          try {
            const activity = unwrap(await rpc.call(CHANNEL, 'activity', { sessionId }))
            if (!alive || !active || token !== generation || recapGeneration !== s.generation || !visible()) return
            // A live session appears only after persisted history has loaded.
            // Do not claim the visit until loading and the active turn finish.
            if (!activity.ready || activity.running) {
              clearTimeout(retry)
              retry = setTimeout(() => { if (alive && active) void checkReturn(currentConfig) }, 1000)
              return
            }
            clearTimeout(retry)
            const stored = read(activityKey)
            const fallback = activity.latestActivity
            const previous = stored ?? (Number.isFinite(fallback) && fallback >= 0 && fallback <= now() ? fallback : undefined)
            // Claim this return before any billable call, including errors.
            touch(activityKey)
            const minutes = Number.isFinite(config.inactivityMinutes) && config.inactivityMinutes > 0 ? config.inactivityMinutes : 30
            if (previous !== undefined && now() - previous >= minutes * 60000) void recap(sessionId, true)
          } catch (error) {
            if (alive && active && token === generation && recapGeneration === s.generation) publish(s, { ...s.value, error: error.message || String(error) })
          } finally { checking = false }
        }
        let generation = 0
        const visible = () => document.visibilityState !== 'hidden' && (typeof document.hasFocus !== 'function' || document.hasFocus())
        async function enter() {
          if (!alive || active || !visible()) return
          active = true
          const token = ++generation
          const recapGeneration = s.generation
          try {
            const config = await settings()
            if (!alive || !active || token !== generation || recapGeneration !== s.generation || !visible()) return
            activityKey = key(config, sessionId)
            currentConfig = config
            checkReturn(config)
          } catch (error) {
            if (alive && active && recapGeneration === s.generation) publish(s, { ...s.value, error: error.message || String(error) })
          }
        }
        function leave() {
          if (!active) return
          clearTimeout(retry)
          // Do not overwrite an unclaimed first visit while history is loading.
          if (read(activityKey) !== undefined) touch(activityKey)
          active = false
          generation++
        }
        const visibility = () => { if (visible()) void enter(); else leave() }
        const activity = () => {
          if (!active || !visible() || !currentConfig) return
          void settings().then((config) => {
            if (alive && active && visible()) { currentConfig = config; checkReturn(config) }
          }, () => { touch(activityKey) })
        }
        const handlers = [[document, 'visibilitychange', visibility], [window, 'focus', enter], [window, 'blur', leave], [window, 'pagehide', leave], [document, 'pointerdown', activity], [document, 'keydown', activity]]
        for (const [target, event, handler] of handlers) target.addEventListener(event, handler)
        void enter()
        return () => {
          leave()
          alive = false
          s.listeners.delete(listener)
          for (const [target, event, handler] of handlers) target.removeEventListener(event, handler)
        }
      }
      return {
        mount, recap,
        getSnapshot(sessionId) { return state(sessionId).value },
        subscribe(sessionId, listener) {
          const s = state(sessionId)
          s.listeners.add(listener)
          return () => s.listeners.delete(listener)
        },
        invalidateSettings() { settingsPromise = undefined },
        humanMessageSent(sessionId) {
          const s = states.get(sessionId)
          if (!s) return
          s.generation++
          s.pending = null
          publish(s, {})
          // A successful send counts as activity even without a mounted dock.
          void settings().then((config) => touch(key(config, sessionId)), () => {})
        },
      }
    }
    const recapStyles = `
      .dsh-session-recap-action { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: none; font: inherit; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, inherit); background: transparent; border: 0; border-radius: 8px; padding: 5px 8px; cursor: pointer; }
      .dsh-session-recap-action:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, #8882); color: var(--dsw-alias-label-primary, inherit); }
      .dsh-session-recap-action:focus-visible, .dsh-session-recap-card__body:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #6b9cff); outline-offset: 2px; }
      .dsh-session-recap-action:disabled { color: var(--dsw-alias-label-tertiary, #888); cursor: default; }
      .dsh-session-recap-card { box-sizing: border-box; width: calc(100% - 2 * var(--dsh-composer-side-clearance, 16px) - 32px); max-width: var(--dsh-chat-content-width, 680px); min-width: 0; margin: 0 auto 8px; padding: 12px 16px; border: .5px solid var(--dsw-alias-border-l2, #8883); border-radius: 16px; background: var(--dsw-alias-bg-layer-2, #8881); color: var(--dsw-alias-label-primary, inherit); font-size: 13px; line-height: 1.6; }
      .dsh-session-recap-card__body { max-height: min(240px, 30vh); overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
      .dsh-session-recap-card__list { margin: 0; padding-left: 18px; }
      .dsh-session-recap-card__row + .dsh-session-recap-card__row { margin-top: 4px; }
      .dsh-session-recap-card__loading { margin: 0; color: var(--dsw-alias-label-secondary, inherit); }
      .dsh-session-recap-card__error { margin: 4px 0; color: var(--dsw-alias-label-error, #d55); overflow-wrap: anywhere; }
      @media (max-width: 600px) { .dsh-session-recap-card { padding: 10px 12px; border-radius: 12px; } }
    `
    function useRecapStyles() {
      React.useEffect(() => {
        if (typeof document === 'undefined') return
        const style = document.createElement('style')
        style.dataset.pluginCss = `${ID}/recap`
        style.textContent = recapStyles
        document.head.appendChild(style)
        return () => style.remove()
      }, [])
    }
    function useRecapState(controller, sessionId) {
      return React.useSyncExternalStore(
        React.useCallback((listener) => controller.subscribe(sessionId, listener), [controller, sessionId]),
        React.useCallback(() => controller.getSnapshot(sessionId), [controller, sessionId]),
      )
    }
    function recapIcon(className) {
      const h = React.createElement
      return h('svg', { className, 'aria-hidden': true, focusable: 'false', width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('rect', { x: 5, y: 3, width: 14, height: 18, rx: 3 }),
        h('path', { d: 'M9 8h6M9 12h6M9 16h3' }))
    }
    function RecapAction({ sessionId, useSession, controller }) {
      const blank = useSession((session) => session.blank) !== false
      const state = useRecapState(controller, sessionId)
      useRecapStyles()
      if (blank) return null
      return React.createElement('button', {
        type: 'button', className: 'dsh-session-recap-action', disabled: state.busy,
        title: 'Generate a recap of this session',
        onClick: () => { void controller.recap(sessionId) },
      }, recapIcon(), state.busy ? 'Recapping…' : 'Recap')
    }
    function RecapCard({ sessionId, session, controller }) {
      const state = useRecapState(controller, sessionId)
      const blank = session?.blank !== false
      useRecapStyles()
      // Only the dock owns activity tracking. The header is a passive subscriber.
      React.useEffect(() => {
        if (!blank) return controller.mount(sessionId, { document, window }, () => {})
      }, [controller, sessionId, blank])
      if (blank || !(state.busy || state.error || state.recap)) return null
      const h = React.createElement
      return h('aside', { 'aria-label': 'Session recap', className: 'dsh-session-recap-card' },
        state.busy ? h('p', { role: 'status', className: 'dsh-session-recap-card__loading' }, 'Generating recap…') : null,
        state.error ? h('p', { role: 'alert', className: 'dsh-session-recap-card__error' }, state.error) : null,
        state.recap ? h('div', { role: state.busy ? undefined : 'status', tabIndex: 0, 'aria-label': 'Recap content', className: 'dsh-session-recap-card__body' },
          h('ul', { className: 'dsh-session-recap-card__list' }, ...state.recap.bullets.map((bullet, index) => h('li', { key: index, className: 'dsh-session-recap-card__row' }, bullet)))) : null)
    }
    // Match DSH's settings-card metrics using public theme tokens, not private CSS-module names.
    const settingsStyles = `
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
        const load = async () => {
          try {
            const result = await rpc.call(CHANNEL, 'settings', {})
            if (!result.ok) throw new Error(result.error.message)
            if (alive) setDraft(result.value)
          } catch (error) { if (alive) setError(error.message || String(error)) }
        }
        void load()
        rpc.call(CHANNEL, 'models', {}).then((result) => {
          if (!alive) return
          if (result.ok) setProviders(result.value.providers)
          else setNotice('Model catalog unavailable. You can enter an exact route below.')
        }, () => { if (alive) setNotice('Model catalog unavailable. You can enter an exact route below.') })
        return () => { alive = false; style?.remove() }
      }, [rpc])
      const change = (key, value) => setDraft((draft) => ({ ...draft, [key]: value }))
      const save = async () => {
        setBusy(true); setError(''); setNotice('')
        try {
          const { autoRecap, inactivityMinutes, provider, model } = draft
          const result = await rpc.call(CHANNEL, 'configure', { autoRecap, inactivityMinutes: Number(inactivityMinutes), provider, model })
          if (!result.ok) throw new Error(result.error.message)
          setDraft(result.value)
          controller.invalidateSettings()
          setNotice('Session recap settings saved.')
        } catch (error) { setError(error.message || String(error)) }
        finally { setBusy(false) }
      }
      const row = (label, input) => h('label', { className: 'dsh-session-recap-settings__row' }, label, input)
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
          row('Inactivity (minutes)', h('input', { type: 'number', min: 1, value: draft.inactivityMinutes, disabled: busy, onChange: (event) => change('inactivityMinutes', event.target.value) })),
          row('Available models', h('select', { value: '', disabled: busy || providers.length === 0, onChange: (event) => { if (event.target.value) { const [provider, model] = JSON.parse(event.target.value); setDraft((draft) => ({ ...draft, provider, model })) } } },
            h('option', { value: '' }, 'Choose a model…'),
            ...providers.map((provider) => h('optgroup', { key: provider.id, label: provider.name || provider.id }, ...provider.models.map((model) => h('option', { key: model.id, value: JSON.stringify([provider.id, model.id]) }, model.name || model.id)))))),
          row('Provider ID', h('input', { value: draft.provider || '', disabled: busy, onChange: (event) => change('provider', event.target.value) })),
          row('Model ID', h('input', { value: draft.model || '', disabled: busy, onChange: (event) => change('model', event.target.value) })),
          h('small', { className: 'dsh-session-recap-settings__hint' }, 'The catalog is advisory. You can enter an exact provider and model route. Saving validates the route without generating a recap.'),
          h('div', { className: 'dsh-session-recap-settings__footer' },
            h('button', { type: 'button', className: 'dsh-session-recap-settings__save', disabled: busy, onClick: () => { void save() } }, busy ? 'Saving…' : 'Save'))) : h('span', null, 'Loading settings…'),
        error ? h('p', { role: 'alert' }, error) : null,
        notice ? h('p', { role: 'status' }, notice) : null) : null)
    }
    function apply(ctx) {
      let storage
      try { storage = window.localStorage } catch {}
      const controller = createController({ rpc: ctx.get('connection').rpc, storage })
      // DSH emits this only after a durable human-authored user/message.
      ctx.get('remote').$on('api-session/activity', (sessionId) => controller.humanMessageSent(sessionId))
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock', id: ID, order: 10,
        inject: (sessionId) => ({ sessionId, controller }),
      }, RecapCard))
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities', id: `${ID}-action`, order: 10,
        inject: (sessionId) => ({ sessionId, controller }),
      }, RecapAction))
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item', key: ID, inject: () => ({ rpc: ctx.get('connection').rpc, controller }),
      }, SettingsCard))
    }
    return { inject: ['slots', 'connection', 'remote'], apply, createController, RecapCard, RecapAction, SettingsCard, CHANNEL }
  },
})
