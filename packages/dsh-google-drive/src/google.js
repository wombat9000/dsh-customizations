import { httpFailure, authFailure } from './diagnostics.js'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const FILES = 'https://www.googleapis.com/drive/v3/files'
const FIELDS = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed)'
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max
const cancelled = () => new Error('Google operation was cancelled.')
const validId = value => text(value, 256) && /^[A-Za-z0-9_-]+$/u.test(value)

// Read-only transport. The callback owns authentication; this client never
// discovers credentials, opens a login flow, or persists account state.
export class GoogleDriveClient {
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

  async listFiles(options = {}) { return this.pickerList(options) }

  async pickerList({ pageSize = 10, pageToken, parentId, search, signal, query } = {}) {
    if (query !== undefined || (parentId !== undefined && !validId(parentId))
      || (search !== undefined && (typeof search !== 'string' || search.length > 256))) throw new Error('Invalid Google Drive list options.')
    const filters = []
    if (parentId) filters.push(`'${parentId}' in parents`)
    if (search) filters.push(`name contains '${search.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`)
    return this.#request({ pageSize, pageToken, query: filters.join(' and '), signal })
  }

  async listFolder({ folderId, ...options } = {}) {
    if (!validId(folderId) || Object.keys(options).some(key => !['pageSize', 'pageToken', 'signal'].includes(key))) throw new Error('Invalid Google Drive folder options.')
    return this.pickerList({ ...options, parentId: folderId })
  }

  async getMetadata({ fileId, signal } = {}) {
    if (!validId(fileId)) throw new Error('Invalid Google Drive file ID.')
    const result = await this.#request({ fileId, signal })
    if (result.id !== fileId || result.trashed !== false || !Array.isArray(result.parents)) throw new Error('Invalid Google Drive metadata.')
    return result
  }

  async readText({ fileId, maxBytes = 262_144, signal } = {}) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576) throw new Error('Invalid Google Drive read limit.')
    const metadata = await this.getMetadata({ fileId, signal })
    const exportMime = metadata.mimeType === 'application/vnd.google-apps.document' ? 'text/plain' : undefined
    if (!exportMime && !['text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values', 'application/json'].includes(metadata.mimeType)) throw new Error('Unsupported Google Drive MIME type.')
    const content = await this.#request({ fileId, signal, content: true, exportMime, maxBytes })
    return { file: metadata, text: content, mimeType: exportMime ?? metadata.mimeType }
  }

  async #request({ pageSize = 10, pageToken, query, signal, fileId, content = false, exportMime, maxBytes } = {}) {
    if (this.#disposed) throw cancelled()
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error('Invalid cancellation signal.')
    if (signal?.aborted) throw cancelled()
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100
      || (pageToken !== undefined && !text(pageToken, 4096))
      || (query !== undefined && (typeof query !== 'string' || query.length > 4096))) {
      throw new Error('Invalid Google Drive list options.')
    }
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
      // The shared service owns account validity through the complete operation.
      // Cancelling this caller's wait does not abort a shared token refresh.
      return await wait(Promise.resolve().then(() => {
        if (controller.signal.aborted) throw cancelled()
        return this.#withAccessToken(async (token, lifetimeSignal) => {
          authSignal = lifetimeSignal
          authSignal?.addEventListener('abort', abort, { once: true })
          if (authSignal?.aborted) abort()
          try {
      if (controller.signal.aborted) throw cancelled()
      if (!text(token, 16_384) || !/^[\x21-\x7e]+$/u.test(token)) throw new Error('Google authentication returned an invalid token.')
      const url = new URL(fileId ? `${FILES}/${encodeURIComponent(fileId)}${exportMime ? '/export' : ''}` : FILES)
      url.search = new URLSearchParams(fileId
        ? content ? exportMime ? { mimeType: exportMime } : { alt: 'media' }
          : { fields: 'id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed' }
        : { pageSize: String(pageSize), fields: FIELDS, spaces: 'drive',
          ...(pageToken ? { pageToken } : {}), q: query ? `trashed = false and (${query})` : 'trashed = false' }).toString()
      timer = setTimeout(abort, this.#timeout)
      let result
      let failure = 'Google network request failed. Try again.'
      let reader
      try {
        const response = await wait(this.#fetch(url.toString(), {
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
            if (length > (response.ok ? (content ? maxBytes : 1_048_576) : 16_384)) throw new Error()
            chunks.push(Buffer.from(value))
          }
        } catch (error) {
          void reader?.cancel().catch(() => {})
          throw error
        }
        if (controller.signal.aborted) throw cancelled()
        result = content && response.ok ? new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) : JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!response.ok) {
          failure = httpFailure(response.status, result)
          throw new Error()
        }
      } catch { throw new Error(failure) }
      finally { void reader?.cancel().catch(() => {}) }
      if (content) return result
      if (fileId) result = { files: [result] }
      if (!result || !Array.isArray(result.files) || result.files.length > pageSize
        || (result.nextPageToken !== undefined && !text(result.nextPageToken, 4096))) throw new Error('Invalid Google Drive response.')
      const files = result.files.map(file => {
        if (!file || !text(file.id, 1024) || !text(file.name, 4096) || !text(file.mimeType, 256)) throw new Error('Invalid Google Drive response.')
        const output = { id: file.id, name: file.name, mimeType: file.mimeType }
        for (const key of ['size', 'modifiedTime']) {
          if (typeof file[key] === 'string' && file[key].length <= 4096) output[key] = file[key]
        }
        if (text(file.webViewLink, 4096)) {
          try {
            const link = new URL(file.webViewLink)
            if (link.protocol === 'https:' && !link.username && !link.password && !link.port
              && ['drive.google.com', 'docs.google.com'].includes(link.hostname)) output.webViewLink = link.href
          } catch { /* Omit malformed links. */ }
        }
        if (typeof file.trashed === 'boolean') output.trashed = file.trashed
        // Parentless resources can be explicitly selected. Missing ancestry is
        // an empty chain, never evidence of membership in a selected folder.
        if (fileId && file.parents === undefined) output.parents = []
        else if (Array.isArray(file.parents) && file.parents.length <= 100 && file.parents.every(id => validId(id))) output.parents = [...file.parents]
        return output
      })
      if (fileId) return files[0]
      return { files: files.filter(file => file.trashed !== true),
        ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}) }
          } catch (error) { operationError = error; throw error }
          finally { authSignal?.removeEventListener('abort', abort) }
        })
      }))
    } catch (error) {
      if (controller.signal.aborted) throw cancelled()
      // Only locally constructed metadata errors are safe to return. Never
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
