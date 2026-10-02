import type { IncomingMessage, ServerResponse } from 'node:http'
import type { BrowserAction, BrowserInput, BrowserRuntime, Dispose } from './types.js'
import { isRecord } from './types.js'
export interface RouteContext {
  effect(effect: () => Dispose): unknown
  webServer: {
    port: number
    register(route: {
      kind: 'exact'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }): Dispose
  }
}
const PREFIX = '/api/plugins/google-drive/'
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const FIELDS: Record<BrowserAction, string[]> = {
  status: [],
  manage: [],
  revoke: [],
  browse: ['requestId', 'parentId', 'search', 'view', 'pageToken'],
  grant: ['requestId', 'selected'],
  deny: ['requestId'],
  'edit-status': [],
  'edit-manage': [],
  'edit-revoke': [],
  'edit-browse': ['requestId', 'parentId', 'search', 'view', 'pageToken'],
  'edit-grant': ['requestId', 'selected'],
  'edit-deny': ['requestId'],
  'preview-status': [],
  'preview-apply': ['requestId'],
  'preview-deny': ['requestId'],
  'session-status': [],
  'session-set': ['ownerId', 'revision', 'enabled'],
}
function reply(res: ServerResponse, code: number, value: unknown) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  res.end(JSON.stringify(value))
}
export function allowedRequest(req: IncomingMessage, port: number) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])
  return (
    LOOPBACK.has(req.socket.remoteAddress ?? '') &&
    hosts.has(req.headers.host ?? '') &&
    req.headers.origin === `http://${req.headers.host}` &&
    req.headers['x-dsh-google-drive'] === '1' &&
    req.headers['content-type'] === 'application/json' &&
    (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin')
  )
}
async function body(req: IncomingMessage, action: BrowserAction): Promise<BrowserInput> {
  let length = 0
  const chunks = []
  for await (const chunk of req) {
    length += chunk.length
    if (length > 32768) throw new Error('Request too large.')
    chunks.push(chunk)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (action === 'session-status' || action === 'session-set') {
    const keys = ['sessionId', ...FIELDS[action]]
    const identity = (field: unknown): field is string =>
      typeof field === 'string' && field.length > 0 && field.length <= 200
    if (
      !isRecord(value) ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      Object.keys(value).some((key) => !keys.includes(key)) ||
      !identity(value.sessionId) ||
      (action === 'session-set' &&
        (!identity(value.ownerId) ||
          !Number.isSafeInteger(value.revision) ||
          typeof value.revision !== 'number' ||
          value.revision < 0 ||
          typeof value.enabled !== 'boolean'))
    ) {
      throw new Error('Invalid Drive session request.')
    }
    return { ...value, sessionId: value.sessionId }
  }
  const keys = ['sessionId', 'callId', ...FIELDS[action]]
  if (
    !isRecord(value) ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    typeof value.sessionId !== 'string' ||
    typeof value.callId !== 'string' ||
    (Object.hasOwn(value, 'view') &&
      (typeof value.view !== 'string' || !['my-drive', 'shared-with-me'].includes(value.view))) ||
    Object.entries(value).some(
      ([key, field]) => key !== 'selected' && (typeof field !== 'string' || field.length > 4096),
    )
  ) {
    throw new Error('Invalid Drive permission request.')
  }
  return { ...value, sessionId: value.sessionId }
}
export function createHandler(runtime: BrowserRuntime, action: BrowserAction, port: number) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (!allowedRequest(req, port))
      return reply(res, 403, {
        ok: false,
        error: { message: 'Manage Drive access from the local DSH page.' },
      })
    if (req.method !== 'POST')
      return reply(res, 405, { ok: false, error: { message: 'Use POST.' } })
    const controller = new AbortController()
    const abort = () => controller.abort()
    req.once('aborted', abort)
    res.once('close', abort)
    const timeout = setTimeout(() => {
      controller.abort()
      req.destroy()
    }, 60000)
    timeout.unref?.()
    try {
      let input
      try {
        input = await body(req, action)
      } catch {
        return reply(res, 400, {
          ok: false,
          error: { message: 'Invalid Drive permission request.' },
        })
      }
      const result = await runtime[action](input, controller.signal)
      if (!controller.signal.aborted) reply(res, 200, { ok: true, value: result })
    } catch {
      // Never forward Google payloads, bearer values, arbitrary file names or stack traces.
      if (!controller.signal.aborted)
        reply(res, 409, {
          ok: false,
          error: {
            message:
              'Drive access could not be updated. The request may have expired, access may be disabled, or Google may need reconnecting. Close the picker and try again.',
          },
        })
    } finally {
      clearTimeout(timeout)
      req.removeListener('aborted', abort)
      res.removeListener('close', abort)
    }
  }
}
export function registerRoutes(ctx: RouteContext, runtime: BrowserRuntime) {
  for (const action of Object.keys(FIELDS) as BrowserAction[]) {
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}${action}`,
        handler: createHandler(runtime, action, ctx.webServer.port),
      }),
    )
  }
}
