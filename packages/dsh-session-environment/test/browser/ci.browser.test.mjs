import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { CIRows, useEnvironmentVisible, useLiveCI } from '../../src/client/ci.ts'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root
let container
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
})
async function render(component) {
  if (!root) {
    container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => root.render(component))
}
const key = 'a'.repeat(64)
const value = (checkoutKey = key) => ({
  checkoutKey,
  checkedAt: Date.now() - 9000,
  refreshAfterMs: 25000,
  freshUntil: Date.now() + 16000,
  stale: false,
  error: null,
  rows: [
    {
      kind: 'current',
      label: 'PR #42',
      sha: 'a'.repeat(40),
      url: 'https://github.com/acme/repo/pull/42/checks',
      state: 'running',
      complete: true,
      count: 1,
      mismatch: true,
      warning: null,
    },
    {
      kind: 'default',
      label: 'Default · trunk',
      sha: 'b'.repeat(40),
      url: `https://github.com/acme/repo/commit/${'b'.repeat(40)}/checks`,
      state: 'no-checks',
      complete: true,
      count: 0,
      mismatch: false,
      warning: null,
    },
  ],
})
test('compact rows expose immutable SHA links, age, no-checks and local mismatch', async () => {
  await render(React.createElement(CIRows, { snapshot: value(), available: true }))
  await expect.element(page.getByText('PR #42', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Default · trunk', { exact: true })).toBeVisible()
  await expect.element(page.getByText('No checks', { exact: true })).toBeVisible()
  await expect
    .element(page.getByText('Local HEAD differs · checks cover remote code', { exact: true }))
    .toBeVisible()
  await expect
    .element(page.getByRole('link', { name: 'PR #42 checks at aaaaaaa' }))
    .toHaveAttribute('href', 'https://github.com/acme/repo/pull/42/checks')
  expect(container.textContent).toMatch(/9s ago/)
  const stale = value()
  stale.stale = true
  stale.error = 'CI unavailable (RATE_LIMITED)'
  stale.rows[1].complete = false
  stale.rows[1].state = 'unknown'
  stale.rows[1].warning = 'Partial checks (pagination bound)'
  await render(React.createElement(CIRows, { snapshot: stale, available: true }))
  expect(container.textContent).toContain('stale')
  expect(container.textContent).toContain('partial')
  expect(container.textContent).toContain('RATE_LIMITED')
  expect(container.textContent).not.toContain('success')
})

test('cached success uses stable expiry rather than remaining refresh delay and preserves stale failures', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(60000)
  const cached = value()
  cached.checkedAt = 1000
  cached.freshUntil = 61000
  cached.refreshAfterMs = 15000
  cached.rows[0].state = 'success'
  await render(React.createElement(CIRows, { snapshot: cached, available: true }))
  expect(container.textContent).toContain('59s ago')
  expect(container.textContent).not.toContain('stale')
  cached.stale = true
  cached.error = 'CI unavailable (RATE_LIMITED)'
  await render(React.createElement(CIRows, { snapshot: { ...cached }, available: true }))
  expect(container.textContent).toContain('stale')
  expect(container.textContent).toContain('59s ago')
  cached.stale = false
  vi.setSystemTime(72000)
  await render(React.createElement(CIRows, { snapshot: { ...cached }, available: true }))
  expect(container.textContent).toContain('stale')
})

test('visibility tracks hidden shell and page but ignores streamed text and unrelated styling', async () => {
  function View() {
    const ref = React.useRef(null)
    const visible = useEnvironmentVisible(ref, true)
    return React.createElement('section', { ref }, visible ? 'active' : 'paused')
  }
  await render(React.createElement(View))
  const section = container.querySelector('section')
  const rects = vi.spyOn(section, 'getClientRects')
  const frame = () =>
    act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
  const stream = document.createElement('div')
  container.append(stream)
  for (let i = 0; i < 100; i++) {
    stream.append(document.createTextNode('chunk'))
    stream.className = `stream-${i}`
    stream.style.color = 'red'
  }
  await frame()
  expect(rects).not.toHaveBeenCalled()
  // The real DSH shell marker mounting/navigation is covered by its shell journey.
  const marker = document.createElement('div')
  marker.setAttribute('data-chat-flow', '')
  container.append(marker)
  container.hidden = true
  await frame()
  expect(container.textContent).toContain('paused')
  expect(rects).toHaveBeenCalledTimes(1)
  container.hidden = false
  await frame()
  expect(container.textContent).toContain('active')
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(container.textContent).toContain('paused')
})

test('controlled cadence pauses when hidden and rejects late checkout/session/disposal results', async () => {
  vi.useFakeTimers()
  const calls = []
  const remote = {
    readCI: vi.fn(
      (request, signal) => new Promise((resolve) => calls.push({ request, signal, resolve })),
    ),
  }
  function View({ request, visible }) {
    const snapshot = useLiveCI(remote, request, visible)
    return React.createElement(CIRows, { snapshot, available: true })
  }
  const request = { sessionId: 'first', checkoutKey: key }
  const view = (request, visible = true) => React.createElement(View, { request, visible })
  await render(view(request))
  expect(calls).toHaveLength(1)
  await act(async () => calls[0].resolve({ ok: true, value: value() }))
  await act(async () => vi.advanceTimersByTime(24000))
  expect(calls).toHaveLength(1)
  await act(async () => vi.advanceTimersByTime(1000))
  expect(calls).toHaveLength(2)
  await render(view(request, false))
  expect(calls[1].signal.aborted).toBe(true)
  await act(async () => vi.advanceTimersByTime(300000))
  expect(calls).toHaveLength(2)
  const switched = { sessionId: 'second', checkoutKey: 'b'.repeat(64) }
  await render(view(switched))
  expect(calls).toHaveLength(3)
  await act(async () => calls[1].resolve({ ok: true, value: value() }))
  expect(container.textContent).not.toContain('PR #42')
  await render(view({ ...switched, checkoutKey: 'c'.repeat(64) }))
  expect(calls[2].signal.aborted).toBe(true)
  await act(async () => calls[2].resolve({ ok: true, value: value(switched.checkoutKey) }))
  expect(container.textContent).not.toContain('PR #42')
  await act(async () => root.unmount())
  root = undefined
  expect(calls[3].signal.aborted).toBe(true)
  await act(async () => calls[3].resolve({ ok: true, value: value('c'.repeat(64)) }))
  expect(container.textContent).toBe('')
})
