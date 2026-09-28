export interface RequestEstimate {
  mediaSeconds?: number
  textChars?: number
}
export interface TokenEstimateOptions {
  videoTokensPerSecond?: number
  requestOverheadTokens?: number
}
export interface BudgetOptions extends TokenEstimateOptions {
  estimatedInputCostPerMillionTokensUsd: number
  maxEstimatedCostUsd: number
  maxProviderCalls: number
  maxEstimatedInputTokens: number
}
export interface BudgetContext {
  operation?: string
  kind?: string
}
export type BudgetAttempt = {
  index: number
  operation: string
  kind: string
  estimatedInputTokens: number
}
export type BudgetSnapshot = {
  providerCalls: number
  providerCallLimit: number
  estimatedInputTokens: number
  estimatedInputTokenLimit: number
  estimatedInputCostUsd?: number
  estimatedInputCostPerMillionTokensUsd?: number
  estimatedInputCostLimitUsd?: number
  attempts: BudgetAttempt[]
}
export interface BudgetProjection {
  additionalCalls: number
  additionalTokens: number
  projectedCalls: number
  projectedTokens: number
  projectedCostUsd: number
}
export interface YoutubeOperationBudget {
  snapshot(): BudgetSnapshot
  estimate(request: RequestEstimate): number
  assertCanFit(requests: RequestEstimate[], context?: BudgetContext): BudgetProjection
  consume(request: RequestEstimate, context?: BudgetContext): BudgetAttempt
}
function errorRecord(
  value: unknown,
): { status?: unknown; statusCode?: unknown; name?: unknown } | undefined {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return undefined
  return {
    ...('status' in value ? { status: value.status } : {}),
    ...('statusCode' in value ? { statusCode: value.statusCode } : {}),
    ...('name' in value ? { name: value.name } : {}),
  }
}

export const DEFAULT_MAX_VIDEO_DURATION_SECONDS = 14_400
export const DEFAULT_MAX_TRANSCRIPT_CHUNKS = 16
export const DEFAULT_MAX_PROVIDER_CALLS = 64
export const DEFAULT_MAX_ESTIMATED_INPUT_TOKENS = 3_000_000
export const DEFAULT_VIDEO_TOKENS_PER_SECOND = 300
export const DEFAULT_PROVIDER_REQUEST_RETRIES = 1
export const DEFAULT_INPUT_COST_PER_MILLION_TOKENS_USD = 0
export const DEFAULT_MAX_ESTIMATED_COST_USD = 0
export const DEFAULT_REQUEST_OVERHEAD_TOKENS = 2_000

const RETRYABLE_PROVIDER_STATUSES = new Set([408, 409, 425, 429])

export class YoutubeOperationLimitError extends Error {
  readonly code: string
  readonly details: Record<string, unknown>
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'YoutubeOperationLimitError'
    this.code = code
    this.details = { ...details }
  }
}

export function providerStatus(error: unknown): number | undefined {
  const record = errorRecord(error)
  const status = record?.status ?? record?.statusCode
  return typeof status === 'number' && Number.isInteger(status) ? status : undefined
}

export function isRetryableProviderFailure(error: unknown, signal?: AbortSignal): boolean {
  if (
    signal?.aborted ||
    errorRecord(error)?.name === 'AbortError' ||
    errorRecord(error)?.name === 'APIUserAbortError'
  ) {
    return false
  }
  const status = providerStatus(error)
  return (
    (status !== undefined && RETRYABLE_PROVIDER_STATUSES.has(status)) ||
    (status !== undefined && status >= 500 && status <= 599)
  )
}

export function estimateRequestInputTokens(
  input: RequestEstimate,
  options: TokenEstimateOptions = {},
): number {
  const mediaSeconds = input.mediaSeconds ?? 0
  const textChars = input.textChars ?? 0
  if (!Number.isSafeInteger(mediaSeconds) || mediaSeconds < 0) {
    throw new TypeError('YouTube request mediaSeconds must be a non-negative integer')
  }
  if (!Number.isSafeInteger(textChars) || textChars < 0) {
    throw new TypeError('YouTube request textChars must be a non-negative integer')
  }
  const videoTokensPerSecond = options.videoTokensPerSecond ?? DEFAULT_VIDEO_TOKENS_PER_SECOND
  const requestOverheadTokens = options.requestOverheadTokens ?? DEFAULT_REQUEST_OVERHEAD_TOKENS
  return Math.ceil(mediaSeconds * videoTokensPerSecond + textChars / 3 + requestOverheadTokens)
}

function roundedUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function safeDetails(options: BudgetContext, extra: Record<string, unknown> = {}) {
  return {
    operation: options.operation,
    ...extra,
  }
}

export function assertVideoDuration(
  durationSeconds: unknown,
  options: { maxVideoDurationSeconds: number },
  operation: string,
): asserts durationSeconds is number {
  if (typeof durationSeconds !== 'number' || !Number.isSafeInteger(durationSeconds)) {
    throw new YoutubeOperationLimitError(
      'VIDEO_DURATION_UNKNOWN',
      'YouTube video duration could not be determined safely',
      { operation },
    )
  }
  if (durationSeconds < 1) {
    throw new YoutubeOperationLimitError(
      'VIDEO_NOT_READY',
      'YouTube video has no finite duration; live or upcoming videos are not supported by this operation',
      { operation, durationSeconds },
    )
  }
  if (durationSeconds > options.maxVideoDurationSeconds) {
    throw new YoutubeOperationLimitError(
      'VIDEO_DURATION_LIMIT_EXCEEDED',
      `YouTube video duration ${durationSeconds}s exceeds the configured limit of ${options.maxVideoDurationSeconds}s`,
      { operation, durationSeconds, maxVideoDurationSeconds: options.maxVideoDurationSeconds },
    )
  }
}

export function assertTranscriptChunkCount(
  chunkCount: number,
  options: { maxTranscriptChunks: number },
  durationSeconds: number,
): void {
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1) {
    throw new TypeError('YouTube transcript chunkCount must be a positive integer')
  }
  if (chunkCount > options.maxTranscriptChunks) {
    throw new YoutubeOperationLimitError(
      'TRANSCRIPT_CHUNK_LIMIT_EXCEEDED',
      `YouTube transcript requires ${chunkCount} chunks, exceeding the configured limit of ${options.maxTranscriptChunks}`,
      { chunkCount, maxTranscriptChunks: options.maxTranscriptChunks, durationSeconds },
    )
  }
}

export function createYoutubeOperationBudget(
  options: BudgetOptions,
  onUpdate?: (snapshot: BudgetSnapshot) => void,
): YoutubeOperationBudget {
  let providerCalls = 0
  let estimatedInputTokens = 0
  const attempts: BudgetAttempt[] = []
  const estimatedInputCostPerMillionTokensUsd = options.estimatedInputCostPerMillionTokensUsd
  const maxEstimatedCostUsd = options.maxEstimatedCostUsd

  const estimateCost = (tokens: number) =>
    roundedUsd((tokens * estimatedInputCostPerMillionTokensUsd) / 1_000_000)

  const snapshot = (): BudgetSnapshot => ({
    providerCalls,
    providerCallLimit: options.maxProviderCalls,
    estimatedInputTokens,
    estimatedInputTokenLimit: options.maxEstimatedInputTokens,
    ...(estimatedInputCostPerMillionTokensUsd > 0
      ? {
          estimatedInputCostUsd: estimateCost(estimatedInputTokens),
          estimatedInputCostPerMillionTokensUsd,
        }
      : {}),
    ...(maxEstimatedCostUsd > 0 ? { estimatedInputCostLimitUsd: maxEstimatedCostUsd } : {}),
    attempts: attempts.map((attempt) => ({ ...attempt })),
  })

  const notify = () => {
    try {
      onUpdate?.(snapshot())
    } catch {
      // Budget reporting is observational and must not affect provider work.
    }
  }

  const estimate = (request: RequestEstimate) => estimateRequestInputTokens(request, options)
  const assertProjection = (
    requests: RequestEstimate[],
    context: BudgetContext = {},
  ): BudgetProjection => {
    const additionalCalls = requests.length
    const additionalTokens = requests.reduce((total, request) => total + estimate(request), 0)
    const projectedCalls = providerCalls + additionalCalls
    const projectedTokens = estimatedInputTokens + additionalTokens
    if (projectedCalls > options.maxProviderCalls) {
      throw new YoutubeOperationLimitError(
        'PROVIDER_CALL_LIMIT_EXCEEDED',
        `YouTube operation requires at least ${projectedCalls} provider calls, exceeding the configured limit of ${options.maxProviderCalls}`,
        safeDetails(context, {
          providerCalls,
          projectedCalls,
          providerCallLimit: options.maxProviderCalls,
        }),
      )
    }
    if (projectedTokens > options.maxEstimatedInputTokens) {
      throw new YoutubeOperationLimitError(
        'ESTIMATED_INPUT_TOKEN_LIMIT_EXCEEDED',
        `YouTube operation is estimated to require ${projectedTokens} input tokens, exceeding the configured limit of ${options.maxEstimatedInputTokens}`,
        safeDetails(context, {
          estimatedInputTokens,
          projectedEstimatedInputTokens: projectedTokens,
          estimatedInputTokenLimit: options.maxEstimatedInputTokens,
        }),
      )
    }
    const projectedCostUsd = estimateCost(projectedTokens)
    if (maxEstimatedCostUsd > 0 && projectedCostUsd > maxEstimatedCostUsd) {
      throw new YoutubeOperationLimitError(
        'ESTIMATED_COST_LIMIT_EXCEEDED',
        `YouTube operation is estimated to cost $${projectedCostUsd.toFixed(6)}, exceeding the configured limit of $${maxEstimatedCostUsd.toFixed(6)}`,
        safeDetails(context, {
          estimatedInputCostUsd: estimateCost(estimatedInputTokens),
          projectedEstimatedInputCostUsd: projectedCostUsd,
          estimatedInputCostLimitUsd: maxEstimatedCostUsd,
        }),
      )
    }
    return { additionalCalls, additionalTokens, projectedCalls, projectedTokens, projectedCostUsd }
  }

  return {
    snapshot,
    estimate,
    assertCanFit(requests, context) {
      if (!Array.isArray(requests)) throw new TypeError('YouTube budget requests must be an array')
      return assertProjection(requests, context)
    },
    consume(request, context = {}) {
      const projection = assertProjection([request], context)
      providerCalls = projection.projectedCalls
      estimatedInputTokens = projection.projectedTokens
      const attempt = {
        index: providerCalls,
        operation: context.operation ?? 'youtube',
        kind: context.kind ?? 'provider-request',
        estimatedInputTokens: projection.additionalTokens,
      }
      attempts.push(attempt)
      notify()
      return attempt
    },
  }
}
