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
test('deep malformed data is bounded and produces an explicit inspection warning', () => {
  let data = {}
  let cursor = data
  for (let i = 0; i < 30; i++) cursor = cursor.next = {}
  assert.ok(
    readWarnings({ data }, 'github_get_issue').some((value) => value.includes('inspection bound')),
  )
})
