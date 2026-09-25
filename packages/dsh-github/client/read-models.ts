import { object, text, id } from './validation.ts'

export const READ_TOOLS = [
  'github_list_projects',
  'github_get_project',
  'github_list_project_items',
  'github_list_issues',
  'github_search_issues',
  'github_get_issue',
]
export const readTitles: Readonly<Record<string, string>> = {
  github_list_projects: 'Projects',
  github_get_project: 'Project details',
  github_list_project_items: 'Project items',
  github_list_issues: 'Issues',
  github_search_issues: 'Issue search',
  github_get_issue: 'Issue details',
}

/** Read a property only after narrowing untrusted supplied data. */
export function supplied(value: unknown, key: string): unknown {
  return object(value) ? value[key] : undefined
}

export function readWarnings(envelope: unknown, toolName: string): string[] {
  const warnings = new Set<string>(),
    seen = new Set<object>()
  let budget = 10000
  function visit(value: unknown, path: string, depth: number): void {
    if (--budget < 0 || depth > 20) {
      warnings.add(
        'Additional nested data exceeds the card inspection bound; inspect raw details. Completeness is unknown.',
      )
      return
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    const nodes = supplied(value, 'nodes'),
      pageInfo = supplied(value, 'pageInfo')
    const nextCursor = supplied(value, 'nextCursor')
    if (
      Object.hasOwn(value, 'nodes') &&
      (!Array.isArray(nodes) || !object(pageInfo) || typeof pageInfo.hasNextPage !== 'boolean')
    )
      warnings.add(`${path}: pagination metadata is missing or malformed; completeness is unknown.`)
    if (
      supplied(pageInfo, 'hasNextPage') === true &&
      !id(nextCursor) &&
      !id(supplied(pageInfo, 'endCursor'))
    )
      warnings.add(`${path}: continuation cursor is unavailable; inspect raw details.`)
    if (
      supplied(value, 'truncated') === true ||
      supplied(pageInfo, 'hasNextPage') === true ||
      (typeof nextCursor === 'string' && nextCursor.length > 0)
    )
      warnings.add(
        `${path}: more data or truncated output. Continue this exact target with its matching cursor where supplied; this view is not complete.`,
      )
    if (Array.isArray(value)) {
      if (value.length > 50)
        warnings.add(
          `${path}: nested sections display at most 50 entries; inspect raw details for additional entries.`,
        )
      if (value.length > 100)
        warnings.add(`${path}: only the first 100 entries are inspected by this card.`)
      value
        .slice(0, 100)
        .forEach((entry: unknown, index: number) => visit(entry, `${path}[${index}]`, depth + 1))
    } else {
      const entries = Object.entries(value)
      if (entries.length > 100)
        warnings.add(`${path}: additional properties exceed the card inspection bound.`)
      for (const [key, entry] of entries.slice(0, 100)) visit(entry, `${path}.${key}`, depth + 1)
    }
  }
  visit(supplied(envelope, 'data'), 'data', 0)
  if (supplied(envelope, 'truncated') === true)
    warnings.add(
      'GitHub returned bounded or incomplete output. See all continuation notices and raw details.',
    )
  const truncations = supplied(envelope, 'truncations')
  if (Array.isArray(truncations)) {
    for (const notice of truncations.slice(0, 100)) {
      if (object(notice))
        warnings.add(
          `${text(notice.path) || 'Output'}: ${text(notice.reason) || text(notice.kind) || 'truncated'}. ${text(notice.continuation)}`,
        )
    }
  }
  if ((Array.isArray(truncations) || typeof truncations === 'string') && truncations.length > 100)
    warnings.add('Additional truncation notices are available in raw details.')
  if (toolName === 'github_search_issues')
    warnings.add(
      'GitHub search exposes at most 1,000 matches. Narrow the query for exhaustive results.',
    )
  if (supplied(supplied(envelope, 'data'), 'exhaustive') === false)
    warnings.add('This search result is not exhaustive.')
  return [...warnings]
}

export interface ReadCardModel {
  title: string
  warnings: string[]
  entries: Record<string, unknown>[]
  kind: 'unknown' | 'items' | 'projects' | 'issues'
  state?: 'running' | 'unknown' | 'failed' | 'returned'
  error?: string
  truncationPaths?: string[]
  unlocalizedTruncation?: boolean
  returnedCount?: number
  total?: number | undefined
  totalMeaning?: string
  scannedCount?: unknown
  templateOnly?: boolean
  singular?: boolean
}

// Parses bounded supplied tool JSON only; never reads a Host service or fetches.
export function readCardModel(toolName: string, block: unknown): ReadCardModel {
  const base: ReadCardModel = {
    title: readTitles[toolName] ?? 'GitHub read',
    warnings: [],
    entries: [],
    kind: 'unknown',
  }
  if (!READ_TOOLS.includes(toolName))
    return { ...base, error: 'Unsupported card. Use raw tool details.' }
  if (!object(block) || block.kind !== 'tool-result') return { ...base, state: 'running' }
  let envelope: Record<string, unknown>
  try {
    const parts = Array.isArray(block.content)
      ? block.content.filter(
          (part: unknown): part is Record<string, unknown> & { text: string } =>
            object(part) && part.type === 'text' && typeof part.text === 'string',
        )
      : []
    const part = parts[0]
    if (parts.length !== 1 || !part || part.text.length > 524288) throw new Error()
    const parsed: unknown = JSON.parse(part.text)
    if (!object(parsed) || parsed.host !== 'github.com' || parsed.untrusted !== true)
      throw new Error()
    envelope = parsed
  } catch {
    return {
      ...base,
      state: 'unknown',
      error:
        'Readable result unavailable. Inspect raw tool details; no success or completeness is inferred.',
    }
  }
  const warnings = readWarnings(envelope, toolName),
    data = envelope.data
  if (!object(data))
    return {
      ...base,
      warnings,
      state: 'unknown',
      error:
        'Readable result unavailable. Inspect raw tool details; no success or completeness is inferred.',
    }
  if (block.isError === true)
    return {
      ...base,
      warnings,
      state: 'failed',
      error: 'The tool reported an error. Inspect raw tool details.',
    }
  const kind = toolName.includes('project_items')
    ? 'items'
    : toolName.includes('project')
      ? 'projects'
      : 'issues'
  const singular =
    toolName === 'github_get_project' ||
    toolName === 'github_get_issue' ||
    (kind === 'items' && data.nodes === undefined && id(data.id))
  const entries: unknown = singular ? [data] : data.nodes
  const validEntry = (entry: unknown): entry is Record<string, unknown> =>
    object(entry) &&
    id(entry.id) &&
    (kind === 'items'
      ? (entry.content == null || object(entry.content)) &&
        (entry.fieldValues === undefined ||
          (object(entry.fieldValues) && Array.isArray(entry.fieldValues.nodes)))
      : typeof entry.title === 'string' &&
        typeof entry.number === 'number' &&
        Number.isSafeInteger(entry.number) &&
        entry.number > 0)
  if (!Array.isArray(entries) || !entries.every(validEntry))
    return {
      ...base,
      warnings,
      state: 'unknown',
      error: 'Malformed result entries. Inspect raw tool details; no entries are inferred.',
    }
  if (entries.length > 50)
    warnings.push(
      'Only the first 50 returned entries are displayed by this card. Remaining entries are in raw details.',
    )
  const count = toolName === 'github_search_issues' ? data.issueCount : data.totalCount
  const total =
    typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : undefined
  return {
    ...base,
    warnings,
    truncationPaths: Array.isArray(envelope.truncations)
      ? envelope.truncations.map((notice: unknown) => text(supplied(notice, 'path')))
      : [],
    unlocalizedTruncation:
      envelope.truncated === true &&
      (!Array.isArray(envelope.truncations) ||
        !envelope.truncations.length ||
        envelope.truncations.some(
          (notice: unknown) => !text(supplied(notice, 'path')).startsWith('data.'),
        )),
    state: 'returned',
    kind,
    entries: entries.slice(0, 50),
    returnedCount: entries.length,
    total,
    totalMeaning: text(data.totalCountMeaning),
    scannedCount: data.scannedCount,
    templateOnly: data.templateOnly === true,
    singular,
  }
}

export function shortIdentity(value: unknown): string {
  return (
    text(supplied(value, 'name')) ||
    text(supplied(value, 'title')) ||
    text(supplied(value, 'login')) ||
    text(supplied(value, 'nameWithOwner')) ||
    text(supplied(value, 'id')) ||
    'Unnamed entry'
  )
}
export const connectionTitles = {
  labels: 'Labels',
  users: 'People',
  reviewers: 'Reviewers',
  pullRequests: 'Pull requests',
}
export type FieldConnection = keyof typeof connectionTitles
export interface ItemFieldModel {
  label: string
  value: string
  url?: unknown
  connections?: FieldConnection[]
}
export function itemFieldModel(value: unknown): ItemFieldModel {
  if (!object(value)) return { label: 'Malformed field', value: 'See technical details' }
  const label = text(supplied(value.field, 'name')) || 'Unnamed field'
  const leaf = object(value.issueFieldValue) ? value.issueFieldValue : value
  const keys: FieldConnection[] = ['labels', 'users', 'pullRequests', 'reviewers']
  const connections = keys.filter((key) => Object.hasOwn(value, key))
  if (Object.hasOwn(value, 'repository') || Object.hasOwn(value, 'milestone')) {
    const entry = Object.hasOwn(value, 'repository') ? value.repository : value.milestone
    return {
      label,
      value:
        entry === null
          ? 'Not set'
          : text(supplied(entry, 'nameWithOwner')) ||
            text(supplied(entry, 'title')) ||
            'Value not supplied',
      url: supplied(entry, 'url'),
      connections,
    }
  }
  for (const key of ['text', 'number', 'date', 'name', 'title', 'value']) {
    if (!Object.hasOwn(leaf, key)) continue
    const value = leaf[key]
    if (value === null) return { label, value: 'Not set', connections }
    if (typeof value === 'string')
      return { label, value: value === '' ? 'Empty string' : value, connections }
    if (typeof value === 'number' && Number.isFinite(value))
      return { label, value: String(value), connections }
  }
  return {
    label,
    value: connections.length ? '' : 'Value not supplied or unsupported',
    connections,
  }
}

export function projectItemModel(entry: Record<string, unknown>) {
  const content = entry.content,
    type = text(supplied(content, '__typename')) || text(entry.type)
  const nodes = supplied(entry.fieldValues, 'nodes')
  const fields: unknown[] = Array.isArray(nodes) ? nodes.slice(0, 50) : []
  const statuses = fields.filter((value) => supplied(supplied(value, 'field'), 'name') === 'Status')
  const repositories: { nameWithOwner: string; url: unknown }[] = []
  for (const repository of [
    supplied(content, 'repository'),
    ...fields.map((value) => supplied(value, 'repository')),
  ]) {
    const nameWithOwner = text(supplied(repository, 'nameWithOwner'))
    if (nameWithOwner && !repositories.some((value) => value.nameWithOwner === nameWithOwner))
      repositories.push({ nameWithOwner, url: supplied(repository, 'url') })
  }
  const prs = fields.filter((value) => Object.hasOwn(value ?? {}, 'pullRequests'))
  const title = supplied(content, 'title'),
    number = supplied(content, 'number')
  return {
    type,
    title: typeof title === 'string' ? title || 'Empty title' : 'Title not supplied',
    number: typeof number === 'number' && Number.isSafeInteger(number) ? number : undefined,
    url: supplied(content, 'url'),
    issueState:
      type === 'Issue'
        ? text(supplied(content, 'state')) || 'Not supplied'
        : type === 'PullRequest' || type === 'DraftIssue'
          ? 'Not an issue'
          : 'Unknown item type',
    boardStatus: statuses.length
      ? statuses.map((value) => itemFieldModel(value).value).join(' · ')
      : 'Not supplied',
    repositories,
    prs,
    fields: fields.filter(
      (value) =>
        supplied(supplied(value, 'field'), 'name') !== 'Status' &&
        !(
          supplied(supplied(value, 'field'), 'name') === 'Title' &&
          supplied(value, 'text') === title
        ) &&
        !Object.hasOwn(value ?? {}, 'pullRequests') &&
        !text(supplied(supplied(value, 'repository'), 'nameWithOwner')),
    ),
  }
}
