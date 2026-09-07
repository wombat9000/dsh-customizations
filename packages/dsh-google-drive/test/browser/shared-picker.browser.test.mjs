import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import source from '../../client.js?raw'
let root, container
const h = React.createElement
const click = locator => act(async () => locator.click())
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => { await act(async () => root?.unmount()); container?.remove() })
const folder = { id: 'folder', name: 'Shared folder', mimeType: 'application/vnd.google-apps.folder' }
const mine = { id: 'mine', name: 'Personal budget', mimeType: 'application/vnd.google-apps.spreadsheet' }
const shared = { id: 'shared', name: 'Team budget', mimeType: mine.mimeType }
async function mount(mode, handler) {
  let record
  const previous = window.__ModuleLoader__
  window.__ModuleLoader__ = { load: value => { record = value } }
  try { new Function(source)() } finally { window.__ModuleLoader__ = previous }
  const plugin = record.factory(() => React), calls = []
  const request = async (method, body, signal) => { calls.push({ method, body, signal }); return handler(method, body, signal) }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(h(plugin.Picker, { entry: { mode, sessionId: 's', callId: 'c', status: { state: 'pending', requestId: 'r', grants: [] }, request, onChanged() {} }, close() {} })))
  return calls
}
for (const mode of ['read', 'edit']) test(`${mode}: tabs reset navigation, preserve combined selection and global search`, async () => {
  const calls = await mount(mode, (method, body) => method.endsWith('grant') ? { state: 'granted', grants: [] } : { files: body.search ? [folder, mine, shared] : body.parentId ? [shared] : body.view === 'shared-with-me' ? [folder, shared] : [mine] })
  expect(calls[0].body.view).toBe('my-drive')
  expect(calls[0].body.parentId).toBeUndefined()
  await expect.element(page.getByRole('navigation')).not.toBeInTheDocument()
  await click(page.getByRole('checkbox', { name: mine.name }))
  const sharedTab = page.getByRole('tab', { name: 'Shared with me' })
  await click(sharedTab)
  await expect.element(sharedTab).toHaveAttribute('aria-selected', 'true')
  await click(page.getByRole('checkbox', { name: shared.name }))
  await click(page.getByRole('button', { name: folder.name, exact: true }))
  expect(calls.at(-1).body.parentId).toBe('folder')
  await expect.element(page.getByRole('navigation', { name: 'Drive folders' })).toBeVisible()
  await act(async () => page.getByRole('searchbox').fill('folder'))
  await click(page.getByRole('button', { name: 'Search', exact: true }))
  expect(calls.at(-1).body).toMatchObject({ view: 'shared-with-me', search: 'folder' })
  expect(calls.at(-1).body.parentId).toBeUndefined()
  await expect.element(page.getByRole('tabpanel', { name: 'Search results across all of Drive' })).toBeVisible()
  await expect.element(page.getByRole('checkbox', { name: mine.name })).toBeChecked()
  await expect.element(page.getByRole('checkbox', { name: shared.name })).toBeChecked()
  await expect.element(page.getByRole('navigation')).not.toBeInTheDocument()
  await click(page.getByRole('tab', { name: 'My Drive', exact: true }))
  await click(sharedTab)
  expect(calls.at(-1).body.parentId).toBeUndefined()
  expect(calls.at(-1).body.search).toBeUndefined()
  await expect.element(page.getByRole('button', { name: 'Review selection (2)' })).toBeVisible()
  await click(page.getByRole('button', { name: mode === 'edit' ? 'Allow editing for this session' : 'Allow read access' }))
  expect(calls.at(-1).method).toBe(mode === 'edit' ? 'edit-grant' : 'grant')
  expect(calls.at(-1).body.selected).toEqual([{ id: 'mine', recursive: false }, { id: 'shared', recursive: false }])
})
test('tabs use roving focus and ArrowLeft/Right, Home and End activation', async () => {
  await mount('read', () => ({ files: [] }))
  const my = page.getByRole('tab', { name: 'My Drive', exact: true }), sharedTab = page.getByRole('tab', { name: 'Shared with me' })
  for (const [key, target] of [['ArrowRight', sharedTab], ['ArrowRight', my], ['ArrowLeft', sharedTab], ['Home', my], ['End', sharedTab]]) {
    await act(async () => { document.querySelector('[role=tab][aria-selected=true]').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
    expect(document.activeElement).toBe(target.element())
    await expect.element(target).toHaveAttribute('aria-selected', 'true')
    expect(target.element().tabIndex).toBe(0)
  }
})
test('aborts and discards stale pagination across tabs, search and folder navigation', async () => {
  const deferred = []
  const calls = await mount('read', (method, body) => body.pageToken ? new Promise(resolve => deferred.push(resolve)) : { files: [folder, body.view === 'shared-with-me' ? shared : mine], nextPageToken: 'next' })
  for (const transition of [
    () => click(page.getByRole('tab', { name: 'Shared with me' })),
    async () => { await act(async () => page.getByRole('searchbox').fill('global')); await click(page.getByRole('button', { name: 'Search', exact: true })) },
    () => click(page.getByRole('button', { name: folder.name, exact: true })),
  ]) {
    await click(page.getByRole('button', { name: 'Next page' }))
    const stale = calls.at(-1)
    // Navigation remains available during an outstanding page request.
    if (deferred.length === 3) {
      // The folder is hidden while loading: return to the current tab first.
      await click(page.getByRole('tab', { name: 'Shared with me' }))
    }
    await transition()
    expect(stale.signal.aborted).toBe(true)
    await act(async () => deferred.at(-1)({ files: [{ ...mine, id: 'stale', name: 'Stale result' }], nextPageToken: 'stale-page' }))
    await expect.element(page.getByRole('checkbox', { name: 'Stale result' })).not.toBeInTheDocument()
    expect(calls.at(-1).body.pageToken).toBeUndefined()
  }
})
