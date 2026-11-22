import { isObject } from './contracts.js'

export const OAUTH_CHANNEL = '/codex-reconnect'
export const CODEX_DEVICE_URL = 'https://auth.openai.com/codex/device'

export type SignInMethod = 'browser' | 'device_code'

export function isBrowserSignInUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !URL.canParse(value)) return false
  const url = new URL(value)
  return (
    url.origin === 'https://auth.openai.com' &&
    url.pathname === '/oauth/authorize' &&
    !url.username &&
    !url.password &&
    !url.hash &&
    url.searchParams.get('redirect_uri') === 'http://localhost:1455/auth/callback'
  )
}

export type ReconnectStatus =
  | { phase: 'starting' | 'cancelling' | 'authorized' | 'cancelled' | 'failed' }
  | { phase: 'code'; code: string }
  | { phase: 'browser'; url: string }

export interface ReconnectEndpoints {
  start: { input: { method?: SignInMethod }; result: { id: string } | { busy: true } }
  status: { input: { id: string }; result: ReconnectStatus }
  cancel: { input: { id: string }; result: null }
}

/** Device codes are short display strings. The sign-in link is fixed separately. */
export function isDeviceCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z0-9-]{4,32}$/iu.test(code)
}

/** Check status before rendering data returned by the connection. */
export function isReconnectStatus(status: unknown): status is ReconnectStatus {
  if (!isObject(status)) return false
  switch (status.phase) {
    case 'browser':
      return isBrowserSignInUrl(status.url)
    case 'code':
      return isDeviceCode(status.code)
    case 'starting':
    case 'cancelling':
    case 'authorized':
    case 'cancelled':
    case 'failed':
      return true
    default:
      return false
  }
}
