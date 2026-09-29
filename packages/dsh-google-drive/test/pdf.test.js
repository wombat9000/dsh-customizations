import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { PdfProcessor } from '../src/pdf.js'
import { GoogleDriveClient } from '../src/google.js'
import { pdfTools, pdfProcess, pdfInvocation } from '../src/pdf-process.js'

// All fixtures are generated from synthetic strings and built-in PDF primitives.
// Scans are local Poppler renderings of these fixtures; no downloads or checked-in binaries.
function document(contents, image) {
  const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', '']
  const kids = []
  for (const content of contents) {
    const page = objects.length,
      stream = page + 1
    kids.push(`${page} 0 R`)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> ${image ? `/XObject << /Im  ${3 + contents.length * 2} 0 R >>` : ''} >> /Contents ${stream} 0 R >>`,
    )
    objects.push(
      Buffer.from(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`),
    )
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${contents.length} >>`
  if (image) {
    const data = deflateSync(image.data)
    objects.push(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`,
        ),
        data,
        Buffer.from('\nendstream'),
      ]),
    )
  }
  return serialize(objects)
}
function serialize(objects, trailer = '') {
  const parts = [Buffer.from('%PDF-1.4\n')],
    offsets = [0]
  let length = parts[0].length
  for (let i = 1; i < objects.length; i++) {
    offsets.push(length)
    const part = Buffer.concat([
      Buffer.from(`${i} 0 obj\n`),
      Buffer.from(objects[i]),
      Buffer.from('\nendobj\n'),
    ])
    parts.push(part)
    length += part.length
  }
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join(
          '',
        )}trailer\n<< /Size ${objects.length} /Root 1 0 R ${trailer} >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  )
  return Buffer.concat(parts)
}
const text = (value) => `BT /F1 24 Tf 55 650 Td (${value}) Tj ET`
const textPdf = (...values) => document(values.map(text))

// Minimal revision-2 standard encryption with an empty user password.
function encryptedPdf() {
  const padding = Buffer.from(
    '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
    'hex',
  )
  const md5 = (data) => createHash('md5').update(data).digest()
  const rc4 = (key, input) => {
    const s = Array.from({ length: 256 }, (_, i) => i)
    let j = 0
    for (let i = 0; i < 256; i++) {
      j = (j + s[i] + key[i % key.length]) % 256
      ;[s[i], s[j]] = [s[j], s[i]]
    }
    let i = 0
    j = 0
    return Buffer.from(
      [...input].map((byte) => {
        i = (i + 1) % 256
        j = (j + s[i]) % 256
        ;[s[i], s[j]] = [s[j], s[i]]
        return byte ^ s[(s[i] + s[j]) % 256]
      }),
    )
  }
  const owner = rc4(
    md5(Buffer.concat([Buffer.from('owner'), padding]).subarray(0, 32)).subarray(0, 5),
    padding,
  )
  const id = Buffer.alloc(16, 1),
    permissions = Buffer.from([252, 255, 255, 255])
  const key = md5(Buffer.concat([padding, owner, permissions, id])).subarray(0, 5)
  const user = rc4(key, padding)
  return serialize(
    [
      null,
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
      `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`,
    ],
    `/Encrypt 4 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>]`,
  )
}

let tools
try {
  tools = await pdfTools()
} catch {
  /* Integration prerequisites are optional outside the supported deployment. */
}
const native = { skip: !tools && 'Local PDF tool prerequisites are unavailable' }

test('PDF options reject invalid inputs before spawning', async () => {
  const processor = new PdfProcessor()
  for (const options of [
    { startPage: 0 },
    { endPage: 6 },
    { ocr: 'yes' },
    { languages: ['../../eng'] },
    { languages: [] },
    { languages: ['eng', 'deu', 'fra', 'spa'] },
    { maxBytes: 0 },
    { maxBytes: 262145 },
  ]) {
    await assert.rejects(processor.read(textPdf('Hello'), options), /Invalid PDF/u)
  }
  await assert.rejects(processor.read(Buffer.alloc(20 * 1024 * 1024 + 1)), /20 MiB/u)
  processor.dispose()
  await assert.rejects(processor.read(textPdf('Hello')), /disposed/u)
})

test('native PDF text, ranges, labels, and aggregate limits', native, async () => {
  const processor = new PdfProcessor()
  const fixture = textPdf(
    ...Array.from({ length: 7 }, (_, i) => `This is synthetic page number ${i + 1}`),
  )
  const result = await processor.read(fixture, { ocr: 'off' })
  assert.equal(result.totalPages, 7)
  assert.deepEqual(result.actualRange, { startPage: 1, endPage: 5 })
  assert.equal(result.nextStartPage, 6)
  assert.equal(result.pages.length, 5)
  assert.ok(result.pages.every((page) => page.method === 'embedded'))
  assert.match(result.text, /\[Page 5\]/u)
  const last = await processor.read(fixture, { startPage: 7, ocr: 'off' })
  assert.deepEqual(last.actualRange, { startPage: 7, endPage: 7 })
  assert.equal(last.nextStartPage, undefined)
  assert.deepEqual(
    (await processor.read(fixture, { startPage: 7, endPage: 10, ocr: 'off' })).actualRange,
    { startPage: 7, endPage: 7 },
  )
  await assert.rejects(processor.read(fixture, { startPage: 8, ocr: 'off' }), /page count/u)
  await assert.rejects(processor.read(fixture, { maxBytes: 45, ocr: 'off' }), /maxBytes/u)
  await assert.rejects(processor.read(fixture, { maxBytes: 5, ocr: 'off' }), /output limit/u)
})

test('blank, malformed, encrypted, and overlong PDFs fail clearly', native, async () => {
  const processor = new PdfProcessor()
  const blank = await processor.read(document(['']), { ocr: 'off' })
  assert.equal(blank.pages[0].method, 'none')
  assert.match(blank.warnings.join(' '), /no readable text/u)
  await assert.rejects(
    processor.read(Buffer.from('%PDF-malformed-private-name')),
    (error) => /malformed/u.test(error.message) && !error.message.includes('dsh-pdf-'),
  )
  await assert.rejects(processor.read(encryptedPdf()), /Encrypted PDFs/u)
  const spoofedMetadata = serialize(
    [
      null,
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
      '<< /Title (Synthetic\\nPages: 100\\nEncrypted: no) >>',
    ],
    '/Info 4 0 R',
  )
  await assert.rejects(processor.read(spoofedMetadata, { ocr: 'off' }), /ambiguous or malformed/u)
  await assert.rejects(processor.read(document(Array(201).fill('')), { ocr: 'off' }), /200 pages/u)
})

test(
  'real scanned and mixed fixtures exercise auto, force, off and eng/deu OCR',
  native,
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-pdf-fixture-'))
    try {
      await writeFile(join(dir, 'source.pdf'), textPdf('STEUERBESCHEID RECHNUNG'))
      await pdfProcess(
        tools,
        'pdftoppm',
        ['-singlefile', '-scale-to', '1600', join(dir, 'source.pdf'), join(dir, 'scan')],
        { cwd: dir },
      )
      const ppm = await readFile(join(dir, 'scan.ppm'))
      const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(ppm.subarray(0, 100).toString('ascii'))
      assert.ok(header)
      const image = {
        width: Number(header[1]),
        height: Number(header[2]),
        data: ppm.subarray(header[0].length),
      }
      const fixture = document(
        [text('This page has embedded searchable text'), 'q 612 0 0 792 0 0 cm /Im Do Q', ''],
        image,
      )
      const processor = new PdfProcessor()
      const installed = (await pdfProcess(tools, 'tesseract', ['--list-langs'], { cwd: dir }))
        .toString('utf8')
        .split(/\r?\n/u)
        .map((line) => line.trim())
      const missing = ['fra', 'spa', 'ita', 'por'].find((language) => !installed.includes(language))
      if (missing)
        await assert.rejects(
          processor.read(fixture, { languages: [missing] }),
          /language is not installed/u,
        )
      const result = await processor.read(fixture, { languages: ['eng', 'deu'] })
      assert.deepEqual(
        result.pages.map((page) => page.method),
        ['embedded', 'ocr', 'none'],
      )
      assert.match(result.text, /STEUERBESCHEID RECHNUNG/u)
      assert.equal(JSON.stringify(result).split('STEUERBESCHEID RECHNUNG').length - 1, 1)
      assert.ok(result.pages.every((page) => !Object.hasOwn(page, 'text')))
      assert.ok(result.warnings.length >= 3)
      const off = await processor.read(fixture, { startPage: 2, endPage: 2, ocr: 'off' })
      assert.equal(off.pages[0].method, 'none')
      const force = await processor.read(fixture, { startPage: 1, endPage: 1, ocr: 'force' })
      assert.equal(force.pages[0].method, 'ocr')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)

test('concurrency, cancellation, disposal and private temp cleanup', native, async () => {
  const { Worker } = await import('node:worker_threads')
  const { realpath } = await import('node:fs/promises')
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pdf-lifecycle-')))
  // A worker owns its environment: other tests never see this TMPDIR.
  async function lifecycle() {
    const { workerData } = await import('node:worker_threads')
    const { watch, readdirSync, statSync } = await import('node:fs')
    const { readdir } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { default: assert } = await import('node:assert/strict')
    const { PdfProcessor } = await import(workerData.module)
    assert.equal(tmpdir(), workerData.root)
    const processor = new PdfProcessor()
    const pending = []
    let watcher, timer
    // This is a real allocation observation, not a delay or a mocked write.
    // The timeout only bounds a missing observation; it never releases the barrier.
    const allocation = () =>
      new Promise((resolve, reject) => {
        watcher = watch(workerData.root, () => {
          try {
            const names = readdirSync(workerData.root)
            const name = names.find((name) => name.startsWith('dsh-pdf-'))
            if (!name) return
            assert.ok(statSync(join(workerData.root, name)).isDirectory())
            clearTimeout(timer)
            watcher.close()
            resolve(name)
          } catch (error) {
            reject(error)
          }
        })
        watcher.on('error', reject)
        timer = setTimeout(() => reject(new Error('No private PDF allocation observed')), 5000)
      })
    const start = (options) => {
      const read = processor.read(workerData.fixture, options)
      pending.push(read)
      // Observe rejection immediately, including failures before the allocation barrier.
      read.catch(() => {})
      return read
    }
    try {
      const controller = new AbortController()
      const allocated = allocation()
      const cancelled = start({ signal: controller.signal })
      await allocated
      controller.abort()
      await assert.rejects(cancelled, /cancelled/u)
      assert.deepEqual(await readdir(workerData.root), [])

      const allocatedAgain = allocation()
      const one = start()
      const two = start()
      await assert.rejects(processor.read(workerData.fixture), /busy/u)
      await allocatedAgain
      processor.dispose()
      for (const read of [one, two]) await assert.rejects(read, /cancelled/u)
      await assert.rejects(processor.read(workerData.fixture), /disposed/u)
      assert.deepEqual(await readdir(workerData.root), [])
    } finally {
      clearTimeout(timer)
      watcher?.close()
      processor.dispose()
      await Promise.allSettled(pending)
    }
  }
  let worker
  try {
    worker = new Worker(`(${lifecycle.toString()})()`, {
      eval: true,
      env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
      workerData: {
        root,
        module: new URL('../src/pdf.js', import.meta.url).href,
        fixture: textPdf('Hello'),
      },
    })
    await new Promise((resolve, reject) => {
      worker.once('error', reject)
      worker.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`PDF worker exited ${code}`)),
      )
    })
    assert.deepEqual(await readdir(root), [])
  } finally {
    await worker?.terminate()
    // Remove only this test's root, including leftovers from a failing cleanup assertion.
    await rm(root, { recursive: true, force: true })
  }
})

test('assembled Drive client reads native PDF through fixed media transport', native, async () => {
  const fixture = textPdf(
    'This is the first synthetic Drive page',
    'This is the second synthetic Drive page',
  )
  const requests = []
  const client = new GoogleDriveClient({
    withAccessToken: async (callback) => {
      const lifetime = new AbortController()
      try {
        return await callback('synthetic-token', lifetime.signal)
      } finally {
        lifetime.abort()
      }
    },
    fetch: async (url, options) => {
      requests.push(url)
      assert.equal(options.headers.Authorization, 'Bearer synthetic-token')
      assert.equal(new URL(url).origin, 'https://www.googleapis.com')
      assert.equal(new URL(url).pathname, '/drive/v3/files/synthetic-file')
      return new URL(url).searchParams.get('alt') === 'media'
        ? new Response(fixture)
        : Response.json({
            id: 'synthetic-file',
            name: 'Synthetic.pdf',
            mimeType: 'application/pdf',
            size: String(fixture.length),
            parents: [],
            trashed: false,
          })
    },
  })
  try {
    const result = await client.readText({
      fileId: 'synthetic-file',
      startPage: 2,
      endPage: 2,
      ocr: 'off',
    })
    assert.equal(result.file.name, 'Synthetic.pdf')
    assert.equal(result.file.mimeType, 'application/pdf')
    assert.equal(result.mimeType, 'text/plain')
    assert.equal(result.format, 'pdf')
    assert.equal(result.totalPages, 2)
    assert.deepEqual(result.actualRange, { startPage: 2, endPage: 2 })
    assert.equal(result.pages[0].method, 'embedded')
    assert.match(result.text, /\[Page 2\][\s\S]*second synthetic/u)
    assert.equal(requests.length, 2)
  } finally {
    client.dispose()
  }
})

test('runner contracts enforce Linux limits and isolated macOS Python without shell', () => {
  const linux = pdfInvocation(
    { prlimit: '/usr/bin/prlimit', pdfinfo: '/usr/bin/pdfinfo' },
    'pdfinfo',
    ['private.pdf'],
  )
  assert.equal(linux[0], '/usr/bin/prlimit')
  for (const limit of ['--as=', '--cpu=', '--fsize=', '--nofile=', '--core='])
    assert.ok(linux[1].some((arg) => arg.startsWith(limit)))
  const mac = pdfInvocation(
    { platform: 'darwin', python3: '/usr/bin/python3', pdfinfo: '/opt/homebrew/bin/pdfinfo' },
    'pdfinfo',
    ['a;not-a-command'],
  )
  assert.equal(mac[0], '/usr/bin/python3')
  assert.equal(mac[1][0], '-I')
  assert.match(mac[1][2], /os.execve/u)
  assert.equal(mac[1].at(-1), 'a;not-a-command')
})
