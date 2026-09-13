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
  if (tool !== 'github_get_issue') expect(container.textContent).toContain('returned')
  expect(container.querySelectorAll('a[href^="https://github.com/"]').length).toBeGreaterThan(0)
  expect(container.querySelectorAll('button')).toHaveLength(0)
})
test.each(['github_list_issues', 'github_search_issues'])('%s compact rows preserve shared and mixed repository context', async tool => {
  const one = { ...issue, repository: { nameWithOwner: 'acme/one' } }
  await mount(tool, connection([one, { ...one, id: 'I_2', number: 34, state: 'CLOSED' }]))
  expect(container.querySelectorAll('.gh-issue-state')).toHaveLength(2)
  expect(container.querySelector('.gh-issue-state').getAttribute('aria-label')).toBe('Issue state: Open')
  expect(container.querySelectorAll('.gh-issue small')).toHaveLength(0)
  expect(container.querySelector('.gh-note').textContent).toBe('acme/one')
  expect(container.querySelector('.gh-issue').textContent).not.toContain('I_1')
  await act(async () => root.unmount()); container.remove()
  await mount(tool, connection([one, { ...one, id: 'I_2', repository: { nameWithOwner: 'acme/two' } }]))
  expect([...container.querySelectorAll('.gh-issue small')].map(node => node.textContent)).toEqual(['acme/one', 'acme/two'])
})
test.each(['light', 'dark'])('compact issue lists fit narrow %s layout and retain keyboard raw access', async scheme => {
  document.documentElement.style.colorScheme = scheme
  await mount('github_search_issues', connection([{ ...issue, title: 'long'.repeat(200), url: 'javascript:alert(1)' }], true))
  container.style.width = '320px'
  expect(container.scrollWidth).toBeLessThanOrEqual(320)
  expect(container.querySelector('a')).toBeNull()
  const summary = page.getByText('Raw tool details', { exact: true }).element()
  summary.focus(); await act(async () => userEvent.keyboard('{Enter}'))
  expect(summary.parentElement.open).toBe(true)
  expect(summary.parentElement.textContent).toContain('I_1')
  expect(container.textContent).toContain('1,000')
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
const emptyIssue = { ...issue, repository: { nameWithOwner: 'acme/example' }, body: '', parent: null, labels: connection([]), assignees: connection([]), subIssues: connection([]), blockedBy: connection([]), blocking: connection([]) }
test('single issue prioritizes description and hides only confirmed empty collections', async () => {
  await mount('github_get_issue', emptyIssue)
  const card = container.querySelector('.gh-grant')
  expect(card.querySelector('h3')).toBeNull()
  expect(card.querySelectorAll('.gh-issue-collection')).toHaveLength(0)
  expect(card.textContent).not.toContain('1 entry returned')
  expect(card.querySelector('[role="note"]')).toBeNull()
  expect(card.textContent).toContain('No description.')
})
test.each([
  undefined, null, { nodes: [] }, { ...connection([]), totalCount: 1 }, { ...connection([]), nextCursor: 'next' }, connection([], true), { ...connection([]), truncated: true }, { nodes: 'bad' },
])('unknown/incomplete issue collections never disappear (%j)', async labels => {
  await mount('github_get_issue', { ...emptyIssue, labels, body: null, parent: undefined })
  const notes = [...container.querySelectorAll('[role="note"]')].map(node => node.textContent).join(' ')
  expect(notes).toContain('Labels:')
  expect(notes).toContain('Description unavailable')
  expect(notes).toContain('Parent:')
})
test('outer truncation keeps otherwise empty sections visibly uncertain', async () => {
  await mount('github_get_issue', emptyIssue, { block: block(emptyIssue, { truncated: true, truncations: [{ path: 'data.labels', reason: 'bounded' }] }) })
  const notes = [...container.querySelectorAll('[role="note"]')]
  expect(notes.some(node => node.textContent.includes('Labels: no entries returned; completeness unknown'))).toBe(true)
  expect(notes.some(node => node.textContent.includes('bounded or incomplete'))).toBe(true)
  expect(notes.every(node => !node.closest('details'))).toBe(true)
})
test.each(['github_list_issues', 'github_search_issues'])('%s handles empty results and unknown issue states without board status', async tool => {
  await mount(tool, connection([]))
  expect(container.textContent).toContain('0 entries returned')
  expect(container.textContent).toContain('No entries returned on this page.')
  await act(async () => root.unmount()); container.remove()
  await mount(tool, connection([{ ...issue, state: { malformed: true } }]))
  expect(container.querySelector('.gh-issue-state').getAttribute('aria-label')).toBe('Issue state: Unknown')
  expect(container.querySelector('.gh-issue').textContent).not.toContain('board')
})
test('partial labels and body-only bounds do not unhide independently complete empty collections', async () => {
  const value = { ...emptyIssue, labels: connection([{ name: 'partial' }], true) }
  await mount('github_get_issue', value, { block: block(value, { truncated: true, truncations: [{ path: 'data.labels', kind: 'connection' }, { path: 'data.body', kind: 'text' }] }) })
  const notes = [...container.querySelectorAll('[role="note"]')].map(node => node.textContent).join(' ')
  expect(notes).toContain('data.labels')
  for (const name of ['Assignees:', 'Sub-issues:', 'Blocked by:', 'Blocking:']) expect(container.querySelector('.gh-grant').innerText).not.toContain(name)
  expect(container.querySelectorAll('.gh-issue-collection')).toHaveLength(1)
})
test('populated issue collections show compact chips and directed safe links', async () => {
  await mount('github_get_issue', { ...emptyIssue, state: 'CLOSED', labels: connection([{ name: '<img src=x>' }]), assignees: connection([{ login: 'alice', url: 'https://github.com/alice' }]), blockedBy: connection([issue]), blocking: connection([{ ...issue, title: 'Unsafe link', url: 'javascript:alert(1)' }]) })
  expect(container.querySelector('.gh-issue-state').getAttribute('aria-label')).toBe('Issue state: Closed')
  expect(container.querySelectorAll('.gh-issue-chip')).toHaveLength(2)
  expect(container.querySelectorAll('.gh-issue-related a')).toHaveLength(1)
  expect(container.querySelector('img')).toBeNull()
  expect(container.textContent).toContain('Blocked by:')
  expect(container.textContent).toContain('Blocking:')
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
  await mount('github_get_issue', { ...detailedIssue, title: '<script>unsafe</script>' + 'long'.repeat(200), url: 'https://github.com.evil.example/issue', body: '<img src=x onerror=alert(1)>' + 'long description '.repeat(60) })
  container.style.width = '320px'
  expect(container.scrollWidth).toBeLessThanOrEqual(320)
  expect(container.querySelector('script')).toBeNull()
  expect(container.querySelector('a[href*="evil.example"]')).toBeNull()
  const summary = page.getByText('Full description — preview shortened', { exact: true }).element()
  summary.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  expect(summary.parentElement.open).toBe(true)
  expect(container.querySelector('img')).toBeNull()
})
