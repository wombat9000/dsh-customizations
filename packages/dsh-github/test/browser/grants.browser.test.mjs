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
const scope = { account: { id: 'U_fixture', login: 'fixture' }, operations: ['setProjectItemField', 'addIssueDependency'],
  issues: [{ id: 'I_one', repositoryId: 'R_fixture', repositoryOwnerId: 'U_fixture', nameWithOwner: 'fixture/repo', issueNumber: 1, title: '<script>untrusted</script>', url: 'https://github.com/fixture/repo/issues/1' }, { id: 'I_two', repositoryId: 'R_fixture', repositoryOwnerId: 'U_fixture', nameWithOwner: 'fixture/repo', issueNumber: 2, url: 'https://evil.example/unsafe' }],
  projects: [{ id: 'P_fixture', ownerId: 'U_fixture', owner: 'fixture', projectNumber: 3 }], memberships: [{ id: 'ITEM_fixture', issueId: 'I_one', projectId: 'P_fixture' }] }
const pending = { version: 1, toolName: 'github_request_issue_management', callId: 'call', phase: 'pending', scope, exactPreview: 'Exact scope: fixture account U_fixture; issue I_one.  Preserve spaces.\nEnd.', grants: [], history: [] }
const active = { ...pending, phase: 'active', grants: [{ id: 'grant-one', state: 'active', scope }] }
async function mount(handler, extra = {}) {
  let record
  const previous = window.__ModuleLoader__
  window.__ModuleLoader__ = { load: value => { record = value } }
  try { new Function(source)() } finally { window.__ModuleLoader__ = previous }
  const plugin = record.factory(() => React), calls = []
  const request = async (action, body, signal) => { calls.push({ action, body, signal }); return handler(action, body, signal) }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  let props = { sessionId: 'session', callId: 'call', block: { argsRaw: '{"issues":[1]}' }, request, ...extra }
  await act(async () => root.render(h(plugin.GrantCard, props)))
  return { calls, async render(changes) { props = { ...props, ...changes }; await act(async () => root.render(h(plugin.GrantCard, props))) } }
}
test('readable complete scope supplements native approval without custom allow controls', async () => {
  const fixture = await mount(() => pending, { useSessionPendingInteraction: select => select(new Map([['session', { kind: 'approval', callId: 'call', toolName: pending.toolName, key: 'request-1', reason: pending.exactPreview }]])) })
  await expect.element(page.getByRole('heading', { name: 'Manage selected issues for this session' })).toBeVisible()
  expect(container.textContent).toContain('Awaiting approval')
  expect(container.textContent).toContain('Account ID: U_fixture')
  expect(container.textContent).toContain('Repository ID: R_fixture')
  expect(container.textContent).toContain('Unavailable capabilities:')
  expect(container.textContent).toContain('does not transfer to other sessions or subagents')
  expect(container.querySelector('script')).toBeNull()
  expect(container.querySelector('a[href*="evil.example"]')).toBeNull()
  expect(container.querySelectorAll('button')).toHaveLength(1)
  await click(page.getByText('Complete exact approval preview', { exact: true }))
  expect(container.querySelector('pre').textContent).toBe(pending.exactPreview)
  await click(page.getByText('Raw tool details', { exact: true }))
  expect(container.textContent).toContain('{"issues":[1]}')
  expect(fixture.calls.every(call => call.action === 'status')).toBe(true)
})
test('revoke uses exact grant identity and observes revoked status; renewal never dispatches', async () => {
  let revoked = false
  const fixture = await mount(action => {
    if (action === 'revoke') { revoked = true; return { id: 'grant-one', state: 'revoked' } }
    return revoked ? { ...active, grants: [{ ...active.grants[0], state: 'revoked' }] } : active
  })
  await click(page.getByRole('button', { name: 'Revoke access grant-one' }))
  await expect.element(page.getByRole('button', { name: 'Revoke access grant-one' })).not.toBeInTheDocument()
  expect(container.textContent).toContain('No access renews automatically')
  expect(fixture.calls.find(call => call.action === 'revoke').body).toEqual({ sessionId: 'session', callId: 'call', grantId: 'grant-one' })
  expect(fixture.calls.some(call => /approve|grant|renew/.test(call.action))).toBe(false)
})
test('uncertain and unattempted history remain explicit without retry buttons', async () => {
  await mount(() => ({ ...active, grants: [{ ...active.grants[0], state: 'renewal-required' }], history: [
    { id: 'h1', operation: 'setProjectItemField', outcome: 'uncertain', targets: { project: { id: 'P_fixture' } } },
    { id: 'h2', operation: 'addIssueDependency', outcome: 'unattempted' },
    { id: 'h3', operation: 'addIssueDependency', outcome: 'confirmed' },
    { id: 'h4', operation: 'addIssueDependency', outcome: 'failed' },
  ] }))
  expect(container.textContent).toContain('Do not retry automatically')
  expect(container.textContent).toContain(': unattempted')
  expect(container.textContent).toContain(': confirmed')
  expect(container.textContent).toContain(': failed')
  expect(container.textContent).toContain('Renewal required')
  expect(Array.from(container.querySelectorAll('button')).some(button => /retry|apply|allow|approve/i.test(button.textContent))).toBe(false)
})
test('lost revoke response does not claim revoked or send another revoke', async () => {
  const fixture = await mount(action => { if (action === 'revoke') throw new Error('lost'); return active })
  await click(page.getByRole('button', { name: 'Revoke access grant-one' }))
  expect(page.getByRole('alert').element().textContent).toContain('Revocation could not be confirmed')
  expect(container.textContent).toContain('Status unknown')
  expect(fixture.calls.filter(call => call.action === 'revoke')).toHaveLength(1)
})
test('session switches discard late prior-session status and abort old requests', async () => {
  let resolveOld
  const fixture = await mount((_action, body) => body.sessionId === 'session' ? new Promise(resolve => { resolveOld = resolve }) : { version: 1, phase: 'expired', grants: [], history: [] })
  await fixture.render({ sessionId: 'other' })
  await act(async () => resolveOld(active))
  expect(fixture.calls[0].signal.aborted).toBe(true)
  expect(container.textContent).toContain('Expired')
  expect(container.textContent).not.toContain('U_fixture')
})
test('malformed status and mismatched pending call fail closed', async () => {
  await mount(() => ({ ...active, callId: 'wrong' }), { useSessionPendingInteraction: select => select(new Map([['session', { kind: 'approval', callId: 'other', toolName: pending.toolName, key: 'wrong' }]])) })
  expect(page.getByRole('alert').element().textContent).toContain('Invalid GitHub grant status')
  expect(container.textContent).not.toContain('Awaiting approval')
  expect(container.textContent).not.toContain('Account ID:')
})
test.each([['running', 'Running — access is not yet confirmed'], ['denied', 'Denied'], ['failed', 'Failed'], ['expired', 'Expired — fresh approval required'], ['unrecognized', 'Status unknown — access is not confirmed']])('lifecycle %s never invents active authority', async (phase, label) => {
  await mount(() => ({ ...pending, phase }))
  expect(container.querySelector('[role="status"]').textContent).toBe(label)
  expect(container.textContent).not.toContain('Active access')
  expect(container.querySelector('[aria-label^="Revoke access"]')).toBeNull()
})
test('concurrent revoke clicks produce one request and stale polling cannot revive access', async () => {
  let settle
  const fixture = await mount(action => action === 'revoke' ? new Promise(resolve => { settle = resolve }) : active)
  const button = page.getByRole('button', { name: 'Revoke access grant-one' }).element()
  await act(async () => { button.click(); button.click() })
  expect(fixture.calls.filter(call => call.action === 'revoke')).toHaveLength(1)
  expect(button.disabled).toBe(true)
  await act(async () => settle({ state: 'revoked' }))
})
test.each(['light', 'dark'])('long scope remains bounded and keyboard accessible in narrow %s layout', async scheme => {
  document.documentElement.style.colorScheme = scheme
  const longScope = { ...scope, issues: Array.from({ length: 50 }, (_, i) => ({ ...scope.issues[0], id: `I_${i}`, issueNumber: i + 1, title: 'Long issue title '.repeat(12) })) }
  await mount(() => ({ ...pending, scope: longScope }))
  container.style.width = '320px'
  expect(container.scrollWidth).toBeLessThanOrEqual(320)
  const summary = page.getByText('Complete exact approval preview', { exact: true }).element()
  summary.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  expect(summary.parentElement.open).toBe(true)
  await expect.element(page.getByRole('group', { name: 'Selected issues', exact: true })).toBeVisible()
  expect(container.querySelector('.gh-scroll').clientHeight).toBeLessThanOrEqual(350)
})
