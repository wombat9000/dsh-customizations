import { parseYoutubeUrl, secondsToTimestamp, timestampToSeconds } from './url.js'

export const DEFAULT_MAX_YOUTUBE_HTML_CHARS = 5_000_000
export const DEFAULT_DIRECT_WATCH_MAX_SECONDS = 1_200
export const DEFAULT_LOW_RESOLUTION_WATCH_MAX_SECONDS = 7_200
export const DEFAULT_MAXIMUM_WATCH_CORE_SECONDS = 900
export const DEFAULT_WATCH_CHUNK_OVERLAP_SECONDS = 15
export const DEFAULT_MAX_WATCH_CHUNKS = 16

export const ADAPTIVE_WATCH_ERROR_CODES = Object.freeze({
  VIDEO_METADATA_INVALID: 'VIDEO_METADATA_INVALID',
  VIDEO_DURATION_UNKNOWN: 'VIDEO_DURATION_UNKNOWN',
  VIDEO_DURATION_LIMIT_EXCEEDED: 'VIDEO_DURATION_LIMIT_EXCEEDED',
  LIVE_VIDEO_UNSUPPORTED: 'LIVE_VIDEO_UNSUPPORTED',
  WATCH_STRATEGY_UNAVAILABLE: 'WATCH_STRATEGY_UNAVAILABLE',
  WATCH_CHUNK_LIMIT_EXCEEDED: 'WATCH_CHUNK_LIMIT_EXCEEDED',
  WATCH_EVIDENCE_INVALID: 'WATCH_EVIDENCE_INVALID',
  WATCH_TIMESTAMP_OUT_OF_RANGE: 'WATCH_TIMESTAMP_OUT_OF_RANGE',
})

export class AdaptiveWatchError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'AdaptiveWatchError'
    this.code = code
    this.details = { ...details }
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value, maxChars) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (normalized.length === 0) return undefined
  return normalized.slice(0, maxChars)
}

function jsonObjectAfterMarker(html, marker, maximumChars) {
  const markerIndex = html.indexOf(marker)
  if (markerIndex < 0) return undefined
  const start = html.indexOf('{', markerIndex + marker.length)
  if (start < 0) return undefined
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < html.length && index - start <= maximumChars; index += 1) {
    const character = html[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

export function extractYoutubePlayerResponse(html, options = {}) {
  const maxHtmlChars = options.maxHtmlChars ?? DEFAULT_MAX_YOUTUBE_HTML_CHARS
  if (typeof html !== 'string' || html.length === 0 || html.length > maxHtmlChars) {
    throw new AdaptiveWatchError(
      ADAPTIVE_WATCH_ERROR_CODES.VIDEO_METADATA_INVALID,
      'YouTube returned missing or oversized video metadata',
      { maxHtmlChars },
    )
  }
  const maximumObjectChars = Math.min(maxHtmlChars, options.maxObjectChars ?? 2_000_000)
  const markers = ['ytInitialPlayerResponse =', 'ytInitialPlayerResponse=', '"ytInitialPlayerResponse":']
  for (const marker of markers) {
    const response = jsonObjectAfterMarker(html, marker, maximumObjectChars)
    if (isRecord(response)) return response
  }
  throw new AdaptiveWatchError(
    ADAPTIVE_WATCH_ERROR_CODES.VIDEO_METADATA_INVALID,
    'YouTube player metadata was not found',
  )
}

function thumbnailOf(videoDetails) {
  const values = videoDetails?.thumbnail?.thumbnails
  if (!Array.isArray(values)) return undefined
  const urls = values.flatMap((item) => boundedString(item?.url, 2_000) ?? [])
  return urls.at(-1)
}

function liveStateOf(response, durationSeconds) {
  const details = response.videoDetails
  const micro = response.microformat?.playerMicroformatRenderer
  const live = micro?.liveBroadcastDetails
  if (details?.isUpcoming === true || live?.isUpcoming === true) return 'upcoming'
  if (live?.isLiveNow === true) return 'live'
  if (details?.isLiveContent === true) {
    if (boundedString(live?.endTimestamp, 100) !== undefined || durationSeconds !== undefined) {
      return 'ended-live'
    }
    return 'live'
  }
  return durationSeconds === undefined ? 'unknown' : 'vod'
}

export function normalizeYoutubeVideoMetadata(response, video, options = {}) {
  if (!isRecord(response) || !isRecord(response.videoDetails)) {
    throw new AdaptiveWatchError(
      ADAPTIVE_WATCH_ERROR_CODES.VIDEO_METADATA_INVALID,
      'YouTube returned invalid player metadata',
    )
  }
  const details = response.videoDetails
  const rawDuration = Number(details.lengthSeconds)
  const durationSeconds = Number.isSafeInteger(rawDuration) && rawDuration > 0
    ? rawDuration
    : undefined
  const liveState = liveStateOf(response, durationSeconds)
  return {
    videoId: video.videoId,
    canonicalUrl: video.url,
    ...(boundedString(details.title, 200) === undefined ? {} : { title: boundedString(details.title, 200) }),
    ...(boundedString(details.author, 200) === undefined ? {} : { channel: boundedString(details.author, 200) }),
    ...(thumbnailOf(details) === undefined ? {} : { thumbnailUrl: thumbnailOf(details) }),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    durationVerified: durationSeconds !== undefined,
    durationSource: 'youtube-player',
    liveState,
    inspectedAt: options.inspectedAt ?? Date.now(),
  }
}

export function parseYoutubeVideoMetadata(html, url, options = {}) {
  const video = parseYoutubeUrl(url)
  return normalizeYoutubeVideoMetadata(extractYoutubePlayerResponse(html, options), video, options)
}

export async function inspectYoutubeVideo(url, options = {}) {
  const video = parseYoutubeUrl(url)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new AdaptiveWatchError(ADAPTIVE_WATCH_ERROR_CODES.VIDEO_METADATA_INVALID, 'Video inspection requires fetch')
  }
  const response = await fetchImpl(video.url, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DSH YouTube tool)', 'Accept-Language': 'en-US,en;q=0.9' },
    signal: options.signal,
  })
  if (!response?.ok) {
    throw new AdaptiveWatchError(
      ADAPTIVE_WATCH_ERROR_CODES.VIDEO_METADATA_INVALID,
      `YouTube metadata request failed (HTTP ${response?.status ?? 'unknown'})`,
      { status: response?.status },
    )
  }
  const maxHtmlChars = options.maxHtmlChars ?? DEFAULT_MAX_YOUTUBE_HTML_CHARS
  const contentLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxHtmlChars * 4) {
    throw new AdaptiveWatchError(
      ADAPTIVE_WATCH_ERROR_CODES.VIDEO_METADATA_INVALID,
      'YouTube metadata response was oversized',
      { maxHtmlChars },
    )
  }
  const html = await response.text()
  return normalizeYoutubeVideoMetadata(extractYoutubePlayerResponse(html, { ...options, maxHtmlChars }), video, options)
}

const EXHAUSTIVE_PATTERNS = [
  /\b(?:every|all)\s+(?:instance|instances|occurrence|occurrences|time|times|example|examples)\b/iu,
  /\bcomplete\s+(?:timeline|list|inventory)\b/iu,
  /\bthroughout\b/iu,
]
const TARGETED_PATTERNS = [
  /\b(?:when|where|before|after)\b/iu,
  /\b(?:clicks?|opens?|closes?|saves?|changes?|appears?|disappears?)\b/iu,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/u,
]
const GLOBAL_PATTERNS = [
  /\b(?:summari[sz]e|summary|overview|main (?:idea|ideas|theme|themes)|what is (?:this|the) video about)\b/iu,
]

export function classifyWatchQuestion(question) {
  if (typeof question !== 'string' || question.trim().length === 0) {
    throw new TypeError('YouTube watch question must be a non-empty string')
  }
  const text = question.trim()
  if (EXHAUSTIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { intent: 'exhaustive', source: 'deterministic', confidence: 'high', reasonCode: 'explicit-all' }
  }
  if (GLOBAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return { intent: 'global', source: 'deterministic', confidence: 'high', reasonCode: 'summary' }
  }
  if (TARGETED_PATTERNS.some((pattern) => pattern.test(text))) {
    return { intent: 'targeted', source: 'deterministic', confidence: 'medium', reasonCode: 'specific-event' }
  }
  return { intent: 'global', source: 'fallback', confidence: 'low', reasonCode: 'default-global' }
}

export function planBalancedWatchChunks(durationSeconds, options = {}) {
  const maximumCoreSeconds = options.maximumCoreSeconds ?? DEFAULT_MAXIMUM_WATCH_CORE_SECONDS
  const overlapSeconds = options.overlapSeconds ?? DEFAULT_WATCH_CHUNK_OVERLAP_SECONDS
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_WATCH_CHUNKS
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1) throw new TypeError('Watch chunk duration must be positive')
  if (!Number.isSafeInteger(maximumCoreSeconds) || maximumCoreSeconds < 1) throw new TypeError('maximumCoreSeconds must be positive')
  if (!Number.isSafeInteger(overlapSeconds) || overlapSeconds < 0 || overlapSeconds >= maximumCoreSeconds) {
    throw new TypeError('overlapSeconds must be non-negative and smaller than maximumCoreSeconds')
  }
  const count = Math.ceil(durationSeconds / maximumCoreSeconds)
  if (count > maxChunks) {
    throw new AdaptiveWatchError(
      ADAPTIVE_WATCH_ERROR_CODES.WATCH_CHUNK_LIMIT_EXCEEDED,
      `Adaptive YouTube watch requires ${count} chunks, exceeding the configured limit of ${maxChunks}`,
      { count, maxChunks, durationSeconds },
    )
  }
  return Array.from({ length: count }, (_value, index) => {
    const coreStartSeconds = Math.floor(index * durationSeconds / count)
    const coreEndSeconds = index === count - 1 ? durationSeconds : Math.floor((index + 1) * durationSeconds / count)
    return {
      id: String(index + 1), index, coreStartSeconds, coreEndSeconds,
      clipStartSeconds: Math.max(0, coreStartSeconds - overlapSeconds),
      clipEndSeconds: Math.min(durationSeconds, coreEndSeconds + overlapSeconds),
    }
  })
}

export function planAdaptiveWatch(inspection, classification, options = {}) {
  const capabilities = options.capabilities ?? {}
  const intent = classification?.intent ?? 'global'
  const durationSeconds = inspection?.durationSeconds
  const liveState = inspection?.liveState ?? 'unknown'
  const allowUnknown = options.allowUnknownDuration === true
  const agentic = options.enableAgentic !== false && capabilities.agentic === true
  const low = options.enableLowResolution !== false && capabilities.lowResolution === true
  const chunking = options.enableChunking !== false && capabilities.clipping === true

  if (liveState === 'live' || liveState === 'upcoming') {
    if (options.enableLiveSnapshots === true && intent === 'targeted' && agentic) {
      return { strategy: 'direct-agentic', intent, durationVerified: false, liveState, coverageMode: 'live-snapshot', chunks: [] }
    }
    throw new AdaptiveWatchError(ADAPTIVE_WATCH_ERROR_CODES.LIVE_VIDEO_UNSUPPORTED, 'Live or upcoming YouTube videos are not supported by bounded analysis', { liveState })
  }
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1) {
    if (allowUnknown && intent === 'targeted' && agentic) {
      return { strategy: 'direct-agentic', intent, durationVerified: false, liveState, coverageMode: 'selective', chunks: [] }
    }
    if (allowUnknown && intent !== 'exhaustive' && low) {
      return { strategy: 'direct-low', intent, durationVerified: false, liveState, coverageMode: 'unknown', chunks: [] }
    }
    throw new AdaptiveWatchError(ADAPTIVE_WATCH_ERROR_CODES.VIDEO_DURATION_UNKNOWN, 'YouTube video duration is required for bounded adaptive analysis')
  }
  if (Number.isSafeInteger(options.maxVideoDurationSeconds) && durationSeconds > options.maxVideoDurationSeconds) {
    throw new AdaptiveWatchError(ADAPTIVE_WATCH_ERROR_CODES.VIDEO_DURATION_LIMIT_EXCEEDED, 'YouTube video exceeds the adaptive watch duration limit', { durationSeconds, maxVideoDurationSeconds: options.maxVideoDurationSeconds })
  }
  const base = { intent, durationSeconds, durationVerified: inspection.durationVerified === true, liveState, chunks: [] }
  if (durationSeconds <= (options.directMaxSeconds ?? DEFAULT_DIRECT_WATCH_MAX_SECONDS)) {
    return { ...base, strategy: 'direct-default', coverageMode: 'full-timeline' }
  }
  if (intent === 'targeted' && agentic) return { ...base, strategy: 'direct-agentic', coverageMode: 'selective' }
  if (intent !== 'exhaustive' && low && durationSeconds <= (options.lowResolutionMaxSeconds ?? DEFAULT_LOW_RESOLUTION_WATCH_MAX_SECONDS)) {
    return { ...base, strategy: 'direct-low', coverageMode: 'full-timeline' }
  }
  if (chunking) {
    return {
      ...base,
      strategy: 'chunked',
      coverageMode: 'full-timeline',
      chunks: planBalancedWatchChunks(durationSeconds, {
        maximumCoreSeconds: options.maximumCoreSeconds,
        overlapSeconds: options.overlapSeconds,
        maxChunks: options.maxChunks,
      }),
    }
  }
  throw new AdaptiveWatchError(ADAPTIVE_WATCH_ERROR_CODES.WATCH_STRATEGY_UNAVAILABLE, 'No enabled adaptive watch strategy can safely process this video', { intent, durationSeconds })
}

function evidenceSeconds(item, snakeName, camelName, timestampName) {
  const direct = item[snakeName] ?? item[camelName]
  if (Number.isSafeInteger(direct)) return direct
  return timestampToSeconds(item[timestampName])
}

export function normalizeWatchEvidence(item, durationSeconds, options = {}) {
  if (!isRecord(item) || !Number.isSafeInteger(durationSeconds) || durationSeconds < 1) {
    throw new AdaptiveWatchError(ADAPTIVE_WATCH_ERROR_CODES.WATCH_EVIDENCE_INVALID, 'Adaptive watch evidence is invalid')
  }
  const startSeconds = evidenceSeconds(item, 'start_seconds', 'startSeconds', 'timestamp')
  const endSeconds = evidenceSeconds(item, 'end_seconds', 'endSeconds', 'endTimestamp')
  if (!Number.isSafeInteger(startSeconds) || startSeconds < 0 || startSeconds > durationSeconds
    || (endSeconds !== undefined && (!Number.isSafeInteger(endSeconds) || endSeconds < startSeconds || endSeconds > durationSeconds))) {
    throw new AdaptiveWatchError(
      ADAPTIVE_WATCH_ERROR_CODES.WATCH_TIMESTAMP_OUT_OF_RANGE,
      'Adaptive watch evidence timestamp is outside the verified duration',
      { startSeconds, endSeconds, durationSeconds },
    )
  }
  const description = boundedString(item.description, options.maxDescriptionChars ?? 4_000)
  if (description === undefined || !['visual', 'spoken', 'mixed'].includes(item.modality)) {
    throw new AdaptiveWatchError(ADAPTIVE_WATCH_ERROR_CODES.WATCH_EVIDENCE_INVALID, 'Adaptive watch evidence description or modality is invalid')
  }
  const basis = item.basis === 'inference' ? 'inference' : 'observation'
  return {
    startSeconds,
    timestamp: secondsToTimestamp(startSeconds),
    ...(endSeconds === undefined ? {} : { endSeconds, endTimestamp: secondsToTimestamp(endSeconds) }),
    description,
    modality: item.modality,
    basis,
  }
}

export function offsetWatchChunkEvidence(items, chunk, durationSeconds) {
  const clipDuration = chunk.clipEndSeconds - chunk.clipStartSeconds
  const finalCore = chunk.coreEndSeconds === durationSeconds
  if (!Array.isArray(items) || !Number.isSafeInteger(clipDuration) || clipDuration < 1) return []
  return items.flatMap((item, evidenceIndex) => {
    const local = normalizeWatchEvidence(item, clipDuration)
    const globalStart = chunk.clipStartSeconds + local.startSeconds
    const owned = globalStart >= chunk.coreStartSeconds
      && (finalCore ? globalStart <= chunk.coreEndSeconds : globalStart < chunk.coreEndSeconds)
    if (!owned) return []
    const globalEnd = local.endSeconds === undefined
      ? undefined
      : Math.min(durationSeconds, chunk.clipStartSeconds + local.endSeconds)
    return [{
      ...local,
      startSeconds: globalStart,
      timestamp: secondsToTimestamp(globalStart),
      ...(globalEnd === undefined ? {} : { endSeconds: globalEnd, endTimestamp: secondsToTimestamp(globalEnd) }),
      chunkId: chunk.id ?? String(chunk.index + 1),
      evidenceIndex,
    }]
  })
}

function canonicalEvidence(value) {
  return value.toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function similarity(left, right) {
  if (left === right) return 1
  const a = new Set(left.split(' ').filter(Boolean))
  const b = new Set(right.split(' ').filter(Boolean))
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const word of a) if (b.has(word)) intersection += 1
  return intersection / new Set([...a, ...b]).size
}

export function deduplicateWatchEvidence(items, options = {}) {
  const driftSeconds = options.driftSeconds ?? 2
  const threshold = options.similarityThreshold ?? 0.8
  const sorted = items.map((item, index) => ({ ...item, _order: index, _canonical: canonicalEvidence(item.description) }))
    .sort((left, right) => left.startSeconds - right.startSeconds || left._order - right._order)
  const kept = []
  for (const candidate of sorted) {
    const duplicateIndex = kept.findLastIndex((prior) => (
      candidate.chunkId !== prior.chunkId
      && candidate.startSeconds - prior.startSeconds <= driftSeconds
      && candidate.modality === prior.modality
      && similarity(candidate._canonical, prior._canonical) >= threshold
    ))
    if (duplicateIndex < 0) kept.push(candidate)
    else {
      const prior = kept[duplicateIndex]
      if ((prior.basis === 'inference' && candidate.basis === 'observation')
        || (prior.basis === candidate.basis && candidate.description.length > prior.description.length)) {
        kept[duplicateIndex] = candidate
      }
    }
  }
  return kept.map(({ _order, _canonical, ...item }) => item)
}

export function mergeWatchChunkEvidence(chunkResults, durationSeconds, options = {}) {
  const values = chunkResults.flatMap((result) => offsetWatchChunkEvidence(result.evidence ?? [], result.chunk, durationSeconds))
  return deduplicateWatchEvidence(values, options)
}

function mergeRanges(ranges) {
  const merged = []
  for (const range of ranges.sort((left, right) => left.startSeconds - right.startSeconds)) {
    const previous = merged.at(-1)
    if (previous !== undefined && range.startSeconds <= previous.endSeconds) {
      previous.endSeconds = Math.max(previous.endSeconds, range.endSeconds)
    } else merged.push({ ...range })
  }
  return merged
}

export function calculateWatchCoverage(durationSeconds, chunks, successfulChunkIds) {
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1) throw new TypeError('Coverage duration must be positive')
  const successful = successfulChunkIds instanceof Set ? successfulChunkIds : new Set(successfulChunkIds)
  const ranges = mergeRanges(chunks.filter((chunk) => successful.has(chunk.id ?? String(chunk.index + 1))).map((chunk) => ({
    startSeconds: chunk.coreStartSeconds,
    endSeconds: chunk.coreEndSeconds,
  })))
  const coveredSeconds = ranges.reduce((total, range) => total + range.endSeconds - range.startSeconds, 0)
  const gaps = []
  let cursor = 0
  for (const range of ranges) {
    if (range.startSeconds > cursor) gaps.push({ startSeconds: cursor, endSeconds: range.startSeconds, reason: 'failed' })
    cursor = Math.max(cursor, range.endSeconds)
  }
  if (cursor < durationSeconds) gaps.push({ startSeconds: cursor, endSeconds: durationSeconds, reason: 'failed' })
  return {
    mode: 'full-timeline',
    complete: coveredSeconds === durationSeconds,
    totalSeconds: durationSeconds,
    coveredSeconds,
    ratio: Math.round((coveredSeconds / durationSeconds) * 1_000_000) / 1_000_000,
    ranges,
    gaps,
  }
}
