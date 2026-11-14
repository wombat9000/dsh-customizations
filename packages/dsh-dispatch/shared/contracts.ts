// Host/Client wire contracts for the `/local-dispatch` Connection channel.
// The browser sends identities and a decision only; never prompts, models, or targets.

export type ProposalState =
  'pending' | 'rejected' | 'expired' | 'executing' | 'succeeded' | 'failed' | 'uncertain'

export interface ProposalStatus {
  proposalId: string
  state: ProposalState
  kind: 'create' | 'adopt' | 'assign'
  intent: string
  prompt: string
  preset: string
  model: string
  branch: string | null
  base: {
    provider: string
    repositoryRoot: string
    remote: string
    branch: string
    ref: string
    commit: string
    fetchedAt: string
  } | null
  /** Reviewed checkout of an adoption or new assignment; drift at execution is refused. */
  target: {
    provider: string
    worktreeKey: string
    worktreePath: string
    repositoryRoot: string
    branch: string
    head: string
  } | null
  workerSessionId: string | null
  assignmentId: string
  checkpoints: string[]
  message?: string
  worktree?: { path: string; branch: string; baseCommit: string; repositoryRoot: string }
  digest: string
  coordinatorId: string
  createdAt: string
  decidedAt?: string
  observedAt: string
}

/** One managed worker as the coordinator's owner sees it; display data only. */
export interface WorkerStatus {
  workerId: string
  title?: string
  branch: string
  worktreePath: string
  repositoryRoot: string
  baseCommit: string
  assignmentId: string
  workState: 'working' | 'waiting-for-user' | 'ready-for-review' | 'done' | 'failed'
  assignmentOpen: boolean
  summary: string
  stateSource: 'worker' | 'coordinator'
  evidence: string[]
  updatedAt: string
  runtime: string
  eligible: boolean
  eligibility: string
  lastReport?: { kind: string; summary: string; createdAt: string }
}

export interface RpcEndpoints {
  status: { input: { sessionId: string; callId: string }; result: ProposalStatus }
  workers: { input: { sessionId: string }; result: WorkerStatus[] }
  decide: {
    input: {
      sessionId: string
      callId: string
      proposalId: string
      digest: string
      decision: 'approve' | 'reject'
    }
    result: ProposalStatus
  }
}

export type RpcResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: string; message: string; details?: object } }

export const DISPATCH_CHANNEL = '/local-dispatch'
/** Tool calls whose view is the live worker-status card. */
export const STATUS_TOOLS = [
  'dispatch_list_sessions',
  'dispatch_get_session_status',
  'dispatch_wait_session',
] as const
export const CARD_TOOLS = [
  'dispatch_create_session',
  'dispatch_add_session',
  'dispatch_send_message',
] as const
