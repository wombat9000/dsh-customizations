import assert from 'node:assert/strict'
import test from 'node:test'
import { registerTypeScript } from './source-loader.mjs'
registerTypeScript()
const { githubActivityModel } = await import('../client/activity-model.ts')

const turn = { turn: 1, status: 'closed', start: {}, end: {} }
const args = { owner: 'fixture-org', repo: 'demo', pullNumber: 61 }
const pr = {
  id: 'PR_61',
  number: 61,
  title: 'Fixture',
  isDraft: true,
  url: 'https://github.com/fixture-org/demo/pull/61',
}
const read = {
  host: 'github.com',
  untrusted: true,
  data: { pullRequest: pr },
  truncated: false,
  truncations: [],
}
const write = { host: 'github.com', untrusted: true, outcome: 'confirmed', resource: pr }
function call(callId, name, value, options = {}) {
  return {
    root: {
      kind: 'tool-result',
      callId,
      call: { name, argsRaw: JSON.stringify(args) },
      content: [{ type: 'text', text: JSON.stringify(value) }],
      subCalls: [],
      ...options,
    },
  }
}
test('one resource consolidates nested calls and duplicate ids without erasing distinct outcomes', () => {
  const uncertain = call('uncertain', 'github_update_pull_request', {
    ...write,
    outcome: 'uncertain',
  })
  const first = call('read-1', 'github_get_pull_request', read)
  const second = call('read-2', 'github_get_pull_request', read)
  const model = githubActivityModel(
    [
      {
        root: {
          name: 'multi_tool_use',
          callId: 'outer',
          subCalls: [uncertain.root, { name: 'wrapper', subCalls: [first.root, second.root] }],
        },
      },
      structuredClone(first),
      call('write', 'github_update_pull_request', write),
    ],
    turn,
  )
  assert.equal(model.calls, 4)
  assert.equal(model.resources.length, 1)
  assert.equal(model.resources[0].url, pr.url)
  assert.deepEqual(
    model.resources[0].actions.map(({ mode, outcome, count }) => ({ mode, outcome, count })),
    [
      { mode: 'write', outcome: 'uncertain', count: 1 },
      { mode: 'read', outcome: 'inspected', count: 2 },
      { mode: 'write', outcome: 'confirmed', count: 1 },
    ],
  )
  assert.match(model.warnings.join('\n'), /later read does not confirm/)
})
test('no GitHub or open turn produces no card; interrupted closed evidence does', () => {
  assert.equal(githubActivityModel([], turn), null)
  assert.equal(githubActivityModel([{ root: { name: 'bash', callId: 'b' } }], turn), null)
  assert.equal(
    githubActivityModel([call('r', 'github_get_pull_request', read)], { ...turn, status: 'open' }),
    null,
  )
  assert.equal(
    githubActivityModel([call('r', 'github_get_pull_request', read)], {
      ...turn,
      end: { data: { reason: { kind: 'cancelled' } } },
    }).calls,
    1,
  )
})
test('no-change, native denial, failed, malformed and contradictory results never claim a write', () => {
  const cases = [
    [
      'github_set_project_item_field',
      {
        host: 'github.com',
        operation: 'setProjectItemField',
        outcome: 'no-change',
        dispatched: false,
        reason: 'FIELD_VALUE_ALREADY_SET',
      },
      {},
      'no-change',
    ],
    [
      'github_set_project_item_field',
      { host: 'github.com', outcome: 'no-change' },
      {},
      'uncertain',
    ],
    [
      'github_update_pull_request',
      null,
      {
        isError: true,
        content: [
          { type: 'text', text: 'Error: the user rejected tool "github_update_pull_request"' },
        ],
      },
      'denied',
    ],
    [
      'github_create_issue',
      { host: 'github.com', outcome: 'failed', error: { code: 'NOT_FOUND' } },
      {},
      'failed',
    ],
    [
      'github_get_pull_request',
      { host: 'github.com', error: { code: 'READ_FAILED' } },
      {},
      'failed',
    ],
    ['github_update_pull_request', write, { isError: true }, 'uncertain'],
    ['github_get_pull_request', { ...read, data: {} }, {}, 'uncertain'],
    ['github_update_pull_request', {}, {}, 'uncertain'],
    [
      'github_update_pull_request',
      write,
      { error: { code: 'ABORTED_BEFORE_DISPATCH' }, isError: true },
      'denied',
    ],
  ]
  for (const [name, value, options, outcome] of cases) {
    const model = githubActivityModel([call('c', name, value, options)], turn)
    assert.equal(model.resources[0].actions[0].outcome, outcome, name)
  }
})
test('a partial window and orphan GitHub result retain incomplete identity and coverage', () => {
  const model = githubActivityModel([call('orphan', '', read, { call: null })], {
    ...turn,
    start: undefined,
  })
  assert.match(model.warnings.join('\n'), /Partial history window/)
  assert.match(model.warnings.join('\n'), /no loaded call head/)
  assert.equal(model.resources[0].actions[0].outcome, 'uncertain')
})
test('project reads and field no-ops consolidate at project scope, repo lists remain repo scoped', () => {
  const projectArgs = { owner: 'fixture-org', projectNumber: 7 }
  const project = {
    id: 'P7',
    number: 7,
    title: 'Board',
    url: 'https://github.com/orgs/fixture-org/projects/7',
  }
  const model = githubActivityModel(
    [
      call(
        'project',
        'github_get_project',
        { ...read, data: project },
        { call: { name: 'github_get_project', argsRaw: JSON.stringify(projectArgs) } },
      ),
      call(
        'field',
        'github_set_project_item_field',
        {
          host: 'github.com',
          operation: 'setProjectItemField',
          outcome: 'no-change',
          dispatched: false,
          reason: 'FIELD_VALUE_ALREADY_SET',
        },
        { call: { name: 'github_set_project_item_field', argsRaw: JSON.stringify(projectArgs) } },
      ),
      call(
        'list',
        'github_list_pull_requests',
        {
          ...read,
          data: {
            pullRequests: { nodes: [pr], pageInfo: { page: 1, hasNextPage: true, nextPage: 2 } },
          },
        },
        {
          call: {
            name: 'github_list_pull_requests',
            argsRaw: JSON.stringify({ owner: 'fixture-org', repo: 'demo' }),
          },
        },
      ),
    ],
    turn,
  )
  assert.equal(model.resources.length, 2)
  assert.equal(model.resources[0].actions.length, 2)
  assert.equal(model.resources[1].label, 'fixture-org/demo')
  assert.match(model.warnings.join('\n'), /partial|unknown/)
})
test('existing mutation shapes consolidate with reads; incomplete identities never confirm writes', () => {
  const project = {
    id: 'P7',
    number: 7,
    title: 'Board',
    url: 'https://github.com/orgs/fixture-org/projects/7',
  }
  const issue = {
    id: 'I9',
    number: 9,
    title: 'Issue',
    url: 'https://github.com/fixture-org/demo/issues/9',
  }
  const repository = { id: 'R1', url: 'https://github.com/fixture-org/demo' }
  const cases = [
    ['github_create_project', 'createProject', project, project.url],
    ['github_update_project', 'updateProject', project, project.url],
    [
      'github_link_project_repository',
      'linkProjectRepository',
      { repository, project: { id: project.id, url: project.url } },
      project.url,
    ],
    ['github_create_issue', 'createIssue', issue, issue.url],
    [
      'github_add_project_item',
      'addProjectItem',
      { id: 'ITEM', content: { id: issue.id }, project, url: project.url },
      project.url,
    ],
    [
      'github_set_project_item_field',
      'setProjectItemField',
      { id: 'ITEM', project, url: project.url },
      project.url,
    ],
    [
      'github_add_issue_dependency',
      'addIssueDependency',
      {
        issue,
        blockingIssue: {
          ...issue,
          id: 'I10',
          number: 10,
          url: 'https://github.com/fixture-org/demo/issues/10',
        },
      },
      issue.url,
    ],
  ]
  for (const [name, operation, resource, url] of cases) {
    const options = { call: { name, argsRaw: '{}' } }
    const result = {
      host: 'github.com',
      untrusted: true,
      operation,
      outcome: 'confirmed',
      resource,
    }
    const model = githubActivityModel([call(name, name, result, options)], turn)
    assert.equal(model.resources[0].actions[0].outcome, 'confirmed', name)
    assert.equal(model.resources[0].url, url, name)
    for (const malformed of [{ id: 'unrelated' }, { repository }, {}, null]) {
      const invalid = githubActivityModel(
        [call(name, name, { ...result, resource: malformed }, options)],
        turn,
      )
      assert.equal(invalid.resources[0].actions[0].outcome, 'uncertain', name)
    }
    const missing = githubActivityModel(
      [call(name, name, result, { ...options, kind: undefined })],
      turn,
    )
    assert.equal(missing.resources[0].actions[0].outcome, 'uncertain', name)
  }
  for (const [name, targets, url] of [
    ['github_update_pull_request', { pullRequest: { id: pr.id, url: pr.url } }, pr.url],
    [
      'github_set_project_item_field',
      { project: { id: project.id, url: project.url } },
      project.url,
    ],
    ['github_add_issue_dependency', { blockedIssue: { id: issue.id, url: issue.url } }, issue.url],
  ]) {
    const model = githubActivityModel(
      [
        call(
          'uncertain',
          name,
          { host: 'github.com', untrusted: true, outcome: 'uncertain', knownTargets: targets },
          { call: { name, argsRaw: '{}' } },
        ),
      ],
      turn,
    )
    assert.equal(model.resources[0].url, url, name)
    assert.equal(model.resources[0].actions[0].outcome, 'uncertain')
  }
})
test('repeated reads preserve no-change, denial, uncertainty and partial coverage independently', () => {
  const name = 'github_set_project_item_field'
  const argsRaw = JSON.stringify({ owner: 'fixture-org', projectNumber: 7 })
  const options = { call: { name, argsRaw } }
  const model = githubActivityModel(
    [
      call(
        'noop',
        name,
        {
          host: 'github.com',
          operation: 'setProjectItemField',
          outcome: 'no-change',
          dispatched: false,
          reason: 'FIELD_VALUE_ALREADY_SET',
        },
        options,
      ),
      call('deny', name, null, {
        ...options,
        isError: true,
        content: [{ type: 'text', text: `Error: the user rejected tool "${name}"` }],
      }),
      call('uncertain', name, { host: 'github.com', outcome: 'uncertain' }, options),
      ...[true, false].map((hasNextPage, index) =>
        call(
          `read-${index}`,
          'github_list_project_items',
          {
            host: 'github.com',
            untrusted: true,
            data: {
              nodes: [],
              pageInfo: { hasNextPage, endCursor: 'next' },
              nextCursor: hasNextPage ? 'next' : null,
            },
            truncated: false,
            truncations: [],
          },
          { call: { name: 'github_list_project_items', argsRaw } },
        ),
      ),
    ],
    turn,
  )
  assert.equal(model.resources.length, 1)
  assert.deepEqual(
    model.resources[0].actions.map((action) => action.outcome),
    ['no-change', 'denied', 'uncertain', 'inspected'],
  )
  assert.equal(model.resources[0].actions[3].count, 2)
  assert.match(model.warnings.join('\n'), /partial or unknown/)
})
test('generic reads and historical access reject malformed result shapes', () => {
  for (const name of [
    'github_connection_status',
    'github_detect_repositories',
    'github_get_repository',
    'github_list_repositories',
    'github_get_issue_comments',
    'github_request_issue_management',
  ]) {
    const model = githubActivityModel(
      [
        call(name, name, {
          host: 'github.com',
          untrusted: true,
          data: { unrelated: true },
          outcome: 'granted',
          grant: { id: 'G1' },
        }),
      ],
      turn,
    )
    assert.equal(model.resources[0].actions[0].outcome, 'uncertain', name)
  }
})
test('cross-owner project-item writes consolidate under the project, not a fabricated issue', () => {
  const project = {
    id: 'P7',
    number: 7,
    title: 'Board',
    url: 'https://github.com/orgs/board-org/projects/7',
  }
  const name = 'github_add_project_item'
  const model = githubActivityModel(
    [
      call(
        'add',
        name,
        {
          host: 'github.com',
          untrusted: true,
          operation: 'addProjectItem',
          outcome: 'confirmed',
          resource: { id: 'ITEM', project, content: { id: 'I9' } },
        },
        {
          call: {
            name,
            argsRaw: JSON.stringify({
              owner: 'board-org',
              projectNumber: 7,
              repositoryOwner: 'repo-org',
              repo: 'demo',
              issueNumber: 9,
            }),
          },
        },
      ),
      call(
        'read-project',
        'github_get_project',
        { ...read, data: project },
        {
          call: {
            name: 'github_get_project',
            argsRaw: JSON.stringify({ owner: 'board-org', projectNumber: 7 }),
          },
        },
      ),
    ],
    turn,
  )
  assert.equal(model.resources.length, 1)
  assert.equal(model.resources[0].url, project.url)
  assert.equal(model.resources[0].actions[0].outcome, 'confirmed')
  assert.equal(model.resources[0].actions[1].outcome, 'inspected')
  assert.doesNotMatch(JSON.stringify(model.resources), /board-org\/demo\/issues/)
})
test('generic collection reads validate entries while accepting valid empty collections', () => {
  const pageInfo = { hasNextPage: false, endCursor: null }
  const valid = {
    github_list_repositories: {
      nodes: [
        { id: 'R1', nameWithOwner: 'fixture-org/demo', url: 'https://github.com/fixture-org/demo' },
      ],
      pageInfo,
    },
    github_get_issue_comments: {
      nodes: [
        {
          id: 'C1',
          url: 'https://github.com/fixture-org/demo/issues/9#issuecomment-1',
          body: 'Fixture comment',
        },
      ],
      pageInfo,
    },
    github_detect_repositories: {
      gitRepository: true,
      ambiguous: false,
      candidates: [
        {
          owner: 'fixture-org',
          repo: 'demo',
          nameWithOwner: 'fixture-org/demo',
          url: 'https://github.com/fixture-org/demo',
        },
      ],
    },
  }
  for (const [name, data] of Object.entries(valid)) {
    const entries = name === 'github_detect_repositories' ? 'candidates' : 'nodes'
    for (const [values, outcome] of [
      [data[entries], 'inspected'],
      [[], 'inspected'],
      [[{}], 'uncertain'],
    ]) {
      const model = githubActivityModel(
        [call(name, name, { ...read, data: { ...data, [entries]: values } })],
        turn,
      )
      assert.equal(model.resources[0].actions[0].outcome, outcome, `${name}: ${outcome}`)
    }
  }
})
test('singular issue reads preserve unknown coverage for missing relationship collections', () => {
  const model = githubActivityModel(
    [
      call(
        'issue',
        'github_get_issue',
        {
          ...read,
          data: {
            id: 'I9',
            number: 9,
            title: 'Fixture issue',
            url: 'https://github.com/fixture-org/demo/issues/9',
          },
        },
        {
          call: {
            name: 'github_get_issue',
            argsRaw: JSON.stringify({ owner: 'fixture-org', repo: 'demo', issueNumber: 9 }),
          },
        },
      ),
    ],
    turn,
  )
  assert.equal(model.resources[0].actions[0].outcome, 'inspected')
  assert.match(model.warnings.join('\n'), /Read coverage is partial or unknown/)
})
test('large and cyclic tool trees are bounded and disclose omitted evidence', () => {
  const cyclic = { name: 'wrapper', subCalls: [] }
  cyclic.subCalls.push(cyclic)
  const data = Array.from({ length: 5100 }, (_, index) =>
    call(String(index), 'github_get_pull_request', read, {
      call: {
        name: 'github_get_pull_request',
        argsRaw: JSON.stringify({ ...args, pullNumber: index + 1 }),
      },
    }),
  )
  data[0].root.subCalls.push(cyclic)
  const model = githubActivityModel(data, turn)
  assert.equal(model.resources.length, 100)
  assert.ok(model.calls <= 5000)
  assert.match(model.warnings.join('\n'), /limit|100 resource/)
})
test('unsafe links and unknown operations remain non-authoritative', () => {
  const model = githubActivityModel(
    [
      call(
        'unknown',
        'github_future_action',
        { ...write, resource: { url: 'javascript:alert(1)' } },
        { call: { name: 'github_future_action', argsRaw: '{}' } },
      ),
    ],
    turn,
  )
  assert.equal(model.resources[0].url, undefined)
  assert.equal(model.resources[0].actions[0].mode, 'unknown')
  assert.equal(model.resources[0].actions[0].outcome, 'uncertain')
})
