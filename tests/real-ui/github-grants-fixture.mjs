// Synthetic display history only. No tool executes and no authority is restored.
export const githubSessionId = 'visual-test-github-grants'
export const githubCallId = 'visual-github-grant-call'
export const githubWorkspaceName = 'github-grants-workspace'
export const githubToolName = 'github_request_issue_management'
export const githubPrompt = 'Review the synthetic GitHub issue management grant.'

// DSH 0.1.5 SessionEvent / ToolCallBlock / ToolResultMessage contracts.
export function githubSessionSeed(cwd) {
  const time = Date.UTC(2026, 0, 2, 3, 4, 5)
  const call = { type: 'tool-call', id: githubCallId, name: githubToolName,
    arguments: JSON.stringify({ issues: [{ owner: 'fixture-org', repo: 'demo', issueNumber: 43 }], operations: ['setProjectItemField', 'addIssueDependency'] }) }
  return { id: githubSessionId, options: { meta: { cwd, createdAt: time }, seed: [
    { seq: 0, time, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, time, type: 'user/message', surfaceOp: 'append', data: { id: 'visual-github-user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: githubPrompt }] } },
    { seq: 2, time, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, stream: [], message: {
      id: 'visual-github-assistant', role: 'assistant', source: { kind: 'model', provider: 'synthetic-fixture', model: 'never-dispatched' }, content: [call],
    } } },
    { seq: 3, time, type: 'tool/call', data: { turn: 1, step: 1, callId: call.id, name: call.name, arguments: call.arguments } },
    { seq: 4, time, type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step: 1, message: {
      id: 'visual-github-result', role: 'user', source: { kind: 'tool', callId: call.id }, content: [{ type: 'tool-result', toolCallId: call.id,
        content: [{ type: 'text', text: 'Synthetic display fixture. No access was granted and no GitHub call was made.' }],
      }],
    } } },
    { seq: 5, time, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ] } }
}
