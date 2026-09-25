import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { issue, project, detailedIssue, detailedProject, projectItem } from './payloads.js'
import { connection } from './fixtures.js'
let record
vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
  window: {
    __ModuleLoader__: {
      load(value) {
        record = value
      },
    },
  },
  URL,
})
const { readCardModel, readWarnings } = record.factory(() => ({}))
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

test('six actual payload shapes render supplied identities without network access', () => {
  for (const [tool, data, kind] of [
    ['github_list_projects', connection([project]), 'projects'],
    ['github_get_project', detailedProject, 'projects'],
    ['github_list_project_items', connection([projectItem]), 'items'],
    ['github_list_issues', connection([issue]), 'issues'],
    [
      'github_search_issues',
      { ...connection([issue]), issueCount: 1, searchLimit: 1000, exhaustive: true },
      'issues',
    ],
    ['github_get_issue', detailedIssue, 'issues'],
  ]) {
    const model = readCardModel(tool, block(data))
    assert.equal(model.state, 'returned', tool)
    assert.equal(model.kind, kind)
    assert.equal(model.returnedCount, 1)
  }
})
test('single project item continuation retains nested pagination warning', () => {
  const model = readCardModel('github_list_project_items', block(projectItem))
  assert.equal(model.singular, true)
  assert.equal(model.entries[0].id, 'PI_1')
  assert.ok(model.warnings.some((value) => value.includes('fieldValues.nodes[1].labels')))
})
test('empty template page preserves scanned/unfiltered counts and continuation', () => {
  const model = readCardModel(
    'github_list_projects',
    block({
      ...connection([], true, 'next'),
      totalCount: 100,
      scannedCount: 20,
      templateOnly: true,
      totalCountMeaning: 'Unfiltered owner projects',
    }),
  )
  assert.equal(model.returnedCount, 0)
  assert.equal(model.total, 100)
  assert.equal(model.scannedCount, 20)
  assert.equal(model.templateOnly, true)
  assert.equal(model.totalMeaning, 'Unfiltered owner projects')
  assert.ok(model.warnings.length)
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
  const warnings = readWarnings({ data }, 'github_get_project')
  assert.ok(warnings.some((value) => value.includes('options') && value.includes('50')))
  assert.ok(warnings.some((value) => value.includes('repositories.nodes') && value.includes('50')))
  assert.ok(warnings.some((value) => value.includes('metadata') && value.includes('unknown')))
})
test('deep malformed data is bounded and produces an explicit inspection warning', () => {
  let data = {}
  let cursor = data
  for (let i = 0; i < 30; i++) cursor = cursor.next = {}
  assert.ok(
    readWarnings({ data }, 'github_get_issue').some((value) => value.includes('inspection bound')),
  )
})
