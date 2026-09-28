import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type { RpcEndpoints, RpcResult } from '../shared/contracts.js'
import { ProjectsError, fail, parseConfiguration } from './configuration.js'
import { ProjectsService, type Providers } from './service.js'
import { createProjectTools, type ProjectTool } from './tools.js'

export { ProjectsService } from './service.js'
export const name = 'local-projects'
export const inject = ['tools']
export const CHANNEL = '/projects'
export const Config = z.object({
  catalogJson: z.string().default('{"teams":[],"projects":[]}').volatile(),
})
// The service is host-wide; RPC is attached only when Connection exists. No Session
// binding is synthesized for sidebar panels. Connection owns operator authentication.
export type ProjectsContext = Context & {
  tools: { register(tool: ProjectTool): () => void }
  fiber: Context['fiber'] & { entry?: { options: { id: string } } }
}
type Handlers = {
  [E in keyof RpcEndpoints]: (
    input: unknown,
    signal: AbortSignal,
  ) => RpcEndpoints[E]['result'] | Promise<RpcEndpoints[E]['result']>
}
interface Connection {
  rpc: {
    handle(
      channel: string,
      callback: (
        endpoint: string,
        input: unknown,
        signal: AbortSignal,
      ) => Promise<RpcResult<unknown>>,
    ): () => Promise<void>
  }
}
export function apply(ctx: ProjectsContext, config: ReturnType<typeof Config>) {
  parseConfiguration(config.catalogJson.get())
  const service = new ProjectsService({
    readConfiguration: () => config.catalogJson.get(),
    async saveConfiguration(value) {
      const settings: Context['settings'] | undefined = ctx.get('settings')
      const namespace = ctx.fiber.entry?.options.id
      if (!settings || !namespace) fail('settings')
      const descriptor = settings
        .describe({ redactSecrets: true })
        .find((item) => item.ns === namespace)
      if (!descriptor) fail('settings')
      try {
        // Settings checks this revision inside ConfigEditor's serialized edit, so
        // native settings edits cannot be overwritten by a queued Projects save.
        await settings.update(namespace, { catalogJson: value }, descriptor.revision)
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'SETTINGS_CONFLICT'
        )
          fail('conflict')
        fail('settings')
      }
    },
    providers: () => {
      const github: Providers['github'] = ctx.get('localGitHubReads')
      const linear: Providers['linear'] = ctx.get('localLinearReads')
      return { ...(github ? { github } : {}), ...(linear ? { linear } : {}) }
    },
  })
  ctx.provide('projects', service)
  ctx.effect(() => () => service.dispose())
  for (const tool of createProjectTools(service)) ctx.tools.register(tool)
  ctx.inject(['settings'], (scope) => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
  })
  // Generic Connection channels register physical Web routes on the caller's
  // scope; both dependencies must be admitted before mounting the handler.
  ctx.inject(['connection', 'webServer'], (scope) => {
    const connection: Connection = scope.get('connection')
    const handlers: Handlers = {
      catalog: (input) => service.catalog(input),
      project: (input) => service.project(input),
      issues: (input, signal) => service.issues(input, signal),
      configure: (input) => service.configure(input),
    }
    scope.effect(() =>
      connection.rpc.handle(CHANNEL, async (endpoint, input, signal) => {
        try {
          if (!Object.hasOwn(handlers, endpoint)) fail('invalid')
          if (signal.aborted) fail('cancelled')
          return { ok: true, value: await handlers[endpoint as keyof Handlers](input, signal) }
        } catch (error) {
          const safe = error instanceof ProjectsError ? error : new ProjectsError('failed')
          return { ok: false, error: { code: safe.code, message: safe.message, details: {} } }
        }
      }),
    )
  })
}
