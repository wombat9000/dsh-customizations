import {
  TRIVY_STATUS_CHANNEL,
  TRIVY_STATUS_GET,
  TRIVY_STATUS_RECHECK,
} from '../shared/contracts.js'
import type { StatusResponse, TrivyStatus, PublicTrivyStatus } from '../shared/contracts.js'
import type { StatusContext, TrivyRuntime } from './contracts.js'
export { TRIVY_STATUS_CHANNEL, TRIVY_STATUS_GET, TRIVY_STATUS_RECHECK }

function internalError(message: string): StatusResponse {
  return {
    ok: false,
    error: {
      code: 'internal',
      message,
      details: {},
    },
  }
}

function publicStatus(value: TrivyStatus): PublicTrivyStatus {
  const { path: _path, ...status } = value
  return status
}

export function registerTrivyStatusRpc(ctx: StatusContext, runtime: Pick<TrivyRuntime, 'check'>) {
  const connection = ctx.get('connection')
  if (connection === undefined) return
  ctx.effect(
    () =>
      connection.rpc.handle(
        TRIVY_STATUS_CHANNEL,
        async (endpoint, _payload, signal) => {
          if (endpoint !== TRIVY_STATUS_GET && endpoint !== TRIVY_STATUS_RECHECK) {
            return internalError('Unknown Trivy status endpoint')
          }
          try {
            const value = await runtime.check({ force: endpoint === TRIVY_STATUS_RECHECK, signal })
            return { ok: true, value: publicStatus(value) }
          } catch (error) {
            return internalError(error instanceof Error ? error.message : String(error))
          }
        },
        { authority: 'trusted-host' },
      ),
    'tool-trivy: status RPC',
  )
}
