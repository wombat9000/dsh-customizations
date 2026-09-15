import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))
const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url))

function fakeReact() {
  return {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity).filter((child) => child !== null) }
    },
    useState(initial) { return [initial, () => {}] },
    useEffect() {},
  }
}

async function loadClient(react = fakeReact()) {
  let record
  const source = await readFile(CLIENT_PATH, 'utf8')
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { record = value } } },
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
  assert.equal(pkg.exports['./client'], './client.js')
  assert.ok(pkg.files.includes('client.js'))
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-ui-conversation',
  ])
})

test('client registers a generate_image Tool view with authorized attachment loading', async () => {
  const { record, exports } = await loadClient()
  assert.equal(record.id, '@local/dsh-tool-imagegen')
  assert.deepEqual(Array.from(exports.inject), ['slots', 'sessions'])

  const registrations = []
  const reads = []
  const context = {
    sessions: {
      binding(sessionId) {
        assert.equal(sessionId, 'session-1')
        return {
          session: {
            async readAttachment(attachmentId) {
              reads.push(attachmentId)
              return { ok: true, value: { attachment, data: [1, 2, 3] } }
            },
          },
        }
      },
    },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'tool.call.toolview')
        callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
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
})

test('client extracts image content and renders preview entries', async () => {
  const { exports } = await loadClient()
  assert.deepEqual(plain(exports.imageBlocks(settledBlock)), [{ type: 'image', attachment }])
  assert.equal(exports.textSummary(settledBlock), 'Generated 1 image.')
  assert.deepEqual(plain(exports.imageBlocks({ kind: 'running' })), [])

  const tree = exports.GenerateImageToolView({
    block: settledBlock,
    sessionId: 'session-1',
    readAttachment: async () => ({ attachment, data: [1, 2, 3] }),
  })
  const gallery = tree.children[1]
  assert.equal(gallery.type, 'div')
  assert.equal(gallery.children.length, 1)
  assert.equal(gallery.children[0].type, exports.ImagePreview)
  assert.equal(gallery.children[0].props.attachment.attachmentId, attachment.attachmentId)
})

test('client renders running and empty-result states without raw JSON', async () => {
  const { exports } = await loadClient()
  const running = exports.GenerateImageToolView({ block: { kind: 'running' } })
  assert.match(JSON.stringify(plain(running)), /Generating image/)

  const empty = exports.GenerateImageToolView({
    block: { kind: 'tool-result', content: [{ type: 'text', text: 'No image output.' }], isError: true },
    sessionId: 'session-1',
    readAttachment: async () => { throw new Error('unused') },
  })
  assert.match(JSON.stringify(plain(empty)), /No image output/)
})
