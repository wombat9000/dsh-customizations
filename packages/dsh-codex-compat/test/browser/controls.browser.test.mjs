import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { FastToggle, IntegrationSettings } from '../../client/fast/controls.tsx'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
const status = (overrides) => ({
  enabled: true,
  revision: 0,
  available: true,
  error: null,
  sessionId: 'session-a',
  provider: 'openai-codex',
  model: 'gpt-6-sol',
  requested: false,
  supported: true,
  sessionRevision: 0,
  subagentsRequested: false,
  subagentsRevision: 0,
  sessionOffPending: false,
  subagentsOffPending: false,
  observation: 'none',
  notice: null,
  ...overrides,
})
const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
afterEach(async () => {
  if (root) await act(() => root.unmount())
  container?.remove()
  root = null
  vi.restoreAllMocks()
})
async function mount(component, props) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(React.createElement(component, props)))
}
const projection = { next: { provider: 'openai-codex', model: 'gpt-6-sol' }, lastUsed: null }
const fast = () => page.getByRole('button', { name: /^Fast mode:/ })
const boltFills = () =>
  [...container.querySelectorAll('svg')].map((svg) => svg.getAttribute('fill'))

// Real button/keyboard behavior with fixture RPC responses. Host policy owns persistence and safety.
test('one two-bolt button cycles Off → Everything Fast → Main thread only → Off', async () => {
  let saved = status()
  const responses = [
    status({ requested: true, subagentsRequested: true, sessionRevision: 1, subagentsRevision: 1 }),
    status({ requested: true, sessionRevision: 2, subagentsRevision: 2 }),
    status({ sessionRevision: 3, subagentsRevision: 3 }),
  ]
  const rpc = {
    call: vi.fn(async (_channel, method) => {
      if (method === 'mode-set') saved = responses.shift()
      return { ok: true, value: saved }
    }),
  }
  await mount(FastToggle, { rpc, sessionId: 'session-a', useProjection: () => projection })
  await expect.element(fast()).toHaveAccessibleName('Fast mode: Off')
  expect(container.querySelectorAll('button')).toHaveLength(1)
  expect(boltFills()).toEqual(['none', 'none'])
  await expect
    .element(fast())
    .toHaveAttribute('title', expect.stringContaining('2.5× included usage'))
  await expect
    .element(fast())
    .toHaveAttribute('title', expect.stringContaining('Click for Everything Fast.'))
  await act(async () => fast().click())
  await expect.element(fast()).toHaveAccessibleName('Fast mode: Everything Fast')
  expect(boltFills()).toEqual(['currentColor', 'currentColor'])
  await expect
    .element(fast())
    .toHaveAttribute('title', expect.stringContaining('Click for Main thread only.'))
  await act(async () => userEvent.keyboard('{Enter}'))
  await expect.element(fast()).toHaveAccessibleName('Fast mode: Main thread only')
  expect(boltFills()).toEqual(['currentColor', 'none'])
  await act(async () => userEvent.keyboard(' '))
  await expect.element(fast()).toHaveAccessibleName('Fast mode: Off')
  expect(boltFills()).toEqual(['none', 'none'])
  expect(rpc.call.mock.calls.filter((c) => c[1] === 'mode-set').map((c) => [c[1], c[2]])).toEqual([
    [
      'mode-set',
      {
        sessionId: 'session-a',
        provider: 'openai-codex',
        model: 'gpt-6-sol',
        mode: 'all',
        sessionRevision: 0,
        subagentsRevision: 0,
      },
    ],
    [
      'mode-set',
      {
        sessionId: 'session-a',
        provider: 'openai-codex',
        model: 'gpt-6-sol',
        mode: 'main',
        sessionRevision: 1,
        subagentsRevision: 1,
      },
    ],
    [
      'mode-set',
      {
        sessionId: 'session-a',
        provider: 'openai-codex',
        model: 'gpt-6-sol',
        mode: 'off',
        sessionRevision: 2,
        subagentsRevision: 2,
      },
    ],
  ])
})

test('pending changes disable the button and stale reads cannot undo the accepted mode', async () => {
  const slowRead = deferred(),
    change = deferred()
  let reads = 0
  const rpc = {
    call: vi.fn((_channel, method) => {
      if (method === 'mode-set') return change.promise
      return ++reads === 2 ? slowRead.promise : Promise.resolve({ ok: true, value: status() })
    }),
  }
  await mount(FastToggle, { rpc, sessionId: 'session-a', useProjection: () => projection })
  await act(() => window.dispatchEvent(new Event('focus')))
  await act(async () => fast().click())
  await expect.element(fast()).toBeDisabled()
  await expect.element(fast()).toHaveAccessibleName('Fast mode: Off')
  await act(async () =>
    change.resolve({ ok: true, value: status({ requested: true, subagentsRequested: true }) }),
  )
  await expect.element(fast()).toBeEnabled()
  await expect.element(fast()).toHaveFocus()
  await expect.element(fast()).toHaveAccessibleName('Fast mode: Everything Fast')
  await act(async () => slowRead.resolve({ ok: true, value: status() }))
  await expect.element(fast()).toHaveAccessibleName('Fast mode: Everything Fast')
})

test('session changes reject old mutation results and unsupported models cannot enable Fast', async () => {
  const slow = deferred()
  const rpc = {
    call: vi.fn((_channel, method, payload) => {
      if (method === 'mode-set') return slow.promise
      return Promise.resolve({
        ok: true,
        value: status({
          sessionId: payload.sessionId,
          ...(payload.sessionId === 'session-b'
            ? { supported: false, notice: 'Unsupported model' }
            : {}),
        }),
      })
    }),
  }
  await mount(FastToggle, { rpc, sessionId: 'session-a', useProjection: () => projection })
  await act(async () => fast().click())
  await act(async () =>
    root.render(
      React.createElement(FastToggle, {
        rpc,
        sessionId: 'session-b',
        useProjection: () => projection,
      }),
    ),
  )
  await act(async () =>
    slow.resolve({ ok: true, value: status({ requested: true, subagentsRequested: true }) }),
  )
  await expect.element(fast()).toHaveAccessibleName('Fast mode: Off')
  await expect.element(fast()).toBeDisabled()
  await expect
    .element(fast())
    .toHaveAttribute('title', expect.stringContaining('Unsupported model'))
  expect(boltFills()).toEqual(['none', 'none'])
})

test('malformed status disables the control and an explicit refresh recovers it', async () => {
  const rpc = { call: vi.fn().mockResolvedValue({ ok: true, value: { enabled: true } }) }
  await mount(FastToggle, { rpc, sessionId: 'session-a', useProjection: () => projection })
  await expect.element(fast()).toBeDisabled()
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Fast settings unavailable. Refresh to try again.')
  rpc.call.mockResolvedValue({ ok: true, value: status() })
  await act(async () => page.getByRole('button', { name: 'Refresh Fast status' }).click())
  await expect.element(fast()).toBeEnabled()
  await expect.element(fast()).toHaveAccessibleName('Fast mode: Off')
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  expect(container.querySelectorAll('button')).toHaveLength(1)
})

for (const pending of ['sessionOffPending', 'subagentsOffPending']) {
  test(`failed Off with ${pending} retries Off, even after selecting another provider`, async () => {
    let saved = status({ requested: true })
    let writes = 0
    const rpc = {
      call: vi.fn(async (_channel, method, payload) => {
        if (method === 'mode-set') {
          expect(payload.mode).toBe('off')
          writes++
          saved = status({ [pending]: writes === 1 })
          if (writes === 1) return { ok: false, error: { message: 'Retry Off to persist it.' } }
        }
        return { ok: true, value: saved }
      }),
    }
    await mount(FastToggle, { rpc, sessionId: 'session-a', useProjection: () => projection })
    await act(async () => fast().click())
    await expect.element(page.getByRole('alert')).toHaveTextContent('Retry Off to persist it.')
    await expect.element(fast()).toHaveAccessibleName('Fast mode: Off (unsaved change)')
    saved = { ...saved, provider: 'another-provider', model: 'another/model', supported: false }
    await act(() => window.dispatchEvent(new Event('focus')))
    await act(async () => fast().click())
    expect(writes).toBe(2)
    await expect.element(fast()).toHaveAccessibleName('Fast mode: Off')
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    expect(rpc.call.mock.calls.filter((c) => c[1] === 'mode-set').map((c) => c[2].mode)).toEqual([
      'off',
      'off',
    ])
    expect(rpc.call.mock.calls.filter((c) => c[1] === 'mode-set')[1][2].provider).toBe(
      'openai-codex',
    )
  })
}

test('disabled integration never shows filled bolts and permits only recovery Off', async () => {
  const rpc = {
    call: vi.fn().mockResolvedValue({
      ok: true,
      value: status({ enabled: false, requested: true, subagentsRequested: true }),
    }),
  }
  await mount(FastToggle, { rpc, sessionId: 'session-a', useProjection: () => projection })
  await expect.element(fast()).toHaveAccessibleName('Fast mode: Off')
  expect(boltFills()).toEqual(['none', 'none'])
  await act(async () => fast().click())
  expect(rpc.call.mock.calls[1][2].mode).toBe('off')
})

test('integration recovery is independent and can refresh after a transient status failure', async () => {
  const rpc = {
    call: vi
      .fn()
      .mockRejectedValueOnce(new Error('private transport diagnostic'))
      .mockResolvedValueOnce({
        ok: true,
        value: { enabled: true, revision: 3, available: false, error: 'Bridge unavailable' },
      })
      .mockResolvedValue({
        ok: true,
        value: { enabled: false, revision: 4, available: false, error: null },
      }),
  }
  await mount(IntegrationSettings, { rpc, view: 'page' })
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Fast integration status is unavailable.')
  expect(container.textContent).not.toContain('private transport diagnostic')
  await act(async () => page.getByRole('button', { name: 'Refresh integration status' }).click())
  const integration = page.getByRole('switch', { name: 'Codex Fast integration' })
  await expect.element(integration).toBeEnabled()
  await act(async () => integration.click())
  await expect.element(integration).toHaveAttribute('aria-checked', 'false')
  expect(rpc.call.mock.calls.at(-1)[2]).toEqual({ enabled: false, revision: 3 })
  expect(container.textContent).toContain('Codex login and Standard inference do not depend')
})
