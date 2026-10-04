import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import { workspaceDomainState } from '@deepseek-ai/dsh-workspace'
import { z } from 'zod'
import { SESSION_CHANNEL, type SessionRpcResult } from '../shared/session-contracts.js'
import { sessionWorktreeDomain } from './session-store.js'
import { SessionWorktreeRuntime, SessionWorktreeError } from './session-runtime.js'
import type { WorktreeManager } from './index.js'

const id = z.string().min(1).max(200)
const inputs = {
  status: z.object({ sessionId: id.optional() }).strict(),
  preference: z.object({ workspaceId: id, enabled: z.boolean() }).strict(),
  create: z.object({ sessionId: id, requestId: z.uuid() }).strict(),
  cleanup: z.object({ sessionId: id, confirmationId: z.uuid().optional() }).strict(),
  restore: z.object({ sessionId: id }).strict(),
}
export async function mountSessionWorktrees(ctx: Context, manager: WorktreeManager) {
  const domain = await ctx.storageDomain.open(sessionWorktreeDomain)
  const runtime = new SessionWorktreeRuntime(ctx, manager, domain)
  ctx.effect(() => () => runtime.dispose())
  let archived: readonly string[] = [...ctx.workspaceRegistry.archivedSessionIds]
  ctx.on('domain/changed', (change) => {
    if (
      change.domain !== 'workspace' ||
      change.table !== '' ||
      change.key !== '' ||
      change.operation !== 'put'
    )
      return
    const next = workspaceDomainState.parse(change.value).archivedSessionIds
    runtime.archiveChanged(archived, next)
    archived = next
  })
  ctx.on('agent/pre-step', async (payload, next) =>
    (await runtime.beforeStep(payload.agent)) ? next() : { kind: 'reject' },
  )
  const reconcile = () => {
    void runtime.reconcile().catch(() => {})
  }
  ctx.on('agent/created', ({ agent }) => {
    runtime.observeAgent(agent)
    return undefined
  })
  for (const agent of ctx.agents.list()) runtime.observeAgent(agent)
  ctx.on('agent/status', reconcile)
  ctx.on('agent/disposed', reconcile)
  ctx.effect(() => {
    const timer = setInterval(reconcile, 10000)
    timer.unref()
    return () => clearInterval(timer)
  })
  ctx.inject(['connection', 'webServer'], (scope) => {
    scope.effect(() =>
      scope.connection.rpc.handle(
        SESSION_CHANNEL,
        async (endpoint, input): Promise<SessionRpcResult<unknown>> => {
          try {
            switch (endpoint) {
              case 'status':
                return {
                  ok: true,
                  value: await runtime.status(inputs.status.parse(input).sessionId),
                }
              case 'preference': {
                const args = inputs.preference.parse(input)
                return { ok: true, value: await runtime.preference(args.workspaceId, args.enabled) }
              }
              case 'create': {
                const args = inputs.create.parse(input)
                return { ok: true, value: await runtime.create(args.sessionId, args.requestId) }
              }
              case 'cleanup': {
                const args = inputs.cleanup.parse(input)
                return {
                  ok: true,
                  value: await runtime.cleanup(args.sessionId, args.confirmationId),
                }
              }
              case 'restore':
                return {
                  ok: true,
                  value: await runtime.restore(inputs.restore.parse(input).sessionId),
                }
              default:
                throw new SessionWorktreeError('Unknown Session worktrees action.')
            }
          } catch (error) {
            return {
              ok: false,
              error: {
                code: 'worktree-sessions/failed',
                message:
                  error instanceof SessionWorktreeError
                    ? error.message
                    : 'Session worktrees could not complete this request. Refresh and inspect retained state before retrying.',
                details: {},
              },
            }
          }
        },
      ),
    )
  })
  reconcile()
}
