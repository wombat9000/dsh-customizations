import type { IncomingMessage, ServerResponse } from 'node:http'
import { isRecord } from '../shared/contracts.js'
import type { AuthStatus, Authorization, SettingsAction } from '../shared/contracts.js'
import type { RouteContext } from './contracts.js'
interface SettingsService {
  useSandbox?: boolean
  status(): Promise<AuthStatus>
  begin(): Promise<Authorization>
  configure(text: string): Promise<unknown>
  clearConfig(): Promise<unknown>
  setCallbackMode(value: boolean): Promise<unknown>
  cancel(): Promise<unknown>
  disconnect(): Promise<unknown>
}
type Body =
  | { action: 'configure'; clientJson: string }
  | { action: 'callback-mode'; useSandbox: boolean }
  | { action: Exclude<SettingsAction, 'configure' | 'callback-mode'> }
const PREFIX = '/api/plugins/google-auth/'
const ACTIONS: SettingsAction[] = [
  'status',
  'connect',
  'cancel',
  'disconnect',
  'configure',
  'clear-config',
  'callback-mode',
]
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function reply(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  res.end(JSON.stringify(value))
}

export function allowedRequest(req: Pick<IncomingMessage, 'socket' | 'headers'>, port: number) {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return false
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])
  const host = req.headers.host
  return (
    typeof host === 'string' &&
    hosts.has(host) &&
    req.headers.origin === `http://${host}` &&
    req.headers['x-dsh-google-auth'] === '1' &&
    req.headers['content-type'] === 'application/json' &&
    (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin')
  )
}

async function readBody(req: IncomingMessage, action: SettingsAction): Promise<Body | undefined> {
  let size = 0
  const chunks: Buffer[] = []
  const timer = setTimeout(() => req.destroy(), 5000)
  timer.unref?.()
  try {
    for await (const raw of req) {
      const chunk: unknown = raw
      if (!(chunk instanceof Uint8Array)) return undefined
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > (action === 'configure' ? 65536 : 1024)) return undefined
      chunks.push(bytes)
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!isRecord(data)) return undefined
    if (action === 'configure')
      return Object.keys(data).length === 1 &&
        typeof data.clientJson === 'string' &&
        data.clientJson.length <= 32768
        ? { action, clientJson: data.clientJson }
        : undefined
    if (action === 'callback-mode')
      return Object.keys(data).length === 1 && typeof data.useSandbox === 'boolean'
        ? { action, useSandbox: data.useSandbox }
        : undefined
    return Object.keys(data).length === 0 ? { action } : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

export function settingsHandler(service: SettingsService, action: string, port: number) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (!allowedRequest(req, port)) {
      reply(res, 403, {
        ok: false,
        error: { message: 'Open Settings on the local DSH URL to manage Google accounts.' },
      })
      return
    }
    if (req.method !== 'POST') {
      reply(res, 405, { ok: false, error: { message: 'Use POST.' } })
      return
    }
    const knownAction = ACTIONS.find((candidate) => candidate === action)
    const body = knownAction ? await readBody(req, knownAction) : undefined
    if (body === undefined) {
      reply(res, 400, {
        ok: false,
        error: { message: 'Invalid Google accounts settings request.' },
      })
      return
    }
    try {
      // Explicit projections keep credentials and future internal fields off wire.
      let safe: unknown = {}
      if (body.action === 'status') {
        const value = await service.status()
        safe = {
          configured: value.configured === true,
          connected: value.connected === true,
          pending: value.pending === true,
          useSandbox: value.useSandbox === true,
          sandboxAvailable: value.sandboxAvailable === true,
          ...(typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt)
            ? { expiresAt: value.expiresAt }
            : {}),
          ...(typeof value.error === 'string' ? { error: value.error } : {}),
          ...(value.account
            ? {
                account: {
                  id: value.account.id,
                  ...(value.account.email ? { email: value.account.email } : {}),
                },
              }
            : {}),
          requiredScopes: [...value.requiredScopes],
          missingScopes: [...value.missingScopes],
          integrations: value.integrations.map((item) => ({
            id: item.id,
            label: item.label,
            scopes: [...item.scopes],
            authorized: item.authorized === true,
            missingScopes: [...item.missingScopes],
          })),
        }
      } else if (body.action === 'connect') {
        const value = await service.begin()
        safe = { authorizationUrl: value.authorizationUrl, expiresAt: value.expiresAt }
      } else if (body.action === 'configure') await service.configure(body.clientJson)
      else if (body.action === 'clear-config') await service.clearConfig()
      else if (body.action === 'callback-mode') await service.setCallbackMode(body.useSandbox)
      else await service[body.action]()
      reply(res, 200, { ok: true, value: safe })
    } catch {
      reply(res, 400, {
        ok: false,
        error: {
          message:
            action === 'callback-mode'
              ? 'Could not change callback mode. Sign-in may be finishing or settings may be read-only; retry after completion.'
              : action === 'connect'
                ? service.useSandbox === true
                  ? 'Could not start Google login. Check client configuration and the sandbox bridge/helper. No direct callback fallback was used.'
                  : 'Could not start Google login. Check client configuration and enabled integrations, then retry.'
                : action === 'configure'
                  ? 'Could not save configuration. Paste downloaded Google Desktop client JSON and check credential storage access.'
                  : action === 'cancel'
                    ? 'Sign-in could not be cancelled. It may be finishing; wait for completion, then disconnect if needed.'
                    : 'Google accounts operation failed. Check connection status and retry.',
        },
      })
    }
  }
}

export function registerSettingsRoutes(ctx: RouteContext, service: SettingsService) {
  for (const action of ACTIONS) {
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: PREFIX + action,
        handler: settingsHandler(service, action, ctx.webServer.port),
      }),
    )
  }
}
