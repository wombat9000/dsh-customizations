import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { LinearRuntime } from './runtime.js'
import {
  installLinearSettings,
  LINEAR_CREDENTIAL_REF,
  registerLinearSettingsRpc,
} from './settings.js'
import { registerLinearTools } from './tools/index.js'

export * from './linear.js'
export { registerLinearTools } from './tools/index.js'
export {
  apiKeyFailure,
  EMPTY_LINEAR_SETTINGS,
  LINEAR_CREDENTIAL_REF,
  LINEAR_SETTINGS_CHANNEL,
  LINEAR_SETTINGS_NAMESPACE,
  LinearSettingsSchema,
} from './settings.js'

export const name = 'linear'
export const inject = ['tools', 'systemPrompt', 'connection', 'webServer']
export const DEFAULT_MAX_DESCRIPTION_CHARS = 12_000
export const DEFAULT_MAX_COMMENT_CHARS = 8_000
export const DEFAULT_TIMEOUT_MS = 30_000

export const Config = z.object({
  apiKey: z.string().role('secret'),
  organizationId: z.string().default(''),
  organizationName: z.string().default(''),
  organizationUrlKey: z.string().default(''),
  maxDescriptionChars: z.number().step(1).min(1).default(DEFAULT_MAX_DESCRIPTION_CHARS),
  maxCommentChars: z.number().step(1).min(1).default(DEFAULT_MAX_COMMENT_CHARS),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
})

function resolvedConfig(config = {}) {
  return {
    apiKey: typeof config.apiKey === 'string' && config.apiKey.length > 0 ? config.apiKey : undefined,
    organizationId: config.organizationId ?? '',
    organizationName: config.organizationName ?? '',
    organizationUrlKey: config.organizationUrlKey ?? '',
    maxDescriptionChars: config.maxDescriptionChars ?? DEFAULT_MAX_DESCRIPTION_CHARS,
    maxCommentChars: config.maxCommentChars ?? DEFAULT_MAX_COMMENT_CHARS,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }
}

export function apply(ctx, config = {}) {
  const resolved = resolvedConfig(config)
  const settingsEntry = {
    organizationId: resolved.organizationId,
    organizationName: resolved.organizationName,
    organizationUrlKey: resolved.organizationUrlKey,
  }
  const settings = installLinearSettings(ctx, settingsEntry)
  const runtime = new LinearRuntime({
    settings,
    maxDescriptionChars: resolved.maxDescriptionChars,
    maxCommentChars: resolved.maxCommentChars,
    resolveApiKey: async () => {
      if (resolved.apiKey !== undefined) return resolved.apiKey
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(LINEAR_CREDENTIAL_REF))?.value
      return launchEnvironmentOf(ctx).get(LINEAR_CREDENTIAL_REF)?.value
    },
  })
  registerLinearSettingsRpc(ctx, { runtime, settings, literalApiKey: resolved.apiKey })
  registerLinearTools(ctx, runtime, resolved)
}
