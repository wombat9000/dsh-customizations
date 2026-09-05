import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { expect, vi } from 'vitest'
import './harness.css'

let plugin
window.__ModuleLoader__ = {
  load({ id, factory }) {
    expect(id).toBe('@wombat9000/dsh-session-recap')
    plugin = factory((name) => {
      expect(name).toBe('react')
      return React
    })
  },
}
await import('../../client.js')
delete window.__ModuleLoader__
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = React.createElement
export async function mountSlot(name, { blank = false, narrow = false, dark = false, recapError = false } = {}) {
  localStorage.clear()
  const config = {
    autoRecap: false, inactivityMinutes: 30, provider: 'fixture-provider',
    model: 'fixture-model', storageScope: 'browser-test',
  }
  const rpc = { call: vi.fn(async (channel, method, payload) => {
    expect(channel).toBe('/session-recap')
    switch (method) {
      case 'settings': return { ok: true, value: { ...config } }
      case 'models': return { ok: true, value: { providers: [{
        id: 'fixture-provider', name: 'Fixture provider',
        models: [{ id: 'fixture-model', name: 'Fixture model' }],
      }] } }
      case 'recap': if (recapError) return { ok: false, error: { message: 'The fixture provider is unavailable. Try again.' } }
        return { ok: true, value: {
        sessionId: payload.sessionId, generatedAt: '2026-01-02T03:04:05.000Z',
        recap: {
          goal: 'Add reliable screenshot coverage for Session recap.',
          outcome: 'The plugin renders through the registered React slots.',
          nextStep: 'Review the screenshots and run the pull request checks.',
        },
      } }
      case 'configure': Object.assign(config, payload); return { ok: true, value: { ...config } }
      default: throw new Error(`Unexpected RPC method: ${method}`)
    }
  }) }
  const registrations = new Map()
  plugin.apply({
    get(service) { expect(service).toBe('connection'); return { rpc } },
    slots: {
      inject(slot, register) {
        expect(['conversation.input.dock', 'settings.plugin.item']).toContain(slot)
        register()
      },
      register(options, Component) {
        expect(registrations.has(options.name)).toBe(false)
        registrations.set(options.name, { options, Component })
      },
    },
  })
  expect([...registrations.keys()]).toEqual(['conversation.input.dock', 'settings.plugin.item'])
  const { options, Component } = registrations.get(name)
  const container = document.createElement('main')
  container.className = `fixture${dark ? ' dark' : ''}`
  if (narrow) container.style.width = '390px'
  container.dataset.testid = 'fixture'
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(name === 'conversation.input.dock'
      ? h(React.Fragment, null,
        h('h1', null, blank ? 'New conversation' : 'Screenshot coverage'),
        h('div', { className: 'conversation' }, blank ? 'Start a conversation.' : 'The implementation is ready for review.'),
        h(Component, { ...options.inject('fixture-session'), session: { blank } }),
        h('textarea', { 'aria-label': 'Message', placeholder: 'Send a message', readOnly: true }))
      : h(React.Fragment, null, h('h1', null, 'Plugin configuration'), h(Component, options.inject())))
  })
  await document.fonts.ready
  return { rpc, async unmount() {
    await act(async () => root.unmount())
    container.remove()
    localStorage.clear()
  } }
}
