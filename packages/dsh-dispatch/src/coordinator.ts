import { createWait } from './index.js'
import type { DispatchService } from './service.js'
import { installCoordinator, restrictCoordinatorAgent } from './tools.js'
import type { AgentLike, Dispose, ToolsRegistry } from './types.js'

export const name = 'local-dispatch-coordinator'
export const inject = ['tools', 'localDispatch']

/**
 * Preset row for `dispatch`. Mounted once per preset revision, so tools are
 * registered in the preset scope and bind identity per call from the executing
 * Agent. Shared state stays in the Host `localDispatch` service.
 */
export function apply(ctx: {
  tools: ToolsRegistry
  localDispatch: DispatchService
  effect(effect: () => Dispose): unknown
  on(event: 'agent/created', listener: (payload: { agent: AgentLike }) => void): unknown
}) {
  const service = ctx.localDispatch
  ctx.effect(() => installCoordinator(ctx.tools, service, createWait(service)))
  // Scope-filtered: this preset-scoped listener receives only Agents composed under this revision.
  ctx.on('agent/created', ({ agent }) => {
    const tools = agent.ctx?.get('tools')
    if (!tools)
      throw new Error('Dispatch cannot restrict this Agent: its tool registry is unavailable.')
    // Registered through agent.ctx, so it is disposed with the Agent's scope.
    restrictCoordinatorAgent(tools)
  })
}
