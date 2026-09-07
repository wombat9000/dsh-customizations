import { PdfProcessor, validatePdfOptions } from './pdf.js'

const FILES = 'https://www.googleapis.com/drive/v3/files'
const TEXT_MIMES = ['text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values', 'application/json']
const PDF_LIMIT = 20 * 1024 * 1024
const cancelled = () => new Error('Google operation was cancelled.')

// Document policy is separate from HTTP. PDF processing has its own lifetime:
// authentication's per-request signal ends when a successful download returns.
export class DriveDocumentReader {
  #transport
  #getMetadata
  #pdf
  #reads = new Set()
  #disposed = false

  constructor({ transport, getMetadata, pdfProcessor = new PdfProcessor() }) {
    this.#transport = transport
    this.#getMetadata = getMetadata
    this.#pdf = pdfProcessor
  }

  async readText({ fileId, maxBytes = 262_144, signal, ...pdfOptions } = {}) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576) throw new Error('Invalid Google Drive read limit.')
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error('Invalid cancellation signal.')
    if (this.#disposed || signal?.aborted) throw cancelled()
    if (Object.keys(pdfOptions).some(key => !['startPage', 'endPage', 'ocr', 'languages'].includes(key))) throw new Error('Invalid Google Drive read options.')
    if (Object.keys(pdfOptions).length) validatePdfOptions({ ...pdfOptions, maxBytes })
    const metadata = await this.#getMetadata({ fileId, signal })
    if (this.#disposed || signal?.aborted) throw cancelled()
    if (metadata.mimeType === 'application/pdf') return this.#readPdf(metadata, { fileId, maxBytes, signal, ...pdfOptions })
    if (Object.keys(pdfOptions).length) throw new Error('Page ranges and OCR options require a PDF file.')
    const exportMime = metadata.mimeType === 'application/vnd.google-apps.document' ? 'text/plain' : undefined
    if (!exportMime && !TEXT_MIMES.includes(metadata.mimeType)) throw new Error('Unsupported Google Drive MIME type.')
    const content = await this.#download({ fileId, exportMime, maxBytes, signal,
      decode: bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes) })
    return { file: metadata, text: content, mimeType: exportMime ?? metadata.mimeType }
  }

  #download({ fileId, exportMime, maxBytes, signal, decode, overflowMessage }) {
    return this.#transport.request({ signal, prepare: () => {
      const url = new URL(`${FILES}/${encodeURIComponent(fileId)}${exportMime ? '/export' : ''}`)
      url.search = new URLSearchParams(exportMime ? { mimeType: exportMime } : { alt: 'media' }).toString()
      return { url: url.toString(), maxBytes, decode, overflowMessage }
    } })
  }

  async #readPdf(metadata, options) {
    const { fileId, signal: callerSignal, ...processing } = options
    validatePdfOptions(processing)
    if (metadata.size !== undefined && /^\d+$/u.test(metadata.size) && BigInt(metadata.size) > BigInt(PDF_LIMIT)) throw new Error('PDF exceeds the 20 MiB download limit.')
    if (this.#reads.size >= 2) throw new Error('PDF reader is busy. Retry after an active read finishes.')
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, ...(callerSignal ? [callerSignal] : [])])
    this.#reads.add(controller)
    const timer = setTimeout(() => controller.abort(), 120_000)
    try {
      const bytes = await this.#download({ fileId, maxBytes: PDF_LIMIT, signal, decode: value => value,
        overflowMessage: 'PDF exceeds the 20 MiB download limit.' })
      if (signal.aborted) throw cancelled()
      const result = await this.#pdf.read(bytes, { ...processing, signal })
      if (signal.aborted || this.#disposed) throw cancelled()
      return { ...result, file: metadata }
    } finally {
      clearTimeout(timer)
      this.#reads.delete(controller)
    }
  }

  dispose() {
    this.#disposed = true
    for (const controller of this.#reads) controller.abort()
    this.#pdf.dispose()
  }
}
