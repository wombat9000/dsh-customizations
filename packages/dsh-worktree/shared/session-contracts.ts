export const SESSION_CHANNEL = '/local-worktree-sessions'
export type CheckoutState = 'creating' | 'active' | 'pending' | 'removed' | 'error'
export interface SessionWorktree {
  sessionId: string
  workspaceId: string | null
  sourceWorkspaceId: string
  repository: string
  commonDir: string
  path: string
  branch: string
  sourceRef: string | null
  head: string
  state: CheckoutState
  message: string
  branchDeleted: boolean
}
export interface SessionWorktreeStatus {
  records: SessionWorktree[]
  current: SessionWorktree | null
  sourceWorkspaceId: string | null
  defaultEnabled: boolean
  canCreate: boolean
  reason: string
}
export interface CleanupConfirmation {
  id: string
  expiresAt: number
  head: string
  files: string[]
}
export interface CleanupResult {
  state: 'removed' | 'pending' | 'confirm'
  record: SessionWorktree
  confirmation?: CleanupConfirmation
}
export interface SessionEndpoints {
  status: { input: { sessionId?: string }; value: SessionWorktreeStatus }
  preference: { input: { workspaceId: string; enabled: boolean }; value: { enabled: boolean } }
  create: { input: { sessionId: string; requestId: string }; value: SessionWorktree }
  cleanup: { input: { sessionId: string; confirmationId?: string }; value: CleanupResult }
  restore: { input: { sessionId: string }; value: SessionWorktree }
}
export type SessionRpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: Record<string, never> } }
export type SessionRequest = <E extends keyof SessionEndpoints>(
  endpoint: E,
  input: SessionEndpoints[E]['input'],
  signal?: AbortSignal,
) => Promise<SessionEndpoints[E]['value']>
