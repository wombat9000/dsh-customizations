import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { GeminiImageOptions, ImageOutput } from '../../src/gemini.js'
import type { ImageConfig } from '../../src/index.js'

declare const attachment: ImageAttachmentRef
declare const options: GeminiImageOptions
const output: ImageOutput = {
  model: 'fixture',
  prompt: 'fixture',
  text: '',
  images: [{ attachment, index: 0 }],
}
void output
// A save adapter must return a durable reference, not provider bytes or a URL.
// @ts-expect-error Provider URL is not an image attachment reference.
const invalidSave: GeminiImageOptions['saveImage'] = async () => 'https://provider.test/image.png'
void invalidSave
// @ts-expect-error Exact optional settings omit absent values rather than assigning undefined.
const invalidConfig: ImageConfig = {
  model: 'fixture',
  timeoutMs: 1,
  maxPromptChars: 1,
  maxImages: 1,
  generate: true,
  apiKey: undefined,
}
void invalidConfig
// @ts-expect-error Only raster formats accepted by the durable attachment store are allowed.
options.saveImage?.({ data: new Uint8Array(), mediaType: 'image/svg+xml' })
