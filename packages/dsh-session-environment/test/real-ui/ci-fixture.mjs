import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const environmentCIWorkspace = 'environment-live-ci-workspace'
export const worktreeStartupWorkspace = 'Worktree startup'
export const environmentCIPrompt =
  'Inspect live checkout CI without an agent or GitHub network call.'
export async function seedEnvironmentCI(ctx, { prepareFixtureSession, persistSession }) {
  const cwd = join(process.cwd(), '..', environmentCIWorkspace)
  await mkdir(cwd, { recursive: true })
  const git = (...args) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' })
  git('init', '-b', 'feature/live-ci')
  git('remote', 'add', 'origin', 'https://github.com/ci-fixture/repo.git')
  await writeFile(join(cwd, 'fixture.txt'), 'isolated CI fixture\n')
  git('add', 'fixture.txt')
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'fixture',
  )
  await writeFile(join(cwd, 'untracked.txt'), 'first line\nsecond line\nthird line\n')
  const time = Date.UTC(2026, 0, 2, 3, 4, 5)
  const session = prepareFixtureSession(ctx, 'visual-test-environment-live-ci', {
    meta: { cwd, createdAt: time },
    seed: [
      { seq: 0, time, type: 'turn/start', data: { turn: 1 } },
      {
        seq: 1,
        time,
        type: 'user/message',
        surfaceOp: 'append',
        data: {
          id: 'ci-fixture-user',
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: environmentCIPrompt }],
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
            id: 'ci-fixture-assistant',
            role: 'assistant',
            source: { kind: 'model', provider: 'synthetic-fixture', model: 'never-dispatched' },
            content: [
              {
                type: 'text',
                text: 'CI is based on the selected checkout, not this historical turn.',
              },
            ],
          },
        },
      },
      { seq: 4, time, type: 'step/end', data: { turn: 1, step: 1 } },
      { seq: 5, time, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ],
  })
  await persistSession(ctx, session)
  registerWorktreePreferenceFixture(ctx, cwd)
}

// Test-only observation and explicit fixture-directory action. This endpoint
// accepts no arbitrary path, command or model request; it exists only in the
// shared disposable host. Native worktrees and workingDirectory own the effects.
function registerWorktreePreferenceFixture(ctx, cwd) {
  let linked
  let startupWorkspace
  ctx.inject(
    [
      'webServer',
      'agents',
      'workingDirectory',
      'worktrees',
      'systemPrompt',
      'sessionEnvironment',
      'workspaceRegistry',
    ],
    (scope) => {
      scope.webServer.register({
        kind: 'exact',
        path: '/api/test/worktree-preference',
        handler: async (req, res) => {
          if (
            req.method !== 'POST' ||
            req.headers.origin !== `http://${req.headers.host}` ||
            req.headers['x-dsh-test'] !== '1'
          ) {
            res.writeHead(403)
            res.end()
            return
          }
          let body = ''
          for await (const chunk of req) {
            body += chunk
            if (body.length > 200) break
          }
          if (!['observe', 'enter', 'leave', 'startup'].includes(body)) {
            res.writeHead(400)
            res.end()
            return
          }
          const agent = scope.agents.get('visual-test-environment-live-ci')
          if (!agent) {
            res.writeHead(409)
            res.end()
            return
          }
          try {
            if (body === 'startup' && !startupWorkspace) {
              const path = join(cwd, '..', 'worktree-startup-workspace')
              execFileSync('git', ['clone', '--no-hardlinks', '--', cwd, path], { stdio: 'pipe' })
              startupWorkspace = await scope.workspaceRegistry.create(
                path,
                worktreeStartupWorkspace,
              )
            }
            if (body === 'enter') {
              if (!linked) {
                const result = await scope.worktrees.create(agent, { name: 'worktree-preference' })
                linked = result.path
              } else await scope.workingDirectory.set(agent, linked)
            }
            if (body === 'leave') {
              await scope.workingDirectory.set(agent, cwd)
              if (startupWorkspace) await scope.workspaceRegistry.delete(startupWorkspace.id)
            }
            const assembly = await scope.systemPrompt.assemble({ agent })
            const status = await scope.sessionEnvironment.readWorktreePreference(
              { sessionId: agent.id },
              new AbortController().signal,
            )
            res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
            res.end(
              JSON.stringify({
                status,
                original: cwd,
                nativeToolAvailable: agent.ctx.tools
                  .schemas()
                  .some((tool) => tool.name === 'create_worktree'),
                guidance:
                  assembly.sections.find(
                    (section) => section.name === 'session-environment:worktree-preference',
                  )?.text ?? '',
              }),
            )
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: error.message }))
          }
        },
      })
    },
  )
}
