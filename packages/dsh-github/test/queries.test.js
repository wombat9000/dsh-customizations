import assert from 'node:assert/strict'
import test from 'node:test'
import { QUERIES } from '../src/queries.js'

test('all fixed GraphQL documents are reads with explicit bounded collections', () => {
  assert.equal(Object.keys(QUERIES).length, 11)
  for (const [name, query] of Object.entries(QUERIES)) {
    assert.match(query, /^query\b/, name)
    assert.doesNotMatch(query, /\bmutation\b|\bsubscription\b/, name)
    for (const match of query.matchAll(/\b(repositories|projectsV2|items|fieldValues|labels|assignees|subIssues|blockedBy|blocking|comments|users|pullRequests|reviewers)\(/g)) {
      assert.match(query.slice(match.index), /^[^(]+\(first:\$\w+,after:\$\w+/, `${name}: ${match[1]}`)
    }
  }
  assert.match(QUERIES.getIssue, /parent \{/)
  assert.match(QUERIES.getIssue, /blockedBy\(first:/)
  assert.match(QUERIES.getIssue, /blocking\(first:/)
  assert.match(QUERIES.getProject, /ProjectV2SingleSelectField/)
  assert.match(QUERIES.getProject, /template/)
  assert.match(QUERIES.listProjectItems, /DraftIssue/)
})
