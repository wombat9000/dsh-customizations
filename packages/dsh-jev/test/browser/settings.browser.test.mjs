import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
let plugin
window.__ModuleLoader__ = { load({ factory }) { plugin = factory(() => React) } }
await import('../../client.js')
delete window.__ModuleLoader__
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
afterEach(async () => { if (root) await act(() => root.unmount()); container?.remove(); root = null })
async function mount() {
  let model = 'typesafe/jev-1.13'
  const rpc = { call: vi.fn(async (channel, method, payload) => {
    expect(channel).toBe('/jev-integration')
    if (method === 'configure') model = payload.model
    else expect(method).toBe('status')
    return { ok: true, value: { model, available: true, credential: { configured: true } } }
  }) }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(React.createElement(plugin.SettingsCard, { rpc })))
  await act(async () => page.getByText('Jev', { exact: true }).click())
  return rpc
}
test('Jev settings edits model only and shares credential status without another key field', async () => {
  const rpc = await mount()
  expect(container.querySelector('input[type=password]')).toBeNull()
  const field = page.getByLabelText('Jev model ID')
  await expect.element(field).toHaveValue('typesafe/jev-1.13')
  await act(async () => field.fill('~typesafe/jev-latest'))
  await act(async () => page.getByRole('button', { name: 'Refresh credential status' }).click())
  await expect.element(field).toHaveValue('~typesafe/jev-latest')
  await act(async () => page.getByRole('button', { name: 'Save Jev model' }).click())
  expect(rpc.call.mock.calls.at(-1)).toEqual(['/jev-integration', 'configure', { model: '~typesafe/jev-latest' }])
  await expect.element(page.getByText('Jev model saved. No evaluation was sent.')).toBeVisible()
})
test('Jev transport errors stay generic and styles dispose', async () => {
  const rpc = await mount()
  rpc.call.mockRejectedValue(new Error('secret payload'))
  await act(async () => page.getByRole('button', { name: 'Save Jev model' }).click())
  await expect.element(page.getByRole('alert')).toHaveTextContent('Jev settings request failed.')
  expect(container.textContent).not.toContain('secret payload')
  await act(() => root.unmount()); root = null
  expect(document.querySelector('style[data-plugin-css="jev/settings"]')).toBeNull()
})
