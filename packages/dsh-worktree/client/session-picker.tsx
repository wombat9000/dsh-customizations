import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { WorkspacePickerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { DIRECTORY_ALIAS } from './directory-alias.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionClientContext } from './session-contracts.ts'
import { currentSession, type SessionStore } from './session-store.ts'
import { action, Dialog, surface } from './session-components.tsx'

const absent = { getSnapshot: () => undefined, subscribe: (_listener: () => void) => () => {} }
// The root Hero slot supplies native onPick. Only that owner transfers draft
// text and attachment ownership; this picker never calls ConversationController.
export function SessionPicker(
  props: Omit<
    WorkspacePickerProps,
    keyof PropsRenderSlots<'conversation.hero.workspace.directoryFlow'>
  > &
    PropsRenderSlots<typeof DIRECTORY_ALIAS> & { ctx: SessionClientContext; store: SessionStore },
) {
  const { ctx, store } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const summary = props.useSessions((list) => {
    const selected = Object.values(list.byId).filter((row) => (row.retainedBy.mainView ?? 0) > 0)
    return selected.length === 1 ? selected[0] : undefined
  })
  const boundSession = (id: SessionId) => {
    try {
      return ctx.sessions.binding(id)?.session
    } catch (error) {
      // Archive retires the native binding before its catalog's mainView lease
      // disappears. That transient row is not a usable composer identity.
      if (
        error instanceof Error &&
        error.message.startsWith('uiConversation.binding: unknown session')
      )
        return undefined
      throw error
    }
  }
  const liveSource = summary ? (boundSession(summary.id) ?? absent) : absent
  const subscribe = React.useCallback(
    (listener: () => void) => liveSource.subscribe(listener),
    [liveSource],
  )
  const snapshot = React.useCallback(() => liveSource.getSnapshot(), [liveSource])
  const live = useSyncExternalStore(subscribe, snapshot)
  const blank = Boolean(live?.blank && !live.promptAttempted)
  const workspaceSnapshot = props.useWorkspaces((value) => value)
  const available = props.useDirectoryFlow((value) => value)
  const [flowOpen, setFlowOpen] = useState(false)
  const [adopting, setAdopting] = useState(false)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const menu = useRef<HTMLDivElement>(null)
  const attempted = useRef(new Set<string>())
  const preferenceBusy = useRef(false)
  const [saving, setSaving] = useState(false)
  const [requested, setRequested] = useState<boolean | null>(null)
  useEffect(() => {
    setRequested(null)
  }, [summary?.id, props.selectedId])
  const latest = useRef({
    sessionId: summary?.id,
    workspaceId: props.selectedId,
    blank,
    onPick: props.onPick,
  })
  latest.current = {
    sessionId: summary?.id,
    workspaceId: props.selectedId,
    blank,
    onPick: props.onPick,
  }
  const ready =
    state.sessionId === summary?.id &&
    !state.loading &&
    state.status !== null &&
    (state.status.sourceWorkspaceId === props.selectedId ||
      state.status.current?.workspaceId === props.selectedId)
  const managed = ready
    ? (state.status?.current ??
      state.status?.records.find((record) => record.sessionId === summary?.id))
    : undefined
  const source = managed?.sourceWorkspaceId ?? state.status?.sourceWorkspaceId
  const wantsWorktree = requested ?? Boolean(ready && state.status?.defaultEnabled)
  const checked = Boolean(managed || wantsWorktree)
  const busy = saving || Boolean(summary && state.busy.has(summary.id))
  const identityMatches = (sessionId: SessionId, workspaceId: WorkspaceId) => {
    const current = latest.current
    const session = boundSession(sessionId)?.getSnapshot()
    return (
      current.sessionId === sessionId &&
      current.workspaceId === workspaceId &&
      current.blank &&
      currentSession(ctx) === sessionId &&
      Boolean(session?.blank && !session.promptAttempted)
    )
  }
  const create = (sessionId: SessionId, workspaceId: WorkspaceId) =>
    store.create(sessionId, (record) => {
      // A late mutation remains in the shared recovery ledger. Do not pull the
      // user back after they chose a different Workspace or Session.
      if (record.workspaceId && identityMatches(sessionId, workspaceId)) {
        latest.current.onPick(record.workspaceId as WorkspaceId)
      }
    })
  useLayoutEffect(() => {
    if (!summary || !blank) return
    // Hold first submit until status resolves the remembered per-source default.
    // RC2 exposes blocks.set/storeFor, not a register() lease API.
    if (state.loading || (wantsWorktree && !managed))
      store.block(
        summary.id,
        busy || state.loading
          ? 'Preparing session worktree…'
          : 'Worktree requested. Turn off Use worktree to continue in the shared checkout.',
      )
    else if (!state.busy.has(summary.id)) store.clearBlock(summary.id)
    return () => {
      if (!state.busy.has(summary.id)) store.clearBlock(summary.id)
    }
  }, [
    summary?.id,
    blank,
    ready,
    state.loading,
    state.status,
    managed,
    state.busy,
    wantsWorktree,
    busy,
    store,
  ])
  useEffect(() => {
    if (
      !summary ||
      !blank ||
      !ready ||
      managed ||
      busy ||
      !props.selectedId ||
      !state.status?.defaultEnabled ||
      !state.status.canCreate ||
      requested === false
    )
      return
    if (state.status.sourceWorkspaceId !== props.selectedId) return
    const key = `${summary.id}:${props.selectedId}`
    if (attempted.current.has(key)) return
    attempted.current.add(key)
    void create(summary.id, props.selectedId)
  }, [summary?.id, blank, ready, managed, busy, props.selectedId, state.status, requested, store])
  async function toggle(enabled: boolean) {
    if (!summary || !props.selectedId || !source || !ready || busy || preferenceBusy.current) return
    const sessionId = summary.id
    const workspaceId = props.selectedId
    preferenceBusy.current = true
    setRequested(enabled)
    setSaving(true)
    if (enabled) store.block(sessionId)
    try {
      await store.request('preference', { workspaceId: source, enabled })
      if (!identityMatches(sessionId, workspaceId)) return
      if (enabled && !managed) {
        attempted.current.add(`${sessionId}:${workspaceId}`)
        await create(sessionId, workspaceId)
      } else if (!enabled && managed) {
        latest.current.onPick(managed.sourceWorkspaceId as WorkspaceId)
      }
    } catch (error) {
      store.report(error)
    } finally {
      preferenceBusy.current = false
      setSaving(false)
      if (!enabled) store.clearBlock(sessionId)
      void store.refresh()
    }
  }
  useEffect(() => {
    if (!available) setFlowOpen(false)
  }, [available])
  const openDirectory = () => {
    props.onClose()
    setFolderError(null)
    setFlowOpen(true)
  }
  useEffect(() => {
    if (
      props.open &&
      workspaceSnapshot.phase === 'ready' &&
      workspaceSnapshot.items.length === 0 &&
      available &&
      !flowOpen &&
      !adopting
    )
      openDirectory()
  }, [
    props.open,
    workspaceSnapshot.phase,
    workspaceSnapshot.items.length,
    available,
    flowOpen,
    adopting,
  ])
  useLayoutEffect(() => {
    if (!props.open) return
    const position = () => {
      const rect = props.anchorRef?.current?.getBoundingClientRect()
      if (rect)
        setMenuPosition({
          top: Math.min(rect.bottom + 6, window.innerHeight - 100),
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
        })
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [props.open, props.anchorRef])
  useEffect(() => {
    if (!props.open) return
    menu.current
      ?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"], button')
      ?.focus()
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        !menu.current?.contains(target) &&
        !props.anchorRef?.current?.contains(target)
      )
        props.onClose()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        props.onClose()
        props.anchorRef?.current?.focus()
      }
      if (event.key === 'Tab') props.onClose()
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const items = [
        ...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
      ]
      if (!items.length) return
      event.preventDefault()
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key, true)
    }
  }, [props.open, props.onClose, props.anchorRef])
  const folderFailure = (message: string) => {
    setFlowOpen(false)
    setFolderError(message)
  }
  const pickWorkspace = (workspaceId: WorkspaceId) => {
    props.onClose()
    props.onPick(workspaceId)
  }
  const menuOpen = props.open && (workspaceSnapshot.items.length > 0 || !available)
  return (
    <>
      {blank && (
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            whiteSpace: 'nowrap',
          }}
          title={
            ready
              ? state.status?.reason ||
                'Remember this choice for the source workspace. Turning off keeps the checkout.'
              : 'Checking worktree availability…'
          }
        >
          <input
            type="checkbox"
            checked={checked}
            disabled={!ready || busy || (!checked && !state.status?.canCreate)}
            onChange={(event) => {
              void toggle(event.target.checked)
            }}
          />
          {busy ? 'Preparing worktree…' : 'Use worktree'}
        </label>
      )}
      {menuOpen && (
        <div
          ref={menu}
          role="menu"
          aria-label="Workspaces"
          style={{
            ...surface,
            position: 'fixed',
            ...menuPosition,
            width: 290,
            maxHeight: 'min(420px, 65vh)',
            overflow: 'auto',
            padding: 6,
            zIndex: 500,
            boxShadow: '0 6px 24px rgb(0 0 0 / 15%)',
          }}
        >
          {workspaceSnapshot.items.map((workspace) => (
            <button
              key={workspace.workspaceId}
              type="button"
              role="menuitemradio"
              aria-checked={props.selectedId === workspace.workspaceId}
              disabled={adopting}
              title={workspace.path}
              style={{
                ...action,
                display: 'block',
                width: '100%',
                textAlign: 'left',
                marginBottom: 3,
              }}
              onClick={() => pickWorkspace(workspace.workspaceId)}
            >
              {workspace.title || 'Default workspace'}
              {props.selectedId === workspace.workspaceId ? ' ✓' : ''}
            </button>
          ))}
          {workspaceSnapshot.phase === 'pending' && <p role="status">Loading workspaces…</p>}
          {available && (
            <button
              type="button"
              role="menuitem"
              disabled={adopting}
              style={{ ...action, width: '100%', textAlign: 'left' }}
              onClick={openDirectory}
            >
              Add workspace…
            </button>
          )}
          {!available && workspaceSnapshot.items.length === 0 && <p>No workspaces available.</p>}
        </div>
      )}
      {props.renderSlot(DIRECTORY_ALIAS, {
        open: flowOpen,
        busy: adopting,
        onPicked: (path) => {
          if (adopting) return
          setAdopting(true)
          void props
            .createWorkspace({ path })
            .then((workspace) => {
              setFlowOpen(false)
              pickWorkspace(workspace.workspaceId)
            })
            .catch((error: unknown) =>
              folderFailure(error instanceof Error ? error.message : 'Could not add workspace.'),
            )
            .finally(() => setAdopting(false))
        },
        onCancel: () => setFlowOpen(false),
        onError: folderFailure,
      })}
      {folderError && (
        <Dialog
          title="Could not add workspace"
          onClose={() => setFolderError(null)}
          footer={
            <>
              <button type="button" style={action} onClick={() => setFolderError(null)}>
                Cancel
              </button>
              <button type="button" style={action} disabled={!available} onClick={openDirectory}>
                Choose again
              </button>
            </>
          }
        >
          <p role="alert">{folderError}</p>
        </Dialog>
      )}
    </>
  )
}
