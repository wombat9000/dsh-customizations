// Brand actual integration definitions, not preset names or look-alike tools.
const definitions = new WeakSet()
export function markIntegrationTool(tool) { definitions.add(tool); return tool }
export function hasWorktreeCapability(ctx, agent) {
  return Boolean(agent && ctx.agents.get(agent.session.id) === agent &&
    definitions.has(ctx.tools.get('worktree_list', agent)))
}
