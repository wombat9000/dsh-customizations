import { defineTool } from '@deepseek-ai/dsh-tools'
import { CYCLE_SCHEMA, PAGE_INFO_SCHEMA, PAGE_PARAMETERS, PROJECT_SCHEMA, USER_SCHEMA } from './schemas.js'

function more(value) {
  return value.pageInfo.hasNextPage ? '\nMore results are available; pass nextCursor as cursor.' : ''
}

function nonempty(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`)
}

export function registerCatalogTools(ctx, runtime, config) {
  ctx.tools.register(defineTool({
    name: 'linear_list_projects',
    description: 'List and discover Linear projects, optionally scoped to a team and filtered by name or project status.',
    parameters: {
      team: { type: 'string', description: 'Optional team ID, key, or exact name.' },
      query: { type: 'string', description: 'Case-insensitive project-name fragment.' },
      status: { type: 'string', description: 'Optional project status ID, exact name, or type.' },
      orderBy: { type: 'string', enum: ['updatedAt', 'createdAt'], description: 'Pagination order. Defaults to updatedAt.' },
      ...PAGE_PARAMETERS,
      includeArchived: { type: 'boolean', description: 'Whether archived projects may be returned.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          projects: { type: 'array', required: true, items: PROJECT_SCHEMA },
          pageInfo: PAGE_INFO_SCHEMA,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.projects.length === 0
          ? 'No Linear projects found.'
          : `${value.projects.map((project) => `- [${project.name}](${project.url}) · ${project.status?.name ?? project.state ?? 'Unknown'} · ${Math.round(project.progress * 100)}% · selector: ${project.id}`).join('\n')}${more(value)}`,
      }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    execute: (args, exec) => runtime.listProjects(args, exec.signal),
    presentCall: () => ({ card: 'generic', title: 'Linear projects', kind: 'search' }),
  }))

  ctx.tools.register(defineTool({
    name: 'linear_get_project',
    description: 'Get detailed read-only information for one Linear project by UUID, API slug ID, exact name, full project URL, or browser-visible project slug.',
    parameters: { project: { type: 'string', required: true, description: 'Project UUID, API slug ID, exact name, full linear.app project URL, or browser-visible project path slug.' } },
    output: {
      schema: PROJECT_SCHEMA,
      render: (_args, project) => [{
        type: 'text',
        text: [
          `[${project.name}](${project.url})`,
          `Status: ${project.status?.name ?? project.state ?? 'Unknown'}`,
          `Progress: ${Math.round(project.progress * 100)}%`,
          ...(project.lead === undefined ? [] : [`Lead: ${project.lead.name}`]),
          ...(project.targetDate === undefined ? [] : [`Target: ${project.targetDate}`]),
          ...(project.description ? ['', project.description] : []),
          ...(project.content ? ['', project.content] : []),
        ].join('\n'),
      }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    execute: (args, exec) => {
      nonempty(args.project, 'project')
      return runtime.getProject(args, exec.signal)
    },
    presentCall: (args) => ({ card: 'generic', title: args.project, kind: 'search' }),
  }))

  ctx.tools.register(defineTool({
    name: 'linear_list_cycles',
    description: 'List Linear cycles across the workspace or for one team, including active, future, past, next, and previous views.',
    parameters: {
      team: { type: 'string', description: 'Optional team ID, key, or exact name.' },
      status: { type: 'string', enum: ['all', 'active', 'future', 'past', 'next', 'previous'], description: 'Cycle view. Defaults to all.' },
      orderBy: { type: 'string', enum: ['updatedAt', 'createdAt'], description: 'Pagination order. Defaults to updatedAt.' },
      ...PAGE_PARAMETERS,
      includeArchived: { type: 'boolean', description: 'Whether archived cycles may be returned.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          cycles: { type: 'array', required: true, items: CYCLE_SCHEMA },
          pageInfo: PAGE_INFO_SCHEMA,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.cycles.length === 0
          ? 'No Linear cycles found.'
          : `${value.cycles.map((cycle) => `- ${cycle.team?.key ?? cycle.teamId ?? 'Team'} cycle ${cycle.number}${cycle.name ? ` — ${cycle.name}` : ''} · ${Math.round(cycle.progress * 100)}%${cycle.isActive ? ' · active' : ''}`).join('\n')}${more(value)}`,
      }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    execute: (args, exec) => runtime.listCycles({ ...args, status: args.status ?? 'all' }, exec.signal),
    presentCall: () => ({ card: 'generic', title: 'Linear cycles', kind: 'search' }),
  }))

  ctx.tools.register(defineTool({
    name: 'linear_list_users',
    description: 'List or find users in the connected Linear workspace or one team for assignee discovery.',
    parameters: {
      query: { type: 'string', description: 'Case-insensitive name, display-name, or email fragment.' },
      team: { type: 'string', description: 'Optional team ID, key, or exact name.' },
      active: { type: 'boolean', description: 'Filter by active account status.' },
      includeDisabled: { type: 'boolean', description: 'Whether disabled users may be returned.' },
      orderBy: { type: 'string', enum: ['updatedAt', 'createdAt'], description: 'Pagination order. Defaults to updatedAt.' },
      ...PAGE_PARAMETERS,
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          users: { type: 'array', required: true, items: USER_SCHEMA },
          pageInfo: PAGE_INFO_SCHEMA,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.users.length === 0
          ? 'No Linear users found.'
          : `${value.users.map((user) => `- ${user.name}${user.email ? ` — ${user.email}` : ''}${user.isMe ? ' (you)' : ''}${user.active === false ? ' (disabled)' : ''}`).join('\n')}${more(value)}`,
      }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    execute: (args, exec) => runtime.listUsers(args, exec.signal),
    presentCall: () => ({ card: 'generic', title: 'Linear users', kind: 'search' }),
  }))
}
