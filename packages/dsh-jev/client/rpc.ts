import { CHANNEL, type JevStatus, type RpcEndpoints, type RpcResult } from '../shared/contracts.ts'

// This private channel returns the host's validated, sanitized status projection.
// Keep the native Connection object stable across renders and effects.
export interface Rpc {
  call(channel: string, endpoint: string, payload: unknown): Promise<RpcResult<JevStatus>>
}
export async function call<E extends keyof RpcEndpoints>(
  rpc: Rpc,
  method: E,
  payload: RpcEndpoints[E]['input'],
): Promise<RpcEndpoints[E]['result']> {
  let result
  try {
    result = await rpc.call(CHANNEL, method, payload)
  } catch {
    throw new Error('Jev settings request failed.')
  }
  if (!result?.ok) throw new Error(result?.error?.message || 'Jev settings are unavailable.')
  return result.value
}
