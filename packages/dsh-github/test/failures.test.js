import assert from 'node:assert/strict'
import test from 'node:test'
import { boundedResult, createGitHubRuntime, GitHubError } from '../src/runtime.js'
import { createGitHubTools } from '../src/tools.js'
import { fakeSubprocess, json, connection, exec } from './fixtures.js'
import { repository, detailedIssue, detailedProject } from './payloads.js'

const target = { owner: 'acme', repo: 'example' }
const secrets = 'ghp_SYNTHETIC_SECRET https://user:synthetic-password@github.com Authorization: Bearer synthetic-bearer'
const safeError = code => error => {
  assert.ok(error instanceof GitHubError)
  assert.equal(error.code, code)
  assert.doesNotMatch(JSON.stringify({ ...error, message: error.message }), /SYNTHETIC_SECRET|synthetic-password|synthetic-bearer|\/private\//)
  return true
}

test('missing CLI and resolver exceptions report fixed sanitized diagnostics', async () => {
  for (const options of [{ missing: 'gh' }, { resolveError: Object.assign(new Error(`/private/gh ${secrets}`), { code: 'ENOENT' }) }]) {
    const subprocess = fakeSubprocess([], options)
    const runtime = createGitHubRuntime(subprocess)
    await assert.rejects(runtime.getRepository(target, exec), safeError('CLI_UNAVAILABLE'))
    const status = await runtime.connectionStatus({}, exec)
    assert.equal(status.data.cliAvailable, false)
    assert.equal(status.data.account, null)
    assert.equal(status.data.diagnostic.code, 'CLI_UNAVAILABLE')
    assert.doesNotMatch(JSON.stringify(status), /SYNTHETIC_SECRET|\/private\/|synthetic-password/)
    assert.equal(subprocess.specs.length, 0)
  }
})

test('authentication, permissions, not-found and rate-limit errors do not retry or expose raw diagnostics', async () => {
  for (const [stderr, code] of [
    ['HTTP 401 Bad credentials', 'AUTH_REQUIRED'],
    ['HTTP 403 Resource not accessible', 'PERMISSION_DENIED'],
    ['HTTP 404 Not Found', 'NOT_FOUND'],
    ['HTTP 429 API rate limit exceeded', 'RATE_LIMITED'],
    ['unexpected backend failure', 'READ_FAILED'],
  ]) {
    const subprocess = fakeSubprocess([{ stderr: `${stderr} ${secrets}`, exitCode: 1 }])
    await assert.rejects(createGitHubRuntime(subprocess, { maxRetries: 2 }).getRepository(target, exec), safeError(code))
    assert.equal(subprocess.specs.length, 1)
  }
  const runtime = createGitHubRuntime(fakeSubprocess([{ stderr: `HTTP 401 ${secrets}`, exitCode: 1 }]))
  const status = await runtime.connectionStatus({}, exec)
  assert.equal(status.data.cliAvailable, true)
  assert.equal(status.data.authenticated, false)
  assert.equal(status.data.diagnostic.code, 'AUTH_REQUIRED')
})

test('GraphQL errors override partial data and remain sanitized', async () => {
  const subprocess = fakeSubprocess([json({ data: { repository }, errors: [{ message: `Resource not accessible ${secrets}` }] })])
  await assert.rejects(createGitHubRuntime(subprocess).getRepository(target, exec), safeError('PERMISSION_DENIED'))
  assert.equal(subprocess.specs.length, 1)
})

test('network failures retry identical read-only argv within the configured hard cap', async () => {
  const subprocess = fakeSubprocess([{ stderr: `HTTP 503 ${secrets}`, exitCode: 1 }, json({ data: { repository } })])
  const result = await createGitHubRuntime(subprocess).getRepository(target, exec)
  assert.equal(result.data.id, 'R_1')
  assert.equal(subprocess.specs.length, 2)
  assert.deepEqual(subprocess.specs[0].argv, subprocess.specs[1].argv)
  for (const [maxRetries, expectedCalls] of [[0, 1], [1, 2], [2, 3], [99, 3]]) {
    const failed = fakeSubprocess(() => ({ stderr: 'HTTP 502 temporarily unavailable', exitCode: 1 }))
    await assert.rejects(createGitHubRuntime(failed, { maxRetries }).getRepository(target, exec), safeError('NETWORK_ERROR'))
    assert.equal(failed.specs.length, expectedCalls)
  }
  const graphql = fakeSubprocess([json({ errors: [{ message: 'network connection temporarily unavailable' }] }), json({ data: { repository } })])
  assert.equal((await createGitHubRuntime(graphql).getRepository(target, exec)).data.id, 'R_1')
  assert.equal(graphql.specs.length, 2)
})

test('spawn errors, malformed JSON, invalid connection payloads and absent resources fail closed', async () => {
  for (const [run, code] of [
    [{ spawnError: new Error(secrets) }, 'CLEANUP_FAILED'],
    [{ stdout: secrets }, 'INVALID_RESPONSE'],
    [json([]), 'INVALID_RESPONSE'],
    [json(null), 'INVALID_RESPONSE'],
    [json({ data: { repository: null } }), 'NOT_FOUND'],
    [json({ data: { repository: 'not-an-object' } }), 'INVALID_RESPONSE'],
    [json({ data: { repository: [] } }), 'INVALID_RESPONSE'],
    [json({ data: { repository: {} } }), 'INVALID_RESPONSE'],
    [json({ data: { repository: { ...repository, url: 'javascript:alert(1)' } } }), 'INVALID_RESPONSE'],
  ]) {
    const subprocess = fakeSubprocess([run])
    await assert.rejects(createGitHubRuntime(subprocess).getRepository(target, exec), safeError(code))
    assert.equal(subprocess.specs.length, 1)
  }
  for (const value of [{ nodes: [] }, { nodes: {}, pageInfo: { hasNextPage: false } }, { nodes: [], pageInfo: { hasNextPage: true } }]) {
    const subprocess = fakeSubprocess([json({ data: { repositoryOwner: { repositories: value } } })])
    await assert.rejects(createGitHubRuntime(subprocess).listRepositories({ owner: 'acme' }, exec), safeError('INVALID_RESPONSE'))
  }
})

test('lossy or oversized subprocess stdout never returns partial JSON or retries', async () => {
  for (const [run, config] of [
    [{ ...json({ data: { repository } }), lossy: true }, {}],
    [json({ data: { repository } }), { maxOutputBytes: 10 }],
  ]) {
    const subprocess = fakeSubprocess([run])
    await assert.rejects(createGitHubRuntime(subprocess, config).getRepository(target, exec), safeError('OUTPUT_TOO_LARGE'))
    assert.equal(subprocess.specs.length, 1)
    assert.ok(subprocess.specs[0].stdio.stdout.maxBytes <= 1048576)
  }
})

test('timeouts abort managed execution and do not retry', async () => {
  const subprocess = fakeSubprocess([{ pending: true }])
  await assert.rejects(createGitHubRuntime(subprocess, { timeoutMs: 5, maxRetries: 2 }).getRepository(target, exec), safeError('TIMEOUT'))
  assert.equal(subprocess.specs.length, 1)
  assert.equal(subprocess.specs[0].signal.aborted, true)
})

test('caller cancellation aborts active execution and pre-cancelled calls never resolve a CLI', async () => {
  const controller = new AbortController()
  const subprocess = fakeSubprocess(() => { queueMicrotask(() => controller.abort()); return { pending: true } })
  await assert.rejects(createGitHubRuntime(subprocess).getRepository(target, { ...exec, signal: controller.signal }), safeError('CANCELLED'))
  assert.equal(subprocess.specs.length, 1)
  assert.equal(subprocess.specs[0].signal.aborted, true)
  const untouched = fakeSubprocess([])
  await assert.rejects(createGitHubRuntime(untouched).getRepository(target, { ...exec, signal: controller.signal }), safeError('CANCELLED'))
  assert.equal(untouched.resolutions.length, 0)
})

test('CLI resolution itself receives timeout and caller cancellation signals', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController()
    let receivedSignal
    const subprocess = {
      async resolveExecutable(command, options, signal) {
        assert.equal(command, 'gh')
        receivedSignal = signal
        if (cancel) queueMicrotask(() => controller.abort())
        await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
        throw new Error(secrets)
      },
      spawn() { assert.fail('no spawn after failed resolution') },
    }
    await assert.rejects(createGitHubRuntime(subprocess, { timeoutMs: 5 }).getRepository(target, { ...exec, signal: controller.signal }), safeError(cancel ? 'CANCELLED' : 'TIMEOUT'))
    assert.equal(receivedSignal.aborted, true)
  }
})

test('large text and non-paginated project options expose precise non-continuable truncation', async () => {
  const payload = { ...detailedProject, readme: 'x'.repeat(9000), fields: connection([{ ...detailedProject.fields.nodes[0], options: Array.from({ length: 55 }, (_, i) => ({ id: `O_${i}`, name: `Option ${i}` })) }]), repositories: connection([]) }
  const subprocess = fakeSubprocess([json({ data: { repositoryOwner: { projectV2: payload } } })])
  const result = await createGitHubRuntime(subprocess).getProject({ owner: 'acme', projectNumber: 7 }, exec)
  assert.equal(result.data.readme.length, 8192)
  assert.equal(result.data.fields.nodes[0].options.length, 50)
  assert.equal(result.truncated, true)
  assert.ok(result.truncations.some(row => row.path === 'data.readme' && row.kind === 'text' && row.continuation === null))
  assert.ok(result.truncations.some(row => row.path.endsWith('.options') && row.kind === 'array' && row.totalCount === 55 && row.continuation === null))
})

test('sanitized cursor text cannot reappear raw in nextCursor or truncation metadata', () => {
  const result = boundedResult(connection([], true, 'ghp_SYNTHETIC_SECRET'))
  assert.doesNotMatch(JSON.stringify(result), /ghp_SYNTHETIC_SECRET/)
  assert.equal(result.data.nextCursor, result.data.pageInfo.endCursor)
  assert.equal(result.truncations[0].nextCursor, result.data.nextCursor)
})

test('result byte bounds fail closed and issue body secrets are sanitized', async () => {
  assert.throws(() => boundedResult({ id: 'x'.repeat(2000) }, { maxResultBytes: 256 }), safeError('OUTPUT_TOO_LARGE'))
  const subprocess = fakeSubprocess([json({ data: { repository: { issue: { ...detailedIssue, body: secrets } } } })])
  const result = await createGitHubRuntime(subprocess).getIssue({ ...target, issueNumber: 33 }, exec)
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SECRET|synthetic-password|synthetic-bearer/)
})

test('discovery handles no remotes and rejects malformed or oversized remote inventories', async () => {
  const empty = fakeSubprocess([{ stdout: '/fixture/root' }, { stdout: '' }])
  const result = await createGitHubRuntime(empty).detectRepositories({}, exec)
  assert.equal(result.data.gitRepository, true)
  assert.equal(result.data.ambiguous, false)
  assert.deepEqual(result.data.candidates, [])
  assert.equal(empty.specs.length, 2)
  for (const [stdout, code] of [
    ['malformed remote line', 'INVALID_RESPONSE'],
    [Array.from({ length: 101 }, (_, i) => `r${i}\tgit@github.com:acme/example.git (fetch)`).join('\n'), 'OUTPUT_TOO_LARGE'],
    [Array.from({ length: 21 }, (_, i) => `r${i}\tgit@github.com:acme/repo${i}.git (fetch)`).join('\n'), 'OUTPUT_TOO_LARGE'],
  ]) {
    const subprocess = fakeSubprocess([{ stdout: '/fixture/root' }, { stdout }])
    await assert.rejects(createGitHubRuntime(subprocess).detectRepositories({}, exec), safeError(code))
    assert.equal(subprocess.specs.length, 2, 'reject inventory before GitHub reads')
  }
  const missing = fakeSubprocess([], { missing: 'git' })
  await assert.rejects(createGitHubRuntime(missing).detectRepositories({}, exec), safeError('CLI_UNAVAILABLE'))
})

test('tool wrappers never expose arbitrary runtime exception properties or credentials', async () => {
  for (const error of [Object.assign(new Error(secrets), { stdout: secrets, stderr: secrets, path: '/private/gh' }), new GitHubError('AUTH_REQUIRED', 'Authentication required.')]) {
    const tools = createGitHubTools({ getRepository: async () => { throw error } })
    const value = JSON.parse(await tools.find(tool => tool.name === 'github_get_repository').execute(target, {}))
    assert.equal(value.error.code, error instanceof GitHubError ? 'AUTH_REQUIRED' : 'READ_FAILED')
    assert.doesNotMatch(JSON.stringify(value), /SYNTHETIC_SECRET|synthetic-password|synthetic-bearer|\/private\//)
  }
})
