export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 50

export function pageArgs(args = {}, fallback = DEFAULT_PAGE_SIZE) {
  const limit = args.limit ?? fallback
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new Error(`limit must be an integer from 1 to ${MAX_PAGE_SIZE}`)
  }
  if (args.cursor !== undefined && (typeof args.cursor !== 'string' || args.cursor.trim().length === 0)) {
    throw new Error('cursor must be a non-empty Linear pagination cursor')
  }
  return {
    first: limit,
    ...(args.cursor === undefined ? {} : { after: args.cursor.trim() }),
  }
}

export function pageInfo(connection) {
  const info = connection?.pageInfo
  const hasNextPage = info?.hasNextPage === true
  const nextCursor = hasNextPage && typeof info.endCursor === 'string' ? info.endCursor : undefined
  return {
    hasNextPage,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  }
}

export function paged(connection, key, items, extra = {}) {
  return {
    ...extra,
    [key]: items,
    pageInfo: pageInfo(connection),
  }
}
