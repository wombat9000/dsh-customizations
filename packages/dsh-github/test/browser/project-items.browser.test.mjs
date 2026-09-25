import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { userEvent } from 'vitest/browser'
import { ReadCard } from '../../client/read-components.tsx'
import { projectItems, itemConnection, projectItemsBlock } from '../project-items-fixture.js'
let root, container, originalFetch, requests
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  window.fetch = originalFetch
  document.documentElement.style.colorScheme = ''
})
async function mount(data = itemConnection(projectItems), width = 900) {
  originalFetch = window.fetch
  requests = 0
  window.fetch = () => {
    requests++
    throw Error('No requests allowed')
  }
  container = document.createElement('div')
  container.style.width = `${width}px`
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      React.createElement(ReadCard, {
        toolName: 'github_list_project_items',
        block: projectItemsBlock(data),
      }),
    ),
  )
}
test('six compact rows show single titles, separate states, repositories and linked PRs', async () => {
  await mount()
  const rows = [...container.querySelectorAll('.gh-item')]
  expect(rows).toHaveLength(6)
  expect(rows.reduce((height, row) => height + row.getBoundingClientRect().height, 0)).toBeLessThan(
    800,
  )
  expect(container.innerText).toContain('Issue state: OPEN')
  expect(container.innerText).toContain('Board status: Done')
  expect(container.innerText).toContain('fixture-org/demo')
  expect(container.innerText).toContain('fixture-org/other')
  expect(container.querySelector('a[href$="/pull/20"]').textContent).toContain(
    'Implement compact rows',
  )
  for (const item of projectItems)
    expect(container.innerText.split(item.content.title)).toHaveLength(2)
  for (const forbidden of [
    'PVTI_',
    'P_compact',
    'not archived',
    'Board field',
    'Supplied entries below',
    'Value unavailable',
  ])
    expect(container.innerText).not.toContain(forbidden)
  expect(container.querySelectorAll('details[open]')).toHaveLength(0)
  const summary = rows[0].querySelector('summary')
  summary.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  expect(summary.parentElement.open).toBe(true)
  expect(container.innerText).toContain('Notes: Empty string')
  expect(container.innerText).toContain('Estimate: 0')
  const technical = [...rows[0].querySelectorAll('summary')].find(
    (node) => node.textContent === 'Technical details',
  )
  technical.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  expect(container.innerText).toContain('PVTI_compact_1')
  const raw = [...container.querySelectorAll('summary')].find(
    (node) => node.textContent === 'Raw tool details',
  )
  raw.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  expect(raw.parentElement.open).toBe(true)
  expect(requests).toBe(0)
})
test('missing, empty and unknown item data remain accessible without invented values', async () => {
  await mount(
    itemConnection([
      {
        id: 'unknown',
        content: { __typename: 'FutureItem' },
        fieldValues: itemConnection([
          null,
          { field: { name: 'Repository' }, repository: null },
          { field: { name: 'Future' }, future: [] },
        ]),
      },
      {
        id: 'draft',
        content: { __typename: 'DraftIssue', title: '' },
        fieldValues: itemConnection([]),
      },
    ]),
  )
  expect(container.innerText).toContain('Unknown item type')
  expect(container.innerText).toContain('Board status: Not supplied')
  expect(container.innerText).toContain('Empty title')
  const first = container.querySelector('summary')
  first.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  expect(container.innerText).toContain('Repository: Not set')
  expect(container.innerText).toContain('Malformed field: See technical details')
  expect(container.innerText).toContain('Future: Value not supplied or unsupported')
  expect(requests).toBe(0)
})
test.each(['light', 'dark'])(
  'narrow %s rows stack safely with long hostile titles and visible nested warnings',
  async (theme) => {
    document.documentElement.style.colorScheme = theme
    const item = structuredClone(projectItems[0])
    item.content.title = '<script>unsafe</script>' + 'long'.repeat(100)
    item.content.url = 'https://github.com.evil.example/x'
    item.fieldValues.nodes[3].pullRequests = itemConnection(
      [{ title: '<img src=x>', url: 'javascript:alert(1)' }],
      true,
    )
    await mount({ ...itemConnection([item], true), totalCount: 50 }, 320)
    expect(container.scrollWidth).toBeLessThanOrEqual(320)
    expect(
      container.querySelector('.gh-item-head').children[1].getBoundingClientRect().top,
    ).toBeGreaterThan(container.querySelector('h4').getBoundingClientRect().bottom)
    expect(
      container.querySelectorAll('script,img,a[href*="evil"],a[href^="javascript:"]'),
    ).toHaveLength(0)
    expect(container.innerText).toContain('1 entries returned; 50 total reported')
    expect(
      [...container.querySelectorAll('[role="note"]')].some(
        (node) => node.textContent.includes('pullRequests') && !node.closest('details'),
      ),
    ).toBe(true)
    expect(requests).toBe(0)
  },
)
