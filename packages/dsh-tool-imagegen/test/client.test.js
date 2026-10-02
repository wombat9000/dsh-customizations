import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))
const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url))

async function loadClient(react = React) {
  let record
  const source = await readFile(CLIENT_PATH, 'utf8')
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load(value) {
          record = value
        },
      },
    },
  })
  assert.ok(record)
  return {
    record,
    exports: record.factory((specifier) => {
      assert.equal(specifier, 'react')
      return react
    }),
  }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

const attachment = {
  attachmentId: 'sha256:test-image',
  mediaType: 'image/png',
  bytes: 12,
  width: 1024,
  height: 768,
  name: 'generated.png',
}

const settledBlock = {
  kind: 'tool-result',
  content: [
    { type: 'text', text: 'Generated 1 image.' },
    { type: 'image', attachment },
  ],
  isError: false,
}

test('package exposes the Web client bundle', async () => {
  const pkg = JSON.parse(await readFile(PACKAGE_PATH, 'utf8'))
  assert.equal(pkg.main, 'dist/src/index.js')
  assert.equal(pkg.exports['.'], './dist/src/index.js')
  assert.equal(pkg.exports['./src/index.js'], './dist/src/index.js')
  assert.equal(pkg.exports['./src/gemini.js'], './dist/src/gemini.js')
  assert.ok(pkg.files.includes('dist/**/*.js'))
  assert.equal(pkg.exports['./client'], './client.js')
  assert.ok(pkg.files.includes('client.js'))
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-conversation'])
})

test('client registers a generate_image Tool view with authorized attachment loading', async () => {
  const { record, exports } = await loadClient()
  assert.equal(record.id, '@local/dsh-tool-imagegen')
  assert.deepEqual(Array.from(exports.inject), ['slots', 'sessions'])

  const registrations = []
  const reads = []
  let available = true
  let failure = false
  let cleanup
  let disposed = false
  const context = {
    sessions: {
      binding(sessionId) {
        assert.equal(sessionId, 'session-1')
        if (!available) return undefined
        return {
          session: {
            async readAttachment(attachmentId) {
              reads.push(attachmentId)
              if (failure)
                return { ok: false, error: { code: 'denied', message: 'Not authorized' } }
              return { ok: true, value: { attachment, data: [1, 2, 3] } }
            },
          },
        }
      },
    },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'tool.call.toolview')
        cleanup = callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {
          disposed = true
        }
      },
    },
  }

  exports.apply(context)
  assert.equal(registrations.length, 1)
  const registration = registrations[0]
  assert.equal(registration.options.key, 'generate_image')
  assert.equal(registration.component, exports.GenerateImageToolView)
  const payload = await registration.options.inject().readAttachment('session-1', attachment)
  assert.deepEqual(plain(payload.data), [1, 2, 3])
  assert.deepEqual(reads, [attachment.attachmentId])
  const read = registration.options.inject().readAttachment
  assert.equal(read, registration.options.inject().readAttachment, 'reader identity stays stable')
  failure = true
  await assert.rejects(read('session-1', attachment), /denied: Not authorized/)
  available = false
  await assert.rejects(read('session-1', attachment), /Image session is unavailable: session-1/)
  assert.equal(reads.length, 2, 'unavailable sessions never read attachments')
  cleanup()
  assert.equal(disposed, true)
})

test('client extracts image content and renders preview entries', async () => {
  const { exports } = await loadClient()
  assert.deepEqual(plain(exports.imageBlocks(settledBlock)), [{ type: 'image', attachment }])
  assert.equal(exports.textSummary(settledBlock), 'Generated 1 image.')
  assert.deepEqual(plain(exports.imageBlocks({ kind: 'running' })), [])
  assert.deepEqual(plain(exports.imageBlocks(null)), [])
  assert.deepEqual(
    plain(
      exports.imageBlocks({
        kind: 'tool-result',
        content: [
          null,
          { type: 'image', attachment: null },
          { type: 'image', attachment: { ...attachment, mediaType: 'image/svg+xml' } },
        ],
      }),
    ),
    [],
  )

  const markup = renderToStaticMarkup(
    React.createElement(exports.GenerateImageToolView, {
      block: settledBlock,
      sessionId: 'session-1',
      readAttachment: async () => ({ attachment, data: [1, 2, 3] }),
    }),
  )
  assert.match(markup, /Generated image/)
  assert.match(markup, /1 image/)
  assert.match(markup, /Loading generated image/)
})

test('client renders running and empty-result states without raw JSON', async () => {
  const { exports } = await loadClient()
  const running = renderToStaticMarkup(
    React.createElement(exports.GenerateImageToolView, { block: { kind: 'running' } }),
  )
  assert.match(running, /Generating image/)

  const empty = renderToStaticMarkup(
    React.createElement(exports.GenerateImageToolView, {
      block: {
        kind: 'tool-result',
        content: [{ type: 'text', text: 'No image output.' }],
        isError: true,
      },
      sessionId: 'session-1',
      readAttachment: async () => {
        throw new Error('unused')
      },
    }),
  )
  assert.match(empty, /No image output/)
})
