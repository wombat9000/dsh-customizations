import assert from 'node:assert/strict'
import test from 'node:test'
import { QUERIES } from '../dist/src/queries.js'

test('all fixed GraphQL documents are reads with explicit bounded collections', () => {
  const expectedConnections = {
    connectionStatus: [],
    getRepository: [],
    listRepositories: ['repositories'],
    listProjects: ['projectsV2'],
    getProject: ['fields', 'repositories'],
    listProjectItems: ['items', 'fieldValues', 'labels', 'users', 'pullRequests', 'reviewers'],
    projectItem: ['fieldValues', 'labels', 'users', 'pullRequests', 'reviewers'],
    listIssues: ['issues', 'assignees'],
    searchIssues: ['search'],
    getIssue: ['labels', 'assignees', 'subIssues', 'blockedBy', 'blocking'],
    getIssueComments: ['comments'],
  }
  assert.deepEqual(Object.keys(QUERIES).sort(), Object.keys(expectedConnections).sort())
  for (const [name, query] of Object.entries(QUERIES)) {
    const seen = new Set()
    assert.match(query, /^query\b/, name)
    assert.doesNotMatch(query, /\bmutation\b|\bsubscription\b/, name)
    for (const match of query.matchAll(
      /\b(repositories|projectsV2|items|fields|fieldValues|issues|search|labels|assignees|subIssues|blockedBy|blocking|comments|users|pullRequests|reviewers)\s*(\([^)]*\))?\s*\{/g,
    )) {
      seen.add(match[1])
      if (name === 'listIssues' && match[1] === 'assignees') {
        assert.match(
          query.slice(match.index),
          /^assignees\(first:20\) \{ nodes \{ login \} totalCount pageInfo \{ hasNextPage endCursor \}/,
        )
        continue
      }
      const arguments_ = match[2] ?? ''
      assert.match(arguments_, /\bfirst:\$\w+\b/, `${name}: ${match[1]} must be bounded`)
      assert.match(arguments_, /\bafter:\$\w+\b/, `${name}: ${match[1]} must support paging`)
    }
    assert.deepEqual(
      [...seen].sort(),
      expectedConnections[name].toSorted(),
      `${name}: required connections`,
    )
  }
  assert.match(QUERIES.getIssue, /parent \{/)
  assert.match(QUERIES.getIssue, /blockedBy\(first:/)
  assert.match(QUERIES.getIssue, /blocking\(first:/)
  assert.match(QUERIES.getProject, /ProjectV2SingleSelectField/)
  assert.match(QUERIES.getProject, /template/)
  assert.match(QUERIES.listProjectItems, /DraftIssue/)
})
