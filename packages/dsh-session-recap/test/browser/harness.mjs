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
export async function mountSlot(name, { blank = false, narrow = false, dark = false, recapError = false, deferRecap = false, recapHeadline, recapTopic = 'Add reliable screenshot coverage for Session recap.' } = {}) {
  const pending = new Map()
  let sessionId = 'fixture-session'
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
      case 'recap': if (deferRecap) await new Promise(resolve => pending.set(payload.sessionId, resolve))
        if (recapError) return { ok: false, error: { code: 'fixture-error', details: {}, message: 'The fixture provider is unavailable. Try again.' } }
        return { ok: true, value: {
        sessionId: payload.sessionId, generatedAt: '2026-01-02T03:04:05.000Z',
        recap: {
          ...(recapHeadline === undefined ? {} : { headline: recapHeadline }),
          bullets: [typeof recapTopic === 'function' ? recapTopic(payload.sessionId) : recapTopic,
            'Use the registered React slots for the recap.',
            'We paused at the screenshot review.'],
        },
      } }
      case 'configure': Object.assign(config, payload); return { ok: true, value: { ...config } }
      default: throw new Error(`Unexpected RPC method: ${method}`)
    }
  }) }
  const registrations = new Map()
  const events = new Map()
  plugin.apply({
    get(service) {
      if (service === 'remote') return { $on(event, handler) { events.set(event, handler); return () => events.delete(event) } }
      expect(service).toBe('connection'); return { rpc }
    },
    slots: {
      inject(slot, register) {
        expect(['conversation.input.dock', 'conversation.session.header.utilities', 'settings.plugin.item']).toContain(slot)
        register()
      },
      register(options, Component) {
        expect(registrations.has(options.name)).toBe(false)
        registrations.set(options.name, { options, Component })
      },
    },
  })
  expect([...registrations.keys()]).toEqual(['conversation.input.dock', 'conversation.session.header.utilities', 'settings.plugin.item'])
  const { options, Component } = registrations.get(name)
  const container = document.createElement('main')
  container.className = `fixture${dark ? ' dark' : ''}`
  if (narrow) container.style.width = '390px'
  container.dataset.testid = 'fixture'
  document.body.append(container)
  const root = createRoot(container)
  const header = registrations.get('conversation.session.header.utilities')
  const render = () => act(async () => {
    root.render(name === 'conversation.input.dock'
      ? h(React.Fragment, null,
        h('header', { 'data-testid': 'session-header' },
          h('h1', null, blank ? 'New conversation' : 'Screenshot coverage'),
          h(header.Component, { ...header.options.inject(sessionId), useSession: (select) => select({ blank }) })),
        h('div', { className: 'conversation' }, blank ? 'Start a conversation.' : 'The implementation is ready for review.'),
        h('div', { 'data-testid': 'session-dock' }, h(Component, { ...options.inject(sessionId), session: { blank } })),
        h('textarea', { 'aria-label': 'Message', placeholder: 'Send a message' }))
      : h(React.Fragment, null, h('h1', null, 'Plugin configuration'), h(Component, options.inject())))
  })
  await render()
  await document.fonts.ready
  return { rpc,
    async sent(id = sessionId) { await act(async () => events.get('api-session/activity')(id, Date.now())) },
    async switchSession(id, isBlank = false) { sessionId = id; blank = isBlank; await render() },
    async resolveRecap(id = sessionId) {
      expect(pending.has(id)).toBe(true)
      await act(async () => { pending.get(id)(); pending.delete(id) })
    },
    async unmount() {
    await act(async () => root.unmount())
    container.remove()
    localStorage.clear()
  } }
}
