window.__ModuleLoader__.load({
  id: '@local/dsh-google-drive',
  factory: require => {
    const React = require('react')
    const h = React.createElement
    const FOLDER = 'application/vnd.google-apps.folder'
    async function api(method, body, signal) {
      let response, result
      try {
        response = await window.fetch(`/api/plugins/google-drive/${method}`, {
          method: 'POST', credentials: 'same-origin', signal,
          headers: { 'Content-Type': 'application/json', 'X-DSH-Google-Drive': '1' }, body: JSON.stringify(body),
        })
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        throw new Error('Cannot reach DSH. Check your connection and retry.')
      }
      try { result = await response.json() } catch { throw new Error('DSH returned an unreadable Drive response. Retry.') }
      if (!response.ok || result?.ok !== true) throw new Error('Drive access could not be updated. Refresh and check your Google connection, then retry.')
      return result.value
    }
    function validSessionStatus(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      if (value.available === false) return value.enabled === false && value.ownerId === undefined && value.revision === undefined
      return value.available === true && typeof value.enabled === 'boolean'
        && typeof value.ownerId === 'string' && value.ownerId.length > 0
        && Number.isSafeInteger(value.revision) && value.revision >= 0
    }
    function SessionToggle({ sessionId, useSession, api: request = api }) {
      const blank = useSession ? useSession(session => session.blank) : false
      return h(SessionToggleState, { key: `${sessionId}:${blank === true}`, sessionId, request })
    }
    function SessionToggleState({ sessionId, request }) {
      const [view, setView] = React.useState({ status: null, busy: true, error: '' })
      const machine = React.useRef(null)
      React.useEffect(() => {
        const state = { live: true, busy: false, status: null, controller: null, timer: null }
        machine.current = state
        const publish = error => { if (state.live) setView({ status: state.status, busy: state.busy, error }) }
        const accept = value => {
          if (!validSessionStatus(value)) throw new Error('Invalid session status. Refresh status before changing Google Drive.')
          if (value.available && state.status?.available && value.ownerId === state.status.ownerId && (value.revision < state.status.revision || (value.revision === state.status.revision && value.enabled !== state.status.enabled))) throw new Error('Session status is stale. Refresh status.')
          state.status = value
        }
        state.load = async (notice = '', background = false) => {
          if (!state.live || state.busy) return
          clearTimeout(state.timer)
          state.controller?.abort()
          const controller = new AbortController()
          state.controller = controller
          const current = () => state.live && state.controller === controller
          state.busy = !background
          if (!background) publish(notice)
          try {
            const value = sessionId ? await request('session-status', { sessionId }, controller.signal) : { available: false, enabled: false }
            if (!current()) return
            accept(value); state.blocked = false; publish(notice)
          } catch (error) {
            if (!current()) return
            state.blocked = true; publish('Cannot confirm Google Drive session status. Retry status check.')
          } finally {
            if (current()) {
              state.busy = false
              setView(previous => ({ ...previous, status: state.status, busy: false }))
              state.timer = setTimeout(() => state.load('', true), 3000)
            }
          }
        }
        state.toggle = async () => {
          if (!state.live || state.busy || state.blocked || !state.status?.available) return
          clearTimeout(state.timer)
          const previous = state.status
          // A user action supersedes an in-flight background read. Its late
          // response must not replace the mutation's authoritative status.
          state.controller?.abort()
          state.busy = true; publish('')
          state.controller = new AbortController()
          try {
            const value = await request('session-set', { sessionId, ownerId: previous.ownerId, revision: previous.revision, enabled: !previous.enabled }, state.controller.signal)
            if (!state.live) return
            if (!validSessionStatus(value) || (value.available && (value.ownerId !== previous.ownerId || value.revision <= previous.revision || value.enabled !== !previous.enabled))) throw new Error('Unconfirmed mutation')
            accept(value); state.busy = false; publish('')
            state.timer = setTimeout(() => state.load('', true), 3000)
          } catch {
            if (!state.live) return
            state.blocked = true; state.busy = false
            await state.load('Change could not be confirmed. Checking authoritative status; no change is retried.')
          }
        }
        void state.load()
        return () => { state.live = false; state.controller?.abort(); clearTimeout(state.timer) }
      }, [sessionId, request])
      const disabled = view.busy || !view.status?.available || machine.current?.blocked
      return h('div', { className: 'gd-session-toggle' }, h('style', null, `
        .gd-session-toggle { position:relative; display:inline-flex; flex-wrap:wrap; max-width:100%; align-items:center; gap:6px; font:12px/1.4 var(--dsw-font-family,system-ui); color:var(--dsw-alias-label-secondary); }
        .gd-session-toggle button { font:inherit; color:inherit; cursor:pointer; border:1px solid var(--dsw-alias-border-l2); background:transparent; border-radius:7px; padding:5px 8px; }
        .gd-session-toggle button:disabled { cursor:default; opacity:.55; }
        .gd-session-toggle button:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
        .gd-session-toggle [role=switch] { display:inline-flex; align-items:center; gap:7px; white-space:nowrap; }
        .gd-session-toggle [aria-checked=true] { color:var(--dsw-alias-brand-primary); }
        .gd-toggle-track { width:24px; height:14px; border-radius:9px; background:var(--dsw-alias-border-l2); padding:2px; }
        .gd-toggle-track::after { content:''; display:block; width:10px; height:10px; border-radius:50%; background:var(--dsw-alias-label-secondary); }
        [aria-checked=true] .gd-toggle-track { background:var(--dsw-alias-brand-primary); }
        [aria-checked=true] .gd-toggle-track::after { transform:translateX(10px); background:var(--dsw-alias-bg-layer-1); }
        .gd-toggle-message { width:min(280px,80vw); padding:10px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-1); }
      `), h('button', { type: 'button', role: 'switch', 'aria-label': 'Google Drive', 'aria-checked': view.status?.enabled === true, disabled,
        title: view.status?.available === false ? 'Start or resume this session to enable Google Drive' : 'Enable Drive and Sheets tools for this session', onClick: () => machine.current?.toggle() },
        h('span', { className: 'gd-toggle-track', 'aria-hidden': true }), 'Google Drive'),
        h('span', { role: 'status', style: { fontSize: 11 } }, view.busy ? 'Checking…' : !view.status?.available ? 'Unavailable' : ''),
        h('span', { title: 'Enabling grants no file access. Turning OFF revokes session grants, cancels requests and previews, and removes tools. It cannot undo dispatched writes.', 'aria-label': 'Enabling grants no file access. Turning OFF revokes session grants, cancels requests and previews, and removes tools. It cannot undo dispatched writes.', tabIndex: 0 }, 'ⓘ'),
        view.error && h('div', { className: 'gd-toggle-message', role: 'alert' }, view.error, ' ', h('button', { type: 'button', disabled: view.busy, onClick: () => machine.current?.load() }, 'Retry status check')))
    }
    function validStatus(value) {
      return value && ['pending', 'granted', 'denied', 'cancelled', 'none'].includes(value.state)
        && Array.isArray(value.grants) && value.grants.every(item => typeof item.id === 'string' && typeof item.recursive === 'boolean')
        && (value.state !== 'pending' || typeof value.requestId === 'string')
    }
    function createPickerStore() {
      let value = null
      const listeners = new Set()
      const publish = next => { value = next; listeners.forEach(listener => listener()) }
      return { getSnapshot: () => value, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
        open: next => publish(next), close: () => publish(null), closeOwner: owner => { if (value?.owner === owner) publish(null) } }
    }
    // Alias tokens verified against the deployed dsh-client-ui-theme package.
    const css = `
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
    function icon(name) {
      const paths = {
        drive: 'M8 3h8l6 11-4 7H6l-4-7 6-11Zm0 0 10 18M16 3 6 21M2 14h20',
        search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
        close: 'm6 6 12 12M18 6 6 18',
        chevron: 'm9 5 7 7-7 7',
        down: 'm5 9 7 7 7-7',
        folder: 'M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z',
        document: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8M8 16h8',
        spreadsheet: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8v6H8v-6Zm4 0v6M8 15h8',
        presentation: 'M3 4h18v13H3V4Zm9 13v4m-4 0 4-4 4 4M7 8h10M7 12h6',
        image: 'M3 3h18v18H3V3Zm0 14 6-6 5 5 3-3 4 4M16 7h.01',
        pdf: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 13h8M8 17h5',
        file: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5',
      }
      return h('svg', {
        className: 'gd-icon', viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
      }, h('path', { d: paths[name] || paths.file }))
    }
    function fileType(item) {
      const mime = item.mimeType || ''
      if (mime === FOLDER || item.recursive) return ['folder', 'Folder']
      if (mime.includes('spreadsheet') || mime.includes('excel')) return ['spreadsheet', 'Spreadsheet']
      if (mime.includes('presentation') || mime.includes('powerpoint')) return ['presentation', 'Slides']
      if (mime.startsWith('image/')) return ['image', 'Image']
      if (mime === 'application/pdf') return ['pdf', 'PDF']
      if (mime.includes('document') || mime.startsWith('text/')) return ['document', 'Document']
      return ['file', 'File']
    }
    function fileIcon(item) {
      const [kind] = fileType(item)
      return h('span', { className: 'gd-file-icon', 'data-kind': kind }, icon(kind))
    }
    function iconButton(label, name, onClick, disabled = false) {
      return h('button', {
        type: 'button', className: 'gd-icon-button', 'aria-label': label,
        title: label, onClick, disabled,
      }, icon(name))
    }
    const button = (label, onClick, disabled = false) => h('button', { type: 'button', onClick, disabled }, label)
    function EditCard(props) { return h(Card, { ...props, mode: 'edit' }) }
    function Card({ sessionId, callId, picker, request = api, mode = 'read' }) {
      const editing = mode === 'edit'
      const endpoint = method => editing ? `edit-${method}` : method
      const [status, setStatus] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [revision, refresh] = React.useReducer(n => n + 1, 0)
      const generation = React.useRef(0)
      const acting = React.useRef(false)
      const mutation = React.useRef(null)
      const owner = React.useMemo(() => ({}), [sessionId, callId])
      const loadedOwner = React.useRef(null)
      React.useEffect(() => {
        const token = ++generation.current
        const controller = new AbortController()
        let timer, failures = 0
        if (loadedOwner.current !== owner) { setStatus(null); loadedOwner.current = owner }
        setError(''); setBusy(false); acting.current = false
        async function load() {
          if (generation.current !== token) return
          try {
            const value = await request(endpoint('status'), { sessionId, callId }, controller.signal)
            if (generation.current !== token) return
            if (!validStatus(value)) throw new Error('Invalid Drive status. Retry.')
            setStatus(value); setError(''); failures = 0
            if (value.state === 'pending') timer = setTimeout(load, 1500)
          } catch (err) {
            if (generation.current !== token || err.name === 'AbortError') return
            setError(err.message)
            // The tool card can mount before the host registers its request.
            // Bound retries so retained cards from an old runtime become inert.
            if (++failures <= 10) timer = setTimeout(load, 1500)
          }
        }
        void load()
        return () => { generation.current++; controller.abort(); mutation.current?.abort(); clearTimeout(timer); picker.closeOwner(owner) }
      }, [sessionId, callId, revision, request, picker, owner])
      async function act(method) {
        if (acting.current) return
        acting.current = true; setBusy(true); setError('')
        // Invalidate status reads before a mutation, including a pending poll.
        const token = ++generation.current
        mutation.current = new AbortController()
        try {
          const value = await request(endpoint(method), { sessionId, callId, ...(method === 'deny' && status?.requestId ? { requestId: status.requestId } : {}) }, mutation.current.signal)
          if (generation.current !== token) return
          if (!validStatus(value)) throw new Error('Invalid Drive status. Retry.')
          setStatus(value)
          if (method === 'manage') {
            if (value.state !== 'pending') throw new Error('Drive did not open an access request. Refresh and retry.')
            open(value)
          }
        } catch (err) { if (generation.current === token) setError(err.message) }
        finally { if (generation.current === token) { acting.current = false; setBusy(false) } }
      }
      function open(value = status) {
        picker.open({ owner, sessionId, callId, status: value, mode, request, onChanged: () => refresh() })
      }
      const stateLabel = status?.state === 'granted' ? (editing ? 'Session editing allowed' : 'Read access allowed')
        : status?.state === 'none' ? 'Waiting for request' : `Request ${status?.state}`
      return h('section', { className: 'gd-access gd-card', 'aria-label': editing ? 'Google Sheets edit access' : 'Google Drive access' },
        h('style', null, css),
        h('div', { className: 'gd-card-title' }, icon('drive'),
          h('strong', null, editing ? 'Google Sheets · Session edit access' : 'Google Drive · Read-only access')),
        typeof status?.reason === 'string' && h('p', null, status.reason),
        h('p', { className: 'gd-muted' },
          editing ? 'Choose spreadsheets this session may edit. Every change needs a separate preview approval. Google account-level write consent persists beyond this session; DSH restricts selected files.' : 'Choose what this session can read. Browsing and unselected items stay private.'),
        !status && !error && h('p', { role: 'status' }, 'Checking access…'),
        error && h('p', { role: 'alert' }, error),
        status?.state === 'pending'
          ? h('div', { className: 'gd-actions' },
            button(editing ? 'Choose spreadsheets' : 'Choose files and folders', () => open(), busy),
            button('Deny', () => act('deny'), busy))
          : status && h(React.Fragment, null,
            h('p', null, `${stateLabel} · ${status.grants.length} selected items`),
            h('div', { className: 'gd-actions' }, button('Manage access', () => act('manage'), busy))),
        error && button('Refresh', () => refresh(), busy))
    }
    function Picker({ entry, close }) {
      const { sessionId, callId, status, request, onChanged } = entry
      const editing = entry.mode === 'edit' || status.mode === 'edit'
      const endpoint = method => editing ? `edit-${method}` : method
      const [selected, setSelected] = React.useState(() => new Map(status.grants.filter(item => !editing || !item.recursive).map(item => [item.id, item])))
      const [path, setPath] = React.useState([])
      const [reviewOpen, setReviewOpen] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const [search, setSearch] = React.useState('')
      const [pageToken, setPageToken] = React.useState(undefined)
      const [listing, setListing] = React.useState(null)
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [revision, retry] = React.useReducer(n => n + 1, 0)
      const dialog = React.useRef(null)
      const alive = React.useRef(true)
      const acting = React.useRef(false)
      const generation = React.useRef(0)
      const mutation = React.useRef(null)
      const identity = { sessionId, callId, requestId: status.requestId }
      React.useEffect(() => {
        alive.current = true
        const previous = document.activeElement
        dialog.current.showModal()
        return () => { alive.current = false; generation.current++; mutation.current?.abort(); dialog.current?.close(); previous?.focus?.() }
      }, [])
      const parentId = path.at(-1)?.id || 'root'
      React.useEffect(() => {
        const token = ++generation.current
        const controller = new AbortController()
        setLoading(true); setListing(null); setError('')
        // Name search is global; browsing always names an explicit parent.
        const body = {
          ...identity,
          ...(search ? { search } : { parentId }),
          ...(pageToken ? { pageToken } : {}),
        }
        request(endpoint('browse'), body, controller.signal).then(value => {
          if (!alive.current || token !== generation.current) return
          if (!Array.isArray(value?.files) || !value.files.every(item => typeof item.id === 'string' && typeof item.name === 'string' && typeof item.mimeType === 'string') || (value.nextPageToken !== undefined && typeof value.nextPageToken !== 'string')) throw new Error('Invalid Drive listing. Retry.')
          setListing(value)
        }).catch(err => { if (alive.current && token === generation.current && err.name !== 'AbortError') setError(err.message) })
          .finally(() => { if (alive.current && token === generation.current) setLoading(false) })
        return () => controller.abort()
      }, [parentId, search, pageToken, revision])
      async function mutate(method) {
        if (acting.current) return
        acting.current = true; setBusy(true); setError('')
        mutation.current = new AbortController()
        try {
          const body = method === 'revoke' ? { sessionId, callId } : { ...identity, selected: [...selected.values()].map(item => ({ id: item.id, recursive: editing ? false : item.recursive === true })) }
          const value = await request(endpoint(method), body, mutation.current.signal)
          if (!alive.current) return
          if (!validStatus(value)) throw new Error('Invalid Drive status. Refresh to check access.')
          onChanged(); close()
        } catch (err) { if (alive.current && err.name !== 'AbortError') setError(err.message) }
        finally { if (alive.current) { acting.current = false; setBusy(false) } }
      }
      function cancel() {
        if (acting.current) return
        // Resume status polling after Manage and recover one-shot failed grants.
        // This only refreshes the card; it does not deny or grant permission.
        onChanged()
        close()
      }
      function navigate(next) {
        setPath(next); setSearch(''); setDraft(''); setPageToken(undefined)
      }
      function remove(id) {
        setSelected(current => {
          const next = new Map(current)
          next.delete(id)
          return next
        })
      }
      function toggle(item, checked) {
        if (editing && item.mimeType !== 'application/vnd.google-apps.spreadsheet') return
        setSelected(current => {
          const next = new Map(current)
          if (checked) next.set(item.id, { ...item, recursive: item.mimeType === FOLDER })
          else next.delete(item.id)
          return next
        })
      }
      const selectedItems = [...selected.values()]
      const hasFolders = selectedItems.some(item => item.recursive)
      return h('dialog', {
        ref: dialog, className: 'gd-access gd-modal',
        'aria-label': editing ? 'Choose Google Sheets edit access' : 'Choose Google Drive access',
        onCancel: event => { event.preventDefault(); cancel() },
      },
      h('style', null, css),
      h('div', { className: 'gd-main' },
      h('header', { className: 'gd-header' },
        h('span', { className: 'gd-drive-mark' }, icon('drive')),
        h('div', { className: 'gd-header-copy' },
          h('h2', null, editing ? 'Choose spreadsheets' : 'Choose files and folders'),
          h('p', { className: 'gd-muted' }, editing ? 'Session editing · Separate approval for every change. Google account write consent persists beyond this session.' : 'Google Drive · Read-only · This session only')),
        iconButton('Close picker', 'close', cancel, busy)),
      h('div', { className: 'gd-toolbar' },
        h('form', {
          className: 'gd-search', role: 'search',
          onSubmit: event => {
            event.preventDefault()
            setSearch(draft.trim()); setPageToken(undefined); retry()
          },
        },
        icon('search'),
        h('input', {
          type: 'search', 'aria-label': 'Search Drive', placeholder: 'Search all of Drive',
          value: draft, disabled: busy, onChange: event => setDraft(event.target.value),
        }),
        h('button', { type: 'submit', disabled: busy }, 'Search')),
        h('nav', { 'aria-label': 'Drive folders', className: 'gd-breadcrumbs' },
          h('button', {
            type: 'button', disabled: busy, onClick: () => navigate([]),
            'aria-current': !search && path.length === 0 ? 'location' : undefined,
          }, 'My Drive'),
          search
            ? h(React.Fragment, null, icon('chevron'),
              h('span', { 'aria-current': 'location', className: 'gd-muted' }, `Search results for “${search}”`))
            : path.map((item, index) => h(React.Fragment, { key: item.id },
              icon('chevron'),
              h('button', {
                type: 'button', disabled: busy,
                onClick: () => navigate(path.slice(0, index + 1)),
                'aria-current': index === path.length - 1 ? 'location' : undefined,
              }, item.name))))),
      h('div', { className: 'gd-column-head', 'aria-hidden': true },
        h('span', null, 'Name'), h('span', null, 'Type')),
      h('div', { className: 'gd-browser', 'aria-busy': loading },
        loading && h('div', { className: 'gd-empty', role: 'status' },
          icon('folder'), h('p', { className: 'gd-muted' }, 'Loading files…')),
        error && h('div', { className: 'gd-error' },
          h('p', { role: 'alert' }, error), button('Retry listing', () => retry(), busy)),
        listing?.files.length === 0 && h('div', { className: 'gd-empty' },
          icon(search ? 'search' : 'folder'),
          h('p', null, 'No files or folders found.'),
          h('p', { className: 'gd-muted' }, search ? 'Try a different name.' : 'Search Drive to find items elsewhere.')),
        h('ul', { 'aria-label': 'Files and folders' }, listing?.files.map(item => {
          const isFolder = item.mimeType === FOLDER
          const checked = selected.has(item.id)
          const checkboxId = `gd-file-${item.id}`
          return h('li', {
            key: item.id, className: `gd-file-row${checked ? ' gd-selected' : ''}`,
          },
          h('input', {
            id: checkboxId, type: 'checkbox', 'aria-label': item.name,
            checked, disabled: busy || (editing && item.mimeType !== 'application/vnd.google-apps.spreadsheet'), onChange: event => toggle(item, event.target.checked),
          }),
          fileIcon(item),
          isFolder
            ? h('button', {
              type: 'button', className: 'gd-file-name', title: item.name, disabled: busy,
              // A global search result has no known ancestry; do not invent one.
              onClick: () => navigate(search ? [item] : [...path, item]),
            }, item.name)
            : h('label', { htmlFor: checkboxId, className: 'gd-file-name', title: item.name }, item.name),
          h('span', { className: 'gd-file-type' }, fileType(item)[1]))
        })),
        listing?.nextPageToken && h('div', { className: 'gd-pagination' },
          button('Next page', () => setPageToken(listing.nextPageToken), busy))),
      (selected.size > 0 || status.grants.length > 0) && h('section', {
        className: 'gd-selection', 'aria-label': 'Selection review',
      },
      h('div', { className: 'gd-selection-top' },
        selected.size > 0 ? h('button', {
          type: 'button', 'aria-expanded': reviewOpen, disabled: busy,
          onClick: () => setReviewOpen(value => !value),
        }, icon(reviewOpen ? 'down' : 'chevron'), `Review selection (${selected.size})`) : h('span'),
        status.grants.length > 0 && button(editing ? 'Remove all session edit access' : 'Revoke all access', () => mutate('revoke'), busy)),
      hasFolders && h('p', { className: 'gd-selection-note' },
        'Selected folders include all files and subfolders, including items added later.'),
      selected.size > 0 && reviewOpen && h('ul', { className: 'gd-tray', 'aria-label': 'Selected access' },
        selectedItems.map(item => h('li', { key: item.id },
          fileIcon(item),
          h('span', { className: 'gd-file-name', title: item.name || item.id }, item.name || item.id),
          h('span', { className: 'gd-file-type' }, item.recursive ? 'All descendants' : 'This file'),
          iconButton(`Remove ${item.name || item.id}`, 'close', () => remove(item.id), busy)))))),
      h('footer', { className: 'gd-footer' },
        h('div', { className: 'gd-footer-count' },
          h('span', { role: 'status' }, busy ? 'Saving access…' : `${selected.size} selected`),
          h('p', null, status.grants.length > 0 ? 'Replaces current session access' : 'Only selected items are shared')),
        h('div', { className: 'gd-footer-actions' },
          button('Cancel', cancel, busy),
          h('button', {
            type: 'button', className: 'gd-primary', disabled: busy || selected.size === 0,
            onClick: () => mutate('grant'),
          }, editing ? 'Allow editing for this session' : 'Allow read access'))))
    }
    const previewCSS = `
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
    const previewStates = ['preparing', 'pending', 'applying', 'applied', 'denied', 'cancelled', 'expired', 'stale', 'failed', 'uncertain']
    function validPreviewStatus(value) {
      if (!value || !previewStates.includes(value.state) || typeof value.requestId !== 'string') return false
      if (value.state !== 'pending' && !value.preview) return true
      const p = value.preview
      if (!p || typeof p.fileId !== 'string' || typeof p.range !== 'string' || typeof p.tab?.title !== 'string') return false
      const validCells = snapshot => Array.isArray(snapshot?.cells) && snapshot.cells.length <= 200
        && snapshot.cells.every(c => typeof c.cell === 'string' && /^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(c.cell))
        && new Set(snapshot.cells.map(c => c.cell)).size === snapshot.cells.length
        && new Set(snapshot.cells.map(c => c.cell.match(/^[A-Z]+/)[0])).size <= 20
        && new Set(snapshot.cells.map(c => c.cell.match(/[0-9]+$/)[0])).size <= 100
      return validCells(p.before) && validCells(p.after)
        && p.before.cells.length === p.after.cells.length
        && p.before.cells.every((c, i) => c.cell === p.after.cells[i].cell)
    }
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
    function cellText(cell) {
      const value = cell.userEnteredValue
      if (typeof value?.formulaValue === 'string') return value.formulaValue
      if (typeof value?.stringValue === 'string') return value.stringValue
      if (typeof value?.numberValue === 'number') return String(value.numberValue)
      if (typeof value?.boolValue === 'boolean') return value.boolValue ? 'TRUE' : 'FALSE'
      return ''
    }
    function exactValue(cell) {
      const value = cell.userEnteredValue
      if (value == null) return { type: 'Empty cell', text: '(no value)' }
      if (typeof value.stringValue === 'string') return { type: value.stringValue === '' ? 'Empty string' : 'Text', text: JSON.stringify(value.stringValue) }
      if (typeof value.numberValue === 'number') return { type: 'Number', text: String(value.numberValue) }
      if (typeof value.boolValue === 'boolean') return { type: 'Boolean', text: value.boolValue ? 'TRUE' : 'FALSE' }
      if (typeof value.formulaValue === 'string') return { type: 'Formula · result not predicted', text: JSON.stringify(value.formulaValue) }
      return { type: 'Empty cell', text: '(no value)' }
    }
    function colorCSS(value) {
      if (!value || typeof value !== 'object') return undefined
      const channels = ['red', 'green', 'blue'].map(key => value[key] ?? 0)
      if (!channels.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return undefined
      return `rgb(${channels.map(n => Math.round(n * 255)).join(', ')})`
    }
    function cellStyle(format = {}) {
      format = format || {}
      const text = format.textFormat || {}, style = {}
      const bg = colorCSS(format.backgroundColorStyle?.rgbColor || format.backgroundColor), fg = colorCSS(text.foregroundColorStyle?.rgbColor || text.foregroundColor)
      if (text.underline || text.strikethrough) style.textDecoration = [text.underline && 'underline', text.strikethrough && 'line-through'].filter(Boolean).join(' ')
      // Keep every value readable even when the proposed wrap strategy clips text.
      if (bg) style.backgroundColor = bg
      if (fg) style.color = fg
      if (typeof text.bold === 'boolean') style.fontWeight = text.bold ? 'bold' : 'normal'
      if (typeof text.italic === 'boolean') style.fontStyle = text.italic ? 'italic' : 'normal'
      if (Number.isFinite(text.fontSize) && text.fontSize >= 6 && text.fontSize <= 72) style.fontSize = `${text.fontSize}pt`
      if (typeof text.fontFamily === 'string' && /^[a-zA-Z0-9 -]{1,80}$/.test(text.fontFamily)) style.fontFamily = text.fontFamily
      if (['LEFT', 'CENTER', 'RIGHT'].includes(format.horizontalAlignment)) style.textAlign = format.horizontalAlignment.toLowerCase()
      if (['TOP', 'MIDDLE', 'BOTTOM'].includes(format.verticalAlignment)) style.verticalAlign = format.verticalAlignment.toLowerCase()
      const borderStyles = { SOLID: '1px solid', SOLID_MEDIUM: '2px solid', SOLID_THICK: '3px solid', DOTTED: '1px dotted', DASHED: '1px dashed', DOUBLE: '3px double', NONE: '0 solid' }
      for (const side of ['top', 'bottom', 'left', 'right']) {
        const border = format.borders?.[side]
        if (borderStyles[border?.style]) style[`border${side[0].toUpperCase()}${side.slice(1)}`] = `${borderStyles[border.style]} ${colorCSS(border.colorStyle?.rgbColor || border.color) || '#202124'}`
      }
      return style
    }
    function formatFields(value, prefix = '', depth = 0) {
      if (depth > 5 || !value || typeof value !== 'object') return []
      if (prefix && Object.keys(value).length === 0) return [[prefix, /(?:Color|rgbColor)$/.test(prefix) ? '{} (RGB default black)' : '{} (empty object)']]
      return Object.entries(value).flatMap(([key, item]) => {
        const name = prefix ? `${prefix}.${key}` : key
        if (item && typeof item === 'object' && !Array.isArray(item)) return formatFields(item, name, depth + 1)
        return [[name, String(item)]]
      })
    }
    function formatLabel(path) {
      return path.split('.').map(part => part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())).join(' › ')
    }
    function FormatDiff({ before, after }) {
      const a = new Map(formatFields(before)), b = new Map(formatFields(after))
      return h('dl', { className: 'gs-fields' }, [...new Set([...a.keys(), ...b.keys()])].filter(key => a.get(key) !== b.get(key)).map(key => h(React.Fragment, { key },
        h('dt', null, formatLabel(key)), h('dd', null, `${a.get(key) ?? 'Default / unset'} → ${b.get(key) ?? 'Default / unset'}`))))
    }
    function Grid({ label, cells, changed }) {
      const columns = [...new Set(cells.map(c => c.cell.match(/^[A-Z]+/)[0]))]
      const rows = [...new Set(cells.map(c => c.cell.match(/[0-9]+$/)[0]))]
      const lookup = new Map(cells.map(c => [c.cell, c]))
      return h('section', { className: 'gs-grid', 'aria-label': label }, h('h3', null, label),
        h('div', { className: 'gs-table-scroll', tabIndex: 0, role: 'region', 'aria-label': `${label} grid, scroll to review all columns` },
          h('table', null, h('thead', null, h('tr', null, h('th'), columns.map(col => h('th', { key: col, scope: 'col' }, col)))),
            h('tbody', null, rows.map(row => h('tr', { key: row }, h('th', { scope: 'row' }, row), columns.map(col => {
              const cell = lookup.get(`${col}${row}`)
              return h('td', { key: col, style: cellStyle(cell?.userEnteredFormat), 'data-changed': changed.has(`${col}${row}`) }, cell ? cellText(cell) : '')
            })))))))
    }
    function PreviewDialog({ status, busy, error, act, close }) {
      const dialog = React.useRef(null)
      React.useEffect(() => { const previous = document.activeElement; dialog.current.showModal(); return () => { dialog.current?.close(); previous?.focus?.() } }, [])
      const p = status.preview
      const changes = p.before.cells.map((before, i) => ({ before, after: p.after.cells[i] })).filter(({ before, after }) => !same(before.userEnteredValue, after.userEnteredValue) || !same(before.userEnteredFormat, after.userEnteredFormat))
      const changed = new Set(changes.map(c => c.before.cell))
      const cleared = changes.filter(c => c.before.userEnteredValue != null && c.after.userEnteredValue == null).length
      const formulas = changes.filter(c => !same(c.before.userEnteredValue, c.after.userEnteredValue) && typeof c.after.userEnteredValue?.formulaValue === 'string').length
      const formats = changes.filter(c => !same(c.before.userEnteredFormat, c.after.userEnteredFormat)).length
      return h('dialog', { ref: dialog, className: 'gd-access gd-modal gs-preview', 'aria-label': 'Review spreadsheet changes', onCancel: e => { e.preventDefault(); if (!busy) close() } },
        h('style', null, css + previewCSS),
        h('header', { className: 'gd-header' }, h('span', { className: 'gd-drive-mark' }, icon('spreadsheet')),
          h('div', { className: 'gd-header-copy' }, h('h2', null, 'Review spreadsheet changes'), h('p', null, `${typeof p.fileName === 'string' ? p.fileName : 'Spreadsheet'} · ${p.tab.title} · ${p.range}`)), iconButton('Close preview', 'close', close, busy)),
        h('div', { className: 'gs-body' },
          h('p', { className: 'gd-muted' }, `Spreadsheet ID: ${p.fileId}`),
          h('p', null, `${changes.length} changed cells · ${cleared} cleared · ${formulas} new or changed formulas · ${formats} formatting changes`),
          h('p', { className: 'gd-muted' }, 'Approximate local preview. Raw values and formula text are shown, not calculated results or formatted number displays. Fonts, wrapping, themes, conditional formatting and rich text may differ in Google Sheets. Exact changes below are authoritative.'),
          h('p', { className: 'gd-muted' }, 'DSH checks for changes before applying, but another editor can still change the spreadsheet between that check and the write.'),
          h('div', { className: 'gs-grids' }, h(Grid, { label: 'Before', cells: p.before.cells, changed }), h(Grid, { label: 'After', cells: p.after.cells, changed })),
          h('h3', null, 'Exact changes'),
          h('p', { className: 'gd-muted' }, 'Text and formulas use quoted JSON notation: spaces are preserved and control characters are escaped. Types distinguish text, numbers, booleans and empty cells.'),
          changes.map(({ before, after }) => h('section', { className: 'gs-detail', key: before.cell, 'aria-label': `Changes to ${before.cell}` },
            h('strong', null, before.cell),
            !same(before.userEnteredValue, after.userEnteredValue) && h('div', { className: 'gs-pair' }, ...[before, after].map((cell, i) => h('div', { key: i }, h('p', null, i ? 'After' : 'Before'), h('div', { className: 'gs-value' }, exactValue(cell).text), h('p', { className: 'gd-muted' }, `${exactValue(cell).type}${i && before.userEnteredValue != null && cell.userEnteredValue == null ? ' · Clear cell value' : ''}`)))),
            h(FormatDiff, { before: before.userEnteredFormat, after: after.userEnteredFormat }))),
          error && h('p', { role: 'alert' }, error), h('p', { role: 'status' }, `Status: ${status.state}`)),
        h('footer', { className: 'gd-footer' }, h('div', { className: 'gd-footer-count' }, 'Only this exact proposal', h('p', null, 'No Google writes until you apply.')),
          h('div', { className: 'gd-footer-actions' }, status.state === 'pending' ? h(React.Fragment, null,
            button('Cancel proposal', () => act('preview-deny'), busy),
            h('button', { type: 'button', className: 'gd-primary', disabled: busy, onClick: () => act('preview-apply') }, 'Apply changes')) : button('Close', close, busy))))
    }
    function PreviewCard({ sessionId, callId, request = api }) {
      const [status, setStatus] = React.useState(null), [error, setError] = React.useState(''), [open, setOpen] = React.useState(false), [busy, setBusy] = React.useState(false)
      const [revision, refresh] = React.useReducer(n => n + 1, 0)
      const generation = React.useRef(0), acting = React.useRef(false), mutation = React.useRef(null)
      React.useEffect(() => {
        const token = ++generation.current, controller = new AbortController()
        let timer, failures = 0
        setStatus(null); setOpen(false); setError(''); setBusy(false); acting.current = false
        async function load() {
          if (generation.current !== token) return
          try {
            const value = await request('preview-status', { sessionId, callId }, controller.signal)
            if (generation.current !== token) return
            if (!validPreviewStatus(value)) throw new Error('Invalid spreadsheet preview. Approval is unavailable.')
            setStatus(value); setError(''); failures = 0
            if (['preparing', 'pending', 'applying'].includes(value.state)) timer = setTimeout(load, 1500)
          } catch (err) {
            if (generation.current !== token || err.name === 'AbortError') return
            setError(err.message)
            if (++failures <= 10) timer = setTimeout(load, 1500)
          }
        }
        void load()
        return () => { generation.current++; controller.abort(); mutation.current?.abort(); clearTimeout(timer) }
      }, [sessionId, callId, request, revision])
      async function act(method) {
        if (acting.current || (status?.state !== 'pending' && !(method === 'preview-deny' && status?.state === 'preparing'))) return
        acting.current = true; setBusy(true); setError('')
        const token = ++generation.current
        mutation.current = new AbortController()
        try {
          const value = await request(method, { sessionId, callId, requestId: status.requestId }, mutation.current.signal)
          if (generation.current !== token) return
          if (!validPreviewStatus(value)) throw new Error('Invalid write response.')
          setStatus(value)
        } catch (err) {
          if (generation.current !== token) return
          // A lost response must never re-enable Apply; only an authoritative new proposal can do that.
          setStatus(previous => ({ ...previous, state: method === 'preview-apply' ? 'uncertain' : 'cancelled' }))
          setError(method === 'preview-apply' ? 'Write outcome is unknown. Do not retry this proposal. Inspect the spreadsheet before proposing another change.' : 'Cancellation could not be confirmed. No write was requested by this action.')
        } finally { if (generation.current === token) { acting.current = false; setBusy(false) } }
      }
      async function checkOutcome() {
        if (acting.current) return
        acting.current = true; setBusy(true)
        const token = ++generation.current
        mutation.current = new AbortController()
        try {
          const value = await request('preview-status', { sessionId, callId }, mutation.current.signal)
          if (generation.current !== token) return
          if (!validPreviewStatus(value) || value.requestId !== status.requestId) throw new Error('Cannot confirm this proposal outcome.')
          if (!['preparing', 'pending', 'applying'].includes(value.state)) { setStatus(value); setError('') }
          else setError('The outcome is not confirmed yet. Check status again later; do not resubmit the write.')
        } catch { if (generation.current === token) setError('Cannot confirm the outcome. Check status again later; do not resubmit the write.') }
        finally { if (generation.current === token) { acting.current = false; setBusy(false) } }
      }
      return h('section', { className: 'gd-access gd-card', 'aria-label': 'Google Sheets edit proposal' }, h('style', null, css),
        h('div', { className: 'gd-card-title' }, icon('spreadsheet'), h('strong', null, 'Google Sheets · Proposed changes')),
        h('p', { role: 'status' }, status ? `Status: ${status.state}` : 'Preparing preview…'),
        status?.state === 'uncertain' && h('p', { role: 'alert' }, 'The write outcome is uncertain. Do not retry. Inspect the spreadsheet before proposing another change.'),
        typeof status?.result?.message === 'string' && h('p', null, status.result.message),
        error && h('p', { role: 'alert' }, error),
        status?.preview && h('div', { className: 'gd-actions' }, button(status.state === 'pending' ? 'Review changes' : 'View proposal', () => setOpen(true), busy)),
        status?.state === 'preparing' && button('Cancel proposal', () => act('preview-deny'), busy),
        status?.state === 'uncertain' && button('Check outcome status', checkOutcome, busy),
        !status && error && button('Refresh status', () => refresh()),
        open && status?.preview && h(PreviewDialog, { status, busy, error, act, close: () => setOpen(false) }))
    }
    function Overlay({ picker }) {
      const entry = React.useSyncExternalStore(picker.subscribe, picker.getSnapshot)
      return entry ? h(Picker, { key: `${entry.sessionId}:${entry.callId}:${entry.status.requestId}`, entry, close: picker.close }) : null
    }
    return { inject: ['slots'], api, SessionToggle, validSessionStatus, validStatus, validPreviewStatus, cellStyle, createPickerStore, Card, EditCard, PreviewCard, PreviewDialog, Picker, Overlay,
      apply(ctx) {
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities', id: 'google-drive-session-toggle', order: 20,
          inject: sessionId => ({ sessionId, api }),
        }, SessionToggle))
        const picker = createPickerStore()
        ctx.effect(() => () => picker.close())
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'request_drive_access', inject: () => ({ picker }) }, Card))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'google-drive-access', inject: () => ({ picker }) }, Overlay))
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'request_sheets_edit_access', inject: () => ({ picker }) }, EditCard))
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'google_sheets_propose_edit' }, PreviewCard))
      },
    }
  },
})
