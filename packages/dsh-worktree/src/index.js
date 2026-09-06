import { Service } from '@deepseek-ai/cordis'
import { settleRun } from '@deepseek-ai/dsh-subagent'
import * as git from './git.js'
import { startRegisteredWorker } from './worker.js'
import { CHANNEL, createSnapshotRpcHandler } from './snapshot.js'

export const name = 'worktree-workers'
const MAX_REPORTS = 100
const MAX_TEXT = 32000
const JOB_KIND = 'worktree-worker'
const CLEANUP_FAILED = 'Worktree cleanup is uncertain; checkout remains fenced.'

function bounded(value, max) {
  const marker = '\n[truncated]'
  return value.length <= max ? value : value.slice(0, max - marker.length) + marker
}

function requiredText(value, label, max = MAX_TEXT) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`${label} must be nonempty text of at most ${max} characters`)
  }
  return value
}

/** Process-local coordination only; Git and DSH jobs remain the authorities. */
export class WorktreeManager {
  constructor(ctx, dependencies = {}) {
    this.ctx = ctx
    this.git = dependencies.git ?? git
    this.startWorker = dependencies.startWorker ?? startRegisteredWorker
    this.settleRun = dependencies.settleRun ?? settleRun
    this.active = new Map()
    this.creating = new Set()
    this.history = new WeakMap()
  }

  cwd(parent) {
    if (!parent || this.ctx.agents.get(parent.session.id) !== parent) {
      throw new Error('Worktree tools require their exact live calling agent')
    }
    return requiredText(parent.session.header.cwd, 'Session working directory', 8192)
  }

  activeWorktrees() {
    const active = new Map(this.active)
    // Jobs outlive their producer registration. Reconstruct fences from the
    // public registry rather than assuming this service instance owns all runs.
    // Only exact live owners are used; never read private registry state.
    for (const owner of this.ctx.agents.list()) {
      for (const job of this.ctx.jobs.list(owner)) {
        if (job.kind !== JOB_KIND) continue
        const cleanupUncertain = job.detail?.startsWith(CLEANUP_FAILED) === true
        if (job.status === 'running' || job.status === 'stopping' || cleanupUncertain) {
          active.set(job.label, { owner, jobId: job.id, cleanupUncertain })
        }
      }
    }
    return active
  }

  async create(parent, name, signal) {
    const cwd = this.cwd(parent)
    signal?.throwIfAborted()
    // Git worktree creation writes protected shared Git metadata. Do not bypass
    // the user's sandbox mode by executing Git directly from a host plugin.
    const policy = this.ctx.sandboxPolicy.resolve({ session: parent.session })
    if (policy.mode !== 'danger-full-access') {
      throw new Error('Creating a worktree requires Full access because Git updates shared repository metadata. Change permissions deliberately, then retry; this tool does not escalate automatically.')
    }
    const { commonDir } = await this.git.listWorktrees(cwd, { signal })
    if (this.creating.has(commonDir)) throw new Error('Another worktree creation is active for this repository; retry after it finishes')
    this.creating.add(commonDir)
    try {
      this.cwd(parent)
      signal?.throwIfAborted()
      if (this.ctx.sandboxPolicy.resolve({ session: parent.session }).mode !== 'danger-full-access') {
        throw new Error('Session permissions changed before worktree creation')
      }
      return await this.git.createWorktree(cwd, name, { signal })
    } finally {
      this.creating.delete(commonDir)
    }
  }

  async list(parent, signal) {
    const result = await this.git.listWorktrees(this.cwd(parent), { signal })
    const history = this.history.get(parent)
    const activeWorktrees = this.activeWorktrees()
    return {
      ...result,
      worktrees: result.worktrees.map(worktree => {
        const active = activeWorktrees.get(worktree.path)
        const previous = history && [...history.values()].reverse().find(run => run.path === worktree.path)
        return {
          ...worktree,
          busy: Boolean(active),
          ...(active?.cleanupUncertain ? { cleanupUncertain: true } : {}),
          ...(active?.owner === parent ? { activeJobId: active.jobId } : {}),
          ...(previous ? { latestRun: { jobId: previous.jobId, mode: previous.mode, status: previous.status } } : {}),
        }
      }),
    }
  }

  async dispatch(parent, args, signal) {
    const cwd = this.cwd(parent)
    const task = requiredText(args.task, 'task')
    const mode = args.mode ?? 'read-only'
    if (!['write', 'read-only'].includes(mode)) throw new Error('mode must be write or read-only')
    const { worktree } = await this.git.resolveWorktree(cwd, requiredText(args.worktree, 'worktree', 8192), { signal })
    signal?.throwIfAborted()
    this.cwd(parent)
    if (this.activeWorktrees().has(worktree.path)) throw new Error('This worktree already has an active assignment; collect or cancel its job before dispatching another')
    let history = this.history.get(parent)
    if (!history) this.history.set(parent, history = new Map())
    let handoff
    if (args.context_from !== undefined) {
      const previous = history.get(requiredText(args.context_from, 'context_from', 200))
      if (!previous || previous.path !== worktree.path) throw new Error('context_from must identify a retained run owned by this agent in this worktree')
      if (previous.status === 'running') throw new Error('The context source has not finished')
      handoff = `Previous assignment (${previous.status}):\n${bounded(previous.task, 4000)}\n\nPrevious report:\n${bounded(previous.report || '(no report available)', 26000)}`
    }
    if (history.size >= MAX_REPORTS && [...history.values()].every(run => run.status === 'running')) {
      throw new Error('Recorded run limit reached; wait for an assignment to finish')
    }
    const record = { owner: parent, path: worktree.path, mode, task, status: 'running', report: '', jobId: undefined }
    this.active.set(worktree.path, record)
    try {
      const jobId = this.ctx.jobs.start({
        kind: JOB_KIND,
        label: worktree.path,
        owner: parent,
        outputLimitBytes: 48000,
        run: () => {
          // Tool-call cancellation ends at admission. Only the job owns the
          // background signal, matching DSH's stock one-shot adapter.
          const controller = new AbortController()
          return {
            cancel: reason => controller.abort(reason ?? 'Worktree assignment cancelled'),
            done: (async () => {
              let outcome
              try {
                const run = await this.startWorker(this.ctx, { parent, cwd: worktree.path, mode, task, handoff, signal: controller.signal })
                outcome = await this.settleRun({
                  id: run.id, localAgent: run.localAgent, result: run.result,
                  dispose: async () => {
                    try { await run.dispose() } catch (error) {
                      record.cleanupUncertain = true
                      throw error
                    }
                  },
                })
              } catch (error) {
                // A startup rollback that also failed cannot prove quiescence.
                if (error instanceof AggregateError) record.cleanupUncertain = true
                outcome = { status: controller.signal.aborted && !record.cleanupUncertain ? 'killed' : 'failed', detail: String(error).slice(0, 2000) }
              }
              if (record.cleanupUncertain) {
                outcome = { ...outcome, status: 'failed', detail: `${CLEANUP_FAILED} ${outcome.detail ?? ''}`.slice(0, 2000) }
              }
              record.status = outcome.status
              record.report = bounded(outcome.output ?? outcome.detail ?? '', MAX_TEXT)
              return outcome
            })().finally(() => {
              // settleRun releases the child before this lease becomes reusable.
              if (!record.cleanupUncertain && this.active.get(worktree.path) === record) this.active.delete(worktree.path)
            }),
          }
        },
      })
      record.jobId = jobId
      history.set(jobId, record)
      for (const [id, run] of history) {
        if (history.size <= MAX_REPORTS) break
        if (run.status !== 'running') history.delete(id)
      }
      return { jobId, worktree: worktree.path, branch: worktree.branch, mode, message: 'Background assignment started. Use job_output/job_kill; DSH reports completion. Follow-ups require a fresh dispatch.' }
    } catch (error) {
      if (this.active.get(worktree.path) === record) this.active.delete(worktree.path)
      throw error
    }
  }
}

export default class WorktreeService extends Service {
  static inject = ['agents', 'sessions', 'jobs', 'sandboxPolicy', 'tools', 'subagents']
  constructor(ctx) {
    super(ctx, 'worktreeWorkers')
    this.manager = new WorktreeManager(ctx)
    ctx.inject(['connection'], connectionCtx => {
      connectionCtx.effect(() => connectionCtx.connection.rpc.handle(CHANNEL, createSnapshotRpcHandler(ctx, this.manager)))
    })
  }
  create(parent, name, signal) { return this.manager.create(parent, name, signal) }
  list(parent, signal) { return this.manager.list(parent, signal) }
  dispatch(parent, args, signal) { return this.manager.dispatch(parent, args, signal) }
}
