import { hasWorktreeCapability } from './capability.js'
export const CHANNEL = '/local-worktrees'

export function createSnapshotHandler(ctx, manager) {
  const pending = new WeakMap()
  return async (method, args) => {
    if (!['capability', 'snapshot'].includes(method) || !args || typeof args.sessionId !== 'string' ||
        args.sessionId.length > 200 || Object.keys(args).some(k => !['sessionId', 'path', 'runId'].includes(k)) ||
        (args.path !== undefined && (typeof args.path !== 'string' || args.path.length > 8192)) ||
        (args.runId !== undefined && (typeof args.runId !== 'string' || args.runId.length > 200))) {
      return { sessionId: args?.sessionId, state: 'error', message: 'Invalid Worktrees request.' }
    }
    const sessionId = args.sessionId
    const agent = ctx.agents.get(sessionId)
    const capable = () => hasWorktreeCapability(ctx, agent)
    if (!agent) return { sessionId, state: 'unavailable' }
    if (!capable()) return { sessionId, state: 'disabled' }
    if (method === 'capability') return { sessionId, state: 'ready' }
    try {
      // Coalesce expensive Git work per exact live owner. Selection is projected
      // after the shared read; assignments and reports never enter shared caches.
      let read = pending.get(agent)
      if (!read) {
        read = manager.git.inspectWorktrees(manager.cwd(agent), { signal: AbortSignal.timeout(15000) })
        pending.set(agent, read)
        read.finally(() => { if (pending.get(agent) === read) pending.delete(agent) }).catch(() => {})
      }
      const git = await read
      if (!capable()) return { sessionId, state: 'disabled' }
      manager.cwd(agent)
      const active = manager.activeWorktrees()
      const history = [...(manager.history.get(agent)?.values() ?? [])].reverse().slice(0, 100)
      const selected = git.worktrees.find(row => row.path === args.path) ?? (args.path === undefined ? git.worktrees[0] : undefined)
      const runs = selected ? history.filter(run => run.path === selected.path) : []
      const run = runs.find(run => run.jobId === args.runId) ?? (args.runId === undefined ? runs[0] : undefined)
      return {
        sessionId, state: 'ready', repository: git.repository, truncated: git.truncated,
        worktrees: git.worktrees.map(row => {
          const busy = active.get(row.path)
          const latest = history.find(run => run.path === row.path)
          return { path: row.path, name: row.path.split(/[\\/]/).at(-1), branch: row.branch,
            busy: Boolean(busy), cleanupUncertain: Boolean(busy?.cleanupUncertain),
            workerStatus: busy ? 'busy' : (latest?.status ?? 'idle'),
            changes: row.changes.error ? { error: row.changes.error } : { count: row.changes.count },
            latestAssignment: latest ? latest.task.slice(0, 240) : null }
        }),
        selected: selected ? { path: selected.path, changes: selected.changes,
          runs: runs.map(run => ({ id: run.jobId, mode: run.mode, status: run.status })),
          run: run ? { id: run.jobId, task: run.task, report: run.report || null } : null } : null,
      }
    } catch {
      return { sessionId, state: capable() ? 'error' : 'disabled', message: 'Cannot read repository worktrees. The session may not have a Git working directory, or the bounded Git read failed.' }
    }
  }
}
