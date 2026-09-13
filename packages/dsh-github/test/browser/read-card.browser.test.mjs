import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import source from '../../client.js?raw'
let root, container
const h = React.createElement
const connection = (nodes, more = false) => ({ nodes, totalCount: nodes.length, pageInfo: { hasNextPage: more, endCursor: more ? 'next' : null }, nextCursor: more ? 'next' : null, truncated: more })
const issue = { id: 'I_1', number: 33, title: 'Synthetic issue', state: 'OPEN', url: 'https://github.com/acme/example/issues/33' }
const project = { id: 'P_1', number: 7, title: 'Synthetic template', template: true, closed: false, url: 'https://github.com/orgs/acme/projects/7' }
const detailedIssue = { ...issue, body: 'Synthetic body', parent: issue, labels: connection([{ name: 'bug' }], true), blockedBy: connection([issue], true), blocking: connection([issue], true) }
const detailedProject = { ...project, readme: 'Synthetic README', fields: connection([{ id: 'F_1', name: 'Status', dataType: 'SINGLE_SELECT', options: [{ id: 'O_1', name: 'Ready' }] }, { id: 'F_2', name: 'Sprint', dataType: 'ITERATION', configuration: { iterations: [{ id: 'IT_1', title: 'Sprint 1' }], completedIterations: [] } }], true) }
const projectItem = { id: 'PI_1', project: { id: 'P_1' }, isArchived: false, content: { ...issue, __typename: 'Issue' }, fieldValues: connection([{ field: { name: 'Status' }, name: 'Ready' }, { field: { name: 'Labels' }, labels: connection([{ name: 'bug' }], true) }], true) }
const block = (data, extra = {}) => ({ kind: 'tool-result', content: [{ type: 'text', text: JSON.stringify({ host: 'github.com', untrusted: true, data, truncated: false, truncations: [], ...extra }) }] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); document.documentElement.style.colorScheme = '' })
async function mount(toolName, data, extra = {}) {
  let record
  const previous = window.__ModuleLoader__
  window.__ModuleLoader__ = { load: value => { record = value } }
  try { new Function(source)() } finally { window.__ModuleLoader__ = previous }
  const plugin = record.factory(() => React)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  const originalFetch = window.fetch
  let requests = 0
  window.fetch = () => { requests++; throw new Error('Read cards must not request HTTP') }
  try { await act(async () => root.render(h(plugin.ReadCard, { toolName, block: block(data), ...extra }))) } finally { window.fetch = originalFetch }
  expect(requests).toBe(0)
}
test.each([
  ['github_list_projects', connection([project]), 'Synthetic template'],
  ['github_get_project', detailedProject, 'Synthetic template'],
  ['github_list_project_items', connection([projectItem]), 'Synthetic issue'],
  ['github_list_issues', connection([issue]), 'Synthetic issue'],
  ['github_search_issues', { ...connection([issue]), issueCount: 2 }, 'Synthetic issue'],
  ['github_get_issue', detailedIssue, 'Synthetic issue'],
])('supported tool %s renders readable entries with zero HTTP calls', async (tool, data, expected) => {
  await mount(tool, data)
  expect(container.textContent).toContain(expected)
  expect(container.textContent).toContain('returned')
  expect(container.querySelectorAll('a[href^="https://github.com/"]').length).toBeGreaterThan(0)
  expect(container.querySelectorAll('button')).toHaveLength(0)
})
test('issue state remains separate from board Status and single item continuation is supported', async () => {
  await mount('github_list_project_items', { ...projectItem, content: { ...projectItem.content, state: 'CLOSED' } })
  expect(container.textContent).toContain('Issue state: CLOSED')
  expect(container.textContent).toContain('Board status: Ready')
  expect(container.textContent).toContain('fieldValues.nodes[1].labels')
  expect(container.querySelectorAll('[role="note"]:not(details *)').length).toBeGreaterThan(0)
})
test('empty template page warns that filtering and totals apply to different scopes', async () => {
  await mount('github_list_projects', { ...connection([], true), totalCount: 99, scannedCount: 20, templateOnly: true, totalCountMeaning: 'Unfiltered owner projects' })
  expect(container.textContent).toContain('0 entries returned; 99 total reported (Unfiltered owner projects)')
  expect(container.textContent).toContain('20 projects scanned')
  expect(container.textContent).toContain('empty page does not imply no templates')
  expect(container.textContent).toContain('not complete')
})
test('project README/options and issue relationships use expandable supplied details', async () => {
  await mount('github_get_project', detailedProject)
  await act(async () => page.getByText('Project README', { exact: true }).click())
  expect(container.querySelector('details[open]').textContent).toContain('Synthetic README')
  await act(async () => page.getByText('Project field definitions', { exact: true }).click())
  expect(container.textContent).toContain('Ready — ID: O_1')
  expect(container.textContent).toContain('Active iterations')
})
test('search cap and malformed payload never present exhaustive success', async () => {
  await mount('github_search_issues', { nodes: [null], issueCount: 1001, exhaustive: false, pageInfo: { hasNextPage: false } })
  expect(container.textContent).toContain('1,000')
  expect(container.textContent).toContain('not exhaustive')
  expect(container.textContent).toContain('Malformed result entries')
})
test('all client-side nested truncation warnings remain outside collapsed bodies', async () => {
  const options = Array.from({ length: 75 }, (_, i) => ({ id: `O${i}`, name: `Option ${i}` }))
  await mount('github_get_project', { ...project, fields: connection([{ id: 'F', name: 'Status', options }]) })
  const notes = Array.from(container.querySelectorAll('[role="note"]'))
  expect(notes.some(note => note.textContent.includes('50'))).toBe(true)
  expect(notes.every(note => note.closest('details') === null)).toBe(true)
})
test.each(['light', 'dark'])('hostile text, keyboard expansion and long titles fit narrow %s layout', async scheme => {
  document.documentElement.style.colorScheme = scheme
  await mount('github_get_issue', { ...detailedIssue, title: '<script>unsafe</script>' + 'long'.repeat(200), url: 'https://github.com.evil.example/issue', body: '<img src=x onerror=alert(1)>' })
  container.style.width = '320px'
  expect(container.scrollWidth).toBeLessThanOrEqual(320)
  expect(container.querySelector('script')).toBeNull()
  expect(container.querySelector('a[href*="evil.example"]')).toBeNull()
  const summary = page.getByText('Issue description', { exact: true }).element()
  summary.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  expect(summary.parentElement.open).toBe(true)
  expect(container.querySelector('img')).toBeNull()
})
