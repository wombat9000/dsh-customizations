// Test-only host plugin. Seed a completed user turn without invoking an agent or provider.
export const inject = ['sessions', 'sessionPersistence']
export async function apply(ctx) {
  const time = Date.UTC(2026, 0, 2, 3, 4, 5)
  const session = ctx.sessions.create('visual-test-history', {
    meta: { cwd: process.cwd(), createdAt: time },
    seed: [
      { seq: 0, time, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, time, type: 'user/message', surfaceOp: 'append', data: { id: 'visual-test-message', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Review the Session recap interface.' }] } },
      { seq: 2, time, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ],
  })
  await ctx.sessions.flush(session)
}
