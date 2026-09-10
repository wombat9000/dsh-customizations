// Test-only host plugin. Seed a completed user turn without invoking an agent or provider.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const inject = ['sessions', 'sessionPersistence']
export async function apply(ctx) {
  const id = await seedSession(ctx)
  // The Web listener can become ready before async plugins finish applying.
  await writeFile(join(process.cwd(), '.visual-fixture-ready'), id)
}

export async function seedSession(ctx) {
  const time = Date.UTC(2026, 0, 2, 3, 4, 5)
  const session = ctx.sessions.prepare('visual-test-history', {
    meta: { cwd: process.cwd(), createdAt: time },
    seed: [
      { seq: 0, time, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, time, type: 'user/message', surfaceOp: 'append', data: { id: 'visual-test-message', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Review the Session recap interface.' }] } },
      { seq: 2, time, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ],
  })
  // A detached Session validates the seed without starting an agent. In 0.1.5,
  // sessions.flush alone does not install a writer or persist constructor seeds.
  const handle = await ctx.sessionPersistence.create(session.header)
  try {
    await handle.append(session.snapshotEvents())
    await handle.flush()
  } finally {
    await handle.close()
  }
  // Reopen after releasing ownership: validate storage, not just the live store.
  const reader = await ctx.sessionPersistence.open(session.id, 'read')
  try {
    assert.deepEqual((await reader.read()).events, session.snapshotEvents())
  } finally {
    await reader.close()
  }
  return session.id
}
