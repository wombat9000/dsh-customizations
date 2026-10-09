import { object, text, id } from './validation.ts'
import { cardResultEnvelope, cardResultFailure } from '../shared/read-result.ts'
import {
  inspectCollections,
  collectionModel,
  combineCompleteness,
  supplied,
  type BoundedInspection,
  type CollectionModel,
  type Completeness,
} from './collection-completeness.ts'
export { supplied } from './collection-completeness.ts'

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

// Retain the existing warning API while structured evidence owns completeness.
export function readWarnings(envelope: unknown, toolName: string): string[] {
  return inspectCollections(envelope, toolName).notices.map((notice) => notice.message)
}

export const issueCollections = [
  { title: 'Labels', key: 'labels', compact: true },
  { title: 'Assignees', key: 'assignees', compact: true },
  { title: 'Sub-issues', key: 'subIssues', compact: false },
  { title: 'Blocked by', key: 'blockedBy', compact: false },
  { title: 'Blocking', key: 'blocking', compact: false },
] as const

export interface ReadCardModel {
  title: string
  warnings: string[]
  entries: Record<string, unknown>[]
  kind: 'unknown' | 'items' | 'projects' | 'issues'
  state?: 'running' | 'unknown' | 'failed' | 'returned'
  error?: string
  inspection?: BoundedInspection
  completeness: Completeness
  collections?: Record<string, CollectionModel>
  collection?: CollectionModel
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
    completeness: 'unknown',
  }
  if (!READ_TOOLS.includes(toolName))
    return { ...base, error: 'Unsupported card. Use raw tool details.' }
  if (!object(block) || block.kind !== 'tool-result') return { ...base, state: 'running' }
  let envelope: Record<string, unknown>
  try {
    const parsed = cardResultEnvelope(toolName, block)
    if (!object(parsed) || parsed.host !== 'github.com' || parsed.untrusted !== true)
      throw new Error()
    envelope = parsed
  } catch (error) {
    return {
      ...base,
      state: 'unknown',
      error: cardResultFailure(error),
    }
  }
  const inspection = inspectCollections(envelope, toolName),
    warnings = inspection.notices.map((notice) => notice.message),
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
  const collection = singular ? undefined : collectionModel(data, 'data', inspection)
  const collections =
    toolName === 'github_get_issue'
      ? Object.fromEntries(
          issueCollections.map(({ key }) => [
            key,
            collectionModel(data[key], `data.${key}`, inspection),
          ]),
        )
      : undefined
  return {
    ...base,
    warnings,
    inspection,
    completeness: combineCompleteness([
      inspection.completeness,
      ...(collection ? [collection.completeness] : []),
      ...Object.values(collections ?? {}).map((value) => value.completeness),
    ]),
    ...(collection ? { collection } : {}),
    ...(collections ? { collections } : {}),
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
