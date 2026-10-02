import { CHANNEL, isObject, isStatus } from '../shared/contracts.js'
import type { RpcEndpoints, RpcTransport } from '../shared/contracts.js'

export async function call<E extends keyof RpcEndpoints>(
  rpc: RpcTransport,
  method: E,
  payload: RpcEndpoints[E]['input'],
): Promise<RpcEndpoints[E]['result']> {
  let result: unknown
  try {
    result = await rpc.call(CHANNEL, method, payload)
  } catch {
    throw new Error('OpenRouter settings request failed.')
  }
  if (!isObject(result) || result.ok !== true) {
    const error = isObject(result) && isObject(result.error) ? result.error.message : undefined
    throw new Error(
      typeof error === 'string' && error ? error : 'OpenRouter settings are unavailable.',
    )
  }
  if (!isStatus(result.value)) throw new Error('OpenRouter settings are unavailable.')
  return result.value
}
