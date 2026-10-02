import type { GitHubAccount, GitHubCaller } from './contracts.js'
import type { AccountObserver, PreparedWrite } from './write-contracts.js'
export interface GrantCaller extends GitHubCaller {
  session?: object | undefined
  isSubagent: boolean
}
export interface ActiveGrantCaller extends GrantCaller {
  session: object
  agentId: string
  cwd: string
}
export interface GrantIssueTarget {
  owner: string
  repo: string
  issueNumber: number
}
export interface GrantProjectTarget {
  owner: string
  projectNumber: number
}
export interface GrantArguments {
  operations: string[]
  issues: GrantIssueTarget[]
  projects: GrantProjectTarget[]
}
export interface GrantScope extends GrantArguments {
  account: GitHubAccount
  issues: Array<
    GrantIssueTarget & {
      id: string
      repositoryId: string
      repositoryOwnerId: string
      nameWithOwner: string
      url: string
      title: string
    }
  >
  projects: Array<GrantProjectTarget & { id: string; ownerId: string; url: string; title: string }>
  memberships: Array<{ id: string; issueId: string; projectId: string }>
}
export interface Grant {
  id: string
  scope: GrantScope
  state: string
}
export interface GrantPreparation {
  scope: GrantScope
  preview: string
}
export interface GrantHistory {
  id: string
  operation: string
  targets: unknown
  outcome: string
}
export interface GrantState {
  agentId: string
  cwd: string
  account: GitHubAccount | null
  generation: number
  grants: Grant[]
  history: GrantHistory[]
  historyTruncated: boolean
}
export interface GrantResolver {
  resolveGrantScope(
    input: unknown,
    exec?: GitHubCaller,
    observers?: AccountObserver,
  ): Promise<GrantScope>
}
export interface GrantRuntime {
  prepare(input: unknown, exec: GrantCaller): Promise<GrantPreparation>
  accept(token: GrantPreparation, exec: GrantCaller): Promise<Grant>
  observe(account: GitHubAccount, exec: GrantCaller): void
  observeAccount(account: GitHubAccount): void
  check(write: PreparedWrite, exec: GrantCaller): object | null
  assert(permit: object, write: PreparedWrite, exec: GrantCaller | undefined): void
  revoke(id: string, exec: GrantCaller): Grant
  list(exec: GrantCaller): Grant[]
  attempt(write: Pick<PreparedWrite, 'operation' | 'knownTargets'>, exec: GrantCaller): object
  outcome(token: object, outcome: string): void
  history(exec: GrantCaller): GrantHistory[]
  historyTruncated(exec: GrantCaller): boolean
  disposeSession(session: object | undefined): void
  dispose(): void
}
