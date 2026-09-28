import type { GenerateContentParameters, Interactions } from '@google/genai'
import type { ConcurrencyGate } from './concurrency.js'

type SdkInteractionRequest = Interactions.CreateModelInteractionParamsNonStreaming
type SdkContent = Extract<SdkInteractionRequest['input'], unknown[]>[number]
type SdkVideo = Extract<SdkContent, { type: 'video' }>

// Preserve the existing operator-gated agentic mode. SDK 2.21.0 only declares
// static video processing; this narrow extension does not establish API support.
type YoutubeVideoContent = Omit<SdkVideo, 'processing'> & {
  processing?: SdkVideo['processing'] | { type: 'agentic' }
}
export type InteractionRequest = Omit<SdkInteractionRequest, 'input'> & {
  input: string | (Exclude<SdkContent, { type: 'video' }> | YoutubeVideoContent)[]
  stream?: false
}
export interface ProviderRequestOptions {
  signal?: AbortSignal
  timeout: number
  maxRetries: number
}
// The SDK overloads include streaming; this adapter exposes only the non-streaming surface used here.
export interface GeminiClient {
  interactions: {
    create(request: InteractionRequest, options: ProviderRequestOptions): Promise<unknown>
    delete(
      id: string,
      params: {},
      options: Omit<ProviderRequestOptions, 'signal'>,
    ): Promise<unknown>
  }
  models: { generateContent(request: GenerateContentParameters): Promise<unknown> }
}
export interface ProviderUsage {
  operation: string
  inputTokens: number | undefined
  cachedTokens: number | undefined
  outputTokens: number | undefined
}
export interface GeminiTransportOptions {
  resolveApiKey: () => unknown | Promise<unknown>
  clientFactory: (apiKey: string) => GeminiClient | Promise<GeminiClient>
  timeoutMs: number
  providerRequestRetries: number
  reportUsage?: ((usage: ProviderUsage) => void) | undefined
  reportCleanupFailure?: ((operation: string, status: number | undefined) => void) | undefined
}
export interface RequestEstimate {
  mediaSeconds?: number
  kind?: string
}
export interface RequestBudget {
  consume(
    input: { mediaSeconds: number; textChars: number },
    context: { operation: string; kind: string },
  ): unknown
}

import { isRecord } from './response-values.js'
import { isRetryableProviderFailure } from './budget.js'

function optionalNonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function interactionUsage(operation: string, interaction: unknown) {
  const usage = isRecord(interaction) ? interaction.usage : undefined
  if (!isRecord(usage)) return undefined
  return {
    operation,
    inputTokens: optionalNonNegativeInteger(usage.total_input_tokens),
    cachedTokens: optionalNonNegativeInteger(usage.total_cached_tokens),
    outputTokens: optionalNonNegativeInteger(usage.total_output_tokens),
  }
}

function generateContentUsage(operation: string, response: unknown) {
  const usage = isRecord(response) ? response.usageMetadata : undefined
  if (!isRecord(usage)) return undefined
  return {
    operation,
    inputTokens: optionalNonNegativeInteger(usage.promptTokenCount),
    cachedTokens: optionalNonNegativeInteger(usage.cachedContentTokenCount),
    outputTokens: optionalNonNegativeInteger(usage.candidatesTokenCount),
  }
}

export function statusOf(error: unknown) {
  const status = isRecord(error) ? (error.status ?? error.statusCode) : undefined
  return typeof status === 'number' && Number.isInteger(status) ? status : undefined
}

function providerMessages(error: unknown) {
  if (!isRecord(error)) return []
  const payloads: unknown[] = [error.error]
  if (typeof error?.body === 'string' && error.body.length <= 20_000) {
    try {
      payloads.push(JSON.parse(error.body))
    } catch {
      // Ignore non-JSON provider bodies.
    }
  }
  const messages = [error?.message]
  for (const payload of payloads) {
    if (!isRecord(payload)) continue
    messages.push(payload.message, payload.status, payload.code, payload.reason)
    if (isRecord(payload.error)) {
      messages.push(
        payload.error.message,
        payload.error.status,
        payload.error.code,
        payload.error.reason,
      )
    }
  }
  return [
    ...new Set(messages.filter((value) => typeof value === 'string' && value.trim().length > 0)),
  ]
}

function providerErrorReason(error: unknown) {
  const text = providerMessages(error).join(' ').toLocaleLowerCase('en-US')
  if (
    /(?:\b(?:blocked|blocklist|copyright|filter|recitation|safety|policy|disallowed)\b|blocked_reason|prohibited_content|safety_blocked)/u.test(
      text,
    )
  ) {
    return 'content_filter'
  }
  const clippingTerm =
    /\b(?:processing|clips?|clipping|start[_ ]?offset|end[_ ]?offset|offsets?)\b/u
  const unsupportedTerm = /\b(?:unsupported|not support(?:ed)?|does not support|cannot use)\b/u
  const clippingIndex = text.search(clippingTerm)
  const unsupportedIndex = text.search(unsupportedTerm)
  if (
    clippingIndex >= 0 &&
    unsupportedIndex >= 0 &&
    Math.abs(clippingIndex - unsupportedIndex) <= 100
  ) {
    return 'clipping'
  }
  if (/\b(schema|response[_ ]?format|structured)/u.test(text)) return 'schema'
  if (/\b(context|token|input size|too (?:large|long))/u.test(text)) return 'input_size'
  if (/\byou ?tube\b/u.test(text)) return 'youtube_input'
  return undefined
}

export function providerError(error: unknown, operation: string, signal?: AbortSignal) {
  if (
    signal?.aborted ||
    (isRecord(error) && (error.name === 'AbortError' || error.name === 'APIUserAbortError'))
  ) {
    return new Error(`YouTube ${operation} was aborted`)
  }
  const status = statusOf(error)
  const reason = status === 400 ? providerErrorReason(error) : undefined
  let message
  if (status === 401 || status === 403) {
    message = 'Gemini rejected the configured API credential or cannot access this public video'
  } else if (status === 404) {
    message = 'Gemini could not access this public YouTube video'
  } else if (status === 429) {
    message = 'Gemini rate limit or quota exceeded'
  } else if (status === 400) {
    if (reason === 'content_filter') {
      message = `Gemini blocked ${operation} with its content filters; try a shorter excerpt or use youtube_watch for targeted spoken content`
    } else if (reason === 'clipping') {
      message = `Gemini rejected static YouTube clipping for ${operation} with this model/API combination`
    } else if (reason === 'schema') {
      message = `Gemini rejected the structured response schema for ${operation}`
    } else if (reason === 'input_size') {
      message = `Gemini rejected the video input size for ${operation}`
    } else if (reason === 'youtube_input') {
      message = `Gemini rejected the native YouTube input for ${operation}`
    } else {
      message = `Gemini ${operation} failed (HTTP 400: provider rejected the request)`
    }
  } else {
    message =
      status === undefined
        ? `Gemini ${operation} failed`
        : `Gemini ${operation} failed (HTTP ${status})`
  }
  const sanitized = new Error(message)
  if (status !== undefined) {
    Object.defineProperty(sanitized, 'status', { value: status })
  }
  if (reason !== undefined) {
    Object.defineProperty(sanitized, 'reason', { value: reason })
  }
  return sanitized
}

function awaitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  operation: string,
): Promise<T> {
  if (signal === undefined) return promise
  if (signal.aborted) return Promise.reject(providerError(undefined, operation, signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(providerError(undefined, operation, signal))
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

function requestTextChars(request: unknown) {
  if (!isRecord(request)) return 0
  let total = typeof request.system_instruction === 'string' ? request.system_instruction.length : 0
  if (isRecord(request.config) && typeof request.config.systemInstruction === 'string') {
    total += request.config.systemInstruction.length
  }
  if (Array.isArray(request.input)) {
    for (const item of request.input) {
      if (isRecord(item) && item.type === 'text' && typeof item.text === 'string')
        total += item.text.length
    }
  }
  if (Array.isArray(request.contents)) {
    for (const content of request.contents) {
      if (!isRecord(content) || !Array.isArray(content.parts)) continue
      for (const part of content.parts) {
        if (isRecord(part) && typeof part.text === 'string') total += part.text.length
      }
    }
  }
  return total
}

export function retryDelayMs(error: unknown, retry: number) {
  const headers = isRecord(error) ? error.headers : undefined
  const raw =
    headers instanceof Headers
      ? (headers.get('retry-after') ?? undefined)
      : isRecord(headers)
        ? ((typeof headers.get === 'function' ? headers.get('retry-after') : undefined) ??
          headers['retry-after'])
        : undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(5_000, Math.ceil(seconds * 1_000))
  return Math.min(5_000, 250 * 2 ** retry)
}

function waitForProviderRetry(error: unknown, retry: number, signal?: AbortSignal) {
  const delay = retryDelayMs(error, retry)
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      const aborted = new Error('YouTube provider retry was aborted')
      aborted.name = 'AbortError'
      reject(aborted)
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delay)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      const aborted = new Error('YouTube provider retry was aborted')
      aborted.name = 'AbortError'
      reject(aborted)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function createGeminiClient(apiKey: string): Promise<GeminiClient> {
  const { GoogleGenAI } = await import('@google/genai')
  const sdk = new GoogleGenAI({ apiKey })
  return {
    interactions: {
      // The only assertion bridges the documented agentic-mode SDK typing gap.
      // All other request fields retain the SDK's non-streaming request types.
      create: (request, options) =>
        sdk.interactions.create(request as SdkInteractionRequest, options),
      delete: (id, params, options) => sdk.interactions.delete(id, params, options),
    },
    models: { generateContent: (request) => sdk.models.generateContent(request) },
  }
}

export abstract class GeminiTransport {
  abstract options: GeminiTransportOptions
  async apiClient(signal: AbortSignal | undefined, operation: string): Promise<GeminiClient> {
    if (signal?.aborted) throw providerError(undefined, operation, signal)
    let apiKey
    try {
      apiKey = await awaitWithSignal(
        Promise.resolve().then(() => this.options.resolveApiKey()),
        signal,
        operation,
      )
    } catch (error) {
      if (signal?.aborted) throw providerError(error, operation, signal)
      throw new Error('Gemini credential resolution failed')
    }
    if (signal?.aborted) throw providerError(undefined, operation, signal)
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new Error(
        'GEMINI_API_KEY is not configured; save it in Plugins → YouTube → Configure or export it in the launching environment',
      )
    }
    return this.options.clientFactory(apiKey)
  }

  async interactionWithClient(
    client: GeminiClient,
    request: InteractionRequest,
    signal: AbortSignal | undefined,
    operation: string,
    budget: RequestBudget,
    estimate: RequestEstimate = {},
  ) {
    if (signal?.aborted) throw providerError(undefined, operation, signal)
    for (let retry = 0; ; retry += 1) {
      budget.consume(
        {
          mediaSeconds: estimate.mediaSeconds ?? 0,
          textChars: requestTextChars(request),
        },
        {
          operation,
          kind: retry === 0 ? (estimate.kind ?? 'interaction') : 'provider-retry',
        },
      )
      try {
        const interaction = await client.interactions.create(request, {
          ...(signal === undefined ? {} : { signal }),
          timeout: this.options.timeoutMs,
          maxRetries: 0,
        })
        const usage = interactionUsage(operation, interaction)
        if (usage !== undefined) {
          try {
            this.options.reportUsage?.(usage)
          } catch {
            // Usage reporting is observational and must never fail provider work.
          }
        }
        return interaction
      } catch (error) {
        if (
          retry >= this.options.providerRequestRetries ||
          !isRetryableProviderFailure(error, signal)
        ) {
          throw providerError(error, operation, signal)
        }
        try {
          await waitForProviderRetry(error, retry, signal)
        } catch (retryError) {
          throw providerError(retryError, operation, signal)
        }
      }
    }
  }

  async deleteInteraction(client: GeminiClient, interactionId: unknown, operation: string) {
    if (typeof interactionId !== 'string' || interactionId.length === 0) return
    try {
      await client.interactions.delete(
        interactionId,
        {},
        {
          timeout: Math.min(this.options.timeoutMs, 10_000),
          maxRetries: 0,
        },
      )
    } catch (error) {
      try {
        this.options.reportCleanupFailure?.(operation, statusOf(error))
      } catch {
        // Cleanup reporting is observational and must never mask the Tool outcome.
      }
    }
  }

  async cleanupInteractions(
    client: GeminiClient,
    interactionIds: readonly string[],
    operation: string,
    runProvider?: ConcurrencyGate,
  ) {
    for (const interactionId of [...interactionIds].reverse()) {
      const cleanup = () => this.deleteInteraction(client, interactionId, operation)
      if (runProvider === undefined) await cleanup()
      else await runProvider(cleanup)
    }
  }

  async interaction(
    request: InteractionRequest,
    signal: AbortSignal | undefined,
    operation: string,
    budget: RequestBudget,
    estimate?: RequestEstimate,
  ) {
    const client = await this.apiClient(signal, operation)
    return this.interactionWithClient(client, request, signal, operation, budget, estimate)
  }

  async generateContentWithClient(
    client: GeminiClient,
    request: GenerateContentParameters,
    signal: AbortSignal | undefined,
    operation: string,
    budget: RequestBudget,
    estimate: RequestEstimate = {},
  ) {
    if (signal?.aborted) throw providerError(undefined, operation, signal)
    for (let retry = 0; ; retry += 1) {
      budget.consume(
        {
          mediaSeconds: estimate.mediaSeconds ?? 0,
          textChars: requestTextChars(request),
        },
        {
          operation,
          kind: retry === 0 ? (estimate.kind ?? 'generate-content') : 'provider-retry',
        },
      )
      try {
        const response = await client.models.generateContent({
          ...request,
          config: {
            ...request.config,
            ...(signal === undefined ? {} : { abortSignal: signal }),
            httpOptions: {
              timeout: this.options.timeoutMs,
              retryOptions: { attempts: 1 },
            },
          },
        })
        const usage = generateContentUsage(operation, response)
        if (usage !== undefined) {
          try {
            this.options.reportUsage?.(usage)
          } catch {
            // Usage reporting is observational and must never fail provider work.
          }
        }
        return response
      } catch (error) {
        if (
          retry >= this.options.providerRequestRetries ||
          !isRetryableProviderFailure(error, signal)
        ) {
          throw providerError(error, operation, signal)
        }
        try {
          await waitForProviderRetry(error, retry, signal)
        } catch (retryError) {
          throw providerError(retryError, operation, signal)
        }
      }
    }
  }
}
