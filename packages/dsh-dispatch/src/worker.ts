import type { DispatchService } from './service.js'
import { installWorker } from './tools.js'
import type { Dispose, ToolsRegistry } from './types.js'

export const name = 'local-dispatch-worker'
export const inject = ['tools', 'localDispatch']

/** Preset row for `dispatch-worker`: scoped reporting plus orchestration and provisioning guards. */
export function apply(ctx: {
  tools: ToolsRegistry
  localDispatch: DispatchService
  effect(effect: () => Dispose): unknown
}) {
  ctx.effect(() => installWorker(ctx.tools, ctx.localDispatch))
}
