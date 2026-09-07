import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, vi } from 'vitest'

let plugin
const previousLoader = window.__ModuleLoader__
window.__ModuleLoader__ = {
  load({ id, factory }) {
    expect(id).toBe('@local/dsh-google-drive')
    plugin = factory((name) => { expect(name).toBe('react'); return React })
  },
}
try { await import('../../client.js') } finally {
  if (previousLoader === undefined) delete window.__ModuleLoader__
  else window.__ModuleLoader__ = previousLoader
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
export const ok = (value) => ({ ok: true, value })
export const failure = (message) => ({ ok: false, error: { message } })
export function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

// Real React/native controls, intercepted same-origin fetch, and no live DSH or Google requests.
export async function mountSettings({ status = {}, overrides = {} } = {}) {
  expect(plugin.inject).toEqual(['slots'])
  let state = { configured: false, connected: false, pending: false, ...status }
  const handlers = Object.fromEntries(Object.entries({
    status: async () => ok({ ...state }),
    configure: async () => { state = { configured: true, connected: false, pending: false }; return ok({}) },
    'clear-config': async () => { state = { configured: false, connected: false, pending: false }; return ok({}) },
    connect: async () => {
      state.pending = true
      return ok({ authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=browser-fixture', expiresAt: Date.now() + 60000 })
    },
    cancel: async () => { state.pending = false; return ok({}) },
    disconnect: async () => { state.connected = false; state.pending = false; return ok({}) },
    ...overrides,
  }).map(([name, fn]) => [name, vi.fn(fn)]))
  const fetch = vi.spyOn(window, 'fetch').mockImplementation(async (url, options) => {
    expect(url).toMatch(/^\/api\/plugins\/google-drive\/(status|configure|clear-config|connect|cancel|disconnect)$/)
    expect(options.method).toBe('POST')
    expect(options.credentials).toBe('same-origin')
    expect(options.headers).toEqual({ 'Content-Type': 'application/json', 'X-DSH-Google-Drive': '1' })
    const method = url.split('/').at(-1)
    const body = JSON.parse(options.body)
    if (method !== 'configure') expect(body).toEqual({})
    const result = await handlers[method](body)
    return { ok: result.ok, json: async () => result }
  })
  const listeners = new Map()
  let registration
  plugin.apply({
    on(name, listener) { expect(listeners.has(name)).toBe(false); listeners.set(name, listener); return () => listeners.delete(name) },
    slots: {
      inject(name, register) { expect(name).toBe('settings.plugin.item'); register() },
      register(options, Component) { registration = { options, Component } },
    },
  })
  expect(registration.options).toMatchObject({ name: 'settings.plugin.item', key: 'google-drive', order: 25 })
  const container = document.createElement('main')
  document.body.append(container)
  const root = createRoot(container)
  try { await act(async () => root.render(React.createElement(registration.Component, registration.options.inject()))) } catch (error) {
    await act(async () => root.unmount()); container.remove(); fetch.mockRestore(); throw error
  }
  return {
    container, handlers, listeners, fetch,
    setStatus(next) { state = { ...state, ...next } },
    async unmount() {
      await act(async () => root.unmount())
      container.remove()
      expect(listeners.size).toBe(0)
      fetch.mockRestore()
    },
  }
}
