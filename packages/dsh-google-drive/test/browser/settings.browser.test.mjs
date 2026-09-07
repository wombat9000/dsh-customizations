import { act } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { deferred, failure, mountSettings, ok } from './harness.mjs'

let fixture
let stopTimerSpy
let startTimerSpy
const timers = new Map()
afterEach(async () => {
  try { await fixture?.unmount() } finally {
    fixture = undefined
    startTimerSpy?.mockRestore(); stopTimerSpy?.mockRestore()
    startTimerSpy = undefined; stopTimerSpy = undefined; timers.clear()
    vi.restoreAllMocks()
  }
})
const click = (locator) => act(async () => { await locator.click() })
const fill = (locator, value) => act(async () => { await locator.fill(value) })
const toggle = () => click(page.getByText('Read-only file metadata access.', { exact: true }))
const input = () => page.getByLabelText('Desktop OAuth client JSON')
const button = (name) => page.getByRole('button', { name, exact: true })
const clientJson = JSON.stringify({ installed: { client_id: 'browser-fixture.apps.googleusercontent.com', client_secret: 'browser-fixture-not-a-real-secret' } })

// Capture only the component's 1s polls; preserve native timers used by browser interactions.
function capturePolling() {
  const set = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window)
  let id = -1000
  startTimerSpy = vi.spyOn(window, 'setTimeout').mockImplementation((fn, delay, ...args) => {
    if (delay !== 1000) return set(fn, delay, ...args)
    timers.set(--id, fn); return id
  })
  stopTimerSpy = vi.spyOn(window, 'clearTimeout').mockImplementation((value) => {
    if (timers.has(value)) timers.delete(value)
    else clear(value)
  })
}
async function poll() {
  expect(timers.size).toBe(1)
  const [id, callback] = [...timers][0]
  timers.delete(id)
  await act(async () => { await callback() })
}

test('native collapsed card saves write-only OAuth JSON and clears sensitive draft after success', async () => {
  fixture = await mountSettings()
  expect(fixture.container.querySelector('details').open).toBe(false)
  await expect.element(input()).not.toBeVisible()
  await toggle()
  await expect.element(input()).toHaveValue('')
  await expect.element(input()).toHaveAttribute('autocomplete', 'off')
  await expect.element(input()).toHaveAttribute('maxlength', '32768')
  const pending = deferred()
  const save = fixture.handlers.configure.getMockImplementation()
  fixture.handlers.configure.mockImplementationOnce(async (body) => { await pending.promise; return save(body) })
  await fill(input(), clientJson)
  await click(button('Save client configuration'))
  expect(fixture.handlers.configure).toHaveBeenCalledExactlyOnceWith({ clientJson })
  await expect.element(input()).toBeDisabled()
  await act(async () => pending.resolve())
  await expect.element(input()).toHaveValue('')
  await expect.element(button('Connect')).toBeEnabled()
  expect(fixture.container.textContent).not.toContain('browser-fixture-not-a-real-secret')
  await toggle(); await toggle()
  await expect.element(input()).toHaveValue('')
})

test('connect exposes an explicit safe link, polls to connected, and disconnect confirms', async () => {
  capturePolling()
  fixture = await mountSettings({ status: { configured: true } })
  expect(timers.size).toBe(0)
  await toggle()
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  await click(button('Connect'))
  expect(open).not.toHaveBeenCalled()
  const link = page.getByRole('link', { name: 'Continue with Google' })
  await expect.element(link).toHaveAttribute('href', 'https://accounts.google.com/o/oauth2/v2/auth?state=browser-fixture')
  await expect.element(link).toHaveAttribute('target', '_blank')
  await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer')
  await expect.element(page.getByRole('status')).toHaveTextContent('Waiting for Google authorization')
  await poll()
  fixture.setStatus({ connected: true, pending: false })
  await poll()
  expect(timers.size).toBe(0)
  await expect.element(page.getByRole('status')).toHaveTextContent('Connected')
  await expect.element(link).not.toBeInTheDocument()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  await click(button('Disconnect'))
  expect(fixture.handlers.disconnect).not.toHaveBeenCalled()
  await click(button('Disconnect'))
  expect(confirm.mock.calls[1][0]).toContain('does not revoke access')
  expect(fixture.handlers.disconnect).toHaveBeenCalledExactlyOnceWith({})
  await expect.element(page.getByRole('status')).toHaveTextContent('Not connected')
})

test('malicious configuration failure preserves draft without echoing secrets', async () => {
  fixture = await mountSettings({ overrides: { configure: async () => failure(`Rejected secret: ${clientJson}`) } })
  await toggle(); await fill(input(), clientJson); await click(button('Save client configuration'))
  await expect.element(input()).toHaveValue(clientJson)
  await expect.element(input()).toBeEnabled()
  await expect.element(page.getByRole('alert')).toHaveTextContent('Could not save or remove the client configuration. Check the Desktop OAuth JSON and retry from the local DSH GUI.')
  expect(fixture.container.querySelector('[role="alert"]').textContent).not.toContain('browser-fixture-not-a-real-secret')
})

test('local-only API failure is visible and invalid authorization links never render', async () => {
  fixture = await mountSettings({ status: { configured: true }, overrides: {
    connect: async () => failure('Use the local loopback GUI to connect Google Drive.'),
  } })
  await toggle(); await click(button('Connect'))
  await expect.element(page.getByRole('alert')).toHaveTextContent('Use the local loopback GUI to connect Google Drive.')
  fixture.handlers.connect.mockResolvedValueOnce(ok({ authorizationUrl: 'https://accounts.google.com.evil.example/o/oauth2/v2/auth' }))
  await click(button('Connect'))
  await expect.element(page.getByRole('alert')).toHaveTextContent('Google returned an invalid authorization link. Cancel and try connecting again.')
  await expect.element(page.getByRole('link', { name: 'Continue with Google' })).not.toBeInTheDocument()
})

test('connection reset and unmount clear pending polling and subscriptions', async () => {
  capturePolling()
  fixture = await mountSettings({ status: { configured: true, pending: true } })
  expect(timers.size).toBe(1)
  fixture.setStatus({ pending: false })
  await act(async () => fixture.listeners.get('connection/reset')())
  expect(timers.size).toBe(0)
  fixture.setStatus({ pending: true })
  await act(async () => fixture.listeners.get('connection/reset')())
  expect(timers.size).toBe(1)
  await fixture.unmount(); fixture = undefined
  expect(timers.size).toBe(0)
})
