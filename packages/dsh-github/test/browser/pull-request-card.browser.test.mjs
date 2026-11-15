import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { PullRequestCard } from '../../client/pull-request-card.tsx'
import {
  prReadSnapshots,
  prWriteSnapshots,
  cardBlock,
  cardEnvelope,
  cardWriteEnvelope,
  cardPullRequest,
  prListEnvelope,
} from '../pull-request-card-fixtures.js'
let root, container
const h = React.createElement
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
})
async function mount(toolName, envelope) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const originalFetch = window.fetch
  let requests = 0
  window.fetch = () => {
    requests++
    throw new Error('Historical PR cards must not request HTTP')
  }
  try {
    await act(async () => root.render(h(PullRequestCard, { toolName, block: cardBlock(envelope) })))
  } finally {
    window.fetch = originalFetch
  }
  expect(requests).toBe(0)
}
test.each(prReadSnapshots)(
  '%s displays a readable snapshot with no requests',
  async (name, data, envelope) => {
    await mount(name, envelope ?? cardEnvelope(data))
    expect(container.querySelector('[role="status"]').textContent).toContain(
      name === 'github_list_pull_requests' ? 'fetched' : 'returned',
    )
    expect(container.textContent).toContain(
      name === 'github_list_pull_requests' ? 'Keep repository settings' : 'Small agent change',
    )
    expect(container.querySelector('details').open).toBe(false)
    const notes = Array.from(container.querySelectorAll('[role="note"]'))
      .map((note) => note.textContent)
      .join('\n')
    if (name.endsWith('_threads')) {
      expect(container.textContent).toContain('Unresolved')
      expect(container.textContent).toContain('Outdated')
      expect(notes).toContain('comments')
    }
    if (name.endsWith('_checks')) {
      expect(container.textContent).toContain('Tests')
      expect(container.textContent).toContain('pending')
      expect(notes).toContain('not a merge decision')
    }
  },
)
test.each(prWriteSnapshots)(
  '%s shows its confirmed action without implying a merge',
  async (name, resource, change) => {
    await mount(name, cardWriteEnvelope(resource, change))
    expect(container.querySelector('[role="status"]').textContent).toBe('Confirmed')
    if (name === 'github_create_pull_request') expect(container.textContent).toContain('Draft')
    if (name === 'github_update_pull_request')
      expect(container.textContent).toContain('Ready for review')
    if (name === 'github_submit_pull_request_review') {
      expect(container.textContent).toContain('APPROVED')
      expect(container.textContent).not.toContain('Ready for review')
    }
    if (name.includes('stack')) expect(container.querySelector('ol')).not.toBeNull()
  },
)
test('narrow PR cards escape external content, reject unsafe links and retain keyboard raw access', async () => {
  await mount(
    'github_get_pull_request',
    cardEnvelope({
      pullRequest: {
        ...cardPullRequest,
        title: '<img src=x onerror=alert(1)>'.repeat(30),
        url: 'javascript:alert(1)',
      },
    }),
  )
  container.style.width = '320px'
  expect(container.scrollWidth).toBeLessThanOrEqual(320)
  expect(container.querySelector('img,script,iframe,a')).toBeNull()
  const summary = page.getByText('Raw tool details', { exact: true }).element()
  summary.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  expect(summary.parentElement.open).toBe(true)
  expect(summary.parentElement.textContent).toContain('PR_INTERNAL_FIXTURE')
})
test('expanding checks exposes every returned status, including failures after fifty check runs', async () => {
  await mount(
    'github_get_pull_request_checks',
    cardEnvelope({
      pullRequest: cardPullRequest,
      checkRuns: {
        nodes: Array.from({ length: 50 }, (_, index) => ({
          id: index + 1,
          name: `Check ${index}`,
          status: 'completed',
          conclusion: 'success',
        })),
        pageInfo: { page: 1, hasNextPage: false, nextPage: null },
      },
      statuses: {
        nodes: Array.from({ length: 50 }, (_, index) => ({
          id: index + 51,
          context: index === 49 ? 'External failure at end' : `Status ${index}`,
          state: index === 49 ? 'failure' : 'success',
        })),
        pageInfo: { page: 1, hasNextPage: false, nextPage: null },
      },
    }),
  )
  const summary = page.getByText('Remaining entries (95)', { exact: true }).element()
  summary.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  expect(summary.parentElement.open).toBe(true)
  expect(container.querySelectorAll('.gh-pr-row')).toHaveLength(100)
  await expect.element(page.getByText('External failure at end', { exact: true })).toBeVisible()
})

const listEnvelope = (nodes, pageInfo = { page: 1, hasNextPage: false, nextPage: null }) =>
  cardEnvelope({ pullRequests: { nodes, totalCount: null, pageInfo } })

const keyboardToggle = async (label) => {
  const summary = page.getByText(label, { exact: true }).element()
  summary.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  return summary.parentElement
}

test('PR list puts exact titles and established states first, without readiness or branch noise', async () => {
  const cases = [
    [{ state: 'open', isDraft: false }, 'Open'],
    [{ state: 'OPEN' }, 'Open'],
    [{ state: 'open', isDraft: true }, 'Draft'],
    [{ state: 'closed', isDraft: false }, 'Closed'],
    [{ state: 'closed', isDraft: true }, 'Closed'],
    [{ state: 'closed', mergedAt: '2026-10-20T09:30:00Z' }, 'Merged'],
    [{ state: 'MERGED' }, 'Merged'],
    [{ state: 'closed', mergedAt: '1' }, 'Closed'],
    [{ state: 'future-state', isDraft: false }, 'State unknown'],
    [{}, 'State unknown'],
  ]
  await mount(
    'github_list_pull_requests',
    listEnvelope(
      cases.map(([fields], index) => ({
        title: `Exact title ${index} <img src=x onerror=alert(1)>`,
        number: index + 1,
        ...fields,
        url: index === 0 ? 'https://github.com/fixture-org/demo/pull/1' : 'javascript:alert(1)',
      })),
    ),
  )
  await keyboardToggle('Show 5 more fetched PRs')
  const rows = [...container.querySelectorAll('.gh-pr-list-row')]
  expect(rows.map((row) => row.querySelector('.gh-pr-list-state').textContent)).toEqual(
    cases.map(([, state]) => state),
  )
  expect(rows.map((row) => row.querySelector('h4').textContent)).toEqual(
    cases.map((_, index) => `Exact title ${index} <img src=x onerror=alert(1)>`),
  )
  expect(container.querySelectorAll('a')).toHaveLength(1)
  expect(container.querySelector('a').getAttribute('rel')).toBe('noopener noreferrer')
  expect(container.querySelector('img,script,iframe')).toBeNull()
  expect(container.innerText).not.toContain('Ready for review')
  expect(container.innerText).not.toContain('More available')
})

test('PR list separates remote-page uncertainty, shortened descriptions and local expansion', async () => {
  await mount('github_list_pull_requests', prListEnvelope)
  container.style.width = '320px'
  expect(container.scrollWidth).toBeLessThanOrEqual(320)
  expect(container.querySelector('[role="status"]').textContent).toBe(
    '20 pull requests fetched · More may be available',
  )
  expect(container.innerText).toContain('Some descriptions are shortened in this view.')
  expect(container.innerText).not.toContain('data.pullRequests')
  expect(container.innerText).not.toContain('Commit')
  expect(container.innerText).not.toContain('review/improvement-1')
  expect(
    [...container.querySelectorAll('.gh-pr-list-row')].filter((row) => row.checkVisibility()),
  ).toHaveLength(5)
  const more = await keyboardToggle('Show 15 more fetched PRs')
  expect(more.open).toBe(true)
  expect(
    [...container.querySelectorAll('.gh-pr-list-row')].filter((row) => row.checkVisibility()),
  ).toHaveLength(20)
  expect(container.querySelector('[role="status"]').textContent).toContain(
    '20 pull requests fetched',
  )
  const details = await keyboardToggle('Data details')
  expect(details.open).toBe(true)
  expect(details.innerText).toContain('data.pullRequests')
  expect(details.innerText).toContain('cursor or page')
  expect(details.innerText).toContain('Output text bound; GitHub has no text cursor.')
  await keyboardToggle('Raw tool details')
  expect(details.innerText).toContain('"nextPage":2')
  const branch = container.querySelector('.gh-pr-list-branch summary')
  branch.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  expect(container.innerText).toContain('review/improvement-1')
  expect(container.innerText).toContain('a'.repeat(40))
})

test.each([
  [undefined, 'Completeness unknown'],
  [{ page: 1, hasNextPage: false }, null],
  [{ page: 1, hasNextPage: true, nextPage: 2, completeness: 'known' }, 'More available'],
  [{ hasNextPage: true }, 'Completeness unknown'],
])('PR list retains bounded and unknown page signals: %j', async (pageInfo, signal) => {
  await mount('github_list_pull_requests', cardEnvelope({ pullRequests: { nodes: [], pageInfo } }))
  const status = container.querySelector('[role="status"]').textContent
  expect(status).toContain('0 pull requests fetched')
  if (signal) expect(status).toContain(signal)
  else expect(status).not.toMatch(/More|unknown|Incomplete/)
  expect(container.innerText).not.toContain('Show ')
})

test('PR-list display bounds do not turn the rendered subset into the fetched count', async () => {
  await mount(
    'github_list_pull_requests',
    listEnvelope(Array.from({ length: 101 }, (_, index) => ({ title: `Fetched PR ${index + 1}` }))),
  )
  expect(container.querySelector('[role="status"]').textContent).toContain(
    '101 pull requests fetched',
  )
  expect(container.innerText).toContain('This card has display limits')
  await keyboardToggle('Show 95 more fetched PRs')
  expect(container.querySelectorAll('.gh-pr-list-row')).toHaveLength(100)
  await keyboardToggle('Data details')
  await keyboardToggle('Raw tool details')
  expect(container.innerText).toContain('Fetched PR 101')
})

test('card-preview text clipping is not pagination and preserves its exact source notice', async () => {
  await mount('github_list_pull_requests', {
    ...listEnvelope([{ title: 'No metadata needed for this exact title' }]),
    truncated: true,
    truncations: [
      {
        path: 'data.pullRequests.nodes[0].body',
        kind: 'text',
        reason: 'Card preview text bound; inspect raw tool details or the saved full result',
      },
    ],
  })
  expect(container.querySelector('[role="status"]').textContent).toBe(
    '1 pull request fetched · Incomplete data',
  )
  expect(container.innerText).toContain('Some descriptions are shortened in this view.')
  expect(container.innerText).not.toContain('More available')
  expect(container.querySelector('.gh-pr-list-row').innerText).toContain('State unknown')
  await keyboardToggle('Data details')
  expect(container.innerText).toContain(
    'Card preview text bound; inspect raw tool details or the saved full result',
  )
})

test('unlocalized bounds and malformed list results retain visible limits and original raw fallback', async () => {
  await mount('github_list_pull_requests', { ...listEnvelope([]), truncated: true })
  expect(container.innerText).toContain('Some output is bounded or incomplete.')
  let inspected = 0
  await act(async () =>
    root.render(
      h(PullRequestCard, {
        toolName: 'github_list_pull_requests',
        block: cardBlock({ bad: '<unsafe> ORIGINAL_RAW_RESULT' }),
        inspect: () => {
          inspected++
        },
      }),
    ),
  )
  expect(container.innerText).toContain('Result unavailable')
  expect(container.querySelector('.gh-pr-list-row')).toBeNull()
  await keyboardToggle('Data details')
  await keyboardToggle('Raw tool details')
  expect(container.innerText).toContain('<unsafe> ORIGINAL_RAW_RESULT')
  await act(async () => page.getByRole('button', { name: 'Inspect tool call' }).click())
  expect(inspected).toBe(1)
})

test('uncertain write remains a visible warning and hides unconfirmed resources', async () => {
  await mount('github_create_pull_request', {
    host: 'github.com',
    untrusted: true,
    outcome: 'uncertain',
    observedConfirmedResource: cardPullRequest,
  })
  expect(container.querySelector('[role="status"]').textContent).toBe('Outcome uncertain')
  expect(container.querySelector('[role="note"]').textContent).toContain(
    'do not retry automatically',
  )
  expect(container.querySelector('article')).toBeNull()
})
