import assert from 'node:assert/strict'
import test from 'node:test'
import { QUERIES, ISSUE } from '../dist/src/queries.js'
import { createGitHubRuntime } from '../dist/src/runtime.js'
import { fakeSubprocess, json, connection } from './fixtures.js'

test('repository issue listing reads bounded assignees without broadening shared issue selections', async () => {
  assert.match(
    QUERIES.listIssues,
    /assignees\(first:20\) \{ nodes \{ login \} totalCount pageInfo \{ hasNextPage endCursor \}/,
  )
  assert.doesNotMatch(ISSUE, /assignees/)
  assert.doesNotMatch(QUERIES.searchIssues, /assignees/)
  for (const query of Object.values(QUERIES)) assert.doesNotMatch(query, /\bmutation\b/)
  const subprocess = fakeSubprocess([
    json({
      data: {
        repository: {
          issues: connection([
            {
              id: 'I1',
              number: 1,
              url: 'https://github.com/acme/app/issues/1',
              assignees: connection([{ login: 'ada' }], true, 'assignees-next'),
            },
          ]),
        },
      },
    }),
  ])
  const result = await createGitHubRuntime(subprocess).listIssues(
    { owner: 'acme', repo: 'app' },
    { cwd: '/' },
  )
  assert.deepEqual(result.data.nodes[0].assignees.nodes, [{ login: 'ada' }])
  assert.equal(result.data.nodes[0].assignees.nextCursor, 'assignees-next')
  assert.equal(result.truncated, true)
  assert.ok(result.truncations.some((value) => value.path === 'data.nodes[0].assignees'))
  assert.equal(subprocess.specs.length, 1)
})
