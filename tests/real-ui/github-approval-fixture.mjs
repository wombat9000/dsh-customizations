// Disposable-shell UI fixture only. Dispatch a native approval waterfall, never
// a tool, mutation, model, or persistent approval audit. No authorization results
// are consumed by a business operation. Existing Node tests cover that pipeline.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { githubSessionId, githubCallId } from './github-grants-fixture.mjs'
import { approvalValue, approvalReason, approvalTool } from '../../packages/dsh-github/test/approval-preview-fixtures.js'
const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const { scopeTarget } = await import(pathToFileURL(cli.resolve('@deepseek-ai/dsh-scope')).href)
export const commandSessionId = 'visual-test-github-approval-command'
export const commandWorkspace = 'github-approval-command-workspace'
export const commandText = 'printf "synthetic command only\\n"'
export function approvalCommandSeed(cwd) {
  const time = Date.UTC(2026, 0, 2, 3, 4, 5)
  const call = { type: 'tool-call', id: 'synthetic-command-call', name: 'bash', arguments: JSON.stringify({ command: commandText }) }
  return { id: commandSessionId, options: { meta: { cwd, createdAt: time }, seed: [
    { seq: 0, time, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, time, type: 'user/message', surfaceOp: 'append', data: { id: 'command-user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Synthetic native command approval fixture.' }] } },
    { seq: 2, time, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, stream: [], message: { id: 'command-assistant', role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'never-dispatched' }, content: [call] } } },
    { seq: 3, time, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ] } }
}
export function registerApprovalFixture(ctx) {
  let pending, outcome = 'idle', commandTurn = 1
  ctx.effect(() => () => pending?.abort())
  ctx.inject(['webServer'], scope => scope.effect(() => scope.webServer.register({ kind: 'exact', path: '/api/test/github-approval', handler: async (req, res) => {
    const reply = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
    if (req.method !== 'POST' || req.headers.origin !== `http://${req.headers.host}` || req.headers['x-dsh-test'] !== '1') return reply(403, {})
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1000) throw new Error('Bound') }
      const { action, operation = 'createIssue' } = JSON.parse(raw)
      const sessionId = operation === 'command' ? commandSessionId : githubSessionId
      if (action === 'state') return reply(200, { outcome, ready: Boolean(ctx.get('agents')?.get(sessionId)) })
      if (action === 'cancel') { pending?.abort(); return reply(200, { outcome: 'cancelled' }) }
      if (action !== 'start') return reply(400, {})
      const agent = ctx.get('agents')?.get(sessionId)
      if (!agent) return reply(409, { error: 'Open the seeded GitHub session first.' })
      pending?.abort(); const controller = new AbortController(); pending = controller
      const reason = operation === 'command' ? 'Synthetic command approval. No command will execute.' : operation === 'malformed' ? 'Complete malformed synthetic approval payload: {"unexpected":true}' : approvalReason(approvalValue(operation))
      const toolName = operation === 'command' ? 'bash' : operation === 'malformed' ? 'github_create_issue' : approvalTool(operation)
      outcome = 'pending'
      const turn = operation === 'command' ? ++commandTurn : undefined
      if (turn) {
        // Only a live, unattempted call has the raw root used by RC2's fallback.
        // Completed history normalizes calls into results, so seed this display
        // event directly; no agent loop or tool execution is started.
        agent.session.append('turn/start', { turn })
        agent.session.append('assistant/message', { turn, step: 1, stream: [], message: { id: `command-live-${turn}`, role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'never-dispatched' }, content: [{ type: 'tool-call', id: 'synthetic-command-call', name: 'bash', arguments: JSON.stringify({ command: commandText }) }] } }, { surfaceOp: 'append' })
        agent.session.append('tool/call', { turn, step: 1, callId: 'synthetic-command-call', name: 'bash', arguments: JSON.stringify({ command: commandText }) })
      }
      Promise.resolve(ctx.waterfall(scopeTarget(agent, agent), 'approval/request', { agent, toolName, callId: operation === 'command' ? 'synthetic-command-call' : githubCallId, reason, signal: controller.signal }, () => Promise.resolve('unavailable'))).then(value => { if (pending === controller) outcome = value }, () => { if (pending === controller) outcome = 'cancelled' }).finally(() => { if (turn) agent.session.append('turn/end', { turn, reason: { kind: 'completed' } }) })
      return reply(200, { outcome, reason })
    } catch { return reply(400, { error: 'Invalid synthetic fixture request' }) }
  } })))
}
