// Write transport deliberately has no retry path, including authentication retries.
export const sheetsError = (code, message) => Object.assign(new Error(message), { code })
const cancelled = () => sheetsError('cancelled', 'Google Sheets operation was cancelled before dispatch.')
// Only these local strings leave the transport. Never forward upstream text or metadata.
const diagnostics = Object.freeze({
  api_disabled: 'The Google Sheets API is disabled for the OAuth project. Enable it in that project.',
  scopes: 'Google Sheets OAuth permissions are missing. Grant additional permissions in Google accounts settings.',
  auth: 'Google Sheets authentication is unavailable or was rejected. Check Google accounts in Settings. Reconnecting clears session grants.',
  forbidden: 'Google Sheets denied access. Check the account’s spreadsheet sharing permissions and access policy.',
  not_found: 'The spreadsheet was not found or is not accessible to this account.',
  invalid: 'Google Sheets rejected an invalid request. Check the spreadsheet range and edit.',
  rate_limit: 'Google Sheets rate limit was reached. Wait before trying another operation.',
  server: 'Google Sheets is temporarily unavailable.',
  network: 'Google Sheets could not be reached.',
  timeout: 'Google Sheets request timed out.',
  response: 'Google Sheets returned an invalid or oversized response.',
  http: 'Google Sheets rejected the request.',
  cancelled: 'Google Sheets operation was cancelled.',
  request: 'Google Sheets request failed for an unknown reason.',
})
function httpDiagnostic(status, bytes, size) {
  if (status === 403) {
    let error
    try { error = JSON.parse(bytes.toString('utf8', 0, size))?.error } catch {}
    // Exact structured reasons only; messages, URLs, metadata and other fields are ignored.
    const details = Array.isArray(error?.details) ? error.details.slice(0, 64) : []
    const reasons = details.filter(d => d?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo').map(d => d.reason)
    const legacy = Array.isArray(error?.errors) ? error.errors.slice(0, 64).map(e => e?.reason) : []
    if (reasons.includes('SERVICE_DISABLED') || legacy.includes('accessNotConfigured')) return 'api_disabled'
    if (reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || legacy.includes('insufficientPermissions')) return 'scopes'
    if (legacy.some(reason => ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded'].includes(reason))) return 'rate_limit'
    return 'forbidden'
  }
  if (status === 401) return 'auth'
  if (status === 404) return 'not_found'
  if (status === 400) return 'invalid'
  if (status === 429) return 'rate_limit'
  if (status >= 500 && status <= 599) return 'server'
  return 'http'
}
export class SheetsTransport {
  #auth; #fetch; #timeout; #controllers = new Set(); #disposed = false
  constructor({ withAccessToken, fetch = globalThis.fetch, requestTimeoutMs = 30_000 } = {}) {
    if (typeof withAccessToken !== 'function' || typeof fetch !== 'function' || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120_000) throw sheetsError('invalid', 'Invalid Google Sheets client options.')
    this.#auth = withAccessToken; this.#fetch = fetch; this.#timeout = requestTimeoutMs
  }
  async request(url, { signal, body, beforeDispatch } = {}) {
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw sheetsError('invalid', 'Invalid cancellation signal.')
    if (this.#disposed || signal?.aborted) throw cancelled()
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    this.#controllers.add(controller)
    let rejectAbort, dispatched = false, entered = false, lifetime, reader, timedOut = false, diagnostic = 'auth'
    const stopped = new Promise((_, reject) => { rejectAbort = () => reject(cancelled()) })
    controller.signal.addEventListener('abort', rejectAbort, { once: true })
    const wait = value => Promise.race([value, stopped])
    const timer = setTimeout(() => { timedOut = true; abort() }, this.#timeout)
    try {
      return await wait(Promise.resolve().then(() => this.#auth(async (token, authSignal) => {
        // A provider must not replay this callback, even after an HTTP failure.
        if (entered) throw sheetsError('auth', 'Google Sheets authentication callback replay was rejected.')
        entered = true
        lifetime = authSignal
        lifetime?.addEventListener('abort', abort, { once: true })
        if (lifetime?.aborted) abort()
        try {
          if (controller.signal.aborted) throw cancelled()
          diagnostic = 'auth'
          if (typeof token !== 'string' || !/^[\x21-\x7e]{1,16384}$/u.test(token)) throw sheetsError('auth', 'Google Sheets authentication is unavailable.')
          diagnostic = 'request'
          if (body !== undefined && beforeDispatch) {
            const result = beforeDispatch()
            if (result !== undefined) {
              if (result instanceof Promise) void result.catch(() => {})
              throw sheetsError('invalid', 'Google Sheets dispatch guard must be synchronous and return undefined.')
            }
          }
          if (controller.signal.aborted) throw cancelled()
          dispatched = true
          diagnostic = 'network'
          const response = await wait(this.#fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body }), redirect: 'error', signal: controller.signal }))
          diagnostic = 'response'
          reader = response.body?.getReader()
          if (!reader) throw sheetsError('response', 'Invalid Google Sheets response.')
          const limit = response.ok ? 2_000_000 : 16_384, bytes = Buffer.allocUnsafe(limit)
          let size = 0, chunks = 0
          while (true) {
            const { done, value } = await wait(reader.read())
            if (done) break
            if (!(value instanceof Uint8Array) || size + value.byteLength > limit || ++chunks > 32_768) throw sheetsError('response', 'Google Sheets response exceeds the safety limit.')
            // A byte limit alone does not bound an array of tiny chunk objects.
            bytes.set(value, size); size += value.byteLength
          }
          if (controller.signal.aborted) throw cancelled()
          if (!response.ok) {
            diagnostic = httpDiagnostic(response.status, bytes, size)
            throw sheetsError('http', diagnostics[diagnostic])
          }
          try { return JSON.parse(bytes.toString('utf8', 0, size)) } catch { throw sheetsError('response', 'Invalid Google Sheets response.') }
        } finally { lifetime?.removeEventListener('abort', abort) }
      })))
    } catch {
      if (timedOut) diagnostic = 'timeout'
      else if (controller.signal.aborted || this.#disposed) diagnostic = 'cancelled'
      if (body !== undefined && dispatched) throw Object.assign(sheetsError('uncertain', `Google Sheets write outcome is uncertain. Inspect the sheet before preparing another edit. ${diagnostics[diagnostic]}`), { diagnostic })
      if (!timedOut && (controller.signal.aborted || this.#disposed)) throw cancelled()
      throw Object.assign(sheetsError('request', diagnostics[diagnostic]), { diagnostic })
    } finally {
      controller.abort()
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      lifetime?.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', rejectAbort)
      this.#controllers.delete(controller)
      try { void Promise.resolve(reader?.cancel()).catch(() => {}) } catch {}
    }
  }
  dispose() { this.#disposed = true; for (const controller of this.#controllers) controller.abort() }
}
