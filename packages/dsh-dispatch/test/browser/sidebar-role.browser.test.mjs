import React, { act, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import client from '../../client/index.ts'

// Real React/DOM with a native hook-shaped session-list fixture. This does not
// prove native slot election, Host authority, or assignment ownership.
let root, container, native
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  expect(native.rpcCalls).toEqual([])
  root = container = native = undefined
})

function registeredRoles(initial) {
  const registrations = new Map()
  const rpcCalls = []
  client.apply({
    slots: {
      inject: (_name, callback) => callback(),
      register: (seat, component) =>
        registrations.set(`${seat.name}:${seat.id ?? seat.key}`, component),
    },
    connection: {
      rpc: {
        call: (...args) => {
          rpcCalls.push(args)
          throw new Error('Sidebar role hints must not call RPC')
        },
      },
    },
  })
  const Icon = registrations.get('sidebar.session.row.trailing:local-dispatch-role')
  const Hover = registrations.get('sidebar.session.row.hover:local-dispatch-role')
  let snapshot = initial
  const listeners = new Set()
  const source = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish(value) {
      snapshot = value
      for (const listener of listeners) listener()
    },
    get subscribers() {
      return listeners.size
    },
  }
  function useSessions(selector) {
    return useSyncExternalStore(source.subscribe, () => selector(source.getSnapshot()))
  }
  function Pair({ sessionId }) {
    const props = { sessionId, useSessions }
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(Icon, props),
      React.createElement(Hover, props),
    )
  }
  return { Pair, source, rpcCalls }
}

async function render(sessionId) {
  if (!root) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => root.render(React.createElement(native.Pair, { sessionId })))
}

async function expectRole(label, mark, preset) {
  await expect.element(page.getByRole('img', { name: label, exact: true })).toHaveTextContent(mark)
  await expect.element(page.getByText(label, { exact: true })).toBeVisible()
  expect(container.querySelectorAll('[role="img"]')).toHaveLength(1)
  expect(container.querySelector('code').textContent).toBe(preset)
  expect(container.textContent).toContain(`Preset: ${preset}`)
}

test('registered icon and hover show the requested session role, not another list entry', async () => {
  native = registeredRoles({
    byId: {
      coordinator: { title: 'Worker title', projectionValues: { agentPreset: 'dispatch' } },
      worker: { title: 'Coordinator title', projectionValues: { agentPreset: 'dispatch-worker' } },
    },
  })
  await render('coordinator')
  await expectRole('Dispatch coordinator', 'D', 'dispatch')
  await render('worker')
  await expectRole('Dispatch Worker', 'W', 'dispatch-worker')
})

test('regular, unknown, and missing preset hints render nothing despite misleading titles', async () => {
  const noneCases = {
    regular: { projectionValues: { agentPreset: 'standard' } },
    unknown: { projectionValues: { agentPreset: 'dispatch-worker-preview' } },
    nullPreset: { projectionValues: { agentPreset: null } },
    missingPreset: { projectionValues: {} },
    missingProjection: {},
    missingSession: undefined,
  }
  native = registeredRoles({
    byId: {
      coordinator: { projectionValues: { agentPreset: 'dispatch' } },
      worker: { projectionValues: { agentPreset: 'dispatch-worker' } },
      ...Object.fromEntries(
        Object.entries(noneCases).map(([id, row]) => [
          id,
          row && { title: 'Dispatch coordinator / Dispatch Worker', ...row },
        ]),
      ),
    },
  })
  for (const sessionId of Object.keys(noneCases)) {
    await render(sessionId)
    expect(container.childNodes, sessionId).toHaveLength(0)
  }
})

test('session-list updates and navigation replace hints and unmount releases subscriptions', async () => {
  native = registeredRoles({
    byId: {
      first: { projectionValues: { agentPreset: 'dispatch' } },
      second: { projectionValues: { agentPreset: 'dispatch' } },
    },
  })
  await render('first')
  await expectRole('Dispatch coordinator', 'D', 'dispatch')
  expect(native.source.subscribers).toBeGreaterThan(0)

  await act(async () => native.source.publish({ byId: {} }))
  expect(container.childNodes).toHaveLength(0)
  await act(async () =>
    native.source.publish({
      byId: {
        first: { projectionValues: { agentPreset: 'dispatch-worker' } },
        second: { projectionValues: { agentPreset: 'dispatch' } },
      },
    }),
  )
  await expectRole('Dispatch Worker', 'W', 'dispatch-worker')

  await render('second')
  await expectRole('Dispatch coordinator', 'D', 'dispatch')
  await act(async () =>
    native.source.publish({
      byId: {
        first: { projectionValues: { agentPreset: 'dispatch-worker' } },
        second: { projectionValues: { agentPreset: 'standard' } },
      },
    }),
  )
  expect(container.childNodes).toHaveLength(0)

  await act(async () => root.unmount())
  root = undefined
  expect(native.source.subscribers).toBe(0)
  await act(async () =>
    native.source.publish({
      byId: { second: { projectionValues: { agentPreset: 'dispatch-worker' } } },
    }),
  )
  expect(container.childNodes).toHaveLength(0)
})
