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

    const panelCss = `
      .wt-panel{--wt-border:var(--dsw-alias-border-l2,#8884);--wt-muted:var(--dsw-alias-label-secondary,#888);--wt-accent:var(--dsw-alias-state-business-primary,#598be8);color:var(--dsw-alias-label-primary,inherit);font:13px/1.5 system-ui,sans-serif;padding:24px;box-sizing:border-box;overflow:auto;height:100%;container-type:inline-size}
      .wt-panel *{box-sizing:border-box}.wt-panel h2,.wt-panel h3,.wt-panel h4,.wt-panel p{margin:0}.wt-panel h2{font-size:20px;letter-spacing:-.4px}.wt-panel h3{font-size:18px;overflow-wrap:anywhere}.wt-panel h4{font-size:13px;font-weight:600}.wt-panel button{font:inherit;cursor:pointer;color:inherit;border:1px solid var(--wt-border);background:transparent;border-radius:8px;padding:7px 11px}.wt-panel button:hover{background:var(--dsw-alias-interactive-bg-hover,#8881)}.wt-panel button:focus-visible{outline:2px solid var(--wt-accent);outline-offset:3px}.wt-panel button:disabled{opacity:.5;cursor:wait}
      .wt-header,.wt-title,.wt-section-title{display:flex;align-items:center;justify-content:space-between;gap:16px}.wt-header{margin-bottom:24px}.wt-subtitle,.wt-path,.wt-muted{color:var(--wt-muted)}.wt-subtitle{margin-top:4px!important}.wt-path{font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;margin-top:6px!important}.wt-layout{display:grid;grid-template-columns:minmax(230px,300px) minmax(0,1fr);gap:24px;max-width:1280px}.wt-list{list-style:none;padding:0;margin:10px 0;display:grid;gap:6px;align-content:start}.wt-panel .wt-card{display:block;width:100%;text-align:left;padding:14px;border-color:transparent}.wt-panel .wt-card[aria-pressed=true]{border-color:var(--wt-accent);background:color-mix(in srgb,var(--wt-accent) 9%,transparent)}.wt-card-name{font-weight:600;display:block;overflow-wrap:anywhere}.wt-branch{display:block;color:var(--wt-muted);font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;margin:3px 0 10px}.wt-badges{display:flex;gap:6px;flex-wrap:wrap}.wt-badge{display:inline-flex;font-size:11px;padding:2px 7px;border:1px solid var(--wt-border);border-radius:20px;color:var(--wt-muted)}.wt-badge[data-state=busy],.wt-badge[data-state=running]{color:var(--wt-accent);border-color:currentColor}.wt-badge[data-state=failed]{color:var(--dsw-alias-state-error-primary,#d86161)}.wt-assignment{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--wt-muted);font-size:12px;margin-top:10px}
      .wt-detail{min-width:0;border:1px solid var(--wt-border);border-radius:12px;padding:24px;background:var(--dsw-alias-bg-layer-1,transparent)}.wt-section{margin-top:24px;padding-top:20px;border-top:1px solid var(--wt-border)}.wt-empty{padding:24px 14px;text-align:center;color:var(--wt-muted);border:1px dashed var(--wt-border);border-radius:8px;margin-top:12px!important}.wt-files{list-style:none;padding:0;margin:12px 0 0;max-height:230px;overflow:auto}.wt-files li{display:flex;gap:12px;padding:7px 0;border-bottom:1px solid var(--wt-border);font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}.wt-files code{flex:none;color:var(--wt-accent);white-space:pre}.wt-runs{list-style:none;padding:0;margin:12px 0;display:grid;gap:6px}.wt-panel .wt-run{width:100%;text-align:left;display:flex;gap:12px;align-items:center;padding:10px 12px}.wt-run[aria-pressed=true]{border-color:var(--wt-accent);background:color-mix(in srgb,var(--wt-accent) 7%,transparent)}.wt-run .wt-badge{margin-left:auto}.wt-report{margin-top:16px}.wt-panel pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 ui-monospace,monospace;background:var(--dsw-alias-interactive-bg-hover,#8881);border-radius:8px;padding:14px;max-height:320px;overflow:auto;margin:8px 0 16px}.wt-refresh{display:flex;align-items:center;gap:12px}.wt-refresh-status{color:var(--wt-muted);font-size:12px}.wt-notice{margin-bottom:12px!important;color:var(--wt-muted)}.wt-copy-status{font-size:12px;color:var(--wt-muted);margin-top:8px;display:block}.wt-count{font-size:11px;font-weight:400;border:1px solid var(--wt-border);border-radius:20px;padding:1px 7px;margin-left:6px}
      @container(max-width:700px){.wt-layout{grid-template-columns:1fr}.wt-list{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}.wt-detail{padding:16px}.wt-title{align-items:flex-start;flex-wrap:wrap}.wt-header{align-items:flex-start}}@media(max-width:500px){.wt-panel{padding:16px}}
    `

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
      const badge = (text, status) => h('span', { className: 'wt-badge', 'data-state': status }, text)
      const selectedRow = value?.worktrees?.find(row => row.path === selected?.path)
      return h('section', { 'aria-label': 'Worktrees', className: 'wt-panel' }, h('style', null, panelCss), h('div', { className: 'wt-header' }, h('div', null, h('h2', null, 'Worktrees'), h('p', { className: 'wt-subtitle' }, 'Repository checkouts · Session activity')), h('div', { className: 'wt-refresh' }, h('span', { className: 'wt-refresh-status', role: 'status', style: { visibility: state.loading && value ? 'visible' : 'hidden' } }, 'Updating…'), button('Refresh', () => readerRef.current?.refresh(), { disabled: state.loading && !value }))),

        state.loading && !value && h('p', { role: 'status' }, 'Loading worktrees…'),
        state.error && h('p', { role: 'alert' }, state.error),
        value?.state === 'error' && h('p', { role: 'alert' }, value.message),
        ['unavailable', 'disabled'].includes(value?.state) && h('p', { role: 'status' }, 'Worktree integration is unavailable for this session.'),
        value?.state === 'ready' && h('div', { className: 'wt-layout' },
          h('nav', { 'aria-label': 'Repository worktrees' },
            h('div', { className: 'wt-section-title' }, h('h4', null, 'Checkouts'), badge(String(value.worktrees.length))),
            h('p', { className: 'wt-path', title: value.repository }, value.repository),
            value.truncated && h('p', { className: 'wt-muted' }, 'Showing the first 100 repository worktrees.'),
            value.worktrees.length === 0 && h('p', { className: 'wt-empty' }, 'No worktrees found.'),
            h('ul', { className: 'wt-list' }, value.worktrees.map(row => h('li', { key: row.path },
              button(h(React.Fragment, null,
                h('span', { className: 'wt-card-name' }, row.name),
                h('span', { className: 'wt-branch' }, row.branch ?? 'detached / bare'),
                h('span', { className: 'wt-badges' }, badge(`Worker: ${row.workerStatus}`, row.workerStatus), badge(row.changes.error ? 'Git unavailable' : row.changes.count === 0 ? 'Clean' : `${row.changes.count} changed ${row.changes.count === 1 ? 'file' : 'files'}`)),
                row.cleanupUncertain && h('span', { className: 'wt-assignment' }, 'Cleanup uncertain'),
                row.latestAssignment && h('span', { className: 'wt-assignment' }, row.latestAssignment)),
              () => choose({ path: row.path }), { className: 'wt-card', 'aria-label': `${row.name} — ${row.branch ?? 'detached / bare'}`, 'aria-pressed': selected?.path === row.path }))))),
          selected ? h('section', { 'aria-label': 'Selected worktree', className: 'wt-detail' },
            h('div', { className: 'wt-title' }, h('div', null, h('h3', null, selectedRow?.name ?? selected.path.split(/[\\/]/).at(-1)), h('p', { className: 'wt-branch' }, selectedRow?.branch ?? 'detached / bare')),
            button('Copy checkout path', async () => {
              try { await navigator.clipboard.writeText(selected.path); setCopied('Copied checkout path.') }
              catch { setCopied('Copy failed. Select and copy the path above.') }
            })),
            h('p', { className: 'wt-path' }, selected.path),
            h('span', { role: 'status', className: 'wt-copy-status' }, copied),
            h('div', { className: 'wt-section' }, h('h4', null, 'Changed files', h('span', { className: 'wt-count' }, selected.changes.error ? '—' : selected.changes.count))),
            selected.changes.error ? h('p', null, selected.changes.error) : h(React.Fragment, null,
              selected.changes.count === 0 && h('p', null, 'No changed files.'),
              h('ul', { className: 'wt-files' }, selected.changes.files.map((file, index) => h('li', { key: index }, h('code', null, file.status), h('span', null, `${file.path}${file.from ? ` ← ${file.from}` : ''}`)))),
              selected.changes.truncated && h('p', null, 'Showing the first 500 changed files.')),
            h('div', { className: 'wt-section' }, h('h4', null, `This session’s recorded runs (${selected.runs.length})`)),
            selected.runs.length === 0 && h('p', { className: 'wt-empty' }, 'No recorded runs for this worktree.'),
            selected.runs.length > 0 && !selected.run && h('p', null, 'The selected run is no longer available. Select a retained run below.'),
            h('ol', { className: 'wt-runs' }, selected.runs.map((run, index) => h('li', { key: run.id }, button(h(React.Fragment, null, h('span', { className: 'wt-muted' }, `#${selected.runs.length - index}`), h('span', null, run.mode === 'read-only' ? 'Read-only run' : 'Write run'), badge(run.status, run.status)), () => choose({ path: selected.path, runId: run.id }), { className: 'wt-run', 'aria-label': `${selected.runs.length - index}. ${run.mode} · ${run.status}`, 'aria-pressed': selected.run?.id === run.id })))),
            selected.run && h('div', { className: 'wt-report' },
              h('h4', null, 'Full assignment'), h('pre', null, selected.run.task),
              h('h4', null, 'Available report'), h('pre', null, selected.run.report ?? 'No report available.')),
          ) : h('p', { className: 'wt-empty' }, 'Select a worktree. The previous selection may no longer be registered.')))
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
