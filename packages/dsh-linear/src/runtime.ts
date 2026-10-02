import type { LinearClient as Client } from '@linear/sdk'
import type {
  RuntimeOptions,
  LinearSettings,
  SearchIssuesArgs,
  LinearListIssuesArgs,
  CommentsArgs,
  ProjectsArgs,
  CyclesArgs,
  UsersArgs,
} from './contracts.js'
import { LinearClient } from '@linear/sdk'
import { resolveIssueQuery } from './issue-query.js'
import { LinearProjectObservations } from './project-observations.js'
import { pageArgs, paged, paginationOrder } from './pagination.js'
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
  resolveProjectStatuses,
  resolveTeam,
  userCatalog,
} from './resolvers.js'

function messageOf(error: unknown) {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : String(error)
}

function epochIso(value: number) {
  const milliseconds = value > 10_000_000_000 ? value : value * 1000
  return new Date(milliseconds).toISOString()
}

function rateLimitMessage(error: Record<string, unknown>) {
  const details = []
  if (typeof error.retryAfter === 'number' && Number.isFinite(error.retryAfter))
    details.push(`retry after ${error.retryAfter} second(s)`)
  if (typeof error.requestsRemaining === 'number' && Number.isFinite(error.requestsRemaining))
    details.push(`${error.requestsRemaining} request(s) remaining`)
  if (typeof error.requestsResetAt === 'number' && Number.isFinite(error.requestsResetAt))
    details.push(`request budget resets at ${epochIso(error.requestsResetAt)}`)
  if (typeof error.complexityRemaining === 'number' && Number.isFinite(error.complexityRemaining))
    details.push(`${error.complexityRemaining} complexity point(s) remaining`)
  if (typeof error.complexityResetAt === 'number' && Number.isFinite(error.complexityResetAt))
    details.push(`complexity budget resets at ${epochIso(error.complexityResetAt)}`)
  return `Linear rate limit exceeded${details.length === 0 ? '' : `; ${details.join(', ')}`}.`
}

export function publicLinearError(error: unknown, operation = 'request') {
  const details =
    error !== null && typeof error === 'object' ? (error as Record<string, unknown>) : {}
  if (details.type === 'Ratelimited' || details.status === 429)
    return new Error(rateLimitMessage(details))
  if (details.type === 'AuthenticationError' || details.status === 401) {
    return new Error(
      'Linear authentication failed. Reconnect the workspace in Plugins → Linear → Configure.',
    )
  }
  if (details.type === 'Forbidden' || details.status === 403) {
    return new Error(
      `Linear denied access while attempting to ${operation}. Check the API key's workspace permissions.`,
    )
  }
  return new Error(`Linear ${operation} failed: ${messageOf(error)}`)
}

export class LinearRuntime {
  resolveApiKey: RuntimeOptions['resolveApiKey']
  settings: () => LinearSettings
  createClient: (apiKey: string, signal?: AbortSignal) => Client
  maxDescriptionChars: number
  maxCommentChars: number
  projects: LinearProjectObservations
  constructor(options: RuntimeOptions) {
    this.resolveApiKey = options.resolveApiKey
    this.settings = options.settings
    this.createClient =
      options.createClient ??
      ((apiKey, signal) => new LinearClient({ apiKey, ...(signal ? { signal } : {}) }))
    this.maxDescriptionChars = options.maxDescriptionChars ?? 12_000
    this.maxCommentChars = options.maxCommentChars ?? 8_000
    this.projects = new LinearProjectObservations(this)
  }

  configuration() {
    return this.settings()
  }

  async request<T>(operation: string, task: () => T | PromiseLike<T>): Promise<T> {
    try {
      return await task()
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('Linear ') &&
        (!('type' in error) || error.type === undefined)
      )
        throw error
      throw publicLinearError(error, operation)
    }
  }

  async client(signal?: AbortSignal) {
    signal?.throwIfAborted()
    const apiKey = await this.resolveApiKey()
    signal?.throwIfAborted()
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new Error(
        'Linear API key is not configured. Open Plugins → Linear → Configure and connect a workspace.',
      )
    }
    const client = this.createClient(apiKey, signal)
    const organization = await this.request('authentication', () => client.organization)
    signal?.throwIfAborted()
    const config = this.configuration()
    if (text(config.organizationId) !== undefined && organization.id !== config.organizationId) {
      throw new Error(
        `Linear workspace mismatch: this key belongs to “${organization.name}”, but DSH is locked to “${config.organizationName || config.organizationId}”. Reconnect it in Plugins → Linear → Configure.`,
      )
    }
    return { client, organization, config }
  }

  async workspace(signal?: AbortSignal) {
    const { client, organization } = await this.client(signal)
    const [viewer, teamConnection] = await this.request('load workspace', () =>
      Promise.all([client.viewer, client.teams({ first: 100 })]),
    )
    return {
      workspace: publicWorkspace(organization),
      viewer: publicUser(viewer),
      teams: teamConnection.nodes.map(publicTeam),
    }
  }

  async searchIssues(args: SearchIssuesArgs, signal?: AbortSignal) {
    const { client } = await this.client(signal)
    const team =
      text(args.team) === undefined
        ? undefined
        : await this.request('resolve team', () => resolveTeam(client, args.team))
    const connection = await this.request('search issues', () =>
      client.searchIssues(args.query!.trim(), {
        ...pageArgs(args, 10),
        ...(team === undefined ? {} : { teamId: team.id }),
        includeArchived: args.includeArchived === true,
      }),
    )
    const catalogs = await this.request('load issue metadata', () =>
      issueCatalogs(client, connection.nodes),
    )
    const issues = await Promise.all(
      connection.nodes.map((issue) =>
        publicIssue(issue, {
          catalogs,
          maxDescriptionChars: Math.min(this.maxDescriptionChars, 2_000),
        }),
      ),
    )
    return paged(connection, 'issues', issues, { totalCount: connection.totalCount })
  }

  async getIssue(args: { issue: string }, signal?: AbortSignal) {
    const { client } = await this.client(signal)
    const issue = await this.request('load issue', () => client.issue(args.issue.trim()))
    const catalogs = await this.request('load issue metadata', () => issueCatalogs(client, [issue]))
    return publicIssue(issue, { catalogs, maxDescriptionChars: this.maxDescriptionChars })
  }

  async listIssues(args: LinearListIssuesArgs, signal?: AbortSignal) {
    const { client, organization } = await this.client(signal)
    const query = await resolveIssueQuery(client, args, {
      organizationUrlKey: organization.urlKey,
      request: (operation, task) => this.request(operation, task),
    })
    const connection = await this.request('list issues', () => client.issues(query))
    const catalogs = await this.request('load issue metadata', () =>
      issueCatalogs(client, connection.nodes),
    )
    const issues = await Promise.all(
      connection.nodes.map((issue) =>
        publicIssue(issue, {
          catalogs,
          includeDescription: false,
          maxDescriptionChars: this.maxDescriptionChars,
        }),
      ),
    )
    return paged(connection, 'issues', issues)
  }

  async getIssueComments(args: CommentsArgs, signal?: AbortSignal) {
    const { client } = await this.client(signal)
    const issue = await this.request('load issue', () => client.issue(args.issue.trim()))
    const connection = await this.request('load issue comments', () =>
      issue.comments({
        ...pageArgs(args),
        includeArchived: args.includeArchived === true,
        orderBy: paginationOrder(args.orderBy, 'createdAt'),
      }),
    )
    const catalogs = await this.request('load comment authors', () =>
      userCatalog(
        client,
        connection.nodes.map((comment) => comment.userId),
      ),
    )
    const comments = connection.nodes.map((comment) =>
      publicComment(comment, catalogs, this.maxCommentChars),
    )
    return paged(connection, 'comments', comments, { issue: issue.identifier })
  }

  async listProjects(args: ProjectsArgs, signal?: AbortSignal) {
    const { client } = await this.client(signal)
    const [team, statuses] = await Promise.all([
      text(args.team) === undefined
        ? undefined
        : this.request('resolve team', () => resolveTeam(client, args.team)),
      text(args.status) === undefined
        ? []
        : this.request('resolve project status', () => resolveProjectStatuses(client, args.status)),
    ])
    const filter = {
      ...(text(args.query) === undefined
        ? {}
        : { name: { containsIgnoreCase: args.query!.trim() } }),
      ...(statuses.length === 0
        ? {}
        : { status: { id: { in: statuses.map((status) => status.id) } } }),
    }
    const connection = await this.request('list projects', () =>
      (team === undefined ? client : team).projects({
        ...pageArgs(args),
        filter,
        includeArchived: args.includeArchived === true,
        orderBy: paginationOrder(args.orderBy, 'updatedAt'),
      }),
    )
    const catalogs = await this.request('load project metadata', () =>
      projectCatalogs(client, connection.nodes),
    )
    const projects = connection.nodes.map((project) =>
      publicProject(project, {
        maxDescriptionChars: 500,
        lead: catalogs.users.get(project.leadId ?? ''),
        status: catalogs.statuses.get(project.statusId ?? ''),
      }),
    )
    return paged(connection, 'projects', projects)
  }

  async getProject(args: { project: string }, signal?: AbortSignal) {
    const { client, organization } = await this.client(signal)
    const project = await this.projects.resolve(client, organization, args.project)
    return this.request('load project metadata', () => this.projects.snapshot(project))
  }

  async listCycles(args: CyclesArgs, signal?: AbortSignal) {
    const { client } = await this.client(signal)
    const team =
      text(args.team) === undefined
        ? undefined
        : await this.request('resolve team', () => resolveTeam(client, args.team))
    const statusFilter =
      args.status === 'active'
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
    const connection = await this.request('list cycles', () =>
      (team === undefined ? client : team).cycles({
        ...pageArgs(args, 10),
        filter: statusFilter,
        includeArchived: args.includeArchived === true,
        orderBy: paginationOrder(args.orderBy, 'updatedAt'),
      }),
    )
    const teams =
      team === undefined
        ? await this.request('load cycle teams', () =>
            client
              .teams({ first: 100 })
              .then((result) => new Map(result.nodes.map((item) => [item.id, item]))),
          )
        : new Map([[team.id, team]])
    return paged(
      connection,
      'cycles',
      connection.nodes.map((cycle) => publicCycle(cycle, { teams })),
    )
  }

  async listUsers(args: UsersArgs, signal?: AbortSignal) {
    const { client } = await this.client(signal)
    const team =
      text(args.team) === undefined
        ? undefined
        : await this.request('resolve team', () => resolveTeam(client, args.team))
    const filter = {
      ...(text(args.query) === undefined
        ? {}
        : {
            or: [
              { name: { containsIgnoreCase: args.query!.trim() } },
              { displayName: { containsIgnoreCase: args.query!.trim() } },
              { email: { containsIgnoreCase: args.query!.trim() } },
            ],
          }),
      ...(args.active === undefined ? {} : { active: { eq: args.active } }),
    }
    const variables = {
      ...pageArgs(args),
      filter,
      includeDisabled: args.includeDisabled === true,
      orderBy: paginationOrder(args.orderBy, 'updatedAt'),
    }
    const connection = await this.request('list users', () =>
      team === undefined ? client.users(variables) : team.members(variables),
    )
    return paged(connection, 'users', connection.nodes.map(publicUser))
  }
}
