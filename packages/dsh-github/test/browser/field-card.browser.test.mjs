import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import source from '../../client.js?raw'
let root, container
const h = React.createElement
const click = locator => act(async () => locator.click())
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); document.documentElement.style.colorScheme = '' })
const prepared = { version: 1, toolName: 'github_set_project_item_field', callId: 'call', phase: 'prepared', exactPreview: 'Exact approved payload:  two spaces\nand a new line.',
  change: { field: { id: 'F_STATUS', name: 'Board status', dataType: 'SINGLE_SELECT' }, before: { optionId: 'OPT_OLD', name: 'In Progress', field: { id: 'F_STATUS', dataType: 'SINGLE_SELECT' } }, after: { singleSelectOptionId: 'OPT_NEW' }, selectedOption: { id: 'OPT_NEW', name: 'Done' } },
  targets: { project: { id: 'P_TARGET', title: 'Roadmap', number: 7, url: 'https://github.com/orgs/fixture/projects/7' }, item: { id: 'ITEM', project: { id: 'P_TARGET' }, content: { __typename: 'Issue', id: 'I_TARGET', number: 34, title: 'Approved GitHub write tools', url: 'https://github.com/fixture/repo/issues/34' } } } }
const settled = (outcome, extra = {}) => ({ kind: 'tool-result', call: { argsRaw: '{"value":{"singleSelectOptionId":"OPT_NEW"}}' }, content: [{ type: 'text', text: JSON.stringify({ host: 'github.com', operation: 'setProjectItemField', outcome, ...extra }) }] })
async function mount(handler = () => prepared, extra = {}) {
  let record
  const previous = window.__ModuleLoader__
  window.__ModuleLoader__ = { load: value => { record = value } }
  try { new Function(source)() } finally { window.__ModuleLoader__ = previous }
  const plugin = record.factory(() => React), calls = []
  const request = async (action, body, signal) => { calls.push({ action, body, signal }); return handler(action, body, signal) }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  let props = { sessionId: 'session', callId: 'call', block: { argsRaw: '{"value":{"singleSelectOptionId":"OPT_NEW"}}' }, request, ...extra }
  await act(async () => root.render(h(plugin.FieldChangeCard, props)))
  return { calls, async render(changes) { props = { ...props, ...changes }; await act(async () => root.render(h(plugin.FieldChangeCard, props))) } }
}
test('verified field change retains native approval preview, stable identities, and raw details', async () => {
  const fixture = await mount(undefined, { useSessionPendingInteraction: select => select(new Map([['session', { kind: 'approval', callId: 'call', toolName: prepared.toolName, key: 'pending-1', reason: prepared.exactPreview }]])) })
  expect(container.textContent).toContain('Awaiting approval')
  expect(container.textContent).toContain('Issue #34 — Approved GitHub write tools')
  expect(container.textContent).toContain('Board status')
  expect(container.textContent).toContain('In Progress → Done')
  expect(container.textContent).toContain('Before ID: OPT_OLD')
  expect(container.textContent).toContain('Project ID: P_TARGET; Item ID: ITEM; Field ID: F_STATUS')
  await click(page.getByText('Complete exact approval preview', { exact: true }))
  expect(Array.from(container.querySelectorAll('pre')).some(pre => pre.textContent === prepared.exactPreview)).toBe(true)
  await click(page.getByText('Raw tool details', { exact: true }))
  expect(container.textContent).toContain('OPT_NEW')
  expect(container.querySelectorAll('button')).toHaveLength(0)
  expect(fixture.calls.every(call => call.action === 'status')).toBe(true)
})
test.each(['prepared', 'approved', 'authorized-by-grant', 'running', 'denied', 'failed', 'unattempted'])('phase %s never reports confirmed success', async phase => {
  await mount(() => ({ ...prepared, phase }))
  expect(container.querySelector('[role="status"]').textContent).not.toContain('GitHub confirmed')
  expect(container.querySelectorAll('button')).toHaveLength(0)
})
test('confirmation and uncertainty use explicit result evidence and preserve warnings', async () => {
  const fixture = await mount(() => ({ ...prepared, phase: 'running' }), { block: settled('confirmed') })
  expect(container.textContent).toContain('GitHub confirmed the update')
  expect(container.textContent).toContain('not a fresh read')
  await fixture.render({ block: settled('uncertain', { message: 'Dispatched write outcome is unknown.', cleanupWarning: 'Backend fenced until verified.' }) })
  expect(container.textContent).toContain('Outcome uncertain')
  expect(container.textContent).toContain('Backend fenced until verified')
  expect(container.textContent).toContain('Do not retry automatically')
  expect(container.textContent).not.toContain('GitHub confirmed the update')
})
test('missing names and malformed values fall back without inferring before from requested after', async () => {
  await mount(() => ({ ...prepared, change: { field: { id: 'F_STATUS', dataType: 'SINGLE_SELECT' }, after: { singleSelectOptionId: 'OPT_NEW' }, selectedOption: { id: 'WRONG', name: 'Fake name' } }, targets: { project: { id: 'P_TARGET' }, item: { id: 'ITEM' } } }))
  expect(container.textContent).toContain('Field F_STATUS')
  expect(container.textContent).toContain('Previous value unavailable')
  expect(container.textContent).toContain('OPT_NEW')
  expect(container.textContent).not.toContain('Fake name')
  expect(container.textContent).not.toContain('→')
})
test('expired bridge and malformed settled result do not imply success', async () => {
  await mount(() => ({ version: 1, phase: 'expired', grants: [], history: [] }), { block: { kind: 'tool-result', isError: false, content: [{ type: 'text', text: 'not JSON' }] } })
  expect(container.textContent).toContain('Outcome unknown')
  expect(container.textContent).toContain('Previous value unavailable')
  expect(container.textContent).not.toContain('GitHub confirmed')
})
test('session changes abort requests and discard late prepared names', async () => {
  let resolveOld
  const fixture = await mount((_action, body) => body.sessionId === 'session' ? new Promise(resolve => { resolveOld = resolve }) : { version: 1, phase: 'expired' })
  await fixture.render({ sessionId: 'other' })
  await act(async () => resolveOld(prepared))
  expect(fixture.calls[0].signal.aborted).toBe(true)
  expect(container.textContent).not.toContain('Roadmap')
})
test.each(['light', 'dark'])('keyboard disclosure, hostile text and long exact values fit narrow %s layout', async scheme => {
  document.documentElement.style.colorScheme = scheme
  await mount(() => ({ ...prepared, change: { field: { id: 'F_TEXT', name: 'Notes', dataType: 'TEXT' }, before: null, after: { text: '<script>unsafe</script>' + 'long'.repeat(250) } }, targets: { ...prepared.targets, item: { ...prepared.targets.item, content: { __typename: 'DraftIssue', id: 'DRAFT', title: '<script>title</script>', url: 'javascript:alert(1)' } } } }))
  container.style.width = '320px'
  expect(container.scrollWidth).toBeLessThanOrEqual(320)
  expect(container.textContent).toContain('Not set →')
  expect(container.textContent).toContain('Draft issue DRAFT')
  expect(container.querySelector('script')).toBeNull()
  expect(container.querySelector('a[href^="javascript"]')).toBeNull()
  const summary = page.getByText('Complete exact approval preview', { exact: true }).element()
  summary.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  expect(summary.parentElement.open).toBe(true)
})
