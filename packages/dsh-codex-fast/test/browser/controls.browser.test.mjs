import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { FastToggle, IntegrationSettings } from '../../client/controls.tsx'
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

test('stale reads cannot undo a successful Fast toggle; cost and unsupported explanations are accessible', async () => {
  const slow = deferred()
  let reads = 0
  const rpc = {
    call: vi.fn(async (_channel, method, payload) => {
      if (method === 'session-status') {
        reads++
        if (reads === 2) return slow.promise
        return { ok: true, value: status() }
      }
      expect(payload).toEqual({
        sessionId: 'session-a',
        provider: 'openai-codex',
        model: 'gpt-6-sol',
        enabled: true,
        revision: 0,
      })
      return { ok: true, value: status({ requested: true, sessionRevision: 1 }) }
    }),
  }
  await mount(FastToggle, { rpc, sessionId: 'session-a', useProjection: () => projection })
  const toggle = page.getByRole('switch', { name: 'Codex Fast mode' })
  await expect.element(toggle).toHaveAttribute('aria-checked', 'false')
  await act(() => window.dispatchEvent(new Event('focus')))
  await act(async () => toggle.click())
  await expect.element(toggle).toHaveAttribute('aria-checked', 'true')
  await act(async () => slow.resolve({ ok: true, value: status() }))
  await expect.element(toggle).toHaveAttribute('aria-checked', 'true')
  await act(async () => page.getByText('Higher usage', { exact: true }).click())
  await expect.element(page.getByText(/2.5× included usage/)).toBeVisible()
})

test('session changes reject old responses and malformed status never enables Fast', async () => {
  const slow = deferred()
  const rpc = {
    call: vi.fn((_channel, _method, payload) =>
      payload.sessionId === 'session-a'
        ? slow.promise
        : Promise.resolve({
            ok: true,
            value: status({
              sessionId: 'session-b',
              supported: false,
              notice: 'Unsupported model',
            }),
          }),
    ),
  }
  await mount(FastToggle, { rpc, sessionId: 'session-a', useProjection: () => projection })
  await act(async () =>
    root.render(
      React.createElement(FastToggle, {
        rpc,
        sessionId: 'session-b',
        useProjection: () => projection,
      }),
    ),
  )
  await act(async () => slow.resolve({ ok: true, value: status({ requested: true }) }))
  await expect
    .element(page.getByRole('switch', { name: 'Codex Fast mode' }))
    .toHaveAttribute('aria-checked', 'false')
  await expect.element(page.getByRole('switch', { name: 'Codex Fast mode' })).toBeDisabled()
  rpc.call.mockResolvedValue({ ok: true, value: { enabled: true } })
  await act(() => window.dispatchEvent(new Event('focus')))
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent(
      'Fast settings unavailable. Standard inference is unaffected while Fast is off.',
    )
  await expect.element(page.getByRole('switch', { name: 'Codex Fast mode' })).toBeDisabled()
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
