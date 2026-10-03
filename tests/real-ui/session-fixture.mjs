// Test-only host plugin. Seed a completed user turn without invoking an agent or provider.
import assert from 'node:assert/strict'
import { registerGlobalGuidanceFixture } from './global-guidance-fixture.mjs'
import {
  registerApprovalFixture,
  approvalCommandSeed,
  commandWorkspace,
} from './github-approval-fixture.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { githubSessionSeed, githubWorkspaceName } from './github-grants-fixture.mjs'
import { githubItemsSeed, githubItemsWorkspace } from './github-items-fixture.mjs'
import { githubFieldSessionSeed, githubFieldWorkspaceName } from './github-field-fixture.mjs'
import { basename, join } from 'node:path'

export const inject = ['sessions', 'sessionPersistence', 'sessionProjectionCache', 'sessionTitle']

export function prepareFixtureSession(ctx, id, options) {
  // The target sidebar uses durable titles, not the catalog's cwd fallback.
  // Preserve deterministic fixture times and never invoke a title provider.
  const seed = options.seed
  assert.ok(seed.length > 0, 'display fixtures require a nonempty seeded history')
  return ctx.sessions.prepare(id, {
    ...options,
    seed: [
      ...seed,
      {
        seq: seed.length,
        time: seed.at(-1).time,
        type: 'session/title',
        data: { title: basename(options.meta.cwd), messageSeqs: [], source: { kind: 'user' } },
      },
    ],
  })
}
export async function apply(ctx) {
  registerGlobalGuidanceFixture(ctx)
  registerApprovalFixture(ctx)
  const commandCwd = join(process.cwd(), '..', commandWorkspace)
  await mkdir(commandCwd, { recursive: true })
  const command = approvalCommandSeed(commandCwd)
  await persistSession(ctx, prepareFixtureSession(ctx, command.id, command.options))
  const id = await seedSession(ctx)
  await seedGitHubSession(ctx)
  const itemsCwd = join(process.cwd(), '..', githubItemsWorkspace)
  await mkdir(itemsCwd, { recursive: true })
  const items = githubItemsSeed(itemsCwd)
  await persistSession(ctx, prepareFixtureSession(ctx, items.id, items.options))
  const fieldCwd = join(process.cwd(), '..', githubFieldWorkspaceName)
  await mkdir(fieldCwd, { recursive: true })
  const field = githubFieldSessionSeed(fieldCwd)
  await persistSession(ctx, prepareFixtureSession(ctx, field.id, field.options))
  // The Web listener can become ready before async plugins finish applying.
  await writeFile(join(process.cwd(), '.visual-fixture-ready'), id)
}

export async function seedSession(ctx) {
  const time = Date.UTC(2026, 0, 2, 3, 4, 5)
  const session = prepareFixtureSession(ctx, 'visual-test-history', {
    meta: { cwd: process.cwd(), createdAt: time },
    seed: [
      { seq: 0, time, type: 'turn/start', data: { turn: 1 } },
      {
        seq: 1,
        time,
        type: 'user/message',
        surfaceOp: 'append',
        data: {
          id: 'visual-test-message',
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Review the Session recap interface.' }],
        },
      },
      { seq: 2, time, type: 'step/start', data: { turn: 1, step: 1 } },
      {
        seq: 3,
        time,
        type: 'assistant/message',
        surfaceOp: 'append',
        data: {
          turn: 1,
          step: 1,
          stream: [],
          message: {
            id: 'visual-test-assistant',
            role: 'assistant',
            source: { kind: 'model', provider: 'synthetic-fixture', model: 'never-dispatched' },
            content: [{ type: 'text', text: 'The recap is available from the latest response.' }],
          },
        },
      },
      { seq: 4, time, type: 'step/end', data: { turn: 1, step: 1 } },
      { seq: 5, time, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ],
  })
  return persistSession(ctx, session)
}

export async function seedGitHubSession(ctx) {
  // A distinct sibling workspace preserves the recap navigation's exact matcher.
  const cwd = join(process.cwd(), '..', githubWorkspaceName)
  await mkdir(cwd, { recursive: true })
  const fixture = githubSessionSeed(cwd)
  return persistSession(ctx, prepareFixtureSession(ctx, fixture.id, fixture.options))
}

export async function persistSession(ctx, session) {
  // A detached Session never starts an agent. Persist constructor seeds explicitly;
  // native V4 admission validates step and tool relationships when reopening.
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
  // Cold listings only expose already-durable projection checkpoints. This
  // detached seed bypasses live-session write hooks, so publish its cache only
  // after the actual log has been flushed, closed, and independently reopened.
  await ctx.sessionProjectionCache.write(session)
  return session.id
}
