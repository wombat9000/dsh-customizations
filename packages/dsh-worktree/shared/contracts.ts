export const CHANNEL = '/local-worktrees'
export interface SignalOptions {
  signal?: AbortSignal | undefined
}
export type WorkerMode = 'write' | 'read-only'
export interface DispatchArgs {
  worktree: string
  task: string
  mode?: WorkerMode | undefined
  context_from?: string | undefined
}
export interface GitWorktree {
  path: string
  branch: string | null
  head: string | null
  bare: boolean
  detached: boolean
  locked: boolean
  prunable: boolean
  isCurrent?: boolean
  isOriginal?: boolean
}
export interface ChangedFile {
  status: string
  path: string
  from?: string
}
export type Changes =
  | { count: number; files: ChangedFile[]; truncated: boolean; error?: never }
  | { error: string; count?: never; files?: never; truncated?: never }
export interface Selection {
  path?: string
  runId?: string
}
export interface SnapshotRequest extends Selection {
  sessionId: string
}
export interface WorktreeRow {
  path: string
  name: string | undefined
  branch: string | null
  busy: boolean
  cleanupUncertain: boolean
  workerStatus: string
  changes: { error: string; count?: never } | { count: number; error?: never }
  latestAssignment: string | null
}
export interface SnapshotSelection {
  path: string
  changes: Changes
  runs: { id: string; mode: WorkerMode; status: string }[]
  run: { id: string; task: string; report: string | null } | null
}
// Capability reads return ready without a snapshot. Snapshot reads include the lists.
interface SnapshotFields {
  sessionId: string
  message?: string
  repository?: string
  truncated?: boolean
  worktrees?: WorktreeRow[]
  selected?: SnapshotSelection | null
}
export type SnapshotValue = SnapshotFields &
  ({ state: 'ready' | 'disabled' | 'unavailable' } | { state: 'error' })
export type SnapshotResult =
  | { ok: true; value: SnapshotValue }
  | { ok: false; error: { code: string; message: string; details: Record<string, never> } }
export interface WorktreeRpc {
  call(
    channel: typeof CHANNEL,
    method: 'snapshot' | 'capability',
    args: SnapshotRequest,
  ): Promise<unknown>
}
