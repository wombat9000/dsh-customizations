const PREFIX = '/api/plugins/google-auth/'
const ACTIONS = ['status', 'connect', 'cancel', 'disconnect', 'configure', 'clear-config']
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function reply(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  })
  res.end(JSON.stringify(value))
}

export function allowedRequest(req, port) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) return false
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])
  const host = req.headers.host
  return hosts.has(host) && req.headers.origin === `http://${host}`
    && req.headers['x-dsh-google-auth'] === '1'
    && req.headers['content-type'] === 'application/json'
    && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin')
}

async function readBody(req, action) {
  let size = 0
  const chunks = []
  const timer = setTimeout(() => req.destroy(), 5000)
  timer.unref?.()
  try {
    for await (const chunk of req) {
      size += chunk.length
      if (size > (action === 'configure' ? 65536 : 1024)) return undefined
      chunks.push(chunk)
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
    if (action === 'configure') return Object.keys(data).length === 1 && typeof data.clientJson === 'string'
      && data.clientJson.length <= 32768 ? data : undefined
    if (action === 'connect') return Object.keys(data).length === 1 && typeof data.integrationId === 'string'
      && /^[a-z][a-z0-9-]{0,63}$/u.test(data.integrationId) ? data : undefined
    return Object.keys(data).length === 0 ? data : undefined
  } catch { return undefined }
  finally { clearTimeout(timer) }
}

export function settingsHandler(service, action, port) {
  return async (req, res) => {
    if (!allowedRequest(req, port)) {
      reply(res, 403, { ok: false, error: { message: 'Open Settings on the local DSH URL to manage Google accounts.' } })
      return
    }
    if (req.method !== 'POST') {
      reply(res, 405, { ok: false, error: { message: 'Use POST.' } })
      return
    }
    const body = ACTIONS.includes(action) ? await readBody(req, action) : undefined
    if (body === undefined) {
      reply(res, 400, { ok: false, error: { message: 'Invalid Google accounts settings request.' } })
      return
    }
    try {
      const value = await (action === 'connect' ? service.begin(body.integrationId)
        : action === 'configure' ? service.configure(body.clientJson)
          : action === 'clear-config' ? service.clearConfig() : service[action]())
      // Explicit projections keep credentials and future internal fields off wire.
      const safe = action === 'status' ? {
        configured: value.configured === true, connected: value.connected === true, pending: value.pending === true,
        ...(Number.isFinite(value.expiresAt) ? { expiresAt: value.expiresAt } : {}),
        ...(typeof value.error === 'string' ? { error: value.error } : {}),
        ...(value.account ? { account: { id: value.account.id, ...(value.account.email ? { email: value.account.email } : {}) } } : {}),
        ...(typeof value.pendingIntegrationId === 'string' ? { pendingIntegrationId: value.pendingIntegrationId } : {}),
        integrations: value.integrations.map(item => ({ id: item.id, label: item.label,
          scopes: [...item.scopes], authorized: item.authorized === true, missingScopes: [...item.missingScopes] })),
      } : action === 'connect' ? {
        authorizationUrl: value.authorizationUrl, expiresAt: value.expiresAt,
      } : {}
      reply(res, 200, { ok: true, value: safe })
    } catch {
      reply(res, 400, { ok: false, error: {
        message: action === 'connect'
          ? 'Could not start Google login. Check client configuration and the selected integration, then retry.'
          : action === 'configure'
            ? 'Could not save configuration. Paste downloaded Google Desktop client JSON and check credential storage access.'
            : action === 'cancel'
              ? 'Sign-in could not be cancelled. It may be finishing; wait for completion, then disconnect if needed.'
              : 'Google accounts operation failed. Check connection status and retry.',
      } })
    }
  }
}

export function registerSettingsRoutes(ctx, service) {
  for (const action of ACTIONS) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: PREFIX + action,
      handler: settingsHandler(service, action, ctx.webServer.port),
    }))
  }
}
