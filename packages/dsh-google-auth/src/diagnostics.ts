import { isRecord } from '../shared/contracts.js'
// OAuth error descriptions can contain credentials. Return exact known codes only.
const codes = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'access_denied',
  'temporarily_unavailable',
  'server_error',
  'rate_limit_exceeded',
  'admin_policy_enforced',
  'disallowed_useragent',
  'org_internal',
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED',
  'INVALID_ARGUMENT',
  'INTERNAL',
  'UNAVAILABLE',
])

export function httpFailure(status: number, result?: unknown) {
  const label =
    Number.isInteger(status) && status >= 100 && status <= 599 ? ` (HTTP ${status})` : ''
  const error = isRecord(result) ? result.error : undefined
  const details = isRecord(error) ? error : undefined
  const candidates = [
    typeof error === 'string' ? error : details?.status,
    ...(Array.isArray(details?.errors)
      ? details.errors.map((value: unknown) => (isRecord(value) ? value.reason : undefined))
      : []),
    ...(Array.isArray(details?.details)
      ? details.details.map((value: unknown) => (isRecord(value) ? value.reason : undefined))
      : []),
  ]
  const code = candidates.find((value) => typeof value === 'string' && codes.has(value))
  return `Google request failed${label}${code ? `: ${code}` : ''}. Try again or reconnect.`
}
