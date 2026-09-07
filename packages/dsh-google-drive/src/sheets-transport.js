// Write transport deliberately has no retry path, including authentication retries.
export const sheetsError = (code, message) => Object.assign(new Error(message), { code })
const cancelled = () => sheetsError('cancelled', 'Google Sheets operation was cancelled before dispatch.')
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
    let rejectAbort, dispatched = false, entered = false, lifetime, reader
    const stopped = new Promise((_, reject) => { rejectAbort = () => reject(cancelled()) })
    controller.signal.addEventListener('abort', rejectAbort, { once: true })
    const wait = value => Promise.race([value, stopped])
    const timer = setTimeout(abort, this.#timeout)
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
          if (typeof token !== 'string' || !/^[\x21-\x7e]{1,16384}$/u.test(token)) throw sheetsError('auth', 'Google Sheets authentication is unavailable.')
          if (body !== undefined && beforeDispatch) {
            const result = beforeDispatch()
            if (result !== undefined) {
              if (result instanceof Promise) void result.catch(() => {})
              throw sheetsError('invalid', 'Google Sheets dispatch guard must be synchronous and return undefined.')
            }
          }
          if (controller.signal.aborted) throw cancelled()
          dispatched = true
          const response = await wait(this.#fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body }), redirect: 'error', signal: controller.signal }))
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
          if (!response.ok) throw sheetsError('http', 'Google Sheets rejected the request.')
          try { return JSON.parse(bytes.toString('utf8', 0, size)) } catch { throw sheetsError('response', 'Invalid Google Sheets response.') }
        } finally { lifetime?.removeEventListener('abort', abort) }
      })))
    } catch {
      if (body !== undefined && dispatched) throw sheetsError('uncertain', 'Google Sheets write outcome is uncertain. Inspect the sheet before preparing another edit.')
      if (controller.signal.aborted || this.#disposed) throw cancelled()
      throw sheetsError('request', 'Google Sheets request failed. Check access and try again.')
    } finally {
      controller.abort()
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      lifetime?.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', rejectAbort)
      this.#controllers.delete(controller)
      void reader?.cancel().catch(() => {})
    }
  }
  dispose() { this.#disposed = true; for (const controller of this.#controllers) controller.abort() }
}
