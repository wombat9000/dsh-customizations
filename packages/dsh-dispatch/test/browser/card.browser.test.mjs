import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { ProposalCard } from '../../client/card.tsx'

// Real React and DOM; the Host transport is a recorded fixture. Host authority,
// digest binding, and approve-once are owned by test/service.test.js.
let root, container
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
})

const prompt = '<img src=x onerror="window.pwned=1">\n' + 'Do the work.\n'.repeat(50)
const status = (state, extra = {}) => ({
  proposalId: 'p1',
  state,
  kind: 'create',
  intent: 'Fix the login retry',
  prompt,
  preset: 'dispatch-worker',
  model: 'fixture/m1',
  branch: 'dispatch/abc',
  base: {
    provider: 'LocalFileSystem',
    repositoryRoot: '/repo',
    remote: 'origin',
    branch: 'main',
    ref: 'refs/remotes/origin/main',
    commit: 'a'.repeat(40),
    fetchedAt: '2026-11-13T10:00:00.000Z',
  },
  target: null,
  workerSessionId: null,
  assignmentId: 'as1',
  checkpoints: [],
  digest: 'd'.repeat(64),
  coordinatorId: 'coord',
  createdAt: '2026-11-13T10:00:00.000Z',
  observedAt: '2026-11-13T10:00:01.000Z',
  ...extra,
})

async function render(request) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(React.createElement(ProposalCard, { sessionId: 'coord', callId: 'call', request })),
  )
  await act(async () => new Promise((done) => setTimeout(done, 0)))
}

test('shows exact proposal details, keeps untrusted prompt inert, and sends identities only', async () => {
  const calls = []
  let current = status('pending')
  await render(async (endpoint, input) => {
    calls.push([endpoint, input])
    if (endpoint === 'decide')
      current = status('rejected', { decidedAt: '2026-11-13T10:00:02.000Z' })
    return current
  })
  await expect.element(page.getByRole('heading', { name: 'Create Dispatch worker' })).toBeVisible()
  await expect.element(page.getByText('fixture/m1')).toBeVisible()
  await expect.element(page.getByText(/refs\/remotes\/origin\/main @ aaaaaaaaaaaa/)).toBeVisible()
  await act(async () => page.getByText(/Complete prompt/).click())
  expect(container.querySelector('pre').textContent).toBe(prompt)
  expect(container.querySelector('img')).toBeNull()
  expect(window.pwned).toBeUndefined()
  await act(async () => page.getByRole('button', { name: 'Reject' }).click())
  const decide = calls.find(([endpoint]) => endpoint === 'decide')[1]
  expect(decide).toEqual({
    sessionId: 'coord',
    callId: 'call',
    proposalId: 'p1',
    digest: 'd'.repeat(64),
    decision: 'reject',
  })
  await expect.element(page.getByText(/Rejected\. Nothing was created/)).toBeVisible()
  expect(page.getByRole('button', { name: 'Approve' }).query()).toBeNull()
})

test('an adoption card names the reviewed repository, checkout, and commit', async () => {
  await render(async () =>
    status('pending', {
      kind: 'adopt',
      model: 'unchanged',
      base: null,
      branch: 'feature',
      workerSessionId: 'w1',
      target: {
        provider: 'LocalFileSystem',
        worktreeKey: '/repo-b/wt',
        worktreePath: '/repo-b/wt',
        repositoryRoot: '/repo-b',
        branch: 'feature',
        head: 'b'.repeat(40),
      },
    }),
  )
  await expect
    .element(page.getByRole('heading', { name: 'Adopt session as Dispatch worker' }))
    .toBeVisible()
  await expect.element(page.getByText('/repo-b', { exact: true })).toBeVisible()
  await expect.element(page.getByText('/repo-b/wt', { exact: true })).toBeVisible()
  await expect.element(page.getByText('bbbbbbbbbbbb', { exact: true })).toBeVisible()
})

test('historical and failed proposals offer no decision controls', async () => {
  await render(async () =>
    status('uncertain', {
      checkpoints: ['approved', 'session-created'],
      workerSessionId: 'w1',
      message: 'Worktree creation failed. Last confirmed step: session-created.',
    }),
  )
  await expect.element(page.getByText(/Outcome uncertain/)).toBeVisible()
  await expect.element(page.getByText(/Last confirmed step: session-created/)).toBeVisible()
  expect(page.getByRole('button', { name: 'Approve' }).query()).toBeNull()
})

test('an invalid Host payload never renders approval controls', async () => {
  await render(async () => ({ ...status('pending'), digest: 'not-a-digest' }))
  await expect.element(page.getByText(/approval is unavailable/)).toBeVisible()
  expect(page.getByRole('button', { name: 'Approve' }).query()).toBeNull()
})
