const FILES = 'https://www.googleapis.com/drive/v3/files'
const TEXT_MIMES = ['text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values', 'application/json']

// Document policy and decoding are separate from metadata projection and HTTP.
// The transport supplies bounded bytes; this reader currently supports only text.
export class DriveDocumentReader {
  #transport
  #getMetadata

  constructor({ transport, getMetadata }) {
    this.#transport = transport
    this.#getMetadata = getMetadata
  }

  async readText({ fileId, maxBytes = 262_144, signal } = {}) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576) throw new Error('Invalid Google Drive read limit.')
    const metadata = await this.#getMetadata({ fileId, signal })
    const exportMime = metadata.mimeType === 'application/vnd.google-apps.document' ? 'text/plain' : undefined
    if (!exportMime && !TEXT_MIMES.includes(metadata.mimeType)) throw new Error('Unsupported Google Drive MIME type.')
    const content = await this.#transport.request({ signal, prepare: () => {
      const url = new URL(`${FILES}/${encodeURIComponent(fileId)}${exportMime ? '/export' : ''}`)
      url.search = new URLSearchParams(exportMime ? { mimeType: exportMime } : { alt: 'media' }).toString()
      return { url: url.toString(), maxBytes,
        decode: bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    } })
    return { file: metadata, text: content, mimeType: exportMime ?? metadata.mimeType }
  }
}
