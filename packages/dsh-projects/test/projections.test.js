import assert from 'node:assert/strict'
import test from 'node:test'
import { issuesPage, safeUrl } from '../dist/src/projections.js'
import { sources, github, linear, connection } from './fixtures.js'
const request = { projectId: 'app', sourceId: 'board' }
const issue = {
  id: 'I1',
  number: 12,
  title: 'Untrusted <script> text',
  state: 'CLOSED',
  url: 'https://github.com/acme/app/issues/12',
  repository: { nameWithOwner: 'acme/app' },
  assignees: connection([{ login: 'ada' }]),
}

test('native issue state remains distinct from board status, zero fields, PR state and drafts', () => {
  const items = [
    {
      id: 'item-1',
      content: issue,
      fieldValues: connection([
        { field: { name: 'Status' }, name: 'In progress' },
        { field: { name: 'Estimate' }, number: 0 },
      ]),
    },
    {
      id: 'item-2',
      content: { ...issue, id: 'PR1', __typename: 'PullRequest', state: 'MERGED' },
      fieldValues: connection(),
    },
    {
      id: 'item-3',
      type: 'DRAFT_ISSUE',
      content: { __typename: 'DraftIssue', title: 'Draft' },
      isArchived: true,
      fieldValues: connection(),
    },
    { id: 'item-4', content: null, fieldValues: connection() },
  ]
  const page = issuesPage(sources[1], request, github(items))
  assert.equal(page.issues[0].status, 'CLOSED')
  assert.deepEqual(page.issues[0].boardFields, ['Status: In progress', 'Estimate: 0'])
  assert.deepEqual(page.issues[0].assignees, ['ada'])
  assert.equal(page.issues[0].identifier, 'acme/app#12')
  assert.equal(page.issues[0].title, issue.title)
  assert.equal(page.issues[1].kind, 'pull-request')
  assert.equal(page.issues[1].status, 'MERGED')
  assert.equal(page.issues[2].kind, 'draft')
  assert.equal(page.issues[2].status, 'Draft')
  assert.deepEqual(page.issues[2].boardFields, ['Archived project item'])
  assert.match(page.warnings.join(' '), /unavailable or redacted/)
  assert.equal(page.untrusted, true)
})

test('board summaries preserve native issue fields, multi-selects, relations and explicit omissions', () => {
  const field = (name, value) => ({ field: { name }, ...value })
  const fields = [
    field('Issue status', {
      issueFieldValue: { __typename: 'IssueFieldSingleSelectValue', name: 'Review' },
    }),
    field('Tags', { value: ['alpha', 'beta'] }),
    field('Milestone', { milestone: { title: 'Release' } }),
    field('Repository', { repository: { nameWithOwner: 'acme/app' } }),
    field('Text', { text: '' }),
    field('Date', { date: null }),
    field('Future field', { unknown: 'hidden' }),
  ]
  const page = issuesPage(
    sources[1],
    request,
    github([{ id: 'item', content: issue, fieldValues: connection(fields) }]),
  )
  assert.deepEqual(page.issues[0].boardFields, [
    'Issue status: Review',
    'Tags: alpha, beta',
    'Milestone: Release',
    'Repository: acme/app',
    'Text: Empty string',
    'Date: Not set',
    'Future field: Not summarized',
  ])
  assert.equal(page.issues[0].status, 'CLOSED')
  assert.match(page.warnings.join(' '), /not summarized/)
})

test('outer paging, nested connection warnings and provider truncations remain visible', () => {
  const nested = { ...issue, assignees: connection([{ login: 'ada' }], true, 'assignees-next') }
  const page = issuesPage(sources[0], request, github([nested]))
  assert.equal(page.hasNextPage, false)
  assert.equal(page.nextCursor, undefined)
  assert.match(page.warnings.join(' '), /partial/)
  const paged = issuesPage(
    sources[0],
    request,
    github([], {
      data: { ...connection([], true, 'outer-next'), nextCursor: 'outer-next' },
      truncated: true,
      truncations: [{ path: 'data', kind: 'connection' }],
    }),
  )
  assert.equal(paged.nextCursor, 'outer-next')
  assert.equal(paged.hasNextPage, true)
  assert.equal(paged.warnings.length, 2)
})

test('Linear status, priority and assignee use native projected fields', () => {
  const response = linear([
    {
      id: 'L1',
      identifier: 'ENG-1',
      title: 'Issue',
      url: 'https://linear.app/acme/issue/ENG-1',
      state: { name: 'Blocked' },
      priorityLabel: 'Urgent',
      assignee: { name: 'Ada', displayName: 'ada' },
    },
  ])
  response.pageInfo = { hasNextPage: true, nextCursor: 'linear-next' }
  const page = issuesPage(sources[2], request, response)
  assert.equal(page.issues[0].status, 'Blocked')
  assert.equal(page.issues[0].priority, 'Urgent')
  assert.deepEqual(page.issues[0].assignees, ['ada'])
  assert.equal(page.issues[0].boardFields, undefined)
  assert.equal(page.nextCursor, 'linear-next')
  assert.match(page.warnings.join(' '), /partial/)
})

test('unsupported page shapes and missing continuation cursors fail closed', () => {
  for (const value of [
    null,
    {},
    github([], { data: {} }),
    github([], { data: { nodes: [], pageInfo: { hasNextPage: true } } }),
    github(Array.from({ length: 51 }, () => issue)),
  ])
    assert.throws(() => issuesPage(sources[0], request, value), { code: 'response' })
  for (const url of [
    'javascript:alert(1)',
    'http://github.com/acme',
    'https://github.com.evil.test',
    'https://user:pass@github.com/acme',
    'https://github.com:999/acme',
    'https://linear.app/acme',
  ])
    assert.equal(safeUrl(url, 'github'), undefined)
  const result = issuesPage(sources[0], request, github([{ ...issue, url: 'javascript:alert(1)' }]))
  assert.equal(result.issues[0].url, undefined)
})
