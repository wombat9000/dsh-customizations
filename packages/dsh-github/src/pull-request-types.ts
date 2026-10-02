import type { WriteArguments } from './write-contracts.js'
export interface InlineComment {
  path: string
  body: string
  line: number
  side: 'LEFT' | 'RIGHT'
  startLine?: number
  startSide?: 'LEFT' | 'RIGHT'
}
export interface PRArguments extends WriteArguments {
  owner: string
  repo: string
  pullNumber?: number | undefined
  limit?: number
  page?: number
  state?: string
  cursor?: string
  threadId?: string
  commentsLimit?: number
  commentsCursor?: string
  checksPage?: number
  statusesPage?: number
  membersPage?: number
  head?: string
  base?: string
  draft?: boolean
  event?: string
  expectedHeadSha?: string
  comments?: InlineComment[]
  pullNumbers?: number[]
  stackPullNumber?: number
}
export function includesPR<const T extends readonly unknown[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return values.includes(value)
}
