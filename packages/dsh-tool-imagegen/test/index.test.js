import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_SIZE,
  DEFAULT_MAX_IMAGES,
  DEFAULT_MAX_PROMPT_CHARS,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  GeminiImageClient,
  IMAGE_MEDIA_TYPES,
  extractImageResponse,
  formatImageOutput,
  inject,
  normalizeGenerateRequest,
  registerImageTools,
  renderImageOutput,
  resolveConfig,
} from '../src/index.js'

const imageBytes = Buffer.from('fake-png-bytes').toString('base64')
const attachment = {
  attachmentId: 'sha256:test-image',
  mediaType: 'image/png',
  bytes: 14,
  width: 1024,
  height: 1024,
  name: 'gemini-image-1.png',
}

function clientOptions(overrides = {}) {
  return {
    model: DEFAULT_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
    maxImages: DEFAULT_MAX_IMAGES,
    resolveApiKey: async () => 'gemini-test-key',
    saveImage: async () => attachment,
    ...overrides,
  }
}

function fakeResponse() {
  return {
    candidates: [
      {
        content: {
          parts: [
            { text: 'A generated image.' },
            { inlineData: { data: imageBytes, mimeType: 'image/png' } },
          ],
        },
      },
    ],
  }
}

test('uses shared Gemini defaults and validates image request bounds', () => {
  assert.deepEqual(normalizeGenerateRequest({ prompt: 'A cabin' }), {
    prompt: 'A cabin',
    aspectRatio: DEFAULT_ASPECT_RATIO,
    imageSize: DEFAULT_IMAGE_SIZE,
    numberOfImages: 1,
  })
  assert.throws(
    () => normalizeGenerateRequest({ prompt: 'A cabin', aspectRatio: '5:7' }),
    /aspectRatio/,
  )
  assert.throws(() => normalizeGenerateRequest({ prompt: 'A cabin', imageSize: '8K' }), /imageSize/)
  assert.throws(
    () =>
      normalizeGenerateRequest(
        { prompt: 'A cabin', numberOfImages: DEFAULT_MAX_IMAGES + 1 },
        { maxImages: DEFAULT_MAX_IMAGES },
      ),
    /numberOfImages/,
  )
  assert.throws(
    () => normalizeGenerateRequest({ prompt: 'x'.repeat(DEFAULT_MAX_PROMPT_CHARS + 1) }),
    /prompt/,
  )
})

test('extracts text and inline image parts from Gemini output', () => {
  assert.deepEqual(extractImageResponse(fakeResponse()), {
    text: 'A generated image.',
    images: [{ data: new Uint8Array(Buffer.from('fake-png-bytes')), mediaType: 'image/png' }],
  })
})

test('rejects missing, malformed, or unsupported image output', () => {
  assert.throws(
    () => extractImageResponse({ candidates: [{ content: { parts: [{ text: 'Only text' }] } }] }),
    /no image output/,
  )
  assert.throws(
    () =>
      extractImageResponse({
        candidates: [
          { content: { parts: [{ inlineData: { data: 'not-base64', mimeType: 'image/png' } }] } },
        ],
      }),
    /invalid image bytes/,
  )
  assert.throws(
    () =>
      extractImageResponse({
        candidates: [
          { content: { parts: [{ inlineData: { data: imageBytes, mimeType: 'image/tiff' } }] } },
        ],
      }),
    /unsupported image type/,
  )
})

test('calls Gemini with image modalities and persists returned bytes', async () => {
  let observedKey
  let observedRequest
  let savedInput
  const client = new GeminiImageClient(
    clientOptions({
      clientFactory: (apiKey) => {
        observedKey = apiKey
        return {
          models: {
            generateContent: async (request) => {
              observedRequest = request
              return fakeResponse()
            },
          },
        }
      },
      saveImage: async (input) => {
        savedInput = input
        return attachment
      },
    }),
  )

  const controller = new AbortController()
  const result = await client.generate(
    {
      prompt: 'A cabin',
      aspectRatio: '16:9',
      imageSize: '2K',
      numberOfImages: 1,
    },
    controller.signal,
  )

  assert.equal(observedKey, 'gemini-test-key')
  assert.equal(observedRequest.model, DEFAULT_MODEL)
  assert.equal(observedRequest.contents, 'A cabin')
  assert.deepEqual(observedRequest.config.responseModalities, ['TEXT', 'IMAGE'])
  assert.deepEqual(observedRequest.config.imageConfig, { aspectRatio: '16:9', imageSize: '2K' })
  assert.equal(observedRequest.config.candidateCount, 1)
  assert.equal(observedRequest.config.abortSignal, controller.signal)
  assert.equal(observedRequest.config.httpOptions.timeout, DEFAULT_TIMEOUT_MS)
  assert.deepEqual(savedInput, {
    data: new Uint8Array(Buffer.from('fake-png-bytes')),
    mediaType: 'image/png',
    name: 'gemini-image-1.png',
  })
  assert.deepEqual(result, {
    model: DEFAULT_MODEL,
    prompt: 'A cabin',
    text: 'A generated image.',
    images: [{ attachment, index: 0 }],
  })
})

test('surfaces the shared key credential failure without creating a provider client', async () => {
  let created = false
  const client = new GeminiImageClient(
    clientOptions({
      resolveApiKey: async () => undefined,
      clientFactory: () => {
        created = true
        return {}
      },
    }),
  )
  await assert.rejects(client.generate({ prompt: 'A cabin' }), /GEMINI_API_KEY is not configured/)
  assert.equal(created, false)
})

test('renders durable image blocks and a bounded textual summary', () => {
  const value = {
    model: DEFAULT_MODEL,
    prompt: 'A cabin',
    text: 'A generated image.',
    images: [{ attachment, index: 0 }],
  }
  assert.match(formatImageOutput(value), /Generated 1 image/)
  assert.deepEqual(renderImageOutput({}, value), [
    { type: 'text', text: `Generated 1 image with ${DEFAULT_MODEL}.\n\nA generated image.` },
    { type: 'image', attachment },
  ])
})

test('registers generate_image with the DSH tool contract', async () => {
  const definitions = []
  const sections = []
  const ctx = {
    tools: { register: (definition) => definitions.push(definition) },
    systemPrompt: { section: (section) => sections.push(section) },
  }
  const client = {
    generate: async () => ({
      model: DEFAULT_MODEL,
      prompt: 'A cabin',
      text: '',
      images: [{ attachment, index: 0 }],
    }),
  }
  registerImageTools(ctx, { generate: true, timeoutMs: DEFAULT_TIMEOUT_MS }, client)

  assert.equal(definitions.length, 1)
  assert.equal(definitions[0].name, 'generate_image')
  assert.equal(definitions[0].timeoutMs, DEFAULT_TIMEOUT_MS)
  assert.equal(definitions[0].isConcurrencySafe({}), false)
  assert.equal(sections[0].name, 'tool:imagegen')
  const value = await definitions[0].execute({ prompt: 'A cabin' }, { signal: undefined })
  assert.equal(value.images[0].attachment.attachmentId, attachment.attachmentId)
  assert.equal(definitions[0].output.render({}, value)[1].type, 'image')
})

test('requires the durable attachment service before activation', () => {
  assert.ok(inject.includes('attachments'))
})

test('resolves configuration defaults and rejects invalid values', () => {
  const config = resolveConfig()
  assert.equal(config.model, DEFAULT_MODEL)
  assert.equal(config.generate, true)
  assert.deepEqual(IMAGE_MEDIA_TYPES, ['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  assert.throws(() => resolveConfig({ maxImages: 0 }), /positive integer/)
  assert.throws(() => resolveConfig({ model: ' ' }), /non-empty string/)
})
