import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { ActivityPill } from '../../client/activity.tsx'

let root, container
const controllers = []
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  controllers.splice(0)
  vi.useRealTimers()
})
function connection() {
  let state = 'connected'
  const listeners = new Set()
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(value) {
      state = value
      listeners.forEach((listener) => listener())
    },
    listeners,
  }
}
const snapshot = (extra = {}) => ({
  coordinatorId: 'coord',
  occupied: 2,
  active: 1,
  queued: 3,
  workers: [{ workerId: 'worker-1', title: '<img src=x onerror=window.pwned=1>' }],
  ...extra,
})
async function mount(props) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      React.createElement(ActivityPill, {
        sessionId: 'coord',
        useProjection: () => 'dispatch',
        ...props,
      }),
    ),
  )
}

test('activity stays coordinator-scoped, distinguishes waiting and unknown, and navigates without interpreting titles', async () => {
  const source = connection()
  let value = snapshot()
  const opened = []
  await mount({
    connection: source,
    openSession: (id) => opened.push(id),
    request: async (endpoint, input, signal) => {
      expect(endpoint).toBe('activity')
      expect(input).toEqual({ sessionId: 'coord' })
      controllers.push(signal)
      return value
    },
  })
  const pill = page.getByRole('button', {
    name: 'Dispatch activity: 2 occupied, 1 active, 3 queued',
  })
  await expect.element(pill).toBeVisible()
  expect(container.querySelector('img')).toBeNull()
  expect(window.pwned).toBeUndefined()
  await pill.click()
  expect(opened).toEqual(['worker-1'])
  const button = container.querySelector('button')
  button.focus()
  expect(document.activeElement).toBe(button)
  await act(async () => source.set('disconnected'))
  expect(container.textContent).toContain('unavailable')
  expect(container.textContent).not.toContain('2 occupied')
  expect(container.querySelector('button')).toBeNull()
  expect(controllers[0].aborted).toBe(true)
  value = snapshot({ active: 0, queued: 5 })
  await act(async () => source.set('connected'))
  expect(container.textContent).toContain('waiting')
  expect(container.querySelector('button').getAttribute('aria-label')).toContain('Queue full')
  expect(source.listeners.size).toBe(1)
  await act(async () => source.set('disconnected'))
  value = snapshot({ active: null })
  await act(async () => source.set('connected'))
  expect(container.textContent).toContain('activity unknown')
  expect(container.querySelector('button').getAttribute('aria-label')).toContain('unknown active')
  await act(async () => root.unmount())
  expect(source.listeners.size).toBe(0)
})

test('loading, invalid responses, transport errors and identity switches never show false zero or stale counts', async () => {
  const source = connection()
  const pending = Promise.withResolvers()
  let signal
  await mount({
    connection: source,
    request: async (_endpoint, _input, abort) => {
      signal = abort
      return pending.promise
    },
  })
  expect(container.textContent).toContain('loading')
  expect(container.textContent).not.toContain('0 occupied')
  await act(async () => pending.resolve(snapshot({ coordinatorId: 'another-coordinator' })))
  expect(container.textContent).toContain('unavailable')
  expect(container.textContent).not.toContain('2 occupied')
  await act(async () =>
    root.render(
      React.createElement(ActivityPill, {
        sessionId: 'another',
        useProjection: () => 'dispatch',
        connection: source,
        request: async () => {
          throw new Error('transport unavailable')
        },
      }),
    ),
  )
  expect(signal.aborted).toBe(true)
  expect(container.textContent).toContain('unavailable')
  await act(async () =>
    root.render(
      React.createElement(ActivityPill, {
        sessionId: 'another',
        useProjection: () => 'standard',
        connection: source,
        request: async () => {
          throw new Error('must not read a non-coordinator')
        },
      }),
    ),
  )
  expect(container.textContent).toBe('')
})

test('polling is sequential, reads live counts and aborts on disposal', async () => {
  vi.useFakeTimers()
  const source = connection()
  const pending = Promise.withResolvers()
  let reads = 0
  let signal
  await mount({
    connection: source,
    request: async (_endpoint, _input, abort) => {
      signal = abort
      return ++reads === 1 ? snapshot() : pending.promise
    },
  })
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(reads).toBe(2)
  await act(async () => vi.advanceTimersByTimeAsync(10000))
  expect(reads).toBe(2, 'a held read never overlaps another read')
  await act(async () =>
    pending.resolve(snapshot({ occupied: 0, active: 0, queued: 0, workers: [] })),
  )
  expect(container.textContent).toContain('0 occupied')
  expect(container.textContent).toContain('idle')
  expect(container.textContent).not.toContain('queued')
  await act(async () => root.unmount())
  expect(signal.aborted).toBe(true)
  await act(async () => vi.advanceTimersByTimeAsync(10000))
  expect(reads).toBe(2)
})
