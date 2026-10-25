export type Conventions = {
  workSelection?: string
  workflow?: string
  issueStructure?: string
  development?: string
  agentBoundaries?: string
}
export type ProjectSource =
  | { id: string; kind: 'github-repository'; owner: string; repo: string }
  | { id: string; kind: 'github-project'; owner: string; projectNumber: number }
  | { id: string; kind: 'linear-project'; project: string }
  | { id: string; kind: 'linear-team'; team: string }
export interface TeamDefinition {
  id: string
  name: string
  conventions: Conventions
}
export interface ProjectDefinition {
  id: string
  name: string
  description?: string
  teamId?: string
  conventions: Conventions
  sources: ProjectSource[]
}
export interface ProjectsConfig {
  teams: TeamDefinition[]
  projects: ProjectDefinition[]
}
export interface ProjectView extends ProjectDefinition {
  teamName?: string
  effectiveConventions: Conventions
  conventionOrigins: Partial<Record<keyof Conventions, 'team' | 'project'>>
}
export interface Catalog {
  configuration: ProjectsConfig
  projects: ProjectView[]
  providers: { github: boolean; linear: boolean }
  revision: string
}
export interface IssueRow {
  id: string
  title: string
  identifier: string
  source: 'github' | 'linear'
  kind: 'issue' | 'pull-request' | 'draft'
  url?: string
  status: string
  assignees: string[]
  priority?: string
  boardFields?: string[]
}
export interface IssuesRequest {
  projectId: string
  sourceId: string
  cursor?: string
  limit?: number
}
export interface IssuesPage {
  projectId: string
  sourceId: string
  issues: IssueRow[]
  nextCursor?: string
  hasNextPage: boolean
  warnings: string[]
  untrusted: true
}
export type SourceKind = ProjectSource['kind']
// A source target without its local id; discovery never chooses local identifiers.
export type SourceTarget = ProjectSource extends infer S
  ? S extends ProjectSource
    ? Omit<S, 'id'>
    : never
  : never
export interface SourceCandidate {
  target: SourceTarget
  name: string
  suggestedId: string
  description?: string
  inactive?: boolean
}
export interface DiscoverRequest {
  kind: SourceKind
  owner?: string
  cursor?: string
}
export interface DiscoverPage {
  kind: SourceKind
  owner?: string
  candidates: SourceCandidate[]
  hasNextPage: boolean
  nextCursor?: string
  untrusted: true
}
export interface RpcEndpoints {
  catalog: { input: Record<string, never>; result: Catalog }
  project: { input: { projectId: string }; result: ProjectView }
  issues: { input: IssuesRequest; result: IssuesPage }
  discover: { input: DiscoverRequest; result: DiscoverPage }
  configure: { input: { configuration: ProjectsConfig; expectedRevision: string }; result: Catalog }
}
export type RpcResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: { code: string; message: string; details: object }
    }
export type Request = <E extends keyof RpcEndpoints>(
  endpoint: E,
  input: RpcEndpoints[E]['input'],
  signal?: AbortSignal,
) => Promise<RpcEndpoints[E]['result']>
