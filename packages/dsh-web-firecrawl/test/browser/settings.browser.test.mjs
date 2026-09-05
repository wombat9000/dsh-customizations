import { act } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { deferred, failure, mountSettings, REF } from './harness.mjs'

// Interaction coverage only; no host startup, paid requests, or visual baselines.
let fixture
afterEach(async () => {
  try { await fixture?.unmount() } finally { fixture = undefined; vi.restoreAllMocks() }
})
const click = (locator) => act(async () => { await locator.click() })
const fill = (locator, value) => act(async () => { await locator.fill(value) })
const toggle = () => click(page.getByText('Web search and page fetching via Firecrawl.', { exact: true }))
const input = () => page.getByLabelText(/^(Replace API key|API key)$/)
const save = () => page.getByRole('button', { name: /^(Save key|Replace key)$/ })

test('registers only the web-firecrawl plugin item and starts natively collapsed', async () => {
  fixture = await mountSettings()
  const details = fixture.container.querySelector('details')
  expect(details).not.toBeNull()
  expect(details.open).toBe(false)
  expect(details.firstElementChild.tagName).toBe('SUMMARY')
  await expect.element(input()).not.toBeVisible()
  expect(fixture.credentials.describe).toHaveBeenCalledExactlyOnceWith([REF])
  await toggle()
  expect(details.open).toBe(true)
  await expect.element(page.getByRole('group', { name: 'Firecrawl' })).toBeVisible()
  await expect.element(page.getByRole('status')).toHaveTextContent('Not configured')
  await expect.element(input()).toHaveAttribute('type', 'password')
  await expect.element(input()).toHaveAttribute('autocomplete', 'off')
  await expect.element(input()).toHaveValue('')
  await fill(input(), 'fc-browser-draft-only')
  await toggle()
  expect(details.open).toBe(false)
  await expect.element(input()).not.toBeVisible()
  await toggle()
  await expect.element(input()).toHaveValue('fc-browser-draft-only')
  expect(fixture.credentials.set).not.toHaveBeenCalled()
})

test('saves a trimmed write-only password and clears the draft after success', async () => {
  const pending = deferred()
  fixture = await mountSettings()
  const setNormally = fixture.credentials.set.getMockImplementation()
  fixture.credentials.set.mockImplementationOnce(async (...args) => {
    await pending.promise
    return setNormally(...args)
  })
  await toggle()
  await fill(input(), '  fc-browser-test-not-a-real-key  ')
  await click(save())
  expect(fixture.credentials.set).toHaveBeenCalledExactlyOnceWith(REF, 'fc-browser-test-not-a-real-key')
  await expect.element(input()).toBeDisabled()
  await expect.element(page.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  await act(async () => { pending.resolve() })
  await expect.element(input()).toHaveValue('')
  await expect.element(input()).toBeEnabled()
  await expect.element(page.getByRole('button', { name: 'Replace key' })).toBeEnabled()
  await expect.element(page.getByText('Firecrawl API key saved. The next web request will use it.', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Configured via DSH credential store', { exact: true })).toBeVisible()
  expect(fixture.credentials.describe).toHaveBeenCalledTimes(2)
  expect(fixture.container.textContent).not.toContain('fc-browser-test-not-a-real-key')
  await toggle()
  await toggle()
  await expect.element(input()).toHaveValue('')
})

test('removal requires confirmation, clears an unsaved replacement, and refreshes metadata', async () => {
  fixture = await mountSettings({ credential: { configured: true, writable: true, source: 'file' } })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  await toggle()
  await expect.element(input()).toHaveValue('')
  await fill(input(), 'fc-unsaved-replacement')
  await click(page.getByRole('button', { name: 'Remove key' }))
  expect(confirm).toHaveBeenCalledWith('Remove the stored Firecrawl API key?')
  expect(fixture.credentials.unset).not.toHaveBeenCalled()
  await expect.element(input()).toHaveValue('fc-unsaved-replacement')
  await click(page.getByRole('button', { name: 'Remove key' }))
  expect(fixture.credentials.unset).toHaveBeenCalledExactlyOnceWith(REF)
  await expect.element(input()).toHaveValue('')
  await expect.element(page.getByText('Stored Firecrawl API key removed.', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Not configured', { exact: true })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Remove key' })).not.toBeInTheDocument()
  await expect.element(save()).toBeEnabled()
  expect(fixture.credentials.describe).toHaveBeenCalledTimes(2)
})

test('read-only environment credentials disable writes without loopback advice', async () => {
  fixture = await mountSettings({ credential: { configured: true, writable: false, source: 'env' } })
  await toggle()
  await expect.element(page.getByRole('status')).toHaveTextContent('Configured via launch environment')
  await expect.element(input()).toBeDisabled()
  await expect.element(input()).toHaveValue('')
  await expect.element(save()).toBeDisabled()
  await expect.element(page.getByRole('button', { name: 'Remove key' })).not.toBeInTheDocument()
  await expect.element(page.getByText('This key comes from a read-only source. Remove it from that source before managing it here.', { exact: true })).toBeVisible()
  expect(fixture.container.textContent).not.toMatch(/loopback/i)
  expect(fixture.credentials.set).not.toHaveBeenCalled()
  expect(fixture.credentials.unset).not.toHaveBeenCalled()
})

test.each([
  ['error envelope', () => failure('Credential access denied'), 'Credential access denied'],
  ['transport rejection', () => Promise.reject(new Error('Transport disconnected')), 'Transport disconnected'],
])('describe %s is an alert, not a misleading loopback instruction', async (_name, describe, message) => {
  fixture = await mountSettings({ overrides: { describe } })
  await toggle()
  await expect.element(page.getByRole('status')).toHaveTextContent('Unavailable')
  await expect.element(page.getByRole('alert')).toHaveTextContent(message)
  await expect.element(input()).toBeDisabled()
  await expect.element(save()).toBeDisabled()
  await expect.element(page.getByText('Could not check credential access. See the error below.', { exact: true })).toBeVisible()
  expect(fixture.container.textContent).not.toMatch(/loopback/i)
})

test.each(['set', 'unset'])('%s error envelopes preserve the draft and never claim success', async (method) => {
  fixture = await mountSettings({
    credential: { configured: true, writable: true, source: 'file' },
    overrides: { [method]: async () => failure('Credential write denied') },
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await toggle()
  await fill(input(), 'fc-retry-draft')
  await click(method === 'set' ? save() : page.getByRole('button', { name: 'Remove key' }))
  expect(fixture.credentials[method]).toHaveBeenCalledTimes(1)
  await expect.element(page.getByRole('alert')).toHaveTextContent('Credential write denied')
  await expect.element(input()).toHaveValue('fc-retry-draft')
  await expect.element(input()).toBeEnabled()
  await expect.element(save()).toBeEnabled()
  await expect.element(page.getByRole('status')).toHaveTextContent('Configured via DSH credential store')
  expect(fixture.container.textContent).not.toMatch(/API key saved|API key removed|loopback/i)
  expect(fixture.credentials.describe).toHaveBeenCalledTimes(1)
})
