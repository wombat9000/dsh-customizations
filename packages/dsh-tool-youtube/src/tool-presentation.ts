import type {
  WatchOutput,
  TranscriptOutput,
  TranscriptReadOutput,
  TranscriptSearchOutput,
} from './tool-schemas.js'
import { secondsToTimestamp } from './url.js'

export function formatWatchOutput(value: WatchOutput) {
  const sections = [value.answer]
  if (value.evidence.length > 0) {
    sections.push(
      [
        'Evidence:',
        ...value.evidence.map((item) => {
          const basis =
            item.basis !== undefined && ['observation', 'inference'].includes(item.basis)
              ? item.basis
              : 'unknown'
          return `- [${item.timestamp}] (${item.modality}; basis: ${basis}) ${item.description}`
        }),
      ].join('\n'),
    )
  }
  if (value.caveats.length > 0) {
    sections.push(['Caveats:', ...value.caveats.map((item) => `- ${item}`)].join('\n'))
  }
  return sections.join('\n\n')
}

export function formatTranscriptOutput(value: TranscriptOutput) {
  const metadata = [`Language: ${value.language}`]
  if (value.transcriptId !== undefined)
    metadata.push(`Transcript archive ID: ${value.transcriptId}`)
  if (value.processing?.source !== undefined) metadata.push(`Source: ${value.processing.source}`)
  if (value.durationSeconds !== undefined) {
    metadata.push(`Duration: ${secondsToTimestamp(value.durationSeconds)}`)
  }
  if (value.timestampVerified !== undefined) {
    metadata.push(
      `Timestamps: ${value.timestampVerified ? 'checked against duration bounds (not independently verified event timing)' : 'unverified'}`,
    )
  }
  if (value.speakers.length > 0) metadata.push(`Speakers: ${value.speakers.join(', ')}`)
  const lines = value.segments.map((segment) => {
    const speaker = segment.speaker === undefined ? '' : ` ${segment.speaker}:`
    return `[${segment.timestamp}]${speaker} ${segment.text}`
  })
  if (lines.length === 0)
    lines.push('(No transcript segments fit within the configured output limit.)')
  if (value.truncated) {
    const continuation =
      value.nextCursor === undefined
        ? ''
        : ` Continue with youtube_transcript_read using cursor ${value.nextCursor}.`
    lines.push('', `(Inline transcript truncated at a segment boundary.${continuation})`)
  }
  const output = `${metadata.join('\n')}\n\n${lines.join('\n')}`
  if (Array.isArray(value.caveats) && value.caveats.length > 0) {
    return `${output}\n\nCaveats:\n${value.caveats.map((item) => `- ${item}`).join('\n')}`
  }
  return output
}

export function formatTranscriptReadOutput(value: TranscriptReadOutput) {
  const lines = value.segments.map((segment) => {
    const speaker = segment.speaker === undefined ? '' : ` ${segment.speaker}:`
    return `[${segment.timestamp}]${speaker} ${segment.text}`
  })
  if (lines.length === 0) lines.push('(No transcript segments matched this page or range.)')
  if (value.nextCursor !== undefined) {
    lines.push('', `(More archived segments are available at cursor ${value.nextCursor}.)`)
  }
  return lines.join('\n')
}

export function formatTranscriptSearchOutput(value: TranscriptSearchOutput) {
  if (value.matches.length === 0) return 'No matching archived transcript segments.'
  return value.matches
    .map((match) => {
      const speaker = match.speaker === undefined ? '' : ` ${match.speaker}:`
      return `[${match.timestamp}]${speaker} ${match.text}`
    })
    .join('\n')
}

// Pick optional fields explicitly; never serialize an absent value as undefined.
function optionalFields<T extends object, K extends keyof T>(
  value: T,
  names: K[],
): Partial<Pick<T, K>> {
  // Every emitted key comes from names and retains its corresponding T value.
  return Object.fromEntries(
    names.filter((name) => value[name] !== undefined).map((name) => [name, value[name]]),
  ) as Partial<Pick<T, K>>
}

export function watchPresentationMeta(_args: unknown, value: WatchOutput) {
  return {
    kind: 'youtube-card',
    version: 1,
    operation: 'watch',
    video: { videoId: value.videoId, durationSeconds: value.durationSeconds },
    result: {
      durationSeconds: value.durationSeconds,
      evidenceCount: value.evidence.length,
      timestampVerified: value.timestampVerified,
    },
    processing: value.processing,
    notices: value.caveats.slice(0, 5),
  }
}

export function transcriptPresentationMeta(
  config: { directTranscriptMaxSeconds: number; maximumTranscriptCoreSeconds: number },
  _args: unknown,
  value: TranscriptOutput,
) {
  const chunked = (value.durationSeconds ?? NaN) > config.directTranscriptMaxSeconds
  const totalChunks =
    value.processing?.chunksTotal ??
    (chunked ? Math.ceil((value.durationSeconds ?? NaN) / config.maximumTranscriptCoreSeconds) : 1)
  return {
    phase: 'complete',
    strategy: value.processing?.strategy ?? (chunked ? 'chunked' : 'direct'),
    ...optionalFields(value, ['durationSeconds']),
    totalChunks,
    completedChunks: value.processing?.chunksCompleted ?? totalChunks,
    activeChunks: 0,
    collectedSegments: value.processing?.collectedSegments ?? value.segments.length,
    ...(value.processing === undefined ? {} : { chunks: value.processing.intervals }),
    truncated: value.truncated,
    result: {
      ...optionalFields(value, ['transcriptId', 'durationSeconds', 'totalSegments']),
      language: value.language,
      timestampVerified: value.timestampVerified,
      ...optionalFields(value, ['nextCursor', 'inlineComplete']),
    },
    completeness: {
      sourceComplete: value.complete,
      ...optionalFields(value, ['inlineComplete', 'nextCursor']),
    },
    ...optionalFields(value, ['processing']),
  }
}

export function readPresentationMeta(
  args: { transcriptId: string; cursor?: number; startSeconds?: number; endSeconds?: number },
  value: TranscriptReadOutput,
) {
  return {
    kind: 'youtube-card',
    version: 1,
    operation: 'transcript-read',
    video: { videoId: value.videoId, durationSeconds: value.durationSeconds },
    request: {
      transcriptId: args.transcriptId,
      ...optionalFields(args, ['cursor', 'startSeconds', 'endSeconds']),
    },
    result: {
      transcriptId: value.transcriptId,
      durationSeconds: value.durationSeconds,
      returnedSegments: value.segments.length,
      ...optionalFields(value, ['nextCursor']),
      inlineComplete: value.inlineComplete,
    },
    completeness: {
      inlineComplete: value.inlineComplete,
      ...optionalFields(value, ['nextCursor']),
    },
  }
}

export function searchPresentationMeta(
  args: { transcriptId: string; query: string },
  value: TranscriptSearchOutput,
) {
  return {
    kind: 'youtube-card',
    version: 1,
    operation: 'transcript-search',
    video: { videoId: value.videoId },
    request: { transcriptId: args.transcriptId, query: args.query },
    result: { transcriptId: value.transcriptId, matchCount: value.matches.length },
  }
}
