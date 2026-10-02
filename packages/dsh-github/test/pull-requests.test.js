import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PR_READ_OPERATIONS,
  PR_WRITE_OPERATIONS,
  validatePRArguments,
  readPullRequest,
  preflightPullRequest,
  confirmPullRequest,
} from '../dist/src/pull-requests.js'
import { GitHubError } from '../dist/src/runtime.js'
import { connection } from './fixtures.js'

import {
  SHA,
  BASE,
  TOP,
  actor,
  repository,
  restRepository,
  target,
  file,
  restPull,
  graphPull,
  observed,
  createObserved,
  review,
  stack,
  createArgs,
} from './pull-request-api-fixtures.js'

function transport(responses) {
  const calls = []
  const request = async (descriptor) => {
    calls.push(structuredClone(descriptor))
    assert.ok(responses.length, 'unexpected API request')
    assert.ok(descriptor.document || descriptor.path?.startsWith('/repos/octocat/example/'))
    assert.ok(
      !descriptor.method || descriptor.method === 'GET',
      'preflight and reads must never dispatch mutations',
    )
    return structuredClone(responses.shift())
  }
  return {
    calls,
    request,
    done() {
      assert.equal(responses.length, 0, 'all supplied API responses must be consumed')
    },
  }
}
const rejectsCode = (code) => (error) =>
  error instanceof GitHubError &&
  error.code === code &&
  !error.message.includes('github_pat_') &&
  !error.message.includes('remote secret')

test('argument validation owns nested bounds, exact content and prohibited operations independently of schemas', () => {
  const input = {
    ...target,
    event: 'COMMENT',
    body: 'Exact\ntext',
    expectedHeadSha: SHA,
    comments: [{ path: 'src/app.js', body: 'Please clarify.', line: 2, side: 'RIGHT' }],
  }
  const clone = validatePRArguments('submitPullRequestReview', input)
  input.comments[0].body = 'changed'
  assert.equal(clone.comments[0].body, 'Please clarify.')
  const negatives = [
    ['updatePullRequest', { ...target, draft: true, title: 'Combined write' }],
    ['updatePullRequest', { ...target, base: 'main' }],
    ['updatePullRequest', { ...target, state: 'closed' }],
    ['updatePullRequest', { ...target }],
    [
      'createPullRequest',
      {
        owner: 'octocat',
        repo: 'example',
        title: 'PR',
        body: '',
        head: 'other:feature',
        base: 'main',
      },
    ],
    ['submitPullRequestReview', { ...clone, expectedHeadSha: 'abc' }],
    ['submitPullRequestReview', { ...clone, comments: [{ ...clone.comments[0], position: 2 }] }],
    ['submitPullRequestReview', { ...clone, comments: [{ ...clone.comments[0], startLine: 1 }] }],
    ['submitPullRequestReview', { ...clone, comments: [{ ...clone.comments[0], side: 'WRONG' }] }],
    [
      'submitPullRequestReview',
      { ...clone, comments: [{ ...clone.comments[0], path: '../app.js' }] },
    ],
    ['submitPullRequestReview', { ...clone, comments: Array(21).fill(clone.comments[0]) }],
    ['createPullRequestStack', { owner: 'octocat', repo: 'example', pullNumbers: [7, 7] }],
    ['getPullRequestThreads', { ...target, commentsCursor: 'cursor' }],
    ['listPullRequests', { owner: 'octocat', repo: 'example', limit: 51 }],
    ['getPullRequest', { ...target, owner: 'https://github.com/octocat' }],
    ['mergePullRequest', target],
  ]
  for (const [operation, args] of negatives)
    assert.throws(() => validatePRArguments(operation, args), rejectsCode('INVALID_ARGUMENT'))
  for (const body of [
    'github_pat_secret',
    'Bearer remote secret',
    '\u0085hidden',
    '\u009b31mhidden',
    '\u202ehidden',
    '-----BEGIN PRIVATE KEY-----',
  ]) {
    assert.throws(
      () => validatePRArguments('updatePullRequest', { ...target, body }),
      rejectsCode('UNSAFE_CONTENT'),
    )
  }
  assert.equal(PR_WRITE_OPERATIONS.createPullRequest.properties.draft, undefined)
  assert.equal(PR_READ_OPERATIONS.getPullRequestThreads.properties.commentsCursor.type, 'string')
})

test('list and detail reads preserve explicit PR identity and conservative REST continuation', async () => {
  const mock = transport([[restPull()], restPull()])
  const list = await readPullRequest(
    'listPullRequests',
    { owner: 'octocat', repo: 'example', limit: 1, page: 2 },
    mock.request,
  )
  assert.equal(list.pullRequests.nodes[0].number, 7)
  assert.deepEqual(list.pullRequests.pageInfo, {
    page: 2,
    hasNextPage: true,
    nextPage: 3,
    completeness: 'unknown-full-page',
  })
  assert.equal(mock.calls[0].path, '/repos/octocat/example/pulls?state=open&per_page=1&page=2')
  const detail = await readPullRequest('getPullRequest', target, mock.request)
  assert.equal(detail.pullRequest.head.sha, SHA)
  assert.equal(detail.pullRequest.base.sha, BASE)
  assert.equal(detail.pullRequest.mergeable, null)
  mock.done()
})

test('files and review summaries expose unavailable patches and independent page metadata', async () => {
  const mock = transport([
    restPull(7, { changed_files: 3001 }),
    [{ ...file, patch: undefined }],
    restPull(),
    [review()],
  ])
  const files = await readPullRequest('getPullRequestFiles', { ...target, limit: 1 }, mock.request)
  assert.equal(files.files.nodes[0].patch, null)
  assert.equal(files.files.nodes[0].patchAvailable, false)
  assert.equal(files.files.totalCount, 3001)
  assert.equal(files.files.pageInfo.nextPage, 2)
  assert.equal(files.truncated, true)
  const reviews = await readPullRequest(
    'getPullRequestReviews',
    { ...target, limit: 1, page: 3 },
    mock.request,
  )
  assert.equal(reviews.reviews.nodes[0].state, 'COMMENTED')
  assert.equal(reviews.reviews.nodes[0].commitSha, SHA)
  assert.equal(reviews.reviews.pageInfo.nextPage, 4)
  assert.equal(mock.calls[3].path, '/repos/octocat/example/pulls/7/reviews?per_page=1&page=3')
  mock.done()
})

test('threads retain nested continuation and verify a continued thread belongs to the selected PR', async () => {
  const comments = {
    ...connection(
      [
        {
          id: 'COMMENT_1',
          body: 'Why?',
          url: 'https://github.com/octocat/example/pull/7#discussion_r1',
          createdAt: '2026-04-15T10:00:00Z',
          author: { login: 'reviewer' },
        },
      ],
      true,
      'comment-next',
    ),
    totalCount: 2,
  }
  const thread = {
    id: 'THREAD_1',
    isResolved: false,
    isOutdated: true,
    path: 'src/app.js',
    line: 2,
    startLine: null,
    diffSide: 'RIGHT',
    startDiffSide: null,
    comments,
  }
  const mock = transport([
    {
      repository: {
        id: repository.id,
        nameWithOwner: repository.nameWithOwner,
        pullRequest: {
          id: 'PR_7',
          number: 7,
          url: restPull().html_url,
          reviewThreads: connection([thread]),
        },
      },
    },
    {
      node: {
        ...thread,
        pullRequest: { id: 'PR_7', number: 7, url: restPull().html_url, repository },
      },
    },
  ])
  const first = await readPullRequest('getPullRequestThreads', target, mock.request)
  assert.equal(first.threads.nodes[0].comments.pageInfo.nextCursor, 'comment-next')
  assert.equal(first.threads.nodes[0].isOutdated, true)
  const continued = await readPullRequest(
    'getPullRequestThreads',
    { ...target, threadId: 'THREAD_1', commentsCursor: 'comment-next' },
    mock.request,
  )
  assert.equal(continued.thread.id, 'THREAD_1')
  assert.equal(mock.calls[1].variables.commentsCursor, 'comment-next')
  mock.done()
  const wrong = transport([
    {
      node: {
        ...thread,
        pullRequest: { id: 'PR_8', number: 8, url: restPull(8).html_url, repository },
      },
    },
  ])
  await assert.rejects(
    readPullRequest('getPullRequestThreads', { ...target, threadId: 'THREAD_1' }, wrong.request),
    rejectsCode('INVALID_RESPONSE'),
  )
})

test('checks bind both independently paged APIs to the observed head SHA', async () => {
  const mock = transport([
    restPull(),
    {
      total_count: 2,
      check_runs: [
        {
          id: 5,
          name: 'CI',
          head_sha: SHA,
          status: 'completed',
          conclusion: 'success',
          details_url: null,
          started_at: null,
          completed_at: '2026-04-15T10:01:00Z',
        },
      ],
    },
    {
      sha: SHA,
      state: 'pending',
      total_count: 4,
      statuses: [
        { id: 6, context: 'external', state: 'pending', description: null, target_url: null },
      ],
    },
  ])
  const result = await readPullRequest(
    'getPullRequestChecks',
    { ...target, limit: 1, checksPage: 2, statusesPage: 3 },
    mock.request,
  )
  assert.equal(result.headSha, SHA)
  assert.equal(result.checkRuns.pageInfo.hasNextPage, false)
  assert.equal(result.statuses.pageInfo.nextPage, 4)
  assert.equal(result.statuses.state, 'pending')
  assert.equal(
    mock.calls[1].path,
    `/repos/octocat/example/commits/${SHA}/check-runs?filter=latest&per_page=1&page=2`,
  )
  assert.equal(mock.calls[2].path, `/repos/octocat/example/commits/${SHA}/status?per_page=1&page=3`)
  mock.done()
})

test('native stack reads fetch full detail and bound ordered members without losing counts or continuation', async () => {
  const minimal = {
    ...stack(),
    pull_requests: stack().pull_requests.map((pr) => ({
      number: pr.number,
      state: pr.state,
      draft: pr.draft,
      merged_at: pr.merged_at,
      head: { ref: pr.head.ref, sha: pr.head.sha },
    })),
  }
  const mock = transport([restPull(), [minimal], stack()])
  const result = await readPullRequest(
    'getPullRequestStack',
    { ...target, limit: 1, membersPage: 2 },
    mock.request,
  )
  assert.equal(result.stacks.nodes[0].pullRequests.nodes[0].number, 8)
  assert.equal(result.stacks.nodes[0].pullRequests.nodes[0].base.ref, 'feature')
  assert.equal(result.stacks.nodes[0].pullRequests.nodes[0].title, 'PR 8')
  assert.equal(mock.calls[2].path, '/repos/octocat/example/stacks/42')
  assert.equal(result.stacks.nodes[0].pullRequests.totalCount, 2)
  assert.equal(result.stacks.nodes[0].pullRequests.pageInfo.hasNextPage, false)
  assert.equal(mock.calls[1].path, '/repos/octocat/example/stacks?pull_request=7&per_page=1&page=1')
  mock.done()
})

test('remote shape and identity failures never return cross-repository or wrong-number data', async () => {
  const bad = [
    restPull(8),
    restPull(7, {
      base: { ref: 'main', sha: BASE, repo: { ...restRepository, full_name: 'other/example' } },
    }),
    restPull(7, { head: { ref: 'feature', sha: 'invalid', repo: restRepository } }),
    restPull(7, { draft: undefined }),
    restPull(7, { mergeable: { remote: 'secret' } }),
  ]
  for (const body of bad) {
    const mock = transport([body])
    await assert.rejects(
      readPullRequest('getPullRequest', target, mock.request),
      rejectsCode('INVALID_RESPONSE'),
    )
  }
  const checks = transport([
    restPull(),
    { total_count: 0, check_runs: [] },
    { sha: TOP, state: 'success', total_count: 0, statuses: [] },
  ])
  await assert.rejects(
    readPullRequest('getPullRequestChecks', target, checks.request),
    rejectsCode('INVALID_RESPONSE'),
  )
})

test('draft creation prepares exactly one fixed endpoint with existing same-repository branch SHAs', async () => {
  const mock = transport([createObserved()])
  const prepared = await preflightPullRequest('createPullRequest', createArgs, mock.request)
  assert.deepEqual(prepared.actor, actor)
  assert.equal(prepared.snapshot.head.sha, SHA)
  assert.equal(prepared.snapshot.base.sha, BASE)
  assert.deepEqual(prepared.request, {
    path: '/repos/octocat/example/pulls',
    method: 'POST',
    body: { title: 'New PR', body: 'Exact\nbody', head: 'feature', base: 'main', draft: true },
  })
  assert.equal(mock.calls[0].variables.headQualified, 'refs/heads/feature')
  const resource = confirmPullRequest(
    'createPullRequest',
    prepared,
    restPull(9, {
      title: 'New PR',
      body: 'Exact\nbody',
      draft: true,
      head: restPull().head,
      base: restPull().base,
    }),
  )
  assert.equal(resource.number, 9)
  assert.equal(resource.isDraft, true)
  assert.throws(
    () =>
      confirmPullRequest(
        'createPullRequest',
        prepared,
        restPull(9, {
          title: 'New PR',
          body: 'Exact\nbody',
          draft: false,
          head: restPull().head,
          base: restPull().base,
        }),
      ),
    rejectsCode('INVALID_RESPONSE'),
  )
  mock.done()
})

test('draft creation does not confuse an incoming fork with the same branch name with a local duplicate', async () => {
  const incoming = { id: 'PR_FORK', number: 15, headRepository: { id: 'R_FORK' } }
  const mock = transport([createObserved({ pullRequests: connection([incoming]) })])
  const prepared = await preflightPullRequest('createPullRequest', createArgs, mock.request)
  assert.equal(prepared.request.body.draft, true)
  assert.equal(prepared.snapshot.existing.nodes[0].headRepositoryId, 'R_FORK')
  mock.done()
  const incomplete = transport([
    createObserved({ pullRequests: { ...connection([incoming], true, 'next'), totalCount: 2 } }),
  ])
  await assert.rejects(
    preflightPullRequest('createPullRequest', createArgs, incomplete.request),
    rejectsCode('BOUND_EXCEEDED'),
  )
})

test('creation refuses missing branches, duplicates, unknown permissions and inaccessible identity', async () => {
  const cases = [
    [createObserved({ head: null }), 'NOT_FOUND'],
    [
      createObserved({
        head: {
          id: 'REF_TAG',
          name: 'feature',
          prefix: 'refs/tags/',
          target: { __typename: 'Commit', oid: SHA },
        },
      }),
      'INVALID_RESPONSE',
    ],
    [
      createObserved({
        pullRequests: connection([
          { id: 'PR_7', number: 7, headRepository: { id: repository.id } },
        ]),
      }),
      'ALREADY_EXISTS',
    ],
    [createObserved({ viewerPermission: null }), 'PERMISSION_DENIED'],
    [createObserved({ isArchived: true }), 'PERMISSION_DENIED'],
    [createObserved({ nameWithOwner: 'other/example' }), 'INVALID_RESPONSE'],
    [
      createObserved({
        head: {
          id: 'REF_FEATURE',
          name: 'feature',
          prefix: 'refs/heads/',
          target: { __typename: 'Tree', oid: SHA },
        },
      }),
      'INVALID_RESPONSE',
    ],
  ]
  for (const [body, code] of cases) {
    const mock = transport([body])
    await assert.rejects(
      preflightPullRequest('createPullRequest', createArgs, mock.request),
      rejectsCode(code),
    )
  }
})

test('title/body update preserves selected exact content and rejects an unconfirmed draft/base change', async () => {
  const mock = transport([observed(7, { viewerDidAuthor: true }, { viewerPermission: 'READ' })])
  const prepared = await preflightPullRequest(
    'updatePullRequest',
    { ...target, title: 'Changed', body: '' },
    mock.request,
  )
  assert.deepEqual(prepared.change.before, { title: 'PR 7', body: 'Existing body' })
  assert.deepEqual(prepared.request, {
    path: '/repos/octocat/example/pulls/7',
    method: 'PATCH',
    body: { title: 'Changed', body: '' },
  })
  assert.equal(
    confirmPullRequest('updatePullRequest', prepared, restPull(7, { title: 'Changed', body: '' }))
      .body,
    '',
  )
  for (const raw of [
    restPull(7, { title: 'Wrong', body: '' }),
    restPull(7, { title: 'Changed', body: '', draft: true }),
    restPull(7, {
      title: 'Changed',
      body: '',
      base: { ref: 'main', sha: TOP, repo: restRepository },
    }),
  ]) {
    assert.throws(
      () => confirmPullRequest('updatePullRequest', prepared, raw),
      rejectsCode('INVALID_RESPONSE'),
    )
  }
  mock.done()
})

test('draft/readiness changes prepare one separate GraphQL mutation and confirm the returned state', async () => {
  for (const draft of [true, false]) {
    const mock = transport([observed(7, { isDraft: !draft })])
    const prepared = await preflightPullRequest(
      'updatePullRequest',
      { ...target, draft },
      mock.request,
    )
    assert.deepEqual(prepared.payload, { pullRequestId: 'PR_7' })
    assert.deepEqual(prepared.change, { before: { draft: !draft }, after: { draft } })
    assert.ok(
      prepared.request.document.includes(
        draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview',
      ),
    )
    const field = draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview'
    assert.equal(
      confirmPullRequest('updatePullRequest', prepared, {
        [field]: { pullRequest: graphPull(7, { isDraft: draft }) },
      }).isDraft,
      draft,
    )
    assert.throws(
      () =>
        confirmPullRequest('updatePullRequest', prepared, {
          [field]: { pullRequest: graphPull(7, { isDraft: !draft }) },
        }),
      rejectsCode('INVALID_RESPONSE'),
    )
    mock.done()
  }
})

const reviewArgs = {
  ...target,
  event: 'COMMENT',
  body: 'Please clarify.',
  expectedHeadSha: SHA,
  comments: [{ path: 'src/app.js', body: 'Use a clearer name.', line: 2, side: 'RIGHT' }],
}
test('inline review validates complete target patches without rejecting unrelated binary files', async () => {
  const mock = transport([
    observed(7, { changedFiles: 2 }),
    restPull(7, { changed_files: 2 }),
    [
      file,
      { ...file, filename: 'asset.png', additions: 0, deletions: 0, changes: 0, patch: undefined },
    ],
  ])
  const prepared = await preflightPullRequest('submitPullRequestReview', reviewArgs, mock.request)
  assert.deepEqual(prepared.request, {
    path: '/repos/octocat/example/pulls/7/reviews',
    method: 'POST',
    body: {
      commit_id: SHA,
      event: 'COMMENT',
      body: 'Please clarify.',
      comments: [{ path: 'src/app.js', body: 'Use a clearer name.', line: 2, side: 'RIGHT' }],
    },
  })
  assert.equal(prepared.snapshot.files[0].patch, file.patch)
  const resource = confirmPullRequest('submitPullRequestReview', prepared, review())
  assert.equal(resource.state, 'COMMENTED')
  assert.equal(resource.commitSha, SHA)
  for (const body of [
    review({ commit_id: TOP }),
    review({ state: 'PENDING', submitted_at: null }),
    review({ user: { node_id: 'U_OTHER', login: 'other' } }),
    review({ html_url: 'https://other.invalid/review' }),
  ]) {
    assert.throws(
      () => confirmPullRequest('submitPullRequestReview', prepared, body),
      rejectsCode('INVALID_RESPONSE'),
    )
  }
  mock.done()
})

test('review events enforce stale SHA, self-review, draft and existing pending-review safety', async () => {
  const scenarios = [
    [{ ...reviewArgs, comments: undefined, expectedHeadSha: TOP }, observed(), 'INVALID_ARGUMENT'],
    [{ ...target, event: 'COMMENT', body: 'Text', expectedHeadSha: TOP }, observed(), 'CONFLICT'],
    [
      { ...target, event: 'APPROVE', body: '', expectedHeadSha: SHA },
      observed(7, { viewerDidAuthor: true }),
      'CONFLICT',
    ],
    [
      { ...target, event: 'REQUEST_CHANGES', body: 'Fix this', expectedHeadSha: SHA },
      observed(7, { isDraft: true }),
      'CONFLICT',
    ],
    [
      { ...target, event: 'COMMENT', body: 'Text', expectedHeadSha: SHA },
      observed(7, {
        reviews: connection([{ id: 'REVIEW_PENDING', state: 'PENDING', author: actor }]),
      }),
      'CONFLICT',
    ],
    [
      { ...target, event: 'COMMENT', body: 'Text', expectedHeadSha: SHA },
      observed(7, {}, { isArchived: true }),
      'PERMISSION_DENIED',
    ],
    [
      { ...target, event: 'COMMENT', body: 'Text', expectedHeadSha: SHA },
      observed(7, { reviews: { ...connection([], true, 'next'), totalCount: 101 } }),
      'BOUND_EXCEEDED',
    ],
  ]
  for (const [args, body, code] of scenarios) {
    const mock = transport([body])
    await assert.rejects(
      preflightPullRequest('submitPullRequestReview', args, mock.request),
      rejectsCode(code),
    )
  }
  for (const [event, state] of [
    ['APPROVE', 'APPROVED'],
    ['REQUEST_CHANGES', 'CHANGES_REQUESTED'],
  ]) {
    const mock = transport([observed(7, {}, { viewerPermission: 'READ' })])
    const prepared = await preflightPullRequest(
      'submitPullRequestReview',
      { ...target, event, body: 'Please clarify.', expectedHeadSha: SHA },
      mock.request,
    )
    assert.equal(prepared.payload.event, event)
    assert.equal(
      confirmPullRequest('submitPullRequestReview', prepared, review({ state })).state,
      state,
    )
  }
})

test('inline targets fail closed for missing/truncated patches, wrong sides, absent lines and incomplete files', async () => {
  const scenarios = [
    [[{ ...file, patch: undefined }], reviewArgs, 'CONFLICT'],
    [[{ ...file, patch: '@@ -1,3 +1,3 @@\n context\n-old\n+new' }], reviewArgs, 'CONFLICT'],
    [[{ ...file, additions: 2, changes: 3 }], reviewArgs, 'CONFLICT'],
    [[file], { ...reviewArgs, comments: [{ ...reviewArgs.comments[0], line: 9 }] }, 'CONFLICT'],
    [
      [file],
      { ...reviewArgs, comments: [{ ...reviewArgs.comments[0], side: 'LEFT', line: 3 }] },
      'CONFLICT',
    ],
    [
      [file],
      { ...reviewArgs, comments: [{ ...reviewArgs.comments[0], path: 'other.js' }] },
      'CONFLICT',
    ],
    [[], reviewArgs, 'BOUND_EXCEEDED'],
  ]
  for (const [files, args, code] of scenarios) {
    const mock = transport([observed(), restPull(), files])
    await assert.rejects(
      preflightPullRequest('submitPullRequestReview', args, mock.request),
      rejectsCode(code),
    )
    mock.done()
  }
  const tooMany = transport([observed(7, { changedFiles: 51 })])
  await assert.rejects(
    preflightPullRequest('submitPullRequestReview', reviewArgs, tooMany.request),
    rejectsCode('BOUND_EXCEEDED'),
  )
  const stale = transport([observed(), restPull(7, { head: { ...restPull().head, sha: TOP } })])
  await assert.rejects(
    preflightPullRequest('submitPullRequestReview', reviewArgs, stale.request),
    rejectsCode('CONFLICT'),
  )
})

test('multiline inline comments remain on one visible diff side and hunk', async () => {
  const args = {
    ...reviewArgs,
    comments: [{ ...reviewArgs.comments[0], startLine: 1, startSide: 'RIGHT', line: 3 }],
  }
  const good = transport([observed(), restPull(), [file]])
  const prepared = await preflightPullRequest('submitPullRequestReview', args, good.request)
  assert.equal(prepared.payload.comments[0].start_line, 1)
  assert.equal(prepared.payload.comments[0].start_side, 'RIGHT')
  const separateHunks = { ...file, patch: '@@ -1 +1 @@\n-old\n+new\n@@ -3 +3 @@\n last' }
  const bad = transport([observed(), restPull(), [separateHunks]])
  await assert.rejects(
    preflightPullRequest('submitPullRequestReview', args, bad.request),
    rejectsCode('CONFLICT'),
  )
})

test('native stack creation binds full ordered same-repository PR state and confirms exact membership', async () => {
  const mock = transport([observed(7), [], observed(8), []])
  const prepared = await preflightPullRequest(
    'createPullRequestStack',
    { owner: 'octocat', repo: 'example', pullNumbers: [7, 8] },
    mock.request,
  )
  assert.deepEqual(prepared.request, {
    path: '/repos/octocat/example/stacks',
    method: 'POST',
    body: { pull_requests: [7, 8] },
  })
  assert.deepEqual(prepared.change.after, [7, 8])
  assert.equal(prepared.snapshot.pullRequests[1].base.sha, SHA)
  assert.equal(prepared.snapshot.pullRequests[1].head.sha, TOP)
  assert.equal(confirmPullRequest('createPullRequestStack', prepared, stack()).number, 42)
  assert.throws(
    () => confirmPullRequest('createPullRequestStack', prepared, stack([8, 7])),
    rejectsCode('INVALID_RESPONSE'),
  )
  const changedDraft = stack()
  changedDraft.pull_requests[1].draft = true
  assert.throws(
    () => confirmPullRequest('createPullRequestStack', prepared, changedDraft),
    rejectsCode('CONFLICT'),
  )
  mock.done()
})

test('append uses an explicit stack anchor and appends only the requested existing PR at the top', async () => {
  const original = stack([7])
  const mock = transport([observed(7), [original], original, [original], observed(8), []])
  const prepared = await preflightPullRequest(
    'addPullRequestToStack',
    { ...target, pullNumber: 8, stackPullNumber: 7 },
    mock.request,
  )
  assert.deepEqual(prepared.request, {
    path: '/repos/octocat/example/stacks/42/add',
    method: 'POST',
    body: { pull_requests: [8] },
  })
  assert.deepEqual(prepared.change, { before: [7], after: [7, 8] })
  assert.equal(prepared.snapshot.stack.pullRequests.nodes[0].head.sha, SHA)
  assert.equal(
    confirmPullRequest('addPullRequestToStack', prepared, stack()).pullRequests.totalCount,
    2,
  )
  assert.throws(
    () =>
      confirmPullRequest(
        'addPullRequestToStack',
        prepared,
        stack([7, 8], { node_id: 'OTHER_STACK' }),
      ),
    rejectsCode('INVALID_RESPONSE'),
  )
  mock.done()
})

test('native stack preflight refuses duplicate membership, incomplete detail, forks and broken bottom-up links', async () => {
  const args = { owner: 'octocat', repo: 'example', pullNumbers: [7, 8] }
  const cases = [
    [[observed(7), [], observed(8, { baseRefName: 'main', baseRefOid: BASE }), []], 'CONFLICT'],
    [
      [
        observed(7),
        [],
        observed(8, { headRepository: { id: 'R_FORK', nameWithOwner: 'other/example' } }),
      ],
      'CONFLICT',
    ],
    [[observed(7), [stack([7])], stack([7])], 'ALREADY_EXISTS'],
    [
      [
        observed(7),
        [
          stack([7]),
          stack([7], {
            number: 43,
            node_id: 'STACK_43',
            url: 'https://api.github.com/repos/octocat/example/stacks/43',
          }),
        ],
      ],
      'BOUND_EXCEEDED',
    ],
    [
      [
        observed(7),
        [stack([7])],
        stack([7], {
          pull_requests: [
            {
              number: 7,
              state: 'open',
              draft: false,
              merged_at: null,
              head: { ref: 'feature', sha: SHA },
            },
          ],
        }),
      ],
      'INVALID_RESPONSE',
    ],
    [[observed(7, { state: 'CLOSED' })], 'CONFLICT'],
    [[observed(7), [stack([7], { pull_requests: [null] })]], 'INVALID_RESPONSE'],
  ]
  for (const [responses, code] of cases) {
    const mock = transport(responses)
    await assert.rejects(
      preflightPullRequest('createPullRequestStack', args, mock.request),
      rejectsCode(code),
    )
    mock.done()
  }
  const noAnchor = transport([observed(7), []])
  await assert.rejects(
    preflightPullRequest(
      'addPullRequestToStack',
      { ...target, pullNumber: 8, stackPullNumber: 7 },
      noAnchor.request,
    ),
    rejectsCode('NOT_FOUND'),
  )
})
