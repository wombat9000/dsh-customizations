import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { seedSession } from './session-fixture.mjs'
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
    sessionPersistence: {
      async create(header) {
        assert.equal(header.id, 'visual-test-history')
        calls.push('create')
        return {
          async append(batch) { calls.push('append'); assert.equal(batch, events); if (failure === 'append') throw Error(failure) },
          async flush() { calls.push('flush'); if (failure === 'flush') throw Error(failure) },
          async close() { calls.push('close writer') },
        }
      },
      async open(id, access) {
        assert.equal(id, 'visual-test-history')
        assert.equal(access, 'read')
        calls.push('open reader')
        return {
          async read() { calls.push('read'); if (failure === 'read') throw Error(failure); return { events: failure === 'mismatch' ? [] : events } },
          async close() { calls.push('close reader') },
        }
      },
    },
  }
  return { ctx, calls }
}

test('visual seed owns, flushes, closes and reopens its persistence handle without an agent', async () => {
  const { ctx, calls } = fixture()
  assert.equal(await seedSession(ctx), 'visual-test-history')
  assert.deepEqual(calls, ['prepare', 'create', 'append', 'flush', 'close writer', 'open reader', 'read', 'close reader'])
})
for (const failure of ['append', 'flush', 'read', 'mismatch']) {
  test(`visual seed closes its handle on ${failure} failure`, async () => {
    const { ctx, calls } = fixture(failure)
    await assert.rejects(seedSession(ctx))
    assert.ok(calls.includes('close writer'))
    if (['read', 'mismatch'].includes(failure)) assert.equal(calls.at(-1), 'close reader')
    else assert.ok(!calls.includes('open reader'))
  })
}

test('bootstrap refuses a ready Web listener without a verified seed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-seed-test-'))
  try {
    await assert.rejects(waitForFixture(directory, 1), /did not persist and reopen/)
    await writeFile(join(directory, '.visual-fixture-ready'), 'wrong')
    await assert.rejects(waitForFixture(directory, 1), /Unexpected visual fixture identity/)
    await writeFile(join(directory, '.visual-fixture-ready'), 'visual-test-history')
    await waitForFixture(directory, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
