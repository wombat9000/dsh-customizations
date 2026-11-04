import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Replies } from '../../client/replies.tsx'
import { createDelivery } from '../../client/delivery.ts'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
afterEach(async () => {
  if (root) await act(() => root.unmount())
  container?.remove()
  root = container = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const result = (seq, replies, extra = {}) => ({
  kind: 'tool-result',
  name: 'suggest_replies',
  seq,
  callId: `call-${seq}`,
  isError: false,
  content: [{ type: 'text', text: JSON.stringify({ replies }) }],
  subCalls: [],
  ...extra,
})

async function mount(replies = ['First reply', 'Second reply', 'Third reply']) {
  const fixture = { rows: new Map([[1, [{ root: result(9, replies) }]]]) }
  const emptyRows = []
  const admit = vi.fn(async () => {})
  const delivery = createDelivery(admit)
  const sources = new Map()
  const source = (id) => {
    if (!sources.has(id))
      sources.set(id, {
        subscribe: () => () => {},
        getSnapshot: () => fixture.rows.get(id) ?? emptyRows,
      })
    return sources.get(id)
  }
  const session = {
    blank: false,
    removed: false,
    openState: 'open',
    running: false,
    pendingSubmissions: [],
  }
  const input = { draft: '', draftRev: 0, phase: 'plain', occurrences: [], attachmentIds: [] }
  const turn = { status: 'closed', end: { data: { reason: { kind: 'completed' } } } }
  const chat = {
    timeline: { turnOrder: [1], turns: new Map([[1, turn]]) },
    nodes: { turnDataSource: source },
  }
  let render
  const props = {
    useSession: (f) => f(session),
    useInput: (f) => f(input),
    useChat: (f) => f(chat),
    useAccess: () => true,
    useBlock: (f) => f(undefined),
    useDelivery: (select) =>
      select(React.useSyncExternalStore(delivery.subscribe, delivery.getSnapshot)),
    send: delivery.send,
    inputActions: {
      // The native revision/undo contract is exercised by the real-shell journey.
      insertText: vi.fn((text, span) => {
        if (span.draftRev !== input.draftRev) return false
        input.draft = input.draft.slice(0, span.start) + text + input.draft.slice(span.end)
        input.draftRev++
        render()
        return true
      }),
      persistDraft: vi.fn(),
    },
  }
  container = document.createElement('main')
  document.body.append(container)
  root = createRoot(container)
  render = () => root.render(React.createElement(Replies, props))
  const rerender = () => act(render)
  await rerender()
  return {
    admit,
    setRows: (rows, turn = 1) => {
      fixture.rows.set(turn, rows)
    },
    remount: async () => {
      await act(() => root.unmount())
      root = createRoot(container)
      await rerender()
    },
    session,
    input,
    turn,
    chat,
    props,
    rerender,
    edit: async (draft) => {
      input.draft = draft
      input.draftRev++
      await rerender()
    },
  }
}
const toggle = (reply) => page.getByRole('button', { name: reply, exact: true })
const group = () => page.getByRole('group', { name: 'Suggested replies', exact: true })
const pointer = async (button, type, extra = {}) =>
  act(() =>
    button.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        ...extra,
      }),
    ),
  )

test('latest completed turn supplies escaped suggestions; busy and structured inputs hide them', async () => {
  const f = await mount(['Latest <b>literal</b>'])
  await expect.element(toggle('Latest <b>literal</b>')).toBeVisible()
  expect(container.querySelector('b')).toBeNull()
  await f.edit('My draft')
  await expect.element(group()).toBeVisible()
  for (const [owner, key, value] of [
    [f.session, 'running', true],
    [f.session, 'removed', true],
    [f.session, 'blank', true],
    [f.session, 'openState', 'loading'],
    [f.session, 'pendingSubmissions', [{}]],
    [f.input, 'phase', 'submitting'],
    [f.input, 'occurrences', [{}]],
    [f.input, 'claim', {}],
    [f.turn, 'status', 'open'],
  ]) {
    const before = owner[key]
    owner[key] = value
    await f.rerender()
    expect(container.querySelector('button')).toBeNull()
    owner[key] = before
  }
  f.props.useAccess = () => false
  await f.rerender()
  expect(container.querySelector('button')).toBeNull()
  f.props.useAccess = () => true
  f.props.useBlock = (select) => select({ reason: 'Approval pending' })
  await f.rerender()
  expect(container.querySelector('button')).toBeNull()
  f.props.useBlock = (select) => select(undefined)
  f.turn.end.data.reason.kind = 'stop'
  await f.rerender()
  expect(container.querySelector('button')).toBeNull()
  f.turn.end.data.reason.kind = 'completed'
  f.chat.timeline.turnOrder = [1, 2]
  f.chat.timeline.turns.set(2, f.turn)
  await f.rerender()
  expect(container.querySelector('button')).toBeNull()
  f.chat.timeline.turnOrder = [1]
  f.setRows([{ root: { ...result(3, ['Earlier']), subCalls: [result(11, ['Nested latest'])] } }])
  await f.rerender()
  await expect.element(toggle('Nested latest')).toBeVisible()
  for (const latest of [
    result(12, []),
    result(12, ['x'.repeat(121)]),
    result(12, [], { content: [{ type: 'text', text: 'not JSON' }] }),
  ]) {
    f.setRows([{ root: result(1, ['Earlier']) }, { root: latest }])
    await f.rerender()
    expect(container.querySelector('button')).toBeNull()
  }
  f.setRows([
    { root: result(1, ['Keep last success']) },
    { root: result(12, ['Failed'], { isError: true }) },
  ])
  await f.rerender()
  await expect.element(toggle('Keep last success')).toBeVisible()
})

test('multiple toggles compose and remove owned text without erasing edits or attachments', async () => {
  const f = await mount()
  await act(() => toggle('First reply').click())
  await act(() => toggle('Second reply').click())
  expect(f.input.draft).toBe('First reply\nSecond reply')
  await expect.element(toggle('First reply')).toHaveAttribute('aria-pressed', 'true')
  await expect.element(toggle('Second reply')).toHaveAttribute('aria-pressed', 'true')
  await act(() => toggle('First reply').click())
  expect(f.input.draft).toBe('Second reply')
  await expect.element(toggle('Second reply')).toHaveAttribute('aria-pressed', 'true')
  await act(() => toggle('Second reply').click())
  expect(f.input.draft).toBe('')
  await f.edit('My context')
  f.input.attachmentIds = ['keep-file']
  await act(() => toggle('Second reply').click())
  await f.edit('Edited context\nSecond reply')
  await f.edit('Edited context\nSecond reply\nUser ending')
  await act(() => toggle('Second reply').click())
  expect(f.input.draft).toBe('Edited context\nUser ending')
  expect(f.input.attachmentIds).toEqual(['keep-file'])
  await act(() => toggle('Third reply').click())
  await f.edit(f.input.draft.replace('Third reply', 'My rewritten reply'))
  await expect.element(toggle('Third reply')).toHaveAttribute('aria-pressed', 'false')
  await act(() => toggle('First reply').click())
  await act(() => toggle('First reply').click())
  expect(f.input.draft).toBe('Edited context\nUser ending\nMy rewritten reply')
  expect(f.admit).not.toHaveBeenCalled()
})

test('rejected stale edit does not select a reply or persist a replacement draft', async () => {
  const f = await mount()
  f.props.inputActions.insertText.mockReturnValue(false)
  await act(() => toggle('First reply').click())
  expect(f.input.draft).toBe('')
  expect(f.props.inputActions.persistDraft).not.toHaveBeenCalled()
  await expect.element(toggle('First reply')).toHaveAttribute('aria-pressed', 'false')
})

test('keyboard toggles compose; Send now sends only its reply and retains the draft', async () => {
  const f = await mount()
  await f.edit('Keep my draft')
  toggle('First reply').element().focus()
  await act(() => userEvent.keyboard('{Enter}'))
  toggle('Second reply').element().focus()
  await act(() => userEvent.keyboard(' '))
  expect(f.input.draft).toBe('Keep my draft\nFirst reply\nSecond reply')
  const send = page.getByRole('button', { name: 'Send now: Third reply', exact: true })
  send.element().focus()
  await act(() => userEvent.keyboard('{Enter}'))
  expect(f.admit).toHaveBeenCalledExactlyOnceWith('Third reply')
  expect(f.input.draft).toBe('Keep my draft\nFirst reply\nSecond reply')
})

test('hold sends once at the threshold, preserves draft and suppresses trailing click', async () => {
  const f = await mount()
  await f.edit('Keep my draft')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  // Synthetic component pointer events have no active browser pointer to capture;
  // the shell journey exercises actual pointer capture and transport admission.
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {})
  const button = toggle('Second reply').element()
  await pointer(button, 'pointerdown')
  expect(button.dataset.holding).toBe('true')
  await act(() => vi.advanceTimersByTimeAsync(699))
  expect(f.admit).not.toHaveBeenCalled()
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(f.admit).toHaveBeenCalledExactlyOnceWith('Second reply')
  await pointer(button, 'pointerup')
  await act(() => button.click())
  expect(f.input.draft).toBe('Keep my draft')
  expect(f.admit).toHaveBeenCalledTimes(1)
})

test('short click toggles, while pointer cancellation, movement, Escape and lifecycle changes cancel holds', async () => {
  const f = await mount()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {})
  let button = toggle('First reply').element()
  await pointer(button, 'pointerdown')
  await act(() => vi.advanceTimersByTimeAsync(300))
  await pointer(button, 'pointerup')
  await act(() => button.click())
  expect(f.input.draft).toBe('First reply')
  for (const kind of [
    'pointerout',
    'pointercancel',
    'lostpointercapture',
    'pointermove',
    'escape',
    'blur',
    'scroll',
    'focus moved',
    'busy',
    'new replies',
    'unmount',
  ]) {
    button = toggle('First reply').element()
    await pointer(button, 'pointerdown')
    if (kind === 'escape')
      await act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    else if (kind === 'blur' || kind === 'scroll')
      await act(() => window.dispatchEvent(new Event(kind)))
    else if (kind === 'focus moved')
      await act(() => button.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    else if (kind === 'busy') {
      f.session.running = true
      await f.rerender()
    } else if (kind === 'new replies') {
      f.setRows([{ root: result(12, ['First reply', 'Replacement']) }])
      await f.rerender()
    } else if (kind === 'unmount') {
      await act(() => root.unmount())
      root = undefined
    } else await pointer(button, kind, kind === 'pointermove' ? { clientX: 100 } : {})
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(f.admit, kind).not.toHaveBeenCalled()
    if (kind === 'busy') {
      f.session.running = false
      await f.rerender()
    }
  }
  expect(f.input.draft).toBe('First reply')
})

test('admission stays locked across remounts and successful RPC until the originating turn advances', async () => {
  const f = await mount()
  let accept
  f.admit.mockImplementation(
    () =>
      new Promise((resolve) => {
        accept = resolve
      }),
  )
  const send = () =>
    page.getByRole('button', { name: 'Send now: First reply', exact: true }).element()
  await act(async () => send().click())
  expect(f.admit).toHaveBeenCalledTimes(1)
  await f.remount()
  expect(send().disabled).toBe(true)
  await act(async () => accept())
  expect(send().disabled).toBe(true)
  // The integration owner also rejects duplicate admission from a stale view.
  await act(async () => {
    send().click()
    await f.props.send('Second reply', 1)
  })
  expect(f.admit).toHaveBeenCalledTimes(1)
  await expect
    .element(page.getByRole('status'))
    .toHaveTextContent('Reply sent. Waiting for the conversation to update.')
  f.setRows([{ root: result(20, ['First reply']) }], 2)
  f.chat.timeline.turnOrder = [1, 2]
  f.chat.timeline.turns.set(2, f.turn)
  await f.rerender()
  expect(send().disabled).toBe(false)
  f.admit.mockResolvedValueOnce(undefined)
  await act(async () => send().click())
  expect(f.admit).toHaveBeenCalledTimes(2)
})

test('ambiguous repeated text never transfers ownership to a user-authored copy', async () => {
  const f = await mount(['Test'])
  await act(() => toggle('Test').click())
  await f.edit('Test\nTest')
  expect(toggle('Test').element().getAttribute('aria-pressed')).toBe('false')
  await f.edit('Test\nRun')
  await act(() => toggle('Test').click())
  await act(() => toggle('Test').click())
  expect(f.input.draft).toBe('Test\nRun')
})

test('pending sends reject duplicate activation; uncertain failures show an alert without retrying', async () => {
  const f = await mount()
  let reject
  f.admit.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  const send = page.getByRole('button', { name: 'Send now: First reply', exact: true }).element()
  await act(() => {
    send.click()
    send.click()
  })
  expect(f.admit).toHaveBeenCalledTimes(1)
  expect(send.disabled).toBe(true)
  await act(async () => reject(new Error('Disconnected')))
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent(
      'Could not confirm this reply was sent. Check the conversation before trying again.',
    )
  expect(f.admit).toHaveBeenCalledTimes(1)
  expect(f.input.draft).toBe('')
})
