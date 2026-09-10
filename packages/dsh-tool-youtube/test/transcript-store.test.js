import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import {
  MAX_TRANSCRIPT_SEGMENTS,
  apply,
  YoutubeTranscriptArchive,
  resolveConfig,
} from '../src/transcript-store.js'

const VIDEO_ID = 'dQw4w9WgXcQ'
const VIDEO_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`

function transcript(overrides = {}) {
  return {
    videoId: VIDEO_ID,
    canonicalUrl: VIDEO_URL,
    durationSeconds: 120,
    compatibilityKey: `${VIDEO_ID}:120:v1:model`,
    model: 'gemini-test',
    transcriberVersion: 'v1',
    language: 'English',
    speakers: ['Narrator'],
    segments: [
      { startSeconds: 1, speaker: 'Narrator', text: 'Opening statement.' },
      { startSeconds: 40, speaker: 'Narrator', text: 'A searchable middle section.' },
      { startSeconds: 90, speaker: 'Narrator', text: 'Closing statement.' },
    ],
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

async function withArchive(run) {
  const root = await mkdtemp(join(tmpdir(), 'youtube-transcript-store-'))
  const path = join(root, 'archive.sqlite')
  try {
    await run({ path, root })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('validates and resolves archive configuration', () => {
  assert.deepEqual(resolveConfig({ path: ':memory:' }), {
    path: ':memory:',
    busyTimeoutMs: 5_000,
    fullTextSearch: true,
  })
  assert.throws(() => resolveConfig({}), /path/)
  assert.throws(() => resolveConfig({ path: ':memory:', busyTimeoutMs: 0 }), /busyTimeoutMs/)
})

test('persists a complete transcript across archive reopen', async () => {
  await withArchive(async ({ path }) => {
    const first = new YoutubeTranscriptArchive({ path })
    const saved = first.saveComplete(transcript())
    assert.equal(saved.created, true)
    assert.equal(saved.transcript.segmentCount, 3)
    assert.equal(saved.transcript.segments[1].text, 'A searchable middle section.')
    first.close()

    const reopened = new YoutubeTranscriptArchive({ path })
    const hit = reopened.findCompatible({
      compatibilityKey: transcript().compatibilityKey,
      videoId: VIDEO_ID,
      durationSeconds: 120,
    })
    assert.equal(hit.transcriptId, saved.transcript.transcriptId)
    assert.deepEqual(reopened.loadComplete(hit.transcriptId).segments, [
      { ordinal: 0, startSeconds: 1, speaker: 'Narrator', text: 'Opening statement.' },
      { ordinal: 1, startSeconds: 40, speaker: 'Narrator', text: 'A searchable middle section.' },
      { ordinal: 2, startSeconds: 90, speaker: 'Narrator', text: 'Closing statement.' },
    ])
    reopened.close()
  })
})

test('deduplicates compatible saves and misses changed duration or version', () => {
  const archive = new YoutubeTranscriptArchive({ path: ':memory:' })
  const first = archive.saveComplete(transcript())
  const second = archive.saveComplete(transcript({ transcriptId: 'ignored-duplicate' }))
  assert.equal(second.created, false)
  assert.equal(second.transcript.transcriptId, first.transcript.transcriptId)
  assert.equal(archive.stats().transcripts, 1)
  assert.equal(archive.findCompatible({
    compatibilityKey: transcript().compatibilityKey,
    videoId: VIDEO_ID,
    durationSeconds: 121,
  }), undefined)
  assert.equal(archive.findCompatible({
    compatibilityKey: `${VIDEO_ID}:120:v2:model`,
    videoId: VIDEO_ID,
    durationSeconds: 120,
  }), undefined)
  archive.close()
})

test('preserves transcript-specific duration when a video revision changes', () => {
  const archive = new YoutubeTranscriptArchive({ path: ':memory:' })
  const first = archive.saveComplete(transcript())
  const second = archive.saveComplete(transcript({
    durationSeconds: 100,
    compatibilityKey: `${VIDEO_ID}:100:v1:model`,
    segments: [{ startSeconds: 90, speaker: 'Narrator', text: 'Trimmed ending.' }],
  }))
  assert.equal(archive.getTranscript(first.transcript.transcriptId).durationSeconds, 120)
  assert.equal(archive.getTranscript(second.transcript.transcriptId).durationSeconds, 100)
  archive.close()
})

test('pages by ordinal and timestamp and searches with FTS5', () => {
  const archive = new YoutubeTranscriptArchive({ path: ':memory:' })
  const saved = archive.saveComplete(transcript())
  const first = archive.readSegments(saved.transcript.transcriptId, { limit: 2 })
  assert.deepEqual(first.segments.map((segment) => segment.ordinal), [0, 1])
  assert.equal(first.nextCursor, 2)
  const second = archive.readSegments(saved.transcript.transcriptId, {
    cursor: first.nextCursor,
    startSeconds: 80,
    endSeconds: 120,
  })
  assert.deepEqual(second.segments.map((segment) => segment.text), ['Closing statement.'])
  assert.equal(second.nextCursor, undefined)

  const search = archive.search(saved.transcript.transcriptId, 'searchable middle')
  assert.equal(search.matches.length, 1)
  assert.equal(search.matches[0].startSeconds, 40)
  assert.equal(search.matches[0].text, 'A searchable middle section.')
  assert.equal(archive.stats().fullTextSearch, true)
  archive.close()
})

test('deletes transcript segments and search index entries transactionally', () => {
  const archive = new YoutubeTranscriptArchive({ path: ':memory:' })
  const saved = archive.saveComplete(transcript())
  assert.equal(archive.deleteTranscript(saved.transcript.transcriptId), true)
  assert.equal(archive.deleteTranscript(saved.transcript.transcriptId), false)
  assert.equal(archive.getTranscript(saved.transcript.transcriptId), undefined)
  assert.deepEqual(archive.stats(), {
    videos: 1,
    transcripts: 0,
    segments: 0,
    fileBytes: archive.stats().fileBytes,
    fullTextSearch: true,
  })
  archive.close()
})

test('rejects invalid or incomplete archive records', () => {
  const archive = new YoutubeTranscriptArchive({ path: ':memory:' })
  assert.throws(() => archive.saveComplete(transcript({
    segments: [{ startSeconds: 121, text: 'Beyond duration.', speaker: 'Narrator' }],
  })), /exceeds video duration/)
  assert.throws(() => archive.saveComplete(transcript({ segments: undefined })), /segments/)
  assert.equal(archive.stats().transcripts, 0)
  archive.close()
})

test('rejects a database schema newer than the package', async () => {
  await withArchive(async ({ path }) => {
    const db = new DatabaseSync(path)
    db.exec('PRAGMA user_version = 99;')
    db.close()
    assert.throws(() => new YoutubeTranscriptArchive({ path }), /newer than supported/)
  })
})

test('rebuilds FTS when reopening an archive previously written without it', async () => {
  await withArchive(async ({ path }) => {
    const withoutFts = new YoutubeTranscriptArchive({ path, fullTextSearch: false })
    const saved = withoutFts.saveComplete(transcript())
    withoutFts.close()

    const withFts = new YoutubeTranscriptArchive({ path, fullTextSearch: true })
    const result = withFts.search(saved.transcript.transcriptId, 'searchable middle')
    assert.equal(result.matches.length, 1)
    assert.equal(result.matches[0].ordinal, 1)
    withFts.close()
  })
})

test('falls back to bounded LIKE search when FTS is disabled', () => {
  const archive = new YoutubeTranscriptArchive({ path: ':memory:', fullTextSearch: false })
  const saved = archive.saveComplete(transcript())
  const result = archive.search(saved.transcript.transcriptId, 'searchable')
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].ordinal, 1)
  assert.throws(
    () => archive.search(saved.transcript.transcriptId, '%_'),
    /must contain a letter or number/,
  )
  archive.close()
})

test('scopes common-term FTS matches to one transcript', () => {
  const archive = new YoutubeTranscriptArchive({ path: ':memory:' })
  const first = archive.saveComplete(transcript({
    compatibilityKey: 'first-common',
    segments: [{ startSeconds: 1, text: 'common phrase from first' }],
  }))
  archive.saveComplete(transcript({
    compatibilityKey: 'second-common',
    segments: [{ startSeconds: 1, text: 'common phrase from second' }],
  }))
  const result = archive.search(first.transcript.transcriptId, 'common phrase')
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].text, 'common phrase from first')
  archive.close()
})

test('disabling FTS removes persisted index artifacts', async () => {
  await withArchive(async ({ path }) => {
    const enabled = new YoutubeTranscriptArchive({ path, fullTextSearch: true })
    enabled.saveComplete(transcript())
    enabled.close()

    const disabled = new YoutubeTranscriptArchive({ path, fullTextSearch: false })
    const artifacts = disabled.db.prepare(`
      SELECT count(*) AS count FROM sqlite_master
      WHERE name LIKE 'transcript_segments_fts%'
    `).get().count
    assert.equal(artifacts, 0)
    disabled.close()
  })
})

test('an enabled connection falls back if another connection removes FTS', async () => {
  await withArchive(async ({ path }) => {
    const enabled = new YoutubeTranscriptArchive({ path, fullTextSearch: true })
    const saved = enabled.saveComplete(transcript())
    const disabled = new YoutubeTranscriptArchive({ path, fullTextSearch: false })

    const result = enabled.search(saved.transcript.transcriptId, 'searchable')
    assert.equal(result.matches.length, 1)
    assert.equal(enabled.ftsEnabled, false)
    disabled.close()
    enabled.close()
  })
})

test('embedded host provider preserves the service name and closes on disposal', () => {
  let provided
  let dispose
  apply({
    effect(setup) { dispose = setup() },
    provide(name, value) {
      assert.equal(name, 'youtubeTranscriptStore')
      provided = value
    },
  }, { path: ':memory:' })
  try {
    assert.ok(provided instanceof YoutubeTranscriptArchive)
    assert.equal(provided.closed, false)
  } finally {
    dispose()
  }
  assert.equal(provided.closed, true)
})

test('bounds the number of segments accepted in one transcript', () => {
  const archive = new YoutubeTranscriptArchive({ path: ':memory:' })
  assert.throws(
    () => archive.saveComplete(transcript({
      segments: new Array(MAX_TRANSCRIPT_SEGMENTS + 1).fill({ startSeconds: 1, text: 'x' }),
    })),
    /at most/,
  )
  archive.close()
})
