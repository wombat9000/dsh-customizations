import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import z from '@deepseek-ai/schemastery'

export const name = 'youtube-transcript-store'
export const provide = 'youtubeTranscriptStore'
export const SCHEMA_VERSION = 1
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000
export const DEFAULT_PAGE_SEGMENTS = 500
export const MAX_PAGE_SEGMENTS = 5_000
export const MAX_TRANSCRIPT_SEGMENTS = 100_000
export const MAX_TRANSCRIPT_TEXT_CHARS = 50_000_000
export const TRANSCRIPT_STORE_SERVICE = 'youtubeTranscriptStore'

export const Config = z.object({
  path: z.string().required(),
  busyTimeoutMs: z.number().step(1).min(1).default(DEFAULT_BUSY_TIMEOUT_MS),
  fullTextSearch: z.boolean().default(true),
})

function assertNonEmptyString(value, name, maxLength = 100_000) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new TypeError(`youtube-transcript-store: ${name} must be a non-empty string`)
  }
  return value
}

function assertNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`youtube-transcript-store: ${name} must be a non-negative integer`)
  }
  return value
}

function assertPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`youtube-transcript-store: ${name} must be a positive integer`)
  }
  return value
}

function stringList(value, name, maxItems = 1_000, maxLength = 500) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(`youtube-transcript-store: ${name} must be a bounded string array`)
  }
  return value.map((item) => assertNonEmptyString(item, `${name} item`, maxLength))
}

function normalizeSegments(value) {
  if (!Array.isArray(value) || value.length > MAX_TRANSCRIPT_SEGMENTS) {
    throw new TypeError(`youtube-transcript-store: segments must be an array of at most ${MAX_TRANSCRIPT_SEGMENTS} items`)
  }
  let totalTextChars = 0
  let previousStartSeconds = -1
  return value.map((segment, ordinal) => {
    if (typeof segment !== 'object' || segment === null || Array.isArray(segment)) {
      throw new TypeError('youtube-transcript-store: every segment must be an object')
    }
    const startSeconds = assertNonNegativeInteger(segment.startSeconds, 'segment startSeconds')
    if (startSeconds < previousStartSeconds) {
      throw new TypeError('youtube-transcript-store: segments must be in chronological order')
    }
    previousStartSeconds = startSeconds
    const text = assertNonEmptyString(segment.text, 'segment text', 100_000)
    totalTextChars += text.length
    if (totalTextChars > MAX_TRANSCRIPT_TEXT_CHARS) {
      throw new TypeError(`youtube-transcript-store: transcript text exceeds ${MAX_TRANSCRIPT_TEXT_CHARS} characters`)
    }
    const speaker = segment.speaker === undefined
      ? undefined
      : assertNonEmptyString(segment.speaker, 'segment speaker', 500)
    return { ordinal, startSeconds, text, ...(speaker === undefined ? {} : { speaker }) }
  })
}

function contentHash(speakers, segments) {
  return createHash('sha256').update(JSON.stringify({ speakers, segments })).digest('hex')
}

function ownedMetadata(row) {
  if (row === undefined) return undefined
  const speakers = JSON.parse(row.speakers_json)
  return {
    transcriptId: row.transcript_id,
    videoId: row.video_id,
    canonicalUrl: row.canonical_url,
    durationSeconds: row.duration_seconds,
    compatibilityKey: row.compatibility_key,
    model: row.model,
    transcriberVersion: row.transcriber_version,
    language: row.language,
    speakers: Array.isArray(speakers) ? speakers.map(String) : [],
    timestampVerified: row.timestamp_verified === 1,
    caveats: JSON.parse(row.caveats_json),
    processing: JSON.parse(row.processing_json),
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at,
    segmentCount: row.segment_count,
    complete: row.complete === 1,
    contentHash: row.content_hash,
  }
}

function ownedSegment(row) {
  return {
    ordinal: row.ordinal,
    startSeconds: row.start_seconds,
    text: row.text,
    ...(row.speaker === null ? {} : { speaker: row.speaker }),
  }
}

function searchExpression(query) {
  const terms = query.match(/[\p{L}\p{N}]+/gu) ?? []
  if (terms.length === 0) return undefined
  return terms.slice(0, 20).map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ')
}

export function resolveConfig(config = {}) {
  const path = assertNonEmptyString(config.path, 'path', 10_000)
  const busyTimeoutMs = config.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS
  assertPositiveInteger(busyTimeoutMs, 'busyTimeoutMs')
  const fullTextSearch = config.fullTextSearch ?? true
  if (typeof fullTextSearch !== 'boolean') {
    throw new TypeError('youtube-transcript-store: fullTextSearch must be a boolean')
  }
  return {
    path: path === ':memory:' ? path : resolve(path),
    busyTimeoutMs,
    fullTextSearch,
  }
}

export class YoutubeTranscriptArchive {
  constructor(options) {
    this.options = resolveConfig(options)
    if (this.options.path !== ':memory:') {
      mkdirSync(dirname(this.options.path), { recursive: true, mode: 0o700 })
    }
    this.db = new DatabaseSync(this.options.path)
    this.closed = false
    try {
      this.configure()
      this.migrate()
      this.prepare()
    } catch (error) {
      this.db.close()
      this.closed = true
      throw error
    }
  }

  configure() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = ${this.options.busyTimeoutMs};
    `)
    if (this.options.path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA synchronous = FULL; PRAGMA temp_store = MEMORY;')
  }

  migrate() {
    this.db.exec('BEGIN IMMEDIATE;')
    try {
      const version = this.db.prepare('PRAGMA user_version').get().user_version
      if (version > SCHEMA_VERSION) {
        throw new Error(
          `youtube-transcript-store: database schema ${version} is newer than supported schema ${SCHEMA_VERSION}`,
        )
      }
      if (version === 0) {
        this.db.exec(`
          CREATE TABLE videos (
            video_id TEXT PRIMARY KEY,
            canonical_url TEXT NOT NULL,
            verified_duration_seconds INTEGER NOT NULL CHECK (verified_duration_seconds >= 0),
            last_verified_at INTEGER NOT NULL
          );
          CREATE TABLE transcripts (
            transcript_id TEXT PRIMARY KEY,
            video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
            duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
            compatibility_key TEXT NOT NULL UNIQUE,
            model TEXT NOT NULL,
            transcriber_version TEXT NOT NULL,
            language TEXT NOT NULL,
            speakers_json TEXT NOT NULL CHECK (json_valid(speakers_json)),
            timestamp_verified INTEGER NOT NULL CHECK (timestamp_verified IN (0, 1)),
            caveats_json TEXT NOT NULL CHECK (json_valid(caveats_json)),
            processing_json TEXT NOT NULL CHECK (json_valid(processing_json)),
            created_at INTEGER NOT NULL,
            last_accessed_at INTEGER NOT NULL,
            segment_count INTEGER NOT NULL CHECK (segment_count >= 0),
            complete INTEGER NOT NULL CHECK (complete = 1),
            content_hash TEXT NOT NULL
          );
          CREATE INDEX transcripts_video_created
            ON transcripts(video_id, created_at DESC);
          CREATE INDEX transcripts_last_accessed
            ON transcripts(last_accessed_at);
          CREATE TABLE segments (
            id INTEGER PRIMARY KEY,
            transcript_id TEXT NOT NULL REFERENCES transcripts(transcript_id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
            start_seconds INTEGER NOT NULL CHECK (start_seconds >= 0),
            speaker TEXT,
            text TEXT NOT NULL,
            UNIQUE(transcript_id, ordinal)
          );
          CREATE INDEX segments_transcript_time
            ON segments(transcript_id, start_seconds, ordinal);
          PRAGMA user_version = 1;
        `)
      }
      this.db.exec('COMMIT;')
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;')
      } catch {
        // Preserve the original migration error.
      }
      throw error
    }
    this.configureFullTextSearch()
  }

  configureFullTextSearch() {
    const ftsRow = this.db.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = 'transcript_segments_fts'
    `).get()
    const triggerCount = this.db.prepare(`
      SELECT count(*) AS count FROM sqlite_master
      WHERE type = 'trigger' AND name IN (
        'transcript_segments_fts_insert',
        'transcript_segments_fts_delete',
        'transcript_segments_fts_update'
      )
    `).get().count
    const obsoleteFts = ftsRow?.sql?.includes('transcript_id UNINDEXED') === true
    const needsRebuild = ftsRow === undefined || triggerCount !== 3 || obsoleteFts
    this.ftsEnabled = false
    this.db.exec('BEGIN IMMEDIATE;')
    try {
      if (!this.options.fullTextSearch || obsoleteFts) {
        this.db.exec(`
          DROP TRIGGER IF EXISTS transcript_segments_fts_insert;
          DROP TRIGGER IF EXISTS transcript_segments_fts_delete;
          DROP TRIGGER IF EXISTS transcript_segments_fts_update;
          DROP TABLE IF EXISTS transcript_segments_fts;
        `)
      }
      if (this.options.fullTextSearch) {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS transcript_segments_fts USING fts5(
            transcript_id,
            speaker,
            text,
            content = 'segments',
            content_rowid = 'id',
            tokenize = 'unicode61'
          );
          CREATE TRIGGER IF NOT EXISTS transcript_segments_fts_insert
          AFTER INSERT ON segments BEGIN
            INSERT INTO transcript_segments_fts(rowid, transcript_id, speaker, text)
            VALUES (new.id, new.transcript_id, coalesce(new.speaker, ''), new.text);
          END;
          CREATE TRIGGER IF NOT EXISTS transcript_segments_fts_delete
          AFTER DELETE ON segments BEGIN
            INSERT INTO transcript_segments_fts(transcript_segments_fts, rowid, transcript_id, speaker, text)
            VALUES ('delete', old.id, old.transcript_id, coalesce(old.speaker, ''), old.text);
          END;
          CREATE TRIGGER IF NOT EXISTS transcript_segments_fts_update
          AFTER UPDATE ON segments BEGIN
            INSERT INTO transcript_segments_fts(transcript_segments_fts, rowid, transcript_id, speaker, text)
            VALUES ('delete', old.id, old.transcript_id, coalesce(old.speaker, ''), old.text);
            INSERT INTO transcript_segments_fts(rowid, transcript_id, speaker, text)
            VALUES (new.id, new.transcript_id, coalesce(new.speaker, ''), new.text);
          END;
        `)
        if (needsRebuild) {
          this.db.exec("INSERT INTO transcript_segments_fts(transcript_segments_fts) VALUES ('rebuild');")
        }
        this.ftsEnabled = true
      }
      this.db.exec('COMMIT;')
    } catch {
      try {
        this.db.exec('ROLLBACK;')
      } catch {
        // Search safely falls back to bounded LIKE queries.
      }
      this.ftsEnabled = false
    }
  }

  prepare() {
    this.statements = {
      findCompatible: this.db.prepare(`
        SELECT t.*, v.canonical_url
        FROM transcripts t
        JOIN videos v USING (video_id)
        WHERE t.compatibility_key = ? AND t.video_id = ?
          AND t.duration_seconds = ? AND t.complete = 1
      `),
      getTranscript: this.db.prepare(`
        SELECT t.*, v.canonical_url
        FROM transcripts t JOIN videos v USING (video_id)
        WHERE t.transcript_id = ? AND t.complete = 1
      `),
      touch: this.db.prepare('UPDATE transcripts SET last_accessed_at = ? WHERE transcript_id = ?'),
      upsertVideo: this.db.prepare(`
        INSERT INTO videos(video_id, canonical_url, verified_duration_seconds, last_verified_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(video_id) DO UPDATE SET
          canonical_url = excluded.canonical_url,
          verified_duration_seconds = excluded.verified_duration_seconds,
          last_verified_at = excluded.last_verified_at
      `),
      insertTranscript: this.db.prepare(`
        INSERT INTO transcripts(
          transcript_id, video_id, duration_seconds, compatibility_key, model,
          transcriber_version, language, speakers_json, timestamp_verified,
          caveats_json, processing_json, created_at, last_accessed_at,
          segment_count, complete, content_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `),
      insertSegment: this.db.prepare(`
        INSERT INTO segments(transcript_id, ordinal, start_seconds, speaker, text)
        VALUES (?, ?, ?, ?, ?)
      `),
      allSegments: this.db.prepare(`
        SELECT ordinal, start_seconds, speaker, text
        FROM segments WHERE transcript_id = ? ORDER BY ordinal
      `),
      deleteTranscript: this.db.prepare('DELETE FROM transcripts WHERE transcript_id = ?'),
      listVersions: this.db.prepare(`
        SELECT t.*, v.canonical_url
        FROM transcripts t JOIN videos v USING (video_id)
        WHERE t.video_id = ? ORDER BY t.created_at DESC
      `),
    }
  }

  assertOpen() {
    if (this.closed) throw new Error('youtube-transcript-store: archive is closed')
  }

  findCompatible(query) {
    this.assertOpen()
    const compatibilityKey = assertNonEmptyString(query.compatibilityKey, 'compatibilityKey')
    const videoId = assertNonEmptyString(query.videoId, 'videoId', 100)
    const durationSeconds = assertNonNegativeInteger(query.durationSeconds, 'durationSeconds')
    const row = this.statements.findCompatible.get(compatibilityKey, videoId, durationSeconds)
    let metadata
    try {
      metadata = ownedMetadata(row)
    } catch {
      if (row !== undefined) this.statements.deleteTranscript.run(row.transcript_id)
      return undefined
    }
    if (metadata !== undefined) {
      const now = Date.now()
      this.statements.touch.run(now, metadata.transcriptId)
      metadata.lastAccessedAt = now
    }
    return metadata
  }

  getTranscript(transcriptId) {
    this.assertOpen()
    return ownedMetadata(this.statements.getTranscript.get(
      assertNonEmptyString(transcriptId, 'transcriptId', 200),
    ))
  }

  loadComplete(transcriptId) {
    this.assertOpen()
    const id = assertNonEmptyString(transcriptId, 'transcriptId', 200)
    this.db.exec('BEGIN;')
    try {
      const metadata = this.getTranscript(id)
      if (metadata === undefined) {
        this.db.exec('COMMIT;')
        return undefined
      }
      const segments = this.statements.allSegments.all(id).map(ownedSegment)
      this.db.exec('COMMIT;')
      if (segments.length !== metadata.segmentCount
        || contentHash(metadata.speakers, segments) !== metadata.contentHash) {
        this.deleteTranscript(id)
        return undefined
      }
      return { ...metadata, segments }
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;')
      } catch {
        // Preserve the original read error.
      }
      throw error
    }
  }

  saveComplete(input) {
    this.assertOpen()
    const videoId = assertNonEmptyString(input.videoId, 'videoId', 100)
    const canonicalUrl = assertNonEmptyString(input.canonicalUrl, 'canonicalUrl', 10_000)
    const durationSeconds = assertNonNegativeInteger(input.durationSeconds, 'durationSeconds')
    const compatibilityKey = assertNonEmptyString(input.compatibilityKey, 'compatibilityKey')
    const model = assertNonEmptyString(input.model, 'model', 500)
    const transcriberVersion = assertNonEmptyString(input.transcriberVersion, 'transcriberVersion', 500)
    const language = assertNonEmptyString(input.language, 'language', 500)
    const speakers = stringList(input.speakers, 'speakers')
    const timestampVerified = input.timestampVerified ?? true
    if (typeof timestampVerified !== 'boolean') {
      throw new TypeError('youtube-transcript-store: timestampVerified must be a boolean')
    }
    const caveats = stringList(input.caveats ?? [], 'caveats', 100, 5_000)
    const processing = input.processing ?? {}
    if (typeof processing !== 'object' || processing === null || Array.isArray(processing)) {
      throw new TypeError('youtube-transcript-store: processing must be an object')
    }
    const processingJson = JSON.stringify(processing)
    if (processingJson.length > 1_000_000) {
      throw new TypeError('youtube-transcript-store: processing metadata is oversized')
    }
    const segments = normalizeSegments(input.segments)
    for (const segment of segments) {
      if (segment.startSeconds > durationSeconds) {
        throw new TypeError('youtube-transcript-store: segment timestamp exceeds video duration')
      }
    }
    const now = Number.isSafeInteger(input.createdAt) ? input.createdAt : Date.now()
    const transcriptId = input.transcriptId === undefined
      ? randomUUID()
      : assertNonEmptyString(input.transcriptId, 'transcriptId', 200)
    const hash = contentHash(speakers, segments)

    this.db.exec('BEGIN IMMEDIATE;')
    try {
      const existing = this.statements.findCompatible.get(
        compatibilityKey,
        videoId,
        durationSeconds,
      )
      if (existing !== undefined) {
        this.statements.touch.run(now, existing.transcript_id)
        this.db.exec('COMMIT;')
        const transcript = this.loadComplete(existing.transcript_id)
        if (transcript === undefined) return this.saveComplete(input)
        return { created: false, transcript }
      }
      this.statements.upsertVideo.run(videoId, canonicalUrl, durationSeconds, now)
      this.statements.insertTranscript.run(
        transcriptId,
        videoId,
        durationSeconds,
        compatibilityKey,
        model,
        transcriberVersion,
        language,
        JSON.stringify(speakers),
        timestampVerified ? 1 : 0,
        JSON.stringify(caveats),
        processingJson,
        now,
        now,
        segments.length,
        hash,
      )
      for (const segment of segments) {
        this.statements.insertSegment.run(
          transcriptId,
          segment.ordinal,
          segment.startSeconds,
          segment.speaker ?? null,
          segment.text,
        )
      }
      this.db.exec('COMMIT;')
      return { created: true, transcript: this.loadComplete(transcriptId) }
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;')
      } catch {
        // Preserve the original database error.
      }
      throw error
    }
  }

  readSegments(transcriptId, options = {}) {
    this.assertOpen()
    const id = assertNonEmptyString(transcriptId, 'transcriptId', 200)
    const cursor = options.cursor ?? 0
    const startSeconds = options.startSeconds ?? 0
    const limit = options.limit ?? DEFAULT_PAGE_SEGMENTS
    assertNonNegativeInteger(cursor, 'cursor')
    assertNonNegativeInteger(startSeconds, 'startSeconds')
    assertPositiveInteger(limit, 'limit')
    if (limit > MAX_PAGE_SEGMENTS) {
      throw new TypeError(`youtube-transcript-store: limit must not exceed ${MAX_PAGE_SEGMENTS}`)
    }
    this.db.exec('BEGIN;')
    try {
      const metadata = this.getTranscript(id)
      if (metadata === undefined) {
        this.db.exec('COMMIT;')
        return undefined
      }
      const endSeconds = options.endSeconds ?? metadata.durationSeconds
      assertNonNegativeInteger(endSeconds, 'endSeconds')
      if (endSeconds < startSeconds) {
        throw new TypeError('youtube-transcript-store: endSeconds must not precede startSeconds')
      }
      const rows = this.db.prepare(`
        SELECT ordinal, start_seconds, speaker, text
        FROM segments
        WHERE transcript_id = ? AND ordinal >= ?
          AND start_seconds >= ? AND start_seconds <= ?
        ORDER BY ordinal LIMIT ?
      `).all(id, cursor, startSeconds, endSeconds, limit + 1)
      const hasMore = rows.length > limit
      const selected = rows.slice(0, limit).map(ownedSegment)
      this.db.exec('COMMIT;')
      return {
        transcript: metadata,
        segments: selected,
        nextCursor: hasMore && selected.length > 0
          ? selected.at(-1).ordinal + 1
          : undefined,
      }
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;')
      } catch {
        // Preserve the original read error.
      }
      throw error
    }
  }

  search(transcriptId, query, options = {}) {
    this.assertOpen()
    const id = assertNonEmptyString(transcriptId, 'transcriptId', 200)
    const text = assertNonEmptyString(query, 'query', 2_000).trim()
    const limit = options.limit ?? 20
    assertPositiveInteger(limit, 'limit')
    if (limit > 100) throw new TypeError('youtube-transcript-store: search limit must not exceed 100')
    const expression = searchExpression(text)
    if (expression === undefined) {
      throw new TypeError('youtube-transcript-store: query must contain a letter or number')
    }
    const runLikeSearch = () => {
      const like = text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
      return this.db.prepare(`
        SELECT ordinal, start_seconds, speaker, text, 0 AS score
        FROM segments
        WHERE transcript_id = ? AND (
          text LIKE ? ESCAPE '\\' OR coalesce(speaker, '') LIKE ? ESCAPE '\\'
        )
        ORDER BY ordinal LIMIT ?
      `).all(id, `%${like}%`, `%${like}%`, limit)
    }

    this.db.exec('BEGIN;')
    try {
      const metadata = this.getTranscript(id)
      if (metadata === undefined) {
        this.db.exec('COMMIT;')
        return undefined
      }
      let rows
      if (this.ftsEnabled) {
        const transcriptExpression = `transcript_id : "${id.replaceAll('"', '""')}" AND (${expression})`
        try {
          rows = this.db.prepare(`
            SELECT s.ordinal, s.start_seconds, s.speaker, s.text,
              bm25(transcript_segments_fts) AS score
            FROM transcript_segments_fts
            JOIN segments s ON s.id = transcript_segments_fts.rowid
            WHERE transcript_segments_fts MATCH ? AND s.transcript_id = ?
            ORDER BY score, s.ordinal LIMIT ?
          `).all(transcriptExpression, id, limit)
        } catch {
          this.ftsEnabled = false
          rows = runLikeSearch()
        }
      } else {
        rows = runLikeSearch()
      }
      this.db.exec('COMMIT;')
      return {
        transcript: metadata,
        matches: rows.map((row) => ({ ...ownedSegment(row), score: Number(row.score) || 0 })),
      }
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;')
      } catch {
        // Preserve the original search error.
      }
      throw error
    }
  }

  listVersions(videoId) {
    this.assertOpen()
    return this.statements.listVersions.all(
      assertNonEmptyString(videoId, 'videoId', 100),
    ).map(ownedMetadata)
  }

  deleteTranscript(transcriptId) {
    this.assertOpen()
    const result = this.statements.deleteTranscript.run(
      assertNonEmptyString(transcriptId, 'transcriptId', 200),
    )
    return result.changes > 0
  }

  stats() {
    this.assertOpen()
    const videos = this.db.prepare('SELECT count(*) AS count FROM videos').get().count
    const transcripts = this.db.prepare('SELECT count(*) AS count FROM transcripts').get().count
    const segments = this.db.prepare('SELECT count(*) AS count FROM segments').get().count
    const pageCount = this.db.prepare('PRAGMA page_count').get().page_count
    const pageSize = this.db.prepare('PRAGMA page_size').get().page_size
    let fileBytes = pageCount * pageSize
    if (this.options.path !== ':memory:') {
      let measuredBytes = 0
      let measured = false
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          measuredBytes += statSync(`${this.options.path}${suffix}`).size
          measured = true
        } catch {
          // Optional WAL files may not exist after a checkpoint.
        }
      }
      if (measured) fileBytes = measuredBytes
    }
    return { videos, transcripts, segments, fileBytes, fullTextSearch: this.ftsEnabled }
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }
}

export function apply(ctx, config) {
  const archive = new YoutubeTranscriptArchive(config)
  ctx.effect(() => () => archive.close(), 'youtube-transcript-store: close archive')
  ctx.provide(TRANSCRIPT_STORE_SERVICE, archive)
}
