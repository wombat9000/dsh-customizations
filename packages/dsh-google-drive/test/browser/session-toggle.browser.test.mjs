import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import source from '../../client.js?raw'
const h = React.createElement
let root, container
let record
const previous = window.__ModuleLoader__
window.__ModuleLoader__ = { load: value => { record = value } }
try { new Function(source)() } finally { window.__ModuleLoader__ = previous }
const plugin = record.factory(() => React)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const status = (enabled = false, revision = 0, ownerId = 'owner') => ({ available: true, enabled, revision, ownerId })
const toggle = () => page.getByRole('switch', { name: 'Google Drive' })
const click = () => act(async () => toggle().click())
afterEach(async () => { await act(async () => root?.unmount()); root = null; container?.remove(); vi.restoreAllMocks() })
async function mount(handler, sessionId = 'a') {
  const calls = []
  const api = async (method, body, signal) => { calls.push({ method, body, signal }); return handler(method, body, signal) }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  const render = async id => act(async () => root.render(h(plugin.SessionToggle, { sessionId: id, api })))
  await render(sessionId)
  return { calls, render }
}
test('strict session status rejects malformed and ambiguous authority', () => {
  for (const value of [null, {}, { available: false, enabled: true }, { available: false, enabled: false, ownerId: 'x' }, status(false, -1), status(false, 1.5), status(false, Number.MAX_SAFE_INTEGER + 1), status(false, 0, ''), { ...status(), enabled: 'false' }]) expect(plugin.validSessionStatus(value)).toBe(false)
  expect(plugin.validSessionStatus({ available: false, enabled: false })).toBe(true)
  expect(plugin.validSessionStatus(status())).toBe(true)
})
test('default OFF, exact one same-origin POST enables; OFF warning explains boundaries', async () => {
  const fetch = vi.spyOn(window, 'fetch').mockImplementation(async (url, init) => ({ ok: true, json: async () => ({ ok: true, value: url.endsWith('session-set') ? status(true, 1) : status() }) }))
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(h(plugin.SessionToggle, { sessionId: 'a' })))
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
  await click()
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'true')
  const mutations = fetch.mock.calls.filter(([url]) => url.endsWith('session-set'))
  expect(mutations).toHaveLength(1)
  expect(mutations[0][1].method).toBe('POST')
  expect(mutations[0][1].credentials).toBe('same-origin')
  expect(JSON.parse(mutations[0][1].body)).toEqual({ sessionId: 'a', ownerId: 'owner', revision: 0, enabled: true })
  expect(container.textContent).toContain('Google Drive')
  expect(container.querySelector('[tabindex]').getAttribute('aria-label')).toMatch(/no file access.*OFF revokes.*cannot undo dispatched writes/)
})
test('unavailable sessions cannot enable and malformed responses expose retry', async () => {
  let value = { available: false, enabled: false }
  const fixture = await mount(() => value)
  await expect.element(toggle()).toBeDisabled()
  value = { ...status(), revision: '0' }
  await fixture.render('b')
  expect(page.getByRole('alert').element().textContent).toContain('Cannot confirm')
  await expect.element(toggle()).toBeDisabled()
  value = status()
  await act(async () => page.getByRole('button', { name: 'Retry status check' }).click())
  await expect.element(toggle()).toBeEnabled()
})
test('pending mutation prevents double click and remains authoritative until response', async () => {
  let resolve
  const fixture = await mount(method => method === 'session-status' ? status() : new Promise(r => { resolve = r }))
  await act(async () => { const button = toggle().element(); button.click(); button.click() })
  expect(fixture.calls.filter(call => call.method === 'session-set')).toHaveLength(1)
  await expect.element(toggle()).toBeDisabled()
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
  await act(async () => resolve(status(true, 1)))
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'true')
})
test.each(['network', 'stale'])('%s mutation failure re-reads; retry never repeats a mutation', async failure => {
  let reads = 0, recover
  const fixture = await mount(method => {
    if (method === 'session-set') { if (failure === 'stale') return status(true, 0, 'old-owner'); throw new Error('uncertain') }
    if (++reads === 1) return status()
    return new Promise(resolve => { recover = resolve })
  })
  await click()
  await expect.element(toggle()).toBeDisabled()
  expect(fixture.calls.map(call => call.method)).toEqual(['session-status', 'session-set', 'session-status'])
  await act(async () => recover(status(true, 1)))
  await expect.element(toggle()).toBeEnabled()
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'true')
  expect(fixture.calls.filter(call => call.method === 'session-set')).toHaveLength(1)
})
test('failed recovery locks switch until successful read-only retry', async () => {
  let healthy = true
  await mount(method => { if (!healthy || method === 'session-set') throw new Error('offline'); return status() })
  healthy = false
  await click()
  await expect.element(toggle()).toBeDisabled()
  healthy = true
  await act(async () => page.getByRole('button', { name: 'Retry status check' }).click())
  await expect.element(toggle()).toBeEnabled()
})
test('session switch isolates authority and aborts late mutation; unmount aborts reads', async () => {
  let mutation, lateRead
  const fixture = await mount((method, body) => method === 'session-set' ? new Promise(resolve => { mutation = resolve }) : body.sessionId === 'c' ? new Promise(resolve => { lateRead = resolve }) : status(false, 0, body.sessionId))
  await click()
  await fixture.render('b')
  expect(fixture.calls.find(call => call.method === 'session-set').signal.aborted).toBe(true)
  await act(async () => mutation(status(true, 1, 'a')))
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
  await fixture.render('c')
  await act(async () => root.unmount()); root = null
  expect(fixture.calls.at(-1).signal.aborted).toBe(true)
  await act(async () => lateRead(status(true, 9, 'c')))
})
test('OFF sends exact revision and blank reset aborts without assuming unavailable', async () => {
  let blank = false, resolveRead
  const calls = [], request = async (method, body, signal) => {
    calls.push({ method, body, signal })
    if (blank) return new Promise(resolve => { resolveRead = resolve })
    return method === 'session-set' ? status(false, 3) : status(true, 2)
  }
  const useSession = selector => selector({ blank })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  const render = () => act(async () => root.render(h(plugin.SessionToggle, { sessionId: 'a', api: request, useSession })))
  await render(); await click()
  expect(calls.at(-1).body).toEqual({ sessionId: 'a', enabled: false, ownerId: 'owner', revision: 2 })
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
  blank = true; await render()
  await expect.element(toggle()).toBeDisabled()
  expect(calls.at(-1).body.sessionId).toBe('a')
  await act(async () => resolveRead(status(true, 0, 'new-owner')))
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'true')
  blank = false; await render()
  expect(calls.at(-2).signal.aborted).toBe(true)
})
test('poll refreshes other-tab changes and owner lifecycle', async () => {
  let value = status()
  await mount(() => value)
  value = status(true, 4)
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'true', { timeout: 4500 })
  value = { available: false, enabled: false }
  await expect.element(toggle()).toBeDisabled({ timeout: 4500 })
}, 10000)
