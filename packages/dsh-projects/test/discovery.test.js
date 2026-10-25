import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, github, uuid } from './fixtures.js'

const repository = (name, extra = {}) => ({
  name,
  nameWithOwner: `acme/${name}`,
  url: `https://github.com/acme/${name}`,
  description: `${name} description`,
  isArchived: false,
  owner: { login: 'acme' },
  ...extra,
})

test('GitHub discovery defaults to the signed-in account and returns saveable targets', async () => {
  const calls = []
  const { service, state } = fixture({
    github: {
      connectionStatus: async (args, options) => {
        calls.push({ method: 'connectionStatus', args, options })
        return github([], { data: { authenticated: true, account: 'octo' } })
      },
      listRepositories: async (args) => {
        calls.push({ method: 'listRepositories', args })
        return {
          ...github(),
          data: {
            nodes: [
              repository('Web.App'),
              repository('old', { isArchived: true }),
              repository('..'),
              repository('bad name'),
            ],
            pageInfo: { hasNextPage: true, endCursor: 'next' },
          },
        }
      },
      listProjects: async (args) => {
        calls.push({ method: 'listProjects', args })
        return github([
          {
            number: 3,
            title: 'Roadmap Q4',
            shortDescription: 'Plans',
            closed: false,
            owner: { login: 'acme' },
          },
          { number: 0, title: 'Invalid number', owner: { login: 'acme' } },
        ])
      },
    },
  })
  const repos = await service.discover({ kind: 'github-repository' })
  assert.equal(repos.owner, 'octo')
  assert.deepEqual(
    calls.slice(0, 2).map(({ method, args }) => ({ method, args })),
    [
      { method: 'connectionStatus', args: {} },
      { method: 'listRepositories', args: { owner: 'octo', limit: 50 } },
    ],
  )
  assert.ok(calls[0].options.signal instanceof AbortSignal)
  // Invalid targets are dropped and archived repositories marked.
  assert.deepEqual(repos.candidates, [
    {
      target: { kind: 'github-repository', owner: 'acme', repo: 'Web.App' },
      name: 'Web.App',
      suggestedId: 'web-app',
      description: 'Web.App description',
    },
    {
      target: { kind: 'github-repository', owner: 'acme', repo: 'old' },
      name: 'old',
      suggestedId: 'old',
      description: 'old description',
      inactive: true,
    },
  ])
  assert.equal(repos.hasNextPage, true)
  assert.equal(repos.nextCursor, 'next')
  assert.equal(repos.untrusted, true)

  const boards = await service.discover({ kind: 'github-project', owner: 'acme', cursor: 'c' })
  assert.deepEqual(calls.at(-1).args, { owner: 'acme', limit: 50, cursor: 'c' })
  assert.deepEqual(boards.candidates, [
    {
      target: { kind: 'github-project', owner: 'acme', projectNumber: 3 },
      name: 'Roadmap Q4',
      suggestedId: 'roadmap-q4',
      description: 'Plans',
    },
  ])
  assert.equal(state.saves.length, 0, 'discovery never writes configuration')
})

test('Linear discovery lists teams and projects through the shared read facade', async () => {
  const calls = []
  const other = '22222222-3333-4444-5555-666666666666'
  const { service } = fixture({
    linear: {
      listTeams: async (args) => {
        calls.push({ method: 'listTeams', args })
        return { teams: [{ id: uuid, key: 'ENG', name: 'Engineering', private: false }] }
      },
      listProjects: async (args) => {
        calls.push({ method: 'listProjects', args })
        return {
          projects: [
            {
              id: other,
              name: 'Mobile launch',
              url: 'https://linear.app/acme/project/x',
              state: 'started',
            },
            { id: uuid, name: 'Done thing', state: 'completed' },
            { id: 'not-a-uuid', name: 'Renamed' },
          ],
          pageInfo: { hasNextPage: false },
        }
      },
    },
  })
  assert.deepEqual((await service.discover({ kind: 'linear-team' })).candidates, [
    {
      target: { kind: 'linear-team', team: uuid },
      name: 'Engineering',
      suggestedId: 'engineering',
      description: 'ENG',
    },
  ])
  const projects = await service.discover({ kind: 'linear-project', cursor: 'p2' })
  assert.deepEqual(calls.at(-1), { method: 'listProjects', args: { limit: 50, cursor: 'p2' } })
  assert.deepEqual(
    projects.candidates.map(({ target, inactive }) => ({ target, inactive })),
    [
      { target: { kind: 'linear-project', project: other }, inactive: undefined },
      { target: { kind: 'linear-project', project: uuid }, inactive: true },
    ],
  )
  assert.equal(projects.owner, undefined)
})

test('discovery validates input, reports unavailable providers and hides diagnostics', async () => {
  let calls = 0
  const { service, state } = fixture({
    github: {
      connectionStatus: async () => {
        calls++
        return github([], { data: { authenticated: false, account: null } })
      },
      listRepositories: async () => {
        calls++
        throw new Error('secret ghp_private')
      },
    },
  })
  for (const input of [
    {},
    { kind: 'github-issue' },
    { kind: 'github-repository', owner: 'bad owner' },
    { kind: 'linear-project', owner: 'acme' },
    { kind: 'linear-team', cursor: 'x' },
    { kind: 'github-repository', extra: true },
  ])
    await assert.rejects(service.discover(input), { code: 'invalid' })
  assert.equal(calls, 0)
  await assert.rejects(service.discover({ kind: 'linear-team' }), { code: 'unavailable' })
  await assert.rejects(service.discover({ kind: 'github-repository' }), { code: 'account' })
  await assert.rejects(
    service.discover({ kind: 'github-repository', owner: 'acme' }),
    (error) => error.code === 'failed' && !/private/.test(error.message),
  )
  state.providers = {}
  await assert.rejects(service.discover({ kind: 'github-project', owner: 'acme' }), {
    code: 'unavailable',
  })
})
