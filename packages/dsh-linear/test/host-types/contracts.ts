import type { LinearReads, LinearListIssuesArgs, LinearReadOptions } from '../../src/reads.js'
import type { SettingsRpc, RpcEndpoints, ConnectionStatus } from '../../shared/rpc.js'
type Assert<T extends true> = T
type Reject<T, U> = T extends U ? false : true
// These reject independent contract mistakes without executing provider requests.
type MissingIssue = Assert<Reject<{}, Parameters<LinearReads['getIssue']>[0]>>
type WrongLimit = Assert<Reject<{ limit: string }, LinearListIssuesArgs>>
type WrongOrder = Assert<Reject<{ orderBy: 'priority' }, LinearListIssuesArgs>>
type WrongSignal = Assert<Reject<{ signal: string }, LinearReadOptions>>
type MissingKey = Assert<Reject<{}, RpcEndpoints['connect']>>
type SecretStatus = Assert<Reject<'apiKey', keyof ConnectionStatus>>
type PromiseIssue = Assert<
  ReturnType<LinearReads['getIssue']> extends Promise<{
    id: string
    identifier: string
    title: string
    url: string
  }>
    ? true
    : false
>
const readOnly = (reads: LinearReads, rpc: SettingsRpc) => {
  reads.listIssues({ limit: 20, orderBy: 'createdAt' }, { signal: new AbortController().signal })
  reads.getProject({ project: 'project-selector' })
  rpc.call('/linear-integration', 'connect', { apiKey: 'fixture-key' })
}
void readOnly
