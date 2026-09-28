import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createGitHubReads, mountGitHubReads } from '../src/reads.js'
import { createGitHubRuntime } from '../src/runtime.js'
import { fakeSubprocess, json, connection } from './fixtures.js'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const { Context } = await import(pathToFileURL(cli.resolve('@deepseek-ai/cordis')).href)

test('GitHub facade preserves envelope and paging through shared runtime without a session', async () => {
  const subprocess = fakeSubprocess([
    json({ data: { repository: { issues: connection([], true, 'next') } } }),
  ])
  const { service } = createGitHubReads(createGitHubRuntime(subprocess))
  assert.deepEqual(Object.keys(service), [
    'listIssues',
    'getIssue',
    'listProjectItems',
    'getProject',
  ])
  const result = await service.listIssues({ owner: 'acme', repo: 'repo' })
  assert.equal(result.host, 'github.com')
  assert.equal(result.untrusted, true)
  assert.equal(result.truncated, true)
  assert.equal(result.data.nextCursor, 'next')
  assert.equal(subprocess.specs[0].cwd, '/')
  await assert.rejects(service.listIssues({ owner: 'acme', repo: 'repo', mutation: true }), {
    code: 'INVALID_ARGUMENT',
  })
  assert.equal(subprocess.specs.length, 1)
})

test('GitHub facade sanitizes unexpected failures and rejects disposed calls', async () => {
  const reads = createGitHubReads({
    getProject: () => {
      throw new Error('secret ghp_private')
    },
  })
  await assert.rejects(
    reads.service.getProject({}),
    (error) => error.code === 'READ_FAILED' && !/private/.test(error.message),
  )
  reads.dispose()
  await assert.rejects(reads.service.getProject({}), { code: 'CANCELLED' })
})

test('real Cordis disposal cancels shared reads and unregisters the facade', async () => {
  const ctx = new Context()
  let signal
  const runtime = {
    listIssues: (_, exec) =>
      new Promise((resolve) => {
        signal = exec.signal
        signal.addEventListener('abort', () => resolve({ cancelled: true }), { once: true })
      }),
  }
  const plugin = ctx.plugin({
    name: 'github-read-fixture',
    apply: (child) => {
      mountGitHubReads(child, runtime)
    },
  })
  await plugin.await()
  const reads = ctx.get('localGitHubReads')
  const pending = reads.listIssues({})
  await plugin.dispose()
  await pending
  assert.equal(signal.aborted, true)
  assert.equal(ctx.get('localGitHubReads'), undefined)
  await ctx.fiber.dispose()
})
