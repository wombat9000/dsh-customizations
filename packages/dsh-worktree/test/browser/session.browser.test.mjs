import React, { act, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { test, expect, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { mountHeroPicker } from '../../client/session-slot.tsx'
import { SessionPicker } from '../../client/session-picker.tsx'
import { createSessionStore } from '../../client/session-store.ts'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const HERO = 'conversation.hero.workspace'
const FLOW = `${HERO}.directoryFlow`
const ALIAS = 'conversation.hero.worktree.directoryFlow'

// Primary registration contract: use the actual pinned SlotCore, not a copied
// native UI. The real-shell journey owns native rendering and directory I/O.
test('picker shadow and directory alias preserve native registrations through replacement and disposal', async () => {
  const core = new SlotCore()
  const NativePicker = () => null,
    NativeFlow = () => null,
    NextFlow = () => null
  const framework = core.registerFactory(
    { name: 'fixture', scope: 'root', children: { [HERO]: { kind: 'single', scope: 'root' } } },
    () => null,
  )
  const nativePicker = core.register(
    { name: HERO, children: { [FLOW]: { kind: 'single', scope: 'root' } } },
    NativePicker,
  )
  let nativeFlow = core.register({ name: FLOW, inject: () => ({ marker: 'original' }) }, NativeFlow)
  const original = core.entries(HERO)[0]
  Object.freeze(original)
  const cleanup = []
  const ctx = {
    workspaces: { create: vi.fn() },
    slots: {
      entries: (key) => core.entries(key),
      subscribe: (key, callback) => core.subscribe(key, callback),
      inject: (key, callback) => {
        expect(core.spec(key)).toBeDefined()
        const off = callback()
        if (typeof off === 'function') cleanup.push(off)
      },
      register: (options, Component) => {
        const off = core.register(options, Component)
        cleanup.push(off)
        return off
      },
    },
  }
  try {
    mountHeroPicker(ctx, {})
    expect(core.entriesOfSlot(HERO)[0].component).not.toBe(NativePicker)
    expect(original.component).toBe(NativePicker)
    expect(core.entries(ALIAS)[0].component).toBe(NativeFlow)
    expect(core.entries(ALIAS)[0].inject()).toEqual({ marker: 'original' })
    nativeFlow()
    nativeFlow = core.register({ name: FLOW, inject: () => ({ marker: 'replacement' }) }, NextFlow)
    await Promise.resolve()
    expect(core.entries(ALIAS)[0].component).toBe(NextFlow)
    expect(core.entries(ALIAS)[0].inject()).toEqual({ marker: 'replacement' })
    for (const off of cleanup.reverse()) off()
    expect(core.entriesOfSlot(HERO)[0].component).toBe(NativePicker)
    expect(core.entriesOfSlot(FLOW)[0].component).toBe(NextFlow)
    expect(core.spec(ALIAS)).toBeUndefined()
  } finally {
    for (const off of cleanup.reverse()) off()
    nativeFlow()
    nativePicker()
    framework()
  }
})

function observable(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: (callback) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    set(next) {
      value = next
      for (const callback of listeners) callback()
    },
  }
}
function useSelector(store, selector) {
  return selector(useSyncExternalStore(store.subscribe, store.getSnapshot))
}
const row = (id, current = 1) => ({ id, blank: true, retainedBy: { mainView: current } })
async function pickerFixture(handler) {
  const catalog = observable({ byId: { source: row('source') } })
  const session = observable({ blank: true, promptAttempted: false })
  const workspaces = observable({
    phase: 'ready',
    items: [{ workspaceId: 'source-workspace', title: 'Source', path: '/repo' }],
  })
  const leases = new Map()
  const status = {
    records: [],
    current: null,
    sourceWorkspaceId: 'source-workspace',
    defaultEnabled: false,
    canCreate: true,
    reason: '',
  }
  const rpc = {
    call: vi.fn(async (_channel, endpoint, input) => {
      if (endpoint === 'status')
        return {
          ok: true,
          value: {
            ...status,
            defaultEnabled: input.sessionId === 'other' ? false : status.defaultEnabled,
            sourceWorkspaceId: input.sessionId === 'other' ? 'other-workspace' : 'source-workspace',
          },
        }
      if (endpoint === 'preference') {
        status.defaultEnabled = input.enabled
        return { ok: true, value: { enabled: input.enabled, workspaceId: input.workspaceId } }
      }
      return handler(endpoint, input, status)
    }),
  }
  const ctx = {
    sessions: { list: catalog, binding: () => ({ session }), refresh: vi.fn(async () => {}) },
    workspaces: { list: workspaces, create: vi.fn() },
    uiWorkspace: { openSession: vi.fn(), archiveSession: vi.fn() },
    connection: { rpc },
    conversation: {
      blocks: {
        set: (id, value) => {
          leases.set(id, value)
        },
        storeFor: (id) => ({ getSnapshot: () => leases.get(id) }),
      },
    },
  }
  const store = createSessionStore(ctx)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const onPick = vi.fn()
  const props = {
    ctx,
    store,
    open: false,
    selectedId: 'source-workspace',
    onPick,
    onClose: vi.fn(),
    useSessions: (selector) => useSelector(catalog, selector),
    useWorkspaces: (selector) => useSelector(workspaces, selector),
    useDirectoryFlow: (selector) => selector(false),
    createWorkspace: ctx.workspaces.create,
    renderSlot: () => null,
    t: (key) => key,
  }
  let stop
  await act(async () => {
    stop = store.start()
    root.render(React.createElement(SessionPicker, props))
  })
  return {
    ctx,
    store,
    rpc,
    catalog,
    props,
    onPick,
    leases,
    container,
    async render() {
      await act(async () => root.render(React.createElement(SessionPicker, props)))
    },
    async click() {
      await act(async () => container.querySelector('input[type="checkbox"]').click())
    },
    async close() {
      await act(async () => {
        root.unmount()
        stop()
      })
      container.remove()
    },
  }
}

test('creation failure keeps first submit blocked until explicit opt-out', async () => {
  const f = await pickerFixture(async () => ({
    ok: false,
    error: { code: 'fixture/create-failed', message: 'Checkout retained.' },
  }))
  try {
    await f.click()
    expect(f.container.querySelector('input').checked).toBe(true)
    expect(f.onPick).not.toHaveBeenCalled()
    expect(f.leases.get('source')?.reason).toMatch(/Worktree requested/)
    await f.click()
    expect(f.container.querySelector('input').checked).toBe(false)
    expect(f.leases.get('source')).toBeUndefined()
    expect(f.rpc.call.mock.calls.filter(([, method]) => method === 'create')).toHaveLength(1)
  } finally {
    await f.close()
  }
})

test('retired native binding is not a blank composer while its catalog lease disappears', async () => {
  const f = await pickerFixture(async () => ({ ok: false }))
  try {
    f.ctx.sessions.binding = () => {
      throw new Error('uiConversation.binding: unknown session "source"')
    }
    await f.render()
    await act(async () => {
      await f.store.request('preference', { workspaceId: 'source-workspace', enabled: true })
      await f.store.refresh()
    })
    expect(f.container.querySelector('input[type="checkbox"]')).toBeNull()
    expect(f.rpc.call.mock.calls.some(([, endpoint]) => endpoint === 'create')).toBe(false)
    expect(f.onPick).not.toHaveBeenCalled()
  } finally {
    await f.close()
  }
})

test('late creation stays in the ledger without overriding a newer selection or another block owner', async () => {
  let resolve
  const waiting = new Promise((done) => {
    resolve = done
  })
  const created = {
    sessionId: 'created-session',
    sourceWorkspaceId: 'source-workspace',
    workspaceId: 'created-workspace',
    path: '/repo/.dsh/worktrees/session-fixture',
    branch: 'worktree/session-fixture',
    sourceRef: 'refs/heads/main',
    head: 'a'.repeat(40),
    state: 'active',
    message: '',
    branchDeleted: false,
  }
  const f = await pickerFixture(async (_endpoint, _input, status) => {
    await waiting
    status.records = [created]
    return { ok: true, value: created }
  })
  try {
    // Start, but do not await, the mutation's controlled response.
    await act(async () => {
      f.container.querySelector('input').click()
      await Promise.resolve()
    })
    const external = { reason: 'Another plugin owns this block.' }
    f.leases.set('source', external)
    f.props.selectedId = 'other-workspace'
    await act(async () => {
      f.catalog.set({ byId: { source: row('source', 0), other: row('other') } })
    })
    await f.render()
    await act(async () => {
      resolve()
      await waiting
      await Promise.resolve()
    })
    expect(f.onPick).not.toHaveBeenCalled()
    expect(f.leases.get('source')).toBe(external)
    expect(
      f.store.getSnapshot().records.some((record) => record.sessionId === created.sessionId),
    ).toBe(true)
  } finally {
    resolve()
    await f.close()
  }
})
