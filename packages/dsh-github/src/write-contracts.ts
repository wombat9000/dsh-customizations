import type { APIRequest, GitHubAccount, GitHubCaller } from './contracts.js'

export interface WriteArguments extends Record<string, unknown> {
  owner?: string
  repo?: string
  title?: string
  body?: string
  description?: string
  readme?: string
  templateOwner?: string
  templateNumber?: number
  includeDraftIssues?: boolean
  projectNumber?: number
  repositoryOwner?: string
  issueNumber?: number
  itemId?: string
  fieldId?: string
  blockingOwner?: string
  blockingRepo?: string
  blockingIssueNumber?: number
  value?: Record<string, string | number>
}
export interface ResolvedWrite {
  actor: GitHubAccount
  mutation: string
  payload: Record<string, unknown>
  targets: Record<string, unknown>
  change: Record<string, unknown>
  snapshot: unknown
  request?: APIRequest | undefined
}
export interface PreparedWrite extends ResolvedWrite {
  operation: string
  args: WriteArguments
  agentId: string
  cwd: string
  knownTargets: Record<string, unknown>
  preview: string
}
export interface AccountObserver {
  onAccount?: ((account: GitHubAccount) => void) | undefined
}
export interface ExecutionObservers extends AccountObserver {
  onDispatch?: ((prepared: PreparedWrite) => void) | undefined
  beforeDispatch?: ((prepared: PreparedWrite) => void) | undefined
  onPreflight?: ((fresh: ResolvedWrite) => void) | undefined
}
export interface WriteResult extends Record<string, unknown> {
  host: string
  outcome: 'confirmed' | 'uncertain' | 'no-change' | 'failed'
  resource?: unknown
  observedConfirmedResource?: unknown
  observedResources?: unknown
  backendFenced?: boolean
  cleanupWarning?: unknown
}
export interface GitHubWriteRuntime {
  prepare(
    operation: string,
    input: unknown,
    exec?: GitHubCaller,
    observers?: AccountObserver,
  ): Promise<PreparedWrite>
  execute(
    prepared: PreparedWrite,
    exec?: GitHubCaller,
    observers?: ExecutionObservers,
  ): Promise<WriteResult>
}
