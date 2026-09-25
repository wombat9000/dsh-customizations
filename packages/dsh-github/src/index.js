import { createGitHubRuntime } from './runtime.js'
import { createGitHubTools } from './tools.js'
import { createGitHubWriteRuntime } from './write-runtime.js'
import { registerGitHubWriteTools } from './write-tools.js'
import { createGitHubGrantRuntime } from './grants.js'
import { createGrantCaller, registerGitHubGrantTools } from './grant-tools.js'
import { createGitHubPresentation } from './presentation.js'
import { registerGitHubRoutes } from './routes.js'

export * from './runtime.js'
export * from './tools.js'
export * from './write-runtime.js'
export * from './write-tools.js'
export const name = 'github'
export const inject = ['tools', 'subprocess']

// Shared host service, with authority bound to exact live root sessions only.
export function apply(ctx) {
  const writes = createGitHubWriteRuntime(ctx.subprocess)
  const grants = createGitHubGrantRuntime(writes)
  const runtime = createGitHubRuntime(ctx.subprocess, {
    onAccount: (actor) => grants.observeAccount(actor),
  })
  for (const tool of createGitHubTools(runtime)) ctx.tools.register(tool)
  const grantCaller = createGrantCaller(ctx)
  const agents = {
    get: (id) => ctx.get('agents')?.get(id),
    roots: () => ctx.get('agents')?.roots() ?? [],
  }
  const presentation = createGitHubPresentation({ agents, grants, caller: grantCaller })
  ctx.effect(() => () => {
    grants.dispose()
    presentation.dispose()
  })
  ctx.on('agent/disposed', ({ agent }) => {
    grants.disposeSession(agent.session)
    presentation.disposeSession(agent.session)
  })
  registerGitHubGrantTools(ctx, grants, grantCaller, presentation)
  registerGitHubWriteTools(ctx, writes, { grants, grantCaller, presentation })
  registerGitHubRoutes(ctx, presentation)
}
