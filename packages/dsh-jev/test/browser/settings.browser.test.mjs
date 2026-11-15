import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { SettingsCard } from '../../client/settings.tsx'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
afterEach(async () => {
  if (root) await act(() => root.unmount())
  container?.remove()
  root = null
})
async function mount(view) {
  let model = 'typesafe/jev-1.13'
  const rpc = {
    call: vi.fn(async (channel, method, payload) => {
      expect(channel).toBe('/jev-integration')
      if (method === 'configure') model = payload.model
      else expect(method).toBe('status')
      return { ok: true, value: { model, available: true, credential: { configured: true } } }
    }),
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(React.createElement(SettingsCard, { rpc, view })))
  if (view !== 'summary' && view !== 'page')
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
  expect(rpc.call.mock.calls.at(-1)).toEqual([
    '/jev-integration',
    'configure',
    { model: '~typesafe/jev-latest' },
  ])
  await expect.element(page.getByText('Jev model saved. No evaluation was sent.')).toBeVisible()
})
test('Jev transport errors stay generic and preserve the model draft', async () => {
  const rpc = await mount()
  await act(async () => page.getByLabelText('Jev model ID').fill('~typesafe/jev-latest'))
  rpc.call.mockRejectedValue(new Error('secret payload'))
  await act(async () => page.getByRole('button', { name: 'Save Jev model' }).click())
  await expect.element(page.getByRole('alert')).toHaveTextContent('Jev settings request failed.')
  expect(container.textContent).not.toContain('secret payload')
  await expect.element(page.getByLabelText('Jev model ID')).toHaveValue('~typesafe/jev-latest')
})
test('Jev summary does not mount a form or read settings; page starts open', async () => {
  const rpc = await mount('summary')
  expect(rpc.call).not.toHaveBeenCalled()
  expect(container.querySelector('details, input, button, style')).toBeNull()
  await act(async () => root.render(React.createElement(SettingsCard, { rpc, view: 'page' })))
  expect(container.querySelector('details').open).toBe(true)
  expect(rpc.call).toHaveBeenCalledTimes(1)
})
test('Jev pending save disables controls until the validated model returns', async () => {
  const rpc = await mount()
  let complete
  rpc.call.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  await act(async () => page.getByRole('button', { name: 'Save Jev model' }).click())
  await expect.element(page.getByLabelText('Jev model ID')).toBeDisabled()
  await expect
    .element(page.getByRole('button', { name: 'Refresh credential status' }))
    .toBeDisabled()
  await act(async () =>
    complete({ ok: true, value: { model: 'typesafe/jev-1.13', available: true } }),
  )
  await expect.element(page.getByLabelText('Jev model ID')).toBeEnabled()
  await expect.element(page.getByRole('button', { name: 'Save Jev model' })).toBeEnabled()
  await expect.element(page.getByText('Jev model saved. No evaluation was sent.')).toBeVisible()
  expect(rpc.call).toHaveBeenCalledTimes(2)
})
