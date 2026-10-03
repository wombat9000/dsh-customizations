import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import test from 'node:test'
import { seedSession, persistSession, prepareFixtureSession } from './session-fixture.mjs'
import {
  approvalCommandSeed,
  beginCommandTurn,
  endCommandTurn,
  liveCommandCallId,
} from './github-approval-fixture.mjs'
import { githubSessionSeed } from './github-grants-fixture.mjs'
import { githubItemsSeed } from './github-items-fixture.mjs'
import { githubFieldSessionSeed } from './github-field-fixture.mjs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = (name) => import(pathToFileURL(cli.resolve(`@deepseek-ai/${name}`)).href)
const { Context } = await installed('cordis')
const { default: Sessions, SESSION_FORMAT_VERSION } = await installed('dsh-session')
const { default: Persistence } = await installed('dsh-session-persistence-jsonl')
const { default: Storage } = await installed('dsh-storage')
const StorageJson = await installed('dsh-storage-json')
const StorageDomain = await installed('dsh-storage-domain')
const { default: Projections } = await installed('dsh-session-projection')
const { default: Titles } = await installed('dsh-session-title')
const { default: ProjectionCache } = await installed('dsh-session-projection-cache')
import { waitForFixture } from './global-setup.mjs'

function fixture(failure) {
  const calls = []
  let events
  const ctx = {
    sessions: {
      prepare(id, options) {
        calls.push('prepare')
        events = options.seed
        return { id, header: { id, ...options.meta }, snapshotEvents: () => events }
      },
    },
    sessionProjectionCache: {
      async write() {
        calls.push('write cache')
        if (failure === 'cache') throw Error(failure)
      },
    },
    sessionPersistence: {
      async create(header) {
        assert.equal(header.id, 'visual-test-history')
        calls.push('create')
        return {
          async append(batch) {
            calls.push('append')
            assert.equal(batch, events)
            if (failure === 'append') throw Error(failure)
          },
          async flush() {
            calls.push('flush')
            if (failure === 'flush') throw Error(failure)
          },
          async close() {
            calls.push('close writer')
          },
        }
      },
      async open(id, access) {
        assert.equal(id, 'visual-test-history')
        assert.equal(access, 'read')
        calls.push('open reader')
        return {
          async read() {
            calls.push('read')
            if (failure === 'read') throw Error(failure)
            return { events: failure === 'mismatch' ? [] : events }
          },
          async close() {
            calls.push('close reader')
          },
        }
      },
    },
  }
  return { ctx, calls }
}

test('visual seed owns, flushes, closes and reopens its persistence handle without an agent', async () => {
  const { ctx, calls } = fixture()
  assert.equal(await seedSession(ctx), 'visual-test-history')
  assert.deepEqual(calls, [
    'prepare',
    'create',
    'append',
    'flush',
    'close writer',
    'open reader',
    'read',
    'close reader',
    'write cache',
  ])
})
for (const failure of ['append', 'flush', 'read', 'mismatch', 'cache']) {
  test(`visual seed closes its handle on ${failure} failure`, async () => {
    const { ctx, calls } = fixture(failure)
    await assert.rejects(seedSession(ctx))
    assert.ok(calls.includes('close writer'))
    if (failure === 'cache') assert.deepEqual(calls.slice(-2), ['close reader', 'write cache'])
    else {
      assert.ok(!calls.includes('write cache'))
      if (['read', 'mismatch'].includes(failure)) assert.equal(calls.at(-1), 'close reader')
      else assert.ok(!calls.includes('open reader'))
    }
  })
}

test('all synthetic histories reopen through native V4 persistence without tools or models', async (t) => {
  assert.equal(SESSION_FORMAT_VERSION, 4)
  const directory = await mkdtemp(join(tmpdir(), 'dsh-v4-seeds-'))
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  await ctx.plugin(Sessions).await()
  await ctx.plugin(Persistence, { root: directory, compression: 'none' }).await()
  await ctx.plugin(Storage).await()
  await ctx.plugin(StorageJson, { root: join(directory, 'cache') }).await()
  await ctx.plugin(StorageDomain, { backend: 'json' }).await()
  await ctx.plugin(Projections).await()
  await ctx.plugin(Titles, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 }).await()
  await ctx.plugin(ProjectionCache, { writeEveryEvents: 200, writeIntervalMs: 5000 }).await()
  await seedSession(ctx)
  for (const factory of [
    approvalCommandSeed,
    githubSessionSeed,
    githubItemsSeed,
    githubFieldSessionSeed,
  ]) {
    const fixture = factory(directory)
    const session = prepareFixtureSession(ctx, fixture.id, fixture.options)
    await persistSession(ctx, session)
    const reader = await ctx.sessionPersistence.open(session.id, 'read')
    try {
      const stored = (await reader.read()).events
      assert.deepEqual(stored, session.snapshotEvents())
      assert.equal(
        stored.findLast((event) => event.type === 'session/title')?.data.title,
        basename(session.header.cwd),
        'native sidebar navigation requires an explicit persisted fixture title',
      )
    } finally {
      await reader.close()
    }
    if (factory !== approvalCommandSeed) continue
    const prior = session.snapshotEvents().length
    for (const turn of [2, 3]) {
      beginCommandTurn(session, turn)
      endCommandTurn(session, turn)
    }
    const advertised = session
      .snapshotEvents()
      .filter((event) => event.type === 'assistant/message')
      .flatMap((event) =>
        event.data.message.content
          .filter((block) => block.type === 'tool-call')
          .map((block) => block.id),
      )
    assert.equal(
      new Set(advertised).size,
      advertised.length,
      'each live call has a distinct chat-node identity',
    )
    const tail = session.snapshotEvents(prior)
    assert.equal(tail.filter((event) => event.type === 'tool/call').length, 2)
    assert.equal(
      fixture.options.seed.some((event) => event.type === 'tool/call'),
      false,
    )
    assert.equal(
      fixture.options.seed.find((event) => event.type === 'tool/result').data.error.code,
      'TOOL_NOT_STARTED',
    )
    for (const event of tail.filter((event) => event.type === 'tool/result')) {
      assert.equal(event.data.error.code, 'TOOL_CANCELLED')
      assert.equal(event.data.message.role, 'tool')
      assert.equal(event.data.message.toolCallId, liveCommandCallId(event.data.turn))
    }
    const writer = await ctx.sessionPersistence.open(session.id, 'write')
    try {
      await writer.append(tail)
      await writer.flush()
    } finally {
      await writer.close()
    }
    const reopened = await ctx.sessionPersistence.open(session.id, 'read')
    try {
      assert.deepEqual((await reopened.read()).events, session.snapshotEvents())
    } finally {
      await reopened.close()
    }
  }
  const headers = await ctx.sessionPersistence.list()
  assert.equal(headers.length, 5)
  for (const { header } of headers) {
    assert.equal(
      ctx.sessionProjectionCache.cachedSnapshot(header)?.values.title,
      basename(header.cwd),
      'cold sidebar titles must be available before any session is activated',
    )
  }
  assert.equal(ctx.get('tools'), undefined)
  assert.equal(ctx.get('llm'), undefined)
  assert.equal(ctx.get('agents'), undefined)
})

test('bootstrap refuses a ready Web listener without a verified seed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-seed-test-'))
  try {
    await assert.rejects(waitForFixture(directory, 1), /did not persist and reopen/)
    await writeFile(join(directory, '.visual-fixture-ready'), 'wrong')
    await assert.rejects(waitForFixture(directory, 1), /Unexpected visual fixture identity/)
    await writeFile(join(directory, '.visual-fixture-ready'), 'visual-test-history')
    await waitForFixture(directory, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
