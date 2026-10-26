import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { WorktreeToggle } from '../../src/client/worktree.tsx'

const h = React.createElement
let root
let container
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

// Real external-store hooks model only native hook inputs. The shell journey
// separately proves native slot election, layout, and browser-to-host transport.
function nativeSources(initial = {}) {
  let state = { blank: true, subagent: null, cwd: '/repo', openState: 'open', ...initial }
  const listeners = new Set()
  const subscribe = (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const snapshot = () => state
  return {
    useSession(selector) {
      return selector(React.useSyncExternalStore(subscribe, snapshot))
    },
    useProjection(key) {
      if (key !== 'workingDirectory') throw new Error(`Unexpected projection: ${key}`)
      return React.useSyncExternalStore(subscribe, snapshot).cwd
    },
    set(change) {
      state = { ...state, ...change }
      for (const listener of listeners) listener()
    },
  }
}

function preference(change = {}) {
  return {
    sessionId: 'first',
    enabled: false,
    revision: 0,
    cwd: '/repo',
    available: true,
    reason: null,
    ...change,
  }
}
const ok = (value) => ({ ok: true, value })
const toggle = () => page.getByRole('switch', { name: 'Worktree mode', exact: true })
const click = () => act(async () => toggle().click())
const retry = () =>
  act(async () => page.getByRole('button', { name: 'Retry', exact: true }).click())

async function mount(remote, sources, sessionId = 'first') {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const render = (id = sessionId) =>
    act(async () => {
      root.render(
        h(
          React.Fragment,
          null,
          ...['hero', 'composer'].map((placement) =>
            h(WorktreeToggle, {
              key: placement,
              remote,
              sessionId: id,
              useSession: sources.useSession,
              useProjection: sources.useProjection,
              placement,
            }),
          ),
        ),
      )
    })
  await render()
  return { render }
}

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  root = undefined
  container?.remove()
  vi.restoreAllMocks()
})

test('saved preference follows hero/composer lifecycle, errors recover read-only, and non-Git disables enabling', async () => {
  const firstRead = deferred()
  let read = () => firstRead.promise
  let save
  let value = preference()
  const remote = {
    readWorktreePreference: vi.fn((request, signal) => read(request, signal)),
    setWorktreePreference: vi.fn(() => {
      save = deferred()
      return save.promise
    }),
  }
  const sources = nativeSources({ openState: 'loading' })
  await mount(remote, sources)
  await expect.element(toggle()).toBeDisabled()
  expect(remote.readWorktreePreference).not.toHaveBeenCalled()
  await act(async () => sources.set({ openState: 'open' }))
  await expect.element(toggle()).toBeDisabled()
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
  expect(container.querySelector('[data-worktree-toggle="composer"]')).toBeNull()
  expect(
    remote.readWorktreePreference.mock.calls.every(([request]) => request.sessionId === 'first'),
  ).toBe(true)

  read = async () => ok(value)
  await act(async () => firstRead.resolve(ok(value)))
  await expect.element(toggle()).toBeEnabled()
  const tooltip = container.querySelector('[data-worktree-toggle]').title
  expect(tooltip).toContain('Prefer an isolated Git worktree for code changes.')
  expect(tooltip).toContain('Create it when needed using DSH’s worktree tools.')
  expect(tooltip).toContain('This is guidance, not enforced isolation.')
  expect(tooltip).toContain('Off does not change or delete a worktree.')
  expect(tooltip).toContain('remembered for new sessions')

  await click()
  expect(remote.setWorktreePreference.mock.calls[0][0]).toEqual({
    sessionId: 'first',
    enabled: true,
    revision: 0,
    cwd: '/repo',
  })
  await expect.element(toggle()).toBeDisabled()
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
  await expect.poll(() => toggle().element().textContent).toContain('Saving')
  // No second write can start while the first remains unconfirmed.
  await act(async () => toggle().element().click())
  expect(remote.setWorktreePreference).toHaveBeenCalledTimes(1)
  value = preference({ enabled: true, revision: 1 })
  await act(async () => save.resolve(ok(value)))
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => toggle().element().textContent).toContain('On')

  // Composer was mounted but hidden during the hero write. It must refresh
  // through the shared component notification, not retain its first Off read.
  await act(async () => sources.set({ blank: false }))
  expect(container.querySelector('[data-worktree-toggle="hero"]')).toBeNull()
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'true')
  await click()
  expect(remote.setWorktreePreference.mock.calls[1][0]).toEqual({
    sessionId: 'first',
    enabled: false,
    revision: 1,
    cwd: '/repo',
  })
  await act(async () => save.reject(new Error('Disconnected after dispatch')))
  await expect
    .poll(() => page.getByRole('alert').element().textContent)
    .toContain('Could not save Worktree mode')
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'true')
  await expect.element(toggle()).toBeDisabled()
  // The host may have saved despite losing the response. Retry checks status;
  // it never repeats an uncertain mutation.
  value = preference({ enabled: false, revision: 2 })
  await retry()
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
  await expect.element(toggle()).toBeEnabled()
  expect(remote.setWorktreePreference).toHaveBeenCalledTimes(2)
  expect(container.querySelector('[role="alert"]')).toBeNull()

  value = preference({
    cwd: '/not-git',
    revision: 2,
    available: false,
    reason: 'Not a Git repository.',
  })
  await act(async () => sources.set({ cwd: '/not-git' }))
  await expect.element(toggle()).toBeDisabled()
  await expect.poll(() => toggle().element().textContent).toContain('Unavailable')
  expect(container.querySelector('[data-worktree-toggle]').title).toContain('Not a Git repository.')

  // A persisted On choice is not an effective On state in an unavailable cwd.
  // Disabling that saved choice remains possible; enabling a saved Off does not.
  value = preference({
    cwd: '/unborn',
    enabled: true,
    revision: 2,
    available: false,
    reason: 'This repository has no commits yet.',
  })
  await act(async () => sources.set({ cwd: '/unborn' }))
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => toggle().element().textContent).toContain('Unavailable')
  await expect.element(toggle()).toBeEnabled()
  await click()
  value = { ...value, enabled: false, revision: 3 }
  await act(async () => save.resolve(ok(value)))
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
  await expect.element(toggle()).toBeDisabled()

  // A first commit or enabling the native bundle changes eligibility without
  // changing cwd. Explicit refresh recovers in place without another write.
  value = preference({ cwd: '/unborn', revision: 3 })
  await act(async () =>
    page.getByRole('button', { name: 'Refresh Worktree status', exact: true }).click(),
  )
  await expect.element(toggle()).toBeEnabled()
  expect(remote.setWorktreePreference).toHaveBeenCalledTimes(3)

  read = async () => ({ ok: false, error: { message: 'Storage unavailable' } })
  await act(async () => sources.set({ cwd: '/repo' }))
  await expect
    .poll(() => page.getByRole('alert').element().textContent)
    .toContain('Could not check Worktree mode')
  await expect.element(toggle()).toBeDisabled()
  value = preference({ revision: 3 })
  read = async () => ok(value)
  await retry()
  await expect.element(toggle()).toBeEnabled()
  await act(async () => sources.set({ subagent: { address: { sessionId: 'parent' } } }))
  expect(container.querySelector('[role="switch"]')).toBeNull()
})

test('late reads and saves cannot cross session, effective cwd, or component lifetime', async () => {
  const initialRead = deferred()
  const oldSave = deferred()
  const changedCwdRead = deferred()
  const finalRead = deferred()
  const reads = []
  const writes = []
  const sources = nativeSources()
  let nextRead = () => initialRead.promise
  const remote = {
    readWorktreePreference(request, signal) {
      reads.push({ request, signal })
      return nextRead(request)
    },
    setWorktreePreference(request, signal) {
      writes.push({ request, signal })
      return oldSave.promise
    },
  }
  const fixture = await mount(remote, sources)
  nextRead = async ({ sessionId }) => ok(preference({ sessionId }))
  await fixture.render('second')
  await expect.element(toggle()).toBeEnabled()
  expect(reads.slice(0, 2).every(({ signal }) => signal.aborted)).toBe(true)
  await act(async () => initialRead.resolve(ok(preference({ enabled: true, revision: 99 }))))
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')

  await click()
  expect(writes[0].request.sessionId).toBe('second')
  await fixture.render('third')
  expect(writes[0].signal.aborted).toBe(true)
  await act(async () =>
    oldSave.resolve(ok(preference({ sessionId: 'second', enabled: true, revision: 4 }))),
  )
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
  expect(container.querySelector('[role="alert"]')).toBeNull()

  nextRead = () => changedCwdRead.promise
  await act(async () => sources.set({ cwd: '/old-cwd' }))
  await expect.element(toggle()).toBeDisabled()
  const oldCwdRequests = reads.slice(-2)
  nextRead = async () => ok(preference({ sessionId: 'third', cwd: '/new-cwd', revision: 7 }))
  await act(async () => sources.set({ cwd: '/new-cwd' }))
  expect(oldCwdRequests.every(({ signal }) => signal.aborted)).toBe(true)
  await act(async () =>
    changedCwdRead.resolve(
      ok(preference({ sessionId: 'third', cwd: '/old-cwd', enabled: true, revision: 100 })),
    ),
  )
  await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
  await expect.element(toggle()).toBeEnabled()

  nextRead = () => finalRead.promise
  await fixture.render('fourth')
  const unmountedRequests = reads.slice(-2)
  await act(async () => root.unmount())
  root = undefined
  expect(unmountedRequests.every(({ signal }) => signal.aborted)).toBe(true)
  await act(async () =>
    finalRead.resolve(ok(preference({ sessionId: 'fourth', cwd: '/new-cwd', enabled: true }))),
  )
  expect(container.textContent).toBe('')
})
