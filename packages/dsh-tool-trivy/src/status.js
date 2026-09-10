export const TRIVY_STATUS_CHANNEL = '/trivy-status'
export const TRIVY_STATUS_GET = 'get'
export const TRIVY_STATUS_RECHECK = 'recheck'

function internalError(message) {
  return {
    ok: false,
    error: {
      code: 'internal',
      message,
      details: {},
    },
  }
}

function publicStatus(value) {
  const { path: _path, ...status } = value
  return status
}

export function registerTrivyStatusRpc(ctx, runtime) {
  const connection = ctx.get('connection')
  if (connection === undefined) return
  ctx.effect(() => connection.rpc.handle(
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
  ), 'tool-trivy: status RPC')
}
