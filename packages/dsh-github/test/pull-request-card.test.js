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
})
