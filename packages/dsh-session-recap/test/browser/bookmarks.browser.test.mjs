import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { BookmarkDetails } from '../../client/components/BookmarkDetails.tsx'
import { RecapPanel } from '../../client/components/RecapPanel.tsx'
import { SettingsForm } from '../../client/components/SettingsForm.tsx'
import { SettingsCard } from '../../client/containers/SettingsCard.tsx'
import { createController } from '../../client/controller.ts'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
async function render(Component, props) {
  if (!root) {
    container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => root.render(React.createElement(Component, props)))
}
const click = (locator) => act(async () => locator.click())
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = container = undefined
  vi.restoreAllMocks()
})

const bookmarkLabel = 'Keep Jev bookmarks as the conversation continues'
const defaults = {
  autoRecap: false,
  useJev: false,
  bookmarkJev: false,
  inactivityMinutes: 30,
  provider: '',
  model: '',
}
function diagnostics() {
  return {
    version: 1,
    questionSetVersion: 'bookmarks-fixture-v1',
    model: 'fixture/never-called',
    status: 'ready',
    processedMessages: 8,
    items: ['proposed', 'accepted', 'open', 'answered', 'completed', 'superseded'].map(
      (status, i) => ({
        id: `bookmark-${i}`,
        messageId: i === 0 ? '<img src=x onerror=alert(1)>' : `source-${i}`,
        kind: i % 2 ? 'question' : 'next_step',
        role: i % 2 ? 'user' : 'assistant',
        status,
        support: 0.91,
        ...(i === 4 ? { updatedByMessageId: 'update-message-7', transitionScore: 0.87 } : {}),
      }),
    ),
  }
}

test('bookmark details start collapsed and show escaped provenance and qualified statuses', async () => {
  await render(BookmarkDetails, { diagnostics: diagnostics() })
  expect(container.querySelector('details').open).toBe(false)
  await click(page.getByText('Bookmark details', { exact: true }))
  expect(container.querySelector('details').open).toBe(true)
  const table = container.querySelector('table')
  for (const text of [
    'Next step',
    'Open question',
    'assistant',
    'user',
    '0.91',
    'Proposed (not approved)',
    'Accepted by user',
    'Open',
    'Answer present',
    'Completion reported',
    'Superseded or abandoned',
    'update-message-7 (0.87)',
    '<img src=x onerror=alert(1)>',
  ])
    expect(table.textContent).toContain(text)
  expect(container.textContent).toContain('not verified task outcomes')
  expect(container.querySelector('img, script')).toBeNull()
})

test('copy exports only bookmark diagnostics and sanitizes clipboard errors', async () => {
  const snapshot = diagnostics()
  const copied = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  await render(BookmarkDetails, { diagnostics: snapshot, recap: 'PRIVATE FIXTURE RECAP' })
  await click(page.getByText('Bookmark details', { exact: true }))
  await click(page.getByRole('button', { name: 'Copy bookmark diagnostics JSON' }))
  expect(copied).toHaveBeenCalledExactlyOnceWith(JSON.stringify(snapshot, null, 2))
  expect(copied.mock.calls[0][0]).not.toContain('PRIVATE FIXTURE RECAP')
  expect(container.textContent).toContain('Bookmark diagnostics copied.')
  await render(BookmarkDetails, { diagnostics: { ...snapshot, status: 'pending' } })
  expect(container.querySelector('[role="status"]')).toBeNull()
  copied.mockRejectedValue(Error('PRIVATE CLIPBOARD ERROR'))
  await click(page.getByRole('button', { name: 'Copy bookmark diagnostics JSON' }))
  expect(container.textContent).toContain(
    'Clipboard unavailable. Expand the JSON and copy it manually.',
  )
  expect(container.textContent).not.toContain('PRIVATE CLIPBOARD ERROR')
  await click(page.getByText('Bookmark diagnostics JSON', { exact: true }))
  expect(JSON.parse(container.querySelector('pre').textContent).status).toBe('pending')
})

test('bookmark panels support selected cards and standard fallback diagnostics', async () => {
  await render(RecapPanel, {
    recap: { cards: [{ label: 'next_step', text: 'A proposed fixture action.' }] },
    selection: { mode: 'bookmarks', bookmarks: diagnostics() },
  })
  expect(container.querySelector('[data-recap-card="next_step"]')).not.toBeNull()
  expect(container.querySelector('summary').textContent).toBe('Bookmark details')
  for (const [reason, caption] of [
    ['unavailable', 'Bookmarks unavailable; using standard recap'],
    ['no-labels', 'No active bookmarks; using standard recap'],
  ]) {
    await render(RecapPanel, {
      recap: { bullets: ['Standard fixture recap.'] },
      selection: { mode: 'standard', reason, bookmarks: { ...diagnostics(), items: [] } },
    })
    expect(container.textContent).toContain(caption)
    expect(container.textContent).toContain('Standard fixture recap.')
    expect(container.textContent).toContain(
      'No retained bookmarks. The standard recap remains available.',
    )
  }
})

test('bookmark opt-in is false by default, requires Jev, and describes background charges', async () => {
  const onChange = vi.fn()
  const props = { open: true, draft: defaults, providers: [], onChange }
  await render(SettingsForm, props)
  const checkbox = () => page.getByRole('checkbox', { name: bookmarkLabel }).element()
  expect(checkbox().checked).toBe(false)
  expect(checkbox().disabled).toBe(true)
  const warning = document.getElementById(checkbox().getAttribute('aria-describedby')).textContent
  for (const text of [
    'off by default',
    'OpenRouter',
    'TypeSafe',
    'even if you never open a recap',
    'API charges',
  ]) {
    expect(warning.replace(/\s+/g, ' ')).toContain(text)
  }
  await render(SettingsForm, { ...props, draft: { ...defaults, useJev: true } })
  expect(checkbox().disabled).toBe(false)
  await click(page.getByRole('checkbox', { name: bookmarkLabel }))
  expect(onChange).toHaveBeenLastCalledWith('bookmarkJev', true)
  await render(SettingsForm, { ...props, busy: true, draft: { ...defaults, useJev: true } })
  expect(checkbox().disabled).toBe(true)
})

test('settings save and reload the bookmark boolean through mocked RPC only', async () => {
  let saved = { ...defaults }
  const rpc = {
    call: vi.fn(async (_, method, payload) => {
      if (method === 'models') return { ok: true, value: { providers: [] } }
      if (method === 'configure') saved = { ...payload }
      return { ok: true, value: { ...saved } }
    }),
  }
  const controller = { invalidateSettings: vi.fn() }
  await render(SettingsCard, { rpc, controller, view: 'page' })
  await click(page.getByRole('button', { name: 'Save', exact: true }))
  expect(rpc.call).toHaveBeenLastCalledWith('/session-recap', 'configure', defaults)
  await click(page.getByRole('checkbox', { name: 'Use Jev to choose recap cards' }))
  await click(page.getByRole('checkbox', { name: bookmarkLabel }))
  await click(page.getByRole('button', { name: 'Save', exact: true }))
  expect(saved).toEqual({ ...defaults, useJev: true, bookmarkJev: true })
  expect(controller.invalidateSettings).toHaveBeenCalledTimes(2)
  await render(() => null)
  await render(SettingsCard, { rpc, controller, view: 'page' })
  expect(page.getByRole('checkbox', { name: bookmarkLabel }).element().checked).toBe(true)
  expect(
    rpc.call.mock.calls.every(([, method]) => ['settings', 'models', 'configure'].includes(method)),
  ).toBe(true)
})

test('inspection and copying make no RPC; controller discards bookmark recap memory on the next turn', async () => {
  const rpc = {
    call: vi.fn(async () => ({
      ok: true,
      value: {
        sessionId: 'fixture-session',
        recap: { bullets: ['Private fixture recap.'] },
        selection: { mode: 'bookmarks', bookmarks: diagnostics() },
      },
    })),
  }
  const controller = createController({ rpc, storage: null })
  controller.observeSession('fixture-session', { ready: true, running: false, latestTurn: 1 })
  await controller.recap('fixture-session')
  await render(RecapPanel, controller.getSnapshot('fixture-session'))
  vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  await click(page.getByText('Bookmark details', { exact: true }))
  await click(page.getByRole('button', { name: 'Copy bookmark diagnostics JSON' }))
  expect(rpc.call).toHaveBeenCalledExactlyOnceWith('/session-recap', 'recap', {
    sessionId: 'fixture-session',
    automatic: false,
  })
  controller.observeSession('fixture-session', { ready: true, running: true, latestTurn: 2 })
  expect(controller.getSnapshot('fixture-session')).toEqual({})
  await render(RecapPanel, controller.getSnapshot('fixture-session'))
  expect(container.querySelector('details')).toBeNull()
  expect(container.textContent).not.toContain('Private fixture recap.')
})
