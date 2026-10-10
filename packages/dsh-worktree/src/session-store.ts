import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import type { SessionWorktree } from '../shared/session-contracts.js'

const text = z.string().min(1).max(8192)
const identifier = z.string().min(1).max(200)
export const ownedSessionSchema = z
  .object({
    sessionId: identifier,
    workspaceId: identifier.nullable(),
    sourceWorkspaceId: identifier,
    sourceSessionId: identifier,
    requestId: z.uuid(),
    repository: text,
    commonDir: text,
    path: text,
    branch: z.string().regex(/^worktree\/session-[0-9a-f-]{36}$/),
    sourceRef: z.string().startsWith('refs/heads/').max(8192).nullable(),
    head: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
    state: z.enum(['creating', 'active', 'pending', 'removed', 'error']),
    message: z.string().max(2000),
    branchDeleted: z.boolean(),
  })
  .strict()
export type OwnedSession = z.infer<typeof ownedSessionSchema>
export const sessionWorktreeDomain = defineDomain({
  name: 'local_worktree_sessions',
  version: 1,
  tables: {
    sessions: domainTable<string, OwnedSession>(ownedSessionSchema),
    preferences: domainTable<string, boolean>(z.boolean()),
  },
})
export type SessionWorktreeDomain = Domain<typeof sessionWorktreeDomain>
export function sessionView(record: OwnedSession): SessionWorktree {
  // Return an owned projection, never a live storage record or native Session.
  const { sourceSessionId: _source, requestId: _request, ...view } = record
  return view
}
