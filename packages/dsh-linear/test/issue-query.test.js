import assert from 'node:assert/strict'
import test from 'node:test'
import { LinearRuntime } from '../dist/src/runtime.js'

function listing(clientOverrides = {}) {
  const queries = []
  const client = {
    organization: Promise.resolve({ id: 'org-id', name: 'Acme', urlKey: 'acme' }),
    async issues(query) {
      queries.push(query)
      return { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false } }
    },
    ...clientOverrides,
  }
  const runtime = new LinearRuntime({
    resolveApiKey: async () => 'lin_api_test',
    settings: () => ({ organizationId: 'org-id' }),
    createClient: () => client,
  })
  return { runtime, queries }
}

// Existing index tests own resolved filters and null-relation filters. These cases
// protect listing defaults and error boundaries that query extraction must retain.
test('empty issue selectors use listing defaults without catalog lookups', async () => {
  const { runtime, queries } = listing()
  const result = await runtime.listIssues({
    team: ' ',
    assignee: '',
    project: ' ',
    cycle: '',
    states: [],
    priorities: [],
    labels: [],
  })
  assert.deepEqual(queries, [
    { first: 20, filter: {}, includeArchived: false, orderBy: 'updatedAt' },
  ])
  assert.deepEqual(result, { issues: [], pageInfo: { hasNextPage: false } })
})

test('issue listing retains explicit ordering, archive inclusion, and timestamp offsets', async () => {
  const { runtime, queries } = listing()
  await runtime.listIssues({
    limit: 50,
    cursor: '  continuation  ',
    orderBy: 'createdAt',
    includeArchived: true,
    updatedAfter: '2026-01-02T03:04:05+02:00',
    createdAfter: '2026-01-01T23:00:00-05:00',
  })
  assert.deepEqual(queries, [
    {
      first: 50,
      after: 'continuation',
      filter: {
        updatedAt: { gte: '2026-01-02T01:04:05.000Z' },
        createdAt: { gte: '2026-01-02T04:00:00.000Z' },
      },
      includeArchived: true,
      orderBy: 'createdAt',
    },
  ])
})

test('issue states require a team before other selectors or issue queries run', async () => {
  const { runtime, queries } = listing()
  await assert.rejects(runtime.listIssues({ team: ' ', states: ['started'], assignee: 'Ada' }), {
    message: 'Linear team is required when filtering issues by state name or type.',
  })
  assert.deepEqual(queries, [])
})

test('issue listing preserves raw date errors and operation-wrapped paging errors', async (t) => {
  const cases = [
    [{ updatedAfter: 'not-a-date' }, 'updatedAfter must be an ISO date or timestamp'],
    [{ createdAfter: '' }, 'createdAfter must be an ISO date or timestamp'],
    [{ updatedAfter: 123 }, 'updatedAfter must be an ISO date or timestamp'],
    [{ limit: 51 }, 'Linear list issues failed: limit must be an integer from 1 to 50'],
    [{ limit: 0 }, 'Linear list issues failed: limit must be an integer from 1 to 50'],
    [
      { cursor: ' ' },
      'Linear list issues failed: cursor must be a non-empty Linear pagination cursor',
    ],
  ]
  for (const [args, message] of cases) {
    await t.test(JSON.stringify(args), async () => {
      const { runtime, queries } = listing()
      await assert.rejects(runtime.listIssues(args), { message })
      assert.deepEqual(queries, [])
    })
  }
})

test('issue selector and execution failures retain their distinct operation labels', async () => {
  const resolution = listing({
    async users() {
      throw new Error('catalog unavailable')
    },
  })
  await assert.rejects(resolution.runtime.listIssues({ assignee: 'Ada' }), {
    message: 'Linear resolve assignee failed: catalog unavailable',
  })
  assert.deepEqual(resolution.queries, [])

  const execution = listing({
    async issues() {
      throw new Error('query unavailable')
    },
  })
  await assert.rejects(execution.runtime.listIssues({}), {
    message: 'Linear list issues failed: query unavailable',
  })
})

test('issue project URL resolution uses the authenticated workspace key', async () => {
  const { runtime, queries } = listing()
  await assert.rejects(
    runtime.listIssues({ project: 'https://linear.app/other/project/platform/overview' }),
    {
      message:
        'Linear project URL belongs to workspace “other”, not the connected workspace “acme”.',
    },
  )
  assert.deepEqual(queries, [])
})
