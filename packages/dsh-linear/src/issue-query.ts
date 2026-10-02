import type { LinearClient } from '@linear/sdk'
import type { LinearListIssuesArgs, Request } from './contracts.js'
import { pageArgs, paginationOrder } from './pagination.js'
import { text } from './projections.js'
import {
  resolveCycle,
  resolveLabels,
  resolveProject,
  resolveStates,
  resolveTeam,
  resolveUser,
} from './resolvers.js'

function isoDate(value: unknown, name: string) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${name} must be an ISO date or timestamp`)
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) throw new Error(`${name} must be an ISO date or timestamp`)
  return date.toISOString()
}

function nullableSelector(value: unknown) {
  const wanted = text(value)
  return wanted === undefined ? undefined : wanted.toLocaleLowerCase('en-US')
}

export async function resolveIssueQuery(
  client: LinearClient,
  args: LinearListIssuesArgs,
  { organizationUrlKey, request }: { organizationUrlKey: string; request: Request },
) {
  const team =
    text(args.team) === undefined
      ? undefined
      : await request('resolve team', () => resolveTeam(client, args.team))
  if (Array.isArray(args.states) && args.states.length > 0 && team === undefined) {
    throw new Error('Linear team is required when filtering issues by state name or type.')
  }
  const assigneeMode = nullableSelector(args.assignee)
  const projectMode = nullableSelector(args.project)
  const cycleMode = nullableSelector(args.cycle)
  const [states, assignee, project, cycle, labels] = await Promise.all([
    !Array.isArray(args.states) || args.states.length === 0
      ? []
      : request('resolve states', () => resolveStates(client, args.states, team)),
    assigneeMode === undefined || assigneeMode === 'unassigned'
      ? undefined
      : request('resolve assignee', () => resolveUser(client, args.assignee)),
    projectMode === undefined || projectMode === 'none'
      ? undefined
      : request('resolve project', () =>
          resolveProject(client, args.project, { organizationUrlKey }),
        ),
    cycleMode === undefined || cycleMode === 'none'
      ? undefined
      : request('resolve cycle', () => resolveCycle(client, args.cycle, team)),
    request('resolve labels', () => resolveLabels(client, args.labels)),
  ])
  const filter = {
    ...(team === undefined ? {} : { team: { id: { eq: team.id } } }),
    ...(states.length === 0 ? {} : { state: { id: { in: states.map((state) => state.id) } } }),
    ...(assigneeMode === undefined
      ? {}
      : {
          assignee: assigneeMode === 'unassigned' ? { null: true } : { id: { eq: assignee!.id } },
        }),
    ...(Array.isArray(args.priorities) && args.priorities.length > 0
      ? { priority: { in: args.priorities } }
      : {}),
    ...(projectMode === undefined
      ? {}
      : {
          project: projectMode === 'none' ? { null: true } : { id: { eq: project!.id } },
        }),
    ...(cycleMode === undefined
      ? {}
      : {
          cycle: cycleMode === 'none' ? { null: true } : { id: { eq: cycle!.id } },
        }),
    ...(labels.length === 0
      ? {}
      : { labels: { some: { id: { in: labels.map((label) => label.id) } } } }),
    ...(args.updatedAfter === undefined
      ? {}
      : { updatedAt: { gte: isoDate(args.updatedAfter, 'updatedAfter')! } }),
    ...(args.createdAfter === undefined
      ? {}
      : { createdAt: { gte: isoDate(args.createdAfter, 'createdAfter')! } }),
  }
  // Pagination errors retain the listing operation's error boundary; date errors do not.
  return request('list issues', () => ({
    ...pageArgs(args),
    filter,
    includeArchived: args.includeArchived === true,
    orderBy: paginationOrder(args.orderBy, 'updatedAt'),
  }))
}
