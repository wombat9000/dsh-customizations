import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, vi } from 'vitest'

let plugin
const previousLoader = window.__ModuleLoader__
window.__ModuleLoader__ = { load({ id, factory }) {
  expect(id).toBe('@local/dsh-google-auth')
  plugin = factory((name) => { expect(name).toBe('react'); return React })
} }
try { await import('../../client.js') } finally {
  if (previousLoader === undefined) delete window.__ModuleLoader__
  else window.__ModuleLoader__ = previousLoader
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
export const ok = (value) => ({ ok: true, value })
export const failure = (message) => ({ ok: false, error: { message } })
export const integration = (extra = {}) => ({ id: 'google-drive', label: 'Google Drive', scopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'], authorized: false, missingScopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'], ...extra })
export function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
// All HTTP is intercepted; fixtures never contact DSH or Google.
export async function mountSettings({ status = {}, overrides = {} } = {}) {
  expect(plugin.inject).toEqual(['slots'])
  let state = { configured: false, connected: false, pending: false, useSandbox: false, sandboxAvailable: true, integrations: [integration()], ...status }
  const clear = (configured) => { state = { ...state, configured, connected: false, pending: false, account: undefined, integrations: state.integrations.map((item) => ({ ...item, authorized: false, missingScopes: item.scopes })) }; return ok({}) }
  const handlers = Object.fromEntries(Object.entries({
    status: async () => ok({ ...state }),
    configure: async () => clear(true),
    'clear-config': async () => clear(false),
    'callback-mode': async ({ useSandbox }) => { state.useSandbox = useSandbox; state.pending = false; return ok({}) },
    connect: async ({ integrationId }) => {
      state.pending = true; state.pendingIntegrationId = integrationId
      return ok({ authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=browser-fixture', expiresAt: Date.now() + 60000 })
    },
    cancel: async () => { state.pending = false; return ok({}) },
    disconnect: async () => clear(state.configured),
    ...overrides,
  }).map(([name, fn]) => [name, vi.fn(fn)]))
  const fetch = vi.spyOn(window, 'fetch').mockImplementation(async (url, options) => {
    expect(url).toMatch(/^\/api\/plugins\/google-auth\/(status|configure|clear-config|callback-mode|connect|cancel|disconnect)$/)
    expect(options.method).toBe('POST'); expect(options.credentials).toBe('same-origin')
    expect(options.headers).toEqual({ 'Content-Type': 'application/json', 'X-DSH-Google-Auth': '1' })
    const method = url.split('/').at(-1), body = JSON.parse(options.body)
    if (method === 'connect') expect(Object.keys(body)).toEqual(['integrationId'])
    else if (method === 'callback-mode') { expect(Object.keys(body)).toEqual(['useSandbox']); expect(typeof body.useSandbox).toBe('boolean') }
    else if (method !== 'configure') expect(body).toEqual({})
    const result = await handlers[method](body)
    return { ok: result.ok, json: async () => result }
  })
  const listeners = new Map()
  let registration
  plugin.apply({
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    slots: {
      inject(name, register) { expect(name).toBe('settings.plugin.item'); register() },
      register(options, Component) { registration = { options, Component } },
    },
  })
  expect(registration.options).toMatchObject({ name: 'settings.plugin.item', key: 'google-auth', order: 25 })
  const container = document.createElement('main'); document.body.append(container)
  const root = createRoot(container)
  try { await act(async () => root.render(React.createElement(registration.Component, registration.options.inject()))) } catch (error) {
    await act(async () => root.unmount()); container.remove(); fetch.mockRestore(); throw error
  }
  return {
    container, handlers, listeners, fetch,
    setStatus(next) { state = { ...state, ...next } },
    async unmount() { await act(async () => root.unmount()); container.remove(); expect(listeners.size).toBe(0); fetch.mockRestore() },
  }
}
