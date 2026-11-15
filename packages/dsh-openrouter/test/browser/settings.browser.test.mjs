import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { SettingsCard } from '../../client/settings.tsx'
import { call } from '../../client/transport.ts'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
let status
const calls = []
afterEach(async () => {
  if (root) await act(() => root.unmount())
  container?.remove()
  root = null
  vi.restoreAllMocks()
})
async function mount(overrides = {}, view) {
  calls.length = 0
  status = {
    configured: false,
    writable: true,
    source: 'provider record',
    target: 'record:llm-pi-ai/openrouter',
    ...overrides,
  }
  const rpc = {
    call: vi.fn(async (channel, method, payload) => {
      expect(channel).toBe('/openrouter-integration')
      calls.push({ method, payload })
      if (method === 'save') status = { ...status, configured: true }
      if (method === 'clear') status = { ...status, configured: false }
      return { ok: true, value: { ...status } }
    }),
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(React.createElement(SettingsCard, { rpc, view })))
  if (view !== 'summary' && view !== 'page')
    await act(async () => page.getByText('OpenRouter', { exact: true }).click())
  return rpc
}
test('shared settings saves one canonical credential and clears the password draft', async () => {
  await mount()
  const field = page.getByLabelText('OpenRouter API key')
  await expect.element(field).toHaveAttribute('type', 'password')
  await act(async () => field.fill('sk-or-fixture-only'))
  await act(async () => page.getByRole('button', { name: 'Save shared key' }).click())
  expect(calls.at(-1)).toEqual({
    method: 'save',
    payload: { target: 'record:llm-pi-ai/openrouter', apiKey: 'sk-or-fixture-only' },
  })
  await expect.element(field).toHaveValue('')
  await expect
    .element(page.getByText('Shared OpenRouter key saved. No remote request was made.'))
    .toBeVisible()
  expect(container.textContent).not.toContain('sk-or-fixture-only')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  await act(async () => page.getByRole('button', { name: 'Remove shared key' }).click())
  expect(calls.some((call) => call.method === 'clear')).toBe(false)
  confirm.mockReturnValue(true)
  await act(async () => page.getByRole('button', { name: 'Remove shared key' }).click())
  expect(calls.at(-1).method).toBe('clear')
  expect(confirm.mock.calls[0][0]).toContain('every integration')
})
test('read-only credentials cannot be replaced or removed', async () => {
  await mount({ configured: true, writable: false, source: 'env' })
  await expect.element(page.getByLabelText('OpenRouter API key')).toBeDisabled()
  await expect.element(page.getByRole('button', { name: 'Remove shared key' })).toBeDisabled()
  expect(calls.map((call) => call.method)).toEqual(['status'])
})
test('malformed RPC status cannot become writable client state', async () => {
  for (const value of [
    null,
    { writable: true },
    { configured: false, writable: true, source: 'record', target: 123 },
    { configured: false, writable: 'true', source: 'record', target: 'record:fixture' },
    { configured: false, writable: true, source: 'record', target: 'record:fixture', error: {} },
  ]) {
    await expect(call({ call: async () => ({ ok: true, value }) }, 'status', {})).rejects.toThrow(
      'OpenRouter settings are unavailable.',
    )
  }
})
test('transport errors do not expose request details or clear an unsaved password', async () => {
  const rpc = await mount()
  rpc.call.mockRejectedValue(new Error('sensitive request body'))
  await act(async () => page.getByLabelText('OpenRouter API key').fill('dummy'))
  await act(async () => page.getByRole('button', { name: 'Save shared key' }).click())
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('OpenRouter settings request failed.')
  expect(container.textContent).not.toContain('sensitive')
  await expect.element(page.getByLabelText('OpenRouter API key')).toHaveValue('dummy')
})
test('OpenRouter summary has no form or credential read; page starts open', async () => {
  const rpc = await mount({}, 'summary')
  expect(rpc.call).not.toHaveBeenCalled()
  expect(container.querySelector('details, input, button, style')).toBeNull()
  await act(async () => root.render(React.createElement(SettingsCard, { rpc, view: 'page' })))
  expect(container.querySelector('details').open).toBe(true)
  expect(rpc.call).toHaveBeenCalledTimes(1)
})
test('pending credential write disables controls and does not refresh after disposal', async () => {
  const rpc = await mount()
  let reject
  rpc.call.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  await act(async () => page.getByLabelText('OpenRouter API key').fill('fixture-draft'))
  await act(async () => page.getByRole('button', { name: 'Save shared key' }).click())
  await expect.element(page.getByLabelText('OpenRouter API key')).toBeDisabled()
  await expect.element(page.getByRole('button', { name: 'Save shared key' })).toBeDisabled()
  await act(() => root.unmount())
  root = null
  await act(async () => reject(new Error('disposed request')))
  expect(container.childElementCount).toBe(0)
  expect(rpc.call).toHaveBeenCalledTimes(2)
})
