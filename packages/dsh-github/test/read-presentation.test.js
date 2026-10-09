import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { createGitHubTools } from '../dist/src/tools.js'
import { approvalHost } from './approval-fixture.js'
import { registerTypeScript } from './source-loader.mjs'
import {
  cardEnvelope,
  cardPullRequest,
  cardBlock,
  cardWriteEnvelope,
} from './pull-request-card-fixtures.js'
import { issue } from './payloads.js'
import { connection } from './fixtures.js'
registerTypeScript()
const { pullRequestCardModel } = await import('../client/pull-request-model.ts')
const { readCardModel } = await import('../client/read-models.ts')
const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const spillPolicy = await import(pathToFileURL(cli.resolve('@deepseek-ai/dsh-spill-policy')).href)

const toolName = 'github_get_pull_request_files'
const args = { owner: 'fixture-org', repo: 'demo', pullNumber: 61, limit: 50 }
const envelope = () =>
  cardEnvelope({
    pullRequest: cardPullRequest,
    files: {
      nodes: Array.from({ length: 15 }, (_, index) => ({
        path: `src/change-${index}.ts`,
        status: 'modified',
        additions: 7,
        deletions: 2,
        sha: 'a'.repeat(40),
        patch: 'fixture diff line\n'.repeat(600),
        patchCompleteness: 'unverified',
      })),
      totalCount: 15,
      pageInfo: { page: 1, hasNextPage: true, nextPage: 2 },
      nextPage: 2,
    },
    warnings: ['Patch completeness is not verified.'],
  })

test('real Tools retention preserves a bounded GitHub card snapshot without refetching', async (t) => {
  const host = await approvalHost(t, { approval: false })
  const saved = []
  host.ctx.provide('spillStore', {
    async saveText(request) {
      saved.push(request.content)
      return { locator: '/fixture/saved-result.txt', retrievalHint: 'Use read to inspect it.' }
    },
  })
  await host.ctx.plugin(spillPolicy, { maxInlineTokens: 1000 }).await()
  let calls = 0
  for (const tool of createGitHubTools({
    async getPullRequestFiles() {
      calls++
      return envelope()
    },
  }))
    host.tools.register(tool)
  const result = await host.execute(toolName, args)
  assert.equal(result.isError, false)
  assert.equal(calls, 1)
  assert.equal(saved.length, 1)
  assert.deepEqual(JSON.parse(saved[0]), JSON.parse(result.value))
  assert.throws(() => JSON.parse(result.content[0].text))
  assert.match(result.content[0].text, /Full formatted result stored at/)
  assert.ok(result.meta, 'snapshot must survive the real spill policy')
  assert.ok(Buffer.byteLength(JSON.stringify(result.meta)) <= 65536)
  assert.doesNotMatch(JSON.stringify(result.meta), /fixture diff line/)
  const block = { kind: 'tool-result', call: { argsRaw: JSON.stringify(args) }, ...result }
  const model = pullRequestCardModel(toolName, block)
  assert.equal(model.status, '15 entries returned')
  assert.equal(model.total, 15)
  assert.equal(model.entries[14].path, 'src/change-14.ts')
  assert.equal(model.entries[14].sha, 'a'.repeat(40))
  assert.equal(model.completeness, 'partial')
  assert.match(model.warnings.join(' '), /not complete/)
  assert.match(model.warnings.join(' '), /Card preview text bound/)
  assert.equal(calls, 1, 'card parsing must not execute another GitHub call')
})

test('unavailable read snapshots never turn a valid result or a backend error into invalid Tool output', async (t) => {
  const host = await approvalHost(t, { approval: false })
  let fail = false
  for (const tool of createGitHubTools({
    async getPullRequestFiles() {
      if (fail) throw new Error('Unexpected backend failure')
      return cardEnvelope({ nodes: [{ ...issue, id: 'x'.repeat(70000) }] })
    },
  }))
    host.tools.register(tool)
  const oversized = await host.execute(toolName, args)
  assert.equal(oversized.isError, false)
  assert.equal(oversized.meta, null)
  assert.ok(JSON.parse(oversized.value).data)
  fail = true
  const error = await host.execute(toolName, args)
  assert.equal(error.isError, false)
  assert.equal(error.meta, null)
  assert.equal(JSON.parse(error.value).error.code, 'READ_FAILED')
  assert.equal(pullRequestCardModel(toolName, { kind: 'tool-result', ...error }).status, 'Failed')
})

test('historical shortened results explain the missing summary; invalid snapshots never infer entries', () => {
  const text =
    '{"host":"github.com",[...]\n\n(Omitted 300 bytes. Full formatted result stored at: /fixture/result.txt. Use read to inspect it.)'
  const block = { kind: 'tool-result', content: [{ type: 'text', text }] }
  for (const [name, model] of [
    [toolName, pullRequestCardModel],
    ['github_list_issues', readCardModel],
  ]) {
    for (const preview of [text, text.split('\n\n')[1]]) {
      const missing = model(name, { ...block, content: [{ type: 'text', text: preview }] })
      assert.match(missing.error, /DSH shortened this result/)
      assert.equal(missing.entries.length, 0)
      assert.equal(missing.completeness, 'unknown')
    }
    const validEnvelope =
      name === toolName
        ? cardEnvelope({
            files: {
              nodes: [{ path: 'src/change.ts', status: 'modified' }],
              totalCount: 1,
              pageInfo: { page: 1, hasNextPage: false, nextPage: null },
            },
          })
        : cardEnvelope(connection([issue]))
    const validMeta = {
      kind: 'github-read-card',
      version: 1,
      toolName: name,
      envelope: validEnvelope,
    }
    assert.equal(model(name, { ...block, meta: validMeta }).error, undefined)
    for (const meta of [
      { ...validMeta, version: 2 },
      { ...validMeta, padding: 'x'.repeat(70000) },
      {
        kind: 'github-read-card',
        version: 1,
        toolName: 'github_get_project',
        envelope: validEnvelope,
      },
      { kind: 'github-read-card', version: 1, toolName: name, envelope: { host: 'example.org' } },
      {
        kind: 'github-read-card',
        version: 1,
        toolName: name,
        envelope: { host: 'github.com', untrusted: true, data: {} },
      },
    ])
      assert.equal(model(name, { ...block, meta }).entries.length, 0)
    const failed = model(name, {
      ...block,
      isError: true,
      meta: {
        kind: 'github-read-card',
        version: 1,
        toolName: name,
        envelope: validEnvelope,
      },
    })
    assert.equal(failed.entries.length, 0)
  }
  const raw = cardBlock(cardWriteEnvelope(cardPullRequest))
  raw.content = block.content
  raw.meta = {
    kind: 'github-read-card',
    version: 1,
    toolName: 'github_create_pull_request',
    envelope: cardWriteEnvelope(cardPullRequest),
  }
  assert.notEqual(pullRequestCardModel('github_create_pull_request', raw).status, 'Confirmed')
})

test('issue cards consume read snapshots while preserving nested continuation and small descriptions', () => {
  const data = { ...connection([issue], true, 'next-issues'), totalCount: 20 }
  const value = JSON.stringify(cardEnvelope(data))
  const tool = createGitHubTools({}).find((tool) => tool.name === 'github_list_issues')
  const meta = tool.output.presentationMeta({}, value)
  const model = readCardModel(tool.name, {
    kind: 'tool-result',
    meta,
    content: [{ type: 'text', text: 'shortened' }],
  })
  assert.equal(model.state, 'returned')
  assert.equal(model.entries[0].id, issue.id)
  assert.equal(model.total, 20)
  assert.equal(model.completeness, 'partial')
  assert.match(model.warnings.join(' '), /next-issues|not complete/)
  assert.deepEqual(meta.envelope.data, data)
  const oversized = JSON.stringify(cardEnvelope({ nodes: [{ ...issue, id: 'x'.repeat(70000) }] }))
  assert.equal(tool.output.presentationMeta({}, oversized), null)
})
