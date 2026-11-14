import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { ProposalCard } from '../../client/card.tsx'
import { WorkersCard } from '../../client/workers.tsx'
import client from '../../client/index.ts'

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
// election. In this suite the production registration supplies both containers.
function registeredCards(request, toolData) {
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
  const source = observable(toolData)
  const nodes = observable([])
  const snapshot = () => ({
    nodes: {
      values: nodes.getSnapshot,
      turnDataSource: (turn, kind) => {
        expect([turn, kind]).toEqual([7, 'tool-call'])
        return source
      },
    },
  })
  function useChat(selector) {
    React.useSyncExternalStore(nodes.subscribe, nodes.getSnapshot)
    return selector(snapshot())
  }
  return {
    Trace: registrations.get('dispatch_create_session'),
    Tail: registrations.get('local-dispatch-approvals'),
    source,
    nodes,
    useChat,
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
const toolNode = (root) => ({
  kind: 'tool-call',
  data: { root },
  location: { kind: 'step', turn: { turn: 7 } },
})
const footerNode = { kind: 'turn-tail', data: { turn: 7 } }

test('registered trace keeps live approval until the footer exists, then only the visible tail owns it', async () => {
  const calls = []
  let current = status('pending')
  // The proposal is a hidden nested native call; duplicates, unrelated tools,
  // preparation, and errors must not create extra status requests or controls.
  const proposal = settled()
  const parent = {
    callId: 'outer',
    name: 'parallel',
    phase: 'start',
    subCalls: [
      proposal,
      proposal,
      settled('unrelated', { name: 'read' }),
      settled('error', { isError: true }),
      { name: 'dispatch_create_session', phase: 'start', callId: 'running' },
    ],
  }
  const native = registeredCards(
    async (endpoint, input) => {
      calls.push([endpoint, input])
      if (endpoint === 'decide') current = status('rejected')
      return current
    },
    [{ root: parent }],
  )
  native.nodes.publish([toolNode(parent)])
  const { Trace, Tail, useChat } = native
  const trace = React.createElement(Trace, { sessionId: 'coord', callId: 'call', useChat })
  await mount(trace)
  await expect.element(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
  // A real native footer is now materialized. Mount both contributions, as the
  // shell does when the user also expands the historical tool trace.
  await act(async () => {
    native.nodes.publish([toolNode(parent), footerNode])
    root.render(
      React.createElement(
        React.Fragment,
        null,
        trace,
        React.createElement(Tail, { sessionId: 'coord', turn: { turn: 7 }, useChat }),
      ),
    )
  })
  await expect
    .element(page.getByText('Review the Dispatch proposal below this conversation turn.'))
    .toBeVisible()
  expect(container.querySelectorAll('button.dsp-primary')).toHaveLength(1)
  expect(calls.filter(([endpoint]) => endpoint === 'status')).toHaveLength(2)
  expect(calls.every(([, input]) => input.callId === 'call')).toBe(true)
  await act(async () => page.getByRole('button', { name: 'Reject', exact: true }).click())
  await expect.element(page.getByText(/Rejected\. Nothing was created/)).toBeVisible()
  expect(calls.filter(([endpoint]) => endpoint === 'decide')).toEqual([
    [
      'decide',
      {
        sessionId: 'coord',
        callId: 'call',
        proposalId: 'p1',
        digest: 'd'.repeat(64),
        decision: 'reject',
      },
    ],
  ])
  await act(async () => root.unmount())
  expect(native.source.subscribers).toBe(0)
})

test('a preparing trace waits for its settled proposal before reading status in the same active turn', async () => {
  const calls = []
  let prepared = false
  const native = registeredCards(async (endpoint, input) => {
    calls.push([endpoint, input])
    if (!prepared) throw new Error('This Dispatch proposal no longer exists.')
    return status('pending')
  }, [])
  const { Trace, useChat } = native
  const running = {
    callId: 'call',
    name: 'dispatch_create_session',
    phase: 'preparing',
    subCalls: [],
  }
  native.nodes.publish([toolNode(running)])
  await mount(React.createElement(Trace, { sessionId: 'coord', callId: 'call', useChat }))
  // A premature status read used to mark this same card permanently missing.
  expect(calls).toEqual([])
  await act(async () => native.nodes.publish([toolNode({ ...running, phase: 'start' })]))
  expect(calls).toEqual([])
  prepared = true
  await act(async () => native.nodes.publish([toolNode(settled())]))
  await expect.element(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
  expect(calls).toEqual([['status', { sessionId: 'coord', callId: 'call' }]])
})

test('the turn-tail source adds newly loaded proposals and removes their subscriptions on unmount', async () => {
  const calls = []
  const native = registeredCards(async (endpoint, input) => {
    calls.push([endpoint, input])
    return status('executing')
  }, [])
  const { Tail, useChat } = native
  await mount(React.createElement(Tail, { sessionId: 'coord', turn: { turn: 7 }, useChat }))
  expect(calls).toEqual([])
  await act(async () => native.source.publish([{ root: settled() }]))
  await expect.element(page.getByText(/carrying out this exact proposal/)).toBeVisible()
  expect(page.getByRole('button', { name: 'Approve' }).query()).toBeNull()
  expect(calls).toEqual([['status', { sessionId: 'coord', callId: 'call' }]])
  await act(async () => root.unmount())
  expect(native.source.subscribers).toBe(0)
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
  expect(sent.input).toEqual({
    sessionId: 'coord',
    callId: 'call',
    proposalId: 'coord',
    digest: 'd'.repeat(64),
    decision: 'approve',
  })
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
    calls.filter(({ endpoint }) => endpoint === 'decide').map(({ input }) => input.sessionId),
  ).toEqual(['coord', 'other'])
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

test.each(['succeeded', 'rejected', 'expired'])(
  '%s receipts keep exact details available without filling the conversation',
  async (state) => {
    await render(async () => status(state))
    const details = container.querySelector('section > details')
    expect(details.open).toBe(false)
    await act(async () => page.getByText('Review proposal details', { exact: true }).click())
    await expect.element(page.getByText('fixture/m1')).toBeVisible()
    expect(page.getByRole('button', { name: 'Approve' }).query()).toBeNull()
  },
)
