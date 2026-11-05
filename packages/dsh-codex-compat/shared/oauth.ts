import { isObject } from './contracts.js'

export const OAUTH_CHANNEL = '/codex-reconnect'
export const CODEX_DEVICE_URL = 'https://auth.openai.com/codex/device'

export type ReconnectStatus =
  | { phase: 'starting' | 'cancelling' | 'authorized' | 'cancelled' | 'failed' }
  | { phase: 'code'; code: string }

export interface ReconnectEndpoints {
  start: { input: Record<string, never>; result: { id: string } | { busy: true } }
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
