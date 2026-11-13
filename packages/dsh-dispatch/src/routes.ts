import type { Decision } from './contracts.js'
import { DECISIONS, DispatchError } from './contracts.js'
import type { DispatchService } from './service.js'
import type { PeerLike, RpcHandler } from './types.js'
import { isRecord } from './types.js'

export const CHANNEL = '/local-dispatch'

function identity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
    throw new DispatchError('invalid', 'Invalid Dispatch request.')
  for (const key of keys)
    if (!identity(value[key]) && key !== 'digest')
      throw new DispatchError('invalid', 'Invalid Dispatch request.')
  return value
}

/**
 * User decisions arrive only through Connection RPC, whose carrier
 * authenticates the signed browser credential (or API credential) and hands
 * the handler its Peer. Only the `owner` principal may decide. In-process agent
 * paths never reach this handler, and the payload carries identities, never
 * replacement prompts, models, or targets.
 */
export function createRpcHandler(service: DispatchService): RpcHandler {
  return async (endpoint, payload, signal, peer: PeerLike) => {
    try {
      if (peer?.principal?.kind !== 'owner')
        throw new DispatchError(
          'forbidden',
          'Only the signed-in DSH user can review Dispatch proposals.',
        )
      if (signal.aborted) throw new DispatchError('unavailable', 'Request cancelled.')
      if (endpoint === 'status') {
        const input = exact(payload, ['sessionId', 'callId'])
        return {
          ok: true,
          value: await service.proposalStatus(input.sessionId as string, input.callId as string),
        }
      }
      if (endpoint === 'workers') {
        const input = exact(payload, ['sessionId'])
        return { ok: true, value: await service.workersOf(input.sessionId as string) }
      }
      if (endpoint === 'decide') {
        const input = exact(payload, ['sessionId', 'callId', 'proposalId', 'digest', 'decision'])
        if (typeof input.digest !== 'string' || !/^[0-9a-f]{64}$/u.test(input.digest))
          throw new DispatchError('invalid', 'Invalid Dispatch request.')
        if (!DECISIONS.includes(input.decision as Decision))
          throw new DispatchError('invalid', 'Invalid Dispatch decision.')
        return {
          ok: true,
          value: await service.decide({
            sessionId: input.sessionId as string,
            callId: input.callId as string,
            proposalId: input.proposalId as string,
            digest: input.digest,
            decision: input.decision as Decision,
          }),
        }
      }
      throw new DispatchError('invalid', 'Unknown Dispatch endpoint.')
    } catch (error) {
      const safe =
        error instanceof DispatchError
          ? error
          : new DispatchError('unavailable', 'Dispatch could not complete the request.')
      return { ok: false, error: { code: safe.code, message: safe.message, details: {} } }
    }
  }
}
