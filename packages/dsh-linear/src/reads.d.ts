export interface LinearReadOptions {
  signal?: AbortSignal
}
export interface LinearListIssuesArgs {
  team?: string
  states?: string[]
  assignee?: string
  priorities?: number[]
  project?: string
  cycle?: string
  labels?: string[]
  updatedAfter?: string
  createdAfter?: string
  orderBy?: 'updatedAt' | 'createdAt'
  limit?: number
  cursor?: string
  includeArchived?: boolean
}
/** Provider text is untrusted. Additional projected fields must be narrowed by consumers. */
export interface LinearIssueRead extends Record<string, unknown> {
  id: string
  identifier: string
  title: string
  url: string
}
export interface LinearProjectRead extends Record<string, unknown> {
  id: string
  name: string
  url: string
  slugId: string
}
export interface LinearIssuePage {
  issues: LinearIssueRead[]
  pageInfo: { hasNextPage: boolean; nextCursor?: string }
}
export interface LinearReads {
  listIssues(args?: LinearListIssuesArgs, options?: LinearReadOptions): Promise<LinearIssuePage>
  getIssue(args: { issue: string }, options?: LinearReadOptions): Promise<LinearIssueRead>
  getProject(args: { project: string }, options?: LinearReadOptions): Promise<LinearProjectRead>
}
export interface LinearReadRuntime {
  listIssues(args: LinearListIssuesArgs, signal: AbortSignal): Promise<LinearIssuePage>
  getIssue(args: { issue: string }, signal: AbortSignal): Promise<LinearIssueRead>
  getProject(args: { project: string }, signal: AbortSignal): Promise<LinearProjectRead>
}
export const LINEAR_READ_SERVICE: 'localLinearReads'
export class LinearReadError extends Error {
  code: 'INVALID_ARGUMENT' | 'CANCELLED' | 'TIMEOUT' | 'READ_FAILED'
  constructor(code: LinearReadError['code'])
}
export function createLinearReads(
  runtime: LinearReadRuntime,
  options?: { timeoutMs?: number },
): {
  service: Readonly<LinearReads>
  dispose(): void
}
export function mountLinearReads(
  ctx: {
    effect(callback: () => () => void): unknown
    provide(name: string, service: Readonly<LinearReads>): unknown
  },
  runtime: LinearReadRuntime,
  config?: { timeoutMs?: number },
): Readonly<LinearReads>
