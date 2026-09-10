import { LinearClient } from '@linear/sdk'
import { pageArgs, paged } from './pagination.js'
import {
  publicComment,
  publicCycle,
  publicIssue,
  publicProject,
  publicTeam,
  publicUser,
  publicWorkspace,
  text,
} from './projections.js'
import {
  issueCatalogs,
  projectCatalogs,
  resolveCycle,
  resolveLabels,
  resolveProject,
  resolveProjectStatuses,
  resolveStates,
  resolveTeam,
  resolveUser,
  userCatalog,
} from './resolvers.js'

function messageOf(error) {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : String(error)
}

function epochIso(value) {
  const milliseconds = value > 10_000_000_000 ? value : value * 1000
  return new Date(milliseconds).toISOString()
}

function rateLimitMessage(error) {
  const details = []
  if (Number.isFinite(error.retryAfter)) details.push(`retry after ${error.retryAfter} second(s)`)
  if (Number.isFinite(error.requestsRemaining)) details.push(`${error.requestsRemaining} request(s) remaining`)
  if (Number.isFinite(error.requestsResetAt)) details.push(`request budget resets at ${epochIso(error.requestsResetAt)}`)
  if (Number.isFinite(error.complexityRemaining)) details.push(`${error.complexityRemaining} complexity point(s) remaining`)
  if (Number.isFinite(error.complexityResetAt)) details.push(`complexity budget resets at ${epochIso(error.complexityResetAt)}`)
  return `Linear rate limit exceeded${details.length === 0 ? '' : `; ${details.join(', ')}`}.`
}

export function publicLinearError(error, operation = 'request') {
  if (error?.type === 'Ratelimited' || error?.status === 429) return new Error(rateLimitMessage(error))
  if (error?.type === 'AuthenticationError' || error?.status === 401) {
    return new Error('Linear authentication failed. Reconnect the workspace in Settings → Plugins → Plugin configuration → Linear.')
  }
  if (error?.type === 'Forbidden' || error?.status === 403) {
    return new Error(`Linear denied access while attempting to ${operation}. Check the API key's workspace permissions.`)
  }
  return new Error(`Linear ${operation} failed: ${messageOf(error)}`)
}

function isoDate(value, name) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be an ISO date or timestamp`)
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) throw new Error(`${name} must be an ISO date or timestamp`)
  return date.toISOString()
}

function nullableSelector(value) {
  const wanted = text(value)
  return wanted === undefined ? undefined : wanted.toLocaleLowerCase('en-US')
}

async function optional(promise) {
  if (promise === undefined) return undefined
  try {
    return await promise
  } catch {
    return undefined
  }
}

export class LinearRuntime {
  constructor(options) {
    this.resolveApiKey = options.resolveApiKey
    this.settings = options.settings
    this.createClient = options.createClient ?? ((apiKey, signal) => new LinearClient({ apiKey, signal }))
    this.maxDescriptionChars = options.maxDescriptionChars ?? 12_000
    this.maxCommentChars = options.maxCommentChars ?? 8_000
  }

  configuration() {
    return this.settings()
  }

  async request(operation, task) {
    try {
      return await task()
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Linear ') && error.type === undefined) throw error
      throw publicLinearError(error, operation)
    }
  }

  async client(signal) {
    const apiKey = await this.resolveApiKey()
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new Error('Linear API key is not configured. Open Settings → Plugins → Plugin configuration → Linear and connect a workspace.')
    }
    const client = this.createClient(apiKey, signal)
    const organization = await this.request('authentication', () => client.organization)
    const config = this.configuration()
    if (text(config.organizationId) !== undefined && organization.id !== config.organizationId) {
      throw new Error(`Linear workspace mismatch: this key belongs to “${organization.name}”, but DSH is locked to “${config.organizationName || config.organizationId}”. Reconnect it in Settings → Plugins → Plugin configuration → Linear.`)
    }
    return { client, organization, config }
  }

  async workspace(signal) {
    const { client, organization } = await this.client(signal)
    const [viewer, teamConnection] = await this.request('load workspace', () => Promise.all([
      client.viewer,
      client.teams({ first: 100 }),
    ]))
    return {
      workspace: publicWorkspace(organization),
      viewer: publicUser(viewer),
      teams: teamConnection.nodes.map(publicTeam),
    }
  }

  async searchIssues(args, signal) {
    const { client } = await this.client(signal)
    const team = text(args.team) === undefined ? undefined : await this.request('resolve team', () => resolveTeam(client, args.team))
    const connection = await this.request('search issues', () => client.searchIssues(args.query.trim(), {
      ...pageArgs(args, 10),
      ...(team === undefined ? {} : { teamId: team.id }),
      includeArchived: args.includeArchived === true,
    }))
    const catalogs = await this.request('load issue metadata', () => issueCatalogs(client, connection.nodes))
    const issues = await Promise.all(connection.nodes.map((issue) => publicIssue(issue, {
      catalogs,
      maxDescriptionChars: Math.min(this.maxDescriptionChars, 2_000),
    })))
    return paged(connection, 'issues', issues, { totalCount: connection.totalCount })
  }

  async getIssue(args, signal) {
    const { client } = await this.client(signal)
    const issue = await this.request('load issue', () => client.issue(args.issue.trim()))
    const catalogs = await this.request('load issue metadata', () => issueCatalogs(client, [issue]))
    return publicIssue(issue, { catalogs, maxDescriptionChars: this.maxDescriptionChars })
  }

  async listIssues(args, signal) {
    const { client, organization } = await this.client(signal)
    const team = text(args.team) === undefined ? undefined : await this.request('resolve team', () => resolveTeam(client, args.team))
    if (Array.isArray(args.states) && args.states.length > 0 && team === undefined) {
      throw new Error('Linear team is required when filtering issues by state name or type.')
    }
    const assigneeMode = nullableSelector(args.assignee)
    const projectMode = nullableSelector(args.project)
    const cycleMode = nullableSelector(args.cycle)
    const [states, assignee, project, cycle, labels] = await Promise.all([
      !Array.isArray(args.states) || args.states.length === 0
        ? []
        : this.request('resolve states', () => resolveStates(client, args.states, team)),
      assigneeMode === undefined || assigneeMode === 'unassigned'
        ? undefined
        : this.request('resolve assignee', () => resolveUser(client, args.assignee)),
      projectMode === undefined || projectMode === 'none'
        ? undefined
        : this.request('resolve project', () => resolveProject(client, args.project, { organizationUrlKey: organization.urlKey })),
      cycleMode === undefined || cycleMode === 'none'
        ? undefined
        : this.request('resolve cycle', () => resolveCycle(client, args.cycle, team)),
      this.request('resolve labels', () => resolveLabels(client, args.labels)),
    ])
    const filter = {
      ...(team === undefined ? {} : { team: { id: { eq: team.id } } }),
      ...(states.length === 0 ? {} : { state: { id: { in: states.map((state) => state.id) } } }),
      ...(assigneeMode === undefined ? {} : {
        assignee: assigneeMode === 'unassigned' ? { null: true } : { id: { eq: assignee.id } },
      }),
      ...(Array.isArray(args.priorities) && args.priorities.length > 0
        ? { priority: { in: args.priorities } }
        : {}),
      ...(projectMode === undefined ? {} : {
        project: projectMode === 'none' ? { null: true } : { id: { eq: project.id } },
      }),
      ...(cycleMode === undefined ? {} : {
        cycle: cycleMode === 'none' ? { null: true } : { id: { eq: cycle.id } },
      }),
      ...(labels.length === 0 ? {} : { labels: { some: { id: { in: labels.map((label) => label.id) } } } }),
      ...(args.updatedAfter === undefined ? {} : { updatedAt: { gte: isoDate(args.updatedAfter, 'updatedAfter') } }),
      ...(args.createdAfter === undefined ? {} : { createdAt: { gte: isoDate(args.createdAfter, 'createdAfter') } }),
    }
    const connection = await this.request('list issues', () => client.issues({
      ...pageArgs(args),
      filter,
      includeArchived: args.includeArchived === true,
      orderBy: args.orderBy ?? 'updatedAt',
    }))
    const catalogs = await this.request('load issue metadata', () => issueCatalogs(client, connection.nodes))
    const issues = await Promise.all(connection.nodes.map((issue) => publicIssue(issue, {
      catalogs,
      includeDescription: false,
      maxDescriptionChars: this.maxDescriptionChars,
    })))
    return paged(connection, 'issues', issues)
  }

  async getIssueComments(args, signal) {
    const { client } = await this.client(signal)
    const issue = await this.request('load issue', () => client.issue(args.issue.trim()))
    const connection = await this.request('load issue comments', () => issue.comments({
      ...pageArgs(args),
      includeArchived: args.includeArchived === true,
      orderBy: args.orderBy ?? 'createdAt',
    }))
    const catalogs = await this.request('load comment authors', () => userCatalog(client, connection.nodes.map((comment) => comment.userId)))
    const comments = connection.nodes.map((comment) => publicComment(comment, catalogs, this.maxCommentChars))
    return paged(connection, 'comments', comments, { issue: issue.identifier })
  }

  async listProjects(args, signal) {
    const { client } = await this.client(signal)
    const [team, statuses] = await Promise.all([
      text(args.team) === undefined ? undefined : this.request('resolve team', () => resolveTeam(client, args.team)),
      text(args.status) === undefined ? [] : this.request('resolve project status', () => resolveProjectStatuses(client, args.status)),
    ])
    const filter = {
      ...(text(args.query) === undefined ? {} : { name: { containsIgnoreCase: args.query.trim() } }),
      ...(statuses.length === 0 ? {} : { status: { id: { in: statuses.map((status) => status.id) } } }),
    }
    const connection = await this.request('list projects', () => (team === undefined ? client : team).projects({
      ...pageArgs(args),
      filter,
      includeArchived: args.includeArchived === true,
      orderBy: args.orderBy ?? 'updatedAt',
    }))
    const catalogs = await this.request('load project metadata', () => projectCatalogs(client, connection.nodes))
    const projects = connection.nodes.map((project) => publicProject(project, {
      maxDescriptionChars: 500,
      lead: catalogs.users.get(project.leadId),
      status: catalogs.statuses.get(project.statusId),
    }))
    return paged(connection, 'projects', projects)
  }

  async getProject(args, signal) {
    const { client, organization } = await this.client(signal)
    const project = await this.request('resolve project', () => resolveProject(client, args.project, { organizationUrlKey: organization.urlKey }))
    const [lead, status, teams] = await this.request('load project metadata', () => Promise.all([
      optional(project.lead),
      optional(project.status),
      project.teams({ first: 50 }).then((connection) => connection.nodes),
    ]))
    return publicProject(project, {
      maxDescriptionChars: this.maxDescriptionChars,
      includeContent: true,
      lead,
      status,
      teams,
    })
  }

  async listCycles(args, signal) {
    const { client } = await this.client(signal)
    const team = text(args.team) === undefined ? undefined : await this.request('resolve team', () => resolveTeam(client, args.team))
    const statusFilter = args.status === 'active'
      ? { isActive: { eq: true } }
      : args.status === 'future'
        ? { isFuture: { eq: true } }
        : args.status === 'past'
          ? { isPast: { eq: true } }
          : args.status === 'next'
            ? { isNext: { eq: true } }
            : args.status === 'previous'
              ? { isPrevious: { eq: true } }
              : {}
    const connection = await this.request('list cycles', () => (team === undefined ? client : team).cycles({
      ...pageArgs(args, 10),
      filter: statusFilter,
      includeArchived: args.includeArchived === true,
      orderBy: args.orderBy ?? 'updatedAt',
    }))
    const teams = team === undefined
      ? await this.request('load cycle teams', () => client.teams({ first: 100 }).then((result) => new Map(result.nodes.map((item) => [item.id, item]))))
      : new Map([[team.id, team]])
    return paged(connection, 'cycles', connection.nodes.map((cycle) => publicCycle(cycle, { teams })))
  }

  async listUsers(args, signal) {
    const { client } = await this.client(signal)
    const team = text(args.team) === undefined ? undefined : await this.request('resolve team', () => resolveTeam(client, args.team))
    const filter = {
      ...(text(args.query) === undefined ? {} : {
        or: [
          { name: { containsIgnoreCase: args.query.trim() } },
          { displayName: { containsIgnoreCase: args.query.trim() } },
          { email: { containsIgnoreCase: args.query.trim() } },
        ],
      }),
      ...(args.active === undefined ? {} : { active: { eq: args.active } }),
    }
    const variables = {
      ...pageArgs(args),
      filter,
      includeDisabled: args.includeDisabled === true,
      orderBy: args.orderBy ?? 'updatedAt',
    }
    const connection = await this.request('list users', () => team === undefined
      ? client.users(variables)
      : team.members(variables))
    return paged(connection, 'users', connection.nodes.map(publicUser))
  }
}
