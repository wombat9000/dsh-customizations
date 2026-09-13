import assert from 'node:assert/strict'
import test from 'node:test'
import { createGitHubPresentation } from '../src/presentation.js'
import { allowedRequest, validateInput, createHandler } from '../src/routes.js'
import { grantPreview } from '../src/grant-tools.js'
import { Readable } from 'node:stream'

function fixture() {
  const events = []
  const session = { id: 'root', get seq() { return events.length }, eventAt: seq => events[seq] }
  const agent = { session }
  let current = agent
  let grantState = 'active'
  const grants = { list: () => [{ id: 'grant', state: grantState }], history: () => [{ id: 'attempt', outcome: 'uncertain' }], historyTruncated: () => true, revoke: id => { assert.equal(id, 'grant'); grantState = 'revoked' } }
  const presentation = createGitHubPresentation({ agents: { get: id => id === 'root' ? current : undefined, roots: () => [current] }, grants, caller: exec => ({ session: exec.agent.session, isSubagent: false }) })
  const exec = { agent, name: 'github_request_issue_management', callId: 'call' }
  return { presentation, exec, events, session, replace() { current = { session: { ...session } } } }
}
test('bounded presentation binds exact live session and never restores preview or authority', () => {
  const f = fixture()
  f.presentation.request(f.exec, { test: 'owned DTO' }, 'exact preview')
  const key = { sessionId: 'root', callId: 'call' }
  assert.equal(f.presentation.status(key).exactPreview, 'exact preview')
  assert.equal(f.presentation.status(key).historyTruncated, true)
  assert.equal(f.presentation.status({ ...key, sessionId: 'child' }).phase, 'expired')
  f.replace()
  assert.equal(f.presentation.status(key).exactPreview, undefined)
  f.presentation.dispose()
  assert.deepEqual(f.presentation.status(key), { version: 1, phase: 'expired', grants: [], history: [] })
})
test('presentation uses exact correlated approval audit without equating approval with execution', () => {
  const f = fixture(); const key = { sessionId: 'root', callId: 'call' }
  f.presentation.request(f.exec, {}, 'preview')
  f.events.push({ type: 'approval/asked', data: { id: 'ask', toolName: f.exec.name, callId: 'call' } })
  assert.equal(f.presentation.status(key).phase, 'awaiting-approval')
  f.events.push({ type: 'approval/decided', data: { id: 'other', outcome: 'allowed-once' } })
  assert.equal(f.presentation.status(key).phase, 'awaiting-approval')
  f.events.push({ type: 'approval/decided', data: { id: 'ask', outcome: 'allowed-once' } })
  assert.equal(f.presentation.status(key).phase, 'approved')
  f.presentation.phase(f.exec, 'active')
  assert.equal(f.presentation.status(key).phase, 'active')
  assert.equal(f.presentation.revoke({ ...key, grantId: 'grant' }).phase, 'expired')
})
test('request headlines bind their own grant instead of another active session grant', () => {
  const f = fixture(); const key = { sessionId: 'root', callId: 'call' }
  f.presentation.request(f.exec, {}, 'preview')
  f.presentation.granted(f.exec, { id: 'different-expired-grant' })
  assert.equal(f.presentation.status(key).phase, 'expired')
  f.presentation.phase({ ...f.exec, callId: 'failed-preparation' }, 'failed')
  assert.equal(f.presentation.status({ ...key, callId: 'failed-preparation' }).phase, 'failed')
})

test('presentation eviction drops only informational previews and retains bounded recent calls', () => {
  const f = fixture()
  for (let i = 0; i < 101; i++) f.presentation.request({ ...f.exec, callId: `call-${i}` }, {}, `preview-${i}`)
  assert.equal(f.presentation.status({ sessionId: 'root', callId: 'call-0' }).phase, 'expired')
  assert.equal(f.presentation.status({ sessionId: 'root', callId: 'call-100' }).exactPreview, 'preview-100')
})
test('native grant review is complete readable prose, with explicit exclusions and unavailable actions', () => {
  const scope = { account: { id: 'U1', login: 'alice' }, issues: [{ id: 'I1', repositoryId: 'R1', repositoryOwnerId: 'O1', nameWithOwner: 'acme/repo', issueNumber: 12, url: 'https://github.com/acme/repo/issues/12' }], projects: [{ id: 'P1', ownerId: 'O1', owner: 'acme', projectNumber: 4, url: 'https://github.com/orgs/acme/projects/4' }], memberships: [{ id: 'ITEM1', issueId: 'I1', projectId: 'P1' }], operations: ['setProjectItemField'] }
  const preview = grantPreview(scope, 'root')
  for (const value of ['Manage selected issues for this session', 'alice (ID U1)', 'repository ID R1', 'repository owner ID O1', 'project ID P1', 'Item ITEM1', 'setProjectItemField', 'Unavailable:', 'closing/reopening', 'DSH restart', 'subagents', 'does not start work']) assert.ok(preview.includes(value), value)
  assert.ok(!preview.includes('"account":'))
})
test('card routes reject cross-origin requests, injected actions and ambiguous identity bodies', () => {
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json', 'x-dsh-github': '1' } }
  assert.equal(allowedRequest(req, 3000), true)
  for (const patch of [{ origin: 'https://evil.example' }, { host: 'evil.example' }, { 'x-dsh-github': undefined }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }]) assert.equal(allowedRequest({ ...req, headers: { ...req.headers, ...patch } }, 3000), false)
  assert.equal(allowedRequest({ ...req, socket: { remoteAddress: '10.0.0.2' } }, 3000), false)
  assert.deepEqual(validateInput({ sessionId: 's', callId: 'c' }, 'status'), { sessionId: 's', callId: 'c' })
  for (const [input, action] of [[{ sessionId: 's', callId: 'c' }, 'approve'], [{ sessionId: 's', callId: 'c', grantId: 'g' }, 'status'], [{ sessionId: 's', callId: 'c' }, 'revoke'], [{ sessionId: '', callId: 'c' }, 'status']]) assert.throws(() => validateInput(input, action))
})
test('route handler exposes only status/revocation and redacts internal failures', async () => {
  let calls = 0
  async function invoke(body, action = 'status') {
    const req = Readable.from([Buffer.from(body)])
    req.method = 'POST'; req.socket = { remoteAddress: '127.0.0.1' }; req.headers = { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-dsh-github': '1' }
    const res = { writeHead(code, headers) { this.code = code; this.headers = headers }, end(body) { this.body = JSON.parse(body) } }
    await createHandler({ status() { calls++; throw new Error('private diagnostic') } }, action, 3000)(req, res)
    return res
  }
  const response = await invoke(JSON.stringify({ sessionId: 's', callId: 'c' }))
  assert.equal(response.code, 409); assert.equal(calls, 1)
  assert.equal(response.headers['Cache-Control'], 'no-store')
  assert.ok(!JSON.stringify(response.body).includes('private diagnostic'))
  assert.equal((await invoke('x'.repeat(5000))).code, 409)
  assert.equal(calls, 1)
})
