import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { startWorker } from '../../src/worker.js'
import { WorktreeManager } from '../../src/index.js'
import type { DispatchArgs, SnapshotResult } from '../../shared/contracts.js'

declare const ctx: Context
declare const parent: Agent
declare const signal: AbortSignal
const args: DispatchArgs = { worktree: '/repo/worker', task: 'Review', mode: 'read-only' }
const manager = new WorktreeManager(ctx)
void manager.dispatch(parent, args, signal)
// @ts-expect-error Dispatch never accepts permission escalation as a worker mode.
void manager.dispatch(parent, { ...args, mode: 'danger-full-access' }, signal)
// @ts-expect-error Workers require a job-owned cancellation signal.
void startWorker(ctx, { parent, cwd: '/repo/worker', mode: 'write', task: 'Review' })
// @ts-expect-error A session ID cannot substitute for the exact live parent Agent.
void manager.list('parent')
declare const result: SnapshotResult
if (!result.ok) {
  // @ts-expect-error A failed RPC result contains no displayable snapshot.
  void result.value
}
