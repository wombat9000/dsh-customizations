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
    const css = `.gd-access{font:13px/1.5 system-ui,sans-serif;color:var(--dsw-alias-label-primary,inherit)}.gd-access button,.gd-access input[type=search]{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:7px;padding:7px 11px;background:var(--dsw-alias-bg-layer-1,transparent)}.gd-access button{cursor:pointer}.gd-access button:disabled{opacity:.5;cursor:default}.gd-access button:focus-visible,.gd-access input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#598be8);outline-offset:2px}.gd-card{padding:14px;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:10px}.gd-access p{margin:8px 0}.gd-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.gd-modal{pointer-events:auto;width:min(720px,calc(100vw - 32px));max-height:calc(100dvh - 40px);box-sizing:border-box;overflow:auto;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:14px;padding:24px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#222)}.gd-modal::backdrop{background:#0008}.gd-modal h2{margin:0;font-size:20px}.gd-modal ul{list-style:none;padding:0;max-height:260px;overflow:auto}.gd-modal li{padding:7px 0;display:flex;align-items:center;gap:12px;overflow-wrap:anywhere}.gd-modal label{flex:1}.gd-modal input[type=checkbox]{margin-right:8px}.gd-access [role=alert]{color:var(--dsw-alias-state-error-primary,#b22)}`
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
      return h('section', { className: 'gd-access gd-card', 'aria-label': 'Google Drive access' }, h('style', null, css),
        h('strong', null, 'Google Drive · Read-only access'),
        typeof status?.reason === 'string' && h('p', null, status.reason),
        h('p', null, 'Choose what this session can read. Browsing and unselected items stay outside the model conversation.'),
        !status && !error && h('p', { role: 'status' }, 'Checking access…'),
        error && h('p', { role: 'alert' }, error),
        status?.state === 'pending' ? h('div', { className: 'gd-actions' }, button('Choose files and folders', () => open(), busy), button('Deny', () => act('deny'), busy))
          : status && h(React.Fragment, null, h('p', null, `${status.state === 'granted' ? 'Read access allowed' : status.state === 'none' ? 'Waiting for request' : `Request ${status.state}`} · ${status.grants.length} selected items`), button('Manage access', () => act('manage'), busy)),
        error && button('Refresh', () => refresh(), busy))
    }
    function Picker({ entry, close }) {
      const { sessionId, callId, status, request, onChanged } = entry
      const [selected, setSelected] = React.useState(() => new Map(status.grants.map(item => [item.id, item])))
      const [path, setPath] = React.useState([])
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
      const parentId = path.at(-1)?.id
      React.useEffect(() => {
        const token = ++generation.current
        const controller = new AbortController()
        setLoading(true); setListing(null); setError('')
        request('browse', { ...identity, ...(parentId ? { parentId } : {}), ...(search ? { search } : {}), ...(pageToken ? { pageToken } : {}) }, controller.signal).then(value => {
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
      function navigate(next) { setPath(next); setSearch(''); setDraft(''); setPageToken(undefined) }
      return h('dialog', { ref: dialog, className: 'gd-access gd-modal', 'aria-label': 'Choose Google Drive access', onCancel: event => { event.preventDefault(); cancel() } }, h('style', null, css),
        h('h2', null, 'Choose files and folders'),
        h('p', null, 'Allow read access for this session only. No editing or deletion permission is granted.'),
        h('p', null, 'Selected folders include every file and subfolder recursively, including items added later. Browsing does not grant access.'),
        h('form', { onSubmit: event => { event.preventDefault(); setSearch(draft.trim()); setPageToken(undefined); retry() } }, h('label', null, 'Search Drive ', h('input', { type: 'search', value: draft, disabled: busy, onChange: event => setDraft(event.target.value) })), h('button', { type: 'submit', disabled: busy }, 'Search')),
        h('nav', { 'aria-label': 'Drive folders', className: 'gd-actions' }, button('All files', () => navigate([]), busy), path.map((item, index) => h('button', { type: 'button', key: item.id, disabled: busy, onClick: () => navigate(path.slice(0, index + 1)) }, item.name))),
        loading && h('p', { role: 'status' }, 'Loading files…'),
        error && h('p', { role: 'alert' }, error),
        error && button('Retry listing', () => retry(), busy),
        listing?.files.length === 0 && h('p', null, 'No files or folders found.'),
        h('ul', { 'aria-label': 'Files and folders' }, listing?.files.map(item => h('li', { key: item.id }, h('label', null, h('input', { type: 'checkbox', checked: selected.has(item.id), disabled: busy, onChange: event => { const next = new Map(selected); if (event.target.checked) next.set(item.id, { ...item, recursive: item.mimeType === FOLDER }); else next.delete(item.id); setSelected(next) } }), item.name, item.mimeType === FOLDER ? ' (folder)' : ''), item.mimeType === FOLDER && button(`Open ${item.name}`, () => navigate([...path, item]), busy)))),
        listing?.nextPageToken && button('Next page', () => setPageToken(listing.nextPageToken), busy),
        h('h3', null, `Review selection (${selected.size})`),
        h('p', null, 'Allow read access replaces this session’s current selection. Revoke removes all current access.'),
        h('ul', { 'aria-label': 'Selected access' }, [...selected.values()].map(item => h('li', { key: item.id }, h('span', null, `${item.name || item.id}${item.recursive ? ' — folder and all descendants (recursive)' : ' — this file only'}`), button(`Remove ${item.name || item.id}`, () => { const next = new Map(selected); next.delete(item.id); setSelected(next) }, busy)))),
        h('div', { className: 'gd-actions' }, button('Allow read access', () => mutate('grant'), busy || selected.size === 0), button('Cancel', cancel, busy), status.grants.length > 0 && button('Revoke all access', () => mutate('revoke'), busy)),
        busy && h('p', { role: 'status' }, 'Saving access…'))
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
