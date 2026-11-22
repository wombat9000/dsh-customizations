import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { INSTALL_URL, TrivySettingsSection } from '../../client/settings.tsx'
import {
  TRIVY_STATUS_CHANNEL,
  TRIVY_STATUS_GET,
  TRIVY_STATUS_RECHECK,
  type PublicTrivyStatus,
  type StatusRpc,
} from '../../shared/contracts.ts'

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

const noSubscription = () => () => {}

test('settings renders ready status without editable controls', async () => {
  const status: PublicTrivyStatus = {
    state: 'ready',
    version: '0.69.2',
    minimumVersion: '0.50.0',
    checkedAt: '2026-01-01T00:00:00.000Z',
    message: 'Trivy 0.69.2 is ready.',
  }
  const rpc: StatusRpc = {
    call: vi.fn(async () => ({ ok: true as const, value: status })),
  }
  await render(<TrivySettingsSection rpc={rpc} subscribe={noSubscription} />)
  await expect.element(page.getByRole('group', { name: 'Trivy CLI' })).toBeVisible()
  await expect.element(page.getByRole('status')).toHaveTextContent('Ready')
  expect(container?.textContent).toContain('0.69.2')
  expect(container?.textContent).not.toContain('Executable')
  expect(container?.querySelector('input')).toBeNull()
  const link = page.getByRole('link', { name: 'Official installation instructions' })
  await expect.element(link).toHaveAttribute('href', INSTALL_URL)
  await expect.element(page.getByRole('button', { name: 'Recheck', exact: true })).toBeEnabled()
})

test('settings renders not-found and unsupported guidance', async () => {
  const cases: PublicTrivyStatus[] = [
    {
      state: 'not-found',
      minimumVersion: '0.50.0',
      checkedAt: '2026-01-01T00:00:00.000Z',
      message: 'DSH could not find `trivy` on its effective PATH.',
    },
    {
      state: 'unsupported-version',
      version: '0.49.0',
      minimumVersion: '0.50.0',
      checkedAt: '2026-01-01T00:00:00.000Z',
      message: 'Trivy 0.49.0 is installed, but this plugin requires 0.50.0 or newer.',
    },
  ]
  for (const status of cases) {
    const rpc: StatusRpc = {
      call: vi.fn(async () => ({ ok: true as const, value: status })),
    }
    await render(<TrivySettingsSection rpc={rpc} subscribe={noSubscription} />)
    expect(container?.textContent).toMatch(
      status.state === 'not-found' ? /effective PATH/ : /Unsupported version/,
    )
    expect(container?.textContent).toContain('never installs or updates')
    await unmount()
  }
})

test('settings renders an unavailable badge after an RPC failure', async () => {
  const rpc: StatusRpc = {
    call: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'internal' as const, message: 'Status request failed', details: {} },
    })),
  }
  await render(<TrivySettingsSection rpc={rpc} subscribe={noSubscription} />)
  await expect.element(page.getByRole('status')).toHaveTextContent('Unavailable')
  await expect.element(page.getByRole('alert')).toHaveTextContent('Status request failed')
  expect(container?.textContent).not.toContain('Checking…')
})

test('initial effect requests status, subscribe refreshes, and unmount disposes', async () => {
  const ready: PublicTrivyStatus = {
    state: 'ready',
    version: '0.69.2',
    minimumVersion: '0.50.0',
    checkedAt: '2026-01-01T00:00:00.000Z',
    message: 'Trivy 0.69.2 is ready.',
  }
  const call = vi.fn<StatusRpc['call']>(async () => ({ ok: true, value: ready }))
  let listener: (() => void) | undefined
  const dispose = vi.fn()
  const subscribe = (fn: () => void) => {
    listener = fn
    return dispose
  }
  await render(<TrivySettingsSection rpc={{ call }} subscribe={subscribe} />)
  expect(call).toHaveBeenCalledExactlyOnceWith(TRIVY_STATUS_CHANNEL, TRIVY_STATUS_GET, {})
  expect(listener).toBeTypeOf('function')
  await act(async () => listener?.())
  expect(call).toHaveBeenCalledTimes(2)
  await unmount()
  expect(dispose).toHaveBeenCalledTimes(1)
})

test('Recheck calls the force endpoint and disables while busy', async () => {
  let resolveRecheck: ((value: Awaited<ReturnType<StatusRpc['call']>>) => void) | undefined
  const notFound: PublicTrivyStatus = {
    state: 'not-found',
    minimumVersion: '0.50.0',
    checkedAt: '2026-01-01T00:00:00.000Z',
    message: 'Trivy not found.',
  }
  const call = vi.fn<StatusRpc['call']>((_channel, endpoint) => {
    if (endpoint === TRIVY_STATUS_RECHECK) {
      return new Promise((resolve) => {
        resolveRecheck = resolve
      })
    }
    return Promise.resolve({ ok: true, value: notFound })
  })
  await render(<TrivySettingsSection rpc={{ call }} subscribe={noSubscription} />)
  await act(async () => page.getByRole('button', { name: 'Recheck', exact: true }).click())
  expect(call).toHaveBeenCalledWith(TRIVY_STATUS_CHANNEL, TRIVY_STATUS_RECHECK, {})
  await expect.element(page.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled()

  await act(async () =>
    resolveRecheck?.({
      ok: true,
      value: {
        state: 'ready',
        version: '0.69.2',
        minimumVersion: '0.50.0',
        checkedAt: '2026-01-01T00:00:00.000Z',
        message: 'Trivy 0.69.2 is ready.',
      },
    }),
  )
  await expect.element(page.getByRole('status')).toHaveTextContent('Ready')
  await expect.element(page.getByRole('button', { name: 'Recheck', exact: true })).toBeEnabled()
})
