import { createHash } from 'node:crypto'
import { secondsToTimestamp } from './url.js'

export const TRANSCRIBER_VERSION = 'youtube-transcript-v2'
export const DEFAULT_TRANSCRIPT_PAGE_SEGMENTS = 500
export const DEFAULT_TRANSCRIPT_SEARCH_RESULTS = 20
export const MAX_TRANSCRIPT_SEARCH_RESULTS = 50

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  const error = new Error('YouTube transcript request was aborted')
  error.name = 'AbortError'
  throw error
}

export function transcriptCompatibilityKey(video, durationSeconds, options) {
  const value = {
    videoId: video.videoId,
    durationSeconds,
    provider: 'gemini',
    model: options.model,
    transcriberVersion: TRANSCRIBER_VERSION,
    directTranscriptMaxSeconds: options.directTranscriptMaxSeconds,
    maximumTranscriptCoreSeconds: options.maximumTranscriptCoreSeconds,
    chunkOverlapSeconds: options.chunkOverlapSeconds,
  }
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function renderedSegmentLength(segment) {
  const speaker = segment.speaker === undefined ? '' : ` ${segment.speaker}:`
  return segment.timestamp.length + speaker.length + segment.text.length + 4
}

function ownedPublicSegment(segment) {
  return {
    startSeconds: segment.startSeconds,
    timestamp: secondsToTimestamp(segment.startSeconds),
    text: segment.text,
    ...(segment.speaker === undefined ? {} : { speaker: segment.speaker }),
  }
}

function boundedSegments(segments, maxChars, options = {}) {
  const selected = []
  let renderedChars = 0
  let nextCursor
  let pageOversize = false
  for (const item of segments) {
    const segment = ownedPublicSegment(item)
    const size = renderedSegmentLength(segment)
    if (renderedChars + size > maxChars) {
      if (selected.length > 0 || options.allowOversize !== true) {
        nextCursor = item.ordinal
        break
      }
      pageOversize = true
    }
    selected.push(segment)
    renderedChars += size
  }
  return { segments: selected, nextCursor, pageOversize }
}

export function archiveRecordToTranscript(record, maxOutputChars, source) {
  const bounded = boundedSegments(record.segments, maxOutputChars)
  const nextCursor = bounded.nextCursor ?? record.nextCursor
  const truncated = nextCursor !== undefined
  return {
    videoId: record.videoId,
    transcriptId: record.transcriptId,
    complete: true,
    totalSegments: record.segmentCount,
    inlineComplete: !truncated,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    durationSeconds: record.durationSeconds,
    timestampVerified: record.timestampVerified,
    caveats: record.caveats.map(String),
    language: record.language,
    speakers: record.speakers.map(String),
    segments: bounded.segments,
    processing: {
      ...record.processing,
      source,
    },
    truncated,
  }
}

function completeProgress(record) {
  const processing = record.processing
  return {
    phase: 'complete',
    strategy: processing.strategy,
    durationSeconds: record.durationSeconds,
    totalChunks: processing.chunksTotal,
    completedChunks: processing.chunksCompleted,
    activeChunks: 0,
    collectedSegments: record.segmentCount,
    chunks: processing.intervals.map((interval) => ({ ...interval })),
    truncated: false,
  }
}

export class ArchivedYoutubeClient {
  constructor(options) {
    this.client = options.client
    this.store = options.store
    this.options = options
    this.flights = new Map()
    this.disposed = false
  }

  watch(input, signal) {
    return this.client.watch(input, signal)
  }

  async transcript(input, signal, report) {
    if (this.disposed) throw new Error('YouTube transcript archive is unavailable')
    throwIfAborted(signal)
    const inspected = await this.client.inspectTranscript(input, signal)
    if (this.disposed) throw new Error('YouTube transcript archive is unavailable')
    throwIfAborted(signal)
    const compatibilityKey = transcriptCompatibilityKey(
      inspected.video,
      inspected.durationSeconds,
      this.options,
    )
    const lookup = {
      compatibilityKey,
      videoId: inspected.video.videoId,
      durationSeconds: inspected.durationSeconds,
    }
    const cached = this.store.findCompatible(lookup)
    if (cached !== undefined) {
      const page = this.store.readSegments(cached.transcriptId, {
        limit: DEFAULT_TRANSCRIPT_PAGE_SEGMENTS,
      })
      if (page !== undefined
        && (page.nextCursor !== undefined || page.segments.length === page.transcript.segmentCount)) {
        const record = {
          ...page.transcript,
          segments: page.segments,
          nextCursor: page.nextCursor,
        }
        report?.(completeProgress(record))
        return archiveRecordToTranscript(record, this.options.maxTranscriptOutputChars, 'archive')
      }
      if (page !== undefined) this.store.deleteTranscript(cached.transcriptId)
    }

    let flight = this.flights.get(compatibilityKey)
    if (flight?.controller.signal.aborted) {
      if (this.flights.get(compatibilityKey) === flight) this.flights.delete(compatibilityKey)
      flight = undefined
    }
    const source = flight === undefined ? 'generated' : 'shared-in-flight'
    if (flight === undefined) {
      flight = this.createFlight(compatibilityKey, inspected)
      this.flights.set(compatibilityKey, flight)
    }
    return this.waitForFlight(flight, signal, report, source)
  }

  createFlight(compatibilityKey, inspected) {
    const controller = new AbortController()
    const flight = {
      compatibilityKey,
      controller,
      subscribers: new Set(),
      waiters: 0,
      settled: false,
      lastProgress: undefined,
      promise: undefined,
    }
    const publish = (progress) => {
      flight.lastProgress = progress
      for (const subscriber of flight.subscribers) {
        try {
          subscriber(progress)
        } catch {
          // Progress is observational and isolated per waiting Tool call.
        }
      }
    }
    flight.promise = (async () => {
      const transcript = await this.client.generateTranscript(
        inspected.video,
        inspected.durationSeconds,
        controller.signal,
        publish,
      )
      throwIfAborted(controller.signal)
      const generated = {
        ...transcript,
        processing: { ...transcript.processing, source: 'generated' },
      }
      const saved = this.store.saveComplete({
        videoId: inspected.video.videoId,
        canonicalUrl: inspected.video.url,
        durationSeconds: inspected.durationSeconds,
        compatibilityKey,
        model: this.options.model,
        transcriberVersion: TRANSCRIBER_VERSION,
        language: generated.language,
        speakers: generated.speakers,
        timestampVerified: generated.timestampVerified,
        caveats: generated.caveats,
        processing: generated.processing,
        segments: generated.segments,
      })
      return saved.transcript
    })().finally(() => {
      flight.settled = true
      if (this.flights.get(compatibilityKey) === flight) this.flights.delete(compatibilityKey)
    })
    flight.promise.catch(() => {})
    return flight
  }

  waitForFlight(flight, signal, report, source) {
    throwIfAborted(signal)
    flight.waiters += 1
    if (report !== undefined) {
      flight.subscribers.add(report)
      if (flight.lastProgress !== undefined) report(flight.lastProgress)
    }
    return new Promise((resolve, reject) => {
      let active = true
      const detach = () => {
        if (!active) return
        active = false
        signal?.removeEventListener('abort', onAbort)
        if (report !== undefined) flight.subscribers.delete(report)
        flight.waiters -= 1
        if (flight.waiters === 0 && !flight.settled) {
          flight.controller.abort(new Error('Every transcript requester cancelled'))
        }
      }
      const onAbort = () => {
        detach()
        const error = new Error('YouTube transcript request was aborted')
        error.name = 'AbortError'
        reject(error)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      flight.promise.then(
        (record) => {
          if (!active) return
          detach()
          resolve(archiveRecordToTranscript(record, this.options.maxTranscriptOutputChars, source))
        },
        (error) => {
          if (!active) return
          detach()
          reject(error)
        },
      )
    })
  }

  read(input, signal) {
    throwIfAborted(signal)
    const maxChars = input.maxChars ?? this.options.maxTranscriptOutputChars
    if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 200_000) {
      throw new Error('maxChars must be an integer between 1 and 200000')
    }
    const page = this.store.readSegments(input.transcriptId, {
      cursor: input.cursor,
      startSeconds: input.startSeconds,
      endSeconds: input.endSeconds,
      limit: DEFAULT_TRANSCRIPT_PAGE_SEGMENTS,
    })
    if (page === undefined) throw new Error('Archived YouTube transcript was not found')
    throwIfAborted(signal)
    const bounded = boundedSegments(page.segments, maxChars, { allowOversize: true })
    const nextCursor = bounded.nextCursor ?? page.nextCursor
    return {
      transcriptId: page.transcript.transcriptId,
      videoId: page.transcript.videoId,
      durationSeconds: page.transcript.durationSeconds,
      complete: true,
      inlineComplete: nextCursor === undefined,
      ...(nextCursor === undefined ? {} : { nextCursor }),
      ...(bounded.pageOversize ? { pageOversize: true } : {}),
      segments: bounded.segments,
    }
  }

  search(input, signal) {
    throwIfAborted(signal)
    const maxResults = input.maxResults ?? DEFAULT_TRANSCRIPT_SEARCH_RESULTS
    if (!Number.isSafeInteger(maxResults) || maxResults < 1
      || maxResults > MAX_TRANSCRIPT_SEARCH_RESULTS) {
      throw new Error(`maxResults must be an integer between 1 and ${MAX_TRANSCRIPT_SEARCH_RESULTS}`)
    }
    const result = this.store.search(input.transcriptId, input.query, { limit: maxResults })
    if (result === undefined) throw new Error('Archived YouTube transcript was not found')
    throwIfAborted(signal)
    return {
      transcriptId: result.transcript.transcriptId,
      videoId: result.transcript.videoId,
      matches: result.matches.map((match) => ({
        startSeconds: match.startSeconds,
        timestamp: secondsToTimestamp(match.startSeconds),
        text: match.text,
        ...(match.speaker === undefined ? {} : { speaker: match.speaker }),
        score: match.score,
      })),
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const flight of this.flights.values()) {
      flight.controller.abort(new Error('YouTube transcript archive stopped'))
    }
  }
}
