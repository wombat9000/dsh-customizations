import type { FastMode, RpcEndpoints } from '../../shared/contracts.js'
const off: RpcEndpoints['integration-set']['input'] = { enabled: false, revision: 1 }
// @ts-expect-error Higher-usage enable must be an explicit boolean.
const invalidEnable: RpcEndpoints['integration-set']['input'] = { enabled: 'true', revision: 1 }
// @ts-expect-error A session mutation must carry the route/model and concurrency revision.
const missingIdentity: RpcEndpoints['session-set']['input'] = { sessionId: 's', enabled: true }
const childOff: RpcEndpoints['subagents-set']['input'] = {
  sessionId: 's',
  enabled: false,
  revision: 1,
}
// @ts-expect-error Compatibility subagent settings still require a concurrency revision.
const missingChildRevision: RpcEndpoints['subagents-set']['input'] = {
  sessionId: 's',
  enabled: true,
}
const modes: FastMode[] = ['off', 'all', 'main']
// @ts-expect-error There is no supported subagents-only mode.
const childOnly: FastMode = 'subagents'
const combined: RpcEndpoints['mode-set']['input'] = {
  sessionId: 's',
  provider: 'openai-codex',
  model: 'gpt-6-sol',
  mode: 'all',
  sessionRevision: 1,
  subagentsRevision: 2,
}
// @ts-expect-error Every combined mutation carries both revisions, including Off recovery.
const missingModeRevision: RpcEndpoints['mode-set']['input'] = {
  sessionId: 's',
  provider: 'openai-codex',
  model: 'gpt-6-sol',
  mode: 'off',
  sessionRevision: 1,
}
void [
  off,
  invalidEnable,
  missingIdentity,
  childOff,
  missingChildRevision,
  modes,
  childOnly,
  combined,
  missingModeRevision,
]
