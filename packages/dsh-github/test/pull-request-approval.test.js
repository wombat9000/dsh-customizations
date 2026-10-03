import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { registerTypeScript } from './source-loader.mjs'
import { cardBlock } from './pull-request-card-fixtures.js'
registerTypeScript()
const { PullRequestCard } = await import('../client/pull-request-card.tsx')
import { createGitHubWriteRuntime } from '../dist/src/write-runtime.js'
import { createGitHubPullRequestRuntime } from '../dist/src/pull-request-runtime.js'
import { registerGitHubWriteTools } from '../dist/src/write-tools.js'
import { fakeSubprocess, json } from './fixtures.js'
import { approvalHost } from './approval-fixture.js'
import {
  SHA,
  BASE,
  target,
  createArgs,
  createObserved,
  observed,
  graphPull,
  restPull,
  review,
  stack,
} from './pull-request-api-fixtures.js'
const graph = (data) => json({ data })
const mutations = (subprocess) =>
  subprocess.specs.filter((spec) => {
    const method = spec.argv[spec.argv.indexOf('--method') + 1]
    const endpoint = spec.argv[2]
    return (
      method === 'PATCH' ||
      (method === 'POST' && endpoint !== 'graphql') ||
      (endpoint === 'graphql' && JSON.parse(spec.stdio.stdin.data).query.startsWith('mutation'))
    )
  })
async function fixture(t, responses, answer = 'allowed-once') {
  const host = await approvalHost(t, { answer })
  const subprocess = fakeSubprocess(responses)
  registerGitHubWriteTools(host.ctx, createGitHubWriteRuntime(subprocess))
  return { ...host, subprocess }
}

test('draft creation skips approval in the real Tools pipeline even without an answerer', async (t) => {
  for (const options of [{}, { policy: 'never' }, { approval: false }]) {
    await t.test(JSON.stringify(options), async (t) => {
      const host = await approvalHost(t, options)
      const subprocess = fakeSubprocess([
        graph(createObserved()),
        graph(createObserved()),
        json(
          restPull(9, {
            title: createArgs.title,
            body: createArgs.body,
            draft: true,
            head: restPull().head,
            base: restPull().base,
          }),
        ),
      ])
      registerGitHubWriteTools(host.ctx, createGitHubWriteRuntime(subprocess))
      const result = await host.execute('github_create_pull_request', createArgs)
      assert.equal(result.isError, false, JSON.stringify(result))
      assert.equal(JSON.parse(result.value).outcome, 'confirmed')
      assert.equal(host.requests.length, 0)
      assert.deepEqual(host.audit(), [])
      assert.equal(mutations(subprocess).length, 1)
      assert.equal(JSON.parse(mutations(subprocess)[0].stdio.stdin.data).draft, true)
    })
  }
})

test('approval-free drafts retain exact arguments and caller binding before dispatch', async (t) => {
  for (const change of ['arguments', 'caller']) {
    await t.test(change, async (t) => {
      const host = await fixture(t, [graph(createObserved())])
      host.ctx.on('tools/pre-execute', (exec) => {
        if (change === 'arguments')
          exec.arguments = { ...createArgs, title: 'Changed after preparation' }
        else exec.agent = { ...exec.agent }
        return { kind: 'allow' }
      })
      const result = await host.execute('github_create_pull_request', createArgs)
      assert.equal(JSON.parse(result.value).outcome, 'failed')
      assert.match(result.value, /APPROVAL_REQUIRED/)
      assert.equal(host.requests.length, 0)
      assert.equal(mutations(host.subprocess).length, 0)
    })
  }
})

test('draft creation retains independent ask, deny and cancel policies', async (t) => {
  for (const kind of ['ask', 'deny', 'cancel']) {
    await t.test(kind, async (t) => {
      const host = await fixture(t, [
        graph(createObserved()),
        graph(createObserved()),
        json(
          restPull(9, {
            title: createArgs.title,
            body: createArgs.body,
            draft: true,
            head: restPull().head,
            base: restPull().base,
          }),
        ),
      ])
      host.ctx.on('tools/pre-execute', () => ({ kind, reason: 'Independent policy' }))
      const result = await host.execute('github_create_pull_request', createArgs)
      if (kind === 'ask') {
        assert.equal(result.isError, false, JSON.stringify(result))
        assert.equal(JSON.parse(result.value).outcome, 'confirmed')
        assert.equal(host.requests.length, 1)
        assert.match(host.requests[0].reason, /Independent policy/)
        assert.match(host.requests[0].reason, /exactPayload/)
        assert.equal(mutations(host.subprocess).length, 1)
      } else {
        assert.equal(result.isError, true)
        assert.equal(host.requests.length, 0)
        assert.equal(mutations(host.subprocess).length, 0)
      }
    })
  }
})

test('draft creation skips only its own approval while other PR writes ask once with exact payloads', async (t) => {
  const cases = [
    [
      'create_pull_request',
      createArgs,
      [graph(createObserved())],
      json(
        restPull(9, {
          title: createArgs.title,
          body: createArgs.body,
          draft: true,
          head: restPull().head,
          base: restPull().base,
        }),
      ),
    ],
    [
      'update_pull_request',
      { ...target, title: 'Updated title', body: '' },
      [graph(observed())],
      json(restPull(7, { title: 'Updated title', body: '' })),
    ],
    [
      'update_pull_request',
      { ...target, draft: false },
      [graph(observed(7, { isDraft: true }))],
      graph({ markPullRequestReadyForReview: { pullRequest: graphPull() } }),
    ],
    [
      'update_pull_request',
      { ...target, draft: true },
      [graph(observed())],
      graph({ convertPullRequestToDraft: { pullRequest: graphPull(7, { isDraft: true }) } }),
    ],
    [
      'submit_pull_request_review',
      { ...target, expectedHeadSha: SHA, event: 'COMMENT', body: 'Please clarify.' },
      [graph(observed())],
      json(review()),
    ],
    [
      'create_pull_request_stack',
      { owner: 'octocat', repo: 'example', pullNumbers: [7, 8] },
      [graph(observed()), json([]), graph(observed(8)), json([])],
      json(stack()),
    ],
    [
      'add_pull_request_to_stack',
      { ...target, pullNumber: 9, stackPullNumber: 7 },
      [
        graph(observed()),
        json([stack()]),
        json(stack()),
        json([stack()]),
        graph(observed(8)),
        json([stack()]),
        graph(
          observed(9, {
            headRefName: 'feature-final',
            headRefOid: 'd'.repeat(40),
            baseRefName: 'feature-top',
            baseRefOid: 'c'.repeat(40),
          }),
        ),
        json([]),
      ],
      json(
        stack([7, 8, 9], {
          pull_requests: [
            ...stack().pull_requests,
            {
              ...stack([9]).pull_requests[0],
              head: {
                ...stack([9]).pull_requests[0].head,
                ref: 'feature-final',
                sha: 'd'.repeat(40),
              },
              base: {
                ...stack([9]).pull_requests[0].base,
                ref: 'feature-top',
                sha: 'c'.repeat(40),
              },
            },
          ],
        }),
      ),
    ],
  ]
  for (const [name, args, reads, response] of cases)
    await t.test(name, async (t) => {
      const host = await fixture(t, [...reads, ...reads, response])
      const result = await host.execute(`github_${name}`, args)
      assert.equal(result.isError, false, JSON.stringify(result))
      const value = JSON.parse(result.value)
      assert.equal(value.outcome, 'confirmed', JSON.stringify(value))
      if (name === 'update_pull_request' && args.draft === false) {
        // Cross the producer/consumer boundary with the real tool result, not a
        // parallel hand-written change DTO that could mask a schema mismatch.
        const html = renderToStaticMarkup(
          React.createElement(PullRequestCard, {
            toolName: 'github_update_pull_request',
            block: cardBlock(value),
          }),
        )
        assert.match(html.replace(/<[^>]*>/g, ''), /Readiness\s*Draft\s*→\s*Ready for review/)
      }
      assert.equal(host.requests.length, name === 'create_pull_request' ? 0 : 1)
      if (name !== 'create_pull_request') assert.match(host.requests[0].reason, /exactPayload/)
      assert.equal(mutations(host.subprocess).length, 1)
      const spec = mutations(host.subprocess)[0]
      assert.ok(spec.argv.includes('X-GitHub-Api-Version: 2026-03-10'))
      const body = JSON.parse(spec.stdio.stdin.data)
      if (name === 'create_pull_request') assert.equal(body.draft, true)
      if (name === 'submit_pull_request_review') assert.equal(body.commit_id, SHA)
      if (name === 'add_pull_request_to_stack') assert.deepEqual(body, { pull_requests: [9] })
      if (name === 'create_pull_request_stack')
        assert.deepEqual(
          value.resource.pullRequests.nodes.map((pr) => pr.number),
          [7, 8],
        )
    })
})
test('independent rejection, stale prepared heads and uncertain dispatched responses never trigger another write', async (t) => {
  const rejected = await fixture(t, [graph(createObserved())], 'rejected')
  rejected.ctx.on('tools/pre-execute', () => ({ kind: 'ask', reason: 'Independent policy' }))
  assert.equal((await rejected.execute('github_create_pull_request', createArgs)).isError, true)
  assert.equal(mutations(rejected.subprocess).length, 0)
  const changed = createObserved()
  changed.repository.head.target.oid = BASE
  const stale = await fixture(t, [graph(createObserved()), graph(changed)])
  const conflict = await stale.execute('github_create_pull_request', createArgs)
  assert.match(conflict.value, /CONFLICT/)
  assert.equal(mutations(stale.subprocess).length, 0)
  const uncertain = await fixture(t, [
    graph(createObserved()),
    graph(createObserved()),
    { stdout: '', stderr: 'HTTP 503 github_pat_secret', exitCode: 1 },
  ])
  const result = await uncertain.execute('github_create_pull_request', createArgs)
  assert.equal(JSON.parse(result.value).outcome, 'uncertain')
  assert.doesNotMatch(result.value, /github_pat_secret|fresh approval/)
  assert.equal(mutations(uncertain.subprocess).length, 1)
})
test('PR preflight reports account changes before later permission rejection', async () => {
  const denied = createObserved({ viewerPermission: 'READ' })
  denied.viewer = { id: 'U_OTHER', login: 'other' }
  const subprocess = fakeSubprocess([graph(denied)])
  const observations = []
  await assert.rejects(
    createGitHubWriteRuntime(subprocess).prepare(
      'createPullRequest',
      createArgs,
      { agentId: 'session', cwd: '/fixture' },
      { onAccount: (account) => observations.push(account) },
    ),
    (error) => error.code === 'PERMISSION_DENIED',
  )
  assert.deepEqual(observations, [{ id: 'U_OTHER', login: 'other' }])
  assert.equal(mutations(subprocess).length, 0)
})

test('managed PR reads preserve REST nextPage and output bounds through the shared result envelope', async () => {
  const subprocess = fakeSubprocess([json([restPull()])])
  const result = await createGitHubPullRequestRuntime(subprocess).listPullRequests({
    owner: 'octocat',
    repo: 'example',
    limit: 1,
  })
  assert.equal(result.data.pullRequests.nextPage, 2)
  assert.equal(result.truncated, true)
  assert.equal(result.truncations[0].nextPage, 2)
  assert.match(result.truncations[0].continuation, /page parameter/)
})
