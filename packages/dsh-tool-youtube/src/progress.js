export const TRANSCRIPT_PROGRESS_CHANNEL = '/youtube-transcript-progress'
export const TRANSCRIPT_PROGRESS_ENDPOINT = 'get'
export const DEFAULT_TRANSCRIPT_PROGRESS_LIMIT = 100

const ACTIVE_TRANSCRIPT_STATUSES = new Set(['transcribing', 'fallback', 'neutral', 'splitting'])

function copyChunk(chunk) {
  return {
    ...(chunk.id === undefined ? {} : { id: chunk.id }),
    index: chunk.index,
    startSeconds: chunk.startSeconds,
    endSeconds: chunk.endSeconds,
    status: chunk.status,
    ...(chunk.attempt === undefined ? {} : { attempt: chunk.attempt }),
    ...(chunk.segmentCount === undefined ? {} : { segmentCount: chunk.segmentCount }),
  }
}

function copySnapshot(snapshot) {
  if (snapshot === undefined) return undefined
  return {
    ...(snapshot.revision === undefined ? {} : { revision: snapshot.revision }),
    phase: snapshot.phase,
    ...(snapshot.strategy === undefined ? {} : { strategy: snapshot.strategy }),
    ...(snapshot.durationSeconds === undefined ? {} : { durationSeconds: snapshot.durationSeconds }),
    ...(snapshot.totalChunks === undefined ? {} : { totalChunks: snapshot.totalChunks }),
    ...(snapshot.completedChunks === undefined ? {} : { completedChunks: snapshot.completedChunks }),
    ...(snapshot.activeChunks === undefined ? {} : { activeChunks: snapshot.activeChunks }),
    ...(snapshot.collectedSegments === undefined
      ? {}
      : { collectedSegments: snapshot.collectedSegments }),
    ...(snapshot.truncated === undefined ? {} : { truncated: snapshot.truncated }),
    ...(Array.isArray(snapshot.chunks) ? { chunks: snapshot.chunks.map(copyChunk) } : {}),
  }
}

export function createTranscriptProgressReporter(report) {
  let current = { phase: 'inspecting' }
  const emit = (update) => {
    current = { ...current, ...update }
    try {
      report?.(copySnapshot(current))
    } catch {
      // Progress reporting is observational and must never fail transcription.
    }
  }
  emit({})
  return emit
}

function progressId(chunk) {
  return chunk.label ?? String(chunk.index + 1)
}

export function createTranscriptProgressTracker(chunks, durationSeconds, strategy, emit) {
  const leaves = new Map()
  let currentStrategy = strategy
  let currentPhase = 'transcribing'
  let terminal = false
  let lastSnapshot
  const addLeaf = (chunk, status) => {
    leaves.set(progressId(chunk), {
      id: progressId(chunk),
      startSeconds: chunk.coreStartSeconds,
      endSeconds: chunk.coreEndSeconds,
      status,
      attempt: 0,
      segmentCount: 0,
    })
  }
  for (const chunk of chunks) addLeaf(chunk, 'pending')

  const publish = (phase = currentPhase, extra = {}) => {
    if (terminal && phase !== currentPhase) return
    currentPhase = phase
    if (phase === 'complete' || phase === 'failed') terminal = true
    const progressChunks = [...leaves.values()]
      .sort((left, right) => left.startSeconds - right.startSeconds
        || left.endSeconds - right.endSeconds
        || left.id.localeCompare(right.id))
      .map((chunk, index) => ({ index, ...chunk }))
    lastSnapshot = {
      phase,
      strategy: currentStrategy,
      durationSeconds,
      totalChunks: progressChunks.length,
      completedChunks: progressChunks.filter((chunk) => chunk.status === 'complete').length,
      activeChunks: progressChunks.filter(
        (chunk) => ACTIVE_TRANSCRIPT_STATUSES.has(chunk.status),
      ).length,
      collectedSegments: progressChunks.reduce(
        (total, chunk) => total + (chunk.status === 'complete' ? chunk.segmentCount : 0),
        0,
      ),
      chunks: progressChunks,
      ...extra,
    }
    emit(copySnapshot(lastSnapshot))
  }

  const update = (chunk, status, options = {}) => {
    if (terminal) return
    const leaf = leaves.get(progressId(chunk))
    if (leaf === undefined) return
    leaf.status = status
    if (options.incrementAttempt === true) leaf.attempt += 1
    if (Number.isSafeInteger(options.segmentCount) && options.segmentCount >= 0) {
      leaf.segmentCount = options.segmentCount
    }
    publish()
  }

  return {
    publish,
    snapshot: () => copySnapshot(lastSnapshot),
    stage: (chunk, status) => update(chunk, status),
    start: (chunk, status) => update(chunk, status, { incrementAttempt: true }),
    complete: (chunk, segmentCount) => update(chunk, 'complete', { segmentCount }),
    fail: (chunk) => update(chunk, 'failed'),
    split(chunk, children) {
      if (terminal) return
      leaves.delete(progressId(chunk))
      for (const child of children) addLeaf(child, 'splitting')
      publish()
    },
    resetDirect(chunk) {
      currentStrategy = 'direct'
      leaves.clear()
      addLeaf(chunk, 'transcribing')
      leaves.get(progressId(chunk)).attempt = 1
      publish()
    },
  }
}

function internalError(message) {
  return {
    ok: false,
    error: {
      code: 'internal',
      message,
      details: {},
    },
  }
}

export function createTranscriptProgressStore(limit = DEFAULT_TRANSCRIPT_PROGRESS_LIMIT) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('transcript progress limit must be a positive integer')
  }
  const entries = new Map()
  return {
    update(callId, progress) {
      if (typeof callId !== 'string' || callId.length === 0) return
      const previous = entries.get(callId)
      const snapshot = copySnapshot({
        ...progress,
        revision: (previous?.revision ?? 0) + 1,
      })
      entries.delete(callId)
      entries.set(callId, snapshot)
      while (entries.size > limit) entries.delete(entries.keys().next().value)
    },
    get(callId) {
      return copySnapshot(entries.get(callId))
    },
    size() {
      return entries.size
    },
  }
}

export function registerTranscriptProgressRpc(ctx, store) {
  const connection = ctx.get('connection')
  if (connection === undefined) return
  ctx.effect(() => connection.rpc.handle(
    TRANSCRIPT_PROGRESS_CHANNEL,
    async (endpoint, payload) => {
      if (endpoint !== TRANSCRIPT_PROGRESS_ENDPOINT) {
        return internalError('Unknown YouTube transcript progress endpoint')
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)
        || typeof payload.callId !== 'string' || payload.callId.length === 0) {
        return internalError('YouTube transcript progress requires a callId')
      }
      return { ok: true, value: store.get(payload.callId) ?? null }
    },
    { authority: 'trusted-host' },
  ), 'tool-youtube: transcript progress RPC')
}
