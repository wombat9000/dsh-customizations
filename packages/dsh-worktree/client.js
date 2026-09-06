window.__ModuleLoader__.load({
  id: '@local/dsh-worktree',
  factory: require => {
    const React = require('react')
    const h = React.createElement
    const CHANNEL = '/local-worktrees'
    const visible = () => document.visibilityState !== 'hidden'

    function unwrap(result, sessionId) {
      // Do not display transport or server error strings: they can contain host
      // details. A failed or malformed read is not an empty worktree list.
      if (result?.ok !== true) throw new Error('Worktrees RPC failed.')
      const value = result.value
      if (value?.sessionId !== sessionId || !['ready', 'disabled', 'unavailable', 'error'].includes(value.state)) {
        throw new Error('Invalid Worktrees response.')
      }
      return value
    }

    // One mounted view, no session cache. Generations discard superseded reads.
    function createReader(rpc, sessionId, publish) {
      let generation = 0
      let disposed = false
      let selection = {}
      let value
      return {
        async refresh(next = selection) {
          selection = next
          const token = ++generation
          publish({ value, loading: true })
          try {
            const result = unwrap(await rpc.call(CHANNEL, 'snapshot', { sessionId, ...selection }), sessionId)
            if (disposed || token !== generation) return
            if (result.state === 'error' || (result.state === 'ready' && !Array.isArray(result.worktrees))) throw new Error('Invalid Worktrees snapshot.')
            // Pin server defaults once resolved. Keep missing explicit selections
            // unavailable; an empty history may still resolve its first run later.
            if (result.state === 'ready' && result.selected) {
              selection = { ...selection, path: result.selected.path }
              if (result.selected.run) selection.runId = result.selected.run.id
            }
            value = result
            publish({ value, loading: false })
          } catch {
            if (!disposed && token === generation) publish({ loading: false, error: 'Worktrees could not refresh. Try again.' })
          }
        },
        dispose() { disposed = true; generation++ },
      }
    }

    function Panel({ rpc, sessions, sessionId }) {
      const [state, setState] = React.useState({ loading: true })
      const [copied, setCopied] = React.useState('')
      const readerRef = React.useRef()
      React.useEffect(() => {
        const reader = createReader(rpc, sessionId, setState)
        readerRef.current = reader
        const refresh = () => { if (visible()) void reader.refresh() }
        let jobs = sessions.list.getSnapshot().jobsBySession
        const off = sessions.list.subscribe(() => {
          const next = sessions.list.getSnapshot().jobsBySession
          if (next !== jobs) { jobs = next; refresh() }
        })
        refresh()
        // The public jobs mirror covers worker transitions, not external Git edits.
        const timer = setInterval(refresh, 10000)
        document.addEventListener('visibilitychange', refresh)
        return () => { reader.dispose(); off(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
      }, [rpc, sessionId, sessions])
      const value = state.value
      const selected = value?.selected
      const choose = selection => { setCopied(''); void readerRef.current?.refresh(selection) }
      const button = (text, onClick, extra = {}) => h('button', { type: 'button', onClick, ...extra }, text)
      return h('section', { 'aria-label': 'Worktrees', style: { padding: 20, overflow: 'auto', height: '100%', color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' } },
        h('h2', null, 'Worktrees'),
        button('Refresh', () => readerRef.current?.refresh(), { disabled: state.loading }),
        state.loading && h('p', { role: 'status' }, 'Loading worktrees…'),
        state.error && h('p', { role: 'alert' }, state.error),
        value?.state === 'error' && h('p', { role: 'alert' }, value.message),
        ['unavailable', 'disabled'].includes(value?.state) && h('p', { role: 'status' }, 'Worktree integration is unavailable for this session.'),
        value?.state === 'ready' && h(React.Fragment, null,
          h('p', null, value.repository),
          h('p', null, 'Worker status is repository-wide. Assignments and reports belong only to this session.'),
          value.truncated && h('p', null, 'Showing the first 100 repository worktrees.'),
          value.worktrees.length === 0 && h('p', null, 'No worktrees found.'),
          h('ul', null, value.worktrees.map(row => h('li', { key: row.path, style: { marginBottom: 12 } },
            button(`${row.name} — ${row.branch ?? 'detached / bare'}`, () => choose({ path: row.path }), { 'aria-pressed': selected?.path === row.path }),
            h('div', null, `Worker: ${row.workerStatus}${row.cleanupUncertain ? ' (cleanup uncertain)' : ''}`),
            h('div', null, row.changes.error ?? (row.changes.count === 0 ? 'Clean' : `${row.changes.count} changed files`)),
            h('div', null, row.latestAssignment ? `Latest assignment: ${row.latestAssignment}` : 'No recorded assignment in this session.')))),
          selected ? h('section', { 'aria-label': 'Selected worktree' },
            h('h3', null, selected.path),
            button('Copy checkout path', async () => {
              try { await navigator.clipboard.writeText(selected.path); setCopied('Copied checkout path.') }
              catch { setCopied('Copy failed. Select and copy the path above.') }
            }),
            h('span', { role: 'status' }, copied),
            h('h4', null, 'Changed files'),
            h('p', null, 'Includes tracked and untracked files; excludes submodule changes. No inline diffs.'),
            selected.changes.error ? h('p', null, selected.changes.error) : h(React.Fragment, null,
              selected.changes.count === 0 && h('p', null, 'No changed files.'),
              h('ul', null, selected.changes.files.map((file, index) => h('li', { key: index }, `${file.status} ${file.path}${file.from ? ` ← ${file.from}` : ''}`))),
              selected.changes.truncated && h('p', null, 'Showing the first 500 changed files.')),
            h('h4', null, `This session’s recorded runs (${selected.runs.length})`),
            h('p', null, 'Newest first. Up to 100 runs are retained per live session in this process. Restarting or unloading the session loses this history. Older runs and reports may no longer be available; this is not lifetime history. Reports are limited to 32,000 characters.'),
            selected.runs.length === 0 && h('p', null, 'No recorded runs for this worktree.'),
            selected.runs.length > 0 && !selected.run && h('p', null, 'The selected run is no longer available. Select a retained run below.'),
            h('ol', null, selected.runs.map((run, index) => h('li', { key: run.id }, button(`${selected.runs.length - index}. ${run.mode} · ${run.status}`, () => choose({ path: selected.path, runId: run.id }), { 'aria-pressed': selected.run?.id === run.id })))),
            selected.run && h(React.Fragment, null,
              h('h4', null, 'Full assignment'), h('pre', { style: { whiteSpace: 'pre-wrap' } }, selected.run.task),
              h('h4', null, 'Available report'), h('pre', { style: { whiteSpace: 'pre-wrap' } }, selected.run.report ?? 'No report available.')),
          ) : h('p', null, 'Select a worktree. The previous selection may no longer be registered.')))
    }

    function watchCapability({ sessions, rpc, register, interval = setInterval, clear = clearInterval, document: doc = document }) {
      let current
      let generation = 0
      let offTab
      let stopped = false
      let pending
      const remove = () => { offTab?.(); offTab = undefined }
      function check() {
        const id = sessions.list.getSnapshot().current
        if (id !== current) { current = id; generation++; pending = undefined; remove() }
        if (stopped || !id || doc.visibilityState === 'hidden' || pending) return
        const token = generation
        pending = Promise.resolve().then(() => rpc.call(CHANNEL, 'capability', { sessionId: id })).then(result => {
          if (stopped || token !== generation) return
          const value = unwrap(result, id)
          if (value?.sessionId === id && value.state === 'ready') { if (!offTab) offTab = register(id) }
          else remove()
        }).catch(() => { if (!stopped && token === generation) remove() }).finally(() => { if (token === generation) pending = undefined })
      }
      const off = sessions.list.subscribe(check)
      const timer = interval(check, 10000)
      doc.addEventListener('visibilitychange', check)
      check()
      return () => { stopped = true; generation++; remove(); off(); clear(timer); doc.removeEventListener('visibilitychange', check) }
    }
    return {
      name: 'local-worktrees', inject: ['slots', 'sessions', 'connection'],
      apply(ctx) {
        ctx.slots.inject('conversation.view', () => watchCapability({
          sessions: ctx.sessions, rpc: ctx.connection.rpc,
          register: sessionId => ctx.slots.register({ name: 'conversation.view', id: 'worktrees', order: 20, label: 'Worktrees',
            inject: viewed => ({ sessionId: viewed }) },
          props => props.sessionId === sessionId ? h(Panel, { key: sessionId, sessionId, sessions: ctx.sessions, rpc: ctx.connection.rpc }) : null),
        }))
      },
      createReader, watchCapability, Panel,
    }
  },
})
