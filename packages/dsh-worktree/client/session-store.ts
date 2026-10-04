import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  SESSION_CHANNEL,
  type CleanupConfirmation,
  type SessionEndpoints,
  type SessionRequest,
  type SessionRpcResult,
  type SessionWorktree,
  type SessionWorktreeStatus,
} from '../shared/session-contracts.ts'
import type { SessionClientContext } from './session-contracts.ts'

export interface SessionState {
  sessionId: SessionId | undefined
  status: SessionWorktreeStatus | null
  records: readonly SessionWorktree[]
  loading: boolean
  error: string | null
  readError: string | null
  busy: ReadonlySet<string>
  dialog: { record: SessionWorktree; confirmation: CleanupConfirmation } | null
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Session worktree request failed.'
}
export function currentSession(ctx: SessionClientContext): SessionId | undefined {
  const selected = Object.values(ctx.sessions.list.getSnapshot().byId).filter(
    (row) => (row.retainedBy.mainView ?? 0) > 0,
  )
  return selected.length === 1 ? selected[0]?.id : undefined
}
export function createSessionRequest(ctx: SessionClientContext): SessionRequest {
  const rpc = ctx.connection.rpc
  return async <E extends keyof SessionEndpoints>(
    endpoint: E,
    input: SessionEndpoints[E]['input'],
    signal?: AbortSignal,
  ) => {
    const response = await rpc.call(SESSION_CHANNEL, endpoint, input, signal)
    if (typeof response !== 'object' || response === null || !('ok' in response)) {
      throw new Error('Invalid session worktree response.')
    }
    // The package-owned host validates inputs and projects this private channel.
    // Connection does not transform its discriminated result envelope.
    const result = response as SessionRpcResult<SessionEndpoints[E]['value']>
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }
}

// One owner handles polling, action refreshes, stale selection, and cleanup
// prompts. Sidebar decorations only subscribe; they never make row RPC calls.
export function createSessionStore(ctx: SessionClientContext) {
  const request = createSessionRequest(ctx)
  const listeners = new Set<() => void>()
  const reviewed = new Set<string>()
  const blocks = new Map<SessionId, { reason: string }>()
  let state: SessionState = {
    sessionId: currentSession(ctx),
    status: null,
    records: [],
    loading: true,
    error: null,
    readError: null,
    busy: new Set(),
    dialog: null,
  }
  let disposed = false
  let controller: AbortController | null = null
  let pendingRefresh = false
  let reviewing = false
  const publish = (patch: Partial<SessionState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const setBusy = (id: string, busy: boolean) => {
    const next = new Set(state.busy)
    if (busy) next.add(id)
    else next.delete(id)
    publish({ busy: next })
  }
  const clearBlock = (id: SessionId) => {
    const block = blocks.get(id)
    if (!block) return
    // Do not clear a block another plugin raised while this request ran.
    if (ctx.conversation.blocks.storeFor(id).getSnapshot() === block) {
      ctx.conversation.blocks.set(id, undefined)
    }
    blocks.delete(id)
  }
  const block = (id: SessionId, reason = 'Preparing session worktree…') => {
    const own = blocks.get(id)
    const current = ctx.conversation.blocks.storeFor(id).getSnapshot()
    if (current && current !== own) return
    if (own?.reason === reason && current === own) return
    const value = { reason }
    blocks.set(id, value)
    ctx.conversation.blocks.set(id, value)
  }
  async function refresh() {
    if (disposed || document.visibilityState === 'hidden') return
    if (controller) {
      pendingRefresh = true
      return
    }
    const selected = state.sessionId
    const abort = new AbortController()
    controller = abort
    try {
      const status = await request('status', selected ? { sessionId: selected } : {}, abort.signal)
      if (disposed || abort.signal.aborted || selected !== state.sessionId) return
      publish({ status, records: status.records, loading: false, readError: null })
      void reviewNext()
    } catch (error) {
      if (!disposed && !abort.signal.aborted && selected === state.sessionId) {
        publish({ loading: false, readError: errorMessage(error) })
      }
    } finally {
      if (controller === abort) controller = null
      if (pendingRefresh && !disposed) {
        pendingRefresh = false
        void refresh()
      }
    }
  }
  async function cleanup(sessionId: string) {
    if (disposed || state.busy.has(sessionId)) return
    setBusy(sessionId, true)
    reviewed.add(sessionId)
    try {
      const result = await request('cleanup', { sessionId })
      if (disposed) return
      if (result.state === 'confirm' && result.confirmation) {
        publish({
          dialog: { record: result.record, confirmation: result.confirmation },
          error: null,
        })
      } else {
        publish({ error: result.state === 'pending' ? result.record.message : null })
      }
    } catch (error) {
      publish({ error: errorMessage(error) })
    } finally {
      setBusy(sessionId, false)
      void refresh()
    }
  }
  async function reviewNext() {
    if (disposed || reviewing || state.dialog) return
    const pending = state.records.find(
      (row) => row.state === 'pending' && !reviewed.has(row.sessionId),
    )
    if (!pending) return
    reviewing = true
    await cleanup(pending.sessionId)
    reviewing = false
    if (!state.dialog) void reviewNext()
  }
  const selectionChanged = () => {
    const next = currentSession(ctx)
    if (next === state.sessionId) return
    controller?.abort()
    const previous = state.sessionId
    if (previous && !state.busy.has(previous)) clearBlock(previous)
    publish({ sessionId: next, status: null, loading: true, error: null, readError: null })
    void refresh()
  }
  return {
    request,
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    refresh,
    block,
    clearBlock,
    report: (error: unknown) => publish({ error: errorMessage(error) }),
    dismissError: () => publish({ error: null, readError: null }),
    cleanup,
    keepCheckout() {
      publish({ dialog: null })
      void reviewNext()
    },
    async discardCheckout() {
      const dialog = state.dialog
      if (!dialog || disposed || state.busy.has(dialog.record.sessionId)) return
      const sessionId = dialog.record.sessionId
      setBusy(sessionId, true)
      try {
        // The confirmation is opaque, HEAD/file-bound, and expires on the host.
        // Only this explicit destructive button sends its exact identity.
        const result = await request('cleanup', {
          sessionId,
          confirmationId: dialog.confirmation.id,
        })
        if (result.state !== 'removed')
          throw new Error(result.record.message || 'Cleanup needs a new review.')
        publish({ dialog: null, error: null })
      } catch (error) {
        publish({ error: errorMessage(error) })
      } finally {
        setBusy(sessionId, false)
        void refresh()
        void reviewNext()
      }
    },
    async archive(sessionId: string) {
      if (disposed || state.busy.has(sessionId)) return
      setBusy(sessionId, true)
      try {
        // Public native archive semantics, including activity admission. This
        // also lets unused blank worktree sessions be archived from this page.
        await ctx.uiWorkspace.archiveSession(sessionId as SessionId)
        publish({ error: null })
      } catch (error) {
        publish({ error: errorMessage(error) })
      } finally {
        setBusy(sessionId, false)
        void refresh()
      }
    },
    async restore(sessionId: string) {
      if (disposed || state.busy.has(sessionId)) return
      setBusy(sessionId, true)
      try {
        const record = await request('restore', { sessionId })
        reviewed.delete(sessionId)
        if (disposed) return
        await ctx.sessions.refresh()
        if (!disposed) ctx.uiWorkspace.openSession(record.sessionId as SessionId)
      } catch (error) {
        publish({ error: errorMessage(error) })
      } finally {
        setBusy(sessionId, false)
        void refresh()
      }
    },
    async create(sessionId: SessionId, onCreated: (record: SessionWorktree) => void) {
      if (disposed || state.busy.has(sessionId)) return
      setBusy(sessionId, true)
      block(sessionId)
      try {
        const record = await request('create', { sessionId, requestId: crypto.randomUUID() })
        if (disposed) return
        await ctx.sessions.refresh()
        if (!disposed) onCreated(record)
      } catch (error) {
        publish({ error: errorMessage(error) })
      } finally {
        // Failure must not silently enable shared-checkout submission. The
        // picker clears this lease only after explicit opt-out or navigation.
        if (currentSession(ctx) !== sessionId) clearBlock(sessionId)
        setBusy(sessionId, false)
        void refresh()
      }
    },
    start() {
      const unsubscribe = ctx.sessions.list.subscribe(selectionChanged)
      const onVisible = () => {
        if (document.visibilityState === 'hidden') controller?.abort()
        else void refresh()
      }
      document.addEventListener('visibilitychange', onVisible)
      const timer = setInterval(() => {
        void refresh()
      }, 7500)
      void refresh()
      return () => {
        disposed = true
        controller?.abort()
        clearInterval(timer)
        unsubscribe()
        document.removeEventListener('visibilitychange', onVisible)
        for (const id of blocks.keys()) clearBlock(id)
        listeners.clear()
      }
    },
  }
}
export type SessionStore = ReturnType<typeof createSessionStore>
