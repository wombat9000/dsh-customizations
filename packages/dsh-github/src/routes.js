const PREFIX = '/api/plugins/github/'
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
function reply(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
  res.end(JSON.stringify(value))
}
export function allowedRequest(req, port) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])
  return LOOPBACK.has(req.socket.remoteAddress) && hosts.has(req.headers.host)
    && req.headers.origin === `http://${req.headers.host}` && req.headers['x-dsh-github'] === '1'
    && req.headers['content-type'] === 'application/json'
    && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin')
}
export function validateInput(value, action) {
  const keys = action === 'revoke' ? ['sessionId', 'callId', 'grantId'] : ['sessionId', 'callId']
  if (!['status', 'revoke'].includes(action) || !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))
    || keys.some(key => typeof value[key] !== 'string' || !value[key] || value[key].length > 200 || /[\u0000-\u001f\u007f]/.test(value[key]))) throw new Error('Invalid GitHub card request.')
  return value
}
export function createHandler(presentation, action, port) {
  return async (req, res) => {
    if (!allowedRequest(req, port)) return reply(res, 403, { ok: false, error: { message: 'Manage GitHub access from the local DSH page.' } })
    if (req.method !== 'POST') return reply(res, 405, { ok: false, error: { message: 'Use POST.' } })
    const timer = setTimeout(() => req.destroy(), 10000)
    timer.unref?.()
    try {
      const chunks = []; let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new Error('Request too large.'); chunks.push(chunk) }
      const input = validateInput(JSON.parse(Buffer.concat(chunks).toString('utf8')), action)
      return reply(res, 200, { ok: true, value: presentation[action](input) })
    } catch { return reply(res, 409, { ok: false, error: { message: 'GitHub card data is unavailable or expired. No access was granted.' } }) }
    finally { clearTimeout(timer) }
  }
}
export function registerGitHubRoutes(ctx, presentation) {
  // Optional Web attachment: CLI tools retain their existing behavior without Web.
  ctx.inject(['webServer'], scope => {
    for (const action of ['status', 'revoke']) scope.effect(() => scope.webServer.register({ kind: 'exact', path: `${PREFIX}${action}`, handler: createHandler(presentation, action, scope.webServer.port) }))
  })
}
