import { mkdtemp, chmod, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pdfTools, pdfProcess } from './pdf-process.js'

const languagesAllowed = new Set(['eng', 'deu', 'fra', 'spa', 'ita', 'por'])
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max

export function validatePdfOptions({ startPage = 1, endPage, ocr = 'auto', languages = ['eng'], maxBytes = 262144, signal } = {}) {
  if (!integer(startPage, 1, 200) || (endPage !== undefined && (!integer(endPage, startPage, 200) || endPage - startPage >= 5))
    || !['auto', 'off', 'force'].includes(ocr) || !Array.isArray(languages) || languages.length < 1 || languages.length > 3
    || new Set(languages).size !== languages.length || languages.some(language => !languagesAllowed.has(language))
    || !integer(maxBytes, 1, 262144) || (signal !== undefined && !(signal instanceof AbortSignal))) throw new Error('Invalid PDF read options.')
  return { startPage, endPage, ocr, languages: [...languages], maxBytes, signal }
}

export class PdfProcessor {
  #active = new Set()
  #disposed = false

  async read(bytes, { startPage = 1, endPage, ocr = 'auto', languages = ['eng'], maxBytes = 262144, signal } = {}) {
    if (this.#disposed) throw new Error('PDF processor is disposed.')
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 5 || bytes.byteLength > 20 * 1024 * 1024) throw new Error('PDF input must be between 5 bytes and 20 MiB.')
    if (Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 1024)).indexOf('%PDF-') < 0) throw new Error('PDF processing failed: the document is malformed.')
    ;({ startPage, endPage, ocr, languages, maxBytes, signal } = validatePdfOptions({ startPage, endPage, ocr, languages, maxBytes, signal }))
    if (signal?.aborted) throw new Error('PDF processing was cancelled.')
    if (this.#active.size >= 2) throw new Error('PDF processor is busy; retry after another read finishes.')
    const controller = new AbortController()
    this.#active.add(controller)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    let expired = false
    const timer = setTimeout(() => { expired = true; controller.abort() }, 90000)
    let directory
    try {
      const tools = await pdfTools()
      if (controller.signal.aborted) throw new Error('PDF processing was cancelled.')
      directory = await mkdtemp(join(tmpdir(), 'dsh-pdf-'))
      await chmod(directory, 0o700)
      const input = join(directory, 'input.pdf')
      // Copy into private storage before starting tools. No credentials enter their environment.
      await writeFile(input, bytes, { mode: 0o600, flag: 'wx' })
      const run = (tool, args, options = {}) => pdfProcess(tools, tool, args, { cwd: directory, signal: controller.signal, ...options })
      const metadata = (await run('pdfinfo', [input], { limit: 65536 })).toString('utf8')
      const encryptedLines = metadata.split(/\r?\n/u).filter(line => /^Encrypted:/u.test(line))
      const pageLines = metadata.split(/\r?\n/u).filter(line => /^Pages:/u.test(line))
      if (encryptedLines.length !== 1 || pageLines.length !== 1) throw new Error('PDF processing failed: ambiguous or malformed document metadata.')
      if (!/^Encrypted:[ \t]+no[ \t]*$/u.test(encryptedLines[0])) throw new Error('Encrypted PDFs are not supported, including PDFs that open without a password.')
      const totalPages = Number(/^Pages:[ \t]+(\d+)[ \t]*$/u.exec(pageLines[0])?.[1])
      if (!integer(totalPages, 1, 200)) throw new Error('PDF must contain between 1 and 200 pages.')
      if (startPage > totalPages) throw new Error('PDF startPage exceeds the document page count.')
      const lastPage = Math.min(endPage ?? startPage + 4, totalPages)
      if (ocr !== 'off') {
        const installed = (await run('tesseract', ['--list-langs'], { limit: 16384 })).toString('utf8').split(/\r?\n/u).map(line => line.trim())
        if (languages.some(language => !installed.includes(language))) throw new Error('A requested OCR language is not installed. Ask an administrator to install it; no language data is downloaded automatically.')
      }
      const pages = [], warnings = ocr === 'auto'
        ? ['Automatic OCR uses a sparse-text heuristic and may miss scanned content on pages with substantial embedded text. Use ocr="force" to OCR every requested page.'] : []
      let outputBytes = 0
      for (let pageNumber = startPage; pageNumber <= lastPage; pageNumber++) {
        let text = '', method = 'none'
        if (ocr !== 'force') {
          text = (await run('pdftotext', ['-f', String(pageNumber), '-l', String(pageNumber), '-enc', 'UTF-8', '-nopgbrk', input, '-'], { limit: maxBytes })).toString('utf8').trim()
          if (text) method = 'embedded'
        }
        // Sparse text can be a page number on an otherwise scanned page.
        if (ocr === 'force' || (ocr === 'auto' && text.replace(/\s/gu, '').length < 24)) {
          const prefix = join(directory, 'page')
          const image = `${prefix}.ppm`
          await run('pdftoppm', ['-f', String(pageNumber), '-l', String(pageNumber), '-singlefile', '-scale-to', '2400', input, prefix], { timeout: 30000, limit: 16384 })
          const imageStat = await stat(image)
          if (imageStat.size > 20 * 1024 * 1024) throw new Error('PDF rendered image exceeds its size limit.')
          const recognized = (await run('tesseract', [image, 'stdout', '-l', languages.join('+'), '--psm', '3'], { timeout: 30000, limit: maxBytes })).toString('utf8').trim()
          await rm(image, { force: true })
          if (recognized) { text = recognized; method = 'ocr' }
          else if (!text) method = 'none'
          warnings.push(`Page ${pageNumber}: OCR may miss or misread content.`)
        }
        if (!text) warnings.push(`Page ${pageNumber}: no readable text was found.${ocr === 'off' ? ' Try ocr="auto" or ocr="force" for scanned content.' : ''}`)
        const labeled = `[Page ${pageNumber}]\n${text}`
        outputBytes += Buffer.byteLength(labeled) + (pages.length ? 2 : 0)
        if (outputBytes > maxBytes) throw new Error('PDF text exceeds maxBytes; request fewer pages or a larger output limit.')
        pages.push({ pageNumber, text, method })
      }
      if (controller.signal.aborted) throw new Error('PDF processing was cancelled.')
      return {
        text: pages.map(page => `[Page ${page.pageNumber}]\n${page.text}`).join('\n\n'),
        pages: pages.map(({ pageNumber, method }) => ({ pageNumber, method })), totalPages,
        actualRange: { startPage, endPage: lastPage }, ...(lastPage < totalPages ? { nextStartPage: lastPage + 1 } : {}),
        warnings, mimeType: 'text/plain', format: 'pdf',
      }
    } catch (error) {
      if (expired) throw new Error('PDF processing exceeded its 90-second total time limit.')
      // Filesystem errors include private paths. Only controlled processor errors are exposed.
      if (error?.code) throw new Error('PDF processing could not access its private temporary storage.')
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      try { if (directory) await rm(directory, { recursive: true, force: true }) }
      catch { throw new Error('PDF processing could not clean up its private temporary storage.') }
      finally { this.#active.delete(controller) }
    }
  }

  dispose() {
    this.#disposed = true
    for (const controller of this.#active) controller.abort()
  }
}
