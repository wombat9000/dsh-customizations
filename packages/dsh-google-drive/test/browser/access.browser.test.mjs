import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import source from '../../client.js?raw'
let root, container
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const h = React.createElement
const folder = { id: 'folder', name: 'Reports', mimeType: 'application/vnd.google-apps.folder' }
const file = { id: 'file', name: 'Budget', mimeType: 'text/plain' }
const pending = { state: 'pending', requestId: 'opaque', grants: [] }
const click = locator => act(async () => locator.click())
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); root = undefined })
async function mount(handler, status = pending) {
  let record
  const previous = window.__ModuleLoader__
  window.__ModuleLoader__ = { load: value => { record = value } }
  try { new Function(source)() } finally { window.__ModuleLoader__ = previous }
  const plugin = record.factory(() => React), picker = plugin.createPickerStore(), calls = []
  const request = async (method, body, signal) => { calls.push({ method, body, signal }); return handler ? handler(method, body, signal) : method === 'browse' ? { files: [folder, file] } : status }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(h(React.Fragment, null, h(plugin.Card, { sessionId: 'session', callId: 'call', picker, request }), h(plugin.Overlay, { picker }))))
  return { calls, picker, async switchSession(sessionId) {
    await act(async () => root.render(h(React.Fragment, null, h(plugin.Card, { sessionId, callId: 'call', picker, request }), h(plugin.Overlay, { picker }))))
  } }
}
test('card retries when it mounts before the host registers the pending request', async () => {
  let statuses = 0, retried
  const ready = new Promise(resolve => { retried = resolve })
  await mount(method => {
    if (method === 'status' && ++statuses === 1) throw new Error('Request not registered yet.')
    retried()
    return pending
  })
  await expect.element(page.getByRole('alert')).toHaveTextContent('Request not registered yet.')
  await act(async () => ready)
  await expect.element(page.getByRole('button', { name: 'Choose files and folders' })).toBeVisible()
  expect(statuses).toBe(2)
})
test('choose, search, recursive review and grant send only selected IDs', async () => {
  const fixture = await mount((method) => method === 'browse' ? { files: [folder, file] } : method === 'grant' ? { state: 'granted', grants: [{ ...folder, recursive: true }] } : pending)
  await click(page.getByRole('button', { name: 'Choose files and folders' }))
  await expect.element(page.getByRole('dialog')).toBeVisible()
  expect(fixture.calls.find(call => call.method === 'browse').body.parentId).toBe('root')
  await expect.element(page.getByRole('list', { name: 'Selected access' })).not.toBeInTheDocument()
  await click(page.getByRole('checkbox', { name: 'Reports' }))
  await click(page.getByRole('button', { name: 'Review selection (1)' }))
  expect(page.getByRole('list', { name: 'Selected access' }).element().textContent).toMatch(/descendants|subfolders|future/i)
  await act(async () => page.getByRole('searchbox').fill('Budget'))
  await click(page.getByRole('button', { name: 'Search', exact: true }))
  expect(fixture.calls.filter(call => call.method === 'browse').at(-1).body).toEqual({ sessionId: 'session', callId: 'call', requestId: 'opaque', search: 'Budget' })
  await click(page.getByRole('button', { name: 'Allow read access' }))
  expect(fixture.calls.find(call => call.method === 'grant').body).toEqual({ sessionId: 'session', callId: 'call', requestId: 'opaque', selected: [{ id: 'folder', recursive: true }] })
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})
test('Cancel closes and aborts browsing without grant or deny; Deny is explicit', async () => {
  let resolveBrowse
  const fixture = await mount(method => method === 'browse' ? new Promise(resolve => { resolveBrowse = resolve }) : method === 'deny' ? { state: 'denied', grants: [] } : pending)
  await click(page.getByRole('button', { name: 'Choose files and folders' }))
  await click(page.getByRole('button', { name: 'Cancel', exact: true }))
  expect(fixture.calls.find(call => call.method === 'browse').signal.aborted).toBe(true)
  await act(async () => resolveBrowse({ files: [file] }))
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  expect(fixture.calls.some(call => ['grant', 'deny'].includes(call.method))).toBe(false)
  await click(page.getByRole('button', { name: 'Deny', exact: true }))
  expect(fixture.calls.find(call => call.method === 'deny').body.requestId).toBe('opaque')
})
test('settled Manage creates request then same picker allows revoke', async () => {
  const grants = [{ ...folder, recursive: true }]
  const fixture = await mount(method => method === 'browse' ? { files: [] } : method === 'manage' ? { ...pending, grants } : method === 'revoke' ? { state: 'none', grants: [] } : { state: 'granted', grants })
  await click(page.getByRole('button', { name: 'Manage access' }))
  await expect.element(page.getByRole('dialog')).toBeVisible()
  expect(fixture.calls.find(call => call.method === 'manage').body).toEqual({ sessionId: 'session', callId: 'call' })
  await click(page.getByRole('button', { name: 'Revoke all access' }))
  expect(fixture.calls.find(call => call.method === 'revoke').body).toEqual({ sessionId: 'session', callId: 'call' })
})
test('folder navigation, pagination and session changes keep request identity scoped', async () => {
  const fixture = await mount((method, body) => method !== 'browse' ? pending : body.parentId === 'folder' ? { files: [file], ...(body.pageToken ? {} : { nextPageToken: 'page2' }) } : { files: [folder] })
  await click(page.getByRole('button', { name: 'Choose files and folders' }))
  await click(page.getByRole('button', { name: 'Reports', exact: true }))
  expect(fixture.calls.at(-1).body.parentId).toBe('folder')
  await click(page.getByRole('button', { name: 'Next page' }))
  expect(fixture.calls.at(-1).body.pageToken).toBe('page2')
  await fixture.switchSession('other')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await click(page.getByRole('button', { name: 'Choose files and folders' }))
  expect(fixture.calls.at(-1).body.sessionId).toBe('other')
  expect(fixture.calls.at(-1).body.parentId).toBe('root')
})
test('review removal updates selection without granting and search-result folders reset navigation', async () => {
  const fixture = await mount(method => method === 'browse' ? { files: [folder, file] } : pending)
  await click(page.getByRole('button', { name: 'Choose files and folders' }))
  await expect.element(page.getByRole('button', { name: 'Allow read access' })).toBeDisabled()
  await click(page.getByRole('checkbox', { name: 'Budget' }))
  await click(page.getByRole('button', { name: 'Review selection (1)' }))
  await click(page.getByRole('button', { name: 'Remove Budget' }))
  await expect.element(page.getByRole('list', { name: 'Selected access' })).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Allow read access' })).toBeDisabled()
  await click(page.getByRole('button', { name: 'Reports', exact: true }))
  await act(async () => page.getByRole('searchbox').fill('Reports'))
  await click(page.getByRole('button', { name: 'Search', exact: true }))
  expect(fixture.calls.at(-1).body.parentId).toBeUndefined()
  expect(fixture.calls.at(-1).body.search).toBe('Reports')
  await click(page.getByRole('button', { name: 'Reports', exact: true }))
  expect(fixture.calls.at(-1).body.parentId).toBe('folder')
  expect(fixture.calls.at(-1).body.search).toBeUndefined()
  await click(page.getByRole('button', { name: 'My Drive', exact: true }))
  expect(fixture.calls.at(-1).body.parentId).toBe('root')
  expect(fixture.calls.some(call => ['grant', 'deny'].includes(call.method))).toBe(false)
})

test('Escape closes native modal and restores trigger focus without mutation', async () => {
  const fixture = await mount()
  const trigger = page.getByRole('button', { name: 'Choose files and folders' })
  await click(trigger)
  await act(async () => { document.querySelector('dialog').dispatchEvent(new Event('cancel', { cancelable: true })) })
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  expect(document.activeElement).toBe(trigger.element())
  expect(fixture.calls.some(call => ['deny', 'grant'].includes(call.method))).toBe(false)
})
test('stale search responses cannot replace current results and failed grants keep selection', async () => {
  let first
  let count = 0, failed = false
  await mount(method => {
    if (method === 'browse') return ++count === 1 ? new Promise(resolve => { first = resolve }) : { files: [file] }
    if (method === 'grant') { failed = true; throw new Error('Retry access.') }
    return failed ? { state: 'cancelled', grants: [] } : pending
  })
  await click(page.getByRole('button', { name: 'Choose files and folders' }))
  await act(async () => page.getByRole('searchbox').fill('Budget'))
  await click(page.getByRole('button', { name: 'Search', exact: true }))
  await act(async () => first({ files: [folder] }))
  await expect.element(page.getByRole('checkbox', { name: 'Budget' })).toBeVisible()
  await expect.element(page.getByRole('checkbox', { name: 'Reports' })).not.toBeInTheDocument()
  await click(page.getByRole('checkbox', { name: 'Budget' }))
  await click(page.getByRole('button', { name: 'Allow read access' }))
  await expect.element(page.getByRole('alert')).toHaveTextContent('Retry access.')
  await expect.element(page.getByRole('checkbox', { name: 'Budget' })).toBeChecked()
  await click(page.getByRole('button', { name: 'Cancel', exact: true }))
  await expect.element(page.getByRole('button', { name: 'Manage access' })).toBeVisible()
})
