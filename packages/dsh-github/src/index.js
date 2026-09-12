import { createGitHubRuntime } from './runtime.js'
import { createGitHubTools } from './tools.js'
import { createGitHubWriteRuntime } from './write-runtime.js'
import { registerGitHubWriteTools } from './write-tools.js'

export * from './runtime.js'
export * from './tools.js'
export * from './write-runtime.js'
export * from './write-tools.js'
export const name = 'github'
export const inject = ['tools', 'subprocess']

// Host-wide registration: no preset, toolbar toggle, or persisted target binding.
export function apply(ctx) {
  const runtime = createGitHubRuntime(ctx.subprocess)
  for (const tool of createGitHubTools(runtime)) ctx.tools.register(tool)
  registerGitHubWriteTools(ctx, createGitHubWriteRuntime(ctx.subprocess))
}
