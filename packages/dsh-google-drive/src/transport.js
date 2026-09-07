import { httpFailure, authFailure } from './diagnostics.js'

const cancelled = () => new Error('Google operation was cancelled.')
const validToken = token => typeof token === 'string' && token.length > 0
  && token.length <= 16_384 && /^[\x21-\x7e]+$/u.test(token)

// Internal read-only transport. Authentication owns the entire operation,
// including response processing. Only trusted, synchronous local callbacks belong
// here; asynchronous document processing needs its own operation lifetime.
export class GoogleTransport {
  #withAccessToken
  #fetch
  #timeout
  #controllers = new Set()
  #disposed = false

  constructor({ withAccessToken, fetch = globalThis.fetch, requestTimeoutMs = 30_000 } = {}) {
    if (typeof withAccessToken !== 'function' || typeof fetch !== 'function'
      || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120_000) {
      throw new Error('Invalid Google Drive client options.')
    }
    this.#withAccessToken = withAccessToken
    this.#fetch = fetch
    this.#timeout = requestTimeoutMs
  }

  async request({ signal, prepare }) {
    if (this.#disposed) throw cancelled()
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error('Invalid cancellation signal.')
    if (signal?.aborted) throw cancelled()
    // Validate request options before acquiring credentials, but after cancellation.
    const { url, maxBytes, decode, transform = value => value } = prepare()
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    this.#controllers.add(controller)
    let rejectAbort
    const stopped = new Promise((_resolve, reject) => { rejectAbort = () => reject(cancelled()) })
    controller.signal.addEventListener('abort', rejectAbort, { once: true })
    const wait = promise => Promise.race([promise, stopped])
    let timer
    let authSignal
    let operationError
    try {
      // Cancelling this caller's wait does not abort a shared token refresh.
      return await wait(Promise.resolve().then(() => {
        if (controller.signal.aborted) throw cancelled()
        return this.#withAccessToken(async (token, lifetimeSignal) => {
          authSignal = lifetimeSignal
          authSignal?.addEventListener('abort', abort, { once: true })
          if (authSignal?.aborted) abort()
          try {
            if (controller.signal.aborted) throw cancelled()
            if (!validToken(token)) throw new Error('Google authentication returned an invalid token.')
            timer = setTimeout(abort, this.#timeout)
            let result
            let failure = 'Google network request failed. Try again.'
            let reader
            try {
              const response = await wait(this.#fetch(url, {
                headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: controller.signal,
              }))
              failure = httpFailure(response.status)
              reader = response.body?.getReader()
              const chunks = []
              let length = 0
              try {
                if (reader) while (true) {
                  const { done, value } = await wait(reader.read())
                  if (done) break
                  length += value.byteLength
                  if (length > (response.ok ? maxBytes : 16_384)) throw new Error()
                  chunks.push(Buffer.from(value))
                }
              } catch (error) {
                void reader?.cancel().catch(() => {})
                throw error
              }
              if (controller.signal.aborted) throw cancelled()
              const bytes = Buffer.concat(chunks)
              // Keep raw bytes intact until the caller's decoder. Error bodies
              // always use bounded JSON, never a document decoder.
              result = response.ok ? decode(bytes) : JSON.parse(bytes.toString('utf8'))
              if (!response.ok) {
                failure = httpFailure(response.status, result)
                throw new Error()
              }
            } catch { throw new Error(failure) }
            finally { void reader?.cancel().catch(() => {}) }
            return transform(result)
          } catch (error) { operationError = error; throw error }
          finally { authSignal?.removeEventListener('abort', abort) }
        })
      }))
    } catch (error) {
      if (controller.signal.aborted) throw cancelled()
      // Only locally constructed operation errors are safe to return. Never
      // reflect arbitrary authentication-provider errors or token values.
      if (error === operationError) throw error
      const diagnostic = authFailure(error?.message)
      if (diagnostic) throw new Error(diagnostic)
      throw new Error('Connect Google Drive in Settings → Plugins → Google accounts, then retry.')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', rejectAbort)
      this.#controllers.delete(controller)
    }
  }

  dispose() {
    this.#disposed = true
    for (const controller of this.#controllers) controller.abort()
  }
}
