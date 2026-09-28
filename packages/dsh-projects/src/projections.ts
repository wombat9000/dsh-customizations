import type { IssueRow, IssuesPage, IssuesRequest, ProjectSource } from '../shared/contracts.js'
import { fail } from './configuration.js'

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const string = (value: unknown, fallback = '') =>
  typeof value === 'string' ? (value.length > 2000 ? `${value.slice(0, 1999)}…` : value) : fallback
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value.slice(0, 50) : [])
export function safeUrl(value: unknown, provider: 'github' | 'linear'): string | undefined {
  if (typeof value !== 'string' || value.length > 2000) return
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== (provider === 'github' ? 'github.com' : 'linear.app') ||
      url.port ||
      url.username ||
      url.password
    )
      return
    return url.href
  } catch {
    return
  }
}
function assignees(value: unknown): string[] {
  return list(object(value).nodes)
    .map((value) => string(object(value).login))
    .filter(Boolean)
}
function githubIssue(value: unknown, index: number): IssueRow {
  const issue = object(value)
  const url = safeUrl(issue.url, 'github')
  const repository = string(object(issue.repository).nameWithOwner)
  return {
    id: string(issue.id, `unavailable-${index}`),
    title: string(issue.title, 'Unavailable item'),
    identifier: `${repository}${typeof issue.number === 'number' ? `#${issue.number}` : ''}`,
    source: 'github',
    kind: issue.__typename === 'PullRequest' ? 'pull-request' : 'issue',
    ...(url ? { url } : {}),
    status: string(issue.state, 'Unknown'),
    assignees: assignees(issue.assignees),
  }
}
function fieldSummary(field: Record<string, unknown>): string | undefined {
  const leaf =
    field.issueFieldValue && typeof field.issueFieldValue === 'object'
      ? object(field.issueFieldValue)
      : field
  // Preserve native names without treating a field named Status as issue state.
  if (Array.isArray(leaf.options)) {
    const names = list(leaf.options)
      .map((option) => string(object(option).name))
      .filter(Boolean)
    if (names.length === leaf.options.length) return string(names.join(', ')) || 'Not set'
  }
  for (const key of ['number', 'name', 'text', 'date', 'title', 'value']) {
    const value = leaf[key]
    if (value === null) return 'Not set'
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (typeof value === 'string') return string(value) || 'Empty string'
    if (
      Array.isArray(value) &&
      value.length <= 50 &&
      value.every((item) => typeof item === 'string')
    )
      return string(value.join(', ')) || 'Not set'
  }
  for (const key of ['repository', 'milestone'])
    if (Object.hasOwn(field, key)) {
      const value = field[key]
      if (value === null) return 'Not set'
      return string(object(value).nameWithOwner) || string(object(value).title) || undefined
    }
  for (const key of ['labels', 'users', 'reviewers', 'pullRequests'])
    if (Object.hasOwn(field, key)) {
      const nodes = object(field[key]).nodes
      if (!Array.isArray(nodes)) return undefined
      const names = list(nodes)
        .map((value) => {
          const entry = object(value)
          return (
            string(entry.login) || string(entry.name) || string(entry.title) || string(entry.slug)
          )
        })
        .filter(Boolean)
      if (names.length === nodes.length) return string(names.join(', ')) || 'Not set'
    }
  return undefined
}
function projectItem(value: unknown, index: number, warnings: Set<string>): IssueRow {
  const item = object(value)
  const content = object(item.content)
  const row = githubIssue(content, index)
  row.id = string(item.id, row.id)
  if (content.__typename === 'DraftIssue' || item.type === 'DRAFT_ISSUE') {
    row.kind = 'draft'
    row.identifier = 'Draft'
    row.status = 'Draft'
  }
  const fields: string[] = []
  for (const value of list(object(item.fieldValues).nodes)) {
    const field = object(value)
    const name = string(object(field.field).name, 'Unnamed field')
    const summary = fieldSummary(field)
    fields.push(`${name}: ${summary ?? 'Not summarized'}`)
    if (summary === undefined)
      warnings.add(
        'Some board fields are not summarized by Projects. Open the native tracker for their values.',
      )
    if (object(field.field).dataType === 'ASSIGNEES')
      row.assignees = list(object(field.users).nodes)
        .map((value) => string(object(value).login))
        .filter(Boolean)
  }
  if (item.isArchived === true) fields.push('Archived project item')
  row.boardFields = fields
  return row
}
function linearIssue(value: unknown, index: number): IssueRow {
  const issue = object(value)
  const url = safeUrl(issue.url, 'linear')
  const assignee = string(object(issue.assignee).displayName) || string(object(issue.assignee).name)
  const priority = string(issue.priorityLabel)
  return {
    id: string(issue.id, `unavailable-${index}`),
    title: string(issue.title, 'Unavailable issue'),
    identifier: string(issue.identifier),
    source: 'linear',
    kind: 'issue',
    ...(url ? { url } : {}),
    status: string(object(issue.state).name, 'Unknown'),
    assignees: assignee ? [assignee] : [],
    ...(priority ? { priority } : {}),
  }
}
// Detect incomplete nested connections too; a full outer page does not mean full issue details.
function incomplete(value: unknown, depth = 0): boolean {
  if (depth > 12 || !value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.slice(0, 100).some((child) => incomplete(child, depth + 1))
  const obj = object(value)
  return (
    obj.truncated === true ||
    object(obj.pageInfo).hasNextPage === true ||
    Object.values(obj).some((child) => incomplete(child, depth + 1))
  )
}
export function issuesPage(
  source: ProjectSource,
  request: IssuesRequest,
  result: unknown,
): IssuesPage {
  const envelope = object(result)
  const github = source.kind.startsWith('github-')
  const data = github ? object(envelope.data) : envelope
  const nodes = github ? data.nodes : data.issues
  if (
    !Array.isArray(nodes) ||
    nodes.length > 50 ||
    typeof object(data.pageInfo).hasNextPage !== 'boolean'
  )
    fail('response')
  const pageInfo = object(data.pageInfo)
  const hasNextPage = pageInfo.hasNextPage === true
  const cursor = github ? (data.nextCursor ?? pageInfo.endCursor) : pageInfo.nextCursor
  if (hasNextPage && (typeof cursor !== 'string' || !cursor || cursor.length > 4096))
    fail('response')
  const warnings: string[] = []
  if (incomplete(result))
    warnings.push(
      'This response is partial. More items or nested details are available in the tracker; this view does not imply completeness.',
    )
  if (github && Array.isArray(envelope.truncations) && envelope.truncations.length)
    warnings.push(
      'The GitHub integration truncated part of this response. Open the source for complete details.',
    )
  if (source.kind === 'github-project' && nodes.some((value) => !object(value).content))
    warnings.push('Some project items are unavailable or redacted for this account.')
  const projectionWarnings = new Set<string>()
  const issues = nodes.map((value, index) =>
    source.kind === 'github-project'
      ? projectItem(value, index, projectionWarnings)
      : github
        ? githubIssue(value, index)
        : linearIssue(value, index),
  )
  warnings.push(...projectionWarnings)
  return {
    projectId: request.projectId,
    sourceId: source.id,
    issues,
    hasNextPage,
    ...(hasNextPage && typeof cursor === 'string' ? { nextCursor: cursor } : {}),
    warnings,
    untrusted: true,
  }
}
