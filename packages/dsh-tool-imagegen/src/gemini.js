import { Buffer } from 'node:buffer'
import { GoogleGenAI } from '@google/genai'

export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const DEFAULT_MODEL = 'gemini-3.1-flash-image'
export const DEFAULT_TIMEOUT_MS = 180_000
export const DEFAULT_MAX_PROMPT_CHARS = 8_000
export const DEFAULT_MAX_IMAGES = 4
export const DEFAULT_ASPECT_RATIO = '1:1'
export const DEFAULT_IMAGE_SIZE = '1K'

const MEDIA_TYPE_SET = new Set(IMAGE_MEDIA_TYPES)
const ASPECT_RATIOS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'])
const IMAGE_SIZES = new Set(['1K', '2K', '4K'])

function statusOf(error) {
  const status = error?.status ?? error?.statusCode
  return Number.isInteger(status) ? status : undefined
}

function aborted(operation) {
  return new Error(`Gemini ${operation} was aborted`)
}

function providerError(error, operation, signal) {
  if (signal?.aborted || error?.name === 'AbortError' || error?.name === 'APIUserAbortError') {
    return aborted(operation)
  }
  const status = statusOf(error)
  if (status === 401 || status === 403)
    return new Error('Gemini rejected the configured API credential')
  if (status === 429) return new Error('Gemini rate limit or quota exceeded')
  return new Error(
    status === undefined
      ? `Gemini ${operation} failed`
      : `Gemini ${operation} failed (HTTP ${status})`,
  )
}

function awaitWithSignal(promise, signal, operation) {
  if (signal === undefined) return promise
  if (signal.aborted) return Promise.reject(aborted(operation))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted(operation))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value.trim()
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`)
  return value
}

export function normalizeGenerateRequest(request, options = {}) {
  const prompt = nonEmptyString(request?.prompt, 'prompt')
  const maxPromptChars = options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS
  if (prompt.length > maxPromptChars)
    throw new Error(`prompt must contain at most ${maxPromptChars} characters`)

  const aspectRatio = request?.aspectRatio ?? DEFAULT_ASPECT_RATIO
  if (!ASPECT_RATIOS.has(aspectRatio))
    throw new Error(`aspectRatio must be one of: ${[...ASPECT_RATIOS].join(', ')}`)

  const imageSize = request?.imageSize ?? DEFAULT_IMAGE_SIZE
  if (!IMAGE_SIZES.has(imageSize))
    throw new Error(`imageSize must be one of: ${[...IMAGE_SIZES].join(', ')}`)

  const numberOfImages = positiveInteger(request?.numberOfImages ?? 1, 'numberOfImages')
  const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES
  if (numberOfImages > maxImages) throw new Error(`numberOfImages must be at most ${maxImages}`)

  return { prompt, aspectRatio, imageSize, numberOfImages }
}

function decodeBase64(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
  ) {
    throw new Error('Gemini returned invalid image bytes')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== value)
    throw new Error('Gemini returned invalid image bytes')
  return new Uint8Array(bytes)
}

function imagePartOf(part) {
  const inline = part?.inlineData ?? part?.inline_data
  if (inline === undefined || inline === null) return undefined
  const data = inline.data ?? inline.imageBytes ?? inline.image_bytes
  const mimeType = inline.mimeType ?? inline.mime_type
  if (!MEDIA_TYPE_SET.has(mimeType))
    throw new Error(`Gemini returned unsupported image type: ${String(mimeType)}`)
  return { data: decodeBase64(data), mediaType: mimeType }
}

export function extractImageResponse(response) {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : []
  const images = []
  const text = []
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
    for (const part of parts) {
      if (typeof part?.text === 'string' && part.text.trim().length > 0) text.push(part.text.trim())
      const image = imagePartOf(part)
      if (image !== undefined) images.push(image)
    }
  }
  if (images.length === 0) {
    const finishMessage = candidates.find(
      (candidate) => typeof candidate?.finishMessage === 'string',
    )?.finishMessage
    throw new Error(
      finishMessage === undefined
        ? 'Gemini returned no image output; the prompt may have been blocked'
        : `Gemini returned no image output: ${finishMessage}`,
    )
  }
  return { text: [...new Set(text)].join('\n\n'), images }
}

function extensionFor(mediaType) {
  return mediaType.slice('image/'.length)
}

export class GeminiImageClient {
  constructor(options) {
    this.options = {
      ...options,
      model: options.model ?? DEFAULT_MODEL,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxPromptChars: options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS,
      maxImages: options.maxImages ?? DEFAULT_MAX_IMAGES,
      clientFactory: options.clientFactory ?? ((apiKey) => new GoogleGenAI({ apiKey })),
    }
  }

  async apiKey(signal) {
    let apiKey
    try {
      apiKey = await awaitWithSignal(
        Promise.resolve().then(() => this.options.resolveApiKey()),
        signal,
        'credential resolution',
      )
    } catch (error) {
      if (signal?.aborted) throw aborted('credential resolution')
      throw new Error('Gemini credential resolution failed')
    }
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new Error(
        'GEMINI_API_KEY is not configured; save it in the existing Gemini Settings card or export it in the launching environment',
      )
    }
    return apiKey
  }

  async request(request, signal) {
    const apiKey = await this.apiKey(signal)
    if (signal?.aborted) throw aborted('image generation')
    try {
      const client = this.options.clientFactory(apiKey)
      return await client.models.generateContent({
        model: this.options.model,
        contents: request.prompt,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          candidateCount: request.numberOfImages,
          imageConfig: {
            aspectRatio: request.aspectRatio,
            imageSize: request.imageSize,
          },
          abortSignal: signal,
          httpOptions: { timeout: this.options.timeoutMs },
        },
      })
    } catch (error) {
      throw providerError(error, 'image generation', signal)
    }
  }

  async saveImage(image, index, signal) {
    const input = {
      data: image.data,
      mediaType: image.mediaType,
      name: `gemini-image-${index + 1}.${extensionFor(image.mediaType)}`,
    }
    const store = this.options.attachmentStore
    if (typeof this.options.saveImage === 'function') {
      return awaitWithSignal(
        Promise.resolve().then(() => this.options.saveImage(input)),
        signal,
        'image persistence',
      )
    }
    if (store === undefined || typeof store.saveImage !== 'function') {
      throw new Error(
        'DSH durable image attachments are unavailable; mount the local attachment provider',
      )
    }
    return awaitWithSignal(store.saveImage(input), signal, 'image persistence')
  }

  async generate(request, signal) {
    const normalized = normalizeGenerateRequest(request, this.options)
    const response = await this.request(normalized, signal)
    const extracted = extractImageResponse(response)
    const images = []
    for (let index = 0; index < extracted.images.length; index += 1) {
      if (signal?.aborted) throw aborted('image persistence')
      const attachment = await this.saveImage(extracted.images[index], index, signal)
      images.push({ attachment, index })
    }
    return {
      model: this.options.model,
      prompt: normalized.prompt,
      text: extracted.text,
      images,
    }
  }
}
