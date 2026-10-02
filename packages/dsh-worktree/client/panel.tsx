import * as React from 'react'
import { createReader, type ReaderState } from './reader.ts'
import type { PanelProps } from './contracts.ts'
import type { Selection } from '../shared/contracts.ts'
const visible = () => document.visibilityState !== 'hidden'
const panelCss = `
  .wt-panel{--wt-border:var(--dsw-alias-border-l2,#8884);--wt-muted:var(--dsw-alias-label-secondary,#888);--wt-accent:var(--dsw-alias-state-business-primary,#598be8);color:var(--dsw-alias-label-primary,inherit);font:13px/1.5 system-ui,sans-serif;padding:24px;box-sizing:border-box;overflow:auto;height:100%;container-type:inline-size}
  .wt-panel *{box-sizing:border-box}.wt-panel h2,.wt-panel h3,.wt-panel h4,.wt-panel p{margin:0}.wt-panel h2{font-size:20px;letter-spacing:-.4px}.wt-panel h3{font-size:18px;overflow-wrap:anywhere}.wt-panel h4{font-size:13px;font-weight:600}.wt-panel button{font:inherit;cursor:pointer;color:inherit;border:1px solid var(--wt-border);background:transparent;border-radius:8px;padding:7px 11px}.wt-panel button:hover{background:var(--dsw-alias-interactive-bg-hover,#8881)}.wt-panel button:focus-visible{outline:2px solid var(--wt-accent);outline-offset:3px}.wt-panel button:disabled{opacity:.5;cursor:wait}
  .wt-header,.wt-title,.wt-section-title{display:flex;align-items:center;justify-content:space-between;gap:16px}.wt-header{margin-bottom:24px}.wt-subtitle,.wt-path,.wt-muted{color:var(--wt-muted)}.wt-subtitle{margin-top:4px!important}.wt-path{font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;margin-top:6px!important}.wt-layout{display:grid;grid-template-columns:minmax(230px,300px) minmax(0,1fr);gap:24px;max-width:1280px}.wt-list{list-style:none;padding:0;margin:10px 0;display:grid;gap:6px;align-content:start}.wt-panel .wt-card{display:block;width:100%;text-align:left;padding:14px;border-color:transparent}.wt-panel .wt-card[aria-pressed=true]{border-color:var(--wt-accent);background:color-mix(in srgb,var(--wt-accent) 9%,transparent)}.wt-card-name{font-weight:600;display:block;overflow-wrap:anywhere}.wt-branch{display:block;color:var(--wt-muted);font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;margin:3px 0 10px}.wt-badges{display:flex;gap:6px;flex-wrap:wrap}.wt-badge{display:inline-flex;font-size:11px;padding:2px 7px;border:1px solid var(--wt-border);border-radius:20px;color:var(--wt-muted)}.wt-badge[data-state=busy],.wt-badge[data-state=running]{color:var(--wt-accent);border-color:currentColor}.wt-badge[data-state=failed]{color:var(--dsw-alias-state-error-primary,#d86161)}.wt-assignment{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--wt-muted);font-size:12px;margin-top:10px}
  .wt-detail{min-width:0;border:1px solid var(--wt-border);border-radius:12px;padding:24px;background:var(--dsw-alias-bg-layer-1,transparent)}.wt-section{margin-top:24px;padding-top:20px;border-top:1px solid var(--wt-border)}.wt-empty{padding:24px 14px;text-align:center;color:var(--wt-muted);border:1px dashed var(--wt-border);border-radius:8px;margin-top:12px!important}.wt-files{list-style:none;padding:0;margin:12px 0 0;max-height:230px;overflow:auto}.wt-files li{display:flex;gap:12px;padding:7px 0;border-bottom:1px solid var(--wt-border);font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}.wt-files code{flex:none;color:var(--wt-accent);white-space:pre}.wt-runs{list-style:none;padding:0;margin:12px 0;display:grid;gap:6px}.wt-panel .wt-run{width:100%;text-align:left;display:flex;gap:12px;align-items:center;padding:10px 12px}.wt-run[aria-pressed=true]{border-color:var(--wt-accent);background:color-mix(in srgb,var(--wt-accent) 7%,transparent)}.wt-run .wt-badge{margin-left:auto}.wt-report{margin-top:16px}.wt-panel pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 ui-monospace,monospace;background:var(--dsw-alias-interactive-bg-hover,#8881);border-radius:8px;padding:14px;max-height:320px;overflow:auto;margin:8px 0 16px}.wt-refresh{display:flex;align-items:center;gap:12px}.wt-refresh-status{color:var(--wt-muted);font-size:12px}.wt-notice{margin-bottom:12px!important;color:var(--wt-muted)}.wt-copy-status{font-size:12px;color:var(--wt-muted);margin-top:8px;display:block}.wt-count{font-size:11px;font-weight:400;border:1px solid var(--wt-border);border-radius:20px;padding:1px 7px;margin-left:6px}
  @container(max-width:700px){.wt-layout{grid-template-columns:1fr}.wt-list{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}.wt-detail{padding:16px}.wt-title{align-items:flex-start;flex-wrap:wrap}.wt-header{align-items:flex-start}}@media(max-width:500px){.wt-panel{padding:16px}}
`
export function Panel({ rpc, jobs, sessionId }: PanelProps) {
  const [state, setState] = React.useState<ReaderState>({ loading: true })
  const [copied, setCopied] = React.useState('')
  const readerRef = React.useRef<ReturnType<typeof createReader>>()
  React.useEffect(() => {
    const reader = createReader(rpc, sessionId, setState)
    readerRef.current = reader
    const refresh = () => {
      if (visible()) void reader.refresh()
    }
    const unwatch = jobs.watchRows(sessionId)
    let rows = jobs.state.getSnapshot().rows[sessionId]
    const off = jobs.state.subscribe(() => {
      const next = jobs.state.getSnapshot().rows[sessionId]
      if (next !== rows) {
        rows = next
        refresh()
      }
    })
    refresh()
    // The public jobs mirror covers worker transitions, not external Git edits.
    const timer = setInterval(refresh, 10000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      reader.dispose()
      off()
      unwatch()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [rpc, sessionId, jobs])
  const value = state.value
  const selected = value?.selected
  const choose = (selection: Selection) => {
    setCopied('')
    void readerRef.current?.refresh(selection)
  }
  const button = (
    text: React.ReactNode,
    onClick: React.MouseEventHandler<HTMLButtonElement>,
    extra: React.ButtonHTMLAttributes<HTMLButtonElement> = {},
  ) => (
    <button type="button" onClick={onClick} {...extra}>
      {text}
    </button>
  )
  const badge = (text: React.ReactNode, status?: string) => (
    <span className="wt-badge" data-state={status}>
      {text}
    </span>
  )
  const selectedRow = value?.worktrees?.find((row) => row.path === selected?.path)
  return (
    <section aria-label="Worktrees" className="wt-panel">
      <style>{panelCss}</style>
      <div className="wt-header">
        <div>
          <h2>{'Worktrees'}</h2>
          <p className="wt-subtitle">{'Repository checkouts · Session activity'}</p>
        </div>
        <div className="wt-refresh">
          <span
            className="wt-refresh-status"
            role="status"
            style={{ visibility: state.loading && value ? 'visible' : 'hidden' }}
          >
            {'Updating…'}
          </span>
          {button('Refresh', () => readerRef.current?.refresh(), {
            disabled: state.loading && !value,
          })}
        </div>
      </div>
      {state.loading && !value && <p role="status">{'Loading worktrees…'}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {value?.state === 'error' && <p role="alert">{value.message}</p>}
      {(value?.state === 'unavailable' || value?.state === 'disabled') && (
        <p role="status">{'Worktree integration is unavailable for this session.'}</p>
      )}
      {value?.state === 'ready' && value.worktrees && (
        <div className="wt-layout">
          <nav aria-label="Repository worktrees">
            <div className="wt-section-title">
              <h4>{'Checkouts'}</h4>
              {badge(String(value.worktrees.length))}
            </div>
            <p className="wt-path" title={value.repository}>
              {value.repository}
            </p>
            {value.truncated && (
              <p className="wt-muted">{'Showing the first 100 repository worktrees.'}</p>
            )}
            {value.worktrees.length === 0 && <p className="wt-empty">{'No worktrees found.'}</p>}
            <ul className="wt-list">
              {value.worktrees.map((row) => (
                <li key={row.path}>
                  {button(
                    <>
                      <span className="wt-card-name">{row.name}</span>
                      <span className="wt-branch">{row.branch ?? 'detached / bare'}</span>
                      <span className="wt-badges">
                        {badge(`Worker: ${row.workerStatus}`, row.workerStatus)}
                        {badge(
                          row.changes.error !== undefined
                            ? 'Git unavailable'
                            : row.changes.count === 0
                              ? 'Clean'
                              : `${row.changes.count} changed ${row.changes.count === 1 ? 'file' : 'files'}`,
                        )}
                      </span>
                      {row.cleanupUncertain && (
                        <span className="wt-assignment">{'Cleanup uncertain'}</span>
                      )}
                      {row.latestAssignment && (
                        <span className="wt-assignment">{row.latestAssignment}</span>
                      )}
                    </>,
                    () => choose({ path: row.path }),
                    {
                      className: 'wt-card',
                      'aria-label': `${row.name} — ${row.branch ?? 'detached / bare'}`,
                      'aria-pressed': selected?.path === row.path,
                    },
                  )}
                </li>
              ))}
            </ul>
          </nav>
          {selected ? (
            <section aria-label="Selected worktree" className="wt-detail">
              <div className="wt-title">
                <div>
                  <h3>{selectedRow?.name ?? selected.path.split(/[\\/]/).at(-1)}</h3>
                  <p className="wt-branch">{selectedRow?.branch ?? 'detached / bare'}</p>
                </div>
                {button('Copy checkout path', async () => {
                  try {
                    await navigator.clipboard.writeText(selected.path)
                    setCopied('Copied checkout path.')
                  } catch {
                    setCopied('Copy failed. Select and copy the path above.')
                  }
                })}
              </div>
              <p className="wt-path">{selected.path}</p>
              <span role="status" className="wt-copy-status">
                {copied}
              </span>
              <div className="wt-section">
                <h4>
                  {'Changed files'}
                  <span className="wt-count">
                    {selected.changes.error !== undefined ? '—' : selected.changes.count}
                  </span>
                </h4>
              </div>
              {selected.changes.error !== undefined ? (
                <p>{selected.changes.error}</p>
              ) : (
                <>
                  {selected.changes.count === 0 && <p>{'No changed files.'}</p>}
                  <ul className="wt-files">
                    {selected.changes.files.map((file, index) => (
                      <li key={index}>
                        <code>{file.status}</code>
                        <span>{`${file.path}${file.from ? ` ← ${file.from}` : ''}`}</span>
                      </li>
                    ))}
                  </ul>
                  {selected.changes.truncated && <p>{'Showing the first 500 changed files.'}</p>}
                </>
              )}
              <div className="wt-section">
                <h4>{`This session’s recorded runs (${selected.runs.length})`}</h4>
              </div>
              {selected.runs.length === 0 && (
                <p className="wt-empty">{'No recorded runs for this worktree.'}</p>
              )}
              {selected.runs.length > 0 && !selected.run && (
                <p>{'The selected run is no longer available. Select a retained run below.'}</p>
              )}
              <ol className="wt-runs">
                {selected.runs.map((run, index) => (
                  <li key={run.id}>
                    {button(
                      <>
                        <span className="wt-muted">{`#${selected.runs.length - index}`}</span>
                        <span>{run.mode === 'read-only' ? 'Read-only run' : 'Write run'}</span>
                        {badge(run.status, run.status)}
                      </>,
                      () => choose({ path: selected.path, runId: run.id }),
                      {
                        className: 'wt-run',
                        'aria-label': `${selected.runs.length - index}. ${run.mode} · ${run.status}`,
                        'aria-pressed': selected.run?.id === run.id,
                      },
                    )}
                  </li>
                ))}
              </ol>
              {selected.run && (
                <div className="wt-report">
                  <h4>{'Full assignment'}</h4>
                  <pre>{selected.run.task}</pre>
                  <h4>{'Available report'}</h4>
                  <pre>{selected.run.report ?? 'No report available.'}</pre>
                </div>
              )}
            </section>
          ) : (
            <p className="wt-empty">
              {'Select a worktree. The previous selection may no longer be registered.'}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
