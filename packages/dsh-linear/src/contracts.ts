import type {
  LinearClient,
  Team,
  User,
  WorkflowState,
  Project,
  Cycle,
  IssueLabel,
  ProjectStatus,
  Issue,
} from '@linear/sdk'
import type { InferValue } from '@deepseek-ai/dsh-tools'
import type { ISSUE_SCHEMA, PROJECT_SCHEMA, PROJECT_UPDATE_SCHEMA } from './tools/schemas.js'

export interface LinearSettings {
  organizationId: string
  organizationName: string
  organizationUrlKey: string
}
export interface PageArgs {
  limit?: number
  cursor?: string
}
export interface ListArgs extends PageArgs {
  team?: string
  orderBy?: 'updatedAt' | 'createdAt'
  includeArchived?: boolean
}
export interface LinearListIssuesArgs extends ListArgs {
  states?: string[]
  assignee?: string
  priorities?: number[]
  project?: string
  cycle?: string
  labels?: string[]
  updatedAfter?: string
  createdAfter?: string
}
export interface SearchIssuesArgs extends ListArgs {
  query: string
}
export interface CommentsArgs extends ListArgs {
  issue: string
}
export interface ProjectsArgs extends ListArgs {
  query?: string
  status?: string
}
export interface CyclesArgs extends ListArgs {
  status?: 'all' | 'active' | 'future' | 'past' | 'next' | 'previous'
}
export interface UsersArgs extends ListArgs {
  query?: string
  active?: boolean
  includeDisabled?: boolean
}
export type LinearIssueRead = InferValue<typeof ISSUE_SCHEMA>
export type LinearProjectRead = InferValue<typeof PROJECT_SCHEMA>
export type ProjectUpdateRead = InferValue<typeof PROJECT_UPDATE_SCHEMA>
export interface Catalogs {
  teams?: Map<string, Team> | undefined
  states?: Map<string, WorkflowState> | undefined
  users?: Map<string, User> | undefined
  projects?: Map<string, Project> | undefined
  cycles?: Map<string, Cycle> | undefined
  labels?: Map<string, IssueLabel> | undefined
}
export interface ProjectOptions {
  maxDescriptionChars?: number
  includeContent?: boolean
  lead?: User | undefined
  status?: ProjectStatus | undefined
  teams?: Team[] | undefined
}
export interface IssueOptions {
  catalogs?: Catalogs
  includeDescription?: boolean
  maxDescriptionChars?: number
}
export interface RuntimeOptions {
  resolveApiKey(): Promise<unknown>
  settings(): LinearSettings
  createClient?: (apiKey: string, signal?: AbortSignal) => LinearClient
  maxDescriptionChars?: number
  maxCommentChars?: number
}
export type Request = <T>(operation: string, task: () => T | PromiseLike<T>) => Promise<T>
export type IssueIdFields = Pick<
  Issue,
  'teamId' | 'stateId' | 'assigneeId' | 'projectId' | 'cycleId' | 'labelIds'
>
export type ClearField = 'description' | 'content' | 'lead' | 'startDate' | 'targetDate'
export interface ProjectFields {
  name?: string
  description?: string
  content?: string
  status?: string
  lead?: string
  priority?: number
  startDate?: string
  targetDate?: string
  teams?: string[]
}
export interface CreateProjectArgs extends ProjectFields {
  name: string
  teams: string[]
}
export interface UpdateProjectArgs extends ProjectFields {
  project: string
  expectedUpdatedAt?: string
  clearFields?: ClearField[]
}
export interface ProjectUpdateArgs {
  project: string
  health: 'onTrack' | 'atRisk' | 'offTrack'
  body: string
}
export interface ProjectInput {
  name?: string
  description?: string | null
  content?: string | null
  statusId?: string
  leadId?: string | null
  priority?: number
  startDate?: string | null
  targetDate?: string | null
  teamIds?: string[]
}
interface PreparedBase {
  workspaceId: string
  reason: string
}
export interface PreparedCreate extends PreparedBase {
  kind: 'create-project'
  input: ProjectInput & { name: string; teamIds: string[] }
  approvedDuplicateIds: string[]
  projectId?: never
}
export interface PreparedUpdate extends PreparedBase {
  kind: 'update-project'
  input: ProjectInput
  projectId: string
  expectedUpdatedAt: string
  approvedDuplicateIds: string[]
}
export interface PreparedReport extends PreparedBase {
  kind: 'create-project-update'
  projectId: string
  expectedUpdatedAt: string
  input: { projectId: string; body: string; health: 'onTrack' | 'atRisk' | 'offTrack' }
}
export type PreparedWrite = PreparedCreate | PreparedUpdate | PreparedReport
