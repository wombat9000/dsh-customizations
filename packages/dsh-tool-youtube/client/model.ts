import type { ToolBlock, Progress, Chunk } from './contracts.ts'
import { TOOL_LABELS, STATE_COLORS } from './constants.ts'
export type YoutubeCardModel = ReturnType<typeof youtubeCardModel>
export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}
export function isChunk(value: unknown): value is Chunk {
  return (
    isRecord(value) &&
    typeof value.startSeconds === 'number' &&
    typeof value.endSeconds === 'number' &&
    typeof value.status === 'string' &&
    (value.id === undefined || typeof value.id === 'string' || typeof value.id === 'number') &&
    (value.index === undefined || typeof value.index === 'number')
  )
}
export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    env: 'launch environment',
    file: 'DSH credential store',
    'project-env': 'project .env',
    'user-env': 'user .env',
  }
  return labels[source] ?? source
}

export function apiKeyFailure(value: string) {
  if (value.length === 0 || value.trim().length === 0) return 'Enter a Gemini API key.'
  const trimmed = value.trim()
  if (!/^[\x21-\x7e]+$/u.test(trimmed))
    return 'Use an unquoted API key containing printable characters only.'
  if (
    /^[A-Za-z_][A-Za-z0-9_]*=/u.test(trimmed) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return 'Paste only the API key, without GEMINI_API_KEY= or surrounding quotes.'
  }
}

export function formatDuration(seconds: unknown) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return undefined
  const whole = Math.round(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const remainder = whole % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function argsOf(block: ToolBlock | undefined) {
  const raw = block?.kind === 'tool-result' ? block.call?.argsRaw : block?.argsRaw
  if (typeof raw !== 'string') return {}
  try {
    const value: unknown = JSON.parse(raw)
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

export function textOfResult(block: ToolBlock | undefined) {
  if (block?.kind !== 'tool-result' || !Array.isArray(block.content)) return ''
  const content: unknown[] = block.content
  return content
    .flatMap((item) =>
      isRecord(item) && item.type === 'text' && typeof item.text === 'string' ? [item.text] : [],
    )
    .join('\n')
}

export function compact(value: unknown, limit = 160) {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (normalized.length === 0) return undefined
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1).trimEnd()}…`
}

export function secondsOfTimestamp(value: unknown) {
  if (typeof value !== 'string') return undefined
  const parts = value.split(':').map(Number)
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    parts.some((part) => !Number.isSafeInteger(part) || part < 0)
  )
    return undefined
  if ((parts.at(-1) ?? 0) > 59 || (parts.length === 3 && (parts.at(-2) ?? 0) > 59)) return undefined
  return parts.length === 3
    ? (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)
    : (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
}

export function outputFacts(toolName: string | undefined, text: string) {
  const lines = text.split('\n')
  const timestampEntries = lines.flatMap((line) => {
    const match = line.match(
      /^\s*-?\s*\[([0-9]+:[0-9]{2}(?::[0-9]{2})?)\]\s*(?:\(([^)]+)\)\s*)?(.*)$/u,
    )
    if (match === null) return []
    return [
      {
        timestamp: match[1],
        seconds: secondsOfTimestamp(match[1]),
        modality: match[2],
        text: (match[3] ?? '').trim(),
      },
    ]
  })
  const valueAfter = (label: string) => {
    const line = lines.find((item) => item.startsWith(`${label}: `))
    return line === undefined ? undefined : line.slice(label.length + 2).trim()
  }
  const sectionIndex = (...labels: string[]) => {
    const indexes = labels.map((label) => lines.indexOf(label)).filter((index) => index >= 0)
    return indexes.length === 0 ? lines.length : Math.min(...indexes)
  }
  const caveatIndex = lines.indexOf('Caveats:')
  const caveats =
    caveatIndex < 0
      ? []
      : lines
          .slice(caveatIndex + 1)
          .filter((line) => line.startsWith('- '))
          .map((line) => line.slice(2))
  const cursorMatch = text.match(/(?:cursor|using cursor)\s+(\d+)/iu)
  let excerpt
  if (toolName === 'youtube_watch') {
    excerpt = compact(lines.slice(0, sectionIndex('Evidence:', 'Caveats:')).join(' '), 320)
  }
  return {
    excerpt,
    timestampEntries,
    caveats,
    language: valueAfter('Language'),
    transcriptId: valueAfter('Transcript archive ID'),
    source: valueAfter('Source'),
    duration: valueAfter('Duration'),
    timestampState: valueAfter('Timestamps'),
    speakers: valueAfter('Speakers'),
    nextCursor: cursorMatch === null ? undefined : Number(cursorMatch[1]),
    truncated: /(?:inline transcript truncated|more archived segments are available)/iu.test(text),
  }
}

export function videoIdOf(args: Record<string, unknown>, meta: Record<string, unknown>) {
  const direct = (isRecord(meta.video) ? meta.video.videoId : undefined) ?? meta?.videoId
  if (typeof direct === 'string' && /^[A-Za-z0-9_-]{11}$/u.test(direct)) return direct
  if (typeof args.url !== 'string') return undefined
  const match = args.url.match(
    /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})(?:[^A-Za-z0-9_-]|$)/u,
  )
  return match?.[1]
}

export function errorText(block: ToolBlock | undefined, rendered: string) {
  if (rendered.trim().length > 0) return compact(rendered, 240)
  const candidate = block?.error?.message ?? block?.result?.error?.message ?? block?.message
  return compact(candidate, 240) ?? 'The operation failed. Open details for more information.'
}

export function transcriptProgress(
  block: ToolBlock | undefined,
  liveProgress: Progress | undefined,
): Progress {
  const settled = block?.kind === 'tool-result'
  const meta = isRecord(block?.meta) ? block.meta : undefined
  if (!settled) return liveProgress ?? { phase: 'inspecting' }
  if (block.isError === true) return { ...(liveProgress ?? {}), phase: 'failed' }
  if (meta?.phase === 'complete') {
    return Array.isArray(meta.chunks)
      ? meta
      : { ...(liveProgress ?? {}), ...meta, phase: 'complete' }
  }
  return { ...(liveProgress ?? {}), phase: 'complete' }
}

export function progressFacts(progress: Progress) {
  const chunks = Array.isArray(progress?.chunks)
    ? progress.chunks
        .filter(isChunk)
        .map((chunk) => ({
          ...chunk,
          status: chunk.status === 'running' ? 'transcribing' : chunk.status,
        }))
        .sort((left, right) => left.startSeconds - right.startSeconds)
    : []
  const total = isInteger(progress?.totalChunks) ? progress.totalChunks : undefined
  const completed = isInteger(progress?.completedChunks) ? progress.completedChunks : 0
  let percent
  if (
    chunks.length > 0 &&
    typeof progress.durationSeconds === 'number' &&
    Number.isFinite(progress.durationSeconds) &&
    progress.durationSeconds > 0
  ) {
    const completedSeconds = chunks.reduce(
      (sum, chunk) =>
        sum +
        (chunk.status === 'complete' ? Math.max(0, chunk.endSeconds - chunk.startSeconds) : 0),
      0,
    )
    percent = Math.max(
      0,
      Math.min(100, Math.round((completedSeconds / progress.durationSeconds) * 100)),
    )
  } else if (total !== undefined && total > 0) {
    percent = Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
  } else if (progress?.phase === 'complete') {
    percent = 100
  }
  const recovering = chunks.some((chunk) =>
    ['fallback', 'neutral', 'splitting'].includes(chunk.status),
  )
  const phase = progress?.phase ?? 'inspecting'
  const label =
    phase === 'complete'
      ? 'Complete'
      : phase === 'failed'
        ? 'Failed'
        : phase === 'merging'
          ? 'Finalizing transcript…'
          : phase === 'transcribing'
            ? `${recovering ? 'Recovering' : 'Transcribing'}${total === undefined ? '…' : ` ${completed}/${total}`}`
            : 'Inspecting video…'
  return { chunks, total, completed, percent, recovering, phase, label }
}

export function youtubeCardModel(
  toolName: string | undefined,
  block: ToolBlock | undefined,
  liveProgress: Progress | undefined,
  degraded = false,
) {
  const args = argsOf(block)
  const text = textOfResult(block)
  const parsed = outputFacts(toolName, text)
  const meta = isRecord(block?.meta) ? block.meta : {}
  const result = isRecord(meta.result) ? meta.result : meta
  const completeness = isRecord(meta.completeness) ? meta.completeness : {}
  const processing = isRecord(meta.processing) ? meta.processing : meta
  const settled = block?.kind === 'tool-result'
  const failed = settled && block.isError === true
  const progress =
    toolName === 'youtube_transcript' ? transcriptProgress(block, liveProgress) : undefined
  const progressInfo = progress === undefined ? undefined : progressFacts(progress)
  const videoId = videoIdOf(args, meta)
  const duration =
    formatDuration(result.durationSeconds ?? processing.durationSeconds) ?? parsed.duration
  const totalSegments = isInteger(result.totalSegments) ? result.totalSegments : undefined
  const shownSegments = parsed.timestampEntries.length
  const evidenceCount = isInteger(result.evidenceCount)
    ? result.evidenceCount
    : toolName === 'youtube_watch'
      ? parsed.timestampEntries.length
      : undefined
  const matchCount = isInteger(result.matchCount)
    ? result.matchCount
    : toolName === 'youtube_transcript_search'
      ? shownSegments
      : undefined
  const nextCursor = isInteger(completeness.nextCursor)
    ? completeness.nextCursor
    : isInteger(result.nextCursor)
      ? result.nextCursor
      : parsed.nextCursor
  const inlineComplete = completeness.inlineComplete ?? result.inlineComplete
  const paged =
    inlineComplete === false ||
    result.truncated === true ||
    meta.truncated === true ||
    parsed.truncated
  const source = processing.source ?? result.source ?? parsed.source
  const failure = failed ? errorText(block, text) : undefined
  let summary
  if (failed) {
    summary = `${TOOL_LABELS[toolName ?? ''] ?? 'YouTube operation'} failed · ${failure}`
  } else if (!settled) {
    if (toolName === 'youtube_transcript') summary = progressInfo?.label ?? 'Inspecting video…'
    else if (toolName === 'youtube_watch') summary = 'Analyzing video…'
    else if (toolName === 'youtube_transcript_read') summary = 'Reading archived transcript…'
    else summary = 'Searching archived transcript…'
  } else if (toolName === 'youtube_watch') {
    summary = `Answer ready${evidenceCount === undefined ? '' : ` · ${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'}`}`
  } else if (toolName === 'youtube_transcript') {
    const segments = totalSegments ?? shownSegments
    summary = `Transcript ready${duration === undefined ? '' : ` · ${duration}`}${segments === 0 ? '' : ` · ${segments} segment${segments === 1 ? '' : 's'}${totalSegments === undefined && paged ? ' shown' : ''}`}`
  } else if (toolName === 'youtube_transcript_read') {
    summary = `${shownSegments} transcript segment${shownSegments === 1 ? '' : 's'}${paged ? ' · more available' : ''}`
  } else {
    summary =
      matchCount === 0
        ? `No matches for “${compact(args.query, 50) ?? ''}”`
        : `${matchCount} match${matchCount === 1 ? '' : 'es'} for “${compact(args.query, 50) ?? ''}”`
  }
  const status = failed
    ? { label: 'Failed', color: STATE_COLORS.error }
    : settled
      ? { label: 'Ready', color: STATE_COLORS.ok }
      : progressInfo?.recovering
        ? { label: 'Recovering', color: STATE_COLORS.warning }
        : { label: 'Running', color: STATE_COLORS.running }
  const context =
    toolName === 'youtube_watch'
      ? args.question
      : toolName === 'youtube_transcript'
        ? args.url
        : toolName === 'youtube_transcript_read'
          ? `${args.transcriptId ?? 'Transcript'}${args.startSeconds === undefined && args.endSeconds === undefined ? '' : ` · ${formatDuration(args.startSeconds ?? 0)}–${formatDuration(args.endSeconds) ?? 'end'}`}`
          : `${args.transcriptId ?? 'Transcript'}${typeof args.query === 'string' ? ` · “${args.query}”` : ''}`
  const metrics = []
  if (duration !== undefined) metrics.push(duration)
  if (parsed.language !== undefined) metrics.push(parsed.language)
  if (parsed.timestampState !== undefined) metrics.push(`Timestamps ${parsed.timestampState}`)
  if (source !== undefined)
    metrics.push(
      source === 'archive'
        ? 'From archive'
        : source === 'shared-in-flight'
          ? 'Shared generation'
          : String(source),
    )
  if (toolName === 'youtube_transcript' && totalSegments !== undefined)
    metrics.push(`${totalSegments} segments`)
  if (parsed.speakers !== undefined) metrics.push(`Speakers: ${parsed.speakers}`)
  return {
    toolName,
    title: TOOL_LABELS[toolName ?? ''] ?? 'YouTube',
    args,
    text,
    parsed,
    result,
    completeness,
    processing,
    settled,
    failed,
    failure,
    summary,
    status,
    context,
    videoId,
    duration,
    totalSegments,
    shownSegments,
    evidenceCount,
    matchCount,
    nextCursor,
    paged,
    source,
    metrics,
    progressInfo,
    degraded,
  }
}

export function timestampUrl(model: YoutubeCardModel, seconds: number | undefined) {
  if (model.videoId === undefined || !Number.isSafeInteger(seconds)) return undefined
  return `https://www.youtube.com/watch?v=${model.videoId}&t=${seconds}s`
}
