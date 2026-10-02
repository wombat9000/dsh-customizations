export const TRIVY_STATUS_CHANNEL = '/trivy-status'
export const TRIVY_STATUS_GET = 'get'
export const TRIVY_STATUS_RECHECK = 'recheck'

export type Scanner = 'vulnerability' | 'misconfiguration'
export type Severity = 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

interface StatusFields {
  checkedAt: string
  minimumVersion: string
  message: string
}
export type TrivyStatus = StatusFields &
  (
    | { state: 'ready' | 'unsupported-version'; path: string; version: string }
    | { state: 'not-found'; path?: never; version?: never }
    | { state: 'execution-failed'; path?: string; version?: never }
  )
// Only the host owns executable paths. The status RPC never exposes them.
type WithoutPath<T> = T extends unknown ? Omit<T, 'path'> & { path?: never } : never
export type PublicTrivyStatus = WithoutPath<TrivyStatus>
export type StatusResponse =
  | { ok: true; value: PublicTrivyStatus }
  | { ok: false; error: { code: 'internal'; message: string; details: Record<string, never> } }
export interface StatusEndpoints {
  get: { input: Record<string, never>; result: StatusResponse }
  recheck: { input: Record<string, never>; result: StatusResponse }
}
export interface StatusRpc {
  call<E extends keyof StatusEndpoints>(
    channel: typeof TRIVY_STATUS_CHANNEL,
    endpoint: E,
    input: StatusEndpoints[E]['input'],
  ): Promise<StatusEndpoints[E]['result']>
}
export interface ScanOptions {
  target: unknown
  scanners: Scanner[]
  severities: Severity[]
  ignoreUnfixed: boolean
}
export interface ScanMetadata extends Omit<ScanOptions, 'target'> {
  target: string
  scannerVersion: string
}
export interface Finding {
  kind: Scanner
  target: string
  id: string
  severity: Severity
  title?: string
  package?: string
  installedVersion?: string
  fixedVersion?: string
  message?: string
  resolution?: string
  resource?: string
  status?: string
  primaryUrl?: string
}
export interface TrivyResult extends ScanMetadata {
  totals: {
    bySeverity: Record<Severity, number>
    byKind: { vulnerabilities: number; misconfigurations: number }
  }
  totalFindings: number
  returnedFindings: number
  truncated: boolean
  findings: Finding[]
}
