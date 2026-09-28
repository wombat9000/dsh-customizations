import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createLinearReads, mountLinearReads } from '../src/reads.js'
import { LinearRuntime } from '../src/runtime.js'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const { Context } = await import(pathToFileURL(cli.resolve('@deepseek-ai/cordis')).href)

test('Linear read facade preserves native projected results and narrow surface', async () => {
  const result = {
    issues: [{ id: 'i', identifier: 'ENG-1', title: 'Issue' }],
    pageInfo: { hasNextPage: true, nextCursor: 'next' },
  }
  const calls = []
  const runtime = Object.fromEntries(
    ['listIssues', 'getIssue', 'getProject'].map((method) => [
      method,
      async (args, signal) => {
        calls.push({ method, args, signal })
        return result
      },
    ]),
  )
  const { service } = createLinearReads(runtime)
  assert.deepEqual(Object.keys(service), ['listIssues', 'getIssue', 'getProject'])
  for (const [method, args] of [
    ['listIssues', { project: 'p', limit: 20 }],
    ['getIssue', { issue: 'ENG-1' }],
    ['getProject', { project: 'p' }],
  ]) {
    assert.equal(await service[method](args), result)
    assert.deepEqual(calls.at(-1).args, args)
    assert.ok(calls.at(-1).signal instanceof AbortSignal)
  }
  for (const args of [
    { limit: 51 },
    { priorities: [9] },
    { mutation: true },
    { states: ['started'] },
  ]) {
    await assert.rejects(service.listIssues(args), { code: 'INVALID_ARGUMENT' })
  }
  await assert.rejects(service.getIssue({}), { code: 'INVALID_ARGUMENT' })
  assert.equal(calls.length, 3)
})

test('Linear cancellation and deadline cover uncooperative credential/runtime work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal
  const reads = createLinearReads(
    {
      listIssues: (_, next) => {
        signal = next
        return new Promise(() => {})
      },
    },
    { timeoutMs: 10 },
  )
  const pending = reads.service.listIssues({})
  await Promise.resolve()
  t.mock.timers.tick(10)
  await assert.rejects(pending, { code: 'TIMEOUT' })
  assert.equal(signal.aborted, true)
  const controller = new AbortController()
  const cancelled = reads.service.listIssues({}, { signal: controller.signal })
  controller.abort()
  await assert.rejects(cancelled, { code: 'CANCELLED' })
  reads.dispose()
  await assert.rejects(reads.service.listIssues({}), { code: 'CANCELLED' })
})

test('Linear facade hides arbitrary SDK and credential diagnostics', async () => {
  const { service } = createLinearReads({
    getProject: () => {
      throw new Error('Linear secret lin_api_private Authorization: Bearer private')
    },
  })
  await assert.rejects(
    service.getProject({ project: 'p' }),
    (error) => error.code === 'READ_FAILED' && !/private|Bearer/.test(error.message),
  )
})

test('cancelled credential resolution never starts a late SDK request', async () => {
  let resolveKey
  let created = 0
  const runtime = new LinearRuntime({
    settings: () => ({}),
    resolveApiKey: () =>
      new Promise((resolve) => {
        resolveKey = resolve
      }),
    createClient: () => {
      created++
      throw new Error('unexpected SDK creation')
    },
  })
  const reads = createLinearReads(runtime)
  const pending = reads.service.listIssues({})
  await Promise.resolve()
  reads.dispose()
  await assert.rejects(pending, { code: 'CANCELLED' })
  resolveKey('fixture-key')
  await Promise.resolve()
  assert.equal(created, 0)
})

test('real Cordis owns facade registration and disposal', async () => {
  const ctx = new Context()
  const runtime = { listIssues: () => new Promise(() => {}) }
  const plugin = ctx.plugin({
    name: 'linear-read-fixture',
    apply: (child) => {
      mountLinearReads(child, runtime)
    },
  })
  await plugin.await()
  const service = ctx.get('localLinearReads')
  assert.ok(service)
  const pending = service.listIssues({})
  const rejected = assert.rejects(pending, { code: 'CANCELLED' })
  await plugin.dispose()
  await rejected
  assert.equal(ctx.get('localLinearReads'), undefined)
  await ctx.fiber.dispose()
})
