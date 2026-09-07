// Never expose server messages, URLs, or unrecognized identifiers.
const reasons = new Set([
  'accessNotConfigured', 'serviceDisabled', 'SERVICE_DISABLED',
  'forbidden', 'domainPolicy', 'insufficientPermissions', 'insufficientFilePermissions',
  'authError', 'invalidCredentials', 'UNAUTHENTICATED', 'PERMISSION_DENIED',
  'rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded',
  'RESOURCE_EXHAUSTED', 'backendError', 'internalError', 'INTERNAL',
  'UNAVAILABLE', 'notFound', 'NOT_FOUND', 'badRequest', 'INVALID_ARGUMENT',
])

const authCodes = new Set([
  'invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client',
  'unsupported_grant_type', 'invalid_scope', 'access_denied',
  'temporarily_unavailable', 'server_error', 'rate_limit_exceeded',
  'admin_policy_enforced', 'disallowed_useragent', 'org_internal',
  'UNAUTHENTICATED', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED',
  'INVALID_ARGUMENT', 'INTERNAL', 'UNAVAILABLE',
])

// The auth provider is a separate bundle. Reconstruct only a closed diagnostic
// grammar; never forward arbitrary provider errors or their causes.
export function authFailure(message) {
  if (message === 'Google network request failed. Try again.') return message
  if (typeof message !== 'string') return undefined
  const match = /^Google request failed \(HTTP ([1-5][0-9]{2})\)(?:: ([A-Za-z_]+))?\. Try again or reconnect\.$/.exec(message)
  if (!match || (match[2] && !authCodes.has(match[2]))) return undefined
  return `Google request failed (HTTP ${Number(match[1])})${match[2] ? `: ${match[2]}` : ''}. Try again or reconnect.`
}

export function httpFailure(status, result) {
  const label = Number.isInteger(status) && status >= 100 && status <= 599 ? ` (HTTP ${status})` : ''
  const error = result?.error
  const candidates = [
    ...(Array.isArray(error?.errors) ? error.errors.map(value => value?.reason) : []),
    ...(Array.isArray(error?.details) ? error.details.map(value => value?.reason) : []),
    error?.status]
  const reason = candidates.find(value => typeof value === 'string' && reasons.has(value))
  return `Google request failed${label}${reason ? `: ${reason}` : ''}. Try again or reconnect.`
}
