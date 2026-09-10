import { defineTool } from '@deepseek-ai/dsh-tools'
import { COMMENT_SCHEMA, ISSUE_SCHEMA, PAGE_INFO_SCHEMA, PAGE_PARAMETERS } from './schemas.js'

function issueLine(issue) {
  const state = issue.state?.name === undefined ? '' : ` · ${issue.state.name}`
  const assignee = issue.assignee?.name === undefined ? '' : ` · ${issue.assignee.name}`
  return `- [${issue.identifier}](${issue.url}) — ${issue.title}${state}${assignee}`
}

function renderIssue(issue) {
  const lines = [`[${issue.identifier}](${issue.url}) — ${issue.title}`, `Priority: ${issue.priorityLabel}`]
  if (issue.state !== undefined) lines.push(`State: ${issue.state.name}`)
  if (issue.team !== undefined) lines.push(`Team: ${issue.team.key} — ${issue.team.name}`)
  if (issue.assignee !== undefined) lines.push(`Assignee: ${issue.assignee.name}`)
  if (issue.project !== undefined) lines.push(`Project: ${issue.project.name}`)
  if (issue.cycle !== undefined) lines.push(`Cycle: ${issue.cycle.name ?? issue.cycle.number}`)
  if (issue.labels?.length > 0) lines.push(`Labels: ${issue.labels.map((label) => label.name).join(', ')}`)
  if (issue.dueDate !== undefined) lines.push(`Due: ${issue.dueDate}`)
  if (issue.description !== undefined && issue.description.length > 0) lines.push('', issue.description)
  return lines.join('\n')
}

function renderPage(value, key, empty, heading) {
  const items = value[key]
  if (items.length === 0) return empty
  const suffix = value.pageInfo.hasNextPage ? '\nMore results are available; pass nextCursor as cursor.' : ''
  return `${heading}\n${items.map(issueLine).join('\n')}${suffix}`
}

function nonempty(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`)
}

export function registerIssueTools(ctx, runtime, config) {
  ctx.tools.register(defineTool({
    name: 'linear_search_issues',
    description: 'Full-text search issues in the connected Linear workspace. Use linear_list_issues for structured filters.',
    parameters: {
      query: { type: 'string', required: true, description: 'Non-empty issue search text.' },
      team: { type: 'string', description: 'Optional team ID, key, or exact name.' },
      ...PAGE_PARAMETERS,
      includeArchived: { type: 'boolean', description: 'Whether archived issues may be returned.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          totalCount: { type: 'integer', required: true },
          issues: { type: 'array', required: true, items: ISSUE_SCHEMA },
          pageInfo: PAGE_INFO_SCHEMA,
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderPage(value, 'issues', 'No Linear issues found.', `Found ${value.totalCount} issue(s):`) }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    execute: (args, exec) => {
      nonempty(args.query, 'query')
      return runtime.searchIssues(args, exec.signal)
    },
    presentCall: (args) => ({ card: 'generic', title: args.query, kind: 'search' }),
  }))

  ctx.tools.register(defineTool({
    name: 'linear_list_issues',
    description: 'List Linear issues using deterministic team, state, assignee, priority, project, cycle, label, and date filters.',
    parameters: {
      team: { type: 'string', description: 'Team ID, key, or exact name. Required with states.' },
      states: { type: 'array', items: { type: 'string' }, description: 'State IDs, exact names, or types.' },
      assignee: { type: 'string', description: 'User ID, email, exact name, “me”, or “unassigned”.' },
      priorities: { type: 'array', items: { type: 'integer' }, description: 'Priorities: 0 none, 1 urgent, 2 high, 3 medium, 4 low.' },
      project: { type: 'string', description: 'Project UUID, API slug ID, exact name, full project URL, browser path slug, or “none”.' },
      cycle: { type: 'string', description: 'Cycle ID, number, exact name, current, next, previous, or “none”.' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Label IDs or exact names; any matching label is accepted.' },
      updatedAfter: { type: 'string', description: 'Only issues updated on or after this ISO date/timestamp.' },
      createdAfter: { type: 'string', description: 'Only issues created on or after this ISO date/timestamp.' },
      orderBy: { type: 'string', enum: ['updatedAt', 'createdAt'], description: 'Pagination order. Defaults to updatedAt.' },
      ...PAGE_PARAMETERS,
      includeArchived: { type: 'boolean', description: 'Whether archived issues may be returned.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          issues: { type: 'array', required: true, items: ISSUE_SCHEMA },
          pageInfo: PAGE_INFO_SCHEMA,
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderPage(value, 'issues', 'No Linear issues matched the filters.', 'Linear issues:') }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    execute: (args, exec) => {
      if (args.priorities !== undefined && (!Array.isArray(args.priorities)
        || args.priorities.some((value) => !Number.isInteger(value) || value < 0 || value > 4))) {
        throw new Error('priorities must contain integers from 0 to 4')
      }
      return runtime.listIssues(args, exec.signal)
    },
    presentCall: () => ({ card: 'generic', title: 'Linear issues', kind: 'search' }),
  }))

  ctx.tools.register(defineTool({
    name: 'linear_get_issue',
    description: 'Get one Linear issue by UUID or human identifier such as ENG-123.',
    parameters: { issue: { type: 'string', required: true, description: 'Issue UUID or identifier.' } },
    output: {
      schema: ISSUE_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderIssue(value) }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    execute: (args, exec) => {
      nonempty(args.issue, 'issue')
      return runtime.getIssue(args, exec.signal)
    },
    presentCall: (args) => ({ card: 'generic', title: args.issue, kind: 'search' }),
  }))

  ctx.tools.register(defineTool({
    name: 'linear_get_issue_comments',
    description: 'Read paginated comments for one Linear issue without modifying the thread.',
    parameters: {
      issue: { type: 'string', required: true, description: 'Issue UUID or identifier.' },
      orderBy: { type: 'string', enum: ['createdAt', 'updatedAt'], description: 'Pagination order. Defaults to createdAt.' },
      ...PAGE_PARAMETERS,
      includeArchived: { type: 'boolean', description: 'Whether archived comments may be returned.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          issue: { type: 'string', required: true },
          comments: { type: 'array', required: true, items: COMMENT_SCHEMA },
          pageInfo: PAGE_INFO_SCHEMA,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.comments.length === 0
          ? `No comments on ${value.issue}.`
          : value.comments.map((comment) => [
              `${comment.author?.name ?? 'Unknown author'} · ${comment.createdAt}`,
              comment.body,
              comment.url,
            ].join('\n')).join('\n\n'),
      }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    execute: (args, exec) => {
      nonempty(args.issue, 'issue')
      return runtime.getIssueComments(args, exec.signal)
    },
    presentCall: (args) => ({ card: 'generic', title: `${args.issue} comments`, kind: 'search' }),
  }))
}
