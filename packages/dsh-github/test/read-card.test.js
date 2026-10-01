import assert from 'node:assert/strict'
import test from 'node:test'
import { issue, detailedIssue, detailedProject, projectItem } from './payloads.js'
import { connection } from './fixtures.js'
import { registerTypeScript } from './source-loader.mjs'
registerTypeScript()
const { readCardModel, readWarnings } = await import('../client/read-models.ts')
const block = (data, extra = {}) => ({
  kind: 'tool-result',
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        host: 'github.com',
        untrusted: true,
        data,
        truncated: false,
        truncations: [],
        ...extra,
      }),
    },
  ],
})

test('single project item continuation retains nested pagination warning', () => {
  const model = readCardModel('github_list_project_items', block(projectItem))
  assert.equal(model.singular, true)
  assert.equal(model.entries[0].id, 'PI_1')
  assert.ok(model.warnings.some((value) => value.includes('fieldValues.nodes[1].labels')))
})
test('search cap and outer truncation remain visible alongside nested cursor warnings', () => {
  const model = readCardModel(
    'github_search_issues',
    block(
      { ...connection([issue]), issueCount: 2000, exhaustive: false },
      {
        truncated: true,
        truncations: [{ path: 'data', kind: 'search-cap', reason: 'Narrow this query' }],
      },
    ),
  )
  assert.equal(model.total, 2000)
  assert.ok(model.warnings.some((value) => value.includes('1,000')))
  assert.ok(model.warnings.some((value) => value.includes('Narrow this query')))
  assert.ok(model.warnings.some((value) => value.includes('not exhaustive')))
})
test('malformed arrays/entries/envelopes fail safely without invented counts', () => {
  for (const data of [
    null,
    [],
    { nodes: 'wrong' },
    { nodes: [null] },
    { nodes: [7] },
    { nodes: [{ id: 'I', title: 'x', number: '1' }] },
  ])
    assert.notEqual(readCardModel('github_list_issues', block(data)).state, 'returned')
  assert.equal(
    readCardModel('github_list_issues', {
      kind: 'tool-result',
      content: [{ type: 'text', text: 'malformed' }],
    }).state,
    'unknown',
  )
  assert.equal(readCardModel('github_create_issue', block(issue)).state, undefined)
})
test('nested UI bounds and missing metadata never imply completeness', () => {
  const options = Array.from({ length: 75 }, (_, i) => ({ id: `O${i}`, name: `Option ${i}` }))
  const data = {
    ...detailedProject,
    fields: { nodes: [{ id: 'F', options }], pageInfo: { hasNextPage: false } },
    repositories: { nodes: Array.from({ length: 51 }, () => ({ id: 'R' })) },
  }
  const warnings = readCardModel('github_get_project', block(data)).warnings
  assert.ok(warnings.some((value) => value.includes('options') && value.includes('50')))
  assert.ok(warnings.some((value) => value.includes('repositories.nodes') && value.includes('50')))
  assert.ok(warnings.some((value) => value.includes('metadata') && value.includes('unknown')))
  const missing = readCardModel('github_list_issues', block({ nodes: [issue] }))
  assert.ok(
    missing.error ||
      missing.warnings.some((warning) => /unknown|missing|pagination|incomplete/i.test(warning)),
  )
  const nested = readCardModel(
    'github_get_issue',
    block({ ...detailedIssue, labels: { nodes: [{ id: 'L', name: 'bug' }] } }),
  )
  assert.match(nested.warnings.join(' '), /unknown|missing|pagination/i)
})
const { collectionModel, inspectCollections } = await import('../client/collection-completeness.ts')

test('structured collection evidence distinguishes complete emptiness, partial pages, and missing metadata', () => {
  const empty = { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false }, nextCursor: null }
  for (const [value, expected] of [
    [empty, 'complete'],
    [{ nodes: [] }, 'unknown'],
    [{ ...empty, totalCount: undefined }, 'unknown'],
    [{ ...empty, totalCount: 1 }, 'unknown'],
    [{ ...empty, totalCount: -1 }, 'unknown'],
    [{ ...empty, totalCount: '0' }, 'unknown'],
    [{ ...empty, nextCursor: 42 }, 'unknown'],
    [{ ...empty, pageInfo: { hasNextPage: false, endCursor: 42 } }, 'unknown'],
    [{ ...empty, pageInfo: { hasNextPage: true }, nextCursor: 'next' }, 'partial'],
    [{ ...empty, truncated: true }, 'partial'],
    [null, 'unknown'],
  ]) {
    const data = { ...detailedIssue, labels: value }
    const model = readCardModel('github_get_issue', block(data))
    assert.equal(model.collections.labels.completeness, expected)
  }
})

test('localized evidence is independent of warning prose and leaves sibling collections complete', () => {
  const empty = { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false } }
  const data = { ...detailedIssue, labels: empty, assignees: empty }
  const model = readCardModel(
    'github_get_issue',
    block(data, {
      truncated: true,
      truncations: [
        { path: 'data.labels', reason: 'A provider-specific localized notice' },
        { path: 'data.body', reason: 'inspection bound' },
      ],
    }),
  )
  assert.equal(model.collections.labels.completeness, 'partial')
  assert.equal(model.collections.assignees.completeness, 'complete')
  assert.ok(
    model.inspection.notices.some(
      (notice) => notice.path === 'data.labels' && notice.kind === 'truncation',
    ),
  )
  for (const extra of [
    { truncated: true },
    { truncations: [{ path: 'data', reason: 'bounded' }] },
  ]) {
    const global = readCardModel('github_get_issue', block(data, extra))
    assert.equal(global.collections.labels.completeness, 'partial')
    assert.equal(global.collections.assignees.completeness, 'partial')
  }
})

test('collection counts, display bounds and REST continuation remain independent contracts', () => {
  const nodes = Array.from({ length: 75 }, (_, index) => ({ id: `I_${index}` }))
  const data = { nodes, totalCount: 75, pageInfo: { hasNextPage: false } }
  const bounded = collectionModel(data, 'data', inspectCollections({ data }, 'github_list_issues'))
  assert.equal(bounded.returnedCount, 75)
  assert.equal(bounded.entries.length, 50)
  assert.equal(bounded.displayLimit, 50)
  assert.equal(bounded.completeness, 'partial')
  const rest = { nodes: [], pageInfo: { page: 2, hasNextPage: false, nextPage: null } }
  const inspection = inspectCollections({ data: rest }, 'github_list_pull_requests')
  assert.equal(collectionModel(rest, 'data', inspection, 'rest').completeness, 'complete')
  assert.equal(collectionModel(rest, 'data', inspection, 'graphql').completeness, 'unknown')
  const next = { nodes: [], pageInfo: { page: 1, hasNextPage: true, nextPage: 2 } }
  const continuing = collectionModel(
    next,
    'data',
    inspectCollections({ data: next }, 'github_list_pull_requests'),
    'rest',
  )
  assert.equal(continuing.completeness, 'partial')
  assert.deepEqual(continuing.continuation, { page: 2 })
  for (const patch of [
    { pageInfo: { page: 0, hasNextPage: false } },
    { pageInfo: { page: -1, hasNextPage: false } },
    { pageInfo: { page: '2', hasNextPage: false } },
    { pageInfo: { page: 2, hasNextPage: false, nextPage: '3' } },
    { pageInfo: { page: 2, hasNextPage: true, nextPage: 4 } },
    { totalCount: -1 },
    { totalCount: '0' },
    { totalCount: 0, nodes: [{ id: 'one' }] },
  ]) {
    const invalid = { ...rest, ...patch }
    const evidence = inspectCollections({ data: invalid }, 'github_list_pull_requests')
    assert.equal(evidence.completeness, 'unknown', JSON.stringify(patch))
    assert.equal(collectionModel(invalid, 'data', evidence, 'rest').completeness, 'unknown')
  }
  const final = { ...connection([{ id: 'one' }], false, 'last-edge'), nextCursor: null }
  const finalModel = collectionModel(
    final,
    'data',
    inspectCollections({ data: final }, 'github_list_issues'),
  )
  assert.equal(finalModel.completeness, 'complete')
  assert.deepEqual(finalModel.continuation, {})
  const graphNext = { ...final, pageInfo: { hasNextPage: true, endCursor: 'next-edge' } }
  assert.deepEqual(
    collectionModel(
      graphNext,
      'data',
      inspectCollections({ data: graphNext }, 'github_list_issues'),
    ).continuation,
    { cursor: 'next-edge' },
  )
})

test('required project and item details remain unknown when their collections are missing', () => {
  for (const [tool, complete, missingKeys] of [
    [
      'github_get_project',
      { id: 'P', title: 'Project', number: 1, fields: connection(), repositories: connection() },
      ['fields', 'repositories'],
    ],
    [
      'github_list_project_items',
      { id: 'ITEM', content: null, fieldValues: connection() },
      ['fieldValues'],
    ],
  ]) {
    assert.equal(readCardModel(tool, block(complete)).completeness, 'complete')
    for (const key of missingKeys) {
      const incomplete = { ...complete }
      delete incomplete[key]
      const model = readCardModel(tool, block(incomplete))
      assert.equal(model.completeness, 'unknown', `${tool}: ${key}`)
      assert.ok(
        model.inspection.notices.some(
          (notice) => notice.kind === 'metadata' && notice.path === `data.${key}`,
        ),
      )
    }
  }
  const items = readCardModel(
    'github_list_project_items',
    block(connection([{ id: 'ITEM', content: null }])),
  )
  assert.equal(items.completeness, 'unknown')
})

test('deep malformed data is bounded and produces an explicit inspection warning', () => {
  let data = {}
  let cursor = data
  for (let i = 0; i < 30; i++) cursor = cursor.next = {}
  assert.ok(
    readWarnings({ data }, 'github_get_issue').some((value) => value.includes('inspection bound')),
  )
})
