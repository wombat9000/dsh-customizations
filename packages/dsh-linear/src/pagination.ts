import type { LinearDocument } from '@linear/sdk'
import type { PageArgs } from './contracts.js'
export interface PageConnection {
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
}
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 50

export function pageArgs(args: PageArgs = {}, fallback = DEFAULT_PAGE_SIZE) {
  const limit = args.limit ?? fallback
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new Error(`limit must be an integer from 1 to ${MAX_PAGE_SIZE}`)
  }
  if (
    args.cursor !== undefined &&
    (typeof args.cursor !== 'string' || args.cursor.trim().length === 0)
  ) {
    throw new Error('cursor must be a non-empty Linear pagination cursor')
  }
  return {
    first: limit,
    ...(args.cursor === undefined ? {} : { after: args.cursor.trim() }),
  }
}

export function pageInfo(connection: PageConnection | undefined) {
  const info = connection?.pageInfo
  const hasNextPage = info?.hasNextPage === true
  const nextCursor =
    hasNextPage && typeof info?.endCursor === 'string' ? info?.endCursor : undefined
  return {
    hasNextPage,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  }
}

export function paged<K extends string, T, E extends object = Record<never, never>>(
  connection: PageConnection,
  key: K,
  items: T[],
  extra: E = {} as E,
): E & Record<K, T[]> & { pageInfo: ReturnType<typeof pageInfo> } {
  return {
    ...extra,
    [key]: items,
    pageInfo: pageInfo(connection),
  } as E & Record<K, T[]> & { pageInfo: ReturnType<typeof pageInfo> }
}

// The SDK declares a string enum; retain the caller's validated string and the
// existing SDK error boundary rather than silently replacing malformed JS input.
export function paginationOrder(
  value: 'createdAt' | 'updatedAt' | undefined,
  fallback: 'createdAt' | 'updatedAt',
): LinearDocument.PaginationOrderBy {
  return (value ?? fallback) as LinearDocument.PaginationOrderBy
}
