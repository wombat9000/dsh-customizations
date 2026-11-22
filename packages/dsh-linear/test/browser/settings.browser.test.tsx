import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { LinearConfigPage, LinearSettingsSection } from '../../client/settings.tsx'
import { CHANNEL, type ConnectionStatus, type SettingsRpc } from '../../shared/rpc.ts'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let root: Root | undefined
let container: HTMLElement | undefined

async function render(element: React.ReactNode) {
  if (!root) {
    container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
  }
  const current = root
  await act(async () => current.render(element))
}

async function unmount() {
  const current = root
  if (current) await act(async () => current.unmount())
  root = undefined
  container?.remove()
  container = undefined
}

afterEach(async () => {
  await unmount()
  vi.restoreAllMocks()
})

const connectedStatus: ConnectionStatus = {
  credential: { configured: true, writable: true, source: 'file' },
  workspace: { id: 'org', name: 'Acme', urlKey: 'acme' },
  viewer: { id: 'user-1', name: 'Ada', email: 'ada@acme.test' },
  live: true,
}

const unconfiguredStatus: ConnectionStatus = {
  credential: { configured: false, writable: true },
  workspace: null,
  viewer: null,
  live: false,
}

function makeRpc(initial: ConnectionStatus = unconfiguredStatus) {
  let current = initial
  const call = vi.fn<SettingsRpc['call']>(async (_channel, endpoint) => {
    if (endpoint === 'connect') current = connectedStatus
    else if (endpoint === 'disconnect') current = unconfiguredStatus
    return { ok: true, value: current }
  })
  return { rpc: { call } satisfies SettingsRpc, call }
}

const noSubscription = () => () => {}

test('row summary never dispatches RPC or subscribes', async () => {
  const { rpc, call } = makeRpc()
  const subscribe = vi.fn(noSubscription)
  await render(<LinearConfigPage rpc={rpc} subscribe={subscribe} view="summary" />)
  expect(container?.textContent).toBe(
    'Workspace connection for issue discovery and approval-gated project management.',
  )
  expect(call).not.toHaveBeenCalled()
  expect(subscribe).not.toHaveBeenCalled()
  expect(container?.querySelector('input')).toBeNull()
})

test('Linear card starts collapsed and renders workspace details and controls when opened', async () => {
  const { rpc } = makeRpc(connectedStatus)
  await render(<LinearSettingsSection rpc={rpc} subscribe={noSubscription} />)
  const details = container?.querySelector('details')
  expect(details).not.toBeNull()
  expect(details?.open).toBe(false)
  expect(details?.firstElementChild?.tagName).toBe('SUMMARY')
  expect(container?.querySelector('h2')).toBeNull()

  await act(async () =>
    page
      .getByText(
        'Workspace connection for issue discovery and approval-gated project management.',
        { exact: true },
      )
      .click(),
  )
  expect(details?.open).toBe(true)
  await expect.element(page.getByRole('group', { name: 'Workspace connection' })).toBeVisible()
  await expect.element(page.getByRole('status')).toHaveTextContent('Connected')
  expect(container?.textContent).toContain('Acme')
  expect(container?.textContent).toContain('acme')
  expect(container?.textContent).toContain('ada@acme.test')
  expect(Array.from(container?.querySelectorAll('button') ?? [], (b) => b.textContent)).toEqual([
    'Replace and connect',
    'Test connection',
    'Disconnect',
  ])
})

test('settings card never renders or retains an existing secret', async () => {
  const { rpc } = makeRpc({
    credential: { configured: true, writable: true, source: 'file' },
    workspace: { id: 'org', name: 'Acme', urlKey: 'acme' },
    viewer: null,
    live: false,
  })
  await render(<LinearSettingsSection rpc={rpc} subscribe={noSubscription} view="page" />)
  const input = page.getByLabelText('Replace API key', { exact: true })
  await expect.element(input).toHaveAttribute('type', 'password')
  await expect.element(input).toHaveValue('')
  await expect
    .element(page.getByRole('status'))
    .toHaveTextContent('Configured via DSH credential store')
  expect(container?.innerHTML).not.toContain('lin_api_')
})

test('connect validates locally, sends trimmed draft write-only, and clears draft on success', async () => {
  const { rpc, call } = makeRpc(unconfiguredStatus)
  await render(<LinearSettingsSection rpc={rpc} subscribe={noSubscription} view="page" />)
  const input = page.getByLabelText('Linear API key', { exact: true })
  await act(async () => input.fill('LINEAR_API_KEY=bad'))
  await act(async () => page.getByRole('button', { name: 'Connect', exact: true }).click())
  await expect.element(page.getByRole('alert')).toHaveTextContent('Paste only the API key')
  expect(call).toHaveBeenCalledTimes(1)

  await act(async () => input.fill('  lin_api_secret  '))
  await act(async () => page.getByRole('button', { name: 'Connect', exact: true }).click())
  expect(call).toHaveBeenCalledWith(CHANNEL, 'connect', { apiKey: 'lin_api_secret' })
  await expect.element(page.getByLabelText('Replace API key', { exact: true })).toHaveValue('')
  expect(container?.textContent).toContain('Linear workspace connected.')
  expect(container?.textContent).not.toContain('lin_api_secret')
})

test('test connection and confirmed disconnect call RPCs; read-only disables writes', async () => {
  const { rpc, call } = makeRpc(connectedStatus)
  const dispose = vi.fn()
  const subscribe = vi.fn(() => dispose)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  await render(<LinearSettingsSection rpc={rpc} subscribe={subscribe} view="page" />)
  await act(async () => page.getByRole('button', { name: 'Test connection', exact: true }).click())
  expect(call).toHaveBeenCalledWith(CHANNEL, 'test', {})
  expect(container?.textContent).toContain('Connection verified against Linear.')

  await act(async () => page.getByRole('button', { name: 'Disconnect', exact: true }).click())
  expect(call).not.toHaveBeenCalledWith(CHANNEL, 'disconnect', {})
  await act(async () => page.getByRole('button', { name: 'Disconnect', exact: true }).click())
  expect(confirm).toHaveBeenCalledWith('Remove the stored Linear API key and workspace binding?')
  expect(call).toHaveBeenCalledWith(CHANNEL, 'disconnect', {})
  expect(container?.textContent).toContain('Linear workspace disconnected.')

  await unmount()
  expect(dispose).toHaveBeenCalledTimes(1)

  const readOnly = makeRpc({
    credential: { configured: true, writable: false, source: 'env' },
    workspace: null,
    viewer: null,
    live: false,
  })
  await render(<LinearSettingsSection rpc={readOnly.rpc} subscribe={noSubscription} view="page" />)
  await expect.element(page.getByLabelText('Replace API key', { exact: true })).toBeDisabled()
  await expect
    .element(page.getByRole('button', { name: 'Replace and connect', exact: true }))
    .toBeDisabled()
  await expect
    .element(page.getByRole('button', { name: 'Disconnect', exact: true }))
    .not.toBeInTheDocument()
  expect(container?.textContent).toContain('read-only source')
})
