export interface GitHubReadOptions {
  signal?: AbortSignal
  /** Trusted host override in the managed execution world; defaults to '/'. */
  cwd?: string
}
export interface GitHubRepositoryTarget {
  owner: string
  repo: string
}
export interface GitHubProjectTarget {
  owner: string
  projectNumber: number
}
export interface GitHubPage {
  limit?: number
  cursor?: string
}
export interface GitHubListIssuesArgs extends GitHubRepositoryTarget, GitHubPage {
  state?: 'open' | 'closed' | 'all'
  labels?: string[]
  assignee?: string
}
export interface GitHubGetIssueArgs extends GitHubRepositoryTarget {
  issueNumber: number
  limit?: number
  labelsCursor?: string
  assigneesCursor?: string
  subIssuesCursor?: string
  blockedByCursor?: string
  blockingCursor?: string
}
export interface GitHubGetProjectArgs extends GitHubProjectTarget {
  limit?: number
  fieldsCursor?: string
  repositoriesCursor?: string
}
export interface GitHubListProjectItemsArgs extends GitHubProjectTarget, GitHubPage {
  itemId?: string
  fieldValuesLimit?: number
  fieldValuesCursor?: string
  nestedLimit?: number
  valueCursor?: string
}
/** Provider text is untrusted. Consumers narrow native entity fields before use. */
export interface GitHubReadResult {
  host: 'github.com'
  untrusted: true
  data: Record<string, unknown>
  truncated: boolean
  truncations: Array<Record<string, unknown>>
}
export interface GitHubReads {
  listIssues(args: GitHubListIssuesArgs, options?: GitHubReadOptions): Promise<GitHubReadResult>
  getIssue(args: GitHubGetIssueArgs, options?: GitHubReadOptions): Promise<GitHubReadResult>
  getProject(args: GitHubGetProjectArgs, options?: GitHubReadOptions): Promise<GitHubReadResult>
  listProjectItems(
    args: GitHubListProjectItemsArgs,
    options?: GitHubReadOptions,
  ): Promise<GitHubReadResult>
}
export const GITHUB_READ_SERVICE: 'localGitHubReads'
export function createGitHubReads(
  runtime: GitHubReads,
  options?: { cwd?: string },
): {
  service: Readonly<GitHubReads>
  dispose(): void
}
export function mountGitHubReads(
  ctx: {
    effect(callback: () => () => void): unknown
    provide(name: string, service: Readonly<GitHubReads>): unknown
  },
  runtime: GitHubReads,
): Readonly<GitHubReads>
