import { createHash } from 'node:crypto'

/** Bumped whenever a persisted record shape changes incompatibly. */
export const RECORD_VERSION = 1

export const WORK_STATES = [
  'working',
  'waiting-for-user',
  'ready-for-review',
  'done',
  'failed',
] as const
export type WorkState = (typeof WORK_STATES)[number]

export const DECISIONS = ['approve', 'reject'] as const
export type Decision = (typeof DECISIONS)[number]

/** Pinned output of `dispatch_refresh_base`; proposals refer to it by value. */
export interface BaseSnapshot {
  readonly repositoryRoot: string
  readonly remote: string
  readonly branch: string
  readonly ref: string
  readonly commit: string
  readonly fetchedAt: string
}

/** Exactly what the user approves. Never mutated after preparation. */
export interface ProposalPayload {
  readonly kind: 'create' | 'adopt' | 'assign'
  readonly intent: string
  readonly prompt: string
  readonly preset: string
  readonly model: string
  readonly base: BaseSnapshot | null
  readonly branch: string | null
  readonly workerSessionId: string | null
  readonly assignmentId: string
}

export type ProposalState =
  'pending' | 'rejected' | 'expired' | 'executing' | 'succeeded' | 'failed' | 'uncertain'

export const CHECKPOINTS = [
  'approved',
  'session-created',
  'worktree-created',
  'verified',
  'claimed',
  'delivered',
] as const
export type Checkpoint = (typeof CHECKPOINTS)[number]

export interface ProposalRecord {
  readonly version: number
  readonly id: string
  readonly coordinatorId: string
  readonly callId: string
  readonly generation: number
  readonly payload: ProposalPayload
  readonly digest: string
  readonly createdAt: string
  /** Host lifetime that prepared it; proposals from another lifetime are expired, never consumed. */
  readonly hostEpoch: string
  state: ProposalState
  checkpoints: Checkpoint[]
  decidedAt?: string
  workerSessionId?: string
  worktree?: { path: string; branch: string; baseCommit: string; repositoryRoot: string }
  message?: string
}

export interface WorkerRecord {
  readonly version: number
  readonly workerId: string
  coordinatorId: string
  generation: number
  originalWorkspace: string
  repositoryRoot: string
  worktreePath: string
  branch: string
  baseCommit: string
  assignmentId: string
  preset: string
  verifiedAt: string
  /** Set when management was released; released records keep history and grant nothing. */
  released?: boolean
  title?: string
}

export interface AssignmentRecord {
  readonly version: number
  readonly id: string
  readonly workerId: string
  readonly coordinatorId: string
  readonly proposalId: string
  readonly intent: string
  readonly prompt: string
  readonly preset: string
  readonly model: string
  readonly base: BaseSnapshot | null
  workState: WorkState
  summary: string
  /** Who last set workState: the worker's report, or an attributed coordinator administrative status. */
  stateSource: 'worker' | 'coordinator'
  evidence: string[]
  updatedAt: string
}

export type ReportKind = 'progress' | 'input-required' | 'ready-for-review' | 'done' | 'failed'
export const REPORT_KINDS: readonly ReportKind[] = [
  'progress',
  'input-required',
  'ready-for-review',
  'done',
  'failed',
]

export interface ReportRecord {
  readonly version: number
  readonly id: string
  readonly workerId: string
  readonly coordinatorId: string
  readonly assignmentId: string
  readonly generation: number
  readonly kind: ReportKind
  readonly summary: string
  readonly evidence: string[]
  readonly createdAt: string
  delivery: 'pending' | 'delivered' | 'dropped'
  /** Identity of the delivered message, recorded before delivery for log reconciliation. */
  messageId?: string
  deliveredAt?: string
  dropReason?: string
}

export const LIMITS = {
  intent: 500,
  prompt: 32_768,
  summary: 4_000,
  evidenceItems: 20,
  evidenceItem: 500,
  message: 16_384,
  title: 120,
  branch: 100,
} as const

export function reportWorkState(kind: ReportKind): WorkState {
  switch (kind) {
    case 'progress':
      return 'working'
    case 'input-required':
      return 'waiting-for-user'
    case 'ready-for-review':
      return 'ready-for-review'
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`).join(',')}}`
}

/** Stable digest binding an approval to one exact payload, coordinator, call, and ownership generation. */
export function proposalDigest(input: {
  coordinatorId: string
  callId: string
  proposalId: string
  generation: number
  payload: ProposalPayload
}): string {
  return createHash('sha256').update(canonical(input)).digest('hex')
}

export type DispatchErrorCode =
  | 'invalid'
  | 'not-found'
  | 'forbidden'
  | 'conflict'
  | 'expired'
  | 'unavailable'
  | 'ineligible'
  | 'uncertain'

/** Error whose message is safe to show to the model and the user. */
export class DispatchError extends Error {
  readonly code: DispatchErrorCode
  constructor(code: DispatchErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'DispatchError'
  }
}
