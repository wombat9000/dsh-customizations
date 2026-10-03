import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import { createGitHubWriteRuntime, renderWritePreview } from '../dist/src/write-runtime.js'
import { args, snapshot } from './write-payloads.js'
import {
  createArgs,
  createObserved,
  SHA,
  target,
  observed,
  restPull,
  file,
  stack,
} from './pull-request-api-fixtures.js'
import { fakeSubprocess, json } from './fixtures.js'
import {
  approvalNames,
  approvalValue,
  approvalReason,
  approvalTool,
} from './approval-preview-fixtures.js'
let record
vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
  window: {
    __ModuleLoader__: {
      load: (value) => {
        record = value
      },
    },
  },
  URL,
})
import { registerTypeScript } from './source-loader.mjs'
registerTypeScript()
const plugin = await import('../client/approval-model.ts')
const bundledPlugin = record.factory(() => React)
test('all seven previews derive exactly from actual immutable runtime preparations; template copies too', async () => {
  for (const name of Object.keys(args)) {
    const operation = name === 'copyProject' ? 'createProject' : name
    const runtime = createGitHubWriteRuntime(fakeSubprocess([json({ data: snapshot(name) })]))
    const prepared = await runtime.prepare(operation, args[name], {
      agentId: 'fixture',
      cwd: '/fixture',
    })
    assert.ok(Object.isFrozen(prepared))
    const model = plugin.approvalModel(approvalTool(operation), prepared.preview)
    assert.ok(model, name)
    assert.equal(model.reason, prepared.preview)
    assert.deepEqual(JSON.parse(JSON.stringify(model.value.exactPayload)), prepared.payload)
  }
})
test('draft PR preview accepts the actual immutable REST preparation without another read', async () => {
  const subprocess = fakeSubprocess([json({ data: createObserved() })])
  const runtime = createGitHubWriteRuntime(subprocess)
  const prepared = await runtime.prepare('createPullRequest', createArgs, {
    agentId: 'fixture',
    cwd: '/fixture',
  })
  const model = plugin.approvalModel('github_create_pull_request', prepared.preview)
  assert.ok(model)
  assert.equal(model.reason, prepared.preview)
  assert.deepEqual(model.value.exactPayload, prepared.payload)
  assert.equal(subprocess.specs.length, 1)
})
async function preparedModel(operation, input, responses, expectedPayload) {
  const readCount = responses.length
  const subprocess = fakeSubprocess(responses)
  const runtime = createGitHubWriteRuntime(subprocess)
  const prepared = await runtime.prepare(operation, input, { agentId: 'fixture', cwd: '/fixture' })
  assert.ok(Object.isFrozen(prepared))
  assert.ok(Object.isFrozen(prepared.payload))
  const model = plugin.approvalModel(approvalTool(operation), prepared.preview)
  assert.ok(model, `${operation}: ${JSON.stringify(input)}`)
  assert.equal(model.reason, prepared.preview)
  assert.deepEqual(model.value.exactPayload, expectedPayload)
  assert.deepEqual(prepared.payload, expectedPayload)
  assert.equal(subprocess.specs.length, readCount, 'prepare performs only supplied reads')
  for (const spec of subprocess.specs) {
    const method = spec.argv[spec.argv.indexOf('--method') + 1]
    assert.notEqual(method, 'PATCH')
    assert.ok(method !== 'POST' || spec.argv[2] === 'graphql', 'no REST mutation')
    if (spec.argv[2] === 'graphql')
      assert.match(JSON.parse(spec.stdio.stdin.data).query, /^query /, 'no GraphQL mutation')
  }
  return model
}
test('PR update previews derive from immutable title/body and both readiness preparations', async () => {
  for (const update of [
    { title: 'New title  ' },
    { body: '' },
    { title: 'New title', body: 'Exact\r\n  \tbody' },
  ]) {
    const model = await preparedModel(
      'updatePullRequest',
      { ...target, ...update },
      [json({ data: observed() })],
      update,
    )
    assert.deepEqual(
      model.value.change.before,
      Object.fromEntries(
        Object.keys(update).map((key) => [key, key === 'title' ? 'PR 7' : 'Existing body']),
      ),
    )
    assert.deepEqual(model.value.change.after, update)
  }
  for (const draft of [true, false]) {
    const model = await preparedModel(
      'updatePullRequest',
      { ...target, draft },
      [json({ data: observed(7, { isDraft: !draft }) })],
      { pullRequestId: 'PR_7' },
    )
    assert.deepEqual(model.value.change, { before: { draft: !draft }, after: { draft } })
  }
})
test('all review actions preserve commit-bound bodies and optional single/multiline inline comments from prepare', async () => {
  for (const event of ['COMMENT', 'APPROVE', 'REQUEST_CHANGES']) {
    for (const kind of ['none', 'single', 'multiline']) {
      const comment = {
        path: 'src/app.js',
        body: 'Exact inline  \t\r\n',
        line: 3,
        side: 'RIGHT',
        ...(kind === 'multiline' ? { startLine: 2, startSide: 'RIGHT' } : {}),
      }
      const comments = kind === 'none' ? undefined : [comment]
      const body = event === 'APPROVE' ? '' : 'Exact review  \t\r\n'
      const expected = {
        commit_id: SHA,
        body,
        event,
        ...(comments
          ? {
              comments: [
                {
                  path: comment.path,
                  body: comment.body,
                  line: comment.line,
                  side: comment.side,
                  ...(kind === 'multiline' ? { start_line: 2, start_side: 'RIGHT' } : {}),
                },
              ],
            }
          : {}),
      }
      const reads = [
        json({ data: observed() }),
        ...(comments ? [json(restPull()), json([file])] : []),
      ]
      const model = await preparedModel(
        'submitPullRequestReview',
        { ...target, expectedHeadSha: SHA, body, event, ...(comments ? { comments } : {}) },
        reads,
        expected,
      )
      assert.deepEqual(model.value.change, { before: null, after: expected })
    }
  }
})
test('stack create and append previews use complete ordered actual preparations without branch mutations', async () => {
  const create = await preparedModel(
    'createPullRequestStack',
    { owner: target.owner, repo: target.repo, pullNumbers: [7, 8] },
    [json({ data: observed() }), json([]), json({ data: observed(8) }), json([])],
    { pull_requests: [7, 8] },
  )
  assert.deepEqual(create.value.change, { before: null, after: [7, 8] })
  const add = await preparedModel(
    'addPullRequestToStack',
    { ...target, pullNumber: 9, stackPullNumber: 7 },
    [
      json({ data: observed() }),
      json([stack()]),
      json(stack()),
      json([stack()]),
      json({ data: observed(8) }),
      json([stack()]),
      json({
        data: observed(9, {
          headRefName: 'feature-final',
          headRefOid: 'd'.repeat(40),
          baseRefName: 'feature-top',
          baseRefOid: 'c'.repeat(40),
        }),
      }),
      json([]),
    ],
    { pull_requests: [9] },
  )
  assert.deepEqual(add.value.change, { before: [7, 8], after: [7, 8, 9] })
  assert.deepEqual(
    add.value.targets.pullRequests.map((pr) => pr.number),
    [7, 8, 9],
  )
})
test('draft PR preview rejects non-drafts, malformed refs and non-creation changes', () => {
  for (const mutate of [
    (v) => {
      v.change.after.draft = v.exactPayload.draft = false
    },
    (v) => {
      v.targets.head.sha = 'not-a-commit'
    },
    (v) => {
      v.targets.base.prefix = 'refs/tags/'
    },
    (v) => {
      v.targets.repository.id = ''
    },
    (v) => {
      v.change.before = {}
    },
  ]) {
    const value = approvalValue('createPullRequest')
    mutate(value)
    assert.equal(plugin.approvalModel('github_create_pull_request', approvalReason(value)), null)
  }
})
test('malformed, missing, foreign, inconsistent and future payloads retain native fallback', () => {
  for (const reason of [
    undefined,
    '',
    'unexpected',
    'Approve exactly one GitHub mutation on github.com.\n```json\n{}\n```',
  ])
    assert.equal(plugin.approvalModel('github_create_issue', reason), null)
  for (const operation of approvalNames) {
    const value = approvalValue(operation)
    assert.ok(plugin.approvalModel(approvalTool(operation), approvalReason(value)))
    value.exactPayload.surprise = 'must not hide unknown semantics'
    assert.equal(plugin.approvalModel(approvalTool(operation), approvalReason(value)), null)
  }
  const value = approvalValue('createProject')
  for (const change of [
    { targets: { ...value.targets, template: {} } },
    { change: { ...value.change, creationPermission: {} } },
  ])
    assert.equal(
      plugin.approvalModel('github_create_project', approvalReason({ ...value, ...change })),
      null,
    )
  assert.equal(
    plugin.selectApproval({
      callId: 'other',
      pendingInteraction: {
        kind: 'approval',
        callId: 'call',
        toolName: 'github_create_issue',
        reason: approvalReason(approvalValue()),
      },
    }),
    null,
  )
})
// Change one JSON leaf at a time: each mismatch must independently retain the
// complete native fallback rather than displaying an unrelated approval preview.
const bindingPaths = {
  createProject: [
    ['targets', 'destination', 'id'],
    ['change', 'title'],
  ],
  createIssue: [
    ['targets', 'repository', 'id'],
    ['change', 'title'],
    ['change', 'body'],
  ],
  createPullRequest: [
    ['targets', 'head', 'name'],
    ['targets', 'base', 'name'],
    ['change', 'after', 'title'],
    ['change', 'after', 'body'],
    ['change', 'after', 'head'],
    ['change', 'after', 'base'],
    ['change', 'after', 'draft'],
  ],
  updatePullRequest: [
    ['targets', 'pullRequest', 'title'],
    ['targets', 'pullRequest', 'body'],
    ['change', 'before', 'title'],
    ['change', 'before', 'body'],
    ['change', 'after', 'title'],
    ['change', 'after', 'body'],
  ],
  submitPullRequestReview: [
    ['targets', 'pullRequest', 'head', 'sha'],
    ['change', 'after', 'commit_id'],
    ['change', 'after', 'event'],
    ['change', 'after', 'body'],
  ],
  createPullRequestStack: [
    ['targets', 'pullRequests', 0, 'number'],
    ['targets', 'pullRequests', 1, 'number'],
    ['change', 'after', 0],
    ['change', 'after', 1],
  ],
  addPullRequestToStack: [
    ['targets', 'pullRequests', 2, 'number'],
    ['targets', 'stack', 'pullRequests', 'nodes', 0, 'number'],
    ['change', 'before', 0],
    ['change', 'after', 2],
  ],
  updateProject: [
    ['targets', 'project', 'id'],
    ['change', 'title', 'after'],
    ['change', 'shortDescription', 'after'],
    ['change', 'readme', 'after'],
  ],
  linkProjectRepository: [
    ['targets', 'project', 'id'],
    ['targets', 'repository', 'id'],
    ['change', 'link', 'id'],
  ],
  addProjectItem: [
    ['targets', 'project', 'id'],
    ['targets', 'issue', 'id'],
    ['change', 'addIssue', 'id'],
  ],
  setProjectItemField: [
    ['targets', 'project', 'id'],
    ['targets', 'item', 'id'],
    ['change', 'field', 'id'],
    ['change', 'after', 'singleSelectOptionId'],
  ],
  addIssueDependency: [
    ['targets', 'blockedIssue', 'id'],
    ['targets', 'blockingIssue', 'id'],
    ['change', 'addBlockedBy', 'id'],
  ],
}
function replaceLeaf(value, path, replacement) {
  let parent = value
  for (const key of path.slice(0, -1)) parent = parent[key]
  parent[path.at(-1)] = replacement
}
for (const operation of approvalNames) {
  test(`${operation} binds each target and proposed change to its exact payload`, () => {
    const original = approvalValue(operation)
    assert.ok(plugin.approvalModel(approvalTool(operation), approvalReason(original)))
    for (const path of bindingPaths[operation]) {
      const value = JSON.parse(JSON.stringify(original))
      replaceLeaf(value, path, 'UNRELATED_VALUE')
      assert.equal(
        plugin.approvalModel(approvalTool(operation), approvalReason(value)),
        null,
        path.join('.'),
      )
    }
    for (const key of Object.keys(original.exactPayload)) {
      const value = JSON.parse(JSON.stringify(original))
      value.exactPayload[key] =
        key === 'value' ? { singleSelectOptionId: 'UNRELATED' } : 'UNRELATED'
      assert.equal(
        plugin.approvalModel(approvalTool(operation), approvalReason(value)),
        null,
        `exactPayload.${key}`,
      )
    }
  })
}
test('PR previews reject malformed identities, state, fields and inconsistent snapshots', () => {
  for (const operation of [
    'updatePullRequest',
    'submitPullRequestReview',
    'createPullRequestStack',
    'addPullRequestToStack',
  ]) {
    for (const [path, replacement] of [
      [['targets', 'repository', 'id'], ''],
      [['targets', 'repository', 'nameWithOwner'], 'foreign/repo'],
      [
        ['targets', ...(operation.includes('Stack') ? ['pullRequests', 0] : ['pullRequest']), 'id'],
        '',
      ],
      [
        [
          'targets',
          ...(operation.includes('Stack') ? ['pullRequests', 0] : ['pullRequest']),
          'number',
        ],
        0,
      ],
      [
        [
          'targets',
          ...(operation.includes('Stack') ? ['pullRequests', 0] : ['pullRequest']),
          'state',
        ],
        'CLOSED',
      ],
      [
        [
          'targets',
          ...(operation.includes('Stack') ? ['pullRequests', 0] : ['pullRequest']),
          'isDraft',
        ],
        'false',
      ],
      [
        [
          'targets',
          ...(operation.includes('Stack') ? ['pullRequests', 0] : ['pullRequest']),
          'head',
          'sha',
        ],
        'not-a-sha',
      ],
      [
        [
          'targets',
          ...(operation.includes('Stack') ? ['pullRequests', 0] : ['pullRequest']),
          'base',
          'sha',
        ],
        'a'.repeat(39),
      ],
    ]) {
      const value = approvalValue(operation)
      replaceLeaf(value, path, replacement)
      assert.equal(
        plugin.approvalModel(approvalTool(operation), approvalReason(value)),
        null,
        `${operation}.${path.join('.')}`,
      )
    }
  }
  for (const request of [
    'updatePullRequest',
    'updatePullRequest:draft',
    'updatePullRequest:ready',
  ]) {
    for (const mutate of [
      (v) => {
        v.change.before = {}
      },
      (v) => {
        v.change.after.surprise = true
      },
      (v) => {
        v.change.before[Object.keys(v.change.before)[0]] = null
      },
      (v) => {
        v.exactPayload.draft = true
      },
      (v) => {
        v.change.after = v.change.before
      },
    ]) {
      const value = approvalValue(request)
      mutate(value)
      assert.equal(
        plugin.approvalModel(approvalTool(request), approvalReason(value)),
        null,
        request,
      )
    }
  }
  for (const [path, replacement] of [
    [['exactPayload', 'commit_id'], 'not-a-sha'],
    [['exactPayload', 'event'], 'PENDING'],
    [['exactPayload', 'event'], ['APPROVE']],
    [['exactPayload', 'event'], { value: 'COMMENT' }],
    [['exactPayload', 'body'], null],
    [['change', 'before'], {}],
  ]) {
    const value = approvalValue('submitPullRequestReview')
    replaceLeaf(value, path, replacement)
    assert.equal(
      plugin.approvalModel(approvalTool(value.operation), approvalReason(value)),
      null,
      path.join('.'),
    )
  }
})
test('inline review metadata and exact comment bindings fail closed independently', () => {
  for (const request of ['submitPullRequestReview:inline', 'submitPullRequestReview:multiline']) {
    for (const [key, replacement] of [
      ['path', ''],
      ['path', '../private'],
      ['body', null],
      ['line', 0],
      ['line', 1.5],
      ['side', 'BOTH'],
      ['side', ['LEFT']],
      ['side', { value: 'RIGHT' }],
      ['start_line', 4],
      ['start_side', 'LEFT'],
      ['position', 3],
    ]) {
      const value = approvalValue(request)
      // Both projections change together: this checks validity, not a generic mismatch.
      value.exactPayload.comments[0][key] = replacement
      assert.equal(
        plugin.approvalModel(approvalTool(request), approvalReason(value)),
        null,
        `${request}.${key}`,
      )
    }
    for (const key of [
      'path',
      'body',
      'line',
      'side',
      ...(request.endsWith('multiline') ? ['start_line', 'start_side'] : []),
    ]) {
      const value = JSON.parse(JSON.stringify(approvalValue(request)))
      value.change.after.comments[0][key] = 'UNRELATED'
      assert.equal(
        plugin.approvalModel(approvalTool(request), approvalReason(value)),
        null,
        `binding.${key}`,
      )
    }
  }
})
test('stack previews reject partial, duplicate, reordered and inconsistent member lists', () => {
  for (const operation of ['createPullRequestStack', 'addPullRequestToStack']) {
    for (const mutate of [
      (v) => {
        v.targets.pullRequests.pop()
      },
      (v) => {
        v.targets.pullRequests.reverse()
      },
      (v) => {
        v.targets.pullRequests[1] = v.targets.pullRequests[0]
      },
      (v) => {
        v.change.after.reverse()
      },
      (v) => {
        v.change.after[1] = v.change.after[0]
      },
      (v) => {
        v.targets.pullRequests[1].base.ref = 'unrelated'
      },
      (v) => {
        v.targets.pullRequests[1].base.sha = 'e'.repeat(40)
      },
    ]) {
      const value = approvalValue(operation)
      mutate(value)
      assert.equal(
        plugin.approvalModel(approvalTool(operation), approvalReason(value)),
        null,
        operation,
      )
    }
  }
  for (const mutate of [
    (v) => {
      v.targets.stack.id = ''
    },
    (v) => {
      v.targets.stack.number = 0
    },
    (v) => {
      v.targets.stack.open = false
    },
    (v) => {
      v.targets.stack.pullRequests.totalCount++
    },
    (v) => {
      v.targets.stack.pullRequests.pageInfo.hasNextPage = true
    },
    (v) => {
      v.targets.stack.pullRequests.pageInfo.nextPage = 2
    },
    (v) => {
      v.targets.stack.pullRequests.nodes.pop()
    },
    (v) => {
      v.targets.stack.pullRequests.nodes.reverse()
    },
    (v) => {
      v.targets.stack.pullRequests.nodes[0].head.sha = 'e'.repeat(40)
    },
    (v) => {
      v.change.before.reverse()
    },
  ]) {
    const value = approvalValue('addPullRequestToStack')
    mutate(value)
    assert.equal(plugin.approvalModel(approvalTool(value.operation), approvalReason(value)), null)
  }
})
test('host write preview rejects unsafe control characters before client rendering', () => {
  const value = approvalValue()
  value.change.body = value.exactPayload.body = 'bad\u0001control'
  assert.throws(() => renderWritePreview(value), /unsafe/i)
})
test('template copy behavior is exact for both draft options, and malformed copied text falls back', async () => {
  for (const includeDraftIssues of [false, true]) {
    const runtime = createGitHubWriteRuntime(
      fakeSubprocess([json({ data: snapshot('copyProject') })]),
    )
    const prepared = await runtime.prepare(
      'createProject',
      { ...args.copyProject, includeDraftIssues },
      { agentId: 'fixture', cwd: '/fixture' },
    )
    const model = plugin.approvalModel('github_create_project', prepared.preview)
    assert.equal(model.value.exactPayload.includeDraftIssues, includeDraftIssues)
    for (const [path, replacement] of [
      [['targets', 'destination', 'id'], 'OTHER_OWNER'],
      [['targets', 'template', 'id'], 'OTHER_TEMPLATE'],
      [['change', 'title'], 'Other title'],
      [['change', 'copyBehavior', 'sourceTemplate'], 'OTHER_TEMPLATE'],
      [['change', 'copyBehavior', 'includeDraftIssues'], !includeDraftIssues],
      [['change', 'copyBehavior', 'ordinaryNewProject'], false],
      [['exactPayload', 'ownerId'], 'OTHER_OWNER'],
      [['exactPayload', 'projectId'], 'OTHER_TEMPLATE'],
      [['exactPayload', 'title'], 'Other title'],
      [['exactPayload', 'includeDraftIssues'], !includeDraftIssues],
    ]) {
      const mismatched = JSON.parse(JSON.stringify(model.value))
      replaceLeaf(mismatched, path, replacement)
      assert.equal(
        plugin.approvalModel('github_create_project', approvalReason(mismatched)),
        null,
        path.join('.'),
      )
    }
    const malformed = JSON.parse(JSON.stringify(model.value))
    malformed.change.copyBehavior.copied = {}
    assert.equal(plugin.approvalModel('github_create_project', approvalReason(malformed)), null)
  }
})
test('native registration selects exact call only and disposes independently', () => {
  const registrations = [],
    disposed = []
  bundledPlugin.apply({
    slots: {
      inject(name, callback) {
        const dispose = callback()
        if (name === 'conversation.approval.detail') dispose()
      },
      register(options) {
        registrations.push(options)
        return () => disposed.push(options.name)
      },
    },
  })
  const registration = registrations.find((x) => x.name === 'conversation.approval.detail')
  assert.ok(registration)
  assert.deepEqual(disposed, ['conversation.approval.detail'])
  assert.equal(registration.priority, -10)
  assert.equal(registration.select, undefined, 'single seats do not support chain selectors')
  assert.equal(
    plugin.selectApproval({
      callId: 'call',
      pendingInteraction: {
        kind: 'approval',
        callId: 'call',
        toolName: 'bash',
        reason: approvalReason(approvalValue()),
      },
    }),
    null,
  )
})
