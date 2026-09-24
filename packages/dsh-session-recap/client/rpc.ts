import type { Rpc, RpcResult, ScopedSettings } from '../shared/contracts.ts'

// RPC response handling and the controller's retryable settings cache.
export const CHANNEL = '/session-recap'
export const ID = 'wombat9000-session-recap'

export interface ExternalRpc {
  call(channel: string, endpoint: string, payload: unknown): Promise<unknown>
}

// The host validates endpoint payloads and results. Keep the external transport's
// unknown result assertion at this adapter, not in controllers or components.
// This is a type boundary, not new client-side validation: unwrap and rendering
// retain their existing runtime defenses against unexpected wire data.
export function adaptRpc(rpc: ExternalRpc): Rpc {
  // Preserve both transport identity (React effect dependencies) and method `this`.
  return rpc as Rpc
}

export function unwrap<T>(result: RpcResult<T>): T {
  if (!result?.ok) {
    throw new Error(result?.error?.message || 'Session recap is unavailable.')
  }
  return result.value
}

export function createSettingsReader(rpc: Rpc) {
  let pending: Promise<ScopedSettings> | undefined

  function settings() {
    pending ??= rpc.call(CHANNEL, 'settings', {}).then(unwrap).catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }

  function invalidate() {
    pending = undefined
  }

  return { settings, invalidate }
}

export function errorMessage(error: unknown): string {
  // Retain ordinary Error and string messages while safely normalizing malformed
  // thrown values (including null and objects with a non-string message).
  return (error !== null && (typeof error === 'object' || typeof error === 'function')
    && 'message' in error && typeof error.message === 'string' && error.message) || String(error)
}
