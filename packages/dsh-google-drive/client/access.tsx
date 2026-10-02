import * as React from 'react'
import type {
  AccessAction,
  AccessStatus,
  CardProps,
  FileMetadata,
  Listing,
  PickerEntry,
  PickerStore,
  Resource,
} from './contracts.js'
import { FOLDER, endpoint as accessEndpoint, errorName, errorMessage } from './contracts.js'
import { api, validStatus, validListing } from './rpc.js'
import { css } from './styles.js'
import { button, icon, iconButton, fileType, fileIcon } from './controls.js'
export function EditCard(props: CardProps) {
  return <Card {...props} mode={'edit'} />
}

export function Card({ sessionId, callId, picker, request = api, mode = 'read' }: CardProps) {
  const editing = mode === 'edit'
  const endpoint = (method: AccessAction) => accessEndpoint(editing ? 'edit' : 'read', method)
  const [status, setStatus] = React.useState<AccessStatus | null>(null)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [revision, refresh] = React.useReducer((n) => n + 1, 0)
  const generation = React.useRef(0)
  const acting = React.useRef(false)
  const mutation = React.useRef<AbortController | null>(null)
  const owner = React.useMemo(() => ({}), [sessionId, callId])
  const loadedOwner = React.useRef<object | null>(null)
  React.useEffect(() => {
    const token = ++generation.current
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined,
      failures = 0
    if (loadedOwner.current !== owner) {
      setStatus(null)
      loadedOwner.current = owner
    }
    setError('')
    setBusy(false)
    acting.current = false
    async function load() {
      if (generation.current !== token) return
      try {
        const value = await request(endpoint('status'), { sessionId, callId }, controller.signal)
        if (generation.current !== token) return
        if (!validStatus(value)) throw new Error('Invalid Drive status. Retry.')
        setStatus(value)
        setError('')
        failures = 0
        if (value.state === 'pending') timer = setTimeout(load, 1500)
      } catch (err) {
        if (generation.current !== token || errorName(err) === 'AbortError') return
        setError(errorMessage(err))
        // The tool card can mount before the host registers its request.
        // Bound retries so retained cards from an old runtime become inert.
        if (++failures <= 10) timer = setTimeout(load, 1500)
      }
    }
    void load()
    return () => {
      generation.current++
      controller.abort()
      mutation.current?.abort()
      clearTimeout(timer)
      picker.closeOwner(owner)
    }
  }, [sessionId, callId, revision, request, picker, owner])
  async function act(method: 'deny' | 'manage') {
    if (acting.current) return
    acting.current = true
    setBusy(true)
    setError('')
    // Invalidate status reads before a mutation, including a pending poll.
    const token = ++generation.current
    mutation.current = new AbortController()
    try {
      const value = await request(
        endpoint(method),
        {
          sessionId,
          callId,
          ...(method === 'deny' && status?.requestId ? { requestId: status.requestId } : {}),
        },
        mutation.current.signal,
      )
      if (generation.current !== token) return
      if (!validStatus(value)) throw new Error('Invalid Drive status. Retry.')
      setStatus(value)
      if (method === 'manage') {
        if (value.state !== 'pending')
          throw new Error('Drive did not open an access request. Refresh and retry.')
        open(value)
      }
    } catch (err) {
      if (generation.current === token) setError(errorMessage(err))
    } finally {
      if (generation.current === token) {
        acting.current = false
        setBusy(false)
      }
    }
  }
  function open(value = status) {
    if (!value) return
    picker.open({
      owner,
      sessionId,
      callId,
      status: value,
      mode,
      request,
      onChanged: () => refresh(),
    })
  }
  const stateLabel =
    status?.state === 'granted'
      ? editing
        ? 'Session editing allowed'
        : 'Read access allowed'
      : status?.state === 'none'
        ? 'Waiting for request'
        : `Request ${status?.state}`
  return (
    <section
      className={'gd-access gd-card'}
      aria-label={editing ? 'Google Sheets edit access' : 'Google Drive access'}
    >
      {<style>{css}</style>}
      {
        <div className={'gd-card-title'}>
          {icon('drive')}
          {
            <strong>
              {editing ? 'Google Sheets · Session edit access' : 'Google Drive · Read-only access'}
            </strong>
          }
        </div>
      }
      {typeof status?.reason === 'string' && <p>{status.reason}</p>}
      {
        <p className={'gd-muted'}>
          {editing
            ? 'Choose spreadsheets this session may edit. Every change needs a separate preview approval. Google account-level write consent persists beyond this session; DSH restricts selected files.'
            : 'Choose what this session can read. Browsing and unselected items stay private.'}
        </p>
      }
      {!status && !error && <p role={'status'}>{'Checking access…'}</p>}
      {error && <p role={'alert'}>{error}</p>}
      {status?.state === 'pending' ? (
        <div className={'gd-actions'}>
          {button(editing ? 'Choose spreadsheets' : 'Choose files and folders', () => open(), busy)}
          {button('Deny', () => act('deny'), busy)}
        </div>
      ) : (
        status && (
          <React.Fragment>
            {<p>{`${stateLabel} · ${status.grants.length} selected items`}</p>}
            {
              <div className={'gd-actions'}>
                {button('Manage access', () => act('manage'), busy)}
              </div>
            }
          </React.Fragment>
        )
      )}
      {error && button('Refresh', () => refresh(), busy)}
    </section>
  )
}

export function Picker({ entry, close }: { entry: PickerEntry; close: () => void }) {
  const { sessionId, callId, status, request, onChanged } = entry
  const editing = entry.mode === 'edit' || status.mode === 'edit'
  const endpoint = (method: AccessAction) => accessEndpoint(editing ? 'edit' : 'read', method)
  const [selected, setSelected] = React.useState(
    () =>
      new Map(
        status.grants.filter((item) => !editing || !item.recursive).map((item) => [item.id, item]),
      ),
  )
  const [path, setPath] = React.useState<FileMetadata[]>([])
  const [view, setView] = React.useState('my-drive')
  const tabId = React.useId()
  const tabs = [
    { id: 'my-drive', label: 'My Drive' },
    { id: 'shared-with-me', label: 'Shared with me' },
  ]
  const browseController = React.useRef<AbortController | null>(null)
  const [reviewOpen, setReviewOpen] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [pageToken, setPageToken] = React.useState<string | undefined>(undefined)
  const [listing, setListing] = React.useState<Listing | null>(null)
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [revision, retry] = React.useReducer((n) => n + 1, 0)
  const dialog = React.useRef<HTMLDialogElement | null>(null)
  const alive = React.useRef(true)
  const acting = React.useRef(false)
  const generation = React.useRef(0)
  const mutation = React.useRef<AbortController | null>(null)
  const identity = { sessionId, callId, requestId: status.requestId }
  React.useEffect(() => {
    alive.current = true
    const previous = document.activeElement
    dialog.current!.showModal()
    return () => {
      alive.current = false
      generation.current++
      mutation.current?.abort()
      dialog.current?.close()
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])
  const parentId = path.at(-1)?.id || 'root'
  React.useEffect(() => {
    const token = ++generation.current
    const controller = new AbortController()
    browseController.current = controller
    setLoading(true)
    setListing(null)
    setError('')
    // Name search is global; view identifies the browsing context only.
    const body = {
      ...identity,
      view,
      ...(search ? { search } : parentId !== 'root' ? { parentId } : {}),
      ...(pageToken ? { pageToken } : {}),
    }
    request(endpoint('browse'), body, controller.signal)
      .then((value) => {
        if (!alive.current || token !== generation.current) return
        if (!validListing(value)) throw new Error('Invalid Drive listing. Retry.')
        setListing(value)
      })
      .catch((err) => {
        if (alive.current && token === generation.current && errorName(err) !== 'AbortError')
          setError(errorMessage(err))
      })
      .finally(() => {
        if (alive.current && token === generation.current) setLoading(false)
      })
    return () => controller.abort()
  }, [view, parentId, search, pageToken, revision])
  async function mutate(method: 'revoke' | 'grant') {
    if (acting.current) return
    acting.current = true
    setBusy(true)
    setError('')
    mutation.current = new AbortController()
    try {
      const body =
        method === 'revoke'
          ? { sessionId, callId }
          : {
              ...identity,
              selected: [...selected.values()].map((item) => ({
                id: item.id,
                recursive: editing ? false : item.recursive === true,
              })),
            }
      const value = await request(endpoint(method), body, mutation.current.signal)
      if (!alive.current) return
      if (!validStatus(value)) throw new Error('Invalid Drive status. Refresh to check access.')
      onChanged()
      close()
    } catch (err) {
      if (alive.current && errorName(err) !== 'AbortError') setError(errorMessage(err))
    } finally {
      if (alive.current) {
        acting.current = false
        setBusy(false)
      }
    }
  }
  function cancel() {
    if (acting.current) return
    // Resume status polling after Manage and recover one-shot failed grants.
    // This only refreshes the card; it does not deny or grant permission.
    onChanged()
    close()
  }
  function invalidateListing() {
    // Invalidate synchronously, before React runs the next effect. Some
    // transports finish after abort; generation also rejects those results.
    generation.current++
    browseController.current?.abort()
    setListing(null)
    setLoading(true)
    setError('')
  }
  function navigate(next: FileMetadata[]) {
    invalidateListing()
    setPath(next)
    setSearch('')
    setDraft('')
    setPageToken(undefined)
    retry()
  }
  function chooseView(next: string) {
    setView(next)
    navigate([])
  }
  function tabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : event.key === 'ArrowRight'
            ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft'
              ? (index + tabs.length - 1) % tabs.length
              : undefined
    if (next === undefined) return
    event.preventDefault()
    ;(event.currentTarget.parentElement!.children[next] as HTMLElement).focus()
    chooseView(tabs[next]!.id)
  }
  function remove(id: string) {
    setSelected((current) => {
      const next = new Map(current)
      next.delete(id)
      return next
    })
  }
  function toggle(item: FileMetadata, checked: boolean) {
    if (editing && item.mimeType !== 'application/vnd.google-apps.spreadsheet') return
    setSelected((current) => {
      const next = new Map(current)
      if (checked) next.set(item.id, { ...item, recursive: item.mimeType === FOLDER })
      else next.delete(item.id)
      return next
    })
  }
  const selectedItems = [...selected.values()]
  const hasFolders = selectedItems.some((item) => item.recursive)
  return (
    <dialog
      ref={dialog}
      className={'gd-access gd-modal'}
      aria-label={editing ? 'Choose Google Sheets edit access' : 'Choose Google Drive access'}
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
    >
      {<style>{css}</style>}
      {
        <div className={'gd-main'}>
          {
            <header className={'gd-header'}>
              {<span className={'gd-drive-mark'}>{icon('drive')}</span>}
              {
                <div className={'gd-header-copy'}>
                  {<h2>{editing ? 'Choose spreadsheets' : 'Choose files and folders'}</h2>}
                  {
                    <p className={'gd-muted'}>
                      {editing
                        ? 'Session editing · Separate approval for every change. Google account write consent persists beyond this session.'
                        : 'Google Drive · Read-only · This session only'}
                    </p>
                  }
                </div>
              }
              {iconButton('Close picker', 'close', cancel, busy)}
            </header>
          }
          {
            <div className={'gd-toolbar'}>
              {
                <form
                  className={'gd-search'}
                  role={'search'}
                  onSubmit={(event) => {
                    event.preventDefault()
                    invalidateListing()
                    setPath([])
                    setSearch(draft.trim())
                    setPageToken(undefined)
                    retry()
                  }}
                >
                  {icon('search')}
                  {
                    <input
                      type={'search'}
                      aria-label={'Search Drive'}
                      placeholder={'Search all of Drive'}
                      value={draft}
                      disabled={busy}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                  }
                  {
                    <button type={'submit'} disabled={busy}>
                      {'Search'}
                    </button>
                  }
                </form>
              }
              {
                <div role={'tablist'} aria-label={'Drive locations'} className={'gd-tabs'}>
                  {tabs.map((tab, index) => (
                    <button
                      key={tab.id}
                      id={`${tabId}-${tab.id}`}
                      type={'button'}
                      role={'tab'}
                      aria-selected={view === tab.id}
                      aria-controls={`${tabId}-results`}
                      tabIndex={view === tab.id ? 0 : -1}
                      disabled={busy}
                      onClick={() => chooseView(tab.id)}
                      onKeyDown={(event) => tabKey(event, index)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              }
              {search && (
                <p
                  className={'gd-search-results gd-muted'}
                  role={'status'}
                >{`Search results across all of Drive for “${search}”`}</p>
              )}
              {!search && path.length > 0 && (
                <nav aria-label={'Drive folders'} className={'gd-breadcrumbs'}>
                  {
                    <button type={'button'} disabled={busy} onClick={() => navigate([])}>
                      {tabs.find((tab) => tab.id === view)!.label}
                    </button>
                  }
                  {path.map((item, index) => (
                    <React.Fragment key={item.id}>
                      {icon('chevron')}
                      {
                        <button
                          type={'button'}
                          disabled={busy}
                          onClick={() => navigate(path.slice(0, index + 1))}
                          aria-current={index === path.length - 1 ? 'location' : undefined}
                        >
                          {item.name}
                        </button>
                      }
                    </React.Fragment>
                  ))}
                </nav>
              )}
            </div>
          }
          {
            <div className={'gd-column-head'} aria-hidden={true}>
              {<span>{'Name'}</span>}
              {<span>{'Type'}</span>}
            </div>
          }
          {
            <div
              className={'gd-browser'}
              id={`${tabId}-results`}
              role={'tabpanel'}
              tabIndex={0}
              aria-labelledby={search ? undefined : `${tabId}-${view}`}
              aria-label={search ? 'Search results across all of Drive' : undefined}
              aria-busy={loading}
            >
              {loading && (
                <div className={'gd-empty'} role={'status'}>
                  {icon('folder')}
                  {<p className={'gd-muted'}>{'Loading files…'}</p>}
                </div>
              )}
              {error && (
                <div className={'gd-error'}>
                  {<p role={'alert'}>{error}</p>}
                  {button('Retry listing', () => retry(), busy)}
                </div>
              )}
              {listing?.files.length === 0 && (
                <div className={'gd-empty'}>
                  {icon(search ? 'search' : 'folder')}
                  {<p>{'No files or folders found.'}</p>}
                  {
                    <p className={'gd-muted'}>
                      {search ? 'Try a different name.' : 'Search Drive to find items elsewhere.'}
                    </p>
                  }
                </div>
              )}
              {
                <ul aria-label={'Files and folders'}>
                  {listing?.files.map((item) => {
                    const isFolder = item.mimeType === FOLDER
                    const checked = selected.has(item.id)
                    const checkboxId = `gd-file-${item.id}`
                    return (
                      <li key={item.id} className={`gd-file-row${checked ? ' gd-selected' : ''}`}>
                        {
                          <input
                            id={checkboxId}
                            type={'checkbox'}
                            aria-label={item.name}
                            checked={checked}
                            disabled={
                              busy ||
                              (editing &&
                                item.mimeType !== 'application/vnd.google-apps.spreadsheet')
                            }
                            onChange={(event) => toggle(item, event.target.checked)}
                          />
                        }
                        {fileIcon(item)}
                        {isFolder ? (
                          <button
                            type={'button'}
                            className={'gd-file-name'}
                            title={item.name}
                            disabled={busy}
                            onClick={() => navigate(search ? [item] : [...path, item])}
                          >
                            {item.name}
                          </button>
                        ) : (
                          <label htmlFor={checkboxId} className={'gd-file-name'} title={item.name}>
                            {item.name}
                          </label>
                        )}
                        {<span className={'gd-file-type'}>{fileType(item)[1]}</span>}
                      </li>
                    )
                  })}
                </ul>
              }
              {listing?.nextPageToken && (
                <div className={'gd-pagination'}>
                  {button(
                    'Next page',
                    () => {
                      const next = listing.nextPageToken
                      invalidateListing()
                      setPageToken(next)
                    },
                    busy || loading,
                  )}
                </div>
              )}
            </div>
          }
          {(selected.size > 0 || status.grants.length > 0) && (
            <section className={'gd-selection'} aria-label={'Selection review'}>
              {
                <div className={'gd-selection-top'}>
                  {selected.size > 0 ? (
                    <button
                      type={'button'}
                      aria-expanded={reviewOpen}
                      disabled={busy}
                      onClick={() => setReviewOpen((value) => !value)}
                    >
                      {icon(reviewOpen ? 'down' : 'chevron')}
                      {`Review selection (${selected.size})`}
                    </button>
                  ) : (
                    <span />
                  )}
                  {status.grants.length > 0 &&
                    button(
                      editing ? 'Remove all session edit access' : 'Revoke all access',
                      () => mutate('revoke'),
                      busy,
                    )}
                </div>
              }
              {hasFolders && (
                <p className={'gd-selection-note'}>
                  {
                    'Selected folders include all files and subfolders, including items added later.'
                  }
                </p>
              )}
              {selected.size > 0 && reviewOpen && (
                <ul className={'gd-tray'} aria-label={'Selected access'}>
                  {selectedItems.map((item) => (
                    <li key={item.id}>
                      {fileIcon(item)}
                      {
                        <span className={'gd-file-name'} title={item.name || item.id}>
                          {item.name || item.id}
                        </span>
                      }
                      {
                        <span className={'gd-file-type'}>
                          {item.recursive ? 'All descendants' : 'This file'}
                        </span>
                      }
                      {iconButton(
                        `Remove ${item.name || item.id}`,
                        'close',
                        () => remove(item.id),
                        busy,
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      }
      {
        <footer className={'gd-footer'}>
          {
            <div className={'gd-footer-count'}>
              {<span role={'status'}>{busy ? 'Saving access…' : `${selected.size} selected`}</span>}
              {
                <p>
                  {status.grants.length > 0
                    ? 'Replaces current session access'
                    : 'Only selected items are shared'}
                </p>
              }
            </div>
          }
          {
            <div className={'gd-footer-actions'}>
              {button('Cancel', cancel, busy)}
              {
                <button
                  type={'button'}
                  className={'gd-primary'}
                  disabled={busy || selected.size === 0}
                  onClick={() => mutate('grant')}
                >
                  {editing ? 'Allow editing for this session' : 'Allow read access'}
                </button>
              }
            </div>
          }
        </footer>
      }
    </dialog>
  )
}

export function Overlay({ picker }: { picker: PickerStore }) {
  const entry = React.useSyncExternalStore(picker.subscribe, picker.getSnapshot)
  return entry ? (
    <Picker
      key={`${entry.sessionId}:${entry.callId}:${entry.status.requestId}`}
      entry={entry}
      close={picker.close}
    />
  ) : null
}
