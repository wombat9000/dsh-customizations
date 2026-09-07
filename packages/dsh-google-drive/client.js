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
    function Card({ sessionId, callId, picker, request = api }) {
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
            const value = await request('status', { sessionId, callId }, controller.signal)
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
          const value = await request(method, { sessionId, callId, ...(method === 'deny' && status?.requestId ? { requestId: status.requestId } : {}) }, mutation.current.signal)
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
        picker.open({ owner, sessionId, callId, status: value, request, onChanged: () => refresh() })
      }
      const stateLabel = status?.state === 'granted' ? 'Read access allowed'
        : status?.state === 'none' ? 'Waiting for request' : `Request ${status?.state}`
      return h('section', { className: 'gd-access gd-card', 'aria-label': 'Google Drive access' },
        h('style', null, css),
        h('div', { className: 'gd-card-title' }, icon('drive'),
          h('strong', null, 'Google Drive · Read-only access')),
        typeof status?.reason === 'string' && h('p', null, status.reason),
        h('p', { className: 'gd-muted' },
          'Choose what this session can read. Browsing and unselected items stay private.'),
        !status && !error && h('p', { role: 'status' }, 'Checking access…'),
        error && h('p', { role: 'alert' }, error),
        status?.state === 'pending'
          ? h('div', { className: 'gd-actions' },
            button('Choose files and folders', () => open(), busy),
            button('Deny', () => act('deny'), busy))
          : status && h(React.Fragment, null,
            h('p', null, `${stateLabel} · ${status.grants.length} selected items`),
            h('div', { className: 'gd-actions' }, button('Manage access', () => act('manage'), busy))),
        error && button('Refresh', () => refresh(), busy))
    }
    function Picker({ entry, close }) {
      const { sessionId, callId, status, request, onChanged } = entry
      const [selected, setSelected] = React.useState(() => new Map(status.grants.map(item => [item.id, item])))
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
        request('browse', body, controller.signal).then(value => {
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
          const body = method === 'revoke' ? { sessionId, callId } : { ...identity, selected: [...selected.values()].map(item => ({ id: item.id, recursive: item.recursive === true })) }
          const value = await request(method, body, mutation.current.signal)
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
        'aria-label': 'Choose Google Drive access',
        onCancel: event => { event.preventDefault(); cancel() },
      },
      h('style', null, css),
      h('div', { className: 'gd-main' },
      h('header', { className: 'gd-header' },
        h('span', { className: 'gd-drive-mark' }, icon('drive')),
        h('div', { className: 'gd-header-copy' },
          h('h2', null, 'Choose files and folders'),
          h('p', { className: 'gd-muted' }, 'Google Drive · Read-only · This session only')),
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
            checked, disabled: busy, onChange: event => toggle(item, event.target.checked),
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
        status.grants.length > 0 && button('Revoke all access', () => mutate('revoke'), busy)),
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
          }, 'Allow read access'))))
    }
    function Overlay({ picker }) {
      const entry = React.useSyncExternalStore(picker.subscribe, picker.getSnapshot)
      return entry ? h(Picker, { key: `${entry.sessionId}:${entry.callId}:${entry.status.requestId}`, entry, close: picker.close }) : null
    }
    return { inject: ['slots'], api, validStatus, createPickerStore, Card, Picker, Overlay,
      apply(ctx) {
        const picker = createPickerStore()
        ctx.effect(() => () => picker.close())
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'request_drive_access', inject: () => ({ picker }) }, Card))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'google-drive-access', inject: () => ({ picker }) }, Overlay))
      },
    }
  },
})
