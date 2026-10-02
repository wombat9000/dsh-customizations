import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import bundle from '../../lib/client.js?raw'

// Use the existing generated loader boundary with real React, not fake hooks.
function loadClient(source) {
  let client
  const previous = window.__ModuleLoader__
  window.__ModuleLoader__ = {
    load({ factory }) {
      client = factory((name) => {
        if (name === 'react') return React
        throw new Error(`Unexpected external: ${name}`)
      })
    },
  }
  try {
    new Function(source)()
  } finally {
    if (previous === undefined) delete window.__ModuleLoader__
    else window.__ModuleLoader__ = previous
  }
  return client
}

const client = loadClient(bundle)

function selectorStore(initial) {
  let state = initial
  const listeners = new Set()
  const subscribe = (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return {
    useSelector(selector) {
      return selector(React.useSyncExternalStore(subscribe, () => state))
    },
    set(next) {
      state = next
      for (const listener of listeners) listener()
    },
  }
}

test('card follows Conversation and foreground sidebar state without leaking its visibility rule', async () => {
  // This component fixture models only the pinned data-marker boundary. The
  // real-shell suite owns proof that DSH emits these markers during navigation.
  const first = 'session"\\]first'
  const second = 'second'
  const session = (id, selected) => ({
    id,
    cwd: `/workspace/${id}`,
    retainedBy: selected ? { mainView: 1 } : {},
  })
  const sessions = selectorStore({
    byId: { [first]: session(first, true), [second]: session(second, false) },
  })
  const panels = selectorStore({ activePanelId: null })
  const disposeReset = vi.fn()
  const requests = []
  const Card = client.createEnvironmentCard(
    { on: () => disposeReset },
    {
      async read({ sessionId }, signal) {
        requests.push({ sessionId, signal })
        return {
          ok: true,
          value: {
            cwd: `/workspace/${sessionId}`,
            home: '/home/test',
            repo: true,
            hasHead: true,
            branch: 'main',
            upstream: null,
            ahead: null,
            behind: null,
            dirtyFiles: 0,
            additions: 0,
            deletions: 0,
          },
        }
      },
    },
  )
  container = document.createElement('main')
  const overlay = document.createElement('div')
  overlay.setAttribute('data-shell-overlay', '')
  const main = document.createElement('div')
  main.setAttribute('data-slot', 'main.conversation')
  const content = document.createElement('div')
  content.setAttribute('data-conversation-content', '')
  content.setAttribute('data-conversation-session', first)
  const view = document.createElement('div')
  view.setAttribute('data-slot', 'conversation.view')
  const chatFlow = document.createElement('div')
  chatFlow.setAttribute('data-chat-flow', '')
  view.append(chatFlow)
  content.append(view)
  main.append(content)
  container.append(main)
  const sidebar = (id, hidden, open) => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-sidebar-right-session', id)
    wrapper.hidden = hidden
    const panel = document.createElement('div')
    panel.setAttribute('data-sidebar-right-session', id)
    panel.setAttribute('data-sidebar-right-panel', 'push')
    if (open) panel.setAttribute('data-sidebar-right-open', '')
    const outlet = document.createElement('div')
    outlet.setAttribute('data-slot', 'rightbar.session')
    outlet.style.display = 'contents'
    outlet.append(panel)
    wrapper.append(outlet)
    container.append(wrapper)
    return { wrapper, panel }
  }
  const foreground = sidebar(first, false, false)
  const background = sidebar(second, true, true)
  container.append(overlay)
  document.body.append(container)
  root = createRoot(overlay)
  await act(async () => {
    root.render(
      React.createElement(Card, {
        useSessions: sessions.useSelector,
        usePanelInfo: panels.useSelector,
      }),
    )
  })
  const card = () => overlay.querySelector('[aria-label="Session environment"]')
  await expect.element(card()).toBeVisible()
  expect(getComputedStyle(card()).position).toBe('fixed')
  expect(getComputedStyle(card()).top).toBe('84px')
  expect(getComputedStyle(card()).right).toBe('18px')

  for (const mode of ['push', 'fullscreen']) {
    foreground.panel.setAttribute('data-sidebar-right-panel', mode)
    // Fullscreen can be open while the frame has no reserved right track.
    container.toggleAttribute('data-rightbar-collapsed', mode === 'fullscreen')
    container.toggleAttribute('data-rightbar-fullscreen', mode === 'fullscreen')
    foreground.panel.setAttribute('data-sidebar-right-open', '')
    await expect.element(card()).not.toBeVisible()
    foreground.panel.removeAttribute('data-sidebar-right-open')
    await expect.element(card()).toBeVisible()
  }

  // Even a retained open panel for the same session is inert when hidden.
  foreground.wrapper.hidden = true
  foreground.panel.setAttribute('data-sidebar-right-open', '')
  await expect.element(card()).toBeVisible()
  foreground.wrapper.hidden = false
  await act(async () => {
    sessions.set({
      byId: { [first]: session(first, false), [second]: session(second, true) },
    })
  })
  // Selection can update before the shell switches its DOM. The old Chat
  // content cannot show the new session's card.
  await expect.element(card()).not.toBeVisible()
  content.setAttribute('data-conversation-session', second)
  await expect.element(card()).toBeVisible()
  // An open panel for another session cannot hide the selected Chat's card.
  foreground.wrapper.hidden = true
  background.wrapper.hidden = false
  await expect.element(card()).not.toBeVisible()
  background.panel.removeAttribute('data-sidebar-right-open')
  await expect.element(card()).toBeVisible()
  const copied = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  await act(async () => {
    await page.getByRole('button', { name: 'Copy CWD: /workspace/second', exact: true }).click()
  })
  expect(copied.mock.calls).toEqual([['/workspace/second']])

  // Hidden retained Chat content and embedded Chat occurrences are not the
  // foreground main Chat. Missing Chat content also fails closed.
  view.hidden = true
  await expect.element(card()).not.toBeVisible()
  view.hidden = false
  main.setAttribute('data-slot', 'rightbar.session')
  await expect.element(card()).not.toBeVisible()
  main.setAttribute('data-slot', 'main.conversation')
  chatFlow.remove()
  await expect.element(card()).not.toBeVisible()
  view.append(chatFlow)
  await expect.element(card()).toBeVisible()

  for (const activePanelId of ['projects', 'plugins', 'another-global-page']) {
    await act(async () => panels.set({ activePanelId }))
    expect(card()).toBeNull()
    expect(overlay.querySelector('style')).toBeNull()
  }
  await act(async () => panels.set({ activePanelId: null }))
  await expect.element(card()).toBeVisible()
  for (const byId of [
    {},
    { [first]: session(first, false) },
    { [first]: session(first, true), [second]: session(second, true) },
  ]) {
    await act(async () => sessions.set({ byId }))
    expect(card()).toBeNull()
  }
  await act(async () => sessions.set({ byId: { [second]: session(second, true) } }))
  await expect.element(card()).toBeVisible()
  await act(async () => root.unmount())
  root = undefined
  expect(overlay.querySelector('style')).toBeNull()
  expect(requests.length).toBeGreaterThan(0)
  expect(requests.every(({ signal }) => signal.aborted)).toBe(true)
  expect(disposeReset).toHaveBeenCalled()
  // A later overlay is not affected by a rule left behind after disposal.
  overlay.innerHTML = '<section data-session-environment>Another overlay</section>'
  background.panel.setAttribute('data-sidebar-right-open', '')
  await expect.element(overlay.firstElementChild).toBeVisible()
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root
let container

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = undefined
  vi.restoreAllMocks()
})

for (const [label, value] of [
  ['CWD', '/home/test/projects/very-long-directory'],
  ['branch name', 'feat/very-long-branch-name'],
]) {
  for (const failure of [false, true]) {
    test(`${label} copies the full value and renders ${failure ? 'failure' : 'success'} feedback`, async () => {
      let settle
      const copied = vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            settle = () => (failure ? reject(new Error('Permission denied')) : resolve())
          }),
      )
      container = document.createElement('main')
      document.body.append(container)
      root = createRoot(container)
      await act(async () => {
        root.render(React.createElement(client.CopyValue, { label, value }, '…shortened'))
      })
      const button = page.getByRole('button', { name: `Copy ${label}: ${value}`, exact: true })
      await expect.element(button).toHaveAttribute('type', 'button')
      await expect.element(button).toHaveTextContent('…shortened')
      const status = page.getByRole('status')
      await expect.element(status).toHaveAttribute('aria-live', 'polite')
      expect(status.element().textContent).toBe('')
      await act(async () => button.click())
      expect(copied.mock.calls).toEqual([[value]])
      expect(status.element().textContent).toBe('')
      await act(async () => settle())
      await expect
        .element(status)
        .toHaveTextContent(failure ? `Could not copy ${label}. Try again.` : `${label} copied`)
      await expect.element(status).toBeVisible()
    })
  }
}
