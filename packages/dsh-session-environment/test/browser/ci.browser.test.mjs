import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
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
      checks: [{ name: 'Tests', state: 'running' }],
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
  stale.rows[0].complete = false
  stale.rows[1].complete = false
  stale.rows[1].state = 'unknown'
  stale.rows[1].warning = 'Partial checks (pagination bound)'
  await render(React.createElement(CIRows, { snapshot: stale, available: true }))
  expect(container.textContent).toContain('stale')
  expect(container.textContent).toContain('partial')
  expect(container.textContent).toContain('RATE_LIMITED')
  expect(container.textContent).not.toContain('success')
  const bar = container.querySelector('[role="list"]')
  expect(bar.getAttribute('aria-label')).toContain('stale · partial')
  expect(getComputedStyle(bar).opacity).toBe('0.55')
})

test('check partitions keep fixed total width, equal shares, GitHub colors and safe hover labels', async () => {
  const snapshot = value()
  await render(React.createElement(CIRows, { snapshot, available: true }))
  container.style.width = '268px'
  container.style.setProperty('--dsw-alias-bg-layer-1', '#ffffff')
  const states = [
    'success',
    'running',
    'pending',
    'failure',
    'skipped',
    'cancelled',
    'neutral',
    'unknown',
    'stale',
  ]
  const colors = ['rgb(63, 185, 80)', 'rgb(210, 153, 34)', 'rgb(110, 118, 129)', 'rgb(248, 81, 73)']
  for (const count of [1, 3, 10, 400]) {
    snapshot.rows[0].count = count
    snapshot.rows[0].checks = Array.from({ length: count }, (_, index) => ({
      name: index === 0 ? '<img src=x onerror=alert(1)> ' + 'x'.repeat(200) : `Check ${index + 1}`,
      state: states[index % states.length],
    }))
    await render(React.createElement(CIRows, { snapshot: { ...snapshot }, available: true }))
    const bar = container.querySelector('[role="list"]')
    const segments = [...bar.querySelectorAll('[role="listitem"]')]
    expect(bar.getBoundingClientRect().width).toBe(268)
    expect(bar.getBoundingClientRect().height).toBe(8)
    expect(bar.scrollWidth).toBe(268)
    expect(segments).toHaveLength(count)
    for (const [index, segment] of segments.entries()) {
      expect(segment.getBoundingClientRect().width).toBeCloseTo(268 / count, 1)
      const stateIndex = index % states.length
      expect(getComputedStyle(segment).backgroundColor).toBe(colors[stateIndex] ?? colors[2])
      expect(segment.title).toBe(`${snapshot.rows[0].checks[index].name}: ${states[stateIndex]}`)
      if (stateIndex >= 4) expect(getComputedStyle(segment).backgroundImage).not.toBe('none')
      // Decorative separators must leave at least 90% of each status color visible.
      const separatorWidths = [
        ...[...getComputedStyle(segment).boxShadow.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((match) =>
          Math.abs(Number(match[1])),
        ),
        ...[...segment.querySelectorAll('[aria-hidden="true"]')].map(
          (separator) => separator.getBoundingClientRect().width,
        ),
      ]
      expect(Math.max(0, ...separatorWidths)).toBeLessThanOrEqual(
        segment.getBoundingClientRect().width * 0.1 + 0.02,
      )
    }
    expect(container.querySelector('img')).toBeNull()
  }
  await expect
    .element(page.getByRole('link', { name: 'Open PR #42 checks on GitHub', exact: true }))
    .toHaveAttribute('href', 'https://github.com/acme/repo/pull/42/checks')
  // No checks and older aggregate-only providers must not invent partitions.
  snapshot.rows[0].checks = []
  await render(React.createElement(CIRows, { snapshot: { ...snapshot }, available: true }))
  expect(container.querySelector('[role="list"]')).toBeNull()
  delete snapshot.rows[0].checks
  await render(React.createElement(CIRows, { snapshot: { ...snapshot }, available: true }))
  expect(container.querySelector('[role="list"]')).toBeNull()
})

test('one keyboard stop exposes each check without an expanded panel and dismisses on blur or Escape', async () => {
  const snapshot = value()
  snapshot.rows[0].count = 3
  snapshot.rows[0].checks = [
    { name: 'Lint', state: 'success' },
    { name: 'Tests', state: 'running' },
    { name: 'Build', state: 'pending' },
  ]
  await render(React.createElement(CIRows, { snapshot, available: true }))
  const link = page
    .getByRole('link', { name: 'Open PR #42 checks on GitHub', exact: true })
    .element()
  const tooltip = page.getByRole('tooltip')
  await expect.element(tooltip).not.toBeInTheDocument()
  await act(async () => link.focus())
  await expect.element(tooltip).toHaveTextContent('Lint: success · 1/3 (←/→)')
  for (const modifier of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
      ...modifier,
    })
    await act(async () => {
      link.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(false)
    await expect.element(tooltip).toHaveTextContent('Lint: success · 1/3 (←/→)')
  }
  await act(async () => userEvent.keyboard('{ArrowRight}'))
  await expect.element(tooltip).toHaveTextContent('Tests: running · 2/3 (←/→)')
  await act(async () => userEvent.keyboard('{End}'))
  await expect.element(tooltip).toHaveTextContent('Build: pending · 3/3 (←/→)')
  await act(async () => userEvent.keyboard('{ArrowRight}'))
  await expect.element(tooltip).toHaveTextContent('Lint: success · 1/3 (←/→)')
  await act(async () => userEvent.keyboard('{ArrowLeft}'))
  await expect.element(tooltip).toHaveTextContent('Build: pending · 3/3 (←/→)')
  await act(async () => userEvent.keyboard('{Home}'))
  await expect.element(tooltip).toHaveTextContent('Lint: success · 1/3 (←/→)')
  await act(async () => userEvent.keyboard('{Escape}'))
  await expect.element(tooltip).not.toBeInTheDocument()
  await act(async () => userEvent.keyboard('{ArrowRight}'))
  await expect.element(tooltip).toHaveTextContent('Tests: running · 2/3 (←/→)')
  await act(async () => userEvent.keyboard('{Tab}'))
  expect(document.activeElement).toBe(
    page.getByRole('link', { name: 'PR #42 checks at aaaaaaa' }).element(),
  )
  await expect.element(tooltip).not.toBeInTheDocument()
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
