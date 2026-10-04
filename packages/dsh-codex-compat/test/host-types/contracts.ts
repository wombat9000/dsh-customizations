import type { RpcEndpoints } from '../../shared/contracts.js'
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
// @ts-expect-error Independent subagent settings still require an explicit concurrency revision.
const missingChildRevision: RpcEndpoints['subagents-set']['input'] = {
  sessionId: 's',
  enabled: true,
}
void [off, invalidEnable, missingIdentity, childOff, missingChildRevision]
