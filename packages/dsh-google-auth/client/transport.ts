import { isRecord } from '../shared/contracts.js'
import type { AuthStatus, SettingsRequest } from '../shared/contracts.js'
export function authorizationUrl(value: unknown) {
  let url
  try {
    if (typeof value === 'string') url = new URL(value)
  } catch {
    /* Reject malformed links. */
  }
  if (
    !url ||
    url.protocol !== 'https:' ||
    url.hostname !== 'accounts.google.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/o/oauth2/v2/auth' ||
    url.hash
  ) {
    throw new Error(
      'Google returned an invalid authorization link. Cancel and try connecting again.',
    )
  }
  return url.href
}
export const api: SettingsRequest = async (method, ...[body]) => {
  let response
  try {
    response = await window.fetch(`/api/plugins/google-auth/${method}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-DSH-Google-Auth': '1' },
      body: JSON.stringify(body ?? {}),
    })
  } catch {
    throw new Error(
      'Cannot reach DSH. Check your connection and open the local DSH GUI, then retry.',
    )
  }
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new Error(
      'DSH returned an unreadable response. Check that the Google auth plugin is enabled.',
    )
  }
  if (
    isRecord(result) &&
    result.ok === false &&
    isRecord(result.error) &&
    typeof result.error.message === 'string'
  )
    throw new Error(result.error.message)
  if (!response.ok || !isRecord(result) || result.ok !== true)
    throw new Error('Google accounts are unavailable. Open the local DSH GUI and retry.')
  return result.value
}
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((scope: unknown) => typeof scope === 'string')
// The baseline validates the status core; optional account/error leaves stay
// unknown until rendered. Do not claim validation that the wire guard does not do.
export type ClientStatus = Omit<AuthStatus, 'account' | 'error' | 'expiresAt'> & {
  account?: unknown
  error?: unknown
  expiresAt?: unknown
}
export function validStatus(value: unknown): value is ClientStatus {
  return (
    isRecord(value) &&
    ['configured', 'connected', 'pending'].every((key) => typeof value[key] === 'boolean') &&
    ['useSandbox', 'sandboxAvailable'].every(
      (key) => value[key] === undefined || typeof value[key] === 'boolean',
    ) &&
    ['requiredScopes', 'missingScopes'].every((key) => strings(value[key])) &&
    Array.isArray(value.integrations) &&
    value.integrations.every(
      (item: unknown) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.label === 'string' &&
        typeof item.authorized === 'boolean' &&
        strings(item.scopes) &&
        strings(item.missingScopes),
    )
  )
}
