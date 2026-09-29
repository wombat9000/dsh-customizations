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
  async (name, data) => {
    await mount(name, cardEnvelope(data))
    expect(container.querySelector('[role="status"]').textContent).toContain('returned')
    expect(container.textContent).toContain('Small agent change')
    expect(container.querySelector('details').open).toBe(false)
    if (name.endsWith('_threads')) {
      expect(container.textContent).toContain('Unresolved')
      expect(container.textContent).toContain('Outdated')
      expect(container.querySelector('[role="note"]').textContent).toContain('comments')
    }
    if (name.endsWith('_checks')) {
      expect(container.textContent).toContain('Tests')
      expect(container.textContent).toContain('pending')
      expect(container.querySelector('[role="note"]').textContent).toContain('not a merge decision')
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
