import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const environmentCIWorkspace = 'environment-live-ci-workspace'
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
}
