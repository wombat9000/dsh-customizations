import { DispatchError } from './contracts.js'
import { Repositories, createGitRunner } from './repositories.js'
import { CHANNEL, createRpcHandler } from './routes.js'
import { DispatchService } from './service.js'
import { Sessions } from './sessions.js'
import { domainStore, memoryStore } from './store.js'
import type { WaitFn } from './tools.js'
import type {
  ConnectionLike,
  DefaultModelLike,
  Dispose,
  SessionControllerLike,
  StorageDomainLike,
  WorkingDirectoryLike,
  WorktreesLike,
} from './types.js'

export { DispatchService, COORDINATOR_PRESET, WORKER_PRESET } from './service.js'
export { DispatchError } from './contracts.js'
export { CHANNEL } from './routes.js'

/** Host context members this plugin reads; all are trusted in-process services. */
export interface HostContext {
  get(name: string): unknown
  provide(name: string, value: unknown): void
  effect(effect: () => Dispose | (() => Promise<void>)): unknown
  inject(names: string[], callback: (scope: HostContext) => void): unknown
  storageDomain?: StorageDomainLike
  logger?: { warn(message: string): void }
}

export const name = 'local-dispatch'
export const inject = ['storageDomain']

export interface Config {
  gitCommand?: string
  gitTimeoutMs?: number
}

/**
 * One Host-scoped Dispatch owner shared by every coordinator, so ownership,
 * approvals, and delivery have a single serialized registry outside preset revisions.
 */
export async function apply(ctx: HostContext, config: Config = {}) {
  let store
  try {
    store = await domainStore(ctx.storageDomain!)
  } catch {
    ctx.logger?.warn(
      'Dispatch storage is unavailable; using in-memory records for this Host lifetime.',
    )
    store = memoryStore()
  }
  const sessions = new Sessions(
    () => ctx.get('sessionController') as SessionControllerLike | undefined,
    () => ctx.get('workingDirectory') as WorkingDirectoryLike | undefined,
  )
  const service = new DispatchService({
    store,
    sessions,
    repositories: new Repositories(
      createGitRunner({
        ...(config.gitCommand !== undefined ? { command: config.gitCommand } : {}),
        ...(config.gitTimeoutMs !== undefined ? { timeoutMs: config.gitTimeoutMs } : {}),
      }),
    ),
    worktrees: () => ctx.get('worktrees') as WorktreesLike | undefined,
    defaultModel: () => ctx.get('agentDefaultModel') as DefaultModelLike | undefined,
    presets: async () => {
      const registry = ctx.get('agentPresets') as { list(): Promise<{ id: string }[]> } | undefined
      return registry ? (await registry.list()).map((preset) => preset.id) : []
    },
  })
  ctx.effect(() => () => service.dispose())
  ctx.provide('localDispatch', service)
  // Reconcile after the session controller can resolve coordinators; never blocks Host start.
  ctx.inject(['sessionController'], () => {
    void service.recover().catch(() => ctx.logger?.warn('Dispatch recovery left items pending.'))
  })
  ctx.inject(['connection', 'webServer'], (scope) => {
    const connection = scope.get('connection') as ConnectionLike
    scope.effect(() => connection.rpc.handle(CHANNEL, createRpcHandler(service)))
  })
}

export function createWait(service: DispatchService): WaitFn {
  return async (exec, workerId, timeoutSeconds) => {
    const timeout = timeoutSeconds === undefined ? 60 : timeoutSeconds
    if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 600)
      throw new DispatchError('invalid', 'Use timeoutSeconds 1–600.')
    const status = await service.status(exec.agent, workerId)
    if (!status.eligible) return { outcome: 'ineligible', status }
    const live = await service.liveWorker(exec.agent, status.workerId)
    if (live.status === 'idle' || !live.whenIdle) return { outcome: 'idle', status }
    const controller = new AbortController()
    const signals = [controller.signal, ...(exec.signal ? [exec.signal] : [])]
    const result = await new Promise<string>((done) => {
      const timer = setTimeout(() => done('timeout'), timeout * 1000)
      const finish = (value: string) => {
        clearTimeout(timer)
        done(value)
      }
      live.whenIdle!().then(
        () => finish('idle'),
        () => finish('idle'),
      )
      for (const signal of signals)
        signal.addEventListener('abort', () => finish('cancelled'), { once: true })
    })
    controller.abort()
    const next = await service.status(exec.agent, workerId)
    return {
      outcome:
        result === 'idle' && next.workState === 'waiting-for-user' ? 'waiting-for-user' : result,
      note: 'Idle is not completion; check workState and the latest report.',
      status: next,
    }
  }
}
