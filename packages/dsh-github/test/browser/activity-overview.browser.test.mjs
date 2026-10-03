import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { ActivityOverview } from '../../client/activity-overview.tsx'

let root, container
const h = React.createElement
const turn = { turn: 1, status: 'closed', start: {}, end: {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
})
function result(id, name, outcome, number = 61) {
  return {
    root: {
      kind: 'tool-result',
      callId: id,
      call: {
        name,
        argsRaw: JSON.stringify({ owner: 'fixture', repo: 'demo', pullNumber: number }),
      },
      subCalls: [],
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            host: 'github.com',
            untrusted: true,
            outcome,
            resource: { id: 'PR', number, title: 'Fixture', isDraft: true },
          }),
        },
      ],
    },
  }
}
function source(initial) {
  let current = initial
  const listeners = new Set()
  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update: (next) => {
      current = next
      for (const listener of listeners) listener()
    },
    listeners,
  }
}
function props(sessionId, sources, owner = turn) {
  return {
    sessionId,
    turn: owner,
    seq: 20,
    openFile() {},
    useChat: (selector) =>
      selector({
        nodes: {
          turnDataSource: (number, kind) => {
            expect(kind).toBe('tool-call')
            expect(sources[number]).toBeDefined()
            return sources[number]
          },
        },
      }),
  }
}
async function render(value) {
  if (!root) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => root.render(h(ActivityOverview, value)))
}
test('one compact disclosure preserves all outcomes, keyboard access and no overview requests', async () => {
  const fetch = vi.fn(() => {
    throw new Error('Overview must not request HTTP')
  })
  vi.stubGlobal('fetch', fetch)
  const data = [
    ...Array.from({ length: 5 }, (_, index) =>
      result(`create-${index}`, 'github_create_pull_request', 'confirmed', index + 1),
    ),
    result('confirmed', 'github_update_pull_request', 'confirmed'),
    result('uncertain', 'github_update_pull_request', 'uncertain'),
  ]
  const observed = source(data)
  await render(props('session-a', { 1: observed }))
  const card = container.querySelector('[aria-label="GitHub activity overview"]')
  expect(container.querySelectorAll('section')).toHaveLength(1)
  expect(card.textContent).toContain('6 confirmed writes')
  expect(card.textContent).toContain('1 uncertain outcomes')
  expect(card.textContent).toContain('later read does not confirm')
  expect(card.querySelector('.gh-activity-resource').textContent).toContain('PR #61')
  expect(card.querySelector('.gh-activity-resource li').textContent).toContain('Uncertain')
  const more = Array.from(card.querySelectorAll('summary')).find(
    (node) => node.textContent === 'More resources (3)',
  )
  expect(more.parentElement.open).toBe(false)
  more.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  expect(more.parentElement.open).toBe(true)
  expect(card.querySelectorAll('a')).toHaveLength(6)
  container.style.width = '320px'
  expect(container.scrollWidth).toBeLessThanOrEqual(320)
  expect(fetch).not.toHaveBeenCalled()
})
test('session/turn switching observes the new stable source and disposes old subscriptions', async () => {
  const a = source([result('a', 'github_update_pull_request', 'uncertain')])
  const b = source([])
  await render(props('session-a', { 1: a }))
  expect(a.listeners.size).toBe(1)
  expect(container.textContent).toContain('Uncertain')
  await render(props('session-b', { 2: b }, { ...turn, turn: 2 }))
  expect(a.listeners.size).toBe(0)
  expect(b.listeners.size).toBe(1)
  expect(container.querySelector('section')).toBeNull()
  await act(async () => a.update([result('late-a', 'github_update_pull_request', 'confirmed')]))
  expect(container.querySelector('section')).toBeNull()
  await act(async () => b.update([result('b', 'github_update_pull_request', 'confirmed', 2)]))
  expect(container.textContent).toContain('fixture/demo PR #2')
  expect(container.textContent).not.toContain('PR #61')
  await act(async () => root.unmount())
  root = null
  expect(b.listeners.size).toBe(0)
})
test('open and empty turns show no card; partial completed evidence remains visibly qualified', async () => {
  const observed = source([result('a', 'github_update_pull_request', 'uncertain')])
  await render(props('a', { 1: observed }, { ...turn, status: 'open' }))
  expect(container.querySelector('section')).toBeNull()
  await render(props('a', { 1: observed }, { ...turn, start: undefined }))
  expect(container.textContent).toContain('Partial history window')
  await act(async () => observed.update([]))
  expect(container.querySelector('section')).toBeNull()
})
