import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import { createGitHubRuntime } from '../src/runtime.js'
import { fakeSubprocess, json, connection } from './fixtures.js'
import { project, issue, detailedProject, detailedIssue, projectItem } from './payloads.js'

let registration
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
vm.runInNewContext(source, {
  window: {
    __ModuleLoader__: {
      load(value) {
        registration = value
      },
    },
  },
  URL,
  fetch() {
    throw new Error('Read cards must not fetch')
  },
})
const client = registration.factory((name) => {
  assert.equal(name, 'react')
  return React
})
const block = (data) => ({
  kind: 'tool-result',
  isError: false,
  content: [{ type: 'text', text: JSON.stringify(data) }],
})
const wrap = (data) => ({
  host: 'github.com',
  untrusted: true,
  data,
  truncated: false,
  truncations: [],
})
const tool = (operation) =>
  `github_${operation.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)}`

test('read cards accept actual bounded runtime results for all six tools and single-item continuation', async () => {
  const cases = [
    [
      'listProjects',
      { owner: 'acme' },
      { repositoryOwner: { projectsV2: connection([project], true, 'next-projects') } },
      'projects',
    ],
    [
      'getProject',
      { owner: 'acme', projectNumber: 7 },
      { repositoryOwner: { projectV2: detailedProject } },
      'projects',
    ],
    [
      'listProjectItems',
      { owner: 'acme', projectNumber: 7 },
      { repositoryOwner: { projectV2: { id: 'P_1', items: connection([projectItem]) } } },
      'items',
    ],
    [
      'listProjectItems',
      { owner: 'acme', projectNumber: 7, itemId: 'PI_1' },
      { repositoryOwner: { projectV2: { id: 'P_1' } }, node: projectItem },
      'items',
    ],
    [
      'listIssues',
      { owner: 'acme', repo: 'example' },
      { repository: { issues: connection([issue]) } },
      'issues',
    ],
    [
      'searchIssues',
      { owner: 'acme', repo: 'example', query: 'fixture' },
      { search: { ...connection([issue], true, 'next-search'), issueCount: 1200 } },
      'issues',
    ],
    [
      'getIssue',
      { owner: 'acme', repo: 'example', issueNumber: 33 },
      { repository: { issue: detailedIssue } },
      'issues',
    ],
  ]
  for (const [operation, args, data, kind] of cases) {
    const subprocess = fakeSubprocess([json({ data })])
    const result = await createGitHubRuntime(subprocess)[operation](args, { cwd: '/fixture' })
    const name = tool(operation),
      model = client.readCardModel(name, block(result))
    assert.equal(model.state, 'returned', `${operation}: ${model.error}`)
    assert.equal(model.kind, kind)
    assert.equal(model.entries.length, 1)
    assert.equal(subprocess.specs.length, 1, 'client model adds no GitHub request')
    if (operation === 'getIssue' || operation === 'getProject' || kind === 'items')
      assert.ok(model.warnings.length > 0, 'nested continuation stays visible')
    if (operation === 'searchIssues') {
      assert.equal(model.total, 1200)
      assert.match(model.warnings.join(' '), /1,000|1000/)
      assert.ok(result.truncated)
    }
  }
})
test('filtered empty template pages retain unfiltered counts and continuation evidence', async () => {
  const subprocess = fakeSubprocess([
    json({
      data: {
        repositoryOwner: {
          projectsV2: {
            ...connection([{ ...project, template: false }], true, 'next'),
            totalCount: 20,
          },
        },
      },
    }),
  ])
  const result = await createGitHubRuntime(subprocess).listProjects(
    { owner: 'acme', templateOnly: true },
    { cwd: '/fixture' },
  )
  const model = client.readCardModel('github_list_projects', block(result))
  assert.equal(model.returnedCount, 0)
  assert.equal(model.total, 20)
  assert.equal(model.scannedCount, 1)
  assert.equal(model.templateOnly, true)
  assert.match(model.totalMeaning, /Unfiltered/)
  assert.ok(model.warnings.length > 0)
})
test('nested renderer limits and absent pagination metadata cannot silently look complete', () => {
  const options = Array.from({ length: 75 }, (_, i) => ({ id: `OPTION_${i}`, name: `Option ${i}` }))
  const result = wrap({
    ...project,
    fields: connection([{ id: 'F', name: 'Status', dataType: 'SINGLE_SELECT', options }]),
    repositories: connection([]),
  })
  const warnings = client.readCardModel('github_get_project', block(result)).warnings.join(' ')
  assert.match(warnings, /50|first|not shown|display/i)
  const missing = client.readCardModel('github_list_issues', block(wrap({ nodes: [issue] })))
  assert.ok(
    missing.error ||
      missing.warnings.some((warning) => /unknown|missing|pagination|incomplete/i.test(warning)),
  )
  const nested = wrap({ ...detailedIssue, labels: { nodes: [{ id: 'L', name: 'bug' }] } })
  assert.match(
    client.readCardModel('github_get_issue', block(nested)).warnings.join(' '),
    /unknown|missing|pagination/i,
  )
})
