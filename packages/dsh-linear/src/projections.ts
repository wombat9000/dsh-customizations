import type {
  Organization,
  Team,
  User,
  WorkflowState,
  IssueLabel,
  Cycle,
  Project,
  Comment,
  Issue,
  IssueSearchResult,
} from '@linear/sdk'
import type {
  Catalogs,
  ProjectOptions,
  IssueOptions,
  LinearIssueRead,
  LinearProjectRead,
} from './contracts.js'
export const PRIORITY_LABELS = Object.freeze<Record<number, string>>({
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
})

export function text(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function iso(value: Date | string | number): string
function iso(value: Date | string | number | null | undefined): string | undefined
function iso(value: Date | string | number | null | undefined) {
  return value == null ? undefined : new Date(value).toISOString()
}

function present<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}

export function publicWorkspace(organization: Organization) {
  return { id: organization.id, name: organization.name, urlKey: organization.urlKey }
}

export function publicTeam(team: Team) {
  return { id: team.id, key: team.key, name: team.name, private: team.private === true }
}

export function publicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    ...present('displayName', text(user.displayName)),
    ...present('email', text(user.email)),
    ...present('active', typeof user.active === 'boolean' ? user.active : undefined),
    ...present('isMe', typeof user.isMe === 'boolean' ? user.isMe : undefined),
    ...present('url', text(user.url)),
  }
}

export function publicState(state: WorkflowState) {
  return {
    id: state.id,
    name: state.name,
    type: state.type,
    ...present('color', text(state.color)),
  }
}

export function publicLabel(label: IssueLabel) {
  return {
    id: label.id,
    name: label.name,
    ...present('color', text(label.color)),
    ...present('description', text(label.description)),
  }
}

export function publicCycle(cycle: Cycle, catalogs: Catalogs = {}) {
  const team = catalogs.teams?.get(cycle.teamId ?? '')
  return {
    id: cycle.id,
    number: cycle.number,
    ...present('name', text(cycle.name)),
    ...present('description', text(cycle.description)),
    ...present('teamId', cycle.teamId),
    ...(team === undefined ? {} : { team: publicTeam(team) }),
    isActive: cycle.isActive === true,
    isFuture: cycle.isFuture === true,
    isPast: cycle.isPast === true,
    isPrevious: cycle.isPrevious === true,
    isNext: cycle.isNext === true,
    progress: cycle.progress,
    startsAt: iso(cycle.startsAt),
    endsAt: iso(cycle.endsAt),
    updatedAt: iso(cycle.updatedAt),
  }
}

export function publicProject(
  project: Project,
  options: ProjectOptions & { teams: Team[] },
): LinearProjectRead & { teams: NonNullable<LinearProjectRead['teams']> }
export function publicProject(project: Project, options?: ProjectOptions): LinearProjectRead
export function publicProject(project: Project, options: ProjectOptions = {}): LinearProjectRead {
  const maxDescriptionChars = options.maxDescriptionChars ?? 12_000
  const description =
    typeof project.description === 'string'
      ? project.description.slice(0, maxDescriptionChars)
      : undefined
  const content =
    options.includeContent === true && typeof project.content === 'string'
      ? project.content.slice(0, maxDescriptionChars)
      : undefined
  return {
    id: project.id,
    name: project.name,
    ...present('description', description),
    ...present('content', content),
    url: project.url,
    slugId: project.slugId,
    priority: project.priority,
    priorityLabel:
      project.priorityLabel ?? PRIORITY_LABELS[project.priority] ?? String(project.priority),
    progress: project.progress,
    ...present('health', project.health ?? undefined),
    ...present('state', text(project.state)),
    ...present('leadId', project.leadId),
    ...present('statusId', project.statusId),
    ...(options.lead === undefined ? {} : { lead: publicUser(options.lead) }),
    ...(options.status === undefined
      ? {}
      : {
          status: { id: options.status.id, name: options.status.name, type: options.status.type },
        }),
    ...(options.teams === undefined ? {} : { teams: options.teams.map(publicTeam) }),
    ...present('startDate', project.startDate == null ? undefined : String(project.startDate)),
    ...present('targetDate', project.targetDate == null ? undefined : String(project.targetDate)),
    createdAt: iso(project.createdAt),
    updatedAt: iso(project.updatedAt),
  }
}

export function publicComment(comment: Comment, catalogs: Catalogs = {}, maxBodyChars = 8_000) {
  const author = catalogs.users?.get(comment.userId ?? '')
  return {
    id: comment.id,
    body: String(comment.body ?? '').slice(0, maxBodyChars),
    url: comment.url,
    ...present('issueId', comment.issueId ?? undefined),
    ...present('parentId', comment.parentId ?? undefined),
    ...present('userId', comment.userId),
    ...(author === undefined ? {} : { author: publicUser(author) }),
    ...present('editedAt', iso(comment.editedAt)),
    ...present('resolvedAt', iso(comment.resolvedAt)),
    createdAt: iso(comment.createdAt),
    updatedAt: iso(comment.updatedAt),
  }
}

export async function publicIssue(
  issue: Issue | IssueSearchResult,
  options: IssueOptions = {},
): Promise<LinearIssueRead> {
  const catalogs = options.catalogs ?? {}
  const state = catalogs.states?.get(issue.stateId ?? '')
  const team = catalogs.teams?.get(issue.teamId ?? '')
  const assignee = catalogs.users?.get(issue.assigneeId ?? '')
  const project = catalogs.projects?.get(issue.projectId ?? '')
  const cycle = catalogs.cycles?.get(issue.cycleId ?? '')
  const labels = Array.isArray(issue.labelIds)
    ? issue.labelIds
        .map((id) => catalogs.labels?.get(id))
        .filter((label): label is IssueLabel => label !== undefined)
        .map(publicLabel)
    : []
  const maxDescriptionChars = options.maxDescriptionChars ?? 12_000
  const description =
    options.includeDescription === false || typeof issue.description !== 'string'
      ? undefined
      : issue.description.slice(0, maxDescriptionChars)
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    ...present('description', description),
    url: issue.url,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel ?? PRIORITY_LABELS[issue.priority] ?? String(issue.priority),
    ...present('teamId', issue.teamId),
    ...present('stateId', issue.stateId),
    ...present('assigneeId', issue.assigneeId),
    ...present('projectId', issue.projectId),
    ...present('cycleId', issue.cycleId),
    ...(Array.isArray(issue.labelIds) ? { labelIds: [...issue.labelIds] } : {}),
    ...present('dueDate', issue.dueDate == null ? undefined : String(issue.dueDate)),
    ...(state === undefined ? {} : { state: publicState(state) }),
    ...(team === undefined ? {} : { team: publicTeam(team) }),
    ...(assignee === undefined ? {} : { assignee: publicUser(assignee) }),
    ...(project === undefined
      ? {}
      : { project: publicProject(project, { maxDescriptionChars: 500 }) }),
    ...(cycle === undefined ? {} : { cycle: publicCycle(cycle, catalogs) }),
    ...(labels.length === 0 ? {} : { labels }),
    createdAt: iso(issue.createdAt),
    updatedAt: iso(issue.updatedAt),
  }
}
