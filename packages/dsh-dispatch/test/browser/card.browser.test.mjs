import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { ProposalCard } from '../../client/card.tsx'
import { WorkersCard } from '../../client/workers.tsx'
import client from '../../client/index.ts'
import { CARD_TOOLS } from '../../shared/contracts.ts'

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

async function mount(element) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(element))
}

async function render(request) {
  await mount(React.createElement(ProposalCard, { sessionId: 'coord', callId: 'call', request }))
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

test('a provisioned worker opens through native Session navigation', async () => {
  const opened = []
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      React.createElement(ProposalCard, {
        sessionId: 'coord',
        callId: 'call',
        request: async () => status('succeeded', { workerSessionId: 'worker-1' }),
        openSession: (id) => opened.push(id),
      }),
    ),
  )
  await act(async () => page.getByRole('button', { name: 'Open worker session' }).click())
  expect(opened).toEqual(['worker-1'])
})

test('the worker-status card shows Host status read-only and opens each worker', async () => {
  const calls = []
  const opened = []
  const workers = [
    {
      workerId: 'worker-1',
      title: 'Login retry',
      branch: 'dispatch/abc',
      worktreePath: '/repo/.agents/worktrees/dispatch/abc',
      repositoryRoot: '/repo',
      baseCommit: 'a'.repeat(40),
      assignmentId: 'as1',
      workState: 'ready-for-review',
      assignmentOpen: true,
      summary: 'Draft PR ready',
      stateSource: 'worker',
      evidence: ['PR #1'],
      updatedAt: '2026-11-13T10:00:00.000Z',
      runtime: 'idle',
      eligible: true,
      eligibility: 'On its assigned linked worktree.',
      lastReport: {
        kind: 'ready-for-review',
        summary: 'Draft PR ready',
        createdAt: '2026-11-13T10:00:00.000Z',
      },
    },
  ]
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      React.createElement(WorkersCard, {
        sessionId: 'coord',
        request: async (endpoint, input) => {
          calls.push([endpoint, input])
          return workers
        },
        openSession: (id) => opened.push(id),
      }),
    ),
  )
  await expect.element(page.getByRole('heading', { name: 'Dispatch workers' })).toBeVisible()
  await expect.element(page.getByText('Ready for review (worker)')).toBeVisible()
  await expect.element(page.getByText('as1 · open')).toBeVisible()
  await expect.element(page.getByText('ready-for-review: Draft PR ready')).toBeVisible()
  await act(async () => page.getByRole('button', { name: 'Open worker session' }).click())
  expect(opened).toEqual(['worker-1'])
  await act(async () => page.getByRole('button', { name: 'Refresh' }).click())
  await expect.poll(() => calls.length).toBe(2)
  expect(
    calls.every(([endpoint, input]) => endpoint === 'workers' && input.sessionId === 'coord'),
  ).toBe(true)
  expect(page.getByRole('button', { name: 'Approve' }).query()).toBeNull()
})

function observable(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish(value) {
      snapshot = value
      for (const listener of listeners) listener()
    },
    get subscribers() {
      return listeners.size
    },
  }
}

// Native hook-shaped transport fixture, not a substitute for real-shell slot
// election. The production registration supplies the footer container.
function registeredTail(request, toolData) {
  const registrations = new Map()
  client.apply({
    slots: {
      inject: (_name, callback) => callback(),
      register: (seat, component) => registrations.set(seat.key ?? seat.id, component),
    },
    connection: {
      rpc: {
        call: async (_channel, endpoint, input, signal) => ({
          ok: true,
          value: await request(endpoint, input, signal),
        }),
      },
    },
  })
  expect(CARD_TOOLS.filter((key) => registrations.has(key))).toEqual([])
  const source = observable(toolData)
  const snapshot = {
    nodes: {
      turnDataSource: (turn, kind) => {
        expect([turn, kind]).toEqual([7, 'tool-call'])
        return source
      },
    },
  }
  return {
    Tail: registrations.get('local-dispatch-approvals'),
    source,
    useChat: (selector) => selector(snapshot),
  }
}
const settled = (callId = 'call', extra = {}) => ({
  kind: 'tool-result',
  callId,
  name: 'dispatch_create_session',
  isError: false,
  subCalls: [],
  ...extra,
})
test('the registered footer follows settled nested proposals and cleans up its live source', async () => {
  const calls = []
  let current = status('pending')
  const native = registeredTail(async (endpoint, input, signal) => {
    calls.push({ endpoint, input, signal })
    if (endpoint === 'decide') current = status('executing')
    return current
  }, [])
  const { Tail, useChat } = native
  await mount(React.createElement(Tail, { sessionId: 'coord', turn: { turn: 7 }, useChat }))
  expect(calls).toEqual([])

  const filtered = [
    settled('unrelated', { name: 'read' }),
    settled('error', { isError: true }),
    { name: 'dispatch_create_session', phase: 'preparing', callId: 'preparing' },
    { name: 'dispatch_create_session', phase: 'start', callId: 'running' },
  ]
  await act(async () => native.source.publish(filtered.map((root) => ({ root }))))
  expect(calls).toEqual([])
  expect(page.getByRole('button', { name: 'Approve' }).query()).toBeNull()

  // Hidden nested proposals can arrive later. Repeated objects and distinct
  // results with the same call ID must still produce only one decision card.
  const proposal = settled()
  const parent = {
    callId: 'outer',
    name: 'parallel',
    phase: 'start',
    subCalls: [{ subCalls: [...filtered, proposal, proposal, settled()] }],
  }
  await act(async () => native.source.publish([{ root: parent }, { root: proposal }]))
  await expect.element(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
  expect(container.querySelectorAll('button.dsp-primary')).toHaveLength(1)
  const reads = calls.filter(({ endpoint }) => endpoint === 'status')
  expect(reads.length).toBeGreaterThan(0)
  expect(reads.every(({ input }) => input.sessionId === 'coord' && input.callId === 'call')).toBe(
    true,
  )
  await act(async () => page.getByRole('button', { name: 'Approve', exact: true }).click())
  await expect.element(page.getByText(/carrying out this exact proposal/)).toBeVisible()
  expect(page.getByRole('button', { name: 'Approve' }).query()).toBeNull()
  expect(calls.find(({ endpoint }) => endpoint === 'decide').input).toMatchObject({
    sessionId: 'coord',
    callId: 'call',
  })
  await act(async () => root.unmount())
  expect(native.source.subscribers).toBe(0)
  expect(
    calls.filter(({ endpoint }) => endpoint === 'status').every(({ signal }) => signal.aborted),
  ).toBe(true)
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('session navigation aborts a decision and ignores its late response without crossing owners', async () => {
  const decision = deferred()
  const calls = []
  const request = async (endpoint, input, signal) => {
    calls.push({ endpoint, input, signal })
    if (endpoint === 'decide' && input.sessionId === 'coord') return decision.promise
    return status(endpoint === 'decide' ? 'rejected' : 'pending', {
      coordinatorId: input.sessionId,
      proposalId: input.sessionId,
    })
  }
  await render(request)
  await act(async () => page.getByRole('button', { name: 'Approve', exact: true }).click())
  const sent = calls.find(({ endpoint }) => endpoint === 'decide')
  await act(async () =>
    root.render(
      React.createElement(ProposalCard, { sessionId: 'other', callId: 'other-call', request }),
    ),
  )
  expect(sent.signal.aborted).toBe(true)
  await act(async () =>
    decision.resolve(status('succeeded', { intent: 'Stale result must not appear' })),
  )
  expect(page.getByText('Stale result must not appear').query()).toBeNull()
  await expect.element(page.getByRole('button', { name: 'Reject', exact: true })).toBeVisible()
  await act(async () => page.getByRole('button', { name: 'Reject', exact: true }).click())
  expect(
    calls
      .filter(({ endpoint }) => endpoint === 'decide')
      .map(({ input }) => [input.sessionId, input.callId, input.proposalId]),
  ).toEqual([
    ['coord', 'call', 'coord'],
    ['other', 'other-call', 'other'],
  ])
})

test('a late status response cannot restore an approval after its card unmounts', async () => {
  const pending = deferred()
  let signal
  await render(async (_endpoint, _input, requestSignal) => {
    signal = requestSignal
    return pending.promise
  })
  await act(async () => root.unmount())
  expect(signal.aborted).toBe(true)
  await act(async () => pending.resolve(status('pending')))
  expect(container.textContent).toBe('')
})

test('decision errors stay visible and do not imply approval or automatic mutation retry', async () => {
  let decisions = 0
  let current = status('pending')
  await render(async (endpoint) => {
    if (endpoint === 'decide') {
      decisions++
      current = status('uncertain', { message: 'Inspect retained session w1 before trying again.' })
      throw new Error('Connection closed after decision; outcome not confirmed.')
    }
    return current
  })
  await act(async () => page.getByRole('button', { name: 'Approve', exact: true }).click())
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Connection closed after decision; outcome not confirmed.')
  await expect.element(page.getByText(/Outcome uncertain/)).toBeVisible()
  await expect.element(page.getByText(/Inspect retained session w1/)).toBeVisible()
  expect(page.getByRole('button', { name: 'Approve' }).query()).toBeNull()
  expect(decisions).toBe(1)
})
