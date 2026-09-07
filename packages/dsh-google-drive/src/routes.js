const PREFIX = '/api/plugins/google-drive/'
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const FIELDS = {
  status: [], manage: [], revoke: [],
  browse: ['requestId', 'parentId', 'search', 'pageToken'],
  grant: ['requestId', 'selected'], deny: ['requestId'],
}
function reply(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
  res.end(JSON.stringify(value))
}
export function allowedRequest(req, port) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])
  return LOOPBACK.has(req.socket.remoteAddress) && hosts.has(req.headers.host)
    && req.headers.origin === `http://${req.headers.host}`
    && req.headers['x-dsh-google-drive'] === '1'
    && req.headers['content-type'] === 'application/json'
    && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin')
}
async function body(req, action) {
  let length = 0
  const chunks = []
  for await (const chunk of req) {
    length += chunk.length
    if (length > 32768) throw new Error('Request too large.')
    chunks.push(chunk)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const keys = ['sessionId', 'callId', ...FIELDS[action]]
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))
    || typeof value.sessionId !== 'string' || typeof value.callId !== 'string'
    || Object.entries(value).some(([key, field]) => key !== 'selected' && (typeof field !== 'string' || field.length > 4096))) {
    throw new Error('Invalid Drive permission request.')
  }
  return value
}
export function createHandler(runtime, action, port) {
  return async (req, res) => {
    if (!allowedRequest(req, port)) return reply(res, 403, { ok: false, error: { message: 'Manage Drive access from the local DSH page.' } })
    if (req.method !== 'POST') return reply(res, 405, { ok: false, error: { message: 'Use POST.' } })
    const controller = new AbortController()
    const abort = () => controller.abort()
    req.once('aborted', abort)
    res.once('close', abort)
    const timeout = setTimeout(() => { controller.abort(); req.destroy() }, 60000)
    timeout.unref?.()
    try {
      let input
      try { input = await body(req, action) }
      catch { return reply(res, 400, { ok: false, error: { message: 'Invalid Drive permission request.' } }) }
      const result = await runtime[action](input, controller.signal)
      if (!controller.signal.aborted) reply(res, 200, { ok: true, value: result })
    } catch {
      // Never forward Google payloads, bearer values, arbitrary file names or stack traces.
      if (!controller.signal.aborted) reply(res, 409, { ok: false, error: { message: 'Drive access could not be updated. The request may have expired, access may be disabled, or Google may need reconnecting. Close the picker and try again.' } })
    } finally {
      clearTimeout(timeout)
      req.removeListener('aborted', abort)
      res.removeListener('close', abort)
    }
  }
}
export function registerRoutes(ctx, runtime) {
  for (const action of Object.keys(FIELDS)) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: `${PREFIX}${action}`, handler: createHandler(runtime, action, ctx.webServer.port) }))
  }
}
