import assert from 'node:assert/strict'
import test from 'node:test'
import { registerTypeScript } from './source-loader.mjs'
import {
  cardBlock,
  cardEnvelope,
  cardWriteEnvelope,
  cardPullRequest,
} from './pull-request-card-fixtures.js'
registerTypeScript()
const { pullRequestCardModel } = await import('../client/pull-request-model.ts')

test('pending draft creation does not claim approval is required, while other writes still do', () => {
  const draft = pullRequestCardModel('github_create_pull_request')
  assert.match(draft.status, /Pending or running/)
  assert.doesNotMatch(draft.status, /approval required/)
  assert.match(pullRequestCardModel('github_update_pull_request').status, /approval required/)
})

test('PR cards never infer success from malformed, error-normalized or uncertain outcomes', () => {
  const tool = 'github_create_pull_request'
  for (const envelope of [
    {},
    { host: 'github.com', outcome: 'confirmed', resource: cardPullRequest },
    { host: 'github.com', untrusted: true, outcome: 'confirmed' },
    { host: 'github.com', untrusted: true, outcome: 'confirmed', resource: {} },
    { host: 'github.com', untrusted: true, outcome: 'unexpected', resource: cardPullRequest },
  ])
    assert.notEqual(pullRequestCardModel(tool, cardBlock(envelope)).status, 'Confirmed')
  assert.equal(
    pullRequestCardModel(tool, cardBlock(cardWriteEnvelope(cardPullRequest), { isError: true }))
      .status,
    'Failed',
  )
  const uncertain = pullRequestCardModel(
    tool,
    cardBlock({
      host: 'github.com',
      untrusted: true,
      outcome: 'uncertain',
      observedConfirmedResource: cardPullRequest,
    }),
  )
  assert.equal(uncertain.status, 'Outcome uncertain')
  assert.equal(uncertain.entries.length, 0)
  assert.match(uncertain.warnings.join(' '), /do not retry automatically/)
  assert.doesNotMatch(uncertain.warnings.join(' '), /fresh approval/)
})
test('thread comments must be supplied before a PR card can establish completeness', () => {
  const comments = { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } }
  const thread = { id: 'THREAD', comments }
  const complete = pullRequestCardModel(
    'github_get_pull_request_threads',
    cardBlock(cardEnvelope({ thread })),
  )
  assert.equal(complete.completeness, 'complete')
  for (const data of [
    { thread: { id: 'THREAD' } },
    {
      thread: { id: 'THREAD', comments: { nodes: [], pageInfo: { page: 1, hasNextPage: false } } },
    },
    {
      threads: {
        nodes: [{ id: 'THREAD' }],
        totalCount: 1,
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  ]) {
    const model = pullRequestCardModel(
      'github_get_pull_request_threads',
      cardBlock(cardEnvelope(data)),
    )
    assert.equal(model.completeness, 'unknown')
    assert.ok(
      model.inspection.notices.some(
        (notice) => notice.kind === 'metadata' && notice.path.endsWith('.comments'),
      ),
    )
  }
})

test('REST page continuation and nested thread cursors remain visible outside details', () => {
  const model = pullRequestCardModel(
    'github_list_pull_requests',
    cardBlock(
      cardEnvelope({
        pullRequests: {
          nodes: [cardPullRequest],
          pageInfo: { page: 1, hasNextPage: true, nextPage: 2 },
          nextPage: 2,
        },
      }),
    ),
  )
  assert.match(model.warnings.join(' '), /not complete/)
  assert.doesNotMatch(model.warnings.join(' '), /cursor is unavailable/)
  const malformed = pullRequestCardModel(
    'github_list_pull_requests',
    cardBlock(cardEnvelope({ pullRequests: { nodes: 'bad' } })),
  )
  assert.equal(malformed.entries.length, 0)
  assert.equal(malformed.status, 'Result unavailable')
  const missingPage = pullRequestCardModel(
    'github_list_pull_requests',
    cardBlock(
      cardEnvelope({
        pullRequests: { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false } },
      }),
    ),
  )
  assert.equal(missingPage.completeness, 'unknown')
  assert.ok(
    missingPage.inspection.notices.some(
      (notice) => notice.kind === 'metadata' && notice.path === 'data.pullRequests',
    ),
  )
})
