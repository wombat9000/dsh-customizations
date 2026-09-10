import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HarnessError } from '@deepseek-ai/dsh-llm'

export const MINIMUM_TRIVY_VERSION = '0.50.0'
export const DEFAULT_TIMEOUT_MS = 300_000
export const STATUS_TIMEOUT_MS = 5_000
export const STATUS_CACHE_MS = 30_000
export const MAX_REPORT_BYTES = 8 * 1024 * 1024
export const MAX_STDERR_BYTES = 64 * 1024
export const MAX_FINDINGS = 200
export const RENDERED_FINDINGS = 50
export const EMPTY_CONFIG_PATH = fileURLToPath(new URL('../assets/trivy-empty.yaml', import.meta.url))
export const EMPTY_IGNOREFILE_PATH = fileURLToPath(new URL('../assets/trivy-empty.ignore', import.meta.url))

const SEVERITIES = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
const SEVERITY_ORDER = new Map([...SEVERITIES].reverse().map((value, index) => [value, index]))
const SCANNER_ARGUMENT = {
  vulnerability: 'vuln',
  misconfiguration: 'misconfig',
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function diagnostic(value, maximum = 2_000) {
  const normalized = String(value).trim()
  if (normalized.length <= maximum) return normalized
  return `…${normalized.slice(normalized.length - maximum + 1)}`
}

function abortError(message = 'Trivy scan aborted') {
  const error = new Error(message)
  error.name = 'AbortError'
  error.code = 'TRIVY_ABORTED'
  return error
}

export class TrivyError extends HarnessError {
  constructor(code, message, details = {}) {
    super(message, code)
    this.name = 'TrivyError'
    this.details = details
  }
}

export function parseTrivyVersion(output) {
  const match = /(?:^|\n)Version:\s*v?(\d+)\.(\d+)\.(\d+)(?:\s|$)/u.exec(output)
    ?? /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:\s|$)/u.exec(output)
  if (match === null) return undefined
  return `${match[1]}.${match[2]}.${match[3]}`
}

export function compareVersions(left, right) {
  const parse = (value) => value.split('.').map((part) => Number.parseInt(part, 10))
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1
  }
  return 0
}

function copyRead(reader) {
  if (reader === undefined) return { text: '', truncated: false }
  const value = reader.readFrom(0)
  return {
    text: value.text,
    truncated: value.lossy,
    ...(value.spillPath === undefined ? {} : { spillPath: value.spillPath }),
  }
}

export async function runCollected(subprocess, {
  argv,
  cwd,
  signal,
  timeoutMs,
  stdoutMaxBytes,
  stderrMaxBytes = MAX_STDERR_BYTES,
}) {
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) throw abortError()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error(`Trivy timed out after ${timeoutMs}ms`))
  }, timeoutMs)

  try {
    const handle = subprocess.spawn({
      argv,
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: stdoutMaxBytes },
        stderr: { maxBytes: stderrMaxBytes },
      },
      graceMs: 1_000,
      signal: controller.signal,
    })
    const outcome = await handle.done
    if (signal?.aborted) throw abortError()
    return {
      ...outcome,
      timedOut,
      stdout: copyRead(handle.collected.stdout),
      stderr: copyRead(handle.collected.stderr),
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

function notFound(error) {
  return error?.code === 'ENOENT' || /not found|cannot find|could not find/iu.test(messageOf(error))
}

export function createTrivyRuntime(subprocess, {
  now = () => Date.now(),
  cwd = () => process.cwd(),
  minimumVersion = MINIMUM_TRIVY_VERSION,
  statusCacheMs = STATUS_CACHE_MS,
} = {}) {
  let cached

  const check = async ({ force = false, signal } = {}) => {
    const current = now()
    if (!force && cached !== undefined && current - cached.checkedAtMs < statusCacheMs) {
      return { ...cached.value }
    }

    let executable
    try {
      executable = await subprocess.resolveExecutable('trivy', undefined, signal)
    } catch (error) {
      if (signal?.aborted) throw abortError()
      const value = {
        state: notFound(error) ? 'not-found' : 'execution-failed',
        checkedAt: new Date(current).toISOString(),
        minimumVersion,
        message: notFound(error)
          ? 'DSH could not find `trivy` on its effective PATH.'
          : `DSH could not resolve Trivy: ${messageOf(error)}`,
      }
      cached = { checkedAtMs: current, value }
      return { ...value }
    }

    try {
      const result = await runCollected(subprocess, {
        argv: [executable, '--version'],
        cwd: cwd(),
        signal,
        timeoutMs: STATUS_TIMEOUT_MS,
        stdoutMaxBytes: 32 * 1024,
      })
      let value
      if (result.timedOut) {
        value = {
          state: 'execution-failed',
          checkedAt: new Date(current).toISOString(),
          minimumVersion,
          path: executable,
          message: `Trivy did not respond within ${STATUS_TIMEOUT_MS}ms.`,
        }
      } else if (result.exitCode !== 0) {
        const detail = diagnostic(result.stderr.text || result.stdout.text || `exit code ${result.exitCode}`)
        value = {
          state: 'execution-failed',
          checkedAt: new Date(current).toISOString(),
          minimumVersion,
          path: executable,
          message: `Trivy failed to run: ${detail}`,
        }
      } else {
        const version = parseTrivyVersion(`${result.stdout.text}\n${result.stderr.text}`)
        if (version === undefined) {
          value = {
            state: 'execution-failed',
            checkedAt: new Date(current).toISOString(),
            minimumVersion,
            path: executable,
            message: 'DSH could not determine the installed Trivy version.',
          }
        } else if (compareVersions(version, minimumVersion) < 0) {
          value = {
            state: 'unsupported-version',
            checkedAt: new Date(current).toISOString(),
            minimumVersion,
            path: executable,
            version,
            message: `Trivy ${version} is installed, but this plugin requires ${minimumVersion} or newer.`,
          }
        } else {
          value = {
            state: 'ready',
            checkedAt: new Date(current).toISOString(),
            minimumVersion,
            path: executable,
            version,
            message: `Trivy ${version} is ready.`,
          }
        }
      }
      cached = { checkedAtMs: current, value }
      return { ...value }
    } catch (error) {
      if (signal?.aborted) throw abortError()
      const value = {
        state: 'execution-failed',
        checkedAt: new Date(current).toISOString(),
        minimumVersion,
        path: executable,
        message: `Trivy failed to run: ${messageOf(error)}`,
      }
      cached = { checkedAtMs: current, value }
      return { ...value }
    }
  }

  return {
    check,
    clear() { cached = undefined },
  }
}

function within(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && path !== '..' && !isAbsolute(path))
}

export async function resolveScanTarget(workspace, target = '.') {
  if (typeof workspace !== 'string' || workspace.length === 0) {
    throw new TrivyError('TRIVY_WORKSPACE_REQUIRED', 'trivy_scan requires an active session workspace.')
  }
  if (typeof target !== 'string' || target.trim().length === 0) {
    throw new TrivyError('TRIVY_INVALID_TARGET', 'Trivy target must be a non-empty path.')
  }

  let canonicalWorkspace
  let canonicalTarget
  try {
    canonicalWorkspace = await realpath(workspace)
    canonicalTarget = await realpath(resolve(canonicalWorkspace, target))
    const info = await stat(canonicalTarget)
    if (!info.isDirectory() && !info.isFile()) {
      throw new Error('target is not a regular file or directory')
    }
  } catch (error) {
    throw new TrivyError('TRIVY_INVALID_TARGET', `Trivy target is unavailable: ${messageOf(error)}`)
  }
  if (!within(canonicalWorkspace, canonicalTarget)) {
    throw new TrivyError('TRIVY_TARGET_OUTSIDE_WORKSPACE', 'Trivy targets must remain inside the active session workspace.')
  }
  return { workspace: canonicalWorkspace, target: canonicalTarget }
}

export function normalizeScanOptions(args = {}) {
  const scanners = args.scanners ?? ['vulnerability', 'misconfiguration']
  const severities = args.severities ?? ['HIGH', 'CRITICAL']
  if (!Array.isArray(scanners) || scanners.length === 0 || scanners.some((value) => !(value in SCANNER_ARGUMENT))) {
    throw new TrivyError('TRIVY_INVALID_SCANNERS', 'Trivy scanners must contain vulnerability and/or misconfiguration.')
  }
  if (!Array.isArray(severities) || severities.length === 0 || severities.some((value) => !SEVERITIES.includes(value))) {
    throw new TrivyError('TRIVY_INVALID_SEVERITIES', 'Trivy severities contain an unsupported value.')
  }
  return {
    target: args.target ?? '.',
    scanners: [...new Set(scanners)],
    severities: [...new Set(severities)],
    ignoreUnfixed: args.ignoreUnfixed === true,
  }
}

export function buildTrivyArgv(executable, options, target) {
  return [
    executable,
    '--config', EMPTY_CONFIG_PATH,
    'fs',
    '--ignorefile', EMPTY_IGNOREFILE_PATH,
    '--format', 'json',
    '--quiet',
    '--scanners', options.scanners.map((value) => SCANNER_ARGUMENT[value]).join(','),
    '--severity', options.severities.join(','),
    ...(options.ignoreUnfixed ? ['--ignore-unfixed'] : []),
    target,
  ]
}

function text(value, maximum = 500) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replace(/\s+/gu, ' ')
  if (normalized.length === 0) return undefined
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`
}

function severity(value) {
  return SEVERITIES.includes(value) ? value : 'UNKNOWN'
}

function primaryUrl(item) {
  return text(item.PrimaryURL, 500) ?? (Array.isArray(item.References) ? text(item.References[0], 500) : undefined)
}

function vulnerabilityFinding(result, item) {
  return {
    kind: 'vulnerability',
    target: text(result.Target, 500) ?? '(unknown target)',
    id: text(item.VulnerabilityID, 200) ?? '(unknown vulnerability)',
    severity: severity(item.Severity),
    ...(text(item.Title, 300) === undefined ? {} : { title: text(item.Title, 300) }),
    ...(text(item.PkgName, 300) === undefined ? {} : { package: text(item.PkgName, 300) }),
    ...(text(item.InstalledVersion, 200) === undefined ? {} : { installedVersion: text(item.InstalledVersion, 200) }),
    ...(text(item.FixedVersion, 200) === undefined ? {} : { fixedVersion: text(item.FixedVersion, 200) }),
    ...(text(item.Status, 100) === undefined ? {} : { status: text(item.Status, 100) }),
    ...(primaryUrl(item) === undefined ? {} : { primaryUrl: primaryUrl(item) }),
  }
}

function misconfigurationFinding(result, item) {
  const resource = text(item.CauseMetadata?.Resource, 300)
  return {
    kind: 'misconfiguration',
    target: text(result.Target, 500) ?? '(unknown target)',
    id: text(item.ID, 200) ?? text(item.AVDID, 200) ?? '(unknown misconfiguration)',
    severity: severity(item.Severity),
    ...(text(item.Title, 300) === undefined ? {} : { title: text(item.Title, 300) }),
    ...(text(item.Message, 500) === undefined ? {} : { message: text(item.Message, 500) }),
    ...(text(item.Resolution, 500) === undefined ? {} : { resolution: text(item.Resolution, 500) }),
    ...(resource === undefined ? {} : { resource }),
    ...(text(item.Status, 100) === undefined ? {} : { status: text(item.Status, 100) }),
    ...(primaryUrl(item) === undefined ? {} : { primaryUrl: primaryUrl(item) }),
  }
}

function emptySeverities() {
  return Object.fromEntries(SEVERITIES.map((value) => [value, 0]))
}

function reportRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidReport(detail) {
  throw new TrivyError('TRIVY_INVALID_OUTPUT', `Trivy returned an unsupported JSON report: ${detail}.`)
}

function validateTrivyReport(report) {
  if (!reportRecord(report)) invalidReport('expected an object')
  if (report.SchemaVersion !== 2) invalidReport('expected SchemaVersion 2')
  if (typeof report.CreatedAt !== 'string' || report.CreatedAt.length === 0) invalidReport('missing CreatedAt')
  if (report.Trivy !== undefined
    && (!reportRecord(report.Trivy) || typeof report.Trivy.Version !== 'string' || report.Trivy.Version.length === 0)) {
    invalidReport('invalid Trivy.Version')
  }
  if (typeof report.ArtifactName !== 'string' || report.ArtifactName.length === 0) invalidReport('missing ArtifactName')
  if (typeof report.ArtifactType !== 'string' || report.ArtifactType.length === 0) invalidReport('missing ArtifactType')
  if (report.Results === undefined) return
  if (!Array.isArray(report.Results)) invalidReport('Results must be an array')

  for (const result of report.Results) {
    if (!reportRecord(result) || typeof result.Target !== 'string' || result.Target.length === 0) {
      invalidReport('every Results entry must have a Target')
    }
    for (const [field, idFields] of [
      ['Vulnerabilities', ['VulnerabilityID']],
      ['Misconfigurations', ['ID', 'AVDID']],
    ]) {
      const items = result[field]
      if (items === undefined) continue
      if (!Array.isArray(items)) invalidReport(`${field} must be an array`)
      for (const item of items) {
        if (!reportRecord(item)) invalidReport(`${field} entries must be objects`)
        if (!idFields.some((key) => typeof item[key] === 'string' && item[key].length > 0)) {
          invalidReport(`${field} entry is missing its identifier`)
        }
        if (typeof item.Severity !== 'string' || item.Severity.length === 0) {
          invalidReport(`${field} entry is missing Severity`)
        }
      }
    }
  }
}

export function normalizeTrivyReport(report, metadata) {
  validateTrivyReport(report)

  const all = []
  for (const result of report.Results ?? []) {
    for (const item of result.Vulnerabilities ?? []) all.push(vulnerabilityFinding(result, item))
    for (const item of result.Misconfigurations ?? []) all.push(misconfigurationFinding(result, item))
  }

  all.sort((left, right) => (
    (SEVERITY_ORDER.get(left.severity) ?? 99) - (SEVERITY_ORDER.get(right.severity) ?? 99)
      || left.kind.localeCompare(right.kind)
      || left.target.localeCompare(right.target)
      || left.id.localeCompare(right.id)
  ))

  const bySeverity = emptySeverities()
  const byKind = { vulnerabilities: 0, misconfigurations: 0 }
  for (const finding of all) {
    bySeverity[finding.severity] += 1
    if (finding.kind === 'vulnerability') byKind.vulnerabilities += 1
    else byKind.misconfigurations += 1
  }
  const findings = all.slice(0, MAX_FINDINGS)
  return {
    scannerVersion: metadata.scannerVersion,
    target: metadata.target,
    scanners: metadata.scanners,
    severities: metadata.severities,
    ignoreUnfixed: metadata.ignoreUnfixed,
    totals: { bySeverity, byKind },
    totalFindings: all.length,
    returnedFindings: findings.length,
    truncated: findings.length < all.length,
    findings,
  }
}

export function renderTrivyResult(value) {
  const totals = value.totals.bySeverity
  const lines = [
    `Trivy ${value.scannerVersion} scanned ${value.target}.`,
    `Findings: ${value.totalFindings} total — ${totals.CRITICAL} critical, ${totals.HIGH} high, ${totals.MEDIUM} medium, ${totals.LOW} low, ${totals.UNKNOWN} unknown.`,
    `Kinds: ${value.totals.byKind.vulnerabilities} vulnerabilities, ${value.totals.byKind.misconfigurations} misconfigurations.`,
  ]
  const shown = value.findings.slice(0, RENDERED_FINDINGS)
  if (shown.length > 0) {
    lines.push('', 'Findings:')
    for (const finding of shown) {
      const subject = finding.kind === 'vulnerability'
        ? [finding.package, finding.installedVersion === undefined ? undefined : `installed ${finding.installedVersion}`, finding.fixedVersion === undefined ? undefined : `fixed ${finding.fixedVersion}`].filter(Boolean).join(', ')
        : [finding.resource, finding.message].filter(Boolean).join(' — ')
      lines.push(`- [${finding.severity}] ${finding.id} — ${finding.target}${subject.length === 0 ? '' : ` — ${subject}`}`)
    }
  }
  if (value.findings.length > shown.length) lines.push(``, `Only ${shown.length} of ${value.returnedFindings} returned finding details are rendered here.`)
  if (value.truncated) lines.push(`Only ${value.returnedFindings} of ${value.totalFindings} findings were returned. Narrow the scan before drawing complete conclusions.`)
  if (value.totalFindings === 0) lines.push('No findings matched the selected scanners and severities.')
  return lines.join('\n')
}

export async function scanWithTrivy(runtime, subprocess, args, exec) {
  const options = normalizeScanOptions(args)
  const workspace = exec.agent?.session.header.cwd
  const paths = await resolveScanTarget(workspace, options.target)
  const status = await runtime.check({ force: true, signal: exec.signal })
  if (status.state === 'not-found') {
    throw new TrivyError('TRIVY_NOT_FOUND', 'DSH could not find `trivy` on its effective PATH. Install Trivy, then open Settings → Trivy and select Recheck. DSH will not install Trivy automatically.')
  }
  if (status.state === 'unsupported-version') {
    throw new TrivyError('TRIVY_VERSION_UNSUPPORTED', status.message)
  }
  if (status.state !== 'ready') {
    throw new TrivyError('TRIVY_UNAVAILABLE', status.message)
  }

  const result = await runCollected(subprocess, {
    argv: buildTrivyArgv(status.path, options, paths.target),
    cwd: paths.workspace,
    signal: exec.signal,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    stdoutMaxBytes: MAX_REPORT_BYTES,
  })
  if (result.timedOut) {
    throw new TrivyError('TRIVY_TIMEOUT', `Trivy scan timed out after ${DEFAULT_TIMEOUT_MS}ms.`)
  }
  if (result.stdout.truncated) {
    throw new TrivyError('TRIVY_OUTPUT_TOO_LARGE', `Trivy JSON output exceeded ${MAX_REPORT_BYTES} bytes. Narrow the target or selected severities.`)
  }
  if (result.exitCode !== 0) {
    const detail = diagnostic(result.stderr.text || `exit code ${result.exitCode}`)
    throw new TrivyError('TRIVY_SCAN_FAILED', `Trivy scan failed: ${detail}`)
  }

  let report
  try {
    report = JSON.parse(result.stdout.text)
  } catch (error) {
    throw new TrivyError('TRIVY_INVALID_OUTPUT', `Trivy returned invalid JSON: ${messageOf(error)}`)
  }
  return normalizeTrivyReport(report, {
    scannerVersion: status.version,
    target: paths.target,
    scanners: options.scanners,
    severities: options.severities,
    ignoreUnfixed: options.ignoreUnfixed,
  })
}
