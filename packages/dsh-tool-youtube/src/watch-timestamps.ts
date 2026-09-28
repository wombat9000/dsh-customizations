import { secondsToTimestamp } from './url.js'
import { isRecord } from './response-values.js'

export interface WatchTimestampContext {
  strategy: string
  chunkId?: string
  startSeconds: number
  endSeconds: number
  attempts?: number
}
export interface TimestampEvidence extends Record<string, unknown> {
  start_seconds: number
  timestamp: string
}
export interface TimestampValidatedResponse extends Record<string, unknown> {
  evidence: TimestampEvidence[]
}

// Provider timestamps always use the full video origin, including clipped requests.
// The explicit origin prevents accepting an unlabeled 900 in clip [885, 1800]
// and silently moving it to 1785. Bounds checks do not verify event timing.
export function watchResponseSchema(startSeconds: number, endSeconds: number) {
  assertBounds(startSeconds, endSeconds)
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      timebase: { type: 'string', enum: ['full-video'] },
      answer: { type: 'string' },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            start_seconds: { type: 'integer', minimum: startSeconds, maximum: endSeconds },
            description: { type: 'string' },
            modality: { type: 'string', enum: ['visual', 'spoken', 'mixed'] },
            basis: { type: 'string', enum: ['observation', 'inference'] },
          },
          required: ['start_seconds', 'description', 'modality', 'basis'],
        },
      },
      caveats: { type: 'array', items: { type: 'string' } },
    },
    required: ['timebase', 'answer', 'evidence', 'caveats'],
  }
}

function assertBounds(start: number, end: number) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    throw new TypeError('Watch timestamp contract requires ordered non-negative integer bounds')
  }
}

export function watchTimestampPrompt(
  durationSeconds: number,
  startSeconds = 0,
  endSeconds = durationSeconds,
) {
  assertBounds(startSeconds, endSeconds)
  return `Authoritative full-video duration: ${durationSeconds} seconds. Supplied interval: [${startSeconds}, ${endSeconds}] seconds in the full video. Return timebase="full-video" and integer start_seconds in this inclusive interval. Zero is the beginning of the FULL VIDEO, not the clip. Do not guess, clamp, or infer timing from text; use only timing grounded in the attached media. Return empty evidence if nothing relevant is observed.`
}

export class WatchTimestampError extends Error {
  readonly code: string
  constructor(context: WatchTimestampContext, seconds: unknown, reason: string) {
    const safeSeconds = Number.isSafeInteger(seconds) ? seconds : 'missing/invalid'
    super(
      `Watch timestamp contract failed: strategy=${context.strategy}; chunk=${context.chunkId ?? 'direct'}; clip=[${context.startSeconds},${context.endSeconds}]; seconds=${safeSeconds}; expected=full-video integer [${context.startSeconds},${context.endSeconds}]; attempts=${context.attempts ?? 1}; reason=${reason}. Event timing could not be grounded; rerunning unchanged output will not fix it.`,
    )
    this.name = 'WatchTimestampError'
    this.code = 'WATCH_TIMESTAMP_CONTRACT'
  }
}

export function validateWatchTimestamps(
  value: unknown,
  context: WatchTimestampContext,
): TimestampValidatedResponse {
  assertBounds(context.startSeconds, context.endSeconds)
  if (!isRecord(value) || value.timebase !== 'full-video') {
    throw new WatchTimestampError(
      context,
      isRecord(value) && Array.isArray(value.evidence) && isRecord(value.evidence[0])
        ? value.evidence[0].start_seconds
        : undefined,
      'missing or incompatible timebase',
    )
  }
  if (!Array.isArray(value.evidence))
    throw new WatchTimestampError(context, undefined, 'missing evidence array')
  const evidence = value.evidence.map((item) => {
    const seconds = isRecord(item) ? item.start_seconds : undefined
    if (
      typeof seconds !== 'number' ||
      !Number.isSafeInteger(seconds) ||
      seconds < context.startSeconds ||
      seconds > context.endSeconds
    ) {
      throw new WatchTimestampError(context, seconds, 'out of bounds')
    }
    return {
      ...(isRecord(item) ? item : {}),
      start_seconds: seconds,
      timestamp: secondsToTimestamp(seconds),
    }
  })
  return { ...value, evidence }
}

// The caller resubmits the media, never a text-only request that invents timing.
// Transport, budget accounting, cancellation and provider error handling remain shared.
export async function watchWithTimestampCorrection<T>(
  request: (attempt: number) => Promise<T>,
  decode: (response: T) => unknown,
  context: WatchTimestampContext,
  signal?: AbortSignal,
): Promise<TimestampValidatedResponse> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (signal?.aborted) throw new Error('YouTube video analysis was aborted')
    const response = await request(attempt)
    if (signal?.aborted) throw new Error('YouTube video analysis was aborted')
    const value = decode(response)
    try {
      return validateWatchTimestamps(value, { ...context, attempts: attempt })
    } catch (error) {
      if (!(error instanceof WatchTimestampError) || attempt === 2) throw error
    }
  }
  throw new Error('Watch timestamp correction exhausted')
}
