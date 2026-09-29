import assert from 'node:assert/strict'
import test from 'node:test'
import { watchVideo, normalizeWatchResponse } from '../dist/src/watch.js'
import { GeminiTransport, retryDelayMs } from '../dist/src/gemini-transport.js'
import { GeminiYoutubeClient, fetchYoutubeDuration } from '../dist/src/gemini.js'
import { watchResponseSchema, validateWatchTimestamps } from '../dist/src/watch-timestamps.js'
import { normalizeWatchEvidence, parseYoutubeVideoMetadata } from '../dist/src/adaptive-watch.js'
import {
  watchPresentationMeta,
  transcriptPresentationMeta,
  readPresentationMeta,
  searchPresentationMeta,
  formatTranscriptOutput,
  formatWatchOutput,
} from '../dist/src/tool-presentation.js'

test('absent Retry-After preserves exponential backoff for native and plain headers', () => {
  for (const headers of [undefined, {}, new Headers(), { get: () => null }]) {
    assert.equal(retryDelayMs({ headers }, 0), 250)
    assert.equal(retryDelayMs({ headers }, 1), 500)
  }
  for (const headers of [{ 'retry-after': '2' }, new Headers({ 'retry-after': '2' })]) {
    assert.equal(retryDelayMs({ headers }, 0), 2000)
  }
  assert.equal(retryDelayMs({ headers: new Headers({ 'retry-after': '0' }) }, 0), 0)
  assert.equal(retryDelayMs({ headers: new Headers({ 'retry-after': '20' }) }, 0), 5000)
})

const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const options = {
  model: 'mock',
  timeoutMs: 1000,
  maxQuestionChars: 8000,
  maxWatchOutputChars: 30000,
  maxEvidenceItems: 24,
  maxChunkConcurrency: 2,
  maximumWatchCoreSeconds: 900,
  watchChunkOverlapSeconds: 15,
  providerRequestRetries: 0,
  resolveApiKey: async () => 'fixture-only',
}
const evidence = (seconds, basis = 'inference') => ({
  start_seconds: seconds,
  description: 'Event',
  modality: 'visual',
  basis,
})
const output = (items = []) => ({
  timebase: 'full-video',
  answer: 'Answer',
  evidence: items,
  caveats: [],
})
function fixture(duration, provider, overrides = {}) {
  const requests = []
  const transport = new GeminiTransport()
  transport.options = {
    ...options,
    ...overrides,
    clientFactory: () => ({
      interactions: {
        create: async (request, controls) => {
          requests.push({ request, controls })
          return {
            status: 'completed',
            output_text: JSON.stringify(await provider(request, requests.length)),
          }
        },
      },
    }),
  }
  transport.inspectVideo = async () => ({
    video: { url, videoId: 'dQw4w9WgXcQ' },
    durationSeconds: duration,
  })
  return {
    requests,
    run: (signal) => watchVideo(transport, { url, question: 'Summarize the video' }, signal),
  }
}
function lossless(value) {
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value)
}

test('all tool metadata omit absent optional properties and retain zero cursors', () => {
  const value = {
    videoId: 'dQw4w9WgXcQ',
    transcriptId: 'archive',
    durationSeconds: 10,
    timestampVerified: true,
    evidence: [],
    caveats: [],
    segments: [],
    matches: [],
    language: 'English',
    speakers: [],
    totalSegments: 0,
    complete: true,
    inlineComplete: true,
    truncated: false,
    processing: {
      strategy: 'direct',
      chunksTotal: 1,
      chunksCompleted: 1,
      collectedSegments: 0,
      intervals: [],
    },
  }
  const config = { directTranscriptMaxSeconds: 1200, maximumTranscriptCoreSeconds: 900 }
  for (const nextCursor of [undefined, 0, 1]) {
    const result = { ...value, ...(nextCursor === undefined ? {} : { nextCursor }) }
    const metadata = [
      watchPresentationMeta({}, result),
      transcriptPresentationMeta(config, {}, result),
      readPresentationMeta({ transcriptId: 'archive' }, result),
      readPresentationMeta(
        { transcriptId: 'archive', cursor: 0, startSeconds: 0, endSeconds: 10 },
        result,
      ),
      searchPresentationMeta({ transcriptId: 'archive', query: 'test' }, result),
    ]
    metadata.forEach(lossless)
    assert.equal(Object.hasOwn(metadata[1].result, 'nextCursor'), nextCursor !== undefined)
    assert.equal(Object.hasOwn(metadata[2].request, 'cursor'), false)
    const { processing, ...legacy } = result
    lossless(transcriptPresentationMeta(config, {}, legacy))
  }
  assert.match(formatTranscriptOutput(value), /checked against duration bounds/)
  assert.doesNotMatch(formatTranscriptOutput(value), /Timestamps: independently verified/)
})

test('provider schema and explicit timebase reject ambiguous clip origin without shifting', () => {
  const schema = watchResponseSchema(885, 1800)
  assert.deepEqual(schema.properties.evidence.items.properties.start_seconds, {
    type: 'integer',
    minimum: 885,
    maximum: 1800,
  })
  const context = { strategy: 'chunked', chunkId: '2', startSeconds: 885, endSeconds: 1800 }
  assert.equal(
    validateWatchTimestamps(output([evidence(900)]), context).evidence[0].timestamp,
    '15:00',
  )
  for (const timebase of [undefined, 'clip-relative']) {
    assert.throws(
      () => validateWatchTimestamps({ ...output([evidence(900)]), timebase }, context),
      /incompatible timebase/,
    )
  }
  assert.throws(
    () => validateWatchTimestamps(output([evidence(20)]), context),
    /seconds=20.*expected=full-video integer \[885,1800\]/,
  )
})

test('direct D and empty evidence pass without correction; D+1 receives one grounded correction', async () => {
  for (const items of [[], [evidence(20)]]) {
    const f = fixture(20, () => output(items))
    const result = await f.run()
    assert.equal(f.requests.length, 1)
    assert.equal(result.processing.timestampValidation, 'duration-bounds-only')
    assert.match(f.requests[0].request.input[1].text, /duration: 20 seconds/)
  }
  const f = fixture(20, (_request, n) => output([evidence(n === 1 ? 21 : 20)]))
  const result = await f.run()
  assert.equal(result.evidence[0].startSeconds, 20)
  assert.equal(result.evidence[0].basis, 'inference')
  assert.equal(result.processing.providerCalls, 2)
  assert.equal(result.processing.attempts[1].kind, 'watch-correction')
  assert.equal(f.requests[1].request.input[0].type, 'video')
  assert.equal(f.requests[1].request.store, false)
})

test('timestamp correction exhaustion reports safe actionable bounds and attempts', async () => {
  const f = fixture(20, () => output([evidence(21)]))
  await assert.rejects(f.run(), /strategy=direct-default.*clip=\[0,20\].*seconds=21.*attempts=2/)
  assert.equal(f.requests.length, 2)
  const hostile = fixture(20, () => output([evidence('secret-provider-payload')]))
  await assert.rejects(
    hostile.run(),
    (error) =>
      !error.message.includes('secret-provider-payload') && /missing\/invalid/.test(error.message),
  )
})

test('correction shares original call budget and cancellation signal', async () => {
  const limited = fixture(20, () => output([evidence(21)]), { maxProviderCalls: 1 })
  await assert.rejects(limited.run(), /limit|budget/i)
  assert.equal(limited.requests.length, 1)
  const controller = new AbortController()
  const cancelled = fixture(20, () => {
    controller.abort()
    return output([evidence(21)])
  })
  await assert.rejects(cancelled.run(controller.signal), /abort/i)
  assert.equal(cancelled.requests.length, 1)
  assert.equal(cancelled.requests[0].controls.signal, controller.signal)
})

test('chunk correction preserves successful chunks and never offsets absolute 900 to 1785', async () => {
  const counts = new Map()
  const f = fixture(1800, (request) => {
    if (request.input[0].type !== 'video') return { answer: 'Summary', caveats: [] }
    const start = Number.parseInt(request.input[0].processing.start_offset, 10)
    const count = (counts.get(start) ?? 0) + 1
    counts.set(start, count)
    if (start === 0) return output([evidence(10, 'observation')])
    return output([evidence(count === 1 ? 1801 : 900)])
  })
  const result = await f.run()
  assert.equal(counts.get(0), 1)
  assert.equal(counts.get(885), 2)
  assert.deepEqual(
    result.evidence.map((item) => item.startSeconds),
    [10, 900],
  )
  assert.deepEqual(
    result.evidence.map((item) => item.basis),
    ['observation', 'inference'],
  )
  assert.equal(result.processing.providerCalls, 4)
})

test('safety and malformed provider responses do not trigger watch correction', async () => {
  let count = 0
  const f = fixture(20, () => {
    count += 1
    throw { status: 400, message: 'SAFETY secret' }
  })
  await assert.rejects(f.run(), /content filters/)
  assert.equal(count, 1)
  const transport = new GeminiTransport()
  let malformedCalls = 0
  transport.options = {
    ...options,
    clientFactory: () => ({
      interactions: {
        create: async () => {
          malformedCalls += 1
          return { status: 'completed', output_text: '{broken-json' }
        },
      },
    }),
  }
  transport.inspectVideo = async () => ({
    video: { url, videoId: 'dQw4w9WgXcQ' },
    durationSeconds: 20,
  })
  await assert.rejects(watchVideo(transport, { url, question: 'Summary' }), /malformed JSON/)
  assert.equal(malformedCalls, 1)
})

for (const seconds of [21, 20]) {
  test(`completed SAFETY response with timestamp ${seconds} rejects without correction`, async () => {
    const requests = []
    const transport = new GeminiTransport()
    transport.options = {
      ...options,
      clientFactory: () => ({
        interactions: {
          create: async (request) => {
            requests.push(request)
            return {
              status: 'completed',
              errors: [
                { code: 'SAFETY', message: 'private provider diagnostic' },
                { code: 'private diagnostic code' },
              ],
              output_text: JSON.stringify({
                ...output([evidence(seconds)]),
                answer: 'private output',
              }),
            }
          },
        },
      }),
    }
    transport.inspectVideo = async () => ({
      video: { url, videoId: 'dQw4w9WgXcQ' },
      durationSeconds: 20,
    })
    await assert.rejects(watchVideo(transport, { url, question: 'Summary' }), (error) => {
      assert.equal(error.reason, 'content_filter')
      assert.match(error.message, /content filters.*status: completed; diagnostic codes: SAFETY/)
      assert.doesNotMatch(error.message, /private|timestamp contract/)
      return true
    })
    assert.equal(requests.length, 1)
    assert.doesNotMatch(requests[0].input[1].text, /Correction:/)
  })
}

test('chunk validation fails inside the worker and aborts peers before reduction', async () => {
  let peerAborted = false
  let reductions = 0
  const transport = new GeminiTransport()
  transport.options = {
    ...options,
    clientFactory: () => ({
      interactions: {
        create: async (request, { signal }) => {
          if (request.input[0].type !== 'video') {
            reductions += 1
            return {}
          }
          const start = Number.parseInt(request.input[0].processing.start_offset, 10)
          if (start === 0) return { output_text: JSON.stringify(output([evidence(916)])) }
          return new Promise((_resolve, reject) =>
            signal.addEventListener(
              'abort',
              () => {
                peerAborted = true
                reject(Object.assign(new Error('private abort reason'), { name: 'AbortError' }))
              },
              { once: true },
            ),
          )
        },
      },
    }),
  }
  transport.inspectVideo = async () => ({
    video: { url, videoId: 'dQw4w9WgXcQ' },
    durationSeconds: 1800,
  })
  await assert.rejects(watchVideo(transport, { url, question: 'Summary' }), /chunk=1.*attempts=2/)
  assert.equal(peerAborted, true)
  assert.equal(reductions, 0)
})

test('correction also respects estimated token budget and pre-aborted signals', async () => {
  const limited = fixture(20, () => output([evidence(21)]), { maxEstimatedInputTokens: 10000 })
  await assert.rejects(limited.run(), /token.*limit|limit.*token/i)
  assert.equal(limited.requests.length, 1)
  const controller = new AbortController()
  controller.abort(new Error('private cancellation text'))
  const f = fixture(20, () => output())
  await assert.rejects(
    f.run(controller.signal),
    (error) => /was aborted/.test(error.message) && !error.message.includes('private'),
  )
  assert.equal(f.requests.length, 0)
})

test('missing provenance stays absent; inference survives both normalizers', () => {
  for (const basis of [undefined, 'inference', 'observation']) {
    const item = {
      timestamp: '0:10',
      description: 'Event',
      modality: 'visual',
      ...(basis ? { basis } : {}),
    }
    const normalized = normalizeWatchResponse(
      { answer: 'Answer', evidence: [item], caveats: [] },
      options,
    )
    const final = normalizeWatchEvidence(normalized.evidence[0], 20)
    assert.equal(final.basis, basis)
    assert.equal(Object.hasOwn(final, 'basis'), basis !== undefined)
  }
})

test('watch formatter labels observation, inference, and missing basis alongside modality', () => {
  const value = {
    answer: 'Answer',
    evidence: [
      { timestamp: '0:01', description: 'Visible event', modality: 'visual', basis: 'observation' },
      { timestamp: '0:02', description: 'Inferred intent', modality: 'spoken', basis: 'inference' },
      { timestamp: '0:03', description: 'Legacy evidence', modality: 'mixed' },
    ],
    caveats: ['Timing is not independently verified.'],
  }
  assert.equal(
    formatWatchOutput(value),
    [
      'Answer',
      '',
      'Evidence:',
      '- [0:01] (visual; basis: observation) Visible event',
      '- [0:02] (spoken; basis: inference) Inferred intent',
      '- [0:03] (mixed; basis: unknown) Legacy evidence',
      '',
      'Caveats:',
      '- Timing is not independently verified.',
    ].join('\n'),
  )
  assert.equal(Object.hasOwn(value.evidence[2], 'basis'), false)
})

test('legacy duration helper also rejects mismatched identity', async () => {
  const fetchImpl = async () => ({
    ok: true,
    text: async () =>
      'ytInitialPlayerResponse = {"videoDetails":{"videoId":"_U-O5lYhJ7Q","lengthSeconds":"20"}}',
  })
  await assert.rejects(fetchYoutubeDuration(url, undefined, fetchImpl), /identity does not match/)
})

test('metadata requires matching video identity before trusting duration', () => {
  for (const videoId of [undefined, '_U-O5lYhJ7Q']) {
    const html = `ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { videoId, lengthSeconds: '20' } })}`
    assert.throws(() => parseYoutubeVideoMetadata(html, url), /identity does not match/)
  }
  const html = `ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { videoId: 'dQw4w9WgXcQ', lengthSeconds: '20' } })}`
  assert.equal(parseYoutubeVideoMetadata(html, url).durationSeconds, 20)
})
