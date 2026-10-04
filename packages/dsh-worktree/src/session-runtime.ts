import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { PlanModeController } from '@deepseek-ai/dsh-plan-mode'
import type { WorktreeManager } from './index.js'
import * as sessionGit from './session-git.js'
import { sessionView, type OwnedSession, type SessionWorktreeDomain } from './session-store.js'
import type { CleanupResult, SessionWorktreeStatus } from '../shared/session-contracts.js'

export class SessionWorktreeError extends Error {}
const modelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().optional(),
})
interface Confirmation {
  sessionId: string
  fingerprint: string
  head: string
  expiresAt: number
  archiveEpoch: number
}

/** Owns the durable Git → Workspace → Session lifecycle; native controllers own agents.
 * No native owner is disposed or reparented. Archive is a post-commit observation,
 * so failures retain recovery state rather than pretending archive can roll back.
 */
export class SessionWorktreeRuntime {
  private readonly records
  private readonly preferences
  private readonly locks = new Set<string>()
  private readonly confirmations = new Map<string, Confirmation>()
  private readonly knownOwners = new Set<string>()
  private readonly promptDisposers = new Set<() => void>()
  private readonly epochs = new Map<string, number>()
  private active = true
  private readonly lifecycle = new AbortController()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly ctx: Context
  private readonly manager: WorktreeManager
  private readonly domain: SessionWorktreeDomain
  private readonly git: typeof sessionGit
  constructor(
    ctx: Context,
    manager: WorktreeManager,
    domain: SessionWorktreeDomain,
    git: typeof sessionGit = sessionGit,
  ) {
    this.ctx = ctx
    this.manager = manager
    this.domain = domain
    this.git = git
    this.records = domain.table('sessions')
    this.preferences = domain.table('preferences')
  }
  private check() {
    if (!this.active) throw new SessionWorktreeError('Session worktrees are shutting down.')
  }
  private archived(id: string) {
    return this.ctx.workspaceRegistry.archivedSessionIds.includes(SessionId(id))
  }
  private owned(id: string) {
    const record = this.records.get(id)
    if (!record) throw new SessionWorktreeError('This session has no plugin-owned worktree.')
    return record
  }
  private async lock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    this.check()
    if (this.locks.has(id))
      throw new SessionWorktreeError('A checkout operation is already in progress.')
    this.locks.add(id)
    const task = operation()
    this.operations.add(task)
    try {
      return await task
    } finally {
      this.locks.delete(id)
      this.operations.delete(task)
    }
  }
  private async save(record: OwnedSession, patch: Partial<OwnedSession>) {
    const next = { ...record, ...patch }
    await this.records.put(record.sessionId, next)
    return next
  }
  async status(sessionId?: string): Promise<SessionWorktreeStatus> {
    this.check()
    const current = sessionId ? this.records.get(sessionId) : undefined
    const source =
      current?.sourceWorkspaceId ??
      this.ctx.workspaceRegistry
        .list()
        .find((workspace) => sessionId && workspace.sessionIds.includes(SessionId(sessionId)))
        ?.id ??
      null
    let canCreate = false
    let reason = ''
    if (sessionId && !current && source) {
      const agent = this.ctx.agents.get(SessionId(sessionId))
      if (!agent) reason = 'Wait for the fresh session to open.'
      else if (this.archived(sessionId)) reason = 'Archived sessions cannot create worktrees.'
      else {
        const list = await this.ctx.sessionController.list({}, AbortSignal.timeout(15000))
        const summary = list.items.find((row) => row.sessionId === sessionId)
        canCreate =
          summary?.blank === true &&
          summary.origin !== 'subagent' &&
          !summary.running &&
          agent.status === 'idle'
        if (!canCreate) reason = 'Use worktrees before sending the first prompt.'
        else if (
          this.ctx.sandboxPolicy.resolve({ session: agent.session }).mode !== 'danger-full-access'
        ) {
          canCreate = false
          reason = 'Creating a worktree requires Full access for shared Git metadata.'
        } else {
          try {
            await this.git.sourceInfo(this.manager.cwd(agent))
          } catch {
            canCreate = false
            reason = 'Select an available Git checkout to use worktrees.'
          }
        }
      }
    }
    return {
      records: [...this.records.entries()].map(([, record]) => sessionView(record)),
      current: sessionId && this.records.get(sessionId) ? sessionView(this.owned(sessionId)) : null,
      sourceWorkspaceId: source,
      defaultEnabled: source ? (this.preferences.get(source) ?? false) : false,
      canCreate,
      reason,
    }
  }
  async preference(workspaceId: string, enabled: boolean) {
    this.check()
    if (!this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId)))
      throw new SessionWorktreeError('The source workspace is unavailable.')
    await this.preferences.put(workspaceId, enabled)
    return { enabled }
  }
  private async source(sessionId: string) {
    const state = await this.status(sessionId)
    if (!state.canCreate || !state.sourceWorkspaceId)
      throw new SessionWorktreeError(state.reason || 'This session cannot create a worktree.')
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (!agent) throw new SessionWorktreeError('The source session is unavailable.')
    return { agent, workspaceId: state.sourceWorkspaceId }
  }
  async create(sourceSessionId: string, requestId: string) {
    const sessionId = `session-worktree-${requestId}`
    return this.lock(sessionId, async () => {
      const existing = this.records.get(sessionId)
      if (existing) {
        if (existing.sourceSessionId !== sourceSessionId)
          throw new SessionWorktreeError('This creation request belongs to another session.')
        if (existing.state !== 'active')
          throw new SessionWorktreeError(
            'The previous creation needs recovery. Open Session worktrees.',
          )
        return sessionView(existing)
      }
      const { agent, workspaceId } = await this.source(sourceSessionId)
      const info = await this.git.sourceInfo(this.manager.cwd(agent))
      const name = `session-${requestId}`
      let record: OwnedSession = {
        sessionId,
        sourceSessionId,
        requestId,
        workspaceId: null,
        sourceWorkspaceId: workspaceId,
        repository: info.repository,
        commonDir: info.commonDir,
        path: join(info.repository, '.dsh', 'worktrees', name),
        branch: `worktree/${name}`,
        sourceRef: info.sourceRef,
        head: info.sourceHead,
        state: 'creating',
        message: '',
        branchDeleted: false,
      }
      // Durable ownership INTENT precedes any Git mutation. Partial creations stay visible.
      await this.records.put(sessionId, record)
      try {
        await this.source(sourceSessionId)
        await this.git.excludeSessionCheckouts(this.manager.cwd(agent), {
          signal: this.lifecycle.signal,
          authorize: () => this.assertAuthority(agent),
        })
        const created = await this.manager.create(agent, name, this.lifecycle.signal)
        if (
          created.worktree.path !== record.path ||
          created.worktree.branch !== record.branch ||
          created.worktree.head !== record.head
        )
          throw new Error('Created worktree identity differs from its ownership record')
        record = await this.save(record, { head: created.worktree.head! })
        this.check()
        await this.source(sourceSessionId)
        this.assertAuthority(agent)
        const workspace = await this.ctx.workspaceRegistry.create(record.path)
        await workspace.setTitle(`Worktree: ${name.slice(8, 16)}`)
        record = await this.save(record, { workspaceId: workspace.id })
        const projections = await this.ctx.sessionController.projections(
          { sessionId: agent.session.id },
          AbortSignal.timeout(15000),
        )
        const preset = projections?.values.agentPreset
        await this.source(sourceSessionId)
        this.assertAuthority(agent)
        await this.ctx.sessionController.create({
          sessionId: SessionId(sessionId),
          workspaceId: workspace.id,
          ...(typeof preset === 'string' ? { agentPreset: preset } : {}),
        })
        const child = this.ctx.agents.get(SessionId(sessionId))
        if (!child) throw new Error('Created session has no published agent')
        // Copy effective permissions through their canonical owners, never infer
        // the custom preset's knobs from its client label or escalate the source.
        this.assertAuthority(agent)
        const policy = this.ctx.sandboxPolicy.resolve({ session: agent.session })
        if (policy.mode !== 'danger-full-access')
          throw new SessionWorktreeError(
            'Source permissions changed during creation. Checkout retained.',
          )
        setSandboxMode(child.session, policy.mode)
        const approval = agent.ctx.get('approval')
        const childApproval = child.ctx.get('approval')
        if (!approval || !childApproval)
          throw new SessionWorktreeError('Approval policy is unavailable; checkout retained.')
        childApproval.setPolicy(
          child,
          approval.overrideOf(agent.session) ?? approval.config.policy ?? 'ask',
        )
        const plan: PlanModeController | undefined = agent.ctx.get('planMode')
        const childPlan: PlanModeController | undefined = child.ctx.get('planMode')
        if (plan && childPlan) childPlan.set(child, plan.get(agent).active)
        const selection = projections?.values.modelSelection
        const parsed = z.object({ next: modelSchema.nullable() }).safeParse(selection)
        const model =
          parsed.success && parsed.data.next
            ? parsed.data.next
            : agent.options.provider && agent.options.model
              ? {
                  provider: agent.options.provider,
                  model: agent.options.model,
                  ...(agent.options.reasoningEffort
                    ? { reasoningEffort: agent.options.reasoningEffort }
                    : {}),
                }
              : null
        if (model)
          await this.ctx.sessionController.selectModel({
            sessionId: child.session.id,
            provider: model.provider,
            model: model.model,
            ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
          })
        this.assertAuthority(agent)
        if (this.ctx.agents.get(child.session.id) !== child)
          throw new SessionWorktreeError('Created session setup changed; checkout retained.')
        await this.preference(workspaceId, true)
        this.assertAuthority(agent)
        record = await this.save(record, { state: 'active', message: '' })
        return sessionView(record)
      } catch (error) {
        await this.save(record, {
          state: 'error',
          message:
            'Creation did not finish. Checkout or branch may remain; inspect Session worktrees before retrying.',
        })
        if (error instanceof SessionWorktreeError) throw error
        throw new SessionWorktreeError(
          'Worktree creation failed. Your source session is unchanged; retained state is listed in Session worktrees.',
        )
      }
    })
  }
  private assertAuthority(agent: Agent) {
    if (!this.active || this.lifecycle.signal.aborted)
      throw new SessionWorktreeError('Session worktree service stopped; checkout retained.')
    if (
      this.ctx.agents.get(agent.session.id) !== agent ||
      this.ctx.sandboxPolicy.resolve({ session: agent.session }).mode !== 'danger-full-access'
    )
      throw new SessionWorktreeError('Full access authority changed; checkout retained.')
  }

  observeAgent(agent: Agent) {
    if (!this.active) return
    this.knownOwners.add(agent.session.id)
    const record = this.records.get(agent.session.id)
    if (!record) return
    const prompt = agent.ctx.get('systemPrompt')
    if (prompt) {
      const off = prompt.context({
        name: 'worktree:interactive-session',
        order: 300,
        text: `This ordinary interactive session already has its own isolated Git worktree.\nWorking directory: ${JSON.stringify(record.path)}\nAssigned feature branch: ${JSON.stringify(record.branch)}\nUse this branch for commits and pull requests. Do not rename or switch it: managed execution and cleanup verify this exact branch. Git metadata and external services remain shared with the original repository. Archiving removes a verified clean checkout, or retains dirty files until the operator confirms discard. Restore removed checkouts through Session worktrees before continuing them.`,
      })
      this.promptDisposers.add(off)
      agent.ctx.effect(() => () => {
        off()
        this.promptDisposers.delete(off)
      })
    }
  }

  private assertJobsIdle(record: OwnedSession) {
    for (const owner of this.ctx.agents.list()) {
      this.knownOwners.add(owner.session.id)
      const cwd = this.manager.cwd(owner)
      if (
        owner.status === 'running' &&
        (owner.session.id === record.sourceSessionId ||
          cwd === record.repository ||
          cwd.startsWith(`${record.repository}/`))
      )
        throw new SessionWorktreeError(
          'A session still works in this repository. Cleanup is deferred.',
        )
    }
    // Background commands do not consistently surface their actual working
    // directory. Treat every known running/stopping job as a possible user of
    // this checkout, including jobs whose producer Agent has been disposed.
    for (const id of this.knownOwners)
      if (
        this.ctx.jobs
          .list(SessionId(id))
          .some((job) => job.status === 'running' || job.status === 'stopping')
      )
        throw new SessionWorktreeError(
          'A background job may still use this checkout. Cleanup is deferred.',
        )
  }

  private async authority(record: OwnedSession) {
    const result = await this.ctx.sessionController.resolveAgent(SessionId(record.sessionId))
    if ('error' in result)
      throw new SessionWorktreeError(
        'Cannot verify the saved session permissions. Checkout retained.',
      )
    if (
      this.ctx.sandboxPolicy.resolve({ session: result.agent.session }).mode !==
      'danger-full-access'
    )
      throw new SessionWorktreeError(
        'Cleanup and restore require this session’s Full access mode. Checkout retained.',
      )
    return result.agent
  }
  private async idle(record: OwnedSession) {
    if (!this.archived(record.sessionId))
      throw new SessionWorktreeError('Archive the session before cleaning its checkout.')
    if (this.manager.activeWorktrees().has(record.path))
      throw new SessionWorktreeError('A worker uses this checkout. Cleanup is deferred.')
    const activity = await this.ctx.waterfall(
      'workspace/session-activity',
      { sessionId: SessionId(record.sessionId) },
      () => Promise.resolve([]),
    )
    if (activity.length)
      throw new SessionWorktreeError(
        'The archived session still has active work. Cleanup is deferred.',
      )
    const list = await this.ctx.sessionController.list({}, AbortSignal.timeout(15000))
    for (const other of list.items) {
      this.knownOwners.add(other.sessionId)
      if (other.sessionId === record.sessionId || !other.cwd || this.archived(other.sessionId))
        continue
      let path: string
      try {
        path = await realpath(other.cwd)
      } catch {
        continue
      }
      if (path === record.path || path.startsWith(`${record.path}/`))
        throw new SessionWorktreeError(
          'Another unarchived session uses this checkout. Cleanup is deferred.',
        )
    }
    for (const owner of this.ctx.agents.list()) {
      this.knownOwners.add(owner.session.id)
      if (owner.status !== 'running') continue
      let path = this.manager.cwd(owner)
      try {
        path = await realpath(path)
      } catch {
        /* Check the immutable header path. */
      }
      if (path === record.repository || path.startsWith(`${record.repository}/`))
        throw new SessionWorktreeError(
          'A session still works in this repository. Cleanup is deferred.',
        )
    }
    this.assertJobsIdle(record)
    this.check()
    if (!this.archived(record.sessionId))
      throw new SessionWorktreeError('The session was unarchived. Cleanup cancelled.')
  }
  async cleanup(
    sessionId: string,
    confirmationId?: string,
    prepare = true,
  ): Promise<CleanupResult> {
    return this.lock(sessionId, async () => {
      let record = this.owned(sessionId)
      if (record.state === 'removed') return { state: 'removed', record: sessionView(record) }
      let confirmation: Confirmation | undefined
      if (confirmationId) {
        confirmation = this.confirmations.get(confirmationId)
        this.confirmations.delete(confirmationId) // consume once, including failures
        if (
          !confirmation ||
          confirmation.sessionId !== sessionId ||
          confirmation.expiresAt < Date.now() ||
          confirmation.archiveEpoch !== (this.epochs.get(sessionId) ?? 0)
        )
          throw new SessionWorktreeError(
            'This discard confirmation expired or became stale. Review cleanup again.',
          )
      }
      this.manager.checkoutOperations.add(record.path)
      try {
        await this.idle(record)
        const agent = await this.authority(record)
        return await agent.runMaintenance(async (maintenanceSignal) => {
          const signal = AbortSignal.any([maintenanceSignal, this.lifecycle.signal])
          this.check()
          const epoch = this.epochs.get(sessionId) ?? 0
          const authorize = () => {
            this.assertAuthority(agent)
            this.assertJobsIdle(record)
            if (this.manager.activeWorktrees().has(record.path))
              throw new SessionWorktreeError('A worker uses this checkout. Cleanup is deferred.')
            if (!this.archived(sessionId) || (this.epochs.get(sessionId) ?? 0) !== epoch)
              throw new SessionWorktreeError(
                'Archive state changed. Checkout retained; review cleanup again.',
              )
            if (
              confirmation &&
              (confirmation.archiveEpoch !== epoch || confirmation.expiresAt <= Date.now())
            )
              throw new SessionWorktreeError(
                'Discard confirmation expired or became stale. Review cleanup again.',
              )
          }
          const inspected = await this.git.inspectOwned(record, { signal })
          authorize()
          record = await this.save(record, { head: inspected.head })
          if (
            confirmation &&
            (confirmation.head !== inspected.head ||
              confirmation.fingerprint !== inspected.fingerprint)
          )
            throw new SessionWorktreeError(
              'Files changed after the preview. Nothing was discarded; review cleanup again.',
            )
          if (inspected.dirty && !confirmation) {
            record = await this.save(record, {
              state: 'pending',
              message: 'This checkout contains files that require your discard confirmation.',
            })
            if (!prepare) return { state: 'pending', record: sessionView(record) }
            for (const [id, token] of this.confirmations)
              if (token.sessionId === sessionId) this.confirmations.delete(id)
            const id = randomUUID(),
              expiresAt = Date.now() + 3 * 60_000
            this.confirmations.set(id, {
              sessionId,
              head: inspected.head,
              fingerprint: inspected.fingerprint,
              archiveEpoch: this.epochs.get(sessionId) ?? 0,
              expiresAt,
            })
            return {
              state: 'confirm',
              record: sessionView(record),
              confirmation: { id, expiresAt, head: inspected.head, files: inspected.files },
            }
          }
          await this.idle(record)
          if (
            this.ctx.sandboxPolicy.resolve({ session: agent.session }).mode !== 'danger-full-access'
          )
            throw new SessionWorktreeError('Permissions changed before removal. Checkout retained.')
          const outcome = await this.git.removeOwned(record, {
            ...(confirmation ? { discard: true, fingerprint: confirmation.fingerprint } : {}),
            signal,
            authorize,
          })
          record = await this.save(record, {
            state: 'removed',
            head: outcome.head,
            branchDeleted: outcome.branchDeleted,
            message: outcome.branchDeleted
              ? 'Checkout removed; safely merged branch deleted.'
              : 'Checkout removed; branch retained because it is not safely merged.',
          })
          return { state: 'removed', record: sessionView(record) }
        })
      } catch (error) {
        // A Git response or outcome write can fail after removal. Our persisted
        // tip and immutable recovery ref let a later pass prove that completion.
        try {
          const completed = await this.git.removalOutcome(record)
          if (completed) {
            record = await this.save(record, {
              ...completed,
              state: 'removed',
              message:
                'Checkout removal completed; committed work remains available for restoration.',
            })
            return { state: 'removed', record: sessionView(record) }
          }
        } catch {
          /* Uncertain identity or persistence: retain pending recovery state. */
        }
        const message =
          error instanceof SessionWorktreeError
            ? error.message
            : 'Cleanup could not verify or remove this checkout. Inspect it before retrying; files or branch may remain.'
        record = await this.save(record, { state: 'pending', message })
        if (confirmationId) throw new SessionWorktreeError(message)
        return { state: 'pending', record: sessionView(record) }
      } finally {
        this.manager.checkoutOperations.delete(record.path)
      }
    })
  }
  async restore(sessionId: string) {
    return this.lock(sessionId, async () => {
      let record = this.owned(sessionId)
      this.manager.checkoutOperations.add(record.path)
      try {
        const agent = await this.authority(record)
        if (agent.status !== 'idle' || this.manager.activeWorktrees().has(record.path))
          throw new SessionWorktreeError('Stop active work before restoring this checkout.')
        await agent.runMaintenance(async (maintenanceSignal) => {
          const signal = AbortSignal.any([maintenanceSignal, this.lifecycle.signal])
          this.check()
          const epoch = this.epochs.get(sessionId) ?? 0
          const authorize = () => {
            this.assertAuthority(agent)
            this.assertJobsIdle(record)
            if ((this.epochs.get(sessionId) ?? 0) !== epoch)
              throw new SessionWorktreeError(
                'Archive state changed during restoration; checkout retained.',
              )
          }
          const restored = await this.git.restoreOwned(record, { signal, authorize })
          record = await this.save(record, { head: restored.head })
          authorize()
          let workspace = record.workspaceId
            ? this.ctx.workspaceRegistry.get(WorkspaceId(record.workspaceId))
            : undefined
          if (!workspace) {
            workspace = await this.ctx.workspaceRegistry.create(record.path)
            await workspace.setTitle(`Worktree: ${record.requestId.slice(0, 8)}`)
            record = await this.save(record, { workspaceId: workspace.id })
          }
          // Missing-directory indexing can leave an accounted but filtered id.
          // Detach+attach deliberately revalidates its immutable cwd after restore.
          authorize()
          await workspace.detachSession(SessionId(sessionId))
          await workspace.attachSession(SessionId(sessionId))
          authorize()
          record = await this.save(record, { state: 'active', message: '', branchDeleted: false })
          authorize()
          await this.ctx.workspaceRegistry.unarchiveSession(SessionId(sessionId))
        })
        return sessionView(record)
      } catch (error) {
        if (error instanceof SessionWorktreeError) throw error
        throw new SessionWorktreeError(
          'Restore failed. The session remains archived where possible; inspect the retained checkout before retrying.',
        )
      } finally {
        this.manager.checkoutOperations.delete(record.path)
      }
    })
  }
  archiveChanged(before: readonly string[], after: readonly string[]) {
    for (const id of new Set([...before, ...after]))
      if (before.includes(id) !== after.includes(id)) {
        this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1)
        for (const [token, preview] of this.confirmations)
          if (preview.sessionId === id) this.confirmations.delete(token)
      }
    // Domain change emits before WorkspaceRegistry updates its cached archive set.
    // Never await cleanup from the emitter; reconcile only after the native write returns.
    setImmediate(() => {
      if (this.active) void this.reconcile().catch(() => {})
    })
  }
  async reconcile() {
    if (!this.active) return
    for (const [id, record] of this.records.entries()) {
      if (!this.active) break
      if (
        this.archived(id) &&
        record.state !== 'removed' &&
        record.state !== 'creating' &&
        record.state !== 'error' &&
        !this.locks.has(id)
      )
        await this.cleanup(id, undefined, false)
    }
  }
  async beforeStep(agent: Agent) {
    const record = this.records.get(agent.session.id)
    if (record && record.state !== 'active') return false
    const cwd = agent.session.header.cwd
    if (cwd) {
      let canonical = cwd
      try {
        canonical = await realpath(cwd)
      } catch {
        /* Missing owned paths are refused below. */
      }
      if (
        [...this.manager.checkoutOperations].some(
          (path) => canonical === path || canonical.startsWith(`${path}/`),
        )
      )
        return false
    }
    if (record) {
      try {
        await this.git.assertOwnedCheckout(record)
      } catch {
        return false
      }
    }
    return true
  }
  async dispose() {
    this.active = false
    this.lifecycle.abort('Session worktree plugin unloaded')
    this.confirmations.clear()
    await Promise.allSettled([...this.operations])
    for (const off of this.promptDisposers) off()
    this.promptDisposers.clear()
    await this.domain.close()
  }
}
