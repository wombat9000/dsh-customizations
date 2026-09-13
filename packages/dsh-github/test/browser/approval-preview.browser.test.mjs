import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import source from '../../client.js?raw'
import { approvalNames, approvalValue, approvalReason, approvalTool, issueBody } from '../approval-preview-fixtures.js'
const h = React.createElement
let root, container, plugin
let record
const previous = window.__ModuleLoader__
window.__ModuleLoader__ = { load: value => { record = value } }
try { new Function(source)() } finally { window.__ModuleLoader__ = previous }
plugin = record.factory(() => React)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => { await act(async () => root?.unmount()); container?.remove() })
async function mount(operation, reason = approvalReason(approvalValue(operation))) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  const model = plugin.approvalModel(approvalTool(operation), reason)
  // RC2 native structure, controls represented only for isolation assertions.
  await act(async () => root.render(h('div', null, h('div', { 'data-approval-scroll': '' }, h('div', { 'data-native-reason': '' }, reason), h('div', null, h(plugin.ApprovalPreview, { model }))), h('button', null, 'Native reject'), h('button', null, 'Native allow'))))
  return reason
}
test.each(approvalNames)('%s provides native-detail readable preview, exact payload and no duplicate buttons', async operation => {
  const reason = await mount(operation)
  expect(container.querySelector('.gh-approval-valid')).not.toBeNull()
  expect(getComputedStyle(container.querySelector('[data-native-reason]')).display).toBe('none')
  expect(container.querySelectorAll('button')).toHaveLength(2)
  const summary = page.getByText('Technical details — complete exact approval payload', { exact: true })
  await act(async () => summary.click())
  expect(container.querySelector('.gh-approval-valid > details pre').textContent).toBe(reason)
})
test('long safe Markdown remains fully reviewable with source, keyboard expansion and narrow layout', async () => {
  await mount('createIssue')
  const region = container.querySelector('.gh-approval-valid'); region.style.width = '320px'
  expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth + 1)
  expect(region.querySelectorAll('script,img,iframe')).toHaveLength(0)
  expect(Array.from(region.querySelectorAll('a')).every(a => a.href.startsWith('https://github.com/'))).toBe(true)
  expect(region.querySelector('.gh-approval-markdown').textContent).toContain('END OF COMPLETE BODY')
  const summary = Array.from(region.querySelectorAll('summary')).find(x => x.textContent === 'Proposed issue body: exact source and whitespace')
  summary.focus(); expect(document.activeElement).toBe(summary)
  await act(async () => { summary.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(summary.parentElement.open).toBe(true)
  expect(summary.parentElement.querySelector('pre').textContent).toBe(issueBody)
})
test('malformed model leaves native full reason visible with controls', async () => {
  await mount('createIssue', 'Complete malformed approval details')
  expect(container.querySelector('.gh-approval-valid')).toBeNull()
  expect(getComputedStyle(container.querySelector('[data-native-reason]')).display).not.toBe('none')
  expect(container.textContent).toContain('Complete malformed approval details')
  expect(container.querySelectorAll('button')).toHaveLength(2)
})
test('native single-seat component correlates session and call, and retains RC2 raw command fallback', async () => {
  await mount('createIssue')
  const pending = new Map([['other-session', { kind: 'approval', callId: 'call', toolName: 'github_create_issue', reason: approvalReason(approvalValue()) }]])
  const nodes = new Map([['node', { kind: 'tool-call', data: { root: { callId: 'call', argsRaw: JSON.stringify({ command: 'printf "not executed"' }) } } }]])
  await act(async () => root.render(h(plugin.NativeApprovalDetail, { sessionId: 'session', callId: 'call', useSessionPendingInteraction: select => select(pending), useChat: select => select({ nodes }) })))
  expect(container.textContent).toBe('printf "not executed"')
  expect(container.querySelector('.gh-approval-valid')).toBeNull()
  nodes.get('node').data.root.kind = 'tool-result'
  await act(async () => root.render(h(plugin.NativeApprovalDetail, { sessionId: 'session', callId: 'call', useSessionPendingInteraction: select => select(pending), useChat: select => select({ nodes }) })))
  expect(container.textContent).toBe('')
})
test.each(['light', 'dark'])('membership resource cards distinguish roles with keyboard links in narrow %s layout', async scheme => {
  await mount('addProjectItem')
  const region = container.querySelector('.gh-approval-valid'); region.style.width = '320px'; region.style.colorScheme = scheme
  expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth + 1)
  const resources = [...region.querySelectorAll('.gh-approval-resource')]
  expect(resources.map(node => node.querySelector('small').textContent)).toEqual(['Destination project', 'Issue to add'])
  expect(region.querySelectorAll('summary')).toHaveLength(1)
  expect(region.textContent).not.toContain('Use the native approval buttons below.')
  await act(async () => userEvent.keyboard('{Tab}'))
  for (const resource of resources) {
    const link = resource.querySelector('a'); expect(link).not.toBeNull()
    expect(link.textContent).toContain('↗'); link.focus(); expect(document.activeElement).toBe(link)
    expect(getComputedStyle(link).outlineStyle).not.toBe('none')
  }
  const summary = region.querySelector('summary'); summary.focus(); await act(async () => userEvent.keyboard('{Enter}'))
  expect(summary.parentElement.open).toBe(true)
})
test('long and missing resource metadata remains bounded without invented names', async () => {
  const value = approvalValue('addProjectItem')
  value.targets.project.title = 'Project'.repeat(200)
  value.targets.project.owner = { login: 'owner'.repeat(100) }
  value.targets.issue.title = 'Issue'.repeat(200)
  value.targets.issue.repository = { nameWithOwner: 'repo'.repeat(100) }
  await mount('addProjectItem', approvalReason(value))
  const region = container.querySelector('.gh-approval-valid'); region.style.width = '320px'
  expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth + 1)
  expect(region.querySelectorAll('.gh-approval-resource small')).toHaveLength(4)
  await act(async () => root.unmount()); container.remove()
  delete value.targets.project.title; delete value.targets.project.owner; delete value.targets.project.number; delete value.targets.project.url
  await mount('addProjectItem', approvalReason(value))
  expect(container.querySelector('.gh-approval-resource').textContent).toContain('Name unavailable')
  expect(container.querySelector('.gh-approval-resource').querySelector('a')).toBeNull()
})
test('adding an issue excludes unrelated project README from primary area', async () => {
  await mount('addProjectItem')
  expect(container.querySelector('.gh-approval-main').textContent).not.toContain('UNRELATED PROJECT README SENTINEL')
  expect(container.querySelector('.gh-approval-valid > details').textContent).toContain('UNRELATED PROJECT README SENTINEL')
})
