import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, vi } from 'vitest'

import * as plugin from '../../client/index.ts'

// Source components run here with real React. client.test.js owns generated
// loader identity, external imports, and artifact freshness.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

export const REF = 'FIRECRAWL_API_KEY'
export const ok = (value) => ({ ok: true, value })
export const failure = (message) => ({
  ok: false,
  error: { code: 'fixture-error', message, details: {} },
})
export function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// Real React and native details/summary, but no live DSH, credential store, or network.
export async function mountSettings({
  credential = { configured: false, writable: true },
  overrides = {},
  view,
} = {}) {
  expect(plugin.inject).toEqual(['slots', 'remote', 'remote.credentials'])
  let description = { ...credential }
  const credentials = Object.fromEntries(
    Object.entries({
      describe: async () => ok({ [REF]: { ...description } }),
      set: async () => {
        description = { configured: true, writable: true, source: 'file' }
        return ok(undefined)
      },
      unset: async () => {
        description = { configured: false, writable: true }
        return ok(undefined)
      },
      ...overrides,
    }).map(([method, implementation]) => [method, vi.fn(implementation)]),
  )
  const listeners = new Map()
  const on = (event, listener) => {
    expect(listeners.has(event)).toBe(false)
    listeners.set(event, listener)
    return () => listeners.delete(event)
  }
  const remote = { credentials, $on: on }
  const registrations = []
  plugin.apply({
    remote,
    on,
    // Deliberately no connection/get fallback: credentials must use ctx.remote.
    slots: {
      inject(name, register) {
        expect(name).toBe('plugins.row.config')
        register()
      },
      register(options, Component) {
        registrations.push({ options, Component })
      },
    },
  })
  expect(registrations).toHaveLength(1)
  const { options, Component } = registrations[0]
  expect(options).toMatchObject({
    name: 'plugins.row.config',
    key: '@local/dsh-web-firecrawl#local-web-firecrawl',
    order: 20,
  })
  expect(options).not.toHaveProperty('id')
  expect(options).not.toHaveProperty('label')
  const props = { ...options.inject(), view }
  expect(props.api).toBe(remote)
  expect(props.subscribe).toBeTypeOf('function')
  const container = document.createElement('main')
  container.dataset.testid = 'firecrawl-fixture'
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => {
      root.render(React.createElement(Component, props))
    })
  } catch (error) {
    await act(async () => root.unmount())
    container.remove()
    throw error
  }
  return {
    container,
    credentials,
    listeners,
    async unmount() {
      await act(async () => root.unmount())
      container.remove()
      expect(listeners.size).toBe(0)
    },
  }
}
