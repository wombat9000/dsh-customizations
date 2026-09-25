import { object, id } from './validation.ts'
export const TOOL = 'github_request_issue_management'
export const labels: Readonly<Record<string, string>> = {
  setProjectItemField: 'Update supported board fields for granted issue memberships',
  addIssueDependency: 'Add a dependency between two granted issues',
}
export const exclusions =
  'No deletion, transfer, new issues, issues outside this grant, project configuration, repository settings, or project membership changes.'
export const unavailable =
  'Issue title/description editing, labels, assignees, closing/reopening, and dependency removal are not available through this integration.'
export const expiry =
  'Access applies only to this live requesting session and account. It does not transfer to other sessions or subagents. Restart, session restoration, account change, or service disposal requires fresh approval. Revocation prevents future dispatch, not writes already dispatched.'
export interface GrantIssue {
  id: string
  repositoryId: string
  repositoryOwnerId: string
  nameWithOwner: string
  issueNumber: number
  title?: unknown
  url?: unknown
}
export interface GrantProject {
  id: string
  ownerId: string
  owner: string
  projectNumber: number
  title?: unknown
  url?: unknown
}
export interface Membership {
  id: string
  issueId: string
  projectId: string
}
export interface GrantScope {
  account: { id: string; login: string }
  operations: string[]
  issues: GrantIssue[]
  projects: GrantProject[]
  memberships: Membership[]
}
export interface Grant {
  id: string
  state: string
  scope: GrantScope
}
export interface HistoryRow extends Record<string, unknown> {
  id: string
  operation: string
  outcome: string
}
export interface GrantStatus {
  version: 1
  phase: string
  callId?: string
  toolName?: string
  scope?: GrantScope
  exactPreview?: string
  grants: Grant[]
  history: HistoryRow[]
  historyTruncated?: unknown
}
export function validScope(scope: unknown): scope is GrantScope {
  return (
    object(scope) &&
    object(scope.account) &&
    id(scope.account.id) &&
    id(scope.account.login) &&
    Array.isArray(scope.operations) &&
    scope.operations.length > 0 &&
    scope.operations.length <= 2 &&
    scope.operations.every((op: unknown) => typeof op === 'string' && Object.hasOwn(labels, op)) &&
    Array.isArray(scope.issues) &&
    scope.issues.length > 0 &&
    scope.issues.length <= 50 &&
    scope.issues.every(
      (issue: unknown) =>
        object(issue) &&
        id(issue.id) &&
        id(issue.repositoryId) &&
        id(issue.repositoryOwnerId) &&
        id(issue.nameWithOwner) &&
        typeof issue.issueNumber === 'number' &&
        Number.isSafeInteger(issue.issueNumber) &&
        issue.issueNumber > 0,
    ) &&
    Array.isArray(scope.projects) &&
    scope.projects.length <= 20 &&
    scope.projects.every(
      (project: unknown) =>
        object(project) &&
        id(project.id) &&
        id(project.ownerId) &&
        id(project.owner) &&
        typeof project.projectNumber === 'number' &&
        Number.isSafeInteger(project.projectNumber) &&
        project.projectNumber > 0,
    ) &&
    Array.isArray(scope.memberships) &&
    scope.memberships.length <= 5000 &&
    scope.memberships.every(
      (item: unknown) => object(item) && id(item.id) && id(item.issueId) && id(item.projectId),
    )
  )
}
export function validStatus(value: unknown, callId: string): value is GrantStatus {
  return (
    object(value) &&
    value.version === 1 &&
    id(value.phase) &&
    (value.callId === undefined || value.callId === callId) &&
    (value.toolName === undefined || value.toolName === TOOL) &&
    (value.scope === undefined || validScope(value.scope)) &&
    (value.exactPreview === undefined || typeof value.exactPreview === 'string') &&
    Array.isArray(value.grants) &&
    value.grants.length <= 100 &&
    value.grants.every(
      (grant: unknown) =>
        object(grant) && id(grant.id) && id(grant.state) && validScope(grant.scope),
    ) &&
    Array.isArray(value.history) &&
    value.history.length <= 1000 &&
    value.history.every(
      (row: unknown) => object(row) && id(row.id) && id(row.operation) && id(row.outcome),
    )
  )
}
const phases: Readonly<Record<string, string>> = {
  prepared: 'Verified scope prepared',
  approved: 'Approved — access is not yet confirmed',
  unattempted: 'Not executed',
  preparing: 'Preparing verified scope',
  pending: 'Awaiting approval',
  'awaiting-approval': 'Awaiting approval',
  running: 'Running — access is not yet confirmed',
  active: 'Active access',
  granted: 'Access granted',
  confirmed: 'Grant confirmed',
  denied: 'Denied',
  rejected: 'Denied',
  failed: 'Failed',
  cancelled: 'Cancelled',
  uncertain: 'Outcome uncertain',
  expired: 'Expired — fresh approval required',
  revoked: 'Revoked',
  'renewal-required': 'Renewal required',
  'account-changed': 'Account changed — fresh approval required',
}
export function phaseLabel(phase: string | undefined) {
  return (
    (phase === undefined ? undefined : phases[phase]) ?? 'Status unknown — access is not confirmed'
  )
}
