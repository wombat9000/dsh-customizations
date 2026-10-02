import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Brand actual integration definitions, not preset names or look-alike tools.
const definitions = new WeakSet()
export function markIntegrationTool<T extends object>(tool: T): T {
  definitions.add(tool)
  return tool
}
export function hasWorktreeCapability(
  ctx: Pick<Context, 'agents' | 'tools'>,
  agent: Agent | undefined,
) {
  return Boolean(
    agent &&
    ctx.agents.get(agent.session.id) === agent &&
    isIntegrationTool(ctx.tools.get('worktree_list', agent)),
  )
}

function isIntegrationTool(tool: object | undefined) {
  return tool !== undefined && definitions.has(tool)
}
