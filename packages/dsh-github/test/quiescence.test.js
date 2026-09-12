import assert from 'node:assert/strict'
import test from 'node:test'
import { runCollected, createGitHubRuntime, isGitHubBackendFenced } from '../src/runtime.js'
import { createGitHubWriteRuntime } from '../src/write-runtime.js'
import { fakeSubprocess, json } from './fixtures.js'
import { args, snapshot, mutationResult } from './write-payloads.js'

const exec = { cwd: '/fixture/session-a', agentId: 'fixture-agent', signal: new AbortController().signal }
const runOptions = { argv: ['/fixture/bin/gh', '--version'], cwd: exec.cwd, timeoutMs: 1000, cleanupTimeoutMs: 20 }
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('command completion does not finish a write or release its queue before managed range quiescence', async () => {
  const cleanupStarted = deferred(), release = deferred()
  let mutationCount = 0, terminated = 0
  const subprocess = fakeSubprocess(spec => {
    const mutation = JSON.parse(spec.stdio.stdin.data).query.startsWith('mutation')
    if (!mutation) return json({ data: snapshot('createIssue') })
    mutationCount++
    const response = json({ data: mutationResult('createIssue') })
    return mutationCount === 1 ? {
      ...response,
      onTerminate() { terminated++ },
      async waitForExit(signal) {
        assert.equal(signal.aborted, false)
        assert.notEqual(signal, spec.signal)
        cleanupStarted.resolve()
        return release.promise
      },
    } : response
  })
  const runtime = createGitHubWriteRuntime(subprocess)
  const a = await runtime.prepare('createIssue', args.createIssue, exec)
  const b = await runtime.prepare('createIssue', args.createIssue, exec)
  let firstReturned = false
  const first = runtime.execute(a, exec).then(result => { firstReturned = true; return result })
  await cleanupStarted.promise
  const second = runtime.execute(b, exec)
  await new Promise(setImmediate)
  assert.equal(terminated, 1)
  assert.equal(firstReturned, false)
  assert.equal(subprocess.specs.length, 4, 'second execute cannot run its recheck while the first mutation range survives')
  release.resolve(true)
  assert.equal((await first).outcome, 'confirmed')
  assert.equal((await second).outcome, 'confirmed')
  assert.equal(mutationCount, 2)
  assert.equal(subprocess.specs.length, 6)
})

test('cleanup uses a separate live signal even after caller cancellation', async () => {
  const controller = new AbortController()
  let cleanupSignal, terminated = 0
  const subprocess = fakeSubprocess(spec => {
    queueMicrotask(() => controller.abort())
    return {
      pending: true,
      onTerminate() { terminated++ },
      async waitForExit(signal) {
        cleanupSignal = signal
        assert.equal(spec.signal.aborted, true)
        assert.equal(signal.aborted, false)
        return true
      },
    }
  })
  await assert.rejects(runCollected(subprocess, { ...runOptions, signal: controller.signal }), { code: 'CANCELLED' })
  assert.equal(terminated, 1)
  assert.ok(cleanupSignal)
  assert.equal(isGitHubBackendFenced(subprocess), false)
})

test('false, throwing and timed-out cleanup fences the shared backend instead of reporting success', async t => {
  for (const [label, waitForExit] of [
    ['false', async () => false],
    ['throwing', async () => { throw new Error('ghp_SYNTHETIC_SECRET') }],
    ['timeout', async () => new Promise(() => {})],
  ]) await t.test(label, async () => {
    const subprocess = fakeSubprocess([{ stdout: 'synthetic success', waitForExit }])
    await assert.rejects(runCollected(subprocess, runOptions), error => {
      assert.equal(error.code, 'CLEANUP_FAILED')
      assert.doesNotMatch(error.message, /SYNTHETIC_SECRET/)
      return true
    })
    assert.equal(isGitHubBackendFenced(subprocess), true)
    await assert.rejects(createGitHubRuntime(subprocess).getRepository({ owner: 'source', repo: 'example' }, exec), { code: 'CLEANUP_FAILED' })
    await assert.rejects(createGitHubWriteRuntime(subprocess).prepare('createIssue', args.createIssue, exec), { code: 'CLEANUP_FAILED' })
    assert.equal(subprocess.specs.length, 1)
  })
})

test('mutation cleanup failure reports uncertainty and prevents all subsequent work on that backend', async () => {
  const subprocess = fakeSubprocess([
    json({ data: snapshot('createIssue') }), json({ data: snapshot('createIssue') }),
    { ...json({ data: mutationResult('createIssue') }), waitForExit: async () => false },
  ])
  const runtime = createGitHubWriteRuntime(subprocess)
  const prepared = await runtime.prepare('createIssue', args.createIssue, exec)
  const result = await runtime.execute(prepared, exec)
  assert.equal(result.outcome, 'uncertain')
  assert.equal(result.resource, undefined)
  assert.equal(isGitHubBackendFenced(subprocess), true)
  await assert.rejects(runtime.prepare('createIssue', args.createIssue, exec), { code: 'CLEANUP_FAILED' })
  assert.equal(subprocess.specs.length, 3)
})
