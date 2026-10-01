import { object, text, id } from './validation.ts'

export type Completeness = 'complete' | 'partial' | 'unknown'
export type CollectionProtocol = 'graphql' | 'rest'
export interface CompletenessNotice {
  kind:
    | 'metadata'
    | 'continuation'
    | 'truncation'
    | 'display-limit'
    | 'inspection-limit'
    | 'search-limit'
  path: string | null
  completeness: Completeness
  message: string
}
export interface BoundedInspection {
  notices: CompletenessNotice[]
  completeness: Completeness
}
export interface CollectionModel {
  entries: unknown[]
  malformed: boolean
  completeness: Completeness
  returnedCount: number
  total: number | undefined
  continuation: { cursor?: string; page?: number }
  displayLimit: number
}

/** Read a property only after narrowing untrusted supplied data. */
export function supplied(value: unknown, key: string): unknown {
  return object(value) ? value[key] : undefined
}
export function combineCompleteness(states: Completeness[]): Completeness {
  return states.includes('unknown')
    ? 'unknown'
    : states.includes('partial')
      ? 'partial'
      : 'complete'
}
function relatedPath(notice: string, path: string): boolean {
  return (
    notice === path ||
    notice.startsWith(`${path}.`) ||
    notice.startsWith(`${path}[`) ||
    path.startsWith(`${notice}.`) ||
    path.startsWith(`${notice}[`)
  )
}

// These adapters return REST collections throughout their read result. Thread
// reads and the issue/project adapters use GraphQL connections. Supplied page
// metadata must not be allowed to select its own, more permissive protocol.
const restCollectionTools = new Set([
  'github_list_pull_requests',
  'github_get_pull_request_files',
  'github_get_pull_request_reviews',
  'github_get_pull_request_checks',
  'github_get_pull_request_stack',
])
function collectionProtocol(toolName: string): CollectionProtocol {
  return restCollectionTools.has(toolName) ? 'rest' : 'graphql'
}
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
function optionalCursor(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.length <= 4096)
}
function paginationEvidence(value: unknown, protocol: CollectionProtocol) {
  const nodes = supplied(value, 'nodes'),
    pageInfo = supplied(value, 'pageInfo')
  const nextCursor = supplied(value, 'nextCursor'),
    endCursor = supplied(pageInfo, 'endCursor')
  const count = supplied(value, 'totalCount'),
    page = supplied(pageInfo, 'page'),
    nextPage = supplied(pageInfo, 'nextPage')
  const hasNextPage = supplied(pageInfo, 'hasNextPage')
  let valid =
    Array.isArray(nodes) &&
    object(pageInfo) &&
    typeof hasNextPage === 'boolean' &&
    optionalCursor(nextCursor) &&
    optionalCursor(endCursor) &&
    (count == null ||
      (typeof count === 'number' && Number.isSafeInteger(count) && count >= nodes.length))
  if (protocol === 'rest') {
    valid =
      valid &&
      positiveInteger(page) &&
      (hasNextPage === true ? positiveInteger(nextPage) && nextPage === page + 1 : nextPage == null)
  } else {
    valid =
      valid &&
      !Object.hasOwn(object(pageInfo) ? pageInfo : {}, 'page') &&
      (hasNextPage !== true || id(nextCursor) || id(endCursor))
  }
  // An end cursor describes the final edge even on the last page. Only a
  // reported next page makes it a continuation; an explicit nextCursor is retained.
  const cursor = id(nextCursor)
    ? nextCursor
    : hasNextPage === true && id(endCursor)
      ? endCursor
      : undefined
  return {
    valid,
    more: hasNextPage === true || id(nextCursor) || supplied(value, 'truncated') === true,
    continuation: valid
      ? {
          ...(protocol === 'graphql' && cursor ? { cursor } : {}),
          ...(protocol === 'rest' && positiveInteger(nextPage) ? { page: nextPage } : {}),
        }
      : {},
  }
}

/** Inspect supplied data once, with explicit bounds and localized evidence, never warning-prose parsing. */
export function inspectCollections(envelope: unknown, toolName: string): BoundedInspection {
  const notices: CompletenessNotice[] = [],
    messages = new Set<string>(),
    seen = new Set<object>(),
    connections: { value: unknown; path: string }[] = []
  let budget = 10000
  const add = (
    kind: CompletenessNotice['kind'],
    path: string | null,
    completeness: Completeness,
    message: string,
  ) => {
    if (messages.has(message)) return
    messages.add(message)
    notices.push({ kind, path, completeness, message })
  }
  function visit(value: unknown, path: string, depth: number): void {
    if (--budget < 0 || depth > 20) {
      add(
        'inspection-limit',
        null,
        'unknown',
        'Additional nested data exceeds the card inspection bound; inspect raw details. Completeness is unknown.',
      )
      return
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    const pageInfo = supplied(value, 'pageInfo'),
      nextCursor = supplied(value, 'nextCursor')
    if (Object.hasOwn(value, 'nodes')) connections.push({ value, path })
    if (
      Object.hasOwn(value, 'nodes') &&
      !paginationEvidence(value, collectionProtocol(toolName)).valid
    )
      add(
        'metadata',
        path,
        'unknown',
        `${path}: pagination metadata is missing or malformed; completeness is unknown.`,
      )
    if (
      supplied(pageInfo, 'hasNextPage') === true &&
      !id(nextCursor) &&
      !Number.isSafeInteger(supplied(pageInfo, 'nextPage')) &&
      !id(supplied(pageInfo, 'endCursor'))
    )
      add(
        'continuation',
        path,
        'partial',
        `${path}: continuation cursor is unavailable; inspect raw details.`,
      )
    if (
      supplied(value, 'truncated') === true ||
      supplied(pageInfo, 'hasNextPage') === true ||
      (typeof nextCursor === 'string' && nextCursor.length > 0)
    )
      add(
        'continuation',
        path,
        'partial',
        `${path}: more data or truncated output. Continue this exact target with its matching ${toolName.includes('pull_request') ? 'cursor or page' : 'cursor'} where supplied; this view is not complete.`,
      )
    if (Array.isArray(value)) {
      if (value.length > 50)
        add(
          'display-limit',
          path,
          'partial',
          `${path}: nested sections display at most 50 entries; inspect raw details for additional entries.`,
        )
      if (value.length > 100)
        add(
          'inspection-limit',
          path,
          'unknown',
          `${path}: only the first 100 entries are inspected by this card.`,
        )
      value.slice(0, 100).forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1))
    } else {
      const entries = Object.entries(value)
      if (entries.length > 100)
        add(
          'inspection-limit',
          null,
          'unknown',
          `${path}: additional properties exceed the card inspection bound.`,
        )
      for (const [key, entry] of entries.slice(0, 100)) visit(entry, `${path}.${key}`, depth + 1)
    }
  }
  const data = supplied(envelope, 'data')
  visit(data, 'data', 0)
  // Traversal can inspect supplied connections, but only the tool contract tells
  // us which absent collections must keep completeness unknown.
  function requireCollection(value: unknown, path: string) {
    if (object(value) && Object.hasOwn(value, 'nodes')) return
    connections.push({ value, path })
    add(
      'metadata',
      path,
      'unknown',
      `${path}: pagination metadata is missing or malformed; completeness is unknown.`,
    )
  }
  function requireNested(connection: unknown, path: string, key: string) {
    const nodes = supplied(connection, 'nodes')
    if (Array.isArray(nodes))
      nodes
        .slice(0, 100)
        .forEach((node, index) =>
          requireCollection(supplied(node, key), `${path}.nodes[${index}].${key}`),
        )
  }
  if (toolName === 'github_get_project') {
    for (const key of ['fields', 'repositories'])
      requireCollection(supplied(data, key), `data.${key}`)
  } else if (toolName === 'github_list_project_items') {
    if (supplied(data, 'nodes') === undefined && id(supplied(data, 'id')))
      requireCollection(supplied(data, 'fieldValues'), 'data.fieldValues')
    else requireNested(data, 'data', 'fieldValues')
  } else if (toolName === 'github_get_pull_request_threads') {
    if (object(supplied(data, 'thread')))
      requireCollection(supplied(supplied(data, 'thread'), 'comments'), 'data.thread.comments')
    else requireNested(supplied(data, 'threads'), 'data.threads', 'comments')
  }
  const truncated = supplied(envelope, 'truncated') === true,
    truncations = supplied(envelope, 'truncations')
  const localized =
    Array.isArray(truncations) &&
    truncations.length > 0 &&
    truncations.length <= 100 &&
    truncations.every((notice) => text(supplied(notice, 'path')).startsWith('data.'))
  if (truncated)
    add(
      'truncation',
      null,
      localized ? 'complete' : 'partial',
      'GitHub returned bounded or incomplete output. See all continuation notices and raw details.',
    )
  if (Array.isArray(truncations)) {
    for (const notice of truncations.slice(0, 100)) {
      if (object(notice)) {
        const path = text(notice.path)
        add(
          'truncation',
          path === 'data' || path.startsWith('data.') ? path : null,
          'partial',
          `${path || 'Output'}: ${text(notice.reason) || text(notice.kind) || 'truncated'}. ${text(notice.continuation)}`,
        )
      }
    }
  }
  if ((Array.isArray(truncations) || typeof truncations === 'string') && truncations.length > 100)
    add(
      'inspection-limit',
      null,
      'unknown',
      'Additional truncation notices are available in raw details.',
    )
  if (toolName === 'github_search_issues')
    add(
      'search-limit',
      null,
      'complete',
      'GitHub search exposes at most 1,000 matches. Narrow the query for exhaustive results.',
    )
  if (supplied(supplied(envelope, 'data'), 'exhaustive') === false)
    add('search-limit', null, 'partial', 'This search result is not exhaustive.')
  const inspection: BoundedInspection = {
    notices,
    completeness: combineCompleteness(notices.map((notice) => notice.completeness)),
  }
  inspection.completeness = combineCompleteness([
    inspection.completeness,
    ...connections.map(
      ({ value, path }) =>
        collectionModel(value, path, inspection, collectionProtocol(toolName)).completeness,
    ),
  ])
  return inspection
}

/** Pagination, counts and display bounds belong to the model, not the renderer. */
export function collectionModel(
  value: unknown,
  path: string,
  inspection: BoundedInspection,
  protocol: CollectionProtocol = 'graphql',
): CollectionModel {
  const nodes = supplied(value, 'nodes')
  const count = supplied(value, 'totalCount')
  const total =
    typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : undefined
  const pagination = paginationEvidence(value, protocol)
  const malformed = !object(value) || !Array.isArray(nodes)
  const returnedCount = Array.isArray(nodes) ? nodes.length : 0
  let own: Completeness = 'complete'
  if (!pagination.valid) own = 'unknown'
  else if (pagination.more) own = 'partial'
  else if (protocol === 'graphql' && (total === undefined || total !== returnedCount))
    own = 'unknown'
  else if (total !== undefined && total > returnedCount) own = 'partial'
  if (own === 'complete' && returnedCount > 50) own = 'partial'
  const evidence = inspection.notices.filter(
    (notice) => notice.path === null || relatedPath(notice.path, path),
  )
  return {
    entries: Array.isArray(nodes) ? nodes.slice(0, 50) : [],
    malformed,
    completeness: combineCompleteness([own, ...evidence.map((notice) => notice.completeness)]),
    returnedCount,
    total,
    continuation: pagination.continuation,
    displayLimit: 50,
  }
}
