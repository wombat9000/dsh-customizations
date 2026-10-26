import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { Replies } from '../../client/replies.tsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
afterEach(async () => {
  if (root) await act(() => root.unmount())
  container?.remove()
  root = container = undefined
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

test('only the latest completed turn supplies safe suggestions; drafts and busy states hide them', async () => {
  let rows = [{ root: result(9, ['Latest <b>literal</b>']) }, { root: result(2, ['Old']) }]
  const emptyRows = []
  const sources = new Map()
  const source = (id) => {
    if (!sources.has(id))
      sources.set(id, {
        subscribe: () => () => {},
        getSnapshot: () => (id === 1 ? rows : emptyRows),
      })
    return sources.get(id)
  }
  const session = { blank: false, openState: 'open', running: false }
  const input = { draft: '', phase: 'plain', attachmentIds: [] }
  const turn = { status: 'closed', end: { data: { reason: { kind: 'completed' } } } }
  const chat = {
    timeline: { turnOrder: [1], turns: new Map([[1, turn]]) },
    nodes: { turnDataSource: source },
  }
  const props = {
    useSession: (f) => f(session),
    useInput: (f) => f(input),
    useChat: (f) => f(chat),
    inputActions: {},
  }
  container = document.createElement('main')
  document.body.append(container)
  root = createRoot(container)
  const render = () => act(() => root.render(React.createElement(Replies, props)))
  const buttons = page.getByRole('group', { name: 'Suggested replies' }).getByRole('button')
  await render()
  await expect.element(buttons).toHaveTextContent('Latest <b>literal</b>')
  expect(container.querySelector('b')).toBeNull()
  for (const [owner, key, value] of [
    [session, 'running', true],
    [session, 'blank', true],
    [session, 'openState', 'loading'],
    [input, 'draft', 'My draft'],
    [input, 'phase', 'submitting'],
    [input, 'attachmentIds', ['file']],
    [turn, 'status', 'open'],
  ]) {
    const before = owner[key]
    owner[key] = value
    await render()
    expect(container.querySelector('button')).toBeNull()
    owner[key] = before
  }
  turn.end.data.reason.kind = 'stop'
  await render()
  expect(container.querySelector('button')).toBeNull()
  turn.end.data.reason.kind = 'completed'
  chat.timeline.turnOrder = [1, 2]
  chat.timeline.turns.set(2, turn)
  await render()
  expect(container.querySelector('button')).toBeNull()
  chat.timeline.turnOrder = [1]
  rows = [{ root: { ...result(3, ['Earlier']), subCalls: [result(11, ['Nested latest'])] } }]
  await render()
  await expect.element(buttons).toHaveTextContent('Nested latest')
  for (const latest of [
    result(12, []),
    result(12, ['x'.repeat(121)]),
    result(12, [], { content: [{ type: 'text', text: 'not JSON' }] }),
  ]) {
    rows = [{ root: result(1, ['Earlier']) }, { root: latest }]
    await render()
    expect(container.querySelector('button')).toBeNull()
  }
  rows = [
    { root: result(1, ['Keep last success']) },
    { root: result(12, ['Failed'], { isError: true }) },
  ]
  await render()
  await expect.element(buttons).toHaveTextContent('Keep last success')
})
