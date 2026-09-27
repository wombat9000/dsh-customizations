import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { TYPERT_REMOTE } from '../lib/types/remote.js'

// Use the approved launcher's actual loader, not a permissive manifest mock.
const require = createRequire(import.meta.url)
const launcherRequire = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const { validateTypertManifest } = await import(
  pathToFileURL(launcherRequire.resolve('@deepseek-ai/dsh-typert-loader')).href
)
import {
  DEFAULT_STDOUT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
  parseGitEnvironmentResult,
  readSessionEnvironment,
  resolveConfig,
} from '../lib/index.js'
import { TYPERT } from '../lib/types/typert.host.js'

function shellResult(stdout, overrides = {}) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    stdout: { text: stdout, truncated: false },
    stderr: { text: '', truncated: false },
    ...overrides,
  }
}

function repositoryOutput({
  branch = 'main',
  upstream = 'origin/main',
  ahead = 0,
  behind = 0,
  status = [],
  numstat = [],
} = {}) {
  return [
    '__DSH_INSIDE__',
    'true',
    '__DSH_BRANCH__',
    branch,
    '__DSH_UPSTREAM__',
    ...(upstream === null
      ? ['__DSH_NO_UPSTREAM__']
      : [upstream, '__DSH_AHEAD_BEHIND__', `${ahead}\t${behind}`]),
    '__DSH_STATUS__',
    ...status,
    '__DSH_NUMSTAT__',
    ...numstat,
    '',
  ].join('\n')
}

test('parses branch, upstream divergence, dirty file count, and tracked line totals', () => {
  const snapshot = parseGitEnvironmentResult({
    cwd: '/repo',
    home: '/home/tester',
    result: shellResult(
      repositoryOutput({
        branch: 'feature/native-plugin',
        upstream: 'origin/feature/native-plugin',
        ahead: 2,
        behind: 3,
        status: [' M tracked.txt', '?? untracked.txt'],
        numstat: ['3\t2\ttracked.txt', '-\t-\tbinary.dat'],
      }),
    ),
  })

  assert.deepEqual(snapshot, {
    cwd: '/repo',
    home: '/home/tester',
    repo: true,
    hasHead: true,
    branch: 'feature/native-plugin',
    upstream: 'origin/feature/native-plugin',
    ahead: 2,
    behind: 3,
    dirtyFiles: 2,
    additions: 3,
    deletions: 2,
  })
})

test('parses synced, ahead, behind, diverged, and no-upstream states', () => {
  for (const state of [
    { upstream: 'origin/main', ahead: 0, behind: 0 },
    { upstream: 'origin/main', ahead: 2, behind: 0 },
    { upstream: 'origin/main', ahead: 0, behind: 3 },
    { upstream: 'origin/main', ahead: 2, behind: 3 },
    { upstream: null, ahead: null, behind: null },
  ]) {
    const snapshot = parseGitEnvironmentResult({
      cwd: '/repo',
      home: '/home/tester',
      result: shellResult(repositoryOutput(state)),
    })
    assert.equal(snapshot.upstream, state.upstream)
    assert.equal(snapshot.ahead, state.ahead)
    assert.equal(snapshot.behind, state.behind)
  }
})

test('handles non-repositories and repositories without commits', () => {
  assert.equal(
    parseGitEnvironmentResult({
      cwd: '/tmp',
      home: '/home/tester',
      result: shellResult('__DSH_NOT_REPO__\n'),
    }).repo,
    false,
  )

  assert.deepEqual(
    parseGitEnvironmentResult({
      cwd: '/repo',
      home: '/home/tester',
      result: shellResult('__DSH_INSIDE__\ntrue\n__DSH_NO_HEAD__\n'),
    }),
    {
      cwd: '/repo',
      home: '/home/tester',
      repo: true,
      hasHead: false,
      branch: null,
      upstream: null,
      ahead: null,
      behind: null,
      dirtyFiles: null,
      additions: null,
      deletions: null,
    },
  )
})

test('reports bounded execution failures', () => {
  assert.equal(
    parseGitEnvironmentResult({
      cwd: '/repo',
      home: '/home/tester',
      result: shellResult('', { timedOut: true }),
    }).error,
    'Git check timed out',
  )
  assert.equal(
    parseGitEnvironmentResult({
      cwd: '/repo',
      home: '/home/tester',
      result: shellResult('', { stdout: { text: '', truncated: true } }),
    }).error,
    'Repository status is too large',
  )
})

test('reads the live session cwd through the Shell service', async () => {
  let resolved
  const ctx = {
    sessions: { get: () => ({ header: { cwd: '/workspace/demo' } }) },
    shell: {
      resolve(request) {
        resolved = request
        return request
      },
      async execute(spec) {
        assert.equal(spec, resolved)
        return { result: async () => shellResult('__DSH_NOT_REPO__\n') }
      },
    },
  }
  const controller = new AbortController()
  const snapshot = await readSessionEnvironment(
    ctx,
    { sessionId: 'session-test' },
    resolveConfig(),
    controller.signal,
  )
  assert.equal(snapshot.cwd, '/workspace/demo')
  assert.equal(snapshot.repo, false)
  assert.equal(resolved.workdir, '/workspace/demo')
  assert.equal(resolved.timeoutMs, DEFAULT_TIMEOUT_MS)
  assert.equal(resolved.stdoutMaxBytes, DEFAULT_STDOUT_MAX_BYTES)
  assert.equal(resolved.signal, controller.signal)
})

test('execution preparation and result failures remain bounded and cancellation-aware', async () => {
  for (const failDuring of ['execute', 'result']) {
    for (const cancelled of [false, true]) {
      const controller = new AbortController()
      if (cancelled) controller.abort()
      const ctx = {
        sessions: { get: () => ({ header: { cwd: '/workspace/demo' } }) },
        shell: {
          resolve: (request) => request,
          async execute() {
            if (failDuring === 'execute') throw new Error('private infrastructure details')
            return {
              result: async () => {
                throw new Error('private infrastructure details')
              },
            }
          },
        },
      }
      const snapshot = await readSessionEnvironment(
        ctx,
        { sessionId: 'session-test' },
        resolveConfig(),
        controller.signal,
      )
      assert.equal(snapshot.error, cancelled ? 'Git check cancelled' : 'Unable to read Git state')
    }
  }
})

test('real target loader accepts both faces and rejects legacy eager codecs', () => {
  assert.equal(validateTypertManifest(TYPERT.package, TYPERT), TYPERT)
  assert.equal(TYPERT.invocations, TYPERT_REMOTE.descriptors)
  const descriptor = TYPERT.invocations[0]
  const parameter = descriptor.parameters[0]
  const legacyCodec = (codec) => ({
    mode: codec.mode,
    typeSymbol: codec.typeSymbol,
    schema: codec.create(),
  })
  for (const invocation of [
    { ...descriptor, parameters: [{ ...parameter, codec: legacyCodec(parameter.codec) }] },
    { ...descriptor, result: legacyCodec(descriptor.result) },
  ]) {
    assert.throws(
      () => validateTypertManifest(TYPERT.package, { ...TYPERT, invocations: [invocation] }),
      /has no create\(\) factory/,
    )
  }
})

test('lazy codecs preserve strict request and snapshot validation on both faces', () => {
  const snapshot = {
    cwd: null,
    home: '/home/tester',
    repo: null,
    hasHead: null,
    branch: null,
    upstream: null,
    ahead: null,
    behind: null,
    dirtyFiles: null,
    additions: null,
    deletions: null,
  }
  for (const descriptor of [TYPERT.invocations[0], TYPERT_REMOTE.descriptors[0]]) {
    const request = descriptor.parameters[0].codec.create()
    for (const invalid of [
      null,
      {},
      { sessionId: '' },
      { sessionId: 1 },
      { sessionId: 'abc', command: 'unsafe' },
    ])
      assert.throws(() => request.parse(invalid))
    assert.deepEqual(request.parse({ sessionId: 'abc' }), { sessionId: 'abc' })
    const result = descriptor.result.create()
    assert.deepEqual(result.parse(snapshot), snapshot)
    for (const invalid of [
      null,
      {},
      { ...snapshot, ahead: -1 },
      { ...snapshot, dirtyFiles: 0.5 },
      { ...snapshot, repo: 'true' },
      { ...snapshot, extra: 'unsafe' },
    ])
      assert.throws(() => result.parse(invalid))
  }
})

test('validates config and publishes a strict cancellable Remote descriptor', () => {
  assert.deepEqual(resolveConfig(), {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    stdoutMaxBytes: DEFAULT_STDOUT_MAX_BYTES,
  })
  assert.throws(() => resolveConfig({ timeoutMs: 0 }), /positive safe integer/)
  const descriptor = TYPERT.invocations[0]
  assert.equal(descriptor.namespace, 'sessionEnvironment')
  assert.equal(descriptor.method, 'read')
  assert.deepEqual(descriptor.cancellation, { parameter: 'signal' })
  assert.equal(descriptor.parameters[0].codec.mode, 'strict')
  assert.deepEqual(descriptor.parameters[0].codec.create().parse({ sessionId: 'abc' }), {
    sessionId: 'abc',
  })
})
