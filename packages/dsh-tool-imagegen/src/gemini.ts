import { Buffer } from 'node:buffer'
import { GoogleGenAI, type GenerateContentParameters } from '@google/genai'
import type {
  AttachmentStore,
  ImageAttachmentRef,
  ImageMediaType,
  SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment'

export const IMAGE_MEDIA_TYPES: ImageMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]
export const DEFAULT_MODEL = 'gemini-3.1-flash-image'
export const DEFAULT_TIMEOUT_MS = 180_000
export const DEFAULT_MAX_PROMPT_CHARS = 8_000
export const DEFAULT_MAX_IMAGES = 4
export const DEFAULT_ASPECT_RATIO = '1:1'
export const DEFAULT_IMAGE_SIZE = '1K'

const MEDIA_TYPE_SET: ReadonlySet<string> = new Set(IMAGE_MEDIA_TYPES)
const ASPECT_RATIOS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'])
const IMAGE_SIZES = new Set(['1K', '2K', '4K'])

export interface GenerateLimits {
  maxPromptChars?: number
  maxImages?: number
}
export interface GenerateRequest {
  prompt: string
  aspectRatio: string
  imageSize: string
  numberOfImages: number
}
export interface GeneratedImage {
  data: Uint8Array
  mediaType: ImageMediaType
}
export interface ImageOutput {
  model: string
  prompt: string
  text: string
  images: Array<{ attachment: ImageAttachmentRef; index: number }>
}
export interface GeminiImageOptions extends GenerateLimits {
  model?: string
  timeoutMs?: number
  resolveApiKey(): Promise<unknown>
  attachmentStore?: Pick<AttachmentStore, 'saveImage'>
  saveImage?: (input: SaveImageAttachment) => Promise<ImageAttachmentRef>
  clientFactory?: (apiKey: string) => {
    models: { generateContent(input: GenerateContentParameters): Promise<unknown> }
  }
}

function property(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' && key in value
    ? Reflect.get(value, key)
    : undefined
}
function statusOf(error: unknown) {
  const status = property(error, 'status') ?? property(error, 'statusCode')
  return typeof status === 'number' && Number.isInteger(status) ? status : undefined
}
function aborted(operation: string) {
  return new Error(`Gemini ${operation} was aborted`)
}
function providerError(error: unknown, operation: string, signal?: AbortSignal) {
  if (
    signal?.aborted ||
    property(error, 'name') === 'AbortError' ||
    property(error, 'name') === 'APIUserAbortError'
  ) {
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
function awaitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  operation: string,
) {
  if (signal === undefined) return promise
  if (signal.aborted) return Promise.reject<T>(aborted(operation))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted(operation))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
function nonEmptyString(value: unknown, name: string) {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}
function positiveInteger(value: unknown, name: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`)
  return value
}
export function normalizeGenerateRequest(
  request: unknown,
  options: GenerateLimits = {},
): GenerateRequest {
  const prompt = nonEmptyString(property(request, 'prompt'), 'prompt')
  const maxPromptChars = options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS
  if (prompt.length > maxPromptChars)
    throw new Error(`prompt must contain at most ${maxPromptChars} characters`)
  const aspectRatio = property(request, 'aspectRatio') ?? DEFAULT_ASPECT_RATIO
  if (typeof aspectRatio !== 'string' || !ASPECT_RATIOS.has(aspectRatio))
    throw new Error(`aspectRatio must be one of: ${[...ASPECT_RATIOS].join(', ')}`)
  const imageSize = property(request, 'imageSize') ?? DEFAULT_IMAGE_SIZE
  if (typeof imageSize !== 'string' || !IMAGE_SIZES.has(imageSize))
    throw new Error(`imageSize must be one of: ${[...IMAGE_SIZES].join(', ')}`)
  const numberOfImages = positiveInteger(property(request, 'numberOfImages') ?? 1, 'numberOfImages')
  const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES
  if (numberOfImages > maxImages) throw new Error(`numberOfImages must be at most ${maxImages}`)
  return { prompt, aspectRatio, imageSize, numberOfImages }
}
function decodeBase64(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
  )
    throw new Error('Gemini returned invalid image bytes')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== value)
    throw new Error('Gemini returned invalid image bytes')
  return new Uint8Array(bytes)
}
function isImageMediaType(value: unknown): value is ImageMediaType {
  return typeof value === 'string' && MEDIA_TYPE_SET.has(value)
}
function imagePartOf(part: unknown): GeneratedImage | undefined {
  const inline = property(part, 'inlineData') ?? property(part, 'inline_data')
  if (inline === undefined || inline === null) return undefined
  const data =
    property(inline, 'data') ?? property(inline, 'imageBytes') ?? property(inline, 'image_bytes')
  const mediaType = property(inline, 'mimeType') ?? property(inline, 'mime_type')
  if (!isImageMediaType(mediaType))
    throw new Error(`Gemini returned unsupported image type: ${String(mediaType)}`)
  return { data: decodeBase64(data), mediaType }
}
export function extractImageResponse(response: unknown): {
  text: string
  images: GeneratedImage[]
} {
  const value = property(response, 'candidates')
  const candidates: unknown[] = Array.isArray(value) ? value : []
  const images: GeneratedImage[] = []
  const text: string[] = []
  for (const candidate of candidates) {
    const value = property(property(candidate, 'content'), 'parts')
    const parts: unknown[] = Array.isArray(value) ? value : []
    for (const part of parts) {
      const value = property(part, 'text')
      if (typeof value === 'string' && value.trim().length > 0) text.push(value.trim())
      const image = imagePartOf(part)
      if (image !== undefined) images.push(image)
    }
  }
  if (images.length === 0) {
    const finishMessage = candidates
      .map((candidate) => property(candidate, 'finishMessage'))
      .find((message): message is string => typeof message === 'string')
    throw new Error(
      finishMessage === undefined
        ? 'Gemini returned no image output; the prompt may have been blocked'
        : `Gemini returned no image output: ${finishMessage}`,
    )
  }
  return { text: [...new Set(text)].join('\n\n'), images }
}
function extensionFor(mediaType: ImageMediaType) {
  return mediaType.slice('image/'.length)
}
export class GeminiImageClient {
  readonly options: GeminiImageOptions &
    Required<
      Pick<
        GeminiImageOptions,
        'model' | 'timeoutMs' | 'maxPromptChars' | 'maxImages' | 'clientFactory'
      >
    >
  constructor(options: GeminiImageOptions) {
    this.options = {
      ...options,
      model: options.model ?? DEFAULT_MODEL,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxPromptChars: options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS,
      maxImages: options.maxImages ?? DEFAULT_MAX_IMAGES,
      clientFactory: options.clientFactory ?? ((apiKey) => new GoogleGenAI({ apiKey })),
    }
  }
  async apiKey(signal?: AbortSignal) {
    let apiKey: unknown
    try {
      apiKey = await awaitWithSignal(
        Promise.resolve().then(() => this.options.resolveApiKey()),
        signal,
        'credential resolution',
      )
    } catch {
      if (signal?.aborted) throw aborted('credential resolution')
      throw new Error('Gemini credential resolution failed')
    }
    if (typeof apiKey !== 'string' || apiKey.length === 0)
      throw new Error(
        'GEMINI_API_KEY is not configured; save it in the existing Gemini Settings card or export it in the launching environment',
      )
    return apiKey
  }
  async request(request: GenerateRequest, signal?: AbortSignal) {
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
          imageConfig: { aspectRatio: request.aspectRatio, imageSize: request.imageSize },
          ...(signal === undefined ? {} : { abortSignal: signal }),
          httpOptions: { timeout: this.options.timeoutMs },
        },
      })
    } catch (error) {
      throw providerError(error, 'image generation', signal)
    }
  }
  async saveImage(
    image: GeneratedImage,
    index: number,
    signal?: AbortSignal,
  ): Promise<ImageAttachmentRef> {
    const input: SaveImageAttachment = {
      data: image.data,
      mediaType: image.mediaType,
      name: `gemini-image-${index + 1}.${extensionFor(image.mediaType)}`,
    }
    const saveImage = this.options.saveImage
    if (typeof saveImage === 'function')
      return awaitWithSignal(
        Promise.resolve().then(() => saveImage(input)),
        signal,
        'image persistence',
      )
    const store = this.options.attachmentStore
    if (store === undefined || typeof store.saveImage !== 'function')
      throw new Error(
        'DSH durable image attachments are unavailable; mount the local attachment provider',
      )
    return awaitWithSignal(store.saveImage(input), signal, 'image persistence')
  }
  async generate(request: unknown, signal?: AbortSignal): Promise<ImageOutput> {
    const normalized = normalizeGenerateRequest(request, this.options)
    const response = await this.request(normalized, signal)
    const extracted = extractImageResponse(response)
    const images: ImageOutput['images'] = []
    for (const [index, image] of extracted.images.entries()) {
      if (signal?.aborted) throw aborted('image persistence')
      const attachment = await this.saveImage(image, index, signal)
      images.push({ attachment, index })
    }
    return { model: this.options.model, prompt: normalized.prompt, text: extracted.text, images }
  }
}
