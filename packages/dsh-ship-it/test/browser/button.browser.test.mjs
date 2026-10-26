import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { ShipItButton } from '../../client/button.tsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root
let container

function source(initial) {
  let value = initial
  const listeners = new Set()
  return {
    use(selector) {
      return selector(
        React.useSyncExternalStore(
          (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
          () => value,
        ),
      )
    },
    set(next) {
      value = next
      for (const listener of listeners) listener()
    },
  }
}

const ready = {
  blank: false,
  subagent: null,
  removed: false,
  openState: 'open',
  running: false,
  pendingSubmissions: [],
}
const ship = () => page.getByRole('button', { name: 'Ship it', exact: true })

async function mount(send = async () => {}) {
  const session = source(ready)
  const access = source(true)
  const input = source({ phase: 'plain' })
  const block = source(undefined)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      React.createElement(ShipItButton, {
        sessionId: 'owner',
        useSession: session.use,
        useInput: input.use,
        useBlock: block.use,
        useAccess: (endpoint) => {
          expect(endpoint).toBe('session/prompt')
          return access.use((value) => value)
        },
        send,
      }),
    ),
  )
  return { session, access, input, block }
}

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  root = undefined
  container?.remove()
})

test('native lifecycle, access and composer blocks prevent shipping independently', async () => {
  const sources = await mount()
  await expect.element(ship()).toBeEnabled()
  for (const change of [
    { running: true },
    { openState: 'loading' },
    { removed: true },
    { pendingSubmissions: [{}] },
  ]) {
    await act(async () => sources.session.set({ ...ready, ...change }))
    await expect.element(ship()).toBeDisabled()
    await act(async () => sources.session.set(ready))
    await expect.element(ship()).toBeEnabled()
  }
  await act(async () => sources.access.set(false))
  await expect.element(ship()).toBeDisabled()
  await act(async () => sources.access.set(true))
  for (const phase of ['adjudicating', 'submitting']) {
    await act(async () => sources.input.set({ phase }))
    await expect.element(ship()).toBeDisabled()
  }
  await act(async () => sources.input.set({ phase: 'plain' }))
  await act(async () => sources.block.set({ reason: 'Fixture composer block' }))
  await expect.element(ship()).toBeDisabled()
  await expect.element(ship()).toHaveAttribute('title', 'Fixture composer block')
  await act(async () => sources.block.set(undefined))
  await expect.element(ship()).toBeEnabled()
  for (const change of [{ blank: true }, { subagent: { address: {} } }]) {
    await act(async () => sources.session.set({ ...ready, ...change }))
    expect(container.querySelector('button')).toBeNull()
  }
})

test('repeated activation admits once until settlement and a failure stays visible without retry', async () => {
  let settle
  let calls = 0
  await mount(() => {
    calls++
    return new Promise((_, reject) => {
      settle = reject
    })
  })
  await act(async () => {
    // Both activations occur before React commits the disabled state.
    container.querySelector('button').click()
    container.querySelector('button').click()
  })
  expect(calls).toBe(1)
  await expect.element(ship()).toBeDisabled()
  await expect.element(ship()).toHaveAttribute('aria-busy', 'true')
  await act(async () => settle(new Error('Unconfirmed fixture admission')))
  await expect.element(ship()).toBeEnabled()
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent(
      'Could not confirm the shipping request. Check the conversation before trying again.',
    )
  expect(calls).toBe(1)
})
