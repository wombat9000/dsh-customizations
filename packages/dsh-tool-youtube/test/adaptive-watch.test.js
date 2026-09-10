import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADAPTIVE_WATCH_ERROR_CODES,
  calculateWatchCoverage,
  classifyWatchQuestion,
  deduplicateWatchEvidence,
  extractYoutubePlayerResponse,
  inspectYoutubeVideo,
  mergeWatchChunkEvidence,
  normalizeWatchEvidence,
  parseYoutubeVideoMetadata,
  planAdaptiveWatch,
  planBalancedWatchChunks,
} from '../src/adaptive-watch.js'

const VIDEO_ID = 'dQw4w9WgXcQ'
const URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`

function htmlFor(overrides = {}) {
  const response = {
    videoDetails: {
      videoId: VIDEO_ID,
      title: 'Example video',
      author: 'Example channel',
      lengthSeconds: '1260',
      thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/example.jpg' }] },
      ...overrides.videoDetails,
    },
    ...overrides,
  }
  return `<script>const decoy={"lengthSeconds":"999999"}; ytInitialPlayerResponse = ${JSON.stringify(response)};</script>`
}

test('parses bounded player metadata without using decoy duration fields', () => {
  const metadata = parseYoutubeVideoMetadata(htmlFor(), URL, { inspectedAt: 42 })
  assert.deepEqual(metadata, {
    videoId: VIDEO_ID,
    canonicalUrl: URL,
    title: 'Example video',
    channel: 'Example channel',
    thumbnailUrl: 'https://i.ytimg.com/example.jpg',
    durationSeconds: 1260,
    durationVerified: true,
    durationSource: 'youtube-player',
    liveState: 'vod',
    inspectedAt: 42,
  })
  assert.throws(
    () => extractYoutubePlayerResponse('x'.repeat(20), { maxHtmlChars: 10 }),
    (error) => error.code === ADAPTIVE_WATCH_ERROR_CODES.VIDEO_METADATA_INVALID,
  )
})

test('distinguishes live, upcoming, and ended-live metadata', () => {
  const live = parseYoutubeVideoMetadata(htmlFor({
    videoDetails: { isLiveContent: true, lengthSeconds: undefined },
    microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: true } } },
  }), URL)
  assert.equal(live.liveState, 'live')
  assert.equal(live.durationVerified, false)

  const upcoming = parseYoutubeVideoMetadata(htmlFor({
    videoDetails: { isLiveContent: true, isUpcoming: true, lengthSeconds: undefined },
  }), URL)
  assert.equal(upcoming.liveState, 'upcoming')

  const ended = parseYoutubeVideoMetadata(htmlFor({
    videoDetails: { isLiveContent: true, lengthSeconds: '3600' },
    microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { endTimestamp: '2025-01-01T01:00:00Z' } } },
  }), URL)
  assert.equal(ended.liveState, 'ended-live')
  assert.equal(ended.durationSeconds, 3600)
})

test('inspects through an injected fetch and enforces response bounds', async () => {
  const metadata = await inspectYoutubeVideo(URL, {
    inspectedAt: 7,
    fetchImpl: async (url) => ({
      ok: true,
      headers: { get: () => undefined },
      text: async () => htmlFor(),
      url,
    }),
  })
  assert.equal(metadata.durationSeconds, 1260)
  await assert.rejects(
    inspectYoutubeVideo(URL, {
      maxHtmlChars: 10,
      fetchImpl: async () => ({ ok: true, headers: { get: () => '1000' }, text: async () => '' }),
    }),
    (error) => error.code === ADAPTIVE_WATCH_ERROR_CODES.VIDEO_METADATA_INVALID,
  )
})

test('classifies exhaustive, global, targeted, and ambiguous questions deterministically', () => {
  assert.equal(classifyWatchQuestion('List every occurrence of the warning').intent, 'exhaustive')
  assert.equal(classifyWatchQuestion('Summarize the main themes').intent, 'global')
  assert.equal(classifyWatchQuestion('What changes after Save is clicked?').intent, 'targeted')
  assert.deepEqual(classifyWatchQuestion('Explain the product'), {
    intent: 'global', source: 'fallback', confidence: 'low', reasonCode: 'default-global',
  })
})

test('plans balanced proportional chunks with bounded overlap', () => {
  assert.deepEqual(planBalancedWatchChunks(1260, { maximumCoreSeconds: 900, overlapSeconds: 15 }), [
    { id: '1', index: 0, coreStartSeconds: 0, coreEndSeconds: 630, clipStartSeconds: 0, clipEndSeconds: 645 },
    { id: '2', index: 1, coreStartSeconds: 630, coreEndSeconds: 1260, clipStartSeconds: 615, clipEndSeconds: 1260 },
  ])
  assert.throws(
    () => planBalancedWatchChunks(3600, { maximumCoreSeconds: 900, maxChunks: 3 }),
    (error) => error.code === ADAPTIVE_WATCH_ERROR_CODES.WATCH_CHUNK_LIMIT_EXCEEDED,
  )
})

test('selects direct, low, agentic, and chunked strategies from explicit capabilities', () => {
  const vod = (durationSeconds) => ({ durationSeconds, durationVerified: true, liveState: 'vod' })
  assert.equal(planAdaptiveWatch(vod(600), { intent: 'global' }, {}).strategy, 'direct-default')
  assert.equal(planAdaptiveWatch(vod(3600), { intent: 'global' }, {
    capabilities: { lowResolution: true },
  }).strategy, 'direct-low')
  assert.equal(planAdaptiveWatch(vod(3600), { intent: 'targeted' }, {
    capabilities: { agentic: true },
  }).strategy, 'direct-agentic')
  const chunked = planAdaptiveWatch(vod(3600), { intent: 'exhaustive' }, {
    capabilities: { clipping: true }, maximumCoreSeconds: 900,
  })
  assert.equal(chunked.strategy, 'chunked')
  assert.equal(chunked.chunks.length, 4)
})

test('fails closed for unknown duration and gates live snapshots explicitly', () => {
  assert.throws(
    () => planAdaptiveWatch({ liveState: 'unknown' }, { intent: 'global' }),
    (error) => error.code === ADAPTIVE_WATCH_ERROR_CODES.VIDEO_DURATION_UNKNOWN,
  )
  assert.throws(
    () => planAdaptiveWatch({ liveState: 'live' }, { intent: 'targeted' }, { capabilities: { agentic: true } }),
    (error) => error.code === ADAPTIVE_WATCH_ERROR_CODES.LIVE_VIDEO_UNSUPPORTED,
  )
  assert.equal(planAdaptiveWatch({ liveState: 'live' }, { intent: 'targeted' }, {
    capabilities: { agentic: true }, enableLiveSnapshots: true,
  }).coverageMode, 'live-snapshot')
})

test('normalizes and verifies known-duration evidence timestamps', () => {
  assert.deepEqual(normalizeWatchEvidence({
    timestamp: '1:02', endTimestamp: '1:04', description: 'The dialog opens', modality: 'visual', basis: 'observation',
  }, 120), {
    startSeconds: 62, timestamp: '1:02', endSeconds: 64, endTimestamp: '1:04',
    description: 'The dialog opens', modality: 'visual', basis: 'observation',
  })
  assert.throws(
    () => normalizeWatchEvidence({ timestamp: '2:01', description: 'Impossible', modality: 'visual' }, 120),
    (error) => error.code === ADAPTIVE_WATCH_ERROR_CODES.WATCH_TIMESTAMP_OUT_OF_RANGE,
  )
})

test('offsets chunk-local evidence, applies core ownership, and deduplicates boundary drift', () => {
  const chunks = planBalancedWatchChunks(1200, { maximumCoreSeconds: 600, overlapSeconds: 15 })
  const merged = mergeWatchChunkEvidence([
    { chunk: chunks[0], evidence: [
      { start_seconds: 599, description: 'Save button turns green', modality: 'visual', basis: 'observation' },
      { start_seconds: 610, description: 'Neighbor-owned context', modality: 'spoken' },
    ] },
    { chunk: chunks[1], evidence: [
      { start_seconds: 15, description: 'The save button turns green', modality: 'visual', basis: 'observation' },
      { start_seconds: 20, description: 'Confirmation appears', modality: 'visual' },
    ] },
  ], 1200, { similarityThreshold: 0.7 })
  assert.equal(merged.length, 2)
  assert.deepEqual(merged.map((item) => item.startSeconds), [600, 605])
  assert.equal(merged[0].description, 'The save button turns green')

  const direct = deduplicateWatchEvidence([
    { startSeconds: 10, description: 'same event', modality: 'mixed', basis: 'inference', chunkId: '1' },
    { startSeconds: 11, description: 'same event', modality: 'mixed', basis: 'observation', chunkId: '2' },
  ])
  assert.equal(direct.length, 1)
  assert.equal(direct[0].basis, 'observation')
})

test('calculates coverage from successful non-overlap cores and reports gaps', () => {
  const chunks = planBalancedWatchChunks(1800, { maximumCoreSeconds: 600, overlapSeconds: 15 })
  const partial = calculateWatchCoverage(1800, chunks, new Set(['1', '3']))
  assert.equal(partial.complete, false)
  assert.equal(partial.coveredSeconds, 1200)
  assert.deepEqual(partial.gaps, [{ startSeconds: 600, endSeconds: 1200, reason: 'failed' }])
  const complete = calculateWatchCoverage(1800, chunks, chunks.map((chunk) => chunk.id))
  assert.equal(complete.complete, true)
  assert.equal(complete.ratio, 1)
})
