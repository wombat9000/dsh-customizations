import { createHash } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_SETTINGS, normalizeSettings, RecapError, RecapRuntime } from './runtime.js'

export const name = 'wombat9000-session-recap'
export const inject = ['sessions', 'llm', 'connection', 'settings']
export const CHANNEL = '/session-recap'
export const Config = z.object({
  autoRecap: z.boolean().default(true),
  inactivityMinutes: z.number().step(1).min(1).max(10080).default(30),
  provider: z.string().default(''),
  model: z.string().default(''),
})

export function apply(ctx, config = {}) {
  let source = () => normalizeSettings({ ...DEFAULT_SETTINGS, ...config })
  ctx.settings.installSection(ctx, name, Config, source(), {
    setSource(current) { source = current },
    onChange() {},
  })
  const runtime = new RecapRuntime({ sessions: ctx.sessions, llm: ctx.llm, settings: () => source() })
  // This scope is opaque and contains no provider credentials.
  const storageScope = createHash('sha256').update(JSON.stringify([process.env.DSH_HOME ?? '', process.cwd(), name])).digest('hex').slice(0, 24)
  const settings = () => ({ ...normalizeSettings(source()), storageScope })
  ctx.effect(() => () => runtime.dispose())
  ctx.effect(() => ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
    try {
      let value
      if (endpoint === 'settings') value = settings()
      else if (endpoint === 'activity') value = runtime.activity(payload)
      else if (endpoint === 'recap') value = await runtime.recap(payload)
      else if (endpoint === 'models') {
        value = { providers: await Promise.all(ctx.llm.listProviders().map(async provider => ({
          id: provider.id, name: provider.name,
          models: (await ctx.llm.listModels(provider.id)).map(model => ({ id: model.id, name: model.name })),
        }))) }
      } else if (endpoint === 'configure') {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !Object.hasOwn(DEFAULT_SETTINGS, key))) throw new RecapError('invalid-settings', 'Provide only Session Recap settings.')
        const next = normalizeSettings({ ...source(), ...payload })
        if (Boolean(next.provider) !== Boolean(next.model)) throw new RecapError('invalid-settings', 'Choose both a provider and model, or clear both.')
        if (next.provider) {
          const prepared = await ctx.llm.prepareCall({ provider: next.provider, model: next.model, maxTokens: 1400 }, AbortSignal.timeout(10000))
          if (prepared.config.provider !== next.provider || prepared.config.model !== next.model || (prepared.inputModalities && !prepared.inputModalities.includes('text'))) throw new RecapError('invalid-model', 'Choose a valid model that accepts text.')
        }
        await ctx.settings.update(name, next)
        value = settings()
      } else throw new RecapError('unknown-endpoint', 'Unknown Session Recap endpoint.')
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error: { code: error instanceof RecapError ? error.code : 'recap-error', message: error instanceof RecapError ? error.message : 'Session Recap could not complete this request. Check the provider configuration.' } }
    }
  }))
}
