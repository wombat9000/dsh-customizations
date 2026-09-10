import { credentialRef } from '@deepseek-ai/dsh-credentials'
import '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { publicUser, publicWorkspace } from './linear.js'

export const LINEAR_CREDENTIAL_REF = credentialRef('LINEAR_API_KEY')
export const LINEAR_SETTINGS_NAMESPACE = 'linear'
export const LINEAR_SETTINGS_CHANNEL = '/linear-integration'

export const LinearSettingsSchema = z.object({
  organizationId: z.string().default(''),
  organizationName: z.string().default(''),
  organizationUrlKey: z.string().default(''),
})

export const EMPTY_LINEAR_SETTINGS = Object.freeze({
  organizationId: '',
  organizationName: '',
  organizationUrlKey: '',
})

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function internalError(error) {
  return {
    ok: false,
    error: {
      code: 'linear-settings-error',
      message: messageOf(error),
      details: {},
    },
  }
}

export function apiKeyFailure(value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    return 'Enter a Linear API key.'
  }
  const trimmed = value.trim()
  if (!/^[\x21-\x7e]+$/u.test(trimmed)) {
    return 'Use an unquoted API key containing printable characters only.'
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(trimmed)
    || ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return 'Paste only the API key, without LINEAR_API_KEY= or surrounding quotes.'
  }
}

export function installLinearSettings(ctx, entry = {}) {
  let source = () => ({ ...EMPTY_LINEAR_SETTINGS, ...entry })
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(
      ctx,
      LINEAR_SETTINGS_NAMESPACE,
      LinearSettingsSchema,
      { ...EMPTY_LINEAR_SETTINGS, ...entry },
      {
        setSource(current) { source = current },
        onChange() {},
      },
    )
  })
  return () => source()
}

async function credentialStatus(ctx, literalApiKey) {
  if (typeof literalApiKey === 'string' && literalApiKey.length > 0) {
    return { configured: true, writable: false, source: 'composition' }
  }
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return { configured: false, writable: false }
  return credentials.describe(LINEAR_CREDENTIAL_REF)
}

function storedWorkspace(config) {
  if (!config.organizationId) return null
  return {
    id: config.organizationId,
    name: config.organizationName || config.organizationId,
    urlKey: config.organizationUrlKey,
  }
}

export function registerLinearSettingsRpc(ctx, options) {
  const connection = ctx.get('connection')
  if (connection === undefined) return
  const { runtime, settings, literalApiKey } = options

  const localStatus = async () => ({
    credential: await credentialStatus(ctx, literalApiKey),
    workspace: storedWorkspace(settings()),
    viewer: null,
    live: false,
  })

  const writeSettings = async (patch) => {
    const service = ctx.get('settings')
    if (service === undefined) throw new Error('DSH settings storage is unavailable.')
    await service.update(LINEAR_SETTINGS_NAMESPACE, patch)
  }

  const bindWorkspace = async (workspace) => writeSettings({
    organizationId: workspace.id,
    organizationName: workspace.name,
    organizationUrlKey: workspace.urlKey,
  })

  const probeKey = async (apiKey, signal) => {
    const client = runtime.createClient(apiKey, signal)
    const [organization, viewer] = await Promise.all([client.organization, client.viewer])
    return {
      workspace: publicWorkspace(organization),
      viewer: publicUser(viewer),
    }
  }

  ctx.effect(() => connection.rpc.handle(
    LINEAR_SETTINGS_CHANNEL,
    async (endpoint, payload, signal) => {
      try {
        if (endpoint === 'status') return { ok: true, value: await localStatus() }

        if (endpoint === 'test') {
          const live = await runtime.workspace(signal)
          if (!settings().organizationId) await bindWorkspace(live.workspace)
          return {
            ok: true,
            value: {
              ...(await localStatus()),
              workspace: live.workspace,
              viewer: live.viewer,
              live: true,
            },
          }
        }

        if (endpoint === 'connect') {
          if (typeof literalApiKey === 'string' && literalApiKey.length > 0) {
            throw new Error('The Linear key is fixed by the composition and cannot be replaced here.')
          }
          const failure = apiKeyFailure(payload?.apiKey)
          if (failure !== undefined) throw new Error(failure)
          const credentials = ctx.get('credentials')
          if (credentials === undefined) throw new Error('DSH credential storage is unavailable.')
          const info = await credentials.describe(LINEAR_CREDENTIAL_REF)
          if (!info.writable) throw new Error('LINEAR_API_KEY is supplied by a read-only source and cannot be replaced here.')
          const value = payload.apiKey.trim()
          const live = await probeKey(value, signal)
          await credentials.set(LINEAR_CREDENTIAL_REF, value)
          await bindWorkspace(live.workspace)
          return {
            ok: true,
            value: {
              ...(await localStatus()),
              ...live,
              live: true,
            },
          }
        }

        if (endpoint === 'disconnect') {
          if (typeof literalApiKey === 'string' && literalApiKey.length > 0) {
            throw new Error('The Linear key is fixed by the composition and cannot be removed here.')
          }
          const credentials = ctx.get('credentials')
          if (credentials === undefined) throw new Error('DSH credential storage is unavailable.')
          const info = await credentials.describe(LINEAR_CREDENTIAL_REF)
          if (!info.writable) throw new Error('LINEAR_API_KEY is supplied by a read-only source and cannot be removed here.')
          await credentials.unset(LINEAR_CREDENTIAL_REF)
          await writeSettings({ ...EMPTY_LINEAR_SETTINGS })
          return { ok: true, value: await localStatus() }
        }

        throw new Error('Unknown Linear settings endpoint.')
      } catch (error) {
        return internalError(error)
      }
    },
    { authority: 'trusted-host' },
  ), 'linear: settings RPC')
}
