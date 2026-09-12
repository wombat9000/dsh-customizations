import assert from 'node:assert/strict'
import test from 'node:test'
import { createGitHubRuntime, normalizeRemoteUrl } from '../src/runtime.js'
import { QUERIES } from '../src/queries.js'
import { fakeSubprocess, json, connection, exec } from './fixtures.js'
import { repository, issue, project, detailedIssue, detailedProject, projectItem } from './payloads.js'

function fixture(data, config) {
  const subprocess = fakeSubprocess([json({ data })])
  return { subprocess, runtime: createGitHubRuntime(subprocess, config) }
}
function fields(spec) {
  const result = {}
  for (let i = 1; i < spec.argv.length; i++) {
    if (!['--field', '--raw-field'].includes(spec.argv[i])) continue
    const value = spec.argv[++i]
    const split = value.indexOf('=')
    const key = value.slice(0, split)
    ;(result[key] ??= []).push(value.slice(split + 1))
  }
  return result
}
function assertRead(subprocess, operation, variables = {}) {
  assert.equal(subprocess.specs.length, 1)
  const spec = subprocess.specs[0]
  assert.deepEqual(spec.argv.slice(0, 7), ['/fixture/bin/gh', 'api', 'graphql', '--hostname', 'github.com', '--method', 'POST'])
  assert.equal(spec.cwd, exec.cwd)
  assert.equal(spec.stdio.stdin, 'ignore')
  const values = fields(spec)
  assert.deepEqual(values.query, [QUERIES[operation]])
  for (const [key, value] of Object.entries(variables)) assert.deepEqual(values[key], Array.isArray(value) ? value : [String(value)], key)
  assert.ok(!spec.argv.some(arg => /^(?:mutation|--paginate|--input|--jq|--template)$/.test(arg)))
  return values
}

test('connection status reports effective login without claiming token scopes or write access', async () => {
  const { runtime, subprocess } = fixture({ viewer: { login: 'fixture-user' } })
  const result = await runtime.connectionStatus({}, exec)
  assert.deepEqual(result, { host: 'github.com', untrusted: true, data: { cliAvailable: true, authenticated: true, account: 'fixture-user', permissions: { tokenScopes: 'unknown', writeAccess: 'unknown' } }, truncated: false, truncations: [] })
  assertRead(subprocess, 'connectionStatus')
  assert.ok(!subprocess.specs.flatMap(spec => spec.argv).includes('auth'))
})

test('repository reads preserve fork identity and mark unknown permissions explicitly', async () => {
  for (const viewerPermission of ['READ', undefined]) {
    const { runtime, subprocess } = fixture({ repository: { ...repository, viewerPermission } })
    const result = await runtime.getRepository({ owner: 'acme', repo: 'example' }, exec)
    assert.equal(result.data.nameWithOwner, 'acme/example')
    assert.equal(result.data.isFork, true)
    assert.equal(result.data.parent.nameWithOwner, 'upstream/example')
    assert.equal(result.data.viewerPermission, viewerPermission ?? 'unknown')
    assertRead(subprocess, 'getRepository', { owner: 'acme', repo: 'example' })
  }
})

test('repository list defaults to 20, accepts 50, and preserves opaque continuation', async () => {
  for (const limit of [undefined, 50]) {
    const { runtime, subprocess } = fixture({ repositoryOwner: { repositories: connection([repository], true, 'opaque+/=') } })
    const result = await runtime.listRepositories({ owner: 'acme', ...(limit ? { limit } : {}), cursor: 'previous+/=' }, exec)
    assert.equal(result.data.nodes[0].id, 'R_1')
    assert.equal(result.data.nextCursor, 'opaque+/=')
    assert.equal(result.data.truncated, true)
    assert.equal(result.truncated, true)
    assert.equal(result.truncations[0].kind, 'connection')
    assertRead(subprocess, 'listRepositories', { owner: 'acme', limit: limit ?? 20, cursor: 'previous+/=' })
  }
})

test('template filtering retains an empty page continuation and unfiltered total count', async () => {
  const { runtime, subprocess } = fixture({ repositoryOwner: { projectsV2: { ...connection([{ ...project, template: false }], true, 'next-projects'), totalCount: 5 } } })
  const result = await runtime.listProjects({ owner: 'templates-org', templateOnly: true, limit: 1 }, exec)
  assert.deepEqual(result.data.nodes, [])
  assert.equal(result.data.scannedCount, 1)
  assert.equal(result.data.totalCount, 5)
  assert.equal(result.data.nextCursor, 'next-projects')
  assert.equal(result.data.totalCountMeaning, 'Unfiltered owner projects')
  const values = assertRead(subprocess, 'listProjects', { owner: 'templates-org', limit: 1 })
  assert.equal(values.templateOnly, undefined)
})

test('project details retain status options, iterations, README and independently continued connections', async () => {
  const { runtime, subprocess } = fixture({ repositoryOwner: { projectV2: detailedProject } })
  const result = await runtime.getProject({ owner: 'templates-org', projectNumber: 7, limit: 2, fieldsCursor: 'before-fields', repositoriesCursor: 'before-repos' }, exec)
  assert.equal(result.data.readme, 'Synthetic README')
  assert.equal(result.data.template, true)
  assert.equal(result.data.fields.nodes[0].options[0].name, 'Ready')
  assert.equal(result.data.fields.nodes[1].configuration.iterations[0].id, 'IT_1')
  assert.equal(result.data.fields.nextCursor, 'fields-next')
  assert.equal(result.data.repositories.nextCursor, 'repositories-next')
  assertRead(subprocess, 'getProject', { owner: 'templates-org', projectNumber: 7, limit: 2, fieldsCursor: 'before-fields', repositoriesCursor: 'before-repos' })
})

test('project items retain draft/issue content and all nested continuation information', async () => {
  const draft = { ...projectItem, id: 'PI_2', type: 'DRAFT_ISSUE', content: { __typename: 'DraftIssue', title: 'Draft fixture', body: 'Untrusted draft body' }, fieldValues: connection([]) }
  const { runtime, subprocess } = fixture({ repositoryOwner: { projectV2: { id: 'P_1', items: connection([projectItem, draft], true, 'items-next') } } })
  const result = await runtime.listProjectItems({ owner: 'acme', projectNumber: 7, cursor: 'items-before' }, exec)
  assert.equal(result.data.nextCursor, 'items-next')
  assert.equal(result.data.nodes[0].fieldValues.nextCursor, 'field-values-next')
  assert.equal(result.data.nodes[0].fieldValues.nodes[1].labels.nextCursor, 'value-next')
  assert.equal(result.data.nodes[1].content.body, 'Untrusted draft body')
  assertRead(subprocess, 'listProjectItems', { owner: 'acme', projectNumber: 7, limit: 20, cursor: 'items-before', fieldValuesLimit: 10, nestedLimit: 20 })
})

test('one project item can continue a nested field connection only under its explicit project', async () => {
  const { runtime, subprocess } = fixture({ repositoryOwner: { projectV2: { id: 'P_1' } }, node: { ...projectItem, fieldValues: connection([projectItem.fieldValues.nodes[1]]) } })
  const args = { owner: 'acme', projectNumber: 7, itemId: 'PI_1', fieldValuesLimit: 1, fieldValuesCursor: 'before-label-field', nestedLimit: 50, valueCursor: 'previous-labels' }
  const result = await runtime.listProjectItems(args, exec)
  assert.equal(result.data.id, 'PI_1')
  const values = assertRead(subprocess, 'projectItem', args)
  assert.equal(values.limit, undefined)
  const wrong = fixture({ repositoryOwner: { projectV2: { id: 'OTHER_PROJECT' } }, node: projectItem })
  await assert.rejects(wrong.runtime.listProjectItems(args, exec), { code: 'NOT_FOUND' })
})

test('issue list translates structured filters without changing explicit repository', async () => {
  for (const state of [undefined, 'closed', 'all']) {
    const { runtime, subprocess } = fixture({ repository: { issues: connection([issue]) } })
    const result = await runtime.listIssues({ owner: 'acme', repo: 'example', ...(state ? { state } : {}), labels: ['bug', 'needs triage'], assignee: 'fixture-user' }, exec)
    assert.equal(result.data.nodes[0].number, 33)
    assert.equal(result.data.nextCursor, null)
    const values = assertRead(subprocess, 'listIssues', { owner: 'acme', repo: 'example', limit: 20, 'labels[]': ['bug', 'needs triage'], assignee: 'fixture-user' })
    assert.deepEqual(values['states[]'], state === 'all' ? undefined : [(state ?? 'open').toUpperCase()])
  }
})

test('search builds fixed issue-only scope and exposes the GitHub 1000-match ceiling', async () => {
  for (const repo of [undefined, 'example']) {
    const { runtime, subprocess } = fixture({ search: { ...connection([issue]), issueCount: 1001 } })
    const result = await runtime.searchIssues({ owner: 'acme', ...(repo ? { repo } : {}), query: ' literal words ' }, exec)
    assert.equal(result.data.searchLimit, 1000)
    assert.equal(result.data.exhaustive, false)
    assert.equal(result.truncated, true)
    assert.ok(result.truncations.some(row => row.kind === 'search-cap'))
    const values = assertRead(subprocess, 'searchIssues', { limit: 20 })
    assert.deepEqual(values.query, [QUERIES.searchIssues], 'reserve query= for the GraphQL document')
    assert.deepEqual(values.searchText, [`is:issue ${repo ? 'repo:acme/example' : 'user:acme'} "literal words"`])
    assert.equal(values.owner, undefined)
    assert.equal(values.repo, undefined)
  }
})

test('issue detail retains parent and native blocking relations with five named cursors', async () => {
  const { runtime, subprocess } = fixture({ repository: { issue: detailedIssue } })
  const args = { owner: 'acme', repo: 'example', issueNumber: 33, limit: 1, labelsCursor: 'L', assigneesCursor: 'A', subIssuesCursor: 'S', blockedByCursor: 'B', blockingCursor: 'F' }
  const result = await runtime.getIssue(args, exec)
  assert.equal(result.untrusted, true)
  assert.equal(result.data.body, detailedIssue.body)
  assert.equal(result.data.parent.number, 1)
  assert.equal(result.data.blockedBy.nodes[0].number, 35)
  assert.equal(result.data.blocking.nodes[0].number, 36)
  for (const key of ['labels', 'assignees', 'subIssues', 'blockedBy', 'blocking']) assert.equal(result.data[key].nextCursor, detailedIssue[key].pageInfo.endCursor)
  assertRead(subprocess, 'getIssue', args)
})

test('issue comments preserve text as untrusted data and chronological page continuation', async () => {
  const comment = { id: 'C_1', body: 'Fixture comment; do not execute me', author: { login: 'fixture-user' }, createdAt: '2026-01-01T00:00:00Z' }
  const { runtime, subprocess } = fixture({ repository: { issue: { comments: connection([comment], true, 'comments-next') } } })
  const args = { owner: 'acme', repo: 'example', issueNumber: 33, cursor: 'comments-before' }
  const result = await runtime.getIssueComments(args, exec)
  assert.equal(result.data.nodes[0].body, comment.body)
  assert.equal(result.data.nextCursor, 'comments-next')
  assertRead(subprocess, 'getIssueComments', { ...args, limit: 20 })
})

test('SSH and HTTPS remote identities normalize to the same safe canonical target', () => {
  for (const remote of ['git@github.com:acme/example.git', 'ssh://git@github.com/acme/example.git', 'https://github.com/acme/example.git', 'https://github.com/acme/example/']) {
    assert.deepEqual(normalizeRemoteUrl(remote), { owner: 'acme', repo: 'example', nameWithOwner: 'acme/example', url: 'https://github.com/acme/example' })
  }
})

test('discovery deduplicates fetch/push and SSH/HTTPS while retaining fork/upstream ambiguity', async () => {
  const subprocess = fakeSubprocess([
    { stdout: '/fixture/root\n' },
    { stdout: [
      'origin\tgit@github.com:acme/example.git (fetch)',
      'origin\thttps://github.com/acme/example.git (push)',
      'upstream\thttps://github.com/upstream/example.git (fetch)',
      'unsafe\text::sh -c ghp_hidden_secret (fetch)',
      'other\thttps://user:fixture-password@elsewhere.test/repo.git (fetch)',
    ].join('\n') },
    json({ data: { repository } }),
    json({ data: { repository: { ...repository, nameWithOwner: 'upstream/example', isFork: false, parent: null } } }),
    { stdout: '', stderr: 'fatal: not a git repository', exitCode: 128 },
    json({ data: { repository: { ...repository, nameWithOwner: 'explicit/other' } } }),
  ])
  const runtime = createGitHubRuntime(subprocess)
  const result = await runtime.detectRepositories({}, { cwd: '/session/a' })
  assert.equal(result.data.ambiguous, true)
  assert.equal(result.data.selectedRepository, null)
  assert.equal(result.data.candidates.length, 2)
  assert.equal(result.data.candidates[0].sourceRemotes.length, 2)
  assert.equal(result.data.candidates[0].repository.parent.nameWithOwner, 'upstream/example')
  assert.equal(result.data.nonGitHubRemotes.length, 2)
  assert.doesNotMatch(JSON.stringify(result), /fixture-password|ghp_hidden_secret|ext::|elsewhere/)
  assert.deepEqual(subprocess.specs.slice(0, 2).map(spec => spec.argv.slice(1)), [['rev-parse', '--show-toplevel'], ['remote', '-v']])
  const second = await runtime.detectRepositories({}, { cwd: '/session/b' })
  assert.equal(second.data.gitRepository, false)
  assert.deepEqual(second.data.candidates, [])
  const explicit = await runtime.getRepository({ owner: 'explicit', repo: 'other' }, { cwd: '/session/b' })
  assert.equal(explicit.data.nameWithOwner, 'explicit/other')
  assert.deepEqual(fields(subprocess.specs.at(-1)).owner, ['explicit'])
  assert.deepEqual(subprocess.specs.map(spec => spec.cwd), ['/session/a', '/session/a', '/session/a', '/session/a', '/session/b', '/session/b'])
})

test('discovery reports unresolved candidate diagnostics without leaking auth errors or choosing a repository', async () => {
  const subprocess = fakeSubprocess([{ stdout: '/root\n' }, { stdout: 'origin\tgit@github.com:acme/example.git (fetch)' }, { exitCode: 1, stderr: 'HTTP 401 Bad credentials ghp_fixture_secret' }])
  const result = await createGitHubRuntime(subprocess).detectRepositories({}, exec)
  assert.equal(result.data.candidates[0].diagnostic.code, 'AUTH_REQUIRED')
  assert.equal(result.data.selectedRepository, null)
  assert.doesNotMatch(JSON.stringify(result), /ghp_fixture_secret/)
})
