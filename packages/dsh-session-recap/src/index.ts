import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type { ModelCatalog, Sessions } from './host-types.js'
import type {
  ModelsResult,
  RpcEndpoints,
  RpcResult,
  ScopedSettings,
  Settings,
} from '../shared/contracts.js'

// RPC accepts untrusted payloads. Each handler must produce its shared wire result.
type Handlers = {
  [E in keyof RpcEndpoints]: (
    payload: unknown,
  ) => RpcEndpoints[E]['result'] | Promise<RpcEndpoints[E]['result']>
}
type HostContext = Context & {
  sessions: Sessions
  llm: ModelCatalog
  connection: {
    rpc: {
      handle(
        channel: string,
        callback: (
          endpoint: string,
          payload: unknown,
        ) => Promise<RpcResult<RpcEndpoints[keyof RpcEndpoints]['result']>>,
      ): () => void
    }
  }
}
import z from '@deepseek-ai/schemastery'
import { DEFAULT_SETTINGS, normalizeSettings, RecapError, RecapRuntime } from './runtime.js'

export const name = 'wombat9000-session-recap'
export const inject = ['sessions', 'llm', 'connection', 'settings', 'webServer']
export const CHANNEL = '/session-recap'
export const Config = z.object({
  autoRecap: z.boolean().default(true),
  useJev: z.boolean().default(false),
  inactivityMinutes: z.number().step(1).min(1).max(10080).default(30),
  provider: z.string().default(''),
  model: z.string().default(''),
})

async function listModels(llm: ModelCatalog): Promise<ModelsResult> {
  const providers = await Promise.all(
    llm.listProviders().map(async (provider) => ({
      id: provider.id,
      name: provider.name,
      models: (await llm.listModels(provider.id)).map((model) => ({
        id: model.id,
        name: model.name,
      })),
    })),
  )
  return { providers }
}

async function validateRoute(llm: ModelCatalog, settings: Settings) {
  if (!settings.provider) return

  const prepared = await llm.prepareCall(
    {
      provider: settings.provider,
      model: settings.model,
      maxTokens: 1400,
    },
    AbortSignal.timeout(10000),
  )
  const routeChanged =
    prepared.config.provider !== settings.provider || prepared.config.model !== settings.model
  const rejectsText = prepared.inputModalities && !prepared.inputModalities.includes('text')
  if (routeChanged || rejectsText) {
    throw new RecapError('invalid-model', 'Choose a valid model that accepts text.')
  }
}

function updatedSettings(source: () => Settings, payload: unknown) {
  const invalidPayload = !payload || typeof payload !== 'object' || Array.isArray(payload)
  if (invalidPayload || Object.keys(payload).some((key) => !Object.hasOwn(DEFAULT_SETTINGS, key))) {
    throw new RecapError('invalid-settings', 'Provide only Session Recap settings.')
  }

  const next = normalizeSettings({ ...source(), ...payload })
  if (Boolean(next.provider) !== Boolean(next.model)) {
    throw new RecapError('invalid-settings', 'Choose both a provider and model, or clear both.')
  }
  return next
}

function rpcFailure(error: unknown): Extract<RpcResult<never>, { ok: false }> {
  // Provider exceptions can contain credentials or request bodies.
  const known = error instanceof RecapError
  return {
    ok: false,
    error: {
      code: known ? error.code : 'recap-error',
      message: known
        ? error.message
        : 'Session Recap could not complete this request. Check the provider configuration.',
      details: {},
    },
  }
}

export function apply(ctx: HostContext, config: Partial<Settings> = {}) {
  let source = () => normalizeSettings({ ...DEFAULT_SETTINGS, ...config })
  ctx.settings.installSection(ctx, name, Config, source(), {
    setSource(current) {
      source = current
    },
    onChange() {},
  })
  const runtime = new RecapRuntime({
    sessions: ctx.sessions,
    llm: ctx.llm,
    settings: () => source(),
    getJev: () => ctx.get('jev'),
  })
  // This scope is opaque and contains no provider credentials.
  const storageScope = createHash('sha256')
    .update(JSON.stringify([process.env.DSH_HOME ?? '', process.cwd(), name]))
    .digest('hex')
    .slice(0, 24)
  const settings = (): ScopedSettings => ({ ...normalizeSettings(source()), storageScope })

  const handlers: Handlers = {
    settings,
    activity: (payload) => runtime.activity(payload),
    recap: (payload) => runtime.recap(payload),
    models: () => listModels(ctx.llm),
    configure: async (payload) => {
      const next = updatedSettings(source, payload)
      await validateRoute(ctx.llm, next)
      await ctx.settings.update(name, next)
      return settings()
    },
  }
  function isEndpoint(endpoint: string): endpoint is keyof RpcEndpoints {
    return typeof endpoint === 'string' && Object.hasOwn(handlers, endpoint)
  }
  async function handle(endpoint: string, payload: unknown) {
    if (!isEndpoint(endpoint))
      throw new RecapError('unknown-endpoint', 'Unknown Session Recap endpoint.')
    return handlers[endpoint](payload)
  }

  ctx.effect(() => () => runtime.dispose())
  ctx.effect(() =>
    ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
      try {
        return { ok: true, value: await handle(endpoint, payload) }
      } catch (error) {
        return rpcFailure(error)
      }
    }),
  )
}
