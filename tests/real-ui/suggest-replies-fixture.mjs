// Native persisted fixture events, not a provider request or live tool dispatch.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export const workspaceName = 'suggested-replies-workspace'
export const prompt = 'Add suggested follow-up replies to this conversation.'
export const replies = ['Explain the tradeoff', 'Add a regression test', 'Show the implementation']

// Seed on demand so this journey does not change other plugins' sidebar baselines.
export function registerReplyFixture(ctx, { prepareFixtureSession, persistSession }) {
  let seeded = false
  ctx.inject(['webServer', 'workspaceRegistry'], (scope) =>
    scope.effect(() =>
      scope.webServer.register({
        kind: 'exact',
        path: '/api/test/suggest-replies',
        handler: async (req, res) => {
          if (
            req.method !== 'POST' ||
            req.headers.origin !== `http://${req.headers.host}` ||
            req.headers['x-dsh-test'] !== '1'
          ) {
            res.writeHead(403)
            return res.end()
          }
          const id = 'visual-test-suggest-replies'
          if (req.headers['x-dsh-action'] === 'archive') {
            if (seeded) await scope.workspaceRegistry.archiveSession(id)
          } else if (!seeded) {
            const cwd = join(process.cwd(), '..', workspaceName)
            await mkdir(cwd, { recursive: true })
            await persistSession(ctx, prepareFixtureSession(ctx, id, replyHistory(cwd)))
            seeded = true
          } else {
            await scope.workspaceRegistry.unarchiveSession(id)
          }
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          res.end('{}')
        },
      }),
    ),
  )
}

export function replyHistory(cwd) {
  const time = Date.UTC(2026, 0, 2, 3, 4, 5)
  const seed = [
    { type: 'turn/start', data: { turn: 1 } },
    {
      type: 'user/message',
      surfaceOp: 'append',
      data: {
        id: 'suggestions-user',
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: prompt }],
      },
    },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message',
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        stream: [],
        message: {
          id: 'suggestions-tool-message',
          role: 'assistant',
          source: { kind: 'model', provider: 'synthetic-fixture', model: 'never-dispatched' },
          content: [
            {
              type: 'tool-call',
              id: 'suggestions-call',
              name: 'suggest_replies',
              arguments: JSON.stringify({ replies }),
            },
          ],
        },
      },
    },
    {
      type: 'tool/call',
      data: {
        turn: 1,
        step: 1,
        callId: 'suggestions-call',
        name: 'suggest_replies',
        arguments: JSON.stringify({ replies }),
      },
    },
    {
      type: 'tool/result',
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'suggestions-result',
          role: 'tool',
          source: { kind: 'tool', callId: 'suggestions-call' },
          toolCallId: 'suggestions-call',
          content: [{ type: 'text', text: JSON.stringify({ replies }) }],
        },
      },
    },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'step/start', data: { turn: 1, step: 2 } },
    {
      type: 'assistant/message',
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 2,
        stream: [],
        message: {
          id: 'suggestions-answer',
          role: 'assistant',
          source: { kind: 'model', provider: 'synthetic-fixture', model: 'never-dispatched' },
          content: [
            {
              type: 'text',
              text: 'Suggested replies are ready. Choose one below to start an editable draft.',
            },
          ],
        },
      },
    },
    { type: 'step/end', data: { turn: 1, step: 2 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  return {
    meta: { cwd, createdAt: time },
    seed: seed.map((event, seq) => ({ seq, time, ...event })),
  }
}
