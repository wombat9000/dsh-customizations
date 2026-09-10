import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  apply,
  buildTrivyArgv,
  compareVersions,
  createTrivyRuntime,
  createTrivySkillProvider,
  EMPTY_CONFIG_PATH,
  EMPTY_IGNOREFILE_PATH,
  MAX_FINDINGS,
  normalizeScanOptions,
  normalizeTrivyReport,
  parseTrivyVersion,
  registerTrivyStatusRpc,
  renderTrivyResult,
  resolveScanTarget,
  runCollected,
  scanWithTrivy,
  TRIVY_STATUS_CHANNEL,
  TRIVY_STATUS_RECHECK,
} from '../src/index.js'

function reader(text, lossy = false) {
  return { readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy }) }
}

function fakeSubprocess({ executable = '/usr/local/bin/trivy', resolveError, runs = [] } = {}) {
  const specs = []
  let resolveCalls = 0
  return {
    specs,
    get resolveCalls() { return resolveCalls },
    async resolveExecutable(command) {
      resolveCalls += 1
      assert.equal(command, 'trivy')
      if (resolveError !== undefined) throw resolveError
      return executable
    },
    spawn(spec) {
      specs.push(spec)
      const run = runs.shift() ?? { stdout: '', stderr: '', exitCode: 0, signal: null }
      return {
        pid: 123,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: {
          stdout: reader(run.stdout ?? '', run.stdoutTruncated === true),
          stderr: reader(run.stderr ?? '', run.stderrTruncated === true),
        },
        done: Promise.resolve({ exitCode: run.exitCode ?? 0, signal: run.signal ?? null }),
        terminate() {},
        waitForExit: async () => true,
      }
    },
  }
}

const REPORT = {
  SchemaVersion: 2,
  CreatedAt: '2026-01-01T00:00:00Z',
  Trivy: { Version: '0.69.2' },
  ArtifactName: 'workspace',
  ArtifactType: 'filesystem',
  Results: [{
    Target: 'package-lock.json',
    Vulnerabilities: [{
      VulnerabilityID: 'CVE-2025-0001',
      PkgName: 'example',
      InstalledVersion: '1.0.0',
      FixedVersion: '1.0.1',
      Severity: 'CRITICAL',
      Title: 'Example vulnerability',
      Status: 'fixed',
      PrimaryURL: 'https://example.test/CVE-2025-0001',
    }],
  }, {
    Target: 'Dockerfile',
    Misconfigurations: [{
      ID: 'DS002',
      Severity: 'HIGH',
      Title: 'Root user',
      Message: 'Specify a non-root user',
      Resolution: 'Add USER app',
      CauseMetadata: { Resource: 'Dockerfile' },
    }],
  }],
}

test('parses and compares Trivy versions', () => {
  assert.equal(parseTrivyVersion('Version: 0.69.2\nVulnerability DB: 2'), '0.69.2')
  assert.equal(parseTrivyVersion('trivy v0.50.0'), '0.50.0')
  assert.equal(parseTrivyVersion('unknown'), undefined)
  assert.equal(compareVersions('0.49.9', '0.50.0'), -1)
  assert.equal(compareVersions('0.50.0', '0.50.0'), 0)
  assert.equal(compareVersions('1.0.0', '0.50.0'), 1)
})

test('health resolver reports missing, ready, unsupported, and caches checks', async () => {
  const missingError = Object.assign(new Error('spawn trivy ENOENT'), { code: 'ENOENT' })
  const missing = createTrivyRuntime(fakeSubprocess({ resolveError: missingError }), { now: () => 1 })
  assert.equal((await missing.check()).state, 'not-found')
  assert.match((await missing.check()).message, /effective PATH/)

  let now = 100
  const subprocess = fakeSubprocess({ runs: [
    { stdout: 'Version: 0.69.2\n' },
    { stdout: 'Version: 0.69.3\n' },
  ] })
  const ready = createTrivyRuntime(subprocess, { now: () => now, cwd: () => '/tmp' })
  assert.equal((await ready.check()).version, '0.69.2')
  assert.equal((await ready.check()).version, '0.69.2')
  assert.equal(subprocess.resolveCalls, 1)
  now += 1
  assert.equal((await ready.check({ force: true })).version, '0.69.3')
  assert.equal(subprocess.resolveCalls, 2)

  const old = createTrivyRuntime(fakeSubprocess({ runs: [{ stdout: 'Version: 0.49.0\n' }] }), { cwd: () => '/tmp' })
  assert.equal((await old.check()).state, 'unsupported-version')
})

test('collected subprocess execution classifies timeout and external cancellation', async () => {
  let timeoutSpec
  const timeoutSubprocess = {
    spawn(spec) {
      timeoutSpec = spec
      return {
        collected: { stdout: reader(''), stderr: reader('') },
        done: new Promise((resolve) => spec.signal.addEventListener('abort', () => resolve({ exitCode: null, signal: 'SIGTERM' }), { once: true })),
      }
    },
  }
  const timed = await runCollected(timeoutSubprocess, {
    argv: ['/bin/trivy', '--version'],
    cwd: '/tmp',
    timeoutMs: 5,
    stdoutMaxBytes: 1024,
  })
  assert.equal(timed.timedOut, true)
  assert.equal(timeoutSpec.signal.aborted, true)

  const external = new AbortController()
  let externalSpec
  const cancellationSubprocess = {
    spawn(spec) {
      externalSpec = spec
      return {
        collected: { stdout: reader(''), stderr: reader('') },
        done: new Promise((resolve) => spec.signal.addEventListener('abort', () => resolve({ exitCode: null, signal: 'SIGTERM' }), { once: true })),
      }
    },
  }
  const pending = runCollected(cancellationSubprocess, {
    argv: ['/bin/trivy', '--version'],
    cwd: '/tmp',
    signal: external.signal,
    timeoutMs: 1_000,
    stdoutMaxBytes: 1024,
  })
  external.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(externalSpec.signal.aborted, true)
})

test('normalizes options and builds argv without shell interpolation', () => {
  const options = normalizeScanOptions({
    target: 'dir with spaces; touch nope',
    scanners: ['vulnerability'],
    severities: ['CRITICAL'],
    ignoreUnfixed: true,
  })
  assert.deepEqual(buildTrivyArgv('/bin/trivy', options, '/workspace/dir with spaces; touch nope'), [
    '/bin/trivy',
    '--config', EMPTY_CONFIG_PATH,
    'fs',
    '--ignorefile', EMPTY_IGNOREFILE_PATH,
    '--format', 'json',
    '--quiet',
    '--scanners', 'vuln',
    '--severity', 'CRITICAL',
    '--ignore-unfixed',
    '/workspace/dir with spaces; touch nope',
  ])
  assert.throws(() => normalizeScanOptions({ scanners: ['secret'] }), /scanners/)
  assert.throws(() => normalizeScanOptions({ severities: ['EXTREME'] }), /severities/)
})

test('canonicalizes scan targets and rejects workspace escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-trivy-path-'))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  try {
    await mkdir(workspace)
    await mkdir(outside)
    await writeFile(join(workspace, 'package.json'), '{}')
    await writeFile(join(outside, 'secret.txt'), 'secret')
    assert.equal((await resolveScanTarget(workspace, 'package.json')).target, await realpath(join(workspace, 'package.json')))
    await assert.rejects(resolveScanTarget(workspace, '../outside'), /inside the active session workspace/)
    await symlink(outside, join(workspace, 'linked-outside'))
    await assert.rejects(resolveScanTarget(workspace, 'linked-outside'), /inside the active session workspace/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('scan execution fails closed on truncated output and nonzero exit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-trivy-failure-'))
  const exec = {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: root } } },
  }
  const runtime = {
    check: async () => ({ state: 'ready', path: '/bin/trivy', version: '0.72.0' }),
  }
  try {
    const truncated = fakeSubprocess({ runs: [{ stdout: '{"partial":true}', stdoutTruncated: true }] })
    await assert.rejects(scanWithTrivy(runtime, truncated, {}, exec), (error) => error.code === 'TRIVY_OUTPUT_TOO_LARGE')

    const failed = fakeSubprocess({ runs: [{ stderr: 'database unavailable', exitCode: 1 }] })
    await assert.rejects(scanWithTrivy(runtime, failed, {}, exec), (error) => (
      error.code === 'TRIVY_SCAN_FAILED' && /database unavailable/.test(error.message)
    ))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('normalizes vulnerability and misconfiguration findings', () => {
  const value = normalizeTrivyReport(REPORT, {
    scannerVersion: '0.69.2',
    target: '/workspace',
    scanners: ['vulnerability', 'misconfiguration'],
    severities: ['HIGH', 'CRITICAL'],
    ignoreUnfixed: false,
  })
  assert.equal(value.totalFindings, 2)
  assert.equal(value.totals.bySeverity.CRITICAL, 1)
  assert.equal(value.totals.bySeverity.HIGH, 1)
  assert.equal(value.totals.byKind.vulnerabilities, 1)
  assert.equal(value.totals.byKind.misconfigurations, 1)
  assert.equal(value.findings[0].id, 'CVE-2025-0001')
  assert.match(renderTrivyResult(value), /2 total/)
})

test('accepts a legacy clean-report shape without Results or Trivy.Version', () => {
  const value = normalizeTrivyReport({
    SchemaVersion: 2,
    CreatedAt: '2026-01-01T00:00:00Z',
    ArtifactName: 'workspace',
    ArtifactType: 'filesystem',
  }, {
    scannerVersion: '0.72.0',
    target: '/workspace',
    scanners: ['vulnerability', 'misconfiguration'],
    severities: ['HIGH', 'CRITICAL'],
    ignoreUnfixed: false,
  })
  assert.equal(value.totalFindings, 0)
  assert.deepEqual(value.findings, [])
})

test('rejects malformed or unrecognized Trivy reports instead of reporting a clean scan', () => {
  const metadata = {
    scannerVersion: '0.72.0',
    target: '/workspace',
    scanners: ['vulnerability'],
    severities: ['HIGH'],
    ignoreUnfixed: false,
  }
  assert.throws(() => normalizeTrivyReport({}, metadata), /SchemaVersion 2/)
  assert.throws(() => normalizeTrivyReport({
    SchemaVersion: 3,
    Trivy: { Version: '0.72.0' },
    ArtifactName: 'workspace',
    ArtifactType: 'filesystem',
  }, metadata), /SchemaVersion 2/)
  assert.throws(() => normalizeTrivyReport({
    SchemaVersion: 2,
    CreatedAt: '2026-01-01T00:00:00Z',
    Trivy: { Version: '0.72.0' },
    ArtifactName: 'workspace',
    ArtifactType: 'filesystem',
    Results: [{ Target: 'package-lock.json', Vulnerabilities: {} }],
  }, metadata), /Vulnerabilities must be an array/)
  assert.throws(() => normalizeTrivyReport({
    SchemaVersion: 2,
    CreatedAt: '2026-01-01T00:00:00Z',
    Trivy: { Version: '0.72.0' },
    ArtifactName: 'workspace',
    ArtifactType: 'filesystem',
    Results: [{ Target: 'package-lock.json', Vulnerabilities: [{ Severity: 'HIGH' }] }],
  }, metadata), /missing its identifier/)
})

test('caps findings while retaining complete totals', () => {
  const report = {
    SchemaVersion: 2,
    CreatedAt: '2026-01-01T00:00:00Z',
    Trivy: { Version: '0.69.2' },
    ArtifactName: 'workspace',
    ArtifactType: 'filesystem',
    Results: [{
      Target: 'package-lock.json',
      Vulnerabilities: Array.from({ length: MAX_FINDINGS + 5 }, (_, index) => ({
        VulnerabilityID: `CVE-${index}`,
        PkgName: `pkg-${index}`,
        Severity: 'HIGH',
      })),
    }],
  }
  const value = normalizeTrivyReport(report, {
    scannerVersion: '0.69.2',
    target: '/workspace',
    scanners: ['vulnerability'],
    severities: ['HIGH'],
    ignoreUnfixed: false,
  })
  assert.equal(value.totalFindings, MAX_FINDINGS + 5)
  assert.equal(value.returnedFindings, MAX_FINDINGS)
  assert.equal(value.totals.bySeverity.HIGH, MAX_FINDINGS + 5)
  assert.equal(value.truncated, true)
})

test('bundled provider loads the Trivy audit instructions', async () => {
  const provider = createTrivySkillProvider()
  const [candidate] = await provider.list()
  assert.equal(candidate.name, 'trivy-audit')
  assert.equal(candidate.source, 'bundled')
  const definition = await provider.get(candidate)
  assert.match(definition.content, /never installs or updates/)
  assert.match(definition.content, /trivy_scan/)
})

test('status RPC forwards cancellation and removes executable paths from its response', async () => {
  let registration
  let received
  registerTrivyStatusRpc({
    get: () => ({
      rpc: {
        handle(channel, handler, options) {
          registration = { channel, handler, options }
          return () => {}
        },
      },
    }),
    effect(installer) { installer() },
  }, {
    async check(options) {
      received = options
      return {
        state: 'ready',
        path: '/private/host/bin/trivy',
        version: '0.72.0',
        minimumVersion: '0.50.0',
        checkedAt: '2026-01-01T00:00:00.000Z',
        message: 'ready',
      }
    },
  })
  const controller = new AbortController()
  const response = await registration.handler(TRIVY_STATUS_RECHECK, {}, controller.signal)
  assert.equal(received.signal, controller.signal)
  assert.equal(received.force, true)
  assert.equal(response.value.path, undefined)
  assert.equal(response.value.version, '0.72.0')
  assert.deepEqual(registration.options, { authority: 'trusted-host' })
})

test('headless plugin registers tools and skills without activating optional web RPC', () => {
  let tool
  let providerFactory
  let optionalServices
  apply({
    subprocess: fakeSubprocess({ runs: [] }),
    tools: { register(value) { tool = value; return () => {} } },
    skills: { registerProvider(value) { providerFactory = value; return () => {} } },
    inject(services) { optionalServices = services },
  })
  assert.equal(tool.name, 'trivy_scan')
  assert.equal(providerFactory().name, 'trivy-audit')
  assert.deepEqual(optionalServices, ['connection', 'webServer'])
})

test('plugin registers tool, skill provider, and status RPC and executes a fixture scan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-trivy-tool-'))
  try {
    await writeFile(join(root, 'package.json'), '{}')
    await writeFile(join(root, 'trivy.yaml'), 'output: controlled-by-repo.json\nserver: https://invalid.example\n')
    await writeFile(join(root, '.trivyignore'), '*\n')
    const subprocess = fakeSubprocess({ runs: [
      { stdout: 'Version: 0.69.2\n' },
      { stdout: 'Version: 0.69.2\n' },
      { stdout: JSON.stringify(REPORT) },
    ] })
    let tool
    let providerFactory
    let rpcRegistration
    const ctx = {
      inject(services, callback) {
        assert.deepEqual(services, ['connection', 'webServer'])
        callback(this)
      },
      subprocess,
      tools: { register(value) { tool = value; return () => {} } },
      skills: { registerProvider(value) { providerFactory = value; return () => {} } },
      get(name) {
        if (name !== 'connection') return undefined
        return {
          rpc: {
            handle(channel, handler, options) {
              rpcRegistration = { channel, handler, options }
              return () => {}
            },
          },
        }
      },
      effect(installer) { installer() },
    }
    apply(ctx)
    assert.equal(tool.name, 'trivy_scan')
    assert.equal(providerFactory().name, 'trivy-audit')
    assert.equal(rpcRegistration.channel, TRIVY_STATUS_CHANNEL)
    assert.deepEqual(rpcRegistration.options, { authority: 'trusted-host' })

    const status = await rpcRegistration.handler(TRIVY_STATUS_RECHECK, {})
    assert.equal(status.ok, true)
    assert.equal(status.value.state, 'ready')
    assert.equal(status.value.path, undefined)

    const result = await tool.execute({}, {
      callId: 'call-1',
      signal: new AbortController().signal,
      agent: { session: { header: { cwd: root } } },
    })
    assert.equal(result.totalFindings, 2)
    assert.deepEqual(subprocess.specs.at(-1).argv.slice(0, 6), [
      '/usr/local/bin/trivy',
      '--config', EMPTY_CONFIG_PATH,
      'fs',
      '--ignorefile', EMPTY_IGNOREFILE_PATH,
    ])
    assert.equal(subprocess.specs.at(-1).argv.includes(join(root, 'trivy.yaml')), false)
    assert.equal(subprocess.specs.at(-1).argv.includes(join(root, '.trivyignore')), false)
    assert.equal(subprocess.specs.at(-1).cwd, await realpath(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
