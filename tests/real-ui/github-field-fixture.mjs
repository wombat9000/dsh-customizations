// Synthetic persisted display results. No tools execute or GitHub authority is granted.
export const githubFieldSessionId = 'visual-test-github-field'
export const githubFieldWorkspaceName = 'github-field-workspace'
export const githubFieldPrompt = 'Review synthetic field no-change and failure results.'
export function githubFieldSessionSeed(cwd) {
  const time = Date.UTC(2026, 0, 2, 3, 4, 5)
  const results = [
    { host: 'github.com', operation: 'setProjectItemField', outcome: 'no-change', dispatched: false, reason: 'FIELD_VALUE_ALREADY_SET', message: 'The field already has the requested value. Nothing was changed.' },
    { host: 'github.com', outcome: 'failed', error: { code: 'NOT_FOUND', message: 'The requested project or item was not found.' } },
  ]
  const calls = results.map((_, index) => ({ type: 'tool-call', id: `visual-field-${index}`, name: 'github_set_project_item_field', arguments: JSON.stringify({ owner: 'fixture-org', projectNumber: 7, itemId: `ITEM_${index}`, fieldId: 'F_STATUS', value: { singleSelectOptionId: 'OPT_TODO' } }) }))
  const seed = [
    { time, type: 'turn/start', data: { turn: 1 } },
    { time, type: 'user/message', surfaceOp: 'append', data: { id: 'visual-field-user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: githubFieldPrompt }] } },
    { time, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, stream: [], message: { id: 'visual-field-assistant', role: 'assistant', source: { kind: 'model', provider: 'synthetic-fixture', model: 'never-dispatched' }, content: calls } } },
  ]
  calls.forEach((call, index) => {
    seed.push({ time, type: 'tool/call', data: { turn: 1, step: 1, callId: call.id, name: call.name, arguments: call.arguments } })
    seed.push({ time, type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step: 1, message: { id: `visual-field-result-${index}`, role: 'user', source: { kind: 'tool', callId: call.id }, content: [{ type: 'tool-result', toolCallId: call.id, content: [{ type: 'text', text: JSON.stringify(results[index]) }] }] } } })
  })
  seed.push({ time, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  return { id: githubFieldSessionId, options: { meta: { cwd, createdAt: time }, seed: seed.map((event, seq) => ({ seq, ...event })) } }
}
