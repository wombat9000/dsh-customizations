import { GoogleTransport } from './transport.js'
import { DriveDocumentReader } from './document-reader.js'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const FILES = 'https://www.googleapis.com/drive/v3/files'
const FIELDS = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed)'
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max
const validId = value => text(value, 256) && /^[A-Za-z0-9_-]+$/u.test(value)

// Public facade and metadata/list policy. The shared transport owns credentials
// and cancellation; the document reader owns content formats and decoding.
export class GoogleDriveClient {
  #transport
  #documents

  constructor(options = {}) {
    this.#transport = new GoogleTransport(options)
    this.#documents = new DriveDocumentReader({ transport: this.#transport,
      getMetadata: options => this.getMetadata(options) })
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

  async readText(options = {}) { return this.#documents.readText(options) }

  async #request({ pageSize = 10, pageToken, query, signal, fileId } = {}) {
    return this.#transport.request({ signal, prepare: () => {
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100
        || (pageToken !== undefined && !text(pageToken, 4096))
        || (query !== undefined && (typeof query !== 'string' || query.length > 4096))) {
        throw new Error('Invalid Google Drive list options.')
      }
      const url = new URL(fileId ? `${FILES}/${encodeURIComponent(fileId)}` : FILES)
      url.search = new URLSearchParams(fileId
        ? { fields: 'id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed' }
        : { pageSize: String(pageSize), fields: FIELDS, spaces: 'drive',
          ...(pageToken ? { pageToken } : {}), q: query ? `trashed = false and (${query})` : 'trashed = false' }).toString()
      return { url: url.toString(), maxBytes: 1_048_576,
        decode: bytes => JSON.parse(bytes.toString('utf8')),
        transform: result => projectMetadata(result, { fileId, pageSize }) }
    } })
  }

  dispose() { this.#transport.dispose() }
}

function projectMetadata(result, { fileId, pageSize }) {
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
}
