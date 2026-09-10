import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LinearRuntime,
  publicLinearError,
  resolveCycle,
  resolveLabels,
  resolveProject,
  resolveStates,
  resolveTeam,
  resolveUser,
} from '../src/linear.js'
import { apiKeyFailure, registerLinearSettingsRpc } from '../src/settings.js'
import { registerLinearTools } from '../src/index.js'

function page(nodes, options = {}) {
  return {
    nodes,
    totalCount: options.totalCount,
    pageInfo: {
      hasNextPage: options.hasNextPage === true,
      hasPreviousPage: false,
      startCursor: nodes.length === 0 ? null : 'start',
      endCursor: options.hasNextPage === true ? 'next-page' : null,
    },
  }
}

function issue(overrides = {}) {
  return {
    id: 'issue-id', identifier: 'ENG-123', title: 'Fix the bug', description: 'Details',
    url: 'https://linear.app/acme/issue/ENG-123', priority: 2, priorityLabel: 'High',
    teamId: 'team-id', stateId: 'state-id', assigneeId: 'user-id',
    projectId: 'project-id', cycleId: 'cycle-id', labelIds: ['label-id'],
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  }
}

const team = { id: 'team-id', key: 'ENG', name: 'Engineering', private: false }
const state = { id: 'state-id', name: 'In Progress', type: 'started', color: '#00f' }
const user = {
  id: 'user-id', name: 'Ada Lovelace', displayName: 'Ada', email: 'ada@example.com',
  active: true, isMe: true, url: 'https://linear.app/acme/settings/members/ada',
}
const project = {
  id: 'project-id', slugId: 'platform', name: 'Platform', description: 'Platform work',
  content: 'Detailed project content', url: 'https://linear.app/acme/project/platform',
  priority: 2, priorityLabel: 'High', progress: 0.5, state: 'started',
  leadId: 'user-id', statusId: 'status-id', createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}
const cycle = {
  id: 'cycle-id', number: 12, name: 'Cycle 12', description: 'Current cycle', teamId: 'team-id',
  isActive: true, isFuture: false, isPast: false, isPrevious: false, isNext: false,
  progress: 0.4, startsAt: new Date('2026-01-01T00:00:00Z'),
  endsAt: new Date('2026-01-14T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z'),
}
const label = { id: 'label-id', name: 'bug', color: '#f00', description: 'Defect' }
const status = { id: 'status-id', name: 'In progress', type: 'started' }

function runtimeWith(client, settings = {}) {
  return new LinearRuntime({
    resolveApiKey: async () => 'lin_api_test',
    settings: () => ({ organizationId: 'org-id', organizationName: 'Acme', ...settings }),
    createClient: () => client,
  })
}

function catalogClient(overrides = {}) {
  return {
    organization: Promise.resolve({ id: 'org-id', name: 'Acme', urlKey: 'acme' }),
    teams: async () => page([team]),
    workflowStates: async () => page([state]),
    users: async () => page([user]),
    projects: async () => page([project]),
    cycles: async () => page([cycle]),
    issueLabels: async () => page([label]),
    projectStatuses: async () => page([status]),
    ...overrides,
  }
}

test('API key validation rejects shell-style and wrapped values', () => {
  assert.equal(apiKeyFailure('lin_api_valid'), undefined)
  assert.match(apiKeyFailure('  '), /Enter a Linear API key/)
  assert.match(apiKeyFailure('LINEAR_API_KEY=secret'), /Paste only the API key/)
  assert.match(apiKeyFailure('"secret"'), /Paste only the API key/)
  assert.match(apiKeyFailure('secret\nvalue'), /printable characters only/)
})

test('runtime enforces the bound workspace before reads', async () => {
  const runtime = runtimeWith({ organization: Promise.resolve({ id: 'other', name: 'Other', urlKey: 'other' }) })
  await assert.rejects(runtime.getIssue({ issue: 'ENG-123' }), /workspace mismatch/i)
})

test('rate-limit errors expose retry diagnostics without query details', () => {
  const source = Object.assign(new Error('raw failure'), {
    type: 'Ratelimited', status: 429, retryAfter: 30, requestsRemaining: 0,
    requestsResetAt: 1_800_000_000, query: 'secret query', variables: { token: 'secret' },
  })
  const result = publicLinearError(source, 'list issues')
  assert.match(result.message, /retry after 30 second/)
  assert.match(result.message, /0 request/)
  assert.doesNotMatch(result.message, /secret/)
})

test('search paginates and joins issue metadata without lazy relation reads', async () => {
  let relationReads = 0
  const found = issue()
  for (const key of ['state', 'team', 'assignee', 'project', 'cycle']) {
    Object.defineProperty(found, key, { get() { relationReads += 1; return Promise.resolve(undefined) } })
  }
  let searchVariables
  const client = catalogClient({
    async searchIssues(term, variables) {
      assert.equal(term, 'timeout')
      searchVariables = variables
      return page([found], { totalCount: 3, hasNextPage: true })
    },
  })
  const result = await runtimeWith(client).searchIssues({ query: 'timeout', limit: 5, cursor: 'cursor-1' })
  assert.deepEqual(searchVariables, { first: 5, after: 'cursor-1', includeArchived: false })
  assert.equal(relationReads, 0)
  assert.equal(result.issues[0].state.name, 'In Progress')
  assert.equal(result.issues[0].project.name, 'Platform')
  assert.equal(result.issues[0].labels[0].name, 'bug')
  assert.deepEqual(result.pageInfo, { hasNextPage: true, nextCursor: 'next-page' })
})

test('state type selectors resolve every match without invalid ID comparisons', async () => {
  const review = { id: 'review-state', name: 'In Review', type: 'started', color: '#0ff' }
  let filter
  const client = {
    async workflowStates(variables) { filter = variables.filter; return page([state, review]) },
  }
  const result = await resolveStates(client, ['started'], team)
  assert.deepEqual(result.map((item) => item.id), ['state-id', 'review-state'])
  assert.equal(filter.or.some((branch) => branch.id !== undefined), false)
})

test('human-readable selectors never enter UUID-only Linear comparators', async () => {
  const filters = {}
  const client = {
    viewer: Promise.resolve(user),
    async teams(variables) { filters.team = variables.filter; return page([team]) },
    async users(variables) { filters.user = variables.filter; return page([user]) },
    async projects(variables) {
      filters.project = variables.filter
      return page([{ ...project, name: 'HIPAA Documentation' }])
    },
    async cycles(variables) { filters.cycle = variables.filter; return page([cycle]) },
    async issueLabels(variables) { filters.labels = variables.filter; return page([label]) },
  }
  await resolveTeam(client, 'ENG')
  await resolveUser(client, 'ada@example.com')
  await resolveProject(client, 'HIPAA Documentation')
  await resolveCycle(client, 'Cycle 12')
  await resolveLabels(client, ['bug'])

  for (const filter of Object.values(filters)) {
    assert.equal(filter.or.some((branch) => branch.id !== undefined), false)
  }
})

test('UUID selectors retain direct ID resolution', async () => {
  const id = 'a0d90dbe-8e47-4f89-a258-12ad9fd06d21'
  let filter
  const candidate = { ...project, id }
  const client = {
    async projects(variables) { filter = variables.filter; return page([candidate]) },
  }
  assert.equal((await resolveProject(client, id)).id, id)
  assert.deepEqual(filter.or[0], { id: { eq: id } })
})

test('API project slug IDs resolve exactly', async () => {
  const candidate = { ...project, slugId: 'ee9c1f68d8e1' }
  let filter
  const client = {
    async projects(variables) { filter = variables.filter; return page([candidate]) },
  }
  assert.equal((await resolveProject(client, candidate.slugId)).id, candidate.id)
  assert.deepEqual(filter.or[0], { slugId: { eq: candidate.slugId } })
})

test('full project URLs and overview URLs resolve by canonical browser slug', async () => {
  const browserSlug = 'hipaa-documentation-ee9c1f68d8e1'
  const candidate = {
    ...project,
    id: 'a0d90dbe-8e47-4f89-a258-12ad9fd06d21',
    slugId: 'ee9c1f68d8e1',
    name: 'HIPAA Documentation',
    url: `https://linear.app/relational-life-tech/project/${browserSlug}`,
  }
  const filters = []
  const client = {
    async projects(variables) { filters.push(variables.filter); return page([candidate]) },
  }
  const options = { organizationUrlKey: 'relational-life-tech' }
  const baseUrl = candidate.url
  assert.equal((await resolveProject(client, baseUrl, options)).id, candidate.id)
  assert.equal((await resolveProject(client, `${baseUrl}/overview`, options)).id, candidate.id)
  for (const filter of filters) {
    assert.equal(filter.or.some((branch) => branch.slugId?.eq === candidate.slugId), true)
  }
})

test('browser-visible project slugs fall back to the SDK URL-slug lookup', async () => {
  const browserSlug = 'hipaa-documentation-ee9c1f68d8e1'
  const candidate = {
    ...project,
    slugId: 'ee9c1f68d8e1',
    name: 'HIPAA Documentation',
    url: `https://linear.app/relational-life-tech/project/${browserSlug}`,
  }
  let directSelector
  const client = {
    async projects() { return page([]) },
    async project(selector) { directSelector = selector; return candidate },
  }
  assert.equal((await resolveProject(client, browserSlug)).id, candidate.id)
  assert.equal(directSelector, browserSlug)
})

test('project URL validation rejects malformed paths and other workspaces before lookup', async () => {
  let calls = 0
  const client = {
    async projects() { calls += 1; return page([]) },
    async project() { calls += 1; return project },
  }
  await assert.rejects(
    resolveProject(client, 'https://linear.app/relational-life-tech/issue/ENG-123', { organizationUrlKey: 'relational-life-tech' }),
    /must contain.*project.*project-slug/iu,
  )
  await assert.rejects(
    resolveProject(client, 'https://linear.app/other-workspace/project/platform/overview', { organizationUrlKey: 'relational-life-tech' }),
    /belongs to workspace.*other-workspace.*connected workspace.*relational-life-tech/iu,
  )
  await assert.rejects(
    resolveProject(client, 'https://example.com/relational-life-tech/project/platform', { organizationUrlKey: 'relational-life-tech' }),
    /must use https:\/\/linear\.app/iu,
  )
  assert.equal(calls, 0)
})

test('project resolution reports ambiguous exact names', async () => {
  const client = {
    async projects() {
      return page([
        { ...project, id: 'project-one' },
        { ...project, id: 'project-two' },
      ])
    },
  }
  await assert.rejects(resolveProject(client, 'Platform'), /project is ambiguous.*Platform/iu)
})

test('browser-slug fallback can recover while persistent validation errors remain visible', async () => {
  const validation = Object.assign(new Error('Argument Validation Error'), { type: 'GraphQL' })
  const browserSlug = 'hipaa-documentation-ee9c1f68d8e1'
  const candidate = {
    ...project,
    slugId: 'ee9c1f68d8e1',
    url: `https://linear.app/relational-life-tech/project/${browserSlug}`,
  }
  const recovered = await resolveProject({
    async projects() { throw validation },
    async project() { return candidate },
  }, browserSlug)
  assert.equal(recovered.id, candidate.id)

  await assert.rejects(resolveProject({
    async projects() { throw validation },
    async project() { throw new Error('Entity not found') },
  }, browserSlug), (error) => error === validation)
})

test('structured issue listing resolves selectors and sends one filtered query', async () => {
  let issueVariables
  const client = catalogClient({
    viewer: Promise.resolve(user),
    async issues(variables) {
      issueVariables = variables
      return page([issue()], { hasNextPage: true })
    },
  })
  const result = await runtimeWith(client).listIssues({
    team: 'ENG', states: ['In Progress'], assignee: 'me', priorities: [1, 2],
    project: `${project.url}/overview`, cycle: 'current', labels: ['bug'],
    updatedAfter: '2026-01-01', createdAfter: '2025-12-01',
    includeArchived: false, orderBy: 'updatedAt', limit: 25, cursor: 'cursor-1',
  })
  assert.deepEqual(issueVariables, {
    first: 25,
    after: 'cursor-1',
    filter: {
      team: { id: { eq: 'team-id' } },
      state: { id: { in: ['state-id'] } },
      assignee: { id: { eq: 'user-id' } },
      priority: { in: [1, 2] },
      project: { id: { eq: 'project-id' } },
      cycle: { id: { eq: 'cycle-id' } },
      labels: { some: { id: { in: ['label-id'] } } },
      updatedAt: { gte: '2026-01-01T00:00:00.000Z' },
      createdAt: { gte: '2025-12-01T00:00:00.000Z' },
    },
    includeArchived: false,
    orderBy: 'updatedAt',
  })
  assert.equal(result.issues[0].description, undefined)
  assert.equal(result.issues[0].assignee.name, 'Ada Lovelace')
  assert.equal(result.pageInfo.nextCursor, 'next-page')
})

test('structured issue listing supports unassigned and missing relation filters', async () => {
  let issueVariables
  const client = catalogClient({
    async issues(variables) { issueVariables = variables; return page([]) },
  })
  const result = await runtimeWith(client).listIssues({
    assignee: 'unassigned', project: 'none', cycle: 'none', limit: 10,
  })
  assert.deepEqual(issueVariables.filter, {
    assignee: { null: true }, project: { null: true }, cycle: { null: true },
  })
  assert.deepEqual(result.pageInfo, { hasNextPage: false })
})

test('issue comments paginate and batch-join authors', async () => {
  let commentVariables
  const comment = {
    id: 'comment-id', body: 'Investigating.', url: 'https://linear.app/comment/comment-id',
    issueId: 'issue-id', userId: 'user-id', createdAt: new Date('2026-01-03T00:00:00Z'),
    updatedAt: new Date('2026-01-03T00:00:00Z'),
  }
  const found = issue({
    async comments(variables) {
      commentVariables = variables
      return page([comment], { hasNextPage: true })
    },
  })
  const client = catalogClient({ async issue() { return found } })
  const result = await runtimeWith(client).getIssueComments({ issue: 'ENG-123', limit: 10, cursor: 'comments-1' })
  assert.deepEqual(commentVariables, {
    first: 10, after: 'comments-1', includeArchived: false, orderBy: 'createdAt',
  })
  assert.equal(result.issue, 'ENG-123')
  assert.equal(result.comments[0].author.email, 'ada@example.com')
  assert.equal(result.pageInfo.nextCursor, 'next-page')
})

test('project, cycle, and user listings return compact paginated catalogs', async () => {
  let projectVariables
  let cycleVariables
  let userVariables
  const client = catalogClient({
    async projects(variables) { projectVariables = variables; return page([project]) },
    async cycles(variables) { cycleVariables = variables; return page([cycle]) },
    async users(variables) {
      if (variables.filter?.id !== undefined) return page([user])
      userVariables = variables
      return page([user], { hasNextPage: true })
    },
  })
  const runtime = runtimeWith(client)
  const projects = await runtime.listProjects({ query: 'plat', status: 'started', limit: 5 })
  const cycles = await runtime.listCycles({ status: 'active', limit: 5 })
  const users = await runtime.listUsers({ query: 'ada', active: true, limit: 5 })
  assert.deepEqual(projectVariables, {
    first: 5, filter: {
      name: { containsIgnoreCase: 'plat' }, status: { id: { in: ['status-id'] } },
    }, includeArchived: false, orderBy: 'updatedAt',
  })
  assert.deepEqual(cycleVariables, {
    first: 5, filter: { isActive: { eq: true } }, includeArchived: false, orderBy: 'updatedAt',
  })
  assert.deepEqual(userVariables, {
    first: 5,
    filter: { or: [
      { name: { containsIgnoreCase: 'ada' } },
      { displayName: { containsIgnoreCase: 'ada' } },
      { email: { containsIgnoreCase: 'ada' } },
    ], active: { eq: true } },
    includeDisabled: false,
    orderBy: 'updatedAt',
  })
  assert.equal(projects.projects[0].lead.name, 'Ada Lovelace')
  assert.equal(cycles.cycles[0].team.key, 'ENG')
  assert.equal(users.users[0].isMe, true)
})

test('project detail resolves bounded content, lead, status, and teams', async () => {
  const detailed = {
    ...project,
    get lead() { return Promise.resolve(user) },
    get status() { return Promise.resolve(status) },
    async teams(variables) { assert.deepEqual(variables, { first: 50 }); return page([team]) },
  }
  const client = catalogClient({ async projects() { return page([detailed]) } })
  const result = await runtimeWith(client).getProject({ project: 'Platform' })
  assert.equal(result.content, 'Detailed project content')
  assert.equal(result.lead.name, 'Ada Lovelace')
  assert.equal(result.status.name, 'In progress')
  assert.equal(result.teams[0].key, 'ENG')
})

test('testing an environment credential binds only its workspace identity', async () => {
  let handler
  let config = { organizationId: '', organizationName: '', organizationUrlKey: '' }
  const ctx = {
    get(name) {
      if (name === 'connection') return { rpc: { handle(_channel, value) { handler = value; return () => {} } } }
      if (name === 'credentials') return { async describe() { return { configured: true, writable: false, source: 'env' } } }
      if (name === 'settings') return { async update(_namespace, patch) { config = { ...config, ...patch } } }
    },
    effect(install) { install() },
  }
  const live = {
    workspace: { id: 'org-id', name: 'Acme', urlKey: 'acme' }, viewer: { id: 'user-id', name: 'Ada' },
    teams: [team],
  }
  registerLinearSettingsRpc(ctx, {
    runtime: { workspace: async () => live }, settings: () => config, literalApiKey: undefined,
  })
  const result = await handler('test', {}, new AbortController().signal)
  assert.equal(result.ok, true)
  assert.deepEqual(config, { organizationId: 'org-id', organizationName: 'Acme', organizationUrlKey: 'acme' })
  assert.equal(result.value.workspace.id, 'org-id')
})

test('tool suite exposes read tools and three approval-gated project writes', () => {
  const definitions = []
  const sections = []
  const events = {}
  const ctx = {
    tools: { register(definition) { definitions.push(definition); return () => {} } },
    systemPrompt: { section(value) { sections.push(value); return () => {} } },
    on(name, listener) { events[name] = listener; return () => {} },
  }
  const runtime = {
    workspace: async () => ({ workspace: {}, viewer: {}, teams: [] }),
    searchIssues: async () => ({ totalCount: 0, issues: [], pageInfo: { hasNextPage: false } }),
    listIssues: async () => ({ issues: [], pageInfo: { hasNextPage: false } }),
    getIssue: async () => issue(),
    getIssueComments: async () => ({ issue: 'ENG-123', comments: [], pageInfo: { hasNextPage: false } }),
    listProjects: async () => ({ projects: [], pageInfo: { hasNextPage: false } }),
    getProject: async () => project,
    listCycles: async () => ({ cycles: [], pageInfo: { hasNextPage: false } }),
    listUsers: async () => ({ users: [], pageInfo: { hasNextPage: false } }),
  }
  registerLinearTools(ctx, runtime, { timeoutMs: 30_000 })
  assert.deepEqual(definitions.map((definition) => definition.name), [
    'linear_workspace', 'linear_search_issues', 'linear_list_issues', 'linear_get_issue',
    'linear_get_issue_comments', 'linear_list_projects', 'linear_get_project',
    'linear_list_cycles', 'linear_list_users', 'linear_create_project',
    'linear_update_project', 'linear_create_project_update',
  ])
  assert.match(sections[0].text, /require one-shot human approval/)
  assert.equal(typeof events['tools/pre-execute'], 'function')
  assert.equal(typeof events['tools/result'], 'function')

  const projectId = 'a0d90dbe-8e47-4f89-a258-12ad9fd06d21'
  const listProjects = definitions.find((definition) => definition.name === 'linear_list_projects')
  const rendered = listProjects.output.render({}, {
    projects: [{ ...project, id: projectId, status }],
    pageInfo: { hasNextPage: false },
  })
  assert.match(rendered[0].text, new RegExp(`selector: ${projectId}`))
})
